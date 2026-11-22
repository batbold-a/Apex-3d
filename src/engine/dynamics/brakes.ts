import { CarSpec, VehicleTuningSetup } from '../../types/vehicle';

/**
 * Braking & Thermal Fade Module:
 * - Front/Rear hydraulic brake bias
 * - Per-wheel rotor temperature & thermal fade curve (25C -> 900C)
 * - Electronic ABS pulse modulation targeting slip ratio [-0.18, -0.08]
 * - Non-ABS full threshold lockup (kappa -> -1.0) + mechanical handbrake
 */
export class BrakesModule {
  public readonly brakeTempC: [number, number, number, number] = [34, 34, 34, 34];
  public readonly brakeTorqueNm: [number, number, number, number] = [0, 0, 0, 0];
  public readonly absPulseScale: [number, number, number, number] = [1, 1, 1, 1];
  public absActive = false;

  private absTimer = 0;

  public reset(): void {
    for (let i = 0; i < 4; i++) {
      this.brakeTempC[i] = 34;
      this.brakeTorqueNm[i] = 0;
      this.absPulseScale[i] = 1;
    }
    this.absActive = false;
    this.absTimer = 0;
  }

  public step(
    dt: number,
    car: CarSpec,
    tuning: VehicleTuningSetup,
    serviceBrakeInput: number,
    handbrakeInput: number,
    speedMs: number,
    gearIndex: number,
    avgBodyDamage: number,
    wheelAngularVel: readonly [number, number, number, number],
    slipRatios: readonly [number, number, number, number],
    wheelGrounded: readonly [boolean, boolean, boolean, boolean],
    throttleSmooth = 0,
    driftMode = false,
    rearLatSlipDeg = 0
  ): { brakeTorqueNm: [number, number, number, number]; absActive: boolean } {
    this.absTimer += dt;
    this.absActive = false;

    const brakeHealth = 1 - avgBodyDamage * 0.42;
    const isCarbonCeramic = car.id === 'gt3-rs';
    const fadeStartC = isCarbonCeramic ? 660 : 520;
    const fadeSpanC = isCarbonCeramic ? 250 : 210;
    // Effective rotor thermal capacity (J/C per corner) + realistic convective cooling time constant
    const rotorMassHeatCap = isCarbonCeramic ? 960 : 720;

    const frontEachBias = tuning.brakeBiasFront * 0.5;
    const rearEachBias = (1 - tuning.brakeBiasFront) * 0.5;
    const spaceFullBrake = speedMs < 1.8 || gearIndex === -1;

    // Pre-compute front braking slip magnitude for Dynamic EBD rear proportioning
    let frontMaxBrakeSlip = 0;
    for (let f = 0; f < 2; f++) {
      if (wheelGrounded[f]) {
        const bSlip = -Math.sign(wheelAngularVel[f] || 1) * slipRatios[f];
        if (bSlip > frontMaxBrakeSlip) frontMaxBrakeSlip = bSlip;
      }
    }

    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const bias = isFront ? frontEachBias : rearEachBias;

      // Thermal fade coefficient
      const overTemp = Math.max(0, this.brakeTempC[i] - fadeStartC);
      const fadeCoeff = Math.max(isCarbonCeramic ? 0.54 : 0.22, 1 - (overTemp / fadeSpanC) * 0.74);

      const serviceForce =
        car.maxBrakeForce * brakeHealth * fadeCoeff * serviceBrakeInput * bias;
      const handbrakeForce = spaceFullBrake
        ? car.maxBrakeForce * brakeHealth * fadeCoeff * handbrakeInput * bias
        : !isFront
          ? car.handbrakeForce * brakeHealth * handbrakeInput * (driftMode ? 0.54 : 0.65)
          : 0;

      let reqTorque = Math.max(serviceForce, handbrakeForce) * car.wheelRadius;

      // Dynamic Electronic Brakeforce Distribution (EBD) + Cornering Brake Control (CBC):
      // Under heavy weight transfer or cornering braking, prevent rear tires from saturating their friction circle
      if (
        !isFront &&
        serviceForce >= handbrakeForce &&
        serviceBrakeInput > 0.08 &&
        wheelGrounded[i] &&
        speedMs > 2.4
      ) {
        const rearBrakeSlip = Math.max(0, -Math.sign(wheelAngularVel[i] || 1) * slipRatios[i]);
        const allowedRearSlip = Math.max(0.075, frontMaxBrakeSlip * 0.92);
        if (rearBrakeSlip > allowedRearSlip) {
          const excess = rearBrakeSlip - allowedRearSlip;
          const ebdScale = Math.max(0.55, 1 - excess * 8.0);
          reqTorque *= ebdScale;
        }
        if (tuning.absEnabled && !driftMode && rearLatSlipDeg > 3.6) {
          const cbcScale = Math.max(0.08, 1 - (rearLatSlipDeg - 3.6) / 5.0);
          reqTorque *= cbcScale;
        }
      }

      // ABS Modulation: keep longitudinal braking slip cleanly in [-0.18, -0.07] (zero brake smoke when ABS enabled)
      const usingServiceAbs = serviceForce >= handbrakeForce && serviceBrakeInput > 0.08;
      if (tuning.absEnabled && usingServiceAbs && wheelGrounded[i] && speedMs > 2.4) {
        const kappa = slipRatios[i];
        const brakeSlipMag = -Math.sign(wheelAngularVel[i] || 1) * kappa;
        const absTrigThresh = isFront ? 0.12 : 0.095;
        const absSoftThresh = isFront ? 0.082 : 0.068;
        // Synchronized axle phase prevents left-right asymmetric yaw oscillation on uniform tarmac
        const axlePhase = isFront ? 0 : 0.42;

        if (brakeSlipMag > absTrigThresh) {
          this.absActive = true;
          const pulse = 0.5 + 0.5 * Math.sin(this.absTimer * 125 + axlePhase);
          const targetScale = 0.06 + pulse * 0.34;
          this.absPulseScale[i] += (targetScale - this.absPulseScale[i]) * Math.min(1, dt * 85);
        } else if (brakeSlipMag > absSoftThresh) {
          this.absActive = true;
          this.absPulseScale[i] += (0.64 - this.absPulseScale[i]) * Math.min(1, dt * 38);
        } else {
          this.absPulseScale[i] += (1.0 - this.absPulseScale[i]) * Math.min(1, dt * 28);
        }
        reqTorque *= this.absPulseScale[i];
      } else {
        this.absPulseScale[i] = 1.0;
      }

      this.brakeTorqueNm[i] = reqTorque;
    }

    // Split-μ ABS Yaw-Moment Moderation (Bosch GMM / Select-Low Proportioning):
    // When one side triggers heavy ABS on low-μ (ice) while the opposite side stays on dry tarmac,
    // strongly moderate the high-μ side brake torque down near the low-μ threshold to keep yaw pull controllable.
    if (tuning.absEnabled && this.absActive && speedMs > 3.5) {
      const fPulseDiff = Math.abs(this.absPulseScale[0] - this.absPulseScale[1]);
      if (fPulseDiff > 0.14) {
        const minFront = Math.min(this.absPulseScale[0], this.absPulseScale[1]);
        const capScale = Math.max(0.14, minFront * 0.52);
        if (this.absPulseScale[0] > capScale) {
          this.brakeTorqueNm[0] *= capScale / this.absPulseScale[0];
        }
        if (this.absPulseScale[1] > capScale) {
          this.brakeTorqueNm[1] *= capScale / this.absPulseScale[1];
        }
      }
      const rPulseDiff = Math.abs(this.absPulseScale[2] - this.absPulseScale[3]);
      if (rPulseDiff > 0.14) {
        const minRear = Math.min(this.absPulseScale[2], this.absPulseScale[3]);
        const capRear = Math.max(0.16, minRear * 0.56);
        if (this.absPulseScale[2] > capRear) {
          this.brakeTorqueNm[2] *= capRear / this.absPulseScale[2];
        }
        if (this.absPulseScale[3] > capRear) {
          this.brakeTorqueNm[3] *= capRear / this.absPulseScale[3];
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      const reqTorque = this.brakeTorqueNm[i];

      // Thermal update: frictional heating power P = T * |omega| minus realistic convective airflow cooling
      const frictionPowerW = reqTorque * Math.abs(wheelAngularVel[i]);
      const coolingCoeff = 1.8 + Math.min(10, speedMs * 0.28);
      const coolingW = (this.brakeTempC[i] - 28) * coolingCoeff * 4.2;
      const dTemp = ((frictionPowerW - coolingW) / rotorMassHeatCap) * dt;
      this.brakeTempC[i] = Math.max(24, Math.min(980, this.brakeTempC[i] + dTemp));
    }

    return {
      brakeTorqueNm: this.brakeTorqueNm,
      absActive: this.absActive,
    };
  }
}
