import { CarSpec, VehicleTuningSetup } from '../../types/vehicle';

export interface DrivetrainOutput {
  wheelTorque: [number, number, number, number];
  clutchEngagement: number;
  drivetrainTargetRpm: number;
  totalRatio: number;
}

/**
 * Transmission, progressive clutch bite curve, AWD torque split, and 2-way clutch-pack
 * locking differentials (separate accel/decel ramp + preload + manual center/axle lock).
 */
export class TransmissionModule {
  public clutchEngagement = 1.0;
  public shiftCutTimer = 0;
  private tcSmooth = 1.0;

  // Pre-allocated output buffer (zero GC)
  public readonly wheelTorque: [number, number, number, number] = [0, 0, 0, 0];

  public reset(): void {
    this.clutchEngagement = 1.0;
    this.shiftCutTimer = 0;
    this.tcSmooth = 1.0;
    this.wheelTorque[0] = 0;
    this.wheelTorque[1] = 0;
    this.wheelTorque[2] = 0;
    this.wheelTorque[3] = 0;
  }

  public getGearRatio(car: CarSpec, tuning: VehicleTuningSetup, gearIndex: number): number {
    if (gearIndex === -1) return car.reverseRatio;
    if (gearIndex === 0) return 0;
    const maxIdx = Math.max(0, tuning.gearRatios.length - 1);
    const idx = Math.max(0, Math.min(maxIdx, gearIndex - 1));
    return tuning.gearRatios[idx];
  }

  private solveTwoWayDiff(
    axleTorque: number,
    omegaL: number,
    omegaR: number,
    accelLock: number,
    decelLock: number,
    preloadNm: number,
    isSpooled: boolean,
    dt: number,
    wheelInertia: number
  ): [number, number] {
    const baseEach = axleTorque * 0.5;
    const lockFrac = axleTorque >= 0 ? accelLock : decelLock;
    const lockCap = isSpooled
      ? 4200
      : preloadNm + Math.abs(axleTorque) * Math.max(0, Math.min(1, lockFrac));
    const dOmega = omegaL - omegaR;
    const deadband = isSpooled ? 0.35 : 1.6;
    const rawTransfer = Math.max(-1, Math.min(1, dOmega / deadband)) * lockCap;
    // Implicit stability bound: never transfer more torque than needed to equalize L/R wheel speeds in one dt step
    const maxStableTransfer = (0.42 * wheelInertia * Math.abs(dOmega)) / Math.max(1e-4, dt);
    const transfer =
      Math.abs(rawTransfer) > maxStableTransfer
        ? Math.sign(rawTransfer) * maxStableTransfer
        : rawTransfer;
    // Subtract from faster wheel, add to slower wheel
    return [baseEach - transfer, baseEach + transfer];
  }

  public step(
    dt: number,
    car: CarSpec,
    tuning: VehicleTuningSetup,
    gearIndex: number,
    throttle: number,
    shiftCooldown: number,
    engineTorqueNm: number,
    engineBrakeNm: number,
    wheelAngularVel: readonly [number, number, number, number],
    wheelSlipRatios: readonly [number, number, number, number],
    autoShift: boolean,
    diffLockSwitch: boolean,
    forwardSpeed: number,
    driftMode = false,
    wheelSlipAnglesDeg: readonly [number, number, number, number] = [0, 0, 0, 0]
  ): DrivetrainOutput {
    const activeRatio = this.getGearRatio(car, tuning, gearIndex);
    const totalRatio = activeRatio * tuning.finalDrive;
    const wheelMass = car.id === 'g63-4x4' ? 38 : car.bodyStyle === 'suv' ? 34 : 22;
    const wheelInertia = 0.58 * wheelMass * car.wheelRadius * car.wheelRadius;

    const frontSplit =
      car.drivetrain === 'RWD'
        ? 0
        : driftMode
          ? Math.min(0.25, tuning.awdFrontSplit)
          : Math.max(0, Math.min(0.65, tuning.awdFrontSplit));
    const rearSplit = 1 - frontSplit;

    // Mean driven wheel angular speed
    const rearOmega = (wheelAngularVel[2] + wheelAngularVel[3]) * 0.5;
    const frontOmega = (wheelAngularVel[0] + wheelAngularVel[1]) * 0.5;
    const drivenOmega =
      car.drivetrain === 'RWD' ? rearOmega : frontOmega * frontSplit + rearOmega * rearSplit;

    const drivetrainTargetRpm =
      gearIndex === 0
        ? car.idleRpm
        : Math.max(0, drivenOmega * totalRatio * (60 / (2 * Math.PI)));

    // Progressive clutch bite curve: fast PDK/DCT engagement on sports cars, smooth converter feel on heavy SUVs
    let targetClutch = 1.0;
    if (gearIndex === 0) {
      targetClutch = 0;
    } else if (shiftCooldown > 0.025) {
      targetClutch = car.id === 'gt3-rs' || car.id === 'shelby-gt500' ? 0.78 : 0.48;
    } else if (Math.abs(forwardSpeed) < 1.8 && throttle < 0.08) {
      targetClutch = 0.08;
    } else if (Math.abs(forwardSpeed) < 8.5 && throttle > 0.08) {
      const launchProg = Math.min(1, Math.abs(forwardSpeed) / 8.0);
      const baseEngage = car.id === 'gt3-rs' ? 0.62 : car.id === 'shelby-gt500' ? 0.50 : 0.42;
      targetClutch = baseEngage + (1 - baseEngage) * (launchProg * launchProg * (3 - 2 * launchProg));
    }

    const biteRate = (targetClutch > this.clutchEngagement ? 16.0 : 24.0) * tuning.clutchEngagementRate;
    this.clutchEngagement += (targetClutch - this.clutchEngagement) * Math.min(1, dt * biteRate);

    if (gearIndex === 0) {
      this.wheelTorque[0] = 0;
      this.wheelTorque[1] = 0;
      this.wheelTorque[2] = 0;
      this.wheelTorque[3] = 0;
      return {
        wheelTorque: this.wheelTorque,
        clutchEngagement: this.clutchEngagement,
        drivetrainTargetRpm: car.idleRpm,
        totalRatio,
      };
    }

    const drivetrainEff = car.id === 'gt3-rs' || car.id === 'shelby-gt500' ? 0.95 : 0.93;
    const launchSlipFactor =
      Math.abs(forwardSpeed) < 11.5 && throttle > 0.2
        ? 0.96 + 0.04 * this.clutchEngagement
        : Math.max(0.35, this.clutchEngagement);
    const netEngineNm = engineTorqueNm - engineBrakeNm;

    // Combined longitudinal Traction Control + lateral ESC in Grip Mode (disabled in Drift or Manual Mode)
    let tcTarget = 1.0;
    if (autoShift && !driftMode && netEngineNm > 0 && throttle > 0.25) {
      const peakDriveSlip = Math.max(
        wheelSlipRatios[2],
        wheelSlipRatios[3],
        car.drivetrain === 'RWD' ? 0 : Math.max(wheelSlipRatios[0], wheelSlipRatios[1])
      );
      const rearLatSlipDeg = Math.max(
        Math.abs(wheelSlipAnglesDeg[2]),
        Math.abs(wheelSlipAnglesDeg[3])
      );
      const cornerFactor = Math.max(0, Math.min(1, (rearLatSlipDeg - 4.0) / 5.5));
      const baseThresh = car.id === 'gt3-rs' ? 0.14 : car.bodyStyle === 'muscle' ? 0.13 : 0.16;
      const slipThresh = baseThresh * (1 - cornerFactor * 0.45);
      const tcFloor = 0.28 - cornerFactor * 0.24; // Modulates straight launch near peak grip and cuts cornering spinouts
      if (peakDriveSlip > slipThresh) {
        tcTarget = Math.max(tcFloor, 1 - (peakDriveSlip - slipThresh) * (4.6 + cornerFactor * 3.5));
      }
      // Grip-Mode RWD ESC: smoothly modulates power when rear lateral slip exceeds safe cornering angle
      if (car.drivetrain === 'RWD' && rearLatSlipDeg > 6.2) {
        const escLimit = Math.max(0.28, 1 - (rearLatSlipDeg - 6.2) / 4.8);
        tcTarget = Math.min(tcTarget, escLimit);
      }
    }
    const tcRate = tcTarget < this.tcSmooth ? 54 : 36;
    this.tcSmooth += (tcTarget - this.tcSmooth) * Math.min(1, dt * tcRate);

    const totalAxleTorque = netEngineNm * totalRatio * drivetrainEff * launchSlipFactor * this.tcSmooth;

    const fullDiffLock = car.hasDiffLock && diffLockSwitch;
    const centerLock = fullDiffLock ? 1.0 : tuning.diffCenterLock;

    // AWD Center Differential coupling between front and rear propshafts
    let frontAxleTorque = totalAxleTorque * frontSplit;
    let rearAxleTorque = totalAxleTorque * rearSplit;
    if (car.drivetrain !== 'RWD' && centerLock > 0.02) {
      const dCenter = frontOmega - rearOmega;
      const rawCenter =
        Math.max(-1, Math.min(1, dCenter / 2.2)) *
        centerLock *
        (220 + Math.abs(totalAxleTorque) * 0.65);
      const maxCenter = (0.8 * wheelInertia * Math.abs(dCenter)) / Math.max(1e-4, dt);
      const centerTransfer =
        Math.abs(rawCenter) > maxCenter ? Math.sign(rawCenter) * maxCenter : rawCenter;
      frontAxleTorque -= centerTransfer;
      rearAxleTorque += centerTransfer;
    }

    if (car.drivetrain !== 'RWD') {
      const [tFL, tFR] = this.solveTwoWayDiff(
        frontAxleTorque,
        wheelAngularVel[0],
        wheelAngularVel[1],
        tuning.diffFrontAccelLock,
        tuning.diffFrontDecelLock,
        tuning.diffFrontPreloadNm,
        fullDiffLock,
        dt,
        wheelInertia
      );
      this.wheelTorque[0] = tFL;
      this.wheelTorque[1] = tFR;
    } else {
      this.wheelTorque[0] = 0;
      this.wheelTorque[1] = 0;
    }

    const rearAccelLock = driftMode ? Math.max(0.86, tuning.diffRearAccelLock) : tuning.diffRearAccelLock;
    const [tRL, tRR] = this.solveTwoWayDiff(
      rearAxleTorque,
      wheelAngularVel[2],
      wheelAngularVel[3],
      rearAccelLock,
      tuning.diffRearDecelLock,
      tuning.diffRearPreloadNm,
      fullDiffLock,
      dt,
      wheelInertia
    );
    this.wheelTorque[2] = tRL;
    this.wheelTorque[3] = tRR;

    return {
      wheelTorque: this.wheelTorque,
      clutchEngagement: this.clutchEngagement,
      drivetrainTargetRpm,
      totalRatio,
    };
  }
}
