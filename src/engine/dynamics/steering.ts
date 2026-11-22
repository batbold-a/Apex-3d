import * as THREE from 'three';
import { CarSpec, VehicleTuningSetup } from '../../types/vehicle';

export interface SteeringOutput {
  centerSteerRad: number;
  wheelAnglesRad: [number, number, number, number]; // FL, FR, RL, RR
  camberRad: [number, number, number, number];
  selfAligningTorqueNm: number;
}

/**
 * Ackermann steering geometry, speed-sensitive ratio, caster/camber/toe kinematics,
 * suspension alignment pull, and self-aligning torque (M_z) return/countersteer feel.
 */
export class SteeringModule {
  public centerSteerRad = 0;
  public selfAligningTorqueNm = 0;

  public readonly wheelAnglesRad: [number, number, number, number] = [0, 0, 0, 0];
  public readonly camberRad: [number, number, number, number] = [0, 0, 0, 0];

  public reset(): void {
    this.centerSteerRad = 0;
    this.selfAligningTorqueNm = 0;
    this.wheelAnglesRad[0] = 0;
    this.wheelAnglesRad[1] = 0;
    this.wheelAnglesRad[2] = 0;
    this.wheelAnglesRad[3] = 0;
    this.camberRad[0] = 0;
    this.camberRad[1] = 0;
    this.camberRad[2] = 0;
    this.camberRad[3] = 0;
  }

  public step(
    car: CarSpec,
    tuning: VehicleTuningSetup,
    steerSmooth: number,
    absSpeed: number,
    chassisRollRad: number,
    wheelCompression: readonly [number, number, number, number],
    suspensionDamage: readonly [number, number, number, number],
    frontMzLeftNm: number,
    frontMzRightNm: number,
    driftMode = false,
    yawRateRad = 0,
    lateralSpeedMs = 0,
    forwardSpeed = absSpeed
  ): SteeringOutput {
    // Speed-sensitive steering ratio: full lock at parking speeds, peak-grip bite (~7.5-9.5 deg) at 80 km/h, calm 2.5-4.5 deg at 180+ km/h
    const effectiveSpeed = Math.max(0, absSpeed - 3.5);
    const speedRef =
      car.bodyStyle === 'suv'
        ? 6.5
        : car.bodyStyle === 'rally'
          ? 6.1
          : car.bodyStyle === 'muscle'
            ? 5.15
            : 7.8;
    const speedSteerFactor = 1 / (1 + Math.pow(effectiveSpeed / speedRef, 1.45));
    const highSpeedFloor =
      car.bodyStyle === 'suv'
        ? 0.056
        : car.bodyStyle === 'rally'
          ? 0.064
          : car.bodyStyle === 'muscle'
            ? 0.052
            : 0.088;
    const baseSteerCurve = highSpeedFloor + (1 - highSpeedFloor) * speedSteerFactor;
    const lowSpeedBonus = 1 + 0.18 * Math.max(0, 1 - absSpeed / 7.0);

    const alignmentPullRad = THREE.MathUtils.degToRad(
      (suspensionDamage[0] - suspensionDamage[1]) * 7.5
    );

    const isForward = absSpeed > 3.2 && forwardSpeed > -1.5;

    // Self-aligning torque naturally centers/countersteers when hands release the wheel (disabled in reverse or tiny straight-line noise)
    const totalMz = frontMzLeftNm + frontMzRightNm;
    this.selfAligningTorqueNm = totalMz;
    const mzSteerAssist =
      forwardSpeed > 4.0 && Math.abs(steerSmooth) < 0.12 && Math.abs(totalMz) > 12
        ? THREE.MathUtils.clamp(-totalMz * 0.00028, -0.1, 0.1)
        : 0;

    // Authentic Drift Countersteer Lock & Assist:
    // Moving left (+yaw, tail out right) gives velocity rightward relative to nose (lateralSpeedMs > 0).
    // Countersteer must turn RIGHT (-steerRad) to point front tires down velocity vector: targetCounter = -atan2(vLat, vFwd).
    const slideAngleRad = isForward
      ? Math.atan2(lateralSpeedMs, Math.max(2.5, forwardSpeed))
      : 0;
    const targetCounterRad = -slideAngleRad;
    const slideFactor = isForward
      ? THREE.MathUtils.clamp((Math.abs(slideAngleRad) - 0.045) / 0.2, 0, 1)
      : 0;
    const isCountersteering = steerSmooth * targetCounterRad > 0.02;

    // Unlock front steering knuckle travel up to ~45 deg when drifting/countersteering so front wheels point into the slide
    // while keeping straight-line highway steering (slideFactor = 0) at the calm speed-sensitive ratio!
    const activeSteerCurve =
      slideFactor > 0 && (driftMode || isCountersteering)
        ? THREE.MathUtils.lerp(baseSteerCurve, 1.0, slideFactor * (isCountersteering ? 1.0 : 0.68))
        : baseSteerCurve;

    const baseMaxSteerRad =
      THREE.MathUtils.degToRad(car.maxSteerDeg) / Math.max(0.65, tuning.steeringRatioScale);
    const driftMaxSteerRad =
      THREE.MathUtils.degToRad(Math.max(car.maxSteerDeg + 6, 40)) /
      Math.max(0.75, tuning.steeringRatioScale);
    const maxSteerRad =
      slideFactor > 0 && (driftMode || isCountersteering)
        ? THREE.MathUtils.lerp(baseMaxSteerRad, driftMaxSteerRad, slideFactor)
        : baseMaxSteerRad;

    let driftCounterAssist = 0;
    if (driftMode && forwardSpeed > 3.5 && absSpeed > 5.0 && slideFactor > 0.01) {
      const desiredCounter = THREE.MathUtils.clamp(
        targetCounterRad * 0.94 - yawRateRad * 0.22,
        -0.68,
        0.68
      );
      driftCounterAssist = desiredCounter * slideFactor * (1 - Math.abs(steerSmooth) * 0.35);
    }

    const centerSteer =
      maxSteerRad * steerSmooth * activeSteerCurve * lowSpeedBonus +
      alignmentPullRad +
      mzSteerAssist +
      driftCounterAssist;
    this.centerSteerRad = THREE.MathUtils.clamp(centerSteer, -0.7, 0.7);

    // True Ackermann geometry: inner wheel turns sharper than outer wheel around common turn center
    let flSteer = this.centerSteerRad;
    let frSteer = this.centerSteerRad;
    if (Math.abs(this.centerSteerRad) > 1e-4) {
      const turnRadius = car.wheelbase / Math.tan(Math.abs(this.centerSteerRad));
      const halfTrack = car.trackWidth * 0.5;
      const inner = Math.atan(car.wheelbase / Math.max(0.45, turnRadius - halfTrack));
      const outer = Math.atan(car.wheelbase / (turnRadius + halfTrack));
      if (this.centerSteerRad > 0) {
        // Turning Left (+steerRad): FL is inner, FR is outer
        flSteer = inner;
        frSteer = outer;
      } else {
        // Turning Right (-steerRad): FR is inner, FL is outer
        flSteer = -outer;
        frSteer = -inner;
      }
    }

    // Static Toe (+ = toe-in: left wheels turn inward -Y, right wheels turn inward +Y)
    const fToe = THREE.MathUtils.degToRad(tuning.frontToeDeg);
    const rToe = THREE.MathUtils.degToRad(tuning.rearToeDeg);
    this.wheelAnglesRad[0] = flSteer - fToe;
    this.wheelAnglesRad[1] = frSteer + fToe;
    this.wheelAnglesRad[2] = -rToe;
    this.wheelAnglesRad[3] = rToe;

    // Dynamic Camber inclination angle (positive = top of wheel tilted OUTWARD from car center)
    // Negative static camber tilts top of wheel INWARD (- for right/left normalized consistently)
    const fStatic = THREE.MathUtils.degToRad(tuning.frontCamberDeg);
    const rStatic = THREE.MathUtils.degToRad(tuning.rearCamberDeg);
    const casterSin = Math.sin(THREE.MathUtils.degToRad(tuning.casterDeg));

    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const isRight = i === 1 || i === 3;
      const staticC = isFront ? fStatic : rStatic;
      const compNorm = Math.min(1.2, wheelCompression[i] / Math.max(0.05, car.suspensionMaxTravel));
      // Negative bump camber gain increases negative camber under compression
      const bumpGain = -0.018 * compNorm;
      const dmgTilt = suspensionDamage[i] * 0.14;
      // Chassis roll tilts wheels with body: body leans right (_carRight.y < 0) -> outside right wheel gains positive camber
      const rollContrib = (isRight ? -1 : 1) * chassisRollRad * 0.85;
      // Caster camber gain when steered
      const casterContrib = isFront ? (isRight ? -1 : 1) * Math.sin(this.wheelAnglesRad[i]) * casterSin : 0;

      // Normalize left/right camber sign so negative static camber always generates inward cornering camber thrust
      const signedCamber = staticC + bumpGain + rollContrib + casterContrib + dmgTilt;
      this.camberRad[i] = isRight ? signedCamber : -signedCamber;
    }

    return {
      centerSteerRad: this.centerSteerRad,
      wheelAnglesRad: this.wheelAnglesRad,
      camberRad: this.camberRad,
      selfAligningTorqueNm: this.selfAligningTorqueNm,
    };
  }
}
