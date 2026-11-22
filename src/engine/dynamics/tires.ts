import * as THREE from 'three';
import { CarSpec, TireCompoundId, VehicleTuningSetup } from '../../types/vehicle';
import { RapierWorldManager } from '../rapierWorld';
import { TerrainSample } from '../terrain';

export interface TireCompoundSpec {
  id: TireCompoundId;
  label: string;
  muPeakAsphalt: number;
  Bx: number;
  Cx: number;
  Ex: number;
  By: number;
  Cy: number;
  Ey: number;
  relaxLenX: number;
  relaxLenY: number;
  loadSensitivityLambda: number;
  camberStiffness: number;
  optTempC: number;
  tempSpanC: number;
  rollResMult: number;
  offroadGripBonus: number;
  wearRate: number;
}

export const TIRE_COMPOUNDS: Record<TireCompoundId, TireCompoundSpec> = {
  street: {
    id: 'street',
    label: 'All-Season Street',
    muPeakAsphalt: 0.96,
    Bx: 11.2,
    Cx: 1.48,
    Ex: -0.25,
    By: 10.6,
    Cy: 1.36,
    Ey: -0.42,
    relaxLenX: 0.32,
    relaxLenY: 0.44,
    loadSensitivityLambda: 0.14,
    camberStiffness: 0.36,
    optTempC: 62,
    tempSpanC: 48,
    rollResMult: 1.0,
    offroadGripBonus: 0.0,
    wearRate: 0.7,
  },
  sport: {
    id: 'sport',
    label: 'Ultra-High Performance',
    muPeakAsphalt: 1.09,
    Bx: 12.6,
    Cx: 1.36,
    Ex: -0.36,
    By: 11.6,
    Cy: 1.4,
    Ey: -0.52,
    relaxLenX: 0.27,
    relaxLenY: 0.36,
    loadSensitivityLambda: 0.15,
    camberStiffness: 0.48,
    optTempC: 76,
    tempSpanC: 46,
    rollResMult: 1.05,
    offroadGripBonus: -0.04,
    wearRate: 1.0,
  },
  'semi-slick': {
    id: 'semi-slick',
    label: 'Track Semi-Slick',
    muPeakAsphalt: 1.24,
    Bx: 14.0,
    Cx: 1.38,
    Ex: -0.34,
    By: 12.2,
    Cy: 1.62,
    Ey: 0.02,
    relaxLenX: 0.22,
    relaxLenY: 0.29,
    loadSensitivityLambda: 0.16,
    camberStiffness: 0.62,
    optTempC: 84,
    tempSpanC: 46,
    rollResMult: 1.12,
    offroadGripBonus: -0.14,
    wearRate: 1.45,
  },
  'offroad-at': {
    id: 'offroad-at',
    label: 'All-Terrain Rally',
    muPeakAsphalt: 0.9,
    Bx: 10.5,
    Cx: 1.42,
    Ex: -0.35,
    By: 9.8,
    Cy: 1.32,
    Ey: -0.45,
    relaxLenX: 0.38,
    relaxLenY: 0.54,
    loadSensitivityLambda: 0.11,
    camberStiffness: 0.28,
    optTempC: 58,
    tempSpanC: 55,
    rollResMult: 1.18,
    offroadGripBonus: 0.22,
    wearRate: 0.85,
  },
  'mud-terrain': {
    id: 'mud-terrain',
    label: 'Extreme Mud & Rock',
    muPeakAsphalt: 0.8,
    Bx: 9.4,
    Cx: 1.38,
    Ex: -0.4,
    By: 8.6,
    Cy: 1.28,
    Ey: -0.5,
    relaxLenX: 0.44,
    relaxLenY: 0.64,
    loadSensitivityLambda: 0.09,
    camberStiffness: 0.22,
    optTempC: 55,
    tempSpanC: 60,
    rollResMult: 1.32,
    offroadGripBonus: 0.34,
    wearRate: 0.9,
  },
};

const WHEEL_LAYOUT: readonly [number, number, boolean][] = [
  [-1, -1, true], // 0: FL
  [1, -1, true], // 1: FR
  [-1, 1, false], // 2: RL
  [1, 1, false], // 3: RR
];

// Pre-allocated scratch helpers (zero GC inside 120 Hz loop)
const _wForward = new THREE.Vector3();
const _wRight = new THREE.Vector3();
const _mountLocal = new THREE.Vector3();
const _mountWorld = new THREE.Vector3();
const _patchWorld = new THREE.Vector3();
const _wheelVel = new THREE.Vector3();
const _crossTmp = new THREE.Vector3();
const _forceVec = new THREE.Vector3();

function magicFormula(x: number, B: number, C: number, D: number, E: number): number {
  const bx = B * x;
  const inner = bx - E * (bx - Math.atan(bx));
  return D * Math.sin(C * Math.atan(inner));
}

/**
 * Combined-Slip Transient Pacejka Tire Solver:
 * - Individual wheel rotational inertia (I_w) with implicit stabilization
 * - Transient relaxation length carcass lag (L_rx, L_ry)
 * - Degressive vertical load sensitivity mu(F_z)
 * - Coupled combined-slip weighting (G_x_alpha, G_y_kappa)
 * - Camber thrust & pneumatic-trail self-aligning torque (M_z)
 * - Surface-aware thermals, pressure curve & tread wear
 */
export class TireModule {
  public readonly wheelAngularVel: [number, number, number, number] = [0, 0, 0, 0];
  public readonly wheelSpinAngle: [number, number, number, number] = [0, 0, 0, 0];
  public readonly wheelSlip: [number, number, number, number] = [0, 0, 0, 0];
  public readonly slipRatio: [number, number, number, number] = [0, 0, 0, 0];
  public readonly slipAngleDeg: [number, number, number, number] = [0, 0, 0, 0];
  public readonly relaxSlipX: [number, number, number, number] = [0, 0, 0, 0];
  public readonly relaxSlipY: [number, number, number, number] = [0, 0, 0, 0];
  public readonly forceLongN: [number, number, number, number] = [0, 0, 0, 0];
  public readonly forceLatN: [number, number, number, number] = [0, 0, 0, 0];
  public readonly aligningTorqueNm: [number, number, number, number] = [0, 0, 0, 0];
  public readonly tireTempC: [number, number, number, number] = [68, 68, 68, 68];
  public readonly tireWear: [number, number, number, number] = [0, 0, 0, 0];

  public reset(): void {
    for (let i = 0; i < 4; i++) {
      this.wheelAngularVel[i] = 0;
      this.wheelSlip[i] = 0;
      this.slipRatio[i] = 0;
      this.slipAngleDeg[i] = 0;
      this.relaxSlipX[i] = 0;
      this.relaxSlipY[i] = 0;
      this.forceLongN[i] = 0;
      this.forceLatN[i] = 0;
      this.aligningTorqueNm[i] = 0;
      this.tireTempC[i] = 68;
      this.tireWear[i] = 0;
    }
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
    carForward: THREE.Vector3,
    carRight: THREE.Vector3,
    carUp: THREE.Vector3,
    gearIndex: number,
    throttleSmooth: number,
    handbrakeSmooth: number,
    diffLockActive: boolean,
    wheelSteerAngles: readonly [number, number, number, number],
    camberRad: readonly [number, number, number, number],
    wheelTorque: readonly [number, number, number, number],
    brakeTorqueNm: readonly [number, number, number, number],
    wheelOffsetY: readonly [number, number, number, number],
    groundContact: readonly [boolean, boolean, boolean, number | boolean],
    normalLoads: readonly [number, number, number, number],
    springVecs: readonly THREE.Vector3[],
    terrainSamples: readonly TerrainSample[],
    groundedCount: number,
    totalNormalLoad: number,
    suspensionDamage: readonly [number, number, number, number],
    driftMode = false
  ): void {
    const compound = TIRE_COMPOUNDS[tuning.tireCompound];
    const hx = car.trackWidth * 0.5;
    const hz = car.wheelbase * 0.5;
    const rEff = car.wheelRadius;
    const absSpeed = velocity.length();

    // Realistic wheel + tire rotational inertia I_w (kg * m^2)
    const wheelMass = car.id === 'g63-4x4' ? 38 : car.bodyStyle === 'suv' ? 34 : 22;
    const wheelInertia = 0.58 * wheelMass * rEff * rEff;
    const nomCornerLoad = car.massKg * 9.81 * 0.25;
    const parkWheelMass = car.massKg / Math.max(1, groundedCount);

    const canHoldSlope = gearIndex !== 0 || carUp.y > 0.985;
    const isParkedRest =
      groundedCount >= 3 && absSpeed < 0.65 && throttleSmooth < 0.05 && canHoldSlope;

    const parkLongPerWheel: [number, number, number, number] = [0, 0, 0, 0];
    const parkLatPerWheel: [number, number, number, number] = [0, 0, 0, 0];
    const parkPeakPerWheel: [number, number, number, number] = [0, 0, 0, 0];
    if (isParkedRest) {
      const parkHeadroom: [number, number, number, number] = [0, 0, 0, 0];
      let excessLong = 0;
      let excessLat = 0;

      for (let k = 0; k < 4; k++) {
        if (!groundContact[k]) continue;
        const loadK = normalLoads[k];
        const cornerMassK =
          totalNormalLoad > 10 ? car.massKg * (loadK / totalNormalLoad) : parkWheelMass;
        const peakK = this.computeCornerPeakForce(
          k,
          car,
          tuning,
          compound,
          loadK,
          nomCornerLoad,
          terrainSamples[k],
          diffLockActive,
          suspensionDamage[k]
        );
        parkPeakPerWheel[k] = peakK;

        _mountLocal.set(WHEEL_LAYOUT[k][0] * hx, wheelOffsetY[k] - rEff, WHEEL_LAYOUT[k][1] * hz);
        _mountWorld.copy(_mountLocal).applyQuaternion(chassisQuat);
        _crossTmp.crossVectors(angularVelocity, _mountWorld);
        _wheelVel.copy(velocity).add(_crossTmp);
        const vPatchFwd = _wheelVel.dot(carForward);
        const vPatchRight = _wheelVel.dot(carRight);

        let fL =
          cornerMassK * 9.81 * carForward.y -
          springVecs[k].dot(carForward) -
          (cornerMassK * vPatchFwd) / (dt * 1.5);
        let fR =
          cornerMassK * 9.81 * carRight.y -
          springVecs[k].dot(carRight) -
          (cornerMassK * vPatchRight) / (dt * 1.5);

        const mag = Math.hypot(fL, fR);
        if (mag > peakK && peakK > 1) {
          const sc = peakK / mag;
          excessLong += fL * (1 - sc);
          excessLat += fR * (1 - sc);
          fL *= sc;
          fR *= sc;
          parkHeadroom[k] = 0;
        } else {
          parkHeadroom[k] = Math.max(0, peakK - mag);
        }
        parkLongPerWheel[k] = fL;
        parkLatPerWheel[k] = fR;
      }

      const totalHeadroom =
        parkHeadroom[0] + parkHeadroom[1] + parkHeadroom[2] + parkHeadroom[3];
      if ((Math.abs(excessLong) > 0.01 || Math.abs(excessLat) > 0.01) && totalHeadroom > 1) {
        for (let k = 0; k < 4; k++) {
          if (parkHeadroom[k] <= 0) continue;
          const share = parkHeadroom[k] / totalHeadroom;
          parkLongPerWheel[k] += excessLong * share;
          parkLatPerWheel[k] += excessLat * share;
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      const lx = WHEEL_LAYOUT[i][0] * hx;
      const lz = WHEEL_LAYOUT[i][1] * hz;
      const isFront = WHEEL_LAYOUT[i][2];
      const terrain = terrainSamples[i];

      const wAngle = wheelSteerAngles[i];
      const cosW = Math.cos(wAngle);
      const sinW = Math.sin(wAngle);
      _wForward.set(-sinW, 0, -cosW).applyQuaternion(chassisQuat);
      _wRight.set(cosW, 0, -sinW).applyQuaternion(chassisQuat);

      const isGrounded = Boolean(groundContact[i]);
      if (!isGrounded) {
        // Free-spinning airborne wheel integrates drive & brake torque against inertia I_w
        const netAirTorque =
          wheelTorque[i] -
          (Math.abs(this.wheelAngularVel[i]) > 0.2
            ? Math.sign(this.wheelAngularVel[i]) * brakeTorqueNm[i]
            : 0);
        this.wheelAngularVel[i] += (netAirTorque / wheelInertia) * dt;
        const maxFreeOmega = (car.maxRpm * 2 * Math.PI) / (60 * Math.max(1.2, Math.abs(car.forwardRatios[0] * tuning.finalDrive)));
        this.wheelAngularVel[i] = THREE.MathUtils.clamp(
          this.wheelAngularVel[i],
          -maxFreeOmega * 1.4,
          maxFreeOmega * 2.2
        );
        if (brakeTorqueNm[i] > 50 && Math.abs(this.wheelAngularVel[i]) < 1.5) {
          this.wheelAngularVel[i] = 0;
        }
        this.wheelSpinAngle[i] += this.wheelAngularVel[i] * dt;
        this.wheelSlip[i] = 0;
        this.slipRatio[i] = 0;
        this.slipAngleDeg[i] = 0;
        this.relaxSlipX[i] *= Math.max(0, 1 - dt * 8);
        this.relaxSlipY[i] *= Math.max(0, 1 - dt * 8);
        this.forceLongN[i] = 0;
        this.forceLatN[i] = 0;
        this.aligningTorqueNm[i] = 0;
        continue;
      }

      const load = normalLoads[i];
      const cornerHoldMass =
        totalNormalLoad > 10 ? car.massKg * (load / totalNormalLoad) : parkWheelMass;

      // Contact patch velocity projected onto ground tangent plane
      _mountLocal.set(lx, wheelOffsetY[i] - rEff, lz);
      _mountWorld.copy(_mountLocal).applyQuaternion(chassisQuat);
      _crossTmp.crossVectors(angularVelocity, _mountWorld);
      _wheelVel.copy(velocity).add(_crossTmp);

      const normalDot =
        _wheelVel.x * terrain.normalX +
        _wheelVel.y * terrain.normalY +
        _wheelVel.z * terrain.normalZ;
      _wheelVel.x -= normalDot * terrain.normalX;
      _wheelVel.y -= normalDot * terrain.normalY;
      _wheelVel.z -= normalDot * terrain.normalZ;

      const vLong = _wheelVel.dot(_wForward);
      const vLat = _wheelVel.dot(_wRight);

      // 1. Degressive Load Sensitivity + Pressure + Thermal + Wear + Surface Grip
      const peakForce = this.computeCornerPeakForce(
        i,
        car,
        tuning,
        compound,
        load,
        nomCornerLoad,
        terrain,
        diffLockActive,
        suspensionDamage[i]
      );

      // 2. Rolling resistance torque (all-terrain / chunky tires have slightly higher asphalt hysteresis)
      const bentDrag = 1 + suspensionDamage[i] * 0.45;
      const treadRollScale =
        terrain.surfaceType === 'asphalt'
          ? 1.0 + car.offroadBias * 0.24
          : 1.22 - car.offroadBias * 0.36;
      const rollResFactor =
        terrain.rollingResistance *
        compound.rollResMult *
        treadRollScale *
        bentDrag;
      const rollResTorque =
        Math.abs(vLong) > 0.08 ? Math.sign(vLong) * load * rollResFactor * rEff : 0;

      // 3. Standstill Coulomb Slope Hold (guarantees zero creep on flat & 25-deg slopes)
      const isBrakingAtRest =
        brakeTorqueNm[i] / rEff > 4 && Math.abs(vLong) <= 0.25 && Math.abs(vLat) <= 0.35;

      if (isParkedRest || isBrakingAtRest) {
        let fLong = 0;
        let fLat = 0;

        if (isParkedRest) {
          fLong = parkLongPerWheel[i];
          fLat = parkLatPerWheel[i];
        } else {
          const slopeCancelLong =
            cornerHoldMass * 9.81 * _wForward.y - springVecs[i].dot(_wForward);
          const dampHold = -(cornerHoldMass * vLong) / (dt * 2.2);
          fLong = slopeCancelLong + dampHold;
          const maxHoldBrake = brakeTorqueNm[i] / rEff;
          fLong = THREE.MathUtils.clamp(fLong, -maxHoldBrake, maxHoldBrake);

          const slopeCancelLat =
            cornerHoldMass * 9.81 * _wRight.y - springVecs[i].dot(_wRight);
          const dampLat = -(cornerHoldMass * vLat) / (dt * 2.2);
          fLat = slopeCancelLat + dampLat;
        }

        const comb = Math.hypot(fLong, fLat);
        if (comb > peakForce && peakForce > 1) {
          const sc = peakForce / comb;
          fLong *= sc;
          fLat *= sc;
        }

        this.wheelAngularVel[i] = 0;
        this.relaxSlipX[i] = 0;
        this.relaxSlipY[i] = 0;
        this.slipRatio[i] = 0;
        this.slipAngleDeg[i] = 0;
        this.wheelSlip[i] = 0;
        this.forceLongN[i] = fLong;
        this.forceLatN[i] = fLat;
        this.aligningTorqueNm[i] = 0;

        if (isParkedRest) {
          _forceVec.copy(carForward).multiplyScalar(fLong).addScaledVector(carRight, fLat);
        } else {
          _forceVec.copy(_wForward).multiplyScalar(fLong).addScaledVector(_wRight, fLat);
        }
        _patchWorld
          .set(lx, 0, lz)
          .applyQuaternion(chassisQuat)
          .add(chassisPos);
        rapier.addForceAtPoint(
          _forceVec.x,
          _forceVec.y,
          _forceVec.z,
          _patchWorld.x,
          _patchWorld.y,
          _patchWorld.z
        );
        continue;
      }

      // 4. Individual Wheel Rotational Dynamics (4 micro-substeps with implicit Pacejka damping)
      const subSteps = 4;
      const subDt = dt / subSteps;
      const vRefLong = Math.max(Math.abs(vLong), 1.4);
      const relaxSpeedRef = Math.max(Math.abs(vLong), Math.abs(this.wheelAngularVel[i] * rEff), 2.5);
      const tauX = compound.relaxLenX / relaxSpeedRef;
      const tauY = compound.relaxLenY / relaxSpeedRef;

      let fLong = 0;
      let fLat = 0;
      let kappaEff = this.relaxSlipX[i];
      let alphaEff = Math.atan(this.relaxSlipY[i]);

      for (let s = 0; s < subSteps; s++) {
        const omega = this.wheelAngularVel[i];
        const vWheel = omega * rEff;
        const kappaRaw = THREE.MathUtils.clamp((vWheel - vLong) / vRefLong, -1.05, 1.35);
        this.relaxSlipX[i] += (kappaRaw - this.relaxSlipX[i]) * Math.min(1, subDt / tauX);
        kappaEff = this.relaxSlipX[i];

        const tanAlphaRaw = THREE.MathUtils.clamp(-vLat / Math.max(Math.abs(vLong), 2.1), -2.5, 2.5);
        this.relaxSlipY[i] += (tanAlphaRaw - this.relaxSlipY[i]) * Math.min(1, subDt / tauY);
        alphaEff = Math.atan(this.relaxSlipY[i]);

        // Combined-slip Pacejka Magic Formula weighting (C < 1.0 guarantees strictly positive weighting)
        const fx0 = magicFormula(kappaEff, compound.Bx, compound.Cx, peakForce, compound.Ex);
        const fy0 = magicFormula(alphaEff, compound.By, compound.Cy, peakForce, compound.Ey);

        const gxa = Math.max(0.15, Math.cos(0.88 * Math.atan(6.5 * alphaEff)));
        const gyk = Math.max(0.18, Math.cos(0.86 * Math.atan(6.2 * kappaEff)));

        // Camber thrust scales with lateral grip & inclination angle
        const camberForce =
          peakForce *
          compound.camberStiffness *
          Math.sin(camberRad[i]) *
          (1 - 0.4 * Math.min(1, Math.abs(kappaEff)));

        // In Grip Mode, handbrake keeps rear stable; Drift Mode lowers rear lateral grip cleanly for sustained controllable slides
        const hbLatFactor = !isFront && handbrakeSmooth > 0.1
          ? 1 - handbrakeSmooth * (driftMode ? 0.34 : 0.14)
          : 1;
        const driftLatFactor = driftMode ? (isFront ? 0.96 : 0.8) : 1.0;

        fLong = fx0 * gxa - rollResTorque / rEff;
        fLat = (fy0 * gyk + camberForce) * hbLatFactor * driftLatFactor;

        // Wheel rotational ODE: omega_dot = (T_drive - T_brake - F_x * R - T_bearing) / I_w
        // Tire hysteresis rolling resistance acts at the contact patch (fLong), while bearing drag is ~15% parasitic loss
        const fxReactionTorque = fx0 * gxa * rEff;
        const driveNet = wheelTorque[i] - fxReactionTorque - rollResTorque * 0.15;

        // Implicit longitudinal stiffness stabilization around current omega (prevents low-speed chatter with zero steady-state torque loss)
        const slopeStiffness = Math.max(0, 1 - Math.abs(kappaEff) * 4) * peakForce * compound.Bx * 0.25;
        const kRot = (slopeStiffness * rEff * rEff) / Math.max(2.2, Math.abs(vLong));
        const denom = 1 + (subDt * kRot) / wheelInertia;

        let nextOmega = omega + (subDt * driveNet) / (wheelInertia * denom);

        // Brake friction torque opposes wheel spin and clamps cleanly to 0 on lockup
        const bTorque = brakeTorqueNm[i];
        if (bTorque > 1) {
          const brakeDelta = (bTorque / wheelInertia) * subDt;
          if (Math.abs(nextOmega) <= brakeDelta && Math.abs(driveNet) < bTorque) {
            nextOmega = 0;
          } else {
            const bSign = Math.abs(nextOmega) > 0.05 ? Math.sign(nextOmega) : Math.sign(vLong);
            nextOmega -= bSign * brakeDelta;
          }
        }

        // Physical drivetrain speed bound
        this.wheelAngularVel[i] = THREE.MathUtils.clamp(nextOmega, -260, 320);
      }

      // Low-speed lateral stabilization bound so high-frequency numerical chatter never occurs
      const maxStableLat = (cornerHoldMass * Math.abs(vLat)) / Math.max(dt * 1.4, 0.016) + peakForce * 0.35;
      if (Math.abs(fLat) > maxStableLat && absSpeed < 3.5) {
        fLat = Math.sign(fLat) * maxStableLat;
      }

      // 5. Self-Aligning Torque (M_z = -t(alpha) * F_y) via decaying pneumatic trail
      const pneumaticTrail = 0.052 * rEff * Math.exp(-Math.abs(alphaEff) / 0.14);
      const mz = -pneumaticTrail * fLat;
      this.aligningTorqueNm[i] = mz;

      // 6. Telemetry Slip, Thermals & Wear
      const instantKappa = THREE.MathUtils.clamp(
        (this.wheelAngularVel[i] * rEff - vLong) / Math.max(Math.abs(vLong), 1.0),
        -1.0,
        1.5
      );
      this.slipRatio[i] = instantKappa;
      this.slipAngleDeg[i] = THREE.MathUtils.radToDeg(alphaEff);

      const slipCombined = Math.hypot(
        Math.abs(kappaEff) * 1.15,
        Math.abs(alphaEff) / 0.16
      );
      const slipNorm = THREE.MathUtils.clamp(slipCombined * 0.55, 0, 1.5);
      this.wheelSlip[i] = slipNorm;
      this.forceLongN[i] = fLong;
      this.forceLatN[i] = fLat;

      const slipPowerW =
        Math.abs(fLong * (this.wheelAngularVel[i] * rEff - vLong)) + Math.abs(fLat * vLat);
      const coolTargetC = 28 + Math.min(25, absSpeed * 0.45);
      const dTireTemp =
        (slipPowerW * 0.00042 - (this.tireTempC[i] - coolTargetC) * (0.04 + absSpeed * 0.004)) * dt;
      this.tireTempC[i] = THREE.MathUtils.clamp(this.tireTempC[i] + dTireTemp, 24, 155);

      if (slipNorm > 0.35 && absSpeed > 3) {
        this.tireWear[i] = Math.min(
          1,
          this.tireWear[i] + compound.wearRate * slipNorm * 0.00018 * dt
        );
      }

      // 7. Apply longitudinal tire force at ground contact patch (authentic squat & brake dive)
      //    and lateral force at suspension roll-center height (authentic body roll without rollover)
      const contactPatchY = wheelOffsetY[i] - rEff * 0.85;
      _forceVec.copy(_wForward).multiplyScalar(fLong);
      _patchWorld
        .set(lx, contactPatchY, lz)
        .applyQuaternion(chassisQuat)
        .add(chassisPos);
      rapier.addForceAtPoint(
        _forceVec.x,
        _forceVec.y,
        _forceVec.z,
        _patchWorld.x,
        _patchWorld.y,
        _patchWorld.z
      );

      const tirePatchY = wheelOffsetY[i] - rEff * 0.45;
      const rollCenterScale = car.bodyStyle === 'suv' ? 0.28 : 0.56;
      const rollCenterLeverY = tirePatchY * rollCenterScale;
      _forceVec.copy(_wRight).multiplyScalar(fLat);
      _patchWorld
        .set(lx, rollCenterLeverY, lz)
        .applyQuaternion(chassisQuat)
        .add(chassisPos);
      rapier.addForceAtPoint(
        _forceVec.x,
        _forceVec.y,
        _forceVec.z,
        _patchWorld.x,
        _patchWorld.y,
        _patchWorld.z
      );

      this.wheelSpinAngle[i] += this.wheelAngularVel[i] * dt;
    }
  }

  private computeCornerPeakForce(
    wheelIndex: number,
    car: CarSpec,
    tuning: VehicleTuningSetup,
    compound: TireCompoundSpec,
    load: number,
    nomCornerLoad: number,
    terrain: TerrainSample,
    diffLockActive: boolean,
    suspDamage: number
  ): number {
    const isFront = WHEEL_LAYOUT[wheelIndex][2];
    const loadRatio = THREE.MathUtils.clamp(load / Math.max(400, nomCornerLoad), 0.65, 2.2);
    const loadSens = Math.pow(loadRatio, -compound.loadSensitivityLambda);

    const psi = isFront ? tuning.tirePressurePsiFront : tuning.tirePressurePsiRear;
    const psiFactor = 1 - Math.min(0.14, Math.abs(psi - 32) * 0.008);
    const tempDelta = (this.tireTempC[wheelIndex] - compound.optTempC) / compound.tempSpanC;
    const tempFactor = 0.93 + 0.08 * Math.exp(-tempDelta * tempDelta * 1.4);
    const wearFactor = 1 - this.tireWear[wheelIndex] * 0.22;
    const wheelGripHealth = 1 - suspDamage * 0.34;

    const surfaceMult =
      terrain.surfaceType === 'asphalt'
        ? 1.0
        : THREE.MathUtils.clamp(
            0.74 + car.offroadBias * 0.28 + compound.offroadGripBonus,
            0.45,
            1.18
          ) * (diffLockActive ? 1.15 : 1.0);

    // Staggered wider rear contact patch on Porsche 911 GT3 RS (335/30 rear vs 275/35 front)
    const staggeredWidthMult = !isFront && car.id === 'gt3-rs' ? 1.08 : 1.0;

    const baseMu =
      (car.tireGrip * 0.48 + compound.muPeakAsphalt * 0.56) *
      terrain.grip *
      surfaceMult *
      loadSens *
      psiFactor *
      tempFactor *
      wearFactor *
      wheelGripHealth *
      staggeredWidthMult;

    return load * baseMu;
  }
}
