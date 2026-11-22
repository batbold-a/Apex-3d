import { CarSpec, VehicleTuningSetup } from '../../types/vehicle';

interface TorquePoint {
  rpmNorm: number;
  torqueMult: number;
}

// Calibrated 9-point normalized torque curves (0 = idleRpm, 1 = redlineRpm)
const TORQUE_LUTS: Record<string, readonly TorquePoint[]> = {
  // High-rev NA Flat-6 (GT3 RS): linear climb, ferocious upper-end cam switchover @ 6000-8800 RPM
  na_flat6: [
    { rpmNorm: 0.0, torqueMult: 0.58 },
    { rpmNorm: 0.18, torqueMult: 0.74 },
    { rpmNorm: 0.35, torqueMult: 0.85 },
    { rpmNorm: 0.52, torqueMult: 0.92 },
    { rpmNorm: 0.68, torqueMult: 0.98 },
    { rpmNorm: 0.78, torqueMult: 1.0 },
    { rpmNorm: 0.9, torqueMult: 0.99 },
    { rpmNorm: 0.98, torqueMult: 0.94 },
    { rpmNorm: 1.06, torqueMult: 0.45 },
  ],
  // Turbo Boxer (WRX Rally): mild off-boost low end, huge mid-range surge once spooled
  turbo_boxer: [
    { rpmNorm: 0.0, torqueMult: 0.45 },
    { rpmNorm: 0.16, torqueMult: 0.62 },
    { rpmNorm: 0.32, torqueMult: 0.88 },
    { rpmNorm: 0.48, torqueMult: 1.0 },
    { rpmNorm: 0.65, torqueMult: 0.99 },
    { rpmNorm: 0.8, torqueMult: 0.93 },
    { rpmNorm: 0.92, torqueMult: 0.84 },
    { rpmNorm: 0.99, torqueMult: 0.74 },
    { rpmNorm: 1.06, torqueMult: 0.4 },
  ],
  // Supercharged V8 (Shelby GT500 / Defender): broad tabletop torque from low RPM to redline
  sc_v8: [
    { rpmNorm: 0.0, torqueMult: 0.68 },
    { rpmNorm: 0.16, torqueMult: 0.84 },
    { rpmNorm: 0.34, torqueMult: 0.95 },
    { rpmNorm: 0.55, torqueMult: 1.0 },
    { rpmNorm: 0.75, torqueMult: 0.98 },
    { rpmNorm: 0.88, torqueMult: 0.93 },
    { rpmNorm: 0.96, torqueMult: 0.87 },
    { rpmNorm: 1.0, torqueMult: 0.81 },
    { rpmNorm: 1.06, torqueMult: 0.42 },
  ],
  // Biturbo Heavy V8 (G63): massive diesel-like low-mid torque plateau
  biturbo_v8: [
    { rpmNorm: 0.0, torqueMult: 0.62 },
    { rpmNorm: 0.15, torqueMult: 0.85 },
    { rpmNorm: 0.3, torqueMult: 0.99 },
    { rpmNorm: 0.5, torqueMult: 1.0 },
    { rpmNorm: 0.7, torqueMult: 0.96 },
    { rpmNorm: 0.85, torqueMult: 0.88 },
    { rpmNorm: 0.95, torqueMult: 0.78 },
    { rpmNorm: 1.0, torqueMult: 0.7 },
    { rpmNorm: 1.06, torqueMult: 0.38 },
  ],
};

function sampleTorqueLut(lut: readonly TorquePoint[], rpmNorm: number): number {
  if (rpmNorm <= lut[0].rpmNorm) return lut[0].torqueMult;
  const last = lut[lut.length - 1];
  if (rpmNorm >= last.rpmNorm) return last.torqueMult;
  for (let i = 0; i < lut.length - 1; i++) {
    const a = lut[i];
    const b = lut[i + 1];
    if (rpmNorm >= a.rpmNorm && rpmNorm <= b.rpmNorm) {
      const t = (rpmNorm - a.rpmNorm) / Math.max(1e-5, b.rpmNorm - a.rpmNorm);
      return a.torqueMult + (b.torqueMult - a.torqueMult) * t;
    }
  }
  return last.torqueMult;
}

/**
 * Engine dynamics: calibrated RPM/torque LUTs, turbocharger spool lag / supercharger boost,
 * engine thermal cooling model, fuel cut rev limiter, engine braking, and stalling.
 */
export class EngineModule {
  public rpm = 900;
  public boostBar = 0; // gauge boost pressure (bar)
  public engineLoad = 0; // 0..1 actual load
  public engineTempC = 88; // operating coolant/oil temp
  public lastTorqueNm = 0;
  public lastEngineBrakeNm = 0;
  public isRevLimiting = false;
  public isStalled = false;

  private turboSpool = 0; // 0..1
  private revCutPhase = 0;

  public reset(car: CarSpec): void {
    this.rpm = car.idleRpm;
    this.boostBar = 0;
    this.engineLoad = 0.08;
    this.engineTempC = 88;
    this.lastTorqueNm = 0;
    this.lastEngineBrakeNm = 0;
    this.isRevLimiting = false;
    this.isStalled = false;
    this.turboSpool = 0;
    this.revCutPhase = 0;
  }

  public getLutForCar(car: CarSpec): readonly TorquePoint[] {
    if (car.id === 'gt3-rs') return TORQUE_LUTS.na_flat6;
    if (car.hasTurbo && car.bodyStyle === 'suv') return TORQUE_LUTS.biturbo_v8;
    if (car.hasTurbo) return TORQUE_LUTS.turbo_boxer;
    return TORQUE_LUTS.sc_v8;
  }

  public step(
    dt: number,
    car: CarSpec,
    tuning: VehicleTuningSetup,
    throttle: number,
    gearIndex: number,
    autoShift: boolean,
    drivetrainTargetRpm: number,
    clutchEngagement: number,
    speedMs: number,
    engineDamage: number,
    simTime: number
  ): { torqueNm: number; engineBrakeNm: number; engineLoad: number; boostBar: number } {
    const lut = this.getLutForCar(car);
    const rpmBand = Math.max(500, car.redlineRpm - car.idleRpm);

    // 1. Rotational Engine Speed Integration (inertial flywheel + drivetrain coupling)
    if (this.isStalled) {
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 8);
      if (throttle > 0.1 || autoShift || gearIndex === 0) {
        // Auto-crank recovery
        this.isStalled = false;
        this.rpm = car.idleRpm;
      }
    } else if (gearIndex === 0) {
      const targetFreeRpm = car.idleRpm + throttle * (car.maxRpm - car.idleRpm) * 0.96;
      const freeRate = throttle > 0.08 ? 8.5 : 3.6;
      this.rpm += (targetFreeRpm - this.rpm) * Math.min(1, dt * freeRate);
    } else {
      const idleHold = car.idleRpm + throttle * 400;
      const launchBias =
        car.id === 'gt3-rs'
          ? 0.88
          : car.id === 'shelby-gt500'
            ? 0.72
            : car.bodyStyle === 'suv'
              ? 0.44
              : 0.62;
      const stallSlipRpm =
        throttle > 0.08
          ? car.idleRpm + throttle * rpmBand * launchBias
          : idleHold;
      const coupledTarget = Math.max(
        autoShift ? idleHold : Math.min(drivetrainTargetRpm, car.maxRpm + 250),
        drivetrainTargetRpm * clutchEngagement + stallSlipRpm * (1 - clutchEngagement)
      );
      const blendRate = clutchEngagement > 0.85 ? 24 : 14;
      this.rpm += (coupledTarget - this.rpm) * Math.min(1, dt * blendRate);

      // Manual clutch-locked stall if lugged far below idle
      if (!autoShift && clutchEngagement > 0.9 && this.rpm < car.idleRpm * 0.48 && throttle < 0.15) {
        this.isStalled = true;
      }
    }

    this.rpm = Math.max(this.isStalled ? 0 : car.idleRpm * 0.65, Math.min(car.maxRpm + 220, this.rpm));
    const rpmNorm = Math.max(0, (this.rpm - car.idleRpm) / rpmBand);

    // 2. Forced Induction Model (Turbo Spool Lag vs Instantaneous Supercharger Boost)
    const rpmFlow = Math.max(0, Math.min(1, (this.rpm - car.idleRpm * 1.15) / (rpmBand * 0.72)));
    if (car.hasTurbo) {
      const targetSpool = Math.max(0, Math.min(1.15, (0.25 + throttle * 0.95) * rpmFlow));
      const spoolRate = targetSpool > this.turboSpool ? 2.6 : 4.8; // realistic spool lag vs BOV vent
      this.turboSpool += (targetSpool - this.turboSpool) * Math.min(1, dt * spoolRate);
      this.boostBar =
        Math.max(-0.55, (this.turboSpool * 1.35 * tuning.boostPressureScale) - (1 - throttle) * 0.55);
    } else if (car.hasSupercharger) {
      const scBoost = rpmFlow * 0.95 * tuning.boostPressureScale * (0.35 + throttle * 0.65);
      this.turboSpool = scBoost;
      this.boostBar = scBoost - (1 - throttle) * 0.3;
    } else {
      this.turboSpool = 1.0;
      this.boostBar = -0.6 * (1 - throttle); // NA manifold vacuum
    }

    // 3. Peak Torque Curve & Induction Multiplier (peak = 1.00 * boostPressureScale at full spool)
    const lutMult = sampleTorqueLut(lut, rpmNorm);
    const inductionFactor = car.hasTurbo
      ? 0.68 + Math.min(0.35, Math.max(0, this.turboSpool) * 0.28 * tuning.boostPressureScale)
      : car.hasSupercharger
        ? 0.86 + Math.min(0.16, Math.max(0, this.boostBar) * 0.145)
        : 1.0;

    const maxTorqueAtRpm =
      car.peakTorqueNm * lutMult * tuning.powerMultiplier * inductionFactor;

    let netTorque = this.isStalled ? 0 : maxTorqueAtRpm * throttle;

    // 4. Thermal Cooling Model & Damage Derate
    const heatGen = (0.12 + throttle * 0.85 * Math.max(0.25, rpmNorm)) * (1 + engineDamage * 1.6);
    const airflowCooling = 0.08 + Math.min(1.6, speedMs / 24) * (1 - engineDamage * 0.5);
    const targetTemp = 86 + heatGen * 34 - airflowCooling * 12;
    this.engineTempC += (targetTemp - this.engineTempC) * Math.min(1, dt * 0.08);
    this.engineTempC = Math.max(45, Math.min(138, this.engineTempC));

    const thermalDerate = this.engineTempC > 116 ? Math.max(0.55, 1 - (this.engineTempC - 116) * 0.025) : 1.0;
    const damageDerate = 1 - engineDamage * 0.28;
    netTorque *= thermalDerate * damageDerate;

    if (engineDamage > 0.65 && rpmNorm > 0.55) {
      netTorque *= 0.8 + 0.2 * Math.sin(simTime * 28);
    }

    // 5. Fuel-cut Rev Limiter
    this.isRevLimiting = !this.isStalled && this.rpm >= car.redlineRpm;
    if (this.isRevLimiting && gearIndex !== 0) {
      this.revCutPhase += dt * 42;
      const over = (this.rpm - car.redlineRpm) / Math.max(50, car.maxRpm - car.redlineRpm);
      const cutGate = Math.sin(this.revCutPhase) > -0.2 ? Math.max(0, 1 - over * 1.5) : 0;
      netTorque *= cutGate;
    }

    // 6. Pumping & Friction Engine Braking on Overrun (scaled by engine capacity/torque & RPM)
    const engineBrakeNm =
      !this.isStalled && gearIndex !== 0 && throttle < 0.08
        ? (car.peakTorqueNm * 0.085 + (this.rpm / car.maxRpm) * car.peakTorqueNm * 0.165) *
          (1 - throttle * 10)
        : 0;

    this.lastTorqueNm = netTorque;
    this.lastEngineBrakeNm = engineBrakeNm;
    this.engineLoad =
      this.isStalled || maxTorqueAtRpm <= 1
        ? 0
        : Math.max(0, Math.min(1, netTorque / (car.peakTorqueNm * tuning.powerMultiplier)));

    return {
      torqueNm: netTorque,
      engineBrakeNm,
      engineLoad: this.engineLoad,
      boostBar: this.boostBar,
    };
  }
}
