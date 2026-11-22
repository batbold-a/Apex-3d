import * as THREE from 'three';
import { CarSpec, VehicleTuningSetup } from '../../types/vehicle';
import { RapierWorldManager } from '../rapierWorld';
import { sampleTerrain, TerrainSample } from '../terrain';

const WHEEL_LAYOUT: readonly [number, number, boolean][] = [
  [-1, -1, true], // 0: FL
  [1, -1, true], // 1: FR
  [-1, 1, false], // 2: RL
  [1, 1, false], // 3: RR
];

const _mountLocal = new THREE.Vector3();
const _mountWorld = new THREE.Vector3();
const _relPos = new THREE.Vector3();
const _crossTmp = new THREE.Vector3();
const _wheelVel = new THREE.Vector3();
const _forceVec = new THREE.Vector3();

/**
 * 4-Corner Progressive Spring-Damper + Asymmetric Bump/Rebound + Tunable Bump-Stop + Anti-Roll Bar Solver.
 * Applies all vertical strut and sway-bar forces directly into Rapier via addForceAtPoint.
 */
export class SuspensionModule {
  public readonly compression: [number, number, number, number] = [0, 0, 0, 0];
  public readonly prevCompression: [number, number, number, number] = [0, 0, 0, 0];
  public readonly offsetY: [number, number, number, number] = [0, 0, 0, 0];
  public readonly groundContact: [boolean, boolean, boolean, boolean] = [true, true, true, true];
  public readonly normalLoads: [number, number, number, number] = [0, 0, 0, 0];
  public readonly terrain: TerrainSample[] = [];
  public readonly springVecs: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];

  public groundedCount = 4;
  public totalNormalLoad = 0;

  public reset(car: CarSpec, staticSag: number, mountY: number, ground: TerrainSample): void {
    for (let i = 0; i < 4; i++) {
      this.compression[i] = staticSag;
      this.prevCompression[i] = staticSag;
      this.offsetY[i] = mountY - (car.suspensionRestLength - staticSag);
      this.groundContact[i] = true;
      this.normalLoads[i] = (car.massKg * 9.81) * 0.25;
      this.terrain[i] = ground;
      this.springVecs[i].set(0, this.normalLoads[i], 0);
    }
    this.groundedCount = 4;
    this.totalNormalLoad = car.massKg * 9.81;
  }

  public step(
    dt: number,
    rapier: RapierWorldManager,
    car: CarSpec,
    tuning: VehicleTuningSetup,
    chassisPos: THREE.Vector3,
    chassisQuat: THREE.Quaternion,
    velocity: THREE.Vector3,
    angularVelocity: THREE.Vector3,
    carUp: THREE.Vector3,
    suspensionDamage: [number, number, number, number],
    onSlamImpact: (wheelIdx: number, compVel: number) => void
  ): void {
    const hx = car.trackWidth * 0.5;
    const hz = car.wheelbase * 0.5;
    const mountLocalY = car.suspensionRestLength * 0.35;
    const restLen = Math.max(0.14, car.suspensionRestLength + tuning.rideHeightOffsetM);
    const staticSag = (car.massKg * 9.81) / 4 / car.springStiffness;
    const archClearance = car.bodyStyle === 'suv' ? 0.14 : 0.085;
    // Keep >= 2.5 cm clearance below carved wheel-arch cutout (and >= 1.5 cm inside inner wheel-well liner)
    const minArchHitLen = Math.max(
      0.04,
      car.suspensionRestLength - staticSag - (archClearance - 0.005)
    );
    const hardBumpHitLen = minArchHitLen + 0.015;
    const maxBumpStopK = tuning.bumpStopStiffness;
    const bumpStopC = 14000;

    this.groundedCount = 0;
    this.totalNormalLoad = 0;

    for (let i = 0; i < 4; i++) {
      const lx = WHEEL_LAYOUT[i][0] * hx;
      const lz = WHEEL_LAYOUT[i][1] * hz;
      const isFront = WHEEL_LAYOUT[i][2];

      _mountLocal.set(lx, mountLocalY, lz);
      _mountWorld.copy(_mountLocal).applyQuaternion(chassisQuat).add(chassisPos);

      const sample = sampleTerrain(_mountWorld.x, _mountWorld.z);
      this.terrain[i] = sample;

      const upDotNormal = Math.max(
        0.5,
        carUp.x * sample.normalX + carUp.y * sample.normalY + carUp.z * sample.normalZ
      );
      const distToGround = (_mountWorld.y - sample.height) * sample.normalY;
      const hitLen = (distToGround - car.wheelRadius) / upDotNormal;

      this.prevCompression[i] = this.compression[i];
      const wasGrounded = this.groundContact[i];

      if (hitLen < restLen) {
        this.groundedCount++;
        this.groundContact[i] = true;
        const comp = Math.max(0, Math.min(restLen, restLen - hitLen));
        this.compression[i] = comp;

        const clampedHit = Math.max(minArchHitLen, hitLen);
        this.offsetY[i] = mountLocalY - clampedHit;

        // Compression velocity from rigid-body velocity at strut top mount
        _relPos.copy(_mountWorld).sub(chassisPos);
        _crossTmp.crossVectors(angularVelocity, _relPos);
        _wheelVel.copy(velocity).add(_crossTmp);
        const mountNormalVel =
          _wheelVel.x * sample.normalX +
          _wheelVel.y * sample.normalY +
          _wheelVel.z * sample.normalZ;
        const compVel = -mountNormalVel;

        const effectiveMaxTravel = Math.max(0.06, restLen - minArchHitLen);
        const travelRatio = comp / effectiveMaxTravel;
        if (!wasGrounded && compVel > 5.8 && travelRatio > 0.92 && velocity.y < -4.5) {
          onSlamImpact(i, compVel);
        }

        const suspDmg = suspensionDamage[i];
        const springScale = isFront ? tuning.springRateScaleFront : tuning.springRateScaleRear;
        const baseK = car.springStiffness * springScale * (1 - suspDmg * 0.44);
        const progressiveK = baseK * (1 + 0.55 * Math.min(1.4, travelRatio * travelRatio));

        const baseDamper =
          compVel >= 0
            ? car.damperBump * tuning.damperBumpScale
            : car.damperRebound * tuning.damperReboundScale;
        const effDamper = baseDamper * (1 - suspDmg * 0.58);

        let bumpStopForce = travelRatio > 0.85 ? (travelRatio - 0.85) * baseK * 3.8 : 0;
        if (hitLen < hardBumpHitLen) {
          const pen = hardBumpHitLen - hitLen;
          bumpStopForce +=
            pen * Math.max(maxBumpStopK, baseK * 4.2) + Math.max(0, compVel) * bumpStopC;
        }

        // Physical damper piston seal stiction at sub-2mm/s quantization creep (zero effect during driving & normal settling)
        const vNorm = compVel / 0.0018;
        const vNorm2 = vNorm * vNorm;
        const sealFade = Math.exp(-(vNorm2 * vNorm2));
        const sealGain = (0.85 * car.massKg * 0.25) / Math.max(dt, 1 / 240);
        const sealForce = THREE.MathUtils.clamp(compVel * sealGain, -45, 45) * sealFade;

        const springForce = Math.max(
          0,
          progressiveK * comp + effDamper * compVel + bumpStopForce + sealForce
        );
        this.normalLoads[i] = springForce;
        this.totalNormalLoad += springForce;

        _forceVec
          .set(sample.normalX, sample.normalY, sample.normalZ)
          .lerp(carUp, 0.3)
          .normalize()
          .multiplyScalar(springForce);
        this.springVecs[i].copy(_forceVec);

        rapier.addForceAtPoint(
          _forceVec.x,
          _forceVec.y,
          _forceVec.z,
          _mountWorld.x,
          _mountWorld.y,
          _mountWorld.z
        );
      } else {
        this.groundContact[i] = false;
        this.compression[i] = Math.max(0, this.compression[i] - dt * 3.2);
        this.offsetY[i] = mountLocalY - restLen;
        this.normalLoads[i] = 0;
        this.springVecs[i].set(0, 0, 0);
      }
    }

    // Tunable Front & Rear Anti-Roll Bars applied as genuine opposing chassis mount forces + tire normal-load transfer
    const applyArb = (idxL: number, idxR: number, lz: number, arbStiffness: number) => {
      if (!this.groundContact[idxL] && !this.groundContact[idxR]) return;
      const diff = this.compression[idxL] - this.compression[idxR];
      const antiRollForce = diff * arbStiffness;

      if (this.groundContact[idxL]) {
        this.normalLoads[idxL] = Math.max(0, this.normalLoads[idxL] + antiRollForce);
      }
      if (this.groundContact[idxR]) {
        this.normalLoads[idxR] = Math.max(0, this.normalLoads[idxR] - antiRollForce);
      }

      _mountLocal.set(-hx, mountLocalY, lz);
      _mountWorld.copy(_mountLocal).applyQuaternion(chassisQuat).add(chassisPos);
      rapier.addForceAtPoint(
        carUp.x * antiRollForce,
        carUp.y * antiRollForce,
        carUp.z * antiRollForce,
        _mountWorld.x,
        _mountWorld.y,
        _mountWorld.z
      );

      _mountLocal.set(hx, mountLocalY, lz);
      _mountWorld.copy(_mountLocal).applyQuaternion(chassisQuat).add(chassisPos);
      rapier.addForceAtPoint(
        -carUp.x * antiRollForce,
        -carUp.y * antiRollForce,
        -carUp.z * antiRollForce,
        _mountWorld.x,
        _mountWorld.y,
        _mountWorld.z
      );
    };

    applyArb(0, 1, -hz, tuning.antiRollFrontNmPerM);
    applyArb(2, 3, hz, tuning.antiRollRearNmPerM);
    this.totalNormalLoad =
      this.normalLoads[0] + this.normalLoads[1] + this.normalLoads[2] + this.normalLoads[3];
  }
}
