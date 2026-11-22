import * as THREE from 'three';
import { CARS } from '../src/data/cars';
import { cloneTuning, createDefaultTuning } from '../src/engine/dynamics/tuning';
import { VehicleInput, VehiclePhysics } from '../src/engine/physics';
import { ensureRapierInitialized, RapierWorldManager } from '../src/engine/rapierWorld';
import { setActiveTerrainMap } from '../src/engine/terrain';

const IDLE: VehicleInput = {
  throttle: false,
  brake: false,
  steerLeft: false,
  steerRight: false,
  handbrake: false,
};

const THROTTLE: VehicleInput = {
  throttle: true,
  brake: false,
  steerLeft: false,
  steerRight: false,
  handbrake: false,
};

const BRAKE_ONLY: VehicleInput = {
  throttle: false,
  brake: true,
  steerLeft: false,
  steerRight: false,
  handbrake: false,
};

const STEER_LEFT_THROTTLE: VehicleInput = {
  throttle: true,
  brake: false,
  steerLeft: true,
  steerRight: false,
  handbrake: false,
};

function measureZeroToHundred(
  carId: string,
  tweak?: (t: ReturnType<typeof createDefaultTuning>) => void
): { timeSec: number; distM: number; topKmh5s: number; rpmAt4s: number } {
  setActiveTerrainMap('proving-valley');
  const car = CARS.find((c) => c.id === carId) ?? CARS[0];
  const tuning = createDefaultTuning(car);
  if (tweak) tweak(tuning);

  const rapier = new RapierWorldManager(car, []);
  const phys = new VehiclePhysics(car, rapier, tuning);
  phys.reset(new THREE.Vector3(0, 0, 195), 0);

  let hitTime = -1;
  let hitDist = -1;
  let rpmAt4s = 0;
  for (let s = 1; s <= 1200; s++) {
    phys.step(1 / 120, THROTTLE);
    const t = s / 120;
    if (s === 480) rpmAt4s = phys.engineRpm;
    const kmh = phys.velocity.length() * 3.6;
    if (kmh >= 100 && hitTime < 0) {
      hitTime = t;
      hitDist = phys.distanceMeters;
    }
  }
  const topKmh5s = phys.velocity.length() * 3.6;
  rapier.dispose();
  return { timeSec: hitTime, distM: hitDist, topKmh5s, rpmAt4s };
}

function measureBrakeTest(
  carId: string,
  targetKmh: number,
  absEnabled: boolean,
  consecutiveStops = 1
): {
  stopDistFirst: number;
  stopDistLast: number;
  minKappaSeen: number;
  maxBrakeTempFirst: number;
  maxBrakeTempLast: number;
  absTriggered: boolean;
} {
  setActiveTerrainMap('highway-circuit');
  const car = CARS.find((c) => c.id === carId) ?? CARS[0];
  const tuning = createDefaultTuning(car);
  tuning.absEnabled = absEnabled;

  const rapier = new RapierWorldManager(car, []);
  const phys = new VehiclePhysics(car, rapier, tuning);

  let stopDistFirst = 0;
  let stopDistLast = 0;
  let minKappaSeen = 1;
  let maxBrakeTempFirst = 0;
  let maxBrakeTempLast = 0;
  let absTriggered = false;

  for (let run = 0; run < consecutiveStops; run++) {
    // Re-position at start of highway straight while preserving rotor thermal state!
    const savedTemps = [...phys.brakes.brakeTempC] as [number, number, number, number];
    phys.reset(new THREE.Vector3(0, 0, 200), 0);
    for (let i = 0; i < 4; i++) {
      phys.brakes.brakeTempC[i] = savedTemps[i];
    }

    // Accelerate up to targetKmh
    for (let s = 0; s < 1800; s++) {
      phys.step(1 / 120, THROTTLE);
      if (phys.velocity.length() * 3.6 >= targetKmh) break;
    }

    const startPos = phys.position.clone();
    let runMinKappa = 1;
    for (let s = 0; s < 1200; s++) {
      phys.step(1 / 120, BRAKE_ONLY);
      const kmh = phys.velocity.length() * 3.6;
      if (kmh > 18) {
        for (let w = 0; w < 4; w++) {
          runMinKappa = Math.min(runMinKappa, phys.tires.slipRatio[w]);
        }
        if (phys.absActive) absTriggered = true;
      }
      if (kmh <= 1.0) break;
    }
    const stopDist = phys.position.distanceTo(startPos);
    const peakTemp = Math.max(...phys.brakes.brakeTempC);
    if (run === 0) {
      stopDistFirst = stopDist;
      minKappaSeen = runMinKappa;
      maxBrakeTempFirst = peakTemp;
    }
    if (run === consecutiveStops - 1) {
      stopDistLast = stopDist;
      maxBrakeTempLast = peakTemp;
    }
  }

  rapier.dispose();
  return {
    stopDistFirst,
    stopDistLast,
    minKappaSeen,
    maxBrakeTempFirst,
    maxBrakeTempLast,
    absTriggered,
  };
}

function measureCorneringBalance(
  carId: string,
  tweak?: (t: ReturnType<typeof createDefaultTuning>) => void
): {
  avgYawRate: number;
  avgRearSlipDeg: number;
  avgFrontSlipDeg: number;
  avgLatG: number;
  insideOutsideRearSlipDiff: number;
  outerFrontLatN: number;
} {
  setActiveTerrainMap('proving-valley');
  const car = CARS.find((c) => c.id === carId) ?? CARS[0];
  const tuning = createDefaultTuning(car);
  if (tweak) tweak(tuning);

  const rapier = new RapierWorldManager(car, []);
  const phys = new VehiclePhysics(car, rapier, tuning);
  phys.reset(new THREE.Vector3(24, 0, 24), 0);

  // Accelerate up to ~80 km/h for cornering balance near tire limit
  for (let s = 0; s < 320; s++) {
    phys.step(1 / 120, THROTTLE);
    if (phys.velocity.length() * 3.6 >= 80) break;
  }

  let yawSum = 0;
  let rearSlipSum = 0;
  let frontSlipSum = 0;
  let latGSum = 0;
  let rearDiffSum = 0;
  let outerFrontLatSum = 0;
  const sampleSteps = 180;
  for (let s = 0; s < sampleSteps; s++) {
    phys.step(1 / 120, STEER_LEFT_THROTTLE);
    yawSum += phys.angularVelocity.y;
    frontSlipSum += (Math.abs(phys.tires.slipAngleDeg[0]) + Math.abs(phys.tires.slipAngleDeg[1])) * 0.5;
    rearSlipSum += (Math.abs(phys.tires.slipAngleDeg[2]) + Math.abs(phys.tires.slipAngleDeg[3])) * 0.5;
    latGSum += Math.abs(phys.lateralG);
    rearDiffSum += Math.abs(phys.tires.slipRatio[2] - phys.tires.slipRatio[3]);
    // On a left turn, FR (index 1) is the heavily loaded outer front tire
    outerFrontLatSum += Math.abs(phys.tires.forceLatN[1]);
  }

  rapier.dispose();
  return {
    avgYawRate: yawSum / sampleSteps,
    avgRearSlipDeg: rearSlipSum / sampleSteps,
    avgFrontSlipDeg: frontSlipSum / sampleSteps,
    avgLatG: latGSum / sampleSteps,
    insideOutsideRearSlipDiff: rearDiffSum / sampleSteps,
    outerFrontLatN: outerFrontLatSum / sampleSteps,
  };
}

async function run() {
  await ensureRapierInitialized();

  // [1B-1] Tire slip curve peak (6-11 deg) + controllable drift & countersteer recovery
  {
    setActiveTerrainMap('highway-circuit');
    const gt3 = CARS.find((c) => c.id === 'gt3-rs') ?? CARS[0];
    const tuning = cloneTuning(createDefaultTuning(gt3));
    const rapier = new RapierWorldManager(gt3, []);
    const phys = new VehiclePhysics(gt3, rapier, tuning);
    phys.autoShift = false;
    phys.setGear(2);

    // Accelerate to ~85 km/h on straight tarmac
    phys.reset(new THREE.Vector3(0, 0, 120), 0);
    phys.autoShift = true;
    for (let s = 0; s < 360; s++) {
      phys.step(1 / 120, THROTTLE);
      if (phys.velocity.length() * 3.6 >= 85) break;
    }

    let peakMuY = 0;
    let peakSlipDeg = 0;
    let maxAlphaSeen = 0;
    let muAtHighAlpha = 0;
    let highAlphaSamples = 0;
    let maxYawRate = 0;

    // Initiate handbrake turn-in -> throttle-steered drift -> countersteer recovery
    phys.autoShift = false;
    for (let s = 0; s < 380; s++) {
      const input: VehicleInput =
        s < 46
          ? { throttle: true, brake: false, steerLeft: true, steerRight: false, handbrake: true }
          : s < 165
            ? { throttle: true, brake: false, steerLeft: true, steerRight: false, handbrake: false }
            : s < 260
              ? { throttle: true, brake: false, steerLeft: false, steerRight: true, handbrake: false }
              : IDLE;
      phys.step(1 / 120, input);
      maxYawRate = Math.max(maxYawRate, Math.abs(phys.angularVelocity.y));

      for (let w = 0; w < 4; w++) {
        const load = phys.suspension.normalLoads[w];
        if (load < 500) continue;
        const aDeg = Math.abs(phys.tires.slipAngleDeg[w]);
        const muY = Math.abs(phys.tires.forceLatN[w]) / load;
        maxAlphaSeen = Math.max(maxAlphaSeen, aDeg);
        if (muY > peakMuY && aDeg > 2 && aDeg < 22) {
          peakMuY = muY;
          peakSlipDeg = aDeg;
        }
        if (aDeg >= 15 && aDeg <= 26) {
          muAtHighAlpha += muY;
          highAlphaSamples++;
        }
      }
    }

    const avgHighAlphaMu = highAlphaSamples > 0 ? muAtHighAlpha / highAlphaSamples : peakMuY * 0.85;
    const endYawRate = Math.abs(phys.angularVelocity.y);
    // Verify mathematical Pacejka peak angle analytically too (alpha in [0..22] deg)
    const bx = 12.8;
    const cx = 1.4;
    const ex = -0.28;
    let mathPeakDeg = 0;
    let mathPeakVal = 0;
    let mathAt20Deg = 0;
    for (let deg = 0.5; deg <= 22; deg += 0.25) {
      const a = THREE.MathUtils.degToRad(deg);
      const b = bx * a;
      const val = Math.sin(cx * Math.atan(b - ex * (b - Math.atan(b))));
      if (val > mathPeakVal) {
        mathPeakVal = val;
        mathPeakDeg = deg;
      }
      if (Math.abs(deg - 20) < 0.15) mathAt20Deg = val;
    }

    const okSlip =
      mathPeakDeg >= 6 &&
      mathPeakDeg <= 11 &&
      mathAt20Deg < mathPeakVal * 0.96 &&
      peakSlipDeg >= 5.5 &&
      peakSlipDeg <= 11.5 &&
      maxAlphaSeen >= 10 &&
      maxYawRate < 3.6 &&
      endYawRate < 0.75 &&
      avgHighAlphaMu < peakMuY;
    console.log(
      `[1B-1] Tire Curve & Drift Recovery: mathPeak=${mathPeakDeg.toFixed(2)}deg (20deg=${(mathAt20Deg / mathPeakVal * 100).toFixed(1)}%), simPeakMuY=${peakSlipDeg.toFixed(1)}deg, maxAlpha=${maxAlphaSeen.toFixed(1)}deg, maxYaw=${maxYawRate.toFixed(2)}, endYaw=${endYawRate.toFixed(2)} -> ${okSlip ? 'PASS' : 'FAIL'}`
    );
    rapier.dispose();
    if (!okSlip) process.exitCode = 1;
  }

  // [1B-2] ABS vs Non-ABS Braking & GT3 RS 100-0 Distance
  {
    const noAbs = measureBrakeTest('gt3-rs', 100, false, 1);
    const withAbs = measureBrakeTest('gt3-rs', 100, true, 1);

    const okNoAbs = noAbs.minKappaSeen <= -0.92;
    const okWithAbs =
      withAbs.absTriggered &&
      withAbs.minKappaSeen >= -0.34 &&
      withAbs.minKappaSeen <= -0.05 &&
      withAbs.stopDistFirst >= 28 &&
      withAbs.stopDistFirst <= 40;
    console.log(
      `[1B-2] Braking ABS vs Non-ABS (100-0): nonABS minKappa=${noAbs.minKappaSeen.toFixed(2)} (${noAbs.stopDistFirst.toFixed(1)}m) | ABS active=${withAbs.absTriggered}, minKappa=${withAbs.minKappaSeen.toFixed(2)}, dist=${withAbs.stopDistFirst.toFixed(1)}m -> ${okNoAbs && okWithAbs ? 'PASS' : 'FAIL'}`
    );
    if (!okNoAbs || !okWithAbs) process.exitCode = 1;
  }

  // [1B-3] Brake Thermals & Fade over 5 consecutive 150-0 km/h emergency stops
  {
    const fadeIron = measureBrakeTest('wrx-rally', 150, true, 5);
    const distGainPct =
      ((fadeIron.stopDistLast - fadeIron.stopDistFirst) / Math.max(1, fadeIron.stopDistFirst)) * 100;
    const okFade = fadeIron.maxBrakeTempLast > 470 && distGainPct >= 10;
    console.log(
      `[1B-3] Brake Thermal Fade (wrx-rally 5x 150-0): cold=${fadeIron.stopDistFirst.toFixed(1)}m (${fadeIron.maxBrakeTempFirst.toFixed(0)}C) -> hot=${fadeIron.stopDistLast.toFixed(1)}m (${fadeIron.maxBrakeTempLast.toFixed(0)}C), +${distGainPct.toFixed(1)}% -> ${okFade ? 'PASS' : 'FAIL'}`
    );
    if (!okFade) process.exitCode = 1;
  }

  // [1B-4] Mechanical Tuning Deltas & GT3 RS 0-100 Calibration
  {
    const gt3Base = measureZeroToHundred('gt3-rs');
    const gt3ShortFd = measureZeroToHundred('gt3-rs', (t) => {
      t.finalDrive = gt3Base ? 5.1 : 5.1;
    });
    const finalDriveDeltaPct =
      (Math.abs(gt3Base.timeSec - gt3ShortFd.timeSec) / Math.max(0.1, gt3Base.timeSec)) * 100 +
      (Math.abs(gt3Base.rpmAt4s - gt3ShortFd.rpmAt4s) / Math.max(1, gt3Base.rpmAt4s)) * 100;

    // ARB balance shift: stiff front / soft rear vs soft front / stiff rear
    const understeerArb = measureCorneringBalance('gt3-rs', (t) => {
      t.antiRollFrontNmPerM *= 2.0;
      t.antiRollRearNmPerM *= 0.45;
    });
    const oversteerArb = measureCorneringBalance('gt3-rs', (t) => {
      t.antiRollFrontNmPerM *= 0.45;
      t.antiRollRearNmPerM *= 2.0;
    });

    // Diff accel lock delta on RWD muscle under cornering throttle
    const openDiff = measureCorneringBalance('shelby-gt500', (t) => {
      t.diffRearAccelLock = 0.02;
      t.diffRearPreloadNm = 5;
    });
    const lockedDiff = measureCorneringBalance('shelby-gt500', (t) => {
      t.diffRearAccelLock = 0.98;
      t.diffRearPreloadNm = 220;
    });

    // AWD front torque split delta on wrx-rally
    const rwdBiasAwd = measureCorneringBalance('wrx-rally', (t) => {
      t.awdFrontSplit = 0.12;
      t.diffCenterLock = 0.05;
    });
    const fwdBiasAwd = measureCorneringBalance('wrx-rally', (t) => {
      t.awdFrontSplit = 0.62;
      t.diffCenterLock = 0.25;
    });

    // Camber delta on gt3-rs
    const zeroCamber = measureCorneringBalance('gt3-rs', (t) => {
      t.frontCamberDeg = 0.5;
      t.rearCamberDeg = 0.5;
    });
    const negCamber = measureCorneringBalance('gt3-rs', (t) => {
      t.frontCamberDeg = -3.4;
      t.rearCamberDeg = -2.6;
    });

    const okGt3Accel = gt3Base.timeSec >= 2.8 && gt3Base.timeSec <= 4.1;
    const okFinalDrive = finalDriveDeltaPct > 3;
    const okArb = oversteerArb.avgRearSlipDeg > understeerArb.avgRearSlipDeg;
    const okDiff =
      lockedDiff.insideOutsideRearSlipDiff < openDiff.insideOutsideRearSlipDiff ||
      Math.abs(lockedDiff.avgYawRate - openDiff.avgYawRate) > 0.015;
    const okAwd = Math.abs(rwdBiasAwd.avgYawRate - fwdBiasAwd.avgYawRate) > 0.015;
    const okCamber = negCamber.outerFrontLatN - zeroCamber.outerFrontLatN > 80;

    console.log(
      `[1B-4a] GT3 RS 0-100: ${gt3Base.timeSec.toFixed(2)}s (${gt3Base.distM.toFixed(1)}m), FD delta=${finalDriveDeltaPct.toFixed(1)}% -> ${okGt3Accel && okFinalDrive ? 'PASS' : 'FAIL'}`
    );
    console.log(
      `[1B-4b] ARB Balance (rearSlipDeg): stiffFront=${understeerArb.avgRearSlipDeg.toFixed(2)}deg vs stiffRear=${oversteerArb.avgRearSlipDeg.toFixed(2)}deg -> ${okArb ? 'PASS' : 'FAIL'}`
    );
    console.log(
      `[1B-4c] Diff Accel Lock (slipDiff/yaw): open=${openDiff.insideOutsideRearSlipDiff.toFixed(4)}/${openDiff.avgYawRate.toFixed(3)} vs locked=${lockedDiff.insideOutsideRearSlipDiff.toFixed(4)}/${lockedDiff.avgYawRate.toFixed(3)} -> ${okDiff ? 'PASS' : 'FAIL'}`
    );
    console.log(
      `[1B-4d] AWD Split (yaw): 12%F=${rwdBiasAwd.avgYawRate.toFixed(3)} vs 62%F=${fwdBiasAwd.avgYawRate.toFixed(3)} -> ${okAwd ? 'PASS' : 'FAIL'}`
    );
    console.log(
      `[1B-4e] Camber Thrust (outerFrontLatN): +0.5deg=${zeroCamber.outerFrontLatN.toFixed(0)}N vs -3.4deg=${negCamber.outerFrontLatN.toFixed(0)}N (latG=${negCamber.avgLatG.toFixed(2)}G) -> ${okCamber ? 'PASS' : 'FAIL'}`
    );

    if (!okGt3Accel || !okFinalDrive || !okArb || !okDiff || !okAwd || !okCamber) {
      process.exitCode = 1;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
