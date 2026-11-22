import * as THREE from 'three';
import { CARS } from '../src/data/cars';
import { runAllBenchmarks, runSingleBenchmark } from '../src/engine/benchmarks';
import { createDefaultTuning } from '../src/engine/dynamics/tuning';
import { VehicleInput, VehiclePhysics } from '../src/engine/physics';
import { ensureRapierInitialized, FIXED_PHYSICS_DT, RapierWorldManager } from '../src/engine/rapierWorld';
import { setActiveTerrainMap } from '../src/engine/terrain';

function measureHandlingModes(carId: string) {
  setActiveTerrainMap('testing-facility');
  const car = CARS.find((c) => c.id === carId) ?? CARS[0];

  const runScenario = (driftMode: boolean, mode: 'throttle' | 'handbrake' | 'serviceBrake') => {
    const tuning = createDefaultTuning(car);
    const rapier = new RapierWorldManager(car, []);
    const phys = new VehiclePhysics(car, rapier, tuning);
    phys.setDriftMode(driftMode);
    phys.reset(new THREE.Vector3(0, 0, 260), 0);

    // Accelerate up to ~125 km/h
    const throttle: VehicleInput = {
      throttle: true,
      brake: false,
      steerLeft: false,
      steerRight: false,
      handbrake: false,
    };
    for (let s = 0; s < 1200; s++) {
      phys.step(FIXED_PHYSICS_DT, throttle);
      if (phys.velocity.length() * 3.6 >= 125) break;
    }

    const startSpeedKmh = phys.velocity.length() * 3.6;
    const qStart = phys.quaternion.clone();
    const fwdStart = new THREE.Vector3(0, 0, -1).applyQuaternion(qStart);
    const startYaw = Math.atan2(-fwdStart.x, -fwdStart.z);

    let maxLatG = 0;
    let maxRearSlipDeg = 0;
    let maxRollDeg = 0;

    // Steer left for 1.8 seconds (216 steps) on throttle, off-throttle E handbrake, or off-throttle Space service brake
    for (let s = 0; s < 216; s++) {
      const inp: VehicleInput =
        mode === 'handbrake'
          ? { throttle: false, brake: false, steerLeft: true, steerRight: false, handbrake: true }
          : mode === 'serviceBrake'
            ? {
                throttle: false,
                brake: true,
                serviceBrakeOnly: true,
                steerLeft: true,
                steerRight: false,
                handbrake: false,
              }
            : { throttle: true, brake: false, steerLeft: true, steerRight: false, handbrake: false };
      phys.step(FIXED_PHYSICS_DT, inp);
      maxLatG = Math.max(maxLatG, Math.abs(phys.lateralG));
      maxRollDeg = Math.max(maxRollDeg, Math.abs(phys.getTelemetry().rollDeg));
      const rearSlip =
        (Math.abs(phys.tires.slipAngleDeg[2]) + Math.abs(phys.tires.slipAngleDeg[3])) * 0.5;
      if (rearSlip > maxRearSlipDeg) maxRearSlipDeg = rearSlip;
    }

    const fwdEnd = new THREE.Vector3(0, 0, -1).applyQuaternion(phys.quaternion);
    const endYaw = Math.atan2(-fwdEnd.x, -fwdEnd.z);
    let yawChange = endYaw - startYaw;
    while (yawChange > Math.PI) yawChange -= Math.PI * 2;
    while (yawChange < -Math.PI) yawChange += Math.PI * 2;
    const headingDeltaDeg = Math.abs(THREE.MathUtils.radToDeg(yawChange));
    const endSpeedKmh = phys.velocity.length() * 3.6;
    const distSlideM = Math.abs(phys.position.z - 260);

    rapier.dispose();
    return {
      startSpeedKmh,
      endSpeedKmh,
      headingDeltaDeg,
      maxLatG,
      maxRearSlipDeg,
      maxRollDeg,
      distSlideM,
    };
  };

  return {
    gripTurn: runScenario(false, 'throttle'),
    driftTurn: runScenario(true, 'throttle'),
    gripOffThrottleHandbrake: runScenario(false, 'handbrake'),
    driftOffThrottleHandbrake: runScenario(true, 'handbrake'),
    gripOffThrottleServiceBrake: runScenario(false, 'serviceBrake'),
  };
}

async function main() {
  await ensureRapierInitialized();

  console.log('\n=== Running Full 11-Benchmark Validation Suite Across All 5 Vehicles ===');
  for (const car of CARS) {
    console.log(`\n--- ${car.name} (${car.id}) ---`);
    const summary = await runAllBenchmarks(car, createDefaultTuning(car), (_done, _total, res) => {
      console.log(
        `  [${res.passed ? 'PASS' : 'FAIL'}] ${res.name.padEnd(36)} | ${res.measured} (Target: ${res.target})`
      );
    });
    console.log(`  Summary (${car.id}): ${summary.passedCount}/${summary.totalCount} PASSED`);
    if (summary.passedCount !== summary.totalCount) {
      process.exitCode = 1;
    }
  }

  console.log('\n=== High-Speed Turn-In, Service Brake (Space) vs Handbrake (E) & Drift Mode Check ===');
  for (const id of ['gt3-rs', 'shelby-gt500']) {
    const res = measureHandlingModes(id);
    const okHighSpeedTurn =
      res.gripTurn.headingDeltaDeg >= 25 &&
      res.gripTurn.maxLatG >= 0.78 &&
      res.gripTurn.maxRollDeg < 18;
    const okOffThrottleHandbrake =
      res.gripOffThrottleHandbrake.endSpeedKmh <= res.gripOffThrottleHandbrake.startSpeedKmh * 0.80 &&
      res.driftOffThrottleHandbrake.maxRearSlipDeg > res.gripOffThrottleServiceBrake.maxRearSlipDeg;
    const okOffThrottleServiceBrake =
      res.gripOffThrottleServiceBrake.endSpeedKmh <= res.gripOffThrottleServiceBrake.startSpeedKmh * 0.54 &&
      res.gripOffThrottleServiceBrake.maxRearSlipDeg < 20;
    const okDriftSlipHigher =
      res.driftTurn.maxRearSlipDeg > res.gripTurn.maxRearSlipDeg ||
      res.driftOffThrottleHandbrake.maxRearSlipDeg > res.gripOffThrottleHandbrake.maxRearSlipDeg;

    console.log(
      `[${id}] 125km/h Grip Turn: Δhdg=${res.gripTurn.headingDeltaDeg.toFixed(1)}°, latG=${res.gripTurn.maxLatG.toFixed(2)}G, rearSlip=${res.gripTurn.maxRearSlipDeg.toFixed(1)}° | Drift Turn rearSlip=${res.driftTurn.maxRearSlipDeg.toFixed(1)}° -> ${okHighSpeedTurn && okDriftSlipHigher ? 'PASS' : 'FAIL'}`
    );
    console.log(
      `[${id}] Off-Throttle Space Brake: ${res.gripOffThrottleServiceBrake.startSpeedKmh.toFixed(0)}→${res.gripOffThrottleServiceBrake.endSpeedKmh.toFixed(0)} km/h (slip ${res.gripOffThrottleServiceBrake.maxRearSlipDeg.toFixed(1)}°) | E Handbrake: Grip ${res.gripOffThrottleHandbrake.startSpeedKmh.toFixed(0)}→${res.gripOffThrottleHandbrake.endSpeedKmh.toFixed(0)} km/h, Drift slip ${res.driftOffThrottleHandbrake.maxRearSlipDeg.toFixed(1)}° -> ${okOffThrottleHandbrake && okOffThrottleServiceBrake ? 'PASS' : 'FAIL'}`
    );

    if (!okHighSpeedTurn || !okOffThrottleHandbrake || !okOffThrottleServiceBrake || !okDriftSlipHigher) {
      process.exitCode = 1;
    }
  }

  console.log('\n=== Space Service Brake (Zero Reverse + Low Slip), Coast-Down & Differentiation Checks ===');
  {
    const gt3 = CARS.find((c) => c.id === 'gt3-rs')!;
    const g63 = CARS.find((c) => c.id === 'g63-4x4')!;
    const shelby = CARS.find((c) => c.id === 'shelby-gt500')!;

    // A. Space service brake stops cleanly without shifting into Reverse and keeps slip < 0.25 (zero smoke)
    {
      const rapier = new RapierWorldManager(gt3, []);
      const phys = new VehiclePhysics(gt3, rapier, createDefaultTuning(gt3));
      phys.reset(new THREE.Vector3(0, 0, 260), 0);
      for (let s = 0; s < 800; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: false, steerRight: false, handbrake: false });
        if (phys.velocity.length() * 3.6 >= 100) break;
      }
      let peakWheelSlip = 0;
      for (let s = 0; s < 600; s++) {
        phys.step(FIXED_PHYSICS_DT, {
          throttle: false,
          brake: true,
          serviceBrakeOnly: true,
          steerLeft: false,
          steerRight: false,
          handbrake: false,
        });
        if (phys.velocity.length() * 3.6 > 12) {
          peakWheelSlip = Math.max(peakWheelSlip, ...phys.wheelSlip);
        }
      }
      const okSpaceBrake = phys.gearIndex >= 1 && phys.velocity.length() * 3.6 < 1.0 && peakWheelSlip < 0.24;
      console.log(
        `[gt3-rs] Space Service Brake: finalSpeed=${(phys.velocity.length() * 3.6).toFixed(1)} km/h, gear=${phys.gearIndex}, peakSlip=${peakWheelSlip.toFixed(2)} -> ${okSpaceBrake ? 'PASS' : 'FAIL'}`
      );
      rapier.dispose();
      if (!okSpaceBrake) process.exitCode = 1;
    }

    // B. In-gear throttle release decelerates faster than neutral coast-down
    {
      const measureInGearCoast = (car: typeof gt3, neutral: boolean) => {
        const rapier = new RapierWorldManager(car, []);
        const phys = new VehiclePhysics(car, rapier, createDefaultTuning(car));
        phys.reset(new THREE.Vector3(0, 0, 260), 0);
        for (let s = 0; s < 1200; s++) {
          phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: false, steerRight: false, handbrake: false });
          if (phys.velocity.length() * 3.6 >= 100) break;
        }
        if (neutral) {
          phys.autoShift = false;
          phys.setGear(0);
        }
        const startKmh = phys.velocity.length() * 3.6;
        for (let s = 0; s < 600; s++) {
          phys.step(FIXED_PHYSICS_DT, { throttle: false, brake: false, steerLeft: false, steerRight: false, handbrake: false });
        }
        const endKmh = phys.velocity.length() * 3.6;
        rapier.dispose();
        return { startKmh, endKmh, dropKmh: startKmh - endKmh };
      };
      const gt3Gear = measureInGearCoast(gt3, false);
      const gt3Neutral = measureInGearCoast(gt3, true);
      const g63Gear = measureInGearCoast(g63, false);
      const okCoast = gt3Gear.dropKmh > gt3Neutral.dropKmh + 5 && gt3Gear.dropKmh >= 18 && g63Gear.dropKmh >= 18;
      console.log(
        `[Coast 5s @100km/h] GT3 In-Gear -${gt3Gear.dropKmh.toFixed(1)} km/h vs Neutral -${gt3Neutral.dropKmh.toFixed(1)} km/h | G63 In-Gear -${g63Gear.dropKmh.toFixed(1)} km/h -> ${okCoast ? 'PASS' : 'FAIL'}`
      );
      if (!okCoast) process.exitCode = 1;
    }

    // C. Shelby GT500 WOT wheelspin (Manual/TC off vs Auto Grip TC) & body roll comparison (G63 > GT3)
    {
      const runShelbyLaunch = (autoShift: boolean) => {
        const rapier = new RapierWorldManager(shelby, []);
        const phys = new VehiclePhysics(shelby, rapier, createDefaultTuning(shelby));
        phys.autoShift = autoShift;
        phys.reset(new THREE.Vector3(0, 0, 260), 0);
        let peakRearSlipRatio = 0;
        for (let s = 0; s < 300; s++) {
          phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: false, steerRight: false, handbrake: false });
          peakRearSlipRatio = Math.max(peakRearSlipRatio, phys.tires.slipRatio[2], phys.tires.slipRatio[3]);
        }
        rapier.dispose();
        return peakRearSlipRatio;
      };
      const tcOnSlip = runShelbyLaunch(true);
      const tcOffSlip = runShelbyLaunch(false);
      const okShelbyTc = tcOffSlip > 0.22 && tcOffSlip > tcOnSlip + 0.05;
      console.log(
        `[shelby-gt500] Launch Wheelspin: TC OFF=${tcOffSlip.toFixed(2)} vs TC ON=${tcOnSlip.toFixed(2)} -> ${okShelbyTc ? 'PASS' : 'FAIL'}`
      );
      if (!okShelbyTc) process.exitCode = 1;
    }
  }

  console.log('\n=== Straight-Line Braking, Reverse Recovery & Drift Countersteer Check ===');
  for (const id of ['gt3-rs', 'wrx-rally', 'shelby-gt500']) {
    const car = CARS.find((c) => c.id === id) ?? CARS[0];

    // 1. Straight-line 140 -> 0 km/h braking without steering input
    {
      const rapier = new RapierWorldManager(car, []);
      const phys = new VehiclePhysics(car, rapier, createDefaultTuning(car));
      phys.reset(new THREE.Vector3(0, 0, 320), 0);
      for (let s = 0; s < 1400; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: false, steerRight: false, handbrake: false });
        if (phys.velocity.length() * 3.6 >= 140) break;
      }
      const brakeStartX = phys.position.x;
      const fwd0 = new THREE.Vector3(0, 0, -1).applyQuaternion(phys.quaternion);
      const yaw0 = Math.atan2(-fwd0.x, -fwd0.z);
      let maxYawErr = 0;
      for (let s = 0; s < 600; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: false, brake: true, steerLeft: false, steerRight: false, handbrake: false });
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(phys.quaternion);
        let dy = Math.atan2(-fwd.x, -fwd.z) - yaw0;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        maxYawErr = Math.max(maxYawErr, Math.abs(THREE.MathUtils.radToDeg(dy)));
        if (phys.velocity.length() * 3.6 < 2) break;
      }
      const latShift = Math.abs(phys.position.x - brakeStartX);
      rapier.dispose();
      const okStraightBrake = maxYawErr < 2.5 && latShift < 0.5;
      console.log(
        `[${id}] Straight 140→0 Brake (S): maxYawDev=${maxYawErr.toFixed(2)}°, latShift=${latShift.toFixed(2)}m -> ${okStraightBrake ? 'PASS' : 'FAIL'}`
      );
      if (!okStraightBrake) process.exitCode = 1;
    }

    // 2. Reverse driving -> pressing W brakes cleanly to stop and shifts to Forward
    {
      const rapier = new RapierWorldManager(car, []);
      const phys = new VehiclePhysics(car, rapier, createDefaultTuning(car));
      phys.reset(new THREE.Vector3(0, 0, 0), 0);
      // Hold S to enter R and accelerate backward
      for (let s = 0; s < 300; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: false, brake: true, steerLeft: false, steerRight: false, handbrake: false });
      }
      const fwdAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(phys.quaternion);
      const revSpeedKmh = -phys.velocity.dot(fwdAxis) * 3.6;
      const gearInRev = phys.gearIndex;
      // Now press W: must slow down from reverse (never accelerate faster backward!) and shift to Gear 1+
      let minRevFwdSpeed = phys.velocity.dot(fwdAxis) * 3.6;
      for (let s = 0; s < 420; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: false, steerRight: false, handbrake: false });
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(phys.quaternion);
        const fSpd = phys.velocity.dot(f) * 3.6;
        if (fSpd < minRevFwdSpeed) minRevFwdSpeed = fSpd;
      }
      const finalFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(phys.quaternion);
      const finalFwdKmh = phys.velocity.dot(finalFwd) * 3.6;
      rapier.dispose();
      const okRev =
        gearInRev === -1 &&
        revSpeedKmh > 18 &&
        minRevFwdSpeed >= -revSpeedKmh - 1.0 &&
        phys.gearIndex >= 1 &&
        finalFwdKmh > 35;
      console.log(
        `[${id}] Reverse->W Recovery: rev=${revSpeedKmh.toFixed(1)} km/h (gear ${gearInRev}) -> W 3s=${finalFwdKmh.toFixed(1)} km/h (gear ${phys.gearIndex}) -> ${okRev ? 'PASS' : 'FAIL'}`
      );
      if (!okRev) process.exitCode = 1;
    }

    // 3. Drift Mode countersteer front wheel angle + controlled handbrake kick
    {
      const rapier = new RapierWorldManager(car, []);
      const phys = new VehiclePhysics(car, rapier, createDefaultTuning(car));
      phys.setDriftMode(true);
      phys.reset(new THREE.Vector3(0, 0, 220), 0);
      for (let s = 0; s < 900; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: false, steerRight: false, handbrake: false });
        if (phys.velocity.length() * 3.6 >= 95) break;
      }
      // Initiate left drift slide with 0.55s Left + Throttle + brief 0.35s E handbrake kick, then countersteer Right + Throttle
      for (let s = 0; s < 66; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: true, steerRight: false, handbrake: s < 42 });
      }
      let peakCounterSteerDeg = 0;
      let peakYawRate = 0;
      for (let s = 0; s < 144; s++) {
        phys.step(FIXED_PHYSICS_DT, { throttle: true, brake: false, steerLeft: false, steerRight: true, handbrake: false });
        const maxFrontDeg = Math.max(
          Math.abs(THREE.MathUtils.radToDeg(phys.steering.wheelAnglesRad[0])),
          Math.abs(THREE.MathUtils.radToDeg(phys.steering.wheelAnglesRad[1]))
        );
        if (maxFrontDeg > peakCounterSteerDeg) peakCounterSteerDeg = maxFrontDeg;
        peakYawRate = Math.max(peakYawRate, Math.abs(phys.angularVelocity.y));
      }
      rapier.dispose();
      const okCounter = peakCounterSteerDeg >= 24 && peakYawRate < 2.2;
      console.log(
        `[${id}] Drift Countersteer Lock: peakFrontSteer=${peakCounterSteerDeg.toFixed(1)}°, peakYawRate=${peakYawRate.toFixed(2)} rad/s -> ${okCounter ? 'PASS' : 'FAIL'}`
      );
      if (!okCounter) process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
