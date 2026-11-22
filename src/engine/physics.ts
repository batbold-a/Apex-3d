import * as THREE from 'three';
import {
  CarSpec,
  CollisionEvent,
  DamageTelemetry,
  TelemetryData,
  VehicleTuningSetup,
} from '../types/vehicle';
import { AerodynamicsModule } from './dynamics/aerodynamics';
import { BrakesModule } from './dynamics/brakes';
import { EngineModule } from './dynamics/engine';
import { SteeringModule } from './dynamics/steering';
import { SuspensionModule } from './dynamics/suspension';
import { TireModule } from './dynamics/tires';
import { TransmissionModule } from './dynamics/transmission';
import { cloneTuning, createDefaultTuning } from './dynamics/tuning';
import { PhysicsPerfMonitor } from './perfMonitor';
import { FIXED_PHYSICS_DT, RapierWorldManager } from './rapierWorld';
import { sampleTerrain, TerrainSample } from './terrain';

export interface VehicleInput {
  throttle: boolean; // W
  brake: boolean; // S or Space (service brake)
  steerLeft: boolean; // A
  steerRight: boolean; // D
  handbrake: boolean; // E (mechanical handbrake)
  serviceBrakeOnly?: boolean; // True when Space is pressed without S (prevents shifting into Reverse)
  steerOverride?: number; // Optional continuous [-1..1] for automated benchmarks
}

export interface PhysicsDebugSnapshot {
  comWorld: [number, number, number];
  velocityWorld: [number, number, number];
  angVelWorld: [number, number, number];
  wheelContactWorld: [number, number, number][];
  wheelForceWorld: [number, number, number][];
  wheelNormalN: [number, number, number, number];
  wheelSlipAngleDeg: [number, number, number, number];
  wheelSlipRatio: [number, number, number, number];
  wheelRpm: [number, number, number, number];
  wheelCompressionNorm: [number, number, number, number];
  wheelSteerDeg: [number, number, number, number];
  grounded: [boolean, boolean, boolean, boolean];
}

// Pre-allocated scratch math objects (zero heap allocations inside 120 Hz loop)
const _carForward = new THREE.Vector3();
const _carRight = new THREE.Vector3();
const _carUp = new THREE.Vector3();
const _mountLocal = new THREE.Vector3();
const _mountWorld = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _localAngVel = new THREE.Vector3();
const _torqueVec = new THREE.Vector3();
const _eulerTmp = new THREE.Euler(0, 0, 0, 'YXZ');
const _upVec = new THREE.Vector3(0, 1, 0);
const _normVec = new THREE.Vector3();
const _tiltQuat = new THREE.Quaternion();
const _spawnQuat = new THREE.Quaternion();
const _prevVelocity = new THREE.Vector3();

const WHEEL_LAYOUT: readonly [number, number, boolean][] = [
  [-1, -1, true], // 0: FL
  [1, -1, true], // 1: FR
  [-1, 1, false], // 2: RL
  [1, 1, false], // 3: RR
];

function carUpshiftFrac(carId: string, bodyStyle: CarSpec['bodyStyle'], throttle: number): number {
  if (carId === 'gt3-rs') return throttle > 0.75 ? 0.955 : 0.78 + throttle * 0.2;
  if (carId === 'shelby-gt500') return throttle > 0.75 ? 0.945 : 0.76 + throttle * 0.22;
  if (carId === 'wrx-rally') return throttle > 0.75 ? 0.925 : 0.76 + throttle * 0.18;
  if (bodyStyle === 'suv') return 0.68 + throttle * 0.22;
  return 0.91;
}

/**
 * 120 Hz Modular Vehicle Dynamics Orchestrator backed exclusively by Rapier 3D
 * rigid-body integration. Delegates physics to independent Engine, Transmission,
 * Brakes, Steering, Suspension, Tire (transient combined-slip Pacejka), and
 * Aerodynamics modules, applying only pure forces/torques into Rapier.
 */
export class VehiclePhysics {
  public car: CarSpec;
  public tuning: VehicleTuningSetup;
  public readonly rapier: RapierWorldManager;
  public readonly perfMonitor = new PhysicsPerfMonitor();

  // Modular vehicle sub-systems
  public readonly engine = new EngineModule();
  public readonly transmission = new TransmissionModule();
  public readonly brakes = new BrakesModule();
  public readonly steering = new SteeringModule();
  public readonly suspension = new SuspensionModule();
  public readonly tires = new TireModule();
  public readonly aero = new AerodynamicsModule();

  // Interpolated pose for smooth 60/120/144 Hz rendering
  public position = new THREE.Vector3(0, 1.0, 0);
  public quaternion = new THREE.Quaternion();

  // Latest fixed-step Rapier rigid-body pose & velocities
  public prevPosition = new THREE.Vector3(0, 1.0, 0);
  public prevQuaternion = new THREE.Quaternion();
  public currPosition = new THREE.Vector3(0, 1.0, 0);
  public currQuaternion = new THREE.Quaternion();
  public velocity = new THREE.Vector3(0, 0, 0);
  public angularVelocity = new THREE.Vector3(0, 0, 0);

  private accumulator = 0;

  // Smoothed controls
  public throttleSmooth = 0;
  public brakeSmooth = 0;
  public steerSmooth = 0;
  public handbrakeSmooth = 0;
  public currentSteerRad = 0;

  // Transmission & engine state exposed cleanly for HUD/audio
  public gearIndex = 1; // -1 = R, 0 = N, 1..N (6/7/8/9 speeds)
  public autoShift = true;
  public engineRpm = 900;
  public engineLoad = 0.08;
  public boostBar = 0;
  public absActive = false;
  public isRevLimiting = false;
  public isLugging = false;
  public shiftCooldown = 0;
  public diffLock = false;
  public driftMode = false;
  private reverseHoldTimer = 0;
  private manualHoldTimer = 0;

  // Exposed wheel arrays (backed by SuspensionModule & TireModule)
  public get wheelCompression(): [number, number, number, number] {
    return this.suspension.compression;
  }
  public get wheelOffsetY(): [number, number, number, number] {
    return this.suspension.offsetY;
  }
  public get wheelGroundContact(): [boolean, boolean, boolean, boolean] {
    return this.suspension.groundContact;
  }
  public get wheelTerrain(): TerrainSample[] {
    return this.suspension.terrain;
  }
  public get wheelSpinAngle(): [number, number, number, number] {
    return this.tires.wheelSpinAngle;
  }
  public get wheelAngularVel(): [number, number, number, number] {
    return this.tires.wheelAngularVel;
  }
  public get wheelSlip(): [number, number, number, number] {
    return this.tires.wheelSlip;
  }

  public distanceMeters = 0;
  public lastEngineTorque = 0;
  public lastWheelTorque = 0;
  public lateralG = 0;
  public longitudinalG = 0;

  // Environment crosswind (m/s, used in Stage 4)
  public windWorldX = 0;
  public windWorldZ = 0;

  // Damage & mechanical degradation state (0 = pristine, 1 = heavily damaged)
  public frontDamage = 0;
  public rearDamage = 0;
  public leftDamage = 0;
  public rightDamage = 0;
  public engineDamage = 0;
  public suspensionDamage: [number, number, number, number] = [0, 0, 0, 0];
  private simTime = 0;
  private impactCooldown = 0;
  private pendingCollisions: CollisionEvent[] = [];

  private pinballBeforeStep?: (dt: number) => void;
  private pinballAfterStep?: (dt: number) => void;
  private pinballCollisionEvent?: (h1: number, h2: number, started: boolean) => void;
  private pinballContactForceEvent?: (
    h1: number,
    h2: number,
    forceMag: number,
    dirX: number,
    dirY: number,
    dirZ: number
  ) => void;

  private static readonly MAX_SUBSTEPS = 6;

  constructor(car: CarSpec, rapier: RapierWorldManager, initialTuning?: VehicleTuningSetup) {
    this.car = car;
    this.tuning = initialTuning ? cloneTuning(initialTuning) : createDefaultTuning(car);
    this.rapier = rapier;
    this.reset(new THREE.Vector3(0, 0, 16), 0);
  }

  public setPinballHooks(
    hooks: {
      onBeforeStep?: (dt: number) => void;
      onAfterStep?: (dt: number) => void;
      onCollisionEvent?: (h1: number, h2: number, started: boolean) => void;
      onContactForceEvent?: (
        h1: number,
        h2: number,
        forceMag: number,
        dirX: number,
        dirY: number,
        dirZ: number
      ) => void;
    } | null
  ): void {
    this.pinballBeforeStep = hooks?.onBeforeStep;
    this.pinballAfterStep = hooks?.onAfterStep;
    this.pinballCollisionEvent = hooks?.onCollisionEvent;
    this.pinballContactForceEvent = hooks?.onContactForceEvent;
  }

  public getRenderAlpha(): number {
    return Math.max(0, Math.min(1, this.accumulator / FIXED_PHYSICS_DT));
  }

  public setTuning(nextTuning: VehicleTuningSetup): void {
    this.tuning = cloneTuning(nextTuning);
  }

  public resetTuning(): void {
    this.tuning = createDefaultTuning(this.car);
  }

  public drainCollisions(): CollisionEvent[] {
    if (this.pendingCollisions.length === 0) return [];
    const out = this.pendingCollisions;
    this.pendingCollisions = [];
    return out;
  }

  public repairDamage(): void {
    this.frontDamage = 0;
    this.rearDamage = 0;
    this.leftDamage = 0;
    this.rightDamage = 0;
    this.engineDamage = 0;
    this.suspensionDamage = [0, 0, 0, 0];
    this.pendingCollisions = [];
  }

  public setCar(car: CarSpec, keepPosition = true, customTuning?: VehicleTuningSetup): void {
    const savedPos = this.currPosition.clone();
    _eulerTmp.setFromQuaternion(this.currQuaternion, 'YXZ');
    const savedYaw = _eulerTmp.y;
    this.car = car;
    this.tuning = customTuning ? cloneTuning(customTuning) : createDefaultTuning(car);
    if (!car.hasDiffLock) {
      this.diffLock = false;
    }
    this.rapier.createChassisRigidBody(car);
    this.repairDamage();
    if (keepPosition) {
      this.reset(savedPos, savedYaw);
    } else {
      this.reset(new THREE.Vector3(0, 0, 16), 0);
    }
  }

  public toggleDiffLock(): boolean {
    if (!this.car.hasDiffLock) return false;
    this.diffLock = !this.diffLock;
    return this.diffLock;
  }

  public setDiffLock(locked: boolean): void {
    this.diffLock = this.car.hasDiffLock ? locked : false;
  }

  public toggleDriftMode(): boolean {
    this.driftMode = !this.driftMode;
    return this.driftMode;
  }

  public setDriftMode(enabled: boolean): void {
    this.driftMode = enabled;
  }

  /**
   * Explicit user/scenario teleport & full rigid-body reset.
   * Never invoked automatically during continuous physics stepping.
   */
  public reset(pos: THREE.Vector3, headingRad = 0): void {
    const ground = sampleTerrain(pos.x, pos.z);
    const springK = this.car.springStiffness * this.tuning.springRateScaleFront;
    const staticSag = (this.car.massKg * 9.81) / 4 / springK;
    const mountY = this.car.suspensionRestLength * 0.35;
    const restLen = Math.max(0.14, this.car.suspensionRestLength + this.tuning.rideHeightOffsetM);
    let clearance = this.car.wheelRadius + (restLen - staticSag) - mountY;

    _eulerTmp.set(0, headingRad, 0, 'YXZ');
    _spawnQuat.setFromEuler(_eulerTmp);
    _normVec.set(ground.normalX, ground.normalY, ground.normalZ).normalize();
    _tiltQuat.setFromUnitVectors(_upVec, _normVec);
    _spawnQuat.premultiply(_tiltQuat);

    const hx = this.car.trackWidth * 0.5;
    const hz = this.car.wheelbase * 0.5;
    let maxWheelBump = 0;
    for (let i = 0; i < 4; i++) {
      _mountLocal
        .set(WHEEL_LAYOUT[i][0] * hx, 0, WHEEL_LAYOUT[i][1] * hz)
        .applyQuaternion(_spawnQuat);
      const wg = sampleTerrain(pos.x + _mountLocal.x, pos.z + _mountLocal.z);
      const planeY = ground.height + _mountLocal.y;
      const bump = wg.height - planeY;
      if (bump > maxWheelBump) maxWheelBump = bump;
    }
    clearance += Math.min(0.28, Math.max(0, maxWheelBump));

    const dropRequested = pos.y > ground.height + clearance + 0.08;
    if (dropRequested) {
      _mountWorld.set(pos.x, pos.y, pos.z);
    } else {
      _mountWorld.set(
        pos.x + _normVec.x * clearance,
        ground.height + _normVec.y * clearance,
        pos.z + _normVec.z * clearance
      );
    }
    this.rapier.teleportChassis(_mountWorld, _spawnQuat);
    this.rapier.readBodyPose(
      this.currPosition,
      this.currQuaternion,
      this.velocity,
      this.angularVelocity
    );

    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
    this.position.copy(this.currPosition);
    this.quaternion.copy(this.currQuaternion);
    _prevVelocity.copy(this.velocity);
    this.accumulator = 0;

    this.gearIndex = 1;
    this.throttleSmooth = 0;
    this.brakeSmooth = 0;
    this.steerSmooth = 0;
    this.handbrakeSmooth = 0;
    this.currentSteerRad = 0;
    this.isRevLimiting = false;
    this.isLugging = false;
    this.absActive = false;
    this.shiftCooldown = 0;
    this.reverseHoldTimer = 0;
    this.manualHoldTimer = 0;
    this.lateralG = 0;
    this.longitudinalG = 0;

    this.engine.reset(this.car);
    this.transmission.reset();
    this.brakes.reset();
    this.steering.reset();
    this.suspension.reset(this.car, staticSag, mountY, ground);
    this.tires.reset();
    this.engineRpm = this.engine.rpm;
    this.engineLoad = this.engine.engineLoad;
    this.boostBar = this.engine.boostBar;
  }

  public toggleAutoShift(): boolean {
    this.autoShift = !this.autoShift;
    this.manualHoldTimer = 0;
    this.reverseHoldTimer = 0;
    if (this.autoShift && this.gearIndex === 0) {
      this.gearIndex = 1;
    }
    return this.autoShift;
  }

  public getMaxGear(): number {
    return Math.max(1, this.tuning.gearRatios.length);
  }

  public shiftUp(): boolean {
    const maxGear = this.getMaxGear();
    if (this.gearIndex < maxGear) {
      this.gearIndex += 1;
      this.shiftCooldown = this.car.id === 'gt3-rs' ? 0.08 : 0.13;
      this.manualHoldTimer = 2.4;
      return true;
    }
    return false;
  }

  public shiftDown(): boolean {
    if (this.gearIndex > -1) {
      this.gearIndex -= 1;
      this.shiftCooldown = this.car.id === 'gt3-rs' ? 0.08 : 0.13;
      this.manualHoldTimer = 2.4;
      return true;
    }
    return false;
  }

  public setGear(gear: number): boolean {
    const maxGear = this.getMaxGear();
    const clamped = Math.max(-1, Math.min(maxGear, Math.round(gear)));
    if (clamped !== this.gearIndex) {
      this.gearIndex = clamped;
      this.shiftCooldown = 0.12;
      this.manualHoldTimer = 2.4;
      return true;
    }
    return false;
  }

  public getGearLabel(g = this.gearIndex): string {
    if (g === -1) return 'R';
    if (g === 0) return 'N';
    return String(g);
  }

  public getActiveGearRatio(): number {
    return this.transmission.getGearRatio(this.car, this.tuning, this.gearIndex);
  }

  /**
   * Advances simulation using a strict 120 Hz fixed-timestep accumulator and
   * linearly interpolates / slerps prev->curr chassis transforms for smooth rendering.
   */
  public step(frameDt: number, input: VehicleInput): void {
    const clampedDt = Math.min(Math.max(frameDt, 0), 0.05);
    if (clampedDt <= 0) return;

    const workStart = performance.now();
    this.accumulator += clampedDt;

    let substeps = 0;
    while (this.accumulator >= FIXED_PHYSICS_DT && substeps < VehiclePhysics.MAX_SUBSTEPS) {
      this.prevPosition.copy(this.currPosition);
      this.prevQuaternion.copy(this.currQuaternion);

      this.updateDriverInputs(FIXED_PHYSICS_DT, input);
      this.stepSub(FIXED_PHYSICS_DT);

      this.accumulator -= FIXED_PHYSICS_DT;
      substeps++;
    }

    if (substeps >= VehiclePhysics.MAX_SUBSTEPS && this.accumulator > FIXED_PHYSICS_DT) {
      this.accumulator = FIXED_PHYSICS_DT * 0.5;
    }

    const workMs = performance.now() - workStart;
    this.perfMonitor.recordFrame(clampedDt, substeps, workMs);

    const alpha = Math.max(0, Math.min(1, this.accumulator / FIXED_PHYSICS_DT));
    this.position.lerpVectors(this.prevPosition, this.currPosition, alpha);
    this.quaternion.slerpQuaternions(this.prevQuaternion, this.currQuaternion, alpha);
  }

  private updateDriverInputs(dt: number, input: VehicleInput): void {
    _carForward.set(0, 0, -1).applyQuaternion(this.currQuaternion).normalize();
    const fwdSpeed = this.velocity.dot(_carForward);
    const absSpeed = this.velocity.length();

    if (this.shiftCooldown > 0) {
      this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    }
    if (this.manualHoldTimer > 0) {
      this.manualHoldTimer = Math.max(0, this.manualHoldTimer - dt);
    }

    const maxGear = this.getMaxGear();

    if (this.autoShift) {
      // Only KeyS / brake pedal shifts into Reverse when stopped; Space (serviceBrakeOnly) holds 1st gear and stops cleanly
      if (input.brake && !input.serviceBrakeOnly && !input.throttle && !input.handbrake) {
        if (this.gearIndex >= 1) {
          if (absSpeed < 1.1 && Math.abs(fwdSpeed) < 0.9) {
            this.reverseHoldTimer += dt;
            if (this.reverseHoldTimer >= 0.22) {
              this.gearIndex = -1;
              this.shiftCooldown = 0.1;
              this.reverseHoldTimer = 0;
            }
          } else {
            this.reverseHoldTimer = 0;
          }
        }
      } else {
        this.reverseHoldTimer = 0;
      }

      if (input.throttle && !input.brake && this.gearIndex === -1 && fwdSpeed > -0.6) {
        this.gearIndex = 1;
        this.shiftCooldown = 0.1;
      }

      if (this.shiftCooldown <= 0 && this.manualHoldTimer <= 0) {
        if (
          this.gearIndex >= 2 &&
          (absSpeed < 1.8 || (this.gearIndex >= 3 && fwdSpeed < 2.2 && input.throttle))
        ) {
          this.gearIndex = 1;
          this.shiftCooldown = 0.12;
        } else if (
          this.gearIndex >= 1 &&
          this.gearIndex < maxGear &&
          input.throttle &&
          !input.brake &&
          absSpeed > 4.2
        ) {
          const allGrounded =
            this.suspension.groundContact[0] &&
            this.suspension.groundContact[1] &&
            this.suspension.groundContact[2] &&
            this.suspension.groundContact[3];
          const avgDriveSlip = Math.max(
            Math.abs(this.tires.slipRatio[2]),
            Math.abs(this.tires.slipRatio[3])
          );
          const gearTotalRatio = Math.abs(this.getActiveGearRatio() * this.tuning.finalDrive);
          const roadRpm =
            (absSpeed / Math.max(0.2, this.car.wheelRadius)) *
            gearTotalRatio *
            (60 / (2 * Math.PI));
          const upshiftRatio = carUpshiftFrac(this.car.id, this.car.bodyStyle, this.throttleSmooth);
          if (
            allGrounded &&
            this.engine.rpm >= this.car.redlineRpm * upshiftRatio &&
            !this.isLugging &&
            (avgDriveSlip < 0.35 || roadRpm >= this.car.redlineRpm * 0.85)
          ) {
            this.gearIndex += 1;
            this.shiftCooldown =
              this.car.id === 'gt3-rs'
                ? 0.05
                : this.car.id === 'shelby-gt500'
                  ? 0.06
                  : this.car.id === 'wrx-rally'
                    ? 0.075
                    : 0.13;
          }
        } else if (this.gearIndex >= 2) {
          const rpmBand = this.car.redlineRpm - this.car.idleRpm;
          const downFrac =
            this.car.bodyStyle === 'suv'
              ? input.throttle
                ? 0.24
                : 0.14
              : input.throttle
                ? 0.3
                : 0.18;
          const lowRpmThreshold = this.car.idleRpm + rpmBand * downFrac;
          if (this.engine.rpm < lowRpmThreshold || (this.isLugging && input.throttle)) {
            this.gearIndex -= 1;
            this.shiftCooldown = this.car.id === 'gt3-rs' ? 0.1 : 0.18;
          }
        }
      }
    } else {
      if (this.gearIndex >= 2 && absSpeed < 0.85 && input.brake && !input.throttle) {
        this.gearIndex = 1;
        this.shiftCooldown = 0.12;
      }
    }

    let targetThrottle = input.throttle ? 1 : 0;
    let targetBrake = input.brake ? 1 : 0;
    if (this.autoShift && this.gearIndex === -1) {
      if (input.throttle && !input.brake && fwdSpeed < -0.55) {
        // Reversing at speed and pressing W: apply service brakes cleanly until nearly stopped, then shift to 1st!
        targetThrottle = 0;
        targetBrake = 1;
      } else if (input.brake && !input.serviceBrakeOnly && !input.throttle && !input.handbrake) {
        if (fwdSpeed <= 0.5) {
          targetThrottle = 1;
          targetBrake = 0;
        } else {
          targetThrottle = 0;
          targetBrake = 1;
        }
      }
    }

    const targetHandbrake = input.handbrake ? 1 : 0;
    const targetSteer =
      typeof input.steerOverride === 'number'
        ? THREE.MathUtils.clamp(input.steerOverride, -1, 1)
        : (input.steerLeft ? 1 : 0) - (input.steerRight ? 1 : 0);

    const throttleRate = targetThrottle === 0 ? 24 : 26;
    const brakeRate = targetBrake === 0 && input.throttle ? 48 : 26;
    this.throttleSmooth += (targetThrottle - this.throttleSmooth) * Math.min(1, dt * throttleRate);
    this.brakeSmooth += (targetBrake - this.brakeSmooth) * Math.min(1, dt * brakeRate);
    this.handbrakeSmooth += (targetHandbrake - this.handbrakeSmooth) * Math.min(1, dt * 26);

    const activeSteerRate =
      this.car.bodyStyle === 'suv'
        ? THREE.MathUtils.lerp(12.5, 5.8, Math.min(1, absSpeed / 60))
        : this.car.bodyStyle === 'rally' || this.car.bodyStyle === 'muscle'
          ? THREE.MathUtils.lerp(15.2, 7.6, Math.min(1, absSpeed / 60))
          : THREE.MathUtils.lerp(18.0, 9.5, Math.min(1, absSpeed / 60));
    const steerRate =
      typeof input.steerOverride === 'number'
        ? 22
        : targetSteer === 0
          ? 16.5
          : activeSteerRate;
    this.steerSmooth += (targetSteer - this.steerSmooth) * Math.min(1, dt * steerRate);

    if (targetThrottle === 0 && this.throttleSmooth < 0.004) this.throttleSmooth = 0;
    if (targetBrake === 0 && this.brakeSmooth < 0.004) this.brakeSmooth = 0;
    if (targetHandbrake === 0 && this.handbrakeSmooth < 0.004) this.handbrakeSmooth = 0;
    if (targetSteer === 0 && Math.abs(this.steerSmooth) < 0.004) this.steerSmooth = 0;
  }

  private stepSub(dt: number): void {
    const car = this.car;
    this.simTime += dt;
    if (this.impactCooldown > 0) this.impactCooldown = Math.max(0, this.impactCooldown - dt);

    // 1. Read authoritative Rapier chassis pose & velocity
    this.rapier.readBodyPose(
      this.currPosition,
      this.currQuaternion,
      this.velocity,
      this.angularVelocity
    );
    _prevVelocity.copy(this.velocity);
    this.rapier.clearAccumulatedForces();

    _carForward.set(0, 0, -1).applyQuaternion(this.currQuaternion).normalize();
    _carRight.set(1, 0, 0).applyQuaternion(this.currQuaternion).normalize();
    _carUp.set(0, 1, 0).applyQuaternion(this.currQuaternion).normalize();

    const forwardSpeed = this.velocity.dot(_carForward);
    const absSpeed = this.velocity.length();
    this.distanceMeters += absSpeed * dt;

    const diffLockActive = this.car.hasDiffLock && this.diffLock;
    const centerGround =
      this.suspension.terrain[0] ?? sampleTerrain(this.currPosition.x, this.currPosition.z);
    const diffScrub = diffLockActive && centerGround.surfaceType === 'asphalt' ? 0.85 : 1.0;

    // 2. Suspension & Anti-Roll Bars
    this.suspension.step(
      dt,
      this.rapier,
      car,
      this.tuning,
      this.currPosition,
      this.currQuaternion,
      this.velocity,
      this.angularVelocity,
      _carUp,
      this.suspensionDamage,
      (wheelIdx, compVel) => {
        if (this.impactCooldown <= 0) {
          const slam = Math.min(0.4, (compVel - 5.8) * 0.07);
          this.suspensionDamage[wheelIdx] = Math.min(1, this.suspensionDamage[wheelIdx] + slam);
          this.impactCooldown = 0.2;
        }
      }
    );

    // 3. Steering & Alignment Kinematics (Ackermann + M_z feedback + Camber/Toe/Caster + Drift Assist)
    const chassisRollRad = Math.asin(THREE.MathUtils.clamp(_carRight.y, -1, 1));
    const lateralSpeedMs = this.velocity.dot(_carRight);
    const steerOut = this.steering.step(
      car,
      this.tuning,
      this.steerSmooth * diffScrub,
      absSpeed,
      chassisRollRad,
      this.suspension.compression,
      this.suspensionDamage,
      this.tires.aligningTorqueNm[0],
      this.tires.aligningTorqueNm[1],
      this.driftMode,
      this.angularVelocity.y,
      lateralSpeedMs,
      forwardSpeed
    );
    this.currentSteerRad = steerOut.centerSteerRad;

    // 4. Powertrain: Engine + Transmission + 2-Way Differentials
    const shiftCutLimit =
      car.id === 'gt3-rs' ? 0.035 : car.id === 'shelby-gt500' ? 0.045 : 0.07;
    const effectiveThrottle =
      this.shiftCooldown > shiftCutLimit ? 0.15 : this.throttleSmooth;
    const activeRatio = this.getActiveGearRatio();
    const totalRatio = activeRatio * this.tuning.finalDrive;

    const frontSplit =
      car.drivetrain === 'RWD' ? 0 : Math.max(0, Math.min(0.65, this.tuning.awdFrontSplit));
    const rearOmega = (this.tires.wheelAngularVel[2] + this.tires.wheelAngularVel[3]) * 0.5;
    const frontOmega = (this.tires.wheelAngularVel[0] + this.tires.wheelAngularVel[1]) * 0.5;
    const drivenOmega =
      car.drivetrain === 'RWD' ? rearOmega : frontOmega * frontSplit + rearOmega * (1 - frontSplit);
    const drivetrainRpm =
      this.gearIndex === 0
        ? car.idleRpm
        : Math.max(0, drivenOmega * totalRatio * (60 / (2 * Math.PI)));

    const engOut = this.engine.step(
      dt,
      car,
      this.tuning,
      effectiveThrottle,
      this.gearIndex,
      this.autoShift,
      drivetrainRpm,
      this.transmission.clutchEngagement,
      absSpeed,
      this.engineDamage,
      this.simTime
    );
    this.engineRpm = this.engine.rpm;
    this.engineLoad = engOut.engineLoad;
    this.boostBar = engOut.boostBar;
    this.isRevLimiting = this.engine.isRevLimiting;
    this.lastEngineTorque = engOut.torqueNm;

    const transOut = this.transmission.step(
      dt,
      car,
      this.tuning,
      this.gearIndex,
      effectiveThrottle,
      this.shiftCooldown,
      engOut.torqueNm,
      engOut.engineBrakeNm,
      this.tires.wheelAngularVel,
      this.tires.slipRatio,
      this.autoShift,
      diffLockActive,
      forwardSpeed,
      this.driftMode,
      this.tires.slipAngleDeg
    );
    this.lastWheelTorque = Math.abs(
      transOut.wheelTorque[0] +
        transOut.wheelTorque[1] +
        transOut.wheelTorque[2] +
        transOut.wheelTorque[3]
    );

    // 5. Brakes, Disc Thermals & ABS
    const avgBodyDmg =
      (this.frontDamage + this.rearDamage + this.leftDamage + this.rightDamage) * 0.25;
    const rearLatSlipDeg = Math.max(
      Math.abs(this.tires.slipAngleDeg[2]),
      Math.abs(this.tires.slipAngleDeg[3])
    );
    const brakeOut = this.brakes.step(
      dt,
      car,
      this.tuning,
      this.brakeSmooth,
      this.handbrakeSmooth,
      absSpeed,
      this.gearIndex,
      avgBodyDmg,
      this.tires.wheelAngularVel,
      this.tires.slipRatio,
      this.suspension.groundContact,
      this.throttleSmooth,
      this.driftMode,
      rearLatSlipDeg
    );
    this.absActive = brakeOut.absActive;

    // 6. Aerodynamics (Drag + Front/Rear Downforce + Crosswind)
    this.aero.applyForces(
      this.rapier,
      car,
      this.tuning,
      this.currPosition,
      this.currQuaternion,
      this.velocity,
      _carForward,
      _carUp,
      this.windWorldX,
      this.windWorldZ
    );

    // 7. Combined-Slip Transient Pacejka Tires
    this.tires.step(
      dt,
      this.rapier,
      car,
      this.tuning,
      this.currPosition,
      this.currQuaternion,
      this.velocity,
      this.angularVelocity,
      _carForward,
      _carRight,
      _carUp,
      this.gearIndex,
      effectiveThrottle,
      this.handbrakeSmooth,
      diffLockActive,
      steerOut.wheelAnglesRad,
      steerOut.camberRad,
      transOut.wheelTorque,
      brakeOut.brakeTorqueNm,
      this.suspension.offsetY,
      this.suspension.groundContact,
      this.suspension.normalLoads,
      this.suspension.springVecs,
      this.suspension.terrain,
      this.suspension.groundedCount,
      this.suspension.totalNormalLoad,
      this.suspensionDamage,
      this.driftMode
    );

    // 8. Lugging Detection & Structural Chassis Angular Damping
    let avgRoughness = 0;
    for (let i = 0; i < 4; i++) {
      avgRoughness += (this.suspension.terrain[i]?.roughness ?? 0) * 0.25;
    }

    const speedKmh = absSpeed * 3.6;
    const slopeSin = Math.max(0, -_carForward.y);
    const maxGearLug = this.getMaxGear();
    const expectedMinKmh = Math.min(95, (this.gearIndex - 1) * (105 / Math.max(5, maxGearLug)));
    this.isLugging =
      this.gearIndex >= 3 &&
      effectiveThrottle > 0.5 &&
      this.engine.rpm < car.idleRpm + (car.redlineRpm - car.idleRpm) * 0.34 &&
      (slopeSin > 0.08 || avgRoughness > 0.45 || speedKmh < expectedMinKmh);

    _invQ.copy(this.currQuaternion).invert();
    _localAngVel.copy(this.angularVelocity).applyQuaternion(_invQ);

    const w = car.width;
    const h = car.height;
    const l = car.length;
    const ix = (car.massKg / 12) * (h * h + l * l);
    const iy = (car.massKg / 12) * (w * w + l * l);
    const iz = (car.massKg / 12) * (w * w + h * h);

    const isStandstill = this.suspension.groundedCount >= 3 && absSpeed < 0.65 && effectiveThrottle < 0.05;
    const pitchDamp = ix * (1.6 + Math.min(2.0, absSpeed * 0.035));
    // Progressive yaw-rate stability limiter in Drift Mode prevents violent 360 snap-spins on brief Space taps
    const absYaw = Math.abs(_localAngVel.y);
    const driftSpinDamp =
      this.driftMode && this.suspension.groundedCount >= 3 && absYaw > 1.25
        ? (absYaw - 1.25) * 2.6
        : 0;
    const yawDamp = iy * ((isStandstill ? 14.0 : 0.42) + driftSpinDamp);
    const rollDamp = iz * (2.2 + Math.min(3.6, absSpeed * 0.075));

    _torqueVec
      .set(-_localAngVel.x * pitchDamp, -_localAngVel.y * yawDamp, -_localAngVel.z * rollDamp)
      .applyQuaternion(this.currQuaternion);
    this.rapier.addTorque(_torqueVec.x, _torqueVec.y, _torqueVec.z);

    // 9. Authoritative Rapier 3D Step & Impact Processing
    this.pinballBeforeStep?.(dt);
    this.rapier.step(dt);
    this.rapier.readBodyPose(
      this.currPosition,
      this.currQuaternion,
      this.velocity,
      this.angularVelocity
    );

    _carForward.set(0, 0, -1).applyQuaternion(this.currQuaternion).normalize();
    _carRight.set(1, 0, 0).applyQuaternion(this.currQuaternion).normalize();
    const accelX = (this.velocity.x - _prevVelocity.x) / dt;
    const accelY = (this.velocity.y - _prevVelocity.y) / dt + 9.81;
    const accelZ = (this.velocity.z - _prevVelocity.z) / dt;
    const rawLatG = (accelX * _carRight.x + accelY * _carRight.y + accelZ * _carRight.z) / 9.81;
    const rawLongG =
      (accelX * _carForward.x + accelY * _carForward.y + accelZ * _carForward.z) / 9.81;
    this.lateralG += (rawLatG - this.lateralG) * Math.min(1, dt * 18);
    this.longitudinalG += (rawLongG - this.longitudinalG) * Math.min(1, dt * 18);

    const impactCountBefore = this.pendingCollisions.length;
    const impactSummary = this.rapier.drainContactImpacts(
      this.pendingCollisions,
      this.pinballCollisionEvent,
      this.pinballContactForceEvent
    );
    this.pinballAfterStep?.(dt);
    if (
      this.pendingCollisions.length > impactCountBefore &&
      impactSummary.maxSeverity > 0.05 &&
      this.impactCooldown <= 0
    ) {
      this.impactCooldown = 0.14;
      const sev = impactSummary.maxSeverity;
      const hlx = impactSummary.hitLocalX;
      const hlz = impactSummary.hitLocalZ;
      const halfW = car.width * 0.48;
      const halfL = car.length * 0.48;

      if (hlz < -halfL * 0.4) {
        this.frontDamage = Math.min(1, this.frontDamage + sev * 0.45);
        this.engineDamage = Math.min(1, this.engineDamage + sev * 0.38);
      } else if (hlz > halfL * 0.4) {
        this.rearDamage = Math.min(1, this.rearDamage + sev * 0.45);
      }
      if (hlx < -halfW * 0.42) {
        this.leftDamage = Math.min(1, this.leftDamage + sev * 0.45);
      } else if (hlx > halfW * 0.42) {
        this.rightDamage = Math.min(1, this.rightDamage + sev * 0.45);
      }

      let nearestIdx = 0;
      let bestDist = Infinity;
      for (let wi = 0; wi < 4; wi++) {
        const wx = WHEEL_LAYOUT[wi][0] * halfW;
        const wz = WHEEL_LAYOUT[wi][1] * halfL;
        const d = Math.hypot(hlx - wx, hlz - wz);
        if (d < bestDist) {
          bestDist = d;
          nearestIdx = wi;
        }
      }
      this.suspensionDamage[nearestIdx] = Math.min(
        1,
        this.suspensionDamage[nearestIdx] + sev * 0.42
      );
    }
  }

  public getDebugSnapshot(): PhysicsDebugSnapshot {
    const hx = this.car.trackWidth * 0.5;
    const hz = this.car.wheelbase * 0.5;
    _carForward.set(0, 0, -1).applyQuaternion(this.position ? this.quaternion : this.currQuaternion).normalize();
    _carRight.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();

    const contacts: [number, number, number][] = [];
    const forces: [number, number, number][] = [];
    const wheelRpm: [number, number, number, number] = [0, 0, 0, 0];
    const maxNorm = Math.max(0.05, this.car.suspensionMaxTravel);

    for (let i = 0; i < 4; i++) {
      _mountLocal
        .set(
          WHEEL_LAYOUT[i][0] * hx,
          this.suspension.offsetY[i] - this.car.wheelRadius,
          WHEEL_LAYOUT[i][1] * hz
        )
        .applyQuaternion(this.quaternion)
        .add(this.position);
      contacts.push([_mountLocal.x, _mountLocal.y, _mountLocal.z]);

      const ang = this.steering.wheelAnglesRad[i];
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      _mountLocal.set(-sn, 0, -cs).applyQuaternion(this.quaternion).multiplyScalar(this.tires.forceLongN[i]);
      _mountWorld.set(cs, 0, -sn).applyQuaternion(this.quaternion).multiplyScalar(this.tires.forceLatN[i]);
      _mountLocal.add(_mountWorld);
      _mountLocal.y += this.suspension.normalLoads[i];
      forces.push([_mountLocal.x, _mountLocal.y, _mountLocal.z]);

      wheelRpm[i] = Math.round((this.tires.wheelAngularVel[i] * 60) / (2 * Math.PI));
    }

    return {
      comWorld: [this.position.x, this.position.y, this.position.z],
      velocityWorld: [this.velocity.x, this.velocity.y, this.velocity.z],
      angVelWorld: [this.angularVelocity.x, this.angularVelocity.y, this.angularVelocity.z],
      wheelContactWorld: contacts,
      wheelForceWorld: forces,
      wheelNormalN: [
        Math.round(this.suspension.normalLoads[0]),
        Math.round(this.suspension.normalLoads[1]),
        Math.round(this.suspension.normalLoads[2]),
        Math.round(this.suspension.normalLoads[3]),
      ],
      wheelSlipAngleDeg: [
        Number(this.tires.slipAngleDeg[0].toFixed(1)),
        Number(this.tires.slipAngleDeg[1].toFixed(1)),
        Number(this.tires.slipAngleDeg[2].toFixed(1)),
        Number(this.tires.slipAngleDeg[3].toFixed(1)),
      ],
      wheelSlipRatio: [
        Number(this.tires.slipRatio[0].toFixed(2)),
        Number(this.tires.slipRatio[1].toFixed(2)),
        Number(this.tires.slipRatio[2].toFixed(2)),
        Number(this.tires.slipRatio[3].toFixed(2)),
      ],
      wheelRpm,
      wheelCompressionNorm: [
        Math.min(1, this.suspension.compression[0] / maxNorm),
        Math.min(1, this.suspension.compression[1] / maxNorm),
        Math.min(1, this.suspension.compression[2] / maxNorm),
        Math.min(1, this.suspension.compression[3] / maxNorm),
      ],
      wheelSteerDeg: [
        Number(THREE.MathUtils.radToDeg(this.steering.wheelAnglesRad[0]).toFixed(1)),
        Number(THREE.MathUtils.radToDeg(this.steering.wheelAnglesRad[1]).toFixed(1)),
        Number(THREE.MathUtils.radToDeg(this.steering.wheelAnglesRad[2]).toFixed(1)),
        Number(THREE.MathUtils.radToDeg(this.steering.wheelAnglesRad[3]).toFixed(1)),
      ],
      grounded: [...this.suspension.groundContact] as [boolean, boolean, boolean, boolean],
    };
  }

  public getTelemetry(): TelemetryData {
    _carForward.set(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    _carRight.set(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    _eulerTmp.setFromQuaternion(this.quaternion, 'YXZ');

    const centerTerrain = sampleTerrain(this.position.x, this.position.z);
    const speedMs = this.velocity.length();
    const pitchDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(_carForward.y, -1, 1))
    );
    const rollDeg = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(_carRight.y, -1, 1))
    );

    const maxNorm = this.car.suspensionMaxTravel;
    const wheelCompNorm: [number, number, number, number] = [
      Math.min(1, this.suspension.compression[0] / maxNorm),
      Math.min(1, this.suspension.compression[1] / maxNorm),
      Math.min(1, this.suspension.compression[2] / maxNorm),
      Math.min(1, this.suspension.compression[3] / maxNorm),
    ];

    const isAirborne =
      !this.suspension.groundContact[0] &&
      !this.suspension.groundContact[1] &&
      !this.suspension.groundContact[2] &&
      !this.suspension.groundContact[3];

    const slopeGradePct = Math.round(
      Math.tan(Math.acos(THREE.MathUtils.clamp(centerTerrain.normalY, 0.5, 1))) * 100
    );

    const headingDeg = ((THREE.MathUtils.radToDeg(-_eulerTmp.y) % 360) + 360) % 360;

    const avgSuspDmg =
      (this.suspensionDamage[0] +
        this.suspensionDamage[1] +
        this.suspensionDamage[2] +
        this.suspensionDamage[3]) *
      0.25;
    const avgBodyDmg =
      (this.frontDamage + this.rearDamage + this.leftDamage + this.rightDamage) * 0.25;
    const overallIntegrity = Math.max(
      0,
      Math.round((1 - (avgBodyDmg * 0.45 + this.engineDamage * 0.3 + avgSuspDmg * 0.25)) * 100)
    );

    const damage: DamageTelemetry = {
      overallIntegrity,
      front: this.frontDamage,
      rear: this.rearDamage,
      left: this.leftDamage,
      right: this.rightDamage,
      engineHealth: Math.round((1 - this.engineDamage) * 100),
      suspensionHealth: [
        Math.round((1 - this.suspensionDamage[0]) * 100),
        Math.round((1 - this.suspensionDamage[1]) * 100),
        Math.round((1 - this.suspensionDamage[2]) * 100),
        Math.round((1 - this.suspensionDamage[3]) * 100),
      ],
      alignmentPullDeg: Number(((this.suspensionDamage[0] - this.suspensionDamage[1]) * 7.5).toFixed(1)),
    };

    return {
      speedKmh: Math.round(speedMs * 3.6),
      speedMs,
      rpm: Math.round(this.engine.rpm),
      redlineRpm: this.car.redlineRpm,
      maxRpm: this.car.maxRpm,
      gearIndex: this.gearIndex,
      gearLabel: this.getGearLabel(),
      autoShift: this.autoShift,
      throttle: this.throttleSmooth,
      brake: this.brakeSmooth,
      handbrake: this.handbrakeSmooth,
      steerNorm: this.steerSmooth,
      engineTorqueNm: Math.round(this.lastEngineTorque),
      wheelTorqueNm: Math.round(this.lastWheelTorque),
      gearRatioActive: this.getActiveGearRatio(),
      diffLock: this.car.hasDiffLock && this.diffLock,
      hasDiffLock: this.car.hasDiffLock,
      driftMode: this.driftMode,
      surfaceType: centerTerrain.surfaceType,
      surfaceName: centerTerrain.surfaceName,
      surfaceGrip: centerTerrain.grip,
      surfaceRoughness: centerTerrain.roughness,
      slopeGradePct,
      wheelCompression: wheelCompNorm,
      wheelGroundContact: [...this.suspension.groundContact] as [
        boolean,
        boolean,
        boolean,
        boolean,
      ],
      wheelSlip: [...this.tires.wheelSlip] as [number, number, number, number],
      pitchDeg: Number(pitchDeg.toFixed(1)),
      rollDeg: Number(rollDeg.toFixed(1)),
      isLugging: this.isLugging,
      isRevLimiting: this.isRevLimiting,
      isAirborne,
      posX: this.position.x,
      posZ: this.position.z,
      headingDeg: Math.round(headingDeg),
      distanceKm: Number((this.distanceMeters / 1000).toFixed(2)),
      zoneName: centerTerrain.zoneName,
      damage,
      engineLoad: Number(this.engineLoad.toFixed(2)),
      boostBar: Number(this.boostBar.toFixed(2)),
      engineTempC: Math.round(this.engine.engineTempC),
      absActive: this.absActive,
      lateralG: Number(this.lateralG.toFixed(2)),
      longitudinalG: Number(this.longitudinalG.toFixed(2)),
      selfAligningTorqueNm: Math.round(this.steering.selfAligningTorqueNm),
      steeringAnglesDeg: [
        Number(THREE.MathUtils.radToDeg(this.steering.wheelAnglesRad[0]).toFixed(1)),
        Number(THREE.MathUtils.radToDeg(this.steering.wheelAnglesRad[1]).toFixed(1)),
      ],
      wheelRpm: [
        Math.round((this.tires.wheelAngularVel[0] * 60) / (2 * Math.PI)),
        Math.round((this.tires.wheelAngularVel[1] * 60) / (2 * Math.PI)),
        Math.round((this.tires.wheelAngularVel[2] * 60) / (2 * Math.PI)),
        Math.round((this.tires.wheelAngularVel[3] * 60) / (2 * Math.PI)),
      ],
      slipRatio: [
        Number(this.tires.slipRatio[0].toFixed(2)),
        Number(this.tires.slipRatio[1].toFixed(2)),
        Number(this.tires.slipRatio[2].toFixed(2)),
        Number(this.tires.slipRatio[3].toFixed(2)),
      ],
      slipAngleDeg: [
        Number(this.tires.slipAngleDeg[0].toFixed(1)),
        Number(this.tires.slipAngleDeg[1].toFixed(1)),
        Number(this.tires.slipAngleDeg[2].toFixed(1)),
        Number(this.tires.slipAngleDeg[3].toFixed(1)),
      ],
      normalLoadN: [
        Math.round(this.suspension.normalLoads[0]),
        Math.round(this.suspension.normalLoads[1]),
        Math.round(this.suspension.normalLoads[2]),
        Math.round(this.suspension.normalLoads[3]),
      ],
      tireForceLongN: [
        Math.round(this.tires.forceLongN[0]),
        Math.round(this.tires.forceLongN[1]),
        Math.round(this.tires.forceLongN[2]),
        Math.round(this.tires.forceLongN[3]),
      ],
      tireForceLatN: [
        Math.round(this.tires.forceLatN[0]),
        Math.round(this.tires.forceLatN[1]),
        Math.round(this.tires.forceLatN[2]),
        Math.round(this.tires.forceLatN[3]),
      ],
      tireTempC: [
        Math.round(this.tires.tireTempC[0]),
        Math.round(this.tires.tireTempC[1]),
        Math.round(this.tires.tireTempC[2]),
        Math.round(this.tires.tireTempC[3]),
      ],
      tireWear: [
        Number(this.tires.tireWear[0].toFixed(3)),
        Number(this.tires.tireWear[1].toFixed(3)),
        Number(this.tires.tireWear[2].toFixed(3)),
        Number(this.tires.tireWear[3].toFixed(3)),
      ],
      brakeTempC: [
        Math.round(this.brakes.brakeTempC[0]),
        Math.round(this.brakes.brakeTempC[1]),
        Math.round(this.brakes.brakeTempC[2]),
        Math.round(this.brakes.brakeTempC[3]),
      ],
      perf: {
        physicsStepMs: Math.round(this.perfMonitor.physicsStepMs * 100) / 100,
        renderFps: this.perfMonitor.renderFps,
        overloadActive: this.perfMonitor.overloadActive,
        substepsLastFrame: this.perfMonitor.substepsLastFrame,
      },
    };
  }
}
