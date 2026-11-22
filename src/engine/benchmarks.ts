import * as THREE from 'three';
import { CarSpec, VehicleTuningSetup, WorldCollider } from '../types/vehicle';
import { cloneTuning } from './dynamics/tuning';
import { VehicleInput, VehiclePhysics } from './physics';
import { ensureRapierInitialized, FIXED_PHYSICS_DT, RapierWorldManager } from './rapierWorld';
import { BenchmarkMetricItem, BenchmarkSuiteSummary } from './storage';
import { getActiveTerrainMap, setActiveTerrainMap } from './terrain';

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

export type BenchmarkId =
  | 'accel-0-100'
  | 'coast-down'
  | 'brake-100-0'
  | 'split-mu-brake'
  | 'skidpad-40m'
  | 'step-steer'
  | 'iso-dlc'
  | 'rebound-drop'
  | 'high-speed-stability'
  | 'multi-surface'
  | 'collision-integrity';

export const BENCHMARK_ORDER: readonly BenchmarkId[] = [
  'accel-0-100',
  'coast-down',
  'brake-100-0',
  'split-mu-brake',
  'skidpad-40m',
  'step-steer',
  'iso-dlc',
  'rebound-drop',
  'high-speed-stability',
  'multi-surface',
  'collision-integrity',
];

function createSim(
  car: CarSpec,
  tuning: VehicleTuningSetup,
  colliders: WorldCollider[] = []
): { rapier: RapierWorldManager; phys: VehiclePhysics } {
  const rapier = new RapierWorldManager(car, colliders);
  const phys = new VehiclePhysics(car, rapier, cloneTuning(tuning));
  return { rapier, phys };
}

function getYawRad(q: THREE.Quaternion): number {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-fwd.x, -fwd.z);
}

function wrapAngleRad(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Helper to drive one fixed step with an arbitrary continuous steer override [-1..1]
 * without bypassing Rapier rigid-body integration.
 */
function stepWithSteerOverride(
  phys: VehiclePhysics,
  dt: number,
  input: VehicleInput,
  steerNormOverride: number
): void {
  const clamped = Math.max(-1, Math.min(1, steerNormOverride));
  phys.step(dt, { ...input, steerLeft: false, steerRight: false, steerOverride: clamped });
}

export async function runSingleBenchmark(
  id: BenchmarkId,
  car: CarSpec,
  tuning: VehicleTuningSetup
): Promise<BenchmarkMetricItem> {
  await ensureRapierInitialized();
  const prevMap = getActiveTerrainMap();
  setActiveTerrainMap('testing-facility');

  try {
    if (id === 'accel-0-100') {
      const { rapier, phys } = createSim(car, tuning);
      try {
        phys.reset(new THREE.Vector3(0, 0, 260), 0);
        let t60 = -1;
        let t100 = -1;
        let t160 = -1;
        let d100 = 0;
        let peakKmh = 0;

        for (let s = 1; s <= 1440; s++) {
          phys.step(FIXED_PHYSICS_DT, THROTTLE);
          const kmh = phys.velocity.length() * 3.6;
          if (kmh > peakKmh) peakKmh = kmh;
          if (kmh >= 60 && t60 < 0) t60 = s * FIXED_PHYSICS_DT;
          if (kmh >= 100 && t100 < 0) {
            t100 = s * FIXED_PHYSICS_DT;
            d100 = phys.distanceMeters;
          }
          if (kmh >= 160 && t160 < 0) {
            t160 = s * FIXED_PHYSICS_DT;
          }
        }
        const [limitMin, limitMax] =
          car.id === 'gt3-rs'
            ? [2.7, 3.9]
            : car.id === 'shelby-gt500'
              ? [3.2, 4.4]
              : car.id === 'wrx-rally'
                ? [3.7, 5.2]
                : car.id === 'g63-4x4'
                  ? [4.5, 5.9]
                  : [5.5, 8.2];
        const passed = t100 >= limitMin && t100 <= limitMax && Number.isFinite(peakKmh);
        const target = `${limitMin.toFixed(1)} – ${limitMax.toFixed(1)} s`;
        return {
          id,
          name: '0–100 km/h Acceleration',
          measured: `${t100.toFixed(2)} s (0–60 ${t60.toFixed(2)}s, ${d100.toFixed(1)} m${t160 > 0 ? `, 0–160 ${t160.toFixed(2)}s` : ''})`,
          target,
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'coast-down') {
      const { rapier, phys } = createSim(car, tuning);
      try {
        phys.reset(new THREE.Vector3(0, 0, 270), 0);
        for (let s = 0; s < 1400; s++) {
          phys.step(FIXED_PHYSICS_DT, THROTTLE);
          if (phys.velocity.length() * 3.6 >= 125) break;
        }
        phys.autoShift = false;
        phys.setGear(0); // Neutral coast-down
        let started = false;
        let startTime = 0;
        let startDist = 0;
        let endTime = 0;
        let endDist = 0;
        let maxSpeedIncrease = 0;
        let prevSpeed = phys.velocity.length();

        for (let s = 1; s <= 9600; s++) {
          phys.step(FIXED_PHYSICS_DT, IDLE);
          const v = phys.velocity.length();
          if (v - prevSpeed > 0.02) maxSpeedIncrease = Math.max(maxSpeedIncrease, v - prevSpeed);
          prevSpeed = v;
          const kmh = v * 3.6;
          if (!started && kmh <= 120) {
            started = true;
            startTime = s * FIXED_PHYSICS_DT;
            startDist = phys.distanceMeters;
          }
          if (started && kmh <= 20) {
            endTime = s * FIXED_PHYSICS_DT - startTime;
            endDist = phys.distanceMeters - startDist;
            break;
          }
        }
        const passed = started && endTime > 8 && endTime < 78 && maxSpeedIncrease < 0.05;
        return {
          id,
          name: '120 → 20 km/h Coast-Down',
          measured: started && endTime > 0 ? `${endTime.toFixed(1)} s / ${endDist.toFixed(0)} m` : 'Incomplete',
          target: 'Monotonic drag decel (8–78 s)',
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'brake-100-0') {
      const { rapier, phys } = createSim(car, { ...tuning, absEnabled: true });
      try {
        phys.reset(new THREE.Vector3(0, 0, 260), 0);
        for (let s = 0; s < 1400; s++) {
          phys.step(FIXED_PHYSICS_DT, THROTTLE);
          if (phys.velocity.length() * 3.6 >= 100) break;
        }
        const startZ = phys.position.z;
        let minKappa = 1;
        let absWorked = false;
        for (let s = 0; s < 1000; s++) {
          phys.step(FIXED_PHYSICS_DT, BRAKE_ONLY);
          const kmh = phys.velocity.length() * 3.6;
          if (kmh > 15) {
            for (let w = 0; w < 4; w++) minKappa = Math.min(minKappa, phys.tires.slipRatio[w]);
            if (phys.absActive) absWorked = true;
          }
          if (kmh <= 1.0) break;
        }
        const dist = Math.abs(startZ - phys.position.z);
        const [minDist, maxDist] = car.bodyStyle === 'suv' ? [38, 56] : [30, 44];
        const passed = dist >= minDist && dist <= maxDist && absWorked && minKappa >= -0.35;
        return {
          id,
          name: '100–0 km/h Emergency Brake (ABS)',
          measured: `${dist.toFixed(1)} m (min κ ${minKappa.toFixed(2)})`,
          target: `${minDist}–${maxDist} m, ABS active`,
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'split-mu-brake') {
      const runSplit = (absEnabled: boolean) => {
        const { rapier, phys } = createSim(car, { ...tuning, absEnabled });
        try {
          // Accelerate straight on uniform apron tarmac (z=215 -> z<=155) aligned on x=46.0 boundary (left μ=1.08, right μ=0.30)
          phys.reset(new THREE.Vector3(46.0, 0, 215), 0);
          for (let s = 0; s < 1100; s++) {
            const yaw = getYawRad(phys.quaternion);
            const steerHold = THREE.MathUtils.clamp(
              (46.0 - phys.position.x) * -0.22 - yaw * 1.8 - phys.angularVelocity.y * 0.25,
              -0.5,
              0.5
            );
            stepWithSteerOverride(phys, FIXED_PHYSICS_DT, THROTTLE, steerHold);
            if (phys.velocity.length() * 3.6 >= 85 && phys.position.z <= 152) break;
          }
          const initialYaw = getYawRad(phys.quaternion);
          let maxYawDevDeg = 0;
          for (let s = 0; s < 480; s++) {
            phys.step(FIXED_PHYSICS_DT, BRAKE_ONLY);
            const devDeg = Math.abs(THREE.MathUtils.radToDeg(wrapAngleRad(getYawRad(phys.quaternion) - initialYaw)));
            if (devDeg > maxYawDevDeg) maxYawDevDeg = devDeg;
            if (phys.velocity.length() * 3.6 <= 3) break;
          }
          return maxYawDevDeg;
        } finally {
          rapier.dispose();
        }
      };

      const yawAbsOff = runSplit(false);
      const yawAbsOn = runSplit(true);
      const passed = yawAbsOff > 5.0 && yawAbsOn < 32.0 && yawAbsOn <= yawAbsOff * 0.85;
      return {
        id,
        name: 'Split-μ Braking (1.08 / 0.30)',
        measured: `ABS OFF ${yawAbsOff.toFixed(1)}° vs ABS ON ${yawAbsOn.toFixed(1)}°`,
        target: 'ABS reduces split-μ yaw pull',
        passed,
      };
    }

    if (id === 'skidpad-40m') {
      const { rapier, phys } = createSim(car, tuning);
      try {
        // Spawn on tangent of R=40m skid pad centered at (-90, 0), heading North (-Z) at (-50, 0)
        phys.reset(new THREE.Vector3(-50, 0, 0), 0);
        let latGSum = 0;
        let latGCount = 0;
        let maxRollDeg = 0;
        let radiusErrSum = 0;

        for (let s = 0; s < 1080; s++) {
          const dx = phys.position.x + 90;
          const dz = phys.position.z;
          const currR = Math.hypot(dx, dz) || 40;
          const rErr = currR - 40.0;
          // CCW tangent vector around (-90, 0): at (-50, 0), tangent is North (0, -1)
          const tx = dz / currR;
          const tz = -dx / currR;
          const targetYaw = Math.atan2(-tx, -tz);
          const yawErr = wrapAngleRad(targetYaw - getYawRad(phys.quaternion));
          // Positive steer bends Left/CCW
          const steerCmd = THREE.MathUtils.clamp(
            0.34 + yawErr * 1.65 + rErr * 0.055 - phys.angularVelocity.y * 0.12,
            -0.65,
            0.95
          );
          const speedKmh = phys.velocity.length() * 3.6;
          const targetSpd = car.bodyStyle === 'suv' ? 62 : 70;
          const inp: VehicleInput = {
            throttle: speedKmh < targetSpd,
            brake: speedKmh > targetSpd + 6,
            steerLeft: false,
            steerRight: false,
            handbrake: false,
          };
          stepWithSteerOverride(phys, FIXED_PHYSICS_DT, inp, steerCmd);

          if (s >= 480) {
            latGSum += Math.abs(phys.lateralG);
            radiusErrSum += Math.abs(rErr);
            latGCount++;
          }
          const rollAbs = Math.abs(phys.getTelemetry().rollDeg);
          if (rollAbs > maxRollDeg) maxRollDeg = rollAbs;
        }
        const avgLatG = latGSum / Math.max(1, latGCount);
        const avgRErr = radiusErrSum / Math.max(1, latGCount);
        const minG = car.bodyStyle === 'suv' ? 0.68 : 0.85;
        const passed = avgLatG >= minG && maxRollDeg < 18 && avgRErr < 12;
        return {
          id,
          name: 'Constant-Radius Skid Pad (R=40m)',
          measured: `${avgLatG.toFixed(2)} G (roll ${maxRollDeg.toFixed(1)}°, ΔR ${avgRErr.toFixed(1)}m)`,
          target: `≥ ${minG.toFixed(2)} G, roll < 18°`,
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'step-steer') {
      const { rapier, phys } = createSim(car, tuning);
      try {
        phys.reset(new THREE.Vector3(0, 0, 220), 0);
        for (let s = 0; s < 900; s++) {
          phys.step(FIXED_PHYSICS_DT, THROTTLE);
          if (phys.velocity.length() * 3.6 >= 80) break;
        }
        let peakYaw = 0;
        let steadyYaw = 0;
        let steadySamples = 0;
        for (let s = 0; s < 240; s++) {
          phys.step(FIXED_PHYSICS_DT, STEER_LEFT_THROTTLE);
          const yr = Math.abs(phys.angularVelocity.y);
          if (yr > peakYaw) peakYaw = yr;
          if (s >= 150) {
            steadyYaw += yr;
            steadySamples++;
          }
        }
        steadyYaw /= Math.max(1, steadySamples);
        for (let s = 0; s < 140; s++) {
          phys.step(FIXED_PHYSICS_DT, IDLE);
        }
        const endYaw = Math.abs(phys.angularVelocity.y);
        const overshootPct = steadyYaw > 0.05 ? Math.max(0, ((peakYaw - steadyYaw) / steadyYaw) * 100) : 0;
        const passed = peakYaw > 0.35 && overshootPct < 55 && endYaw < 0.25;
        return {
          id,
          name: 'Step-Steer Transient (80 km/h)',
          measured: `peak ${peakYaw.toFixed(2)} rad/s, ovs ${overshootPct.toFixed(0)}%, end ${endYaw.toFixed(2)}`,
          target: 'overshoot < 55%, clean settle',
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'iso-dlc') {
      const { rapier, phys } = createSim(car, tuning);
      try {
        // Drive ISO Double Lane Change along x=-28 -> shift left to x=-35.5 -> return to x=-28 at ~82-86 km/h
        phys.reset(new THREE.Vector3(-28, 0, 120), 0);
        for (let s = 0; s < 1000; s++) {
          const yaw = getYawRad(phys.quaternion);
          const errX = -28 - phys.position.x;
          const kmh = phys.velocity.length() * 3.6;
          const prepInput: VehicleInput = {
            throttle: kmh < 84,
            brake: kmh > 90,
            steerLeft: false,
            steerRight: false,
            handbrake: false,
          };
          stepWithSteerOverride(
            phys,
            FIXED_PHYSICS_DT,
            prepInput,
            THREE.MathUtils.clamp(-errX * 0.14 - yaw * 1.4, -0.5, 0.5)
          );
          if (kmh >= 78 && phys.position.z <= 25) break;
        }
        let maxRoll = 0;
        let peakLatG = 0;
        let minReachedX = 0;
        const smoothRamp = (e0: number, e1: number, xVal: number) => {
          const t = Math.max(0, Math.min(1, (xVal - e0) / (e1 - e0)));
          return t * t * (3 - 2 * t);
        };
        for (let s = 0; s < 960; s++) {
          const zLook = phys.position.z - 9;
          // Smooth S-curve transitions across the two ISO gates
          const intoShift = smoothRamp(-12, -26, zLook);
          const backShift = smoothRamp(-72, -88, zLook);
          const targetX = -28 - 7.5 * intoShift * (1 - backShift);
          const errX = targetX - phys.position.x;
          const yaw = getYawRad(phys.quaternion);
          // Positive steer bends -X (left); damped PD keeps exit clean on return lane
          const steerCmd = THREE.MathUtils.clamp(
            -errX * 0.11 - yaw * 1.9 - phys.angularVelocity.y * 0.28,
            -0.95,
            0.95
          );
          const spdKmh = phys.velocity.length() * 3.6;
          const dlcInput: VehicleInput = {
            throttle: spdKmh < 84,
            brake: false,
            steerLeft: false,
            steerRight: false,
            handbrake: false,
          };
          stepWithSteerOverride(phys, FIXED_PHYSICS_DT, dlcInput, steerCmd);
          minReachedX = Math.min(minReachedX, phys.position.x);
          peakLatG = Math.max(peakLatG, Math.abs(phys.lateralG));
          maxRoll = Math.max(maxRoll, Math.abs(phys.getTelemetry().rollDeg));
          if (phys.position.z <= -130) break;
        }
        const finalErr = Math.abs(phys.position.x - -28);
        const passed = minReachedX <= -33.5 && finalErr <= 4.0 && maxRoll < 20 && peakLatG > 0.35;
        return {
          id,
          name: 'ISO Double Lane Change (78+ km/h)',
          measured: `peak ${peakLatG.toFixed(2)} G, roll ${maxRoll.toFixed(1)}°, exit ΔX ${finalErr.toFixed(1)}m`,
          target: 'Complete lane shift, ΔX ≤ 4.0m',
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'rebound-drop') {
      const { rapier, phys } = createSim(car, tuning);
      try {
        phys.reset(new THREE.Vector3(0, 1.35, 0), 0);
        let minY = 99;
        let maxCompNorm = 0;
        let cycles = 0;
        let prevVy = 0;
        for (let s = 0; s < 240; s++) {
          phys.step(FIXED_PHYSICS_DT, IDLE);
          if (phys.currPosition.y < minY) minY = phys.currPosition.y;
          const compNorm = Math.max(...phys.wheelCompression) / Math.max(0.05, car.suspensionMaxTravel);
          if (compNorm > maxCompNorm) maxCompNorm = compNorm;
          if (s > 30 && prevVy > 0.05 && phys.velocity.y <= 0.05) cycles++;
          prevVy = phys.velocity.y;
        }
        const settleVel = Math.abs(phys.velocity.y);
        const passed = settleVel < 0.03 && cycles <= 5 && minY > 0.15;
        return {
          id,
          name: 'Suspension Rebound (1.0m Drop)',
          measured: `settle ${(settleVel * 1000).toFixed(1)} mm/s, cycles ${cycles}, comp ${(maxCompNorm * 100).toFixed(0)}%`,
          target: 'settle < 30 mm/s in ≤ 5 cycles',
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'high-speed-stability') {
      const { rapier, phys } = createSim(car, tuning);
      try {
        phys.reset(new THREE.Vector3(0, 0, 650), 0);
        for (let s = 0; s < 2760; s++) {
          const steerImpulse = s >= 2460 && s < 2490 ? 0.24 : 0;
          stepWithSteerOverride(phys, FIXED_PHYSICS_DT, THROTTLE, steerImpulse);
        }
        const topKmh = phys.velocity.length() * 3.6;
        // Recover for 1.5s straight
        for (let s = 0; s < 180; s++) {
          phys.step(FIXED_PHYSICS_DT, THROTTLE);
        }
        const endYaw = Math.abs(phys.angularVelocity.y);
        const roll = Math.abs(phys.getTelemetry().rollDeg);
        const minTargetKmh =
          car.id === 'defender-v8'
            ? 172
            : car.id === 'g63-4x4'
              ? 185
              : car.id === 'wrx-rally'
                ? 192
                : 240;
        const passed = topKmh >= minTargetKmh && endYaw < 0.25 && roll < 12;
        return {
          id,
          name: 'High-Speed Stability & Perturbation',
          measured: `${topKmh.toFixed(0)} km/h, endYaw ${endYaw.toFixed(2)}, roll ${roll.toFixed(1)}°`,
          target: `≥ ${minTargetKmh} km/h, damped recovery`,
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }

    if (id === 'multi-surface') {
      const runStrip = (xPos: number) => {
        const { rapier, phys } = createSim(car, tuning);
        try {
          phys.reset(new THREE.Vector3(xPos, 0, 282), 0);
          let t50 = -1;
          for (let s = 1; s <= 720; s++) {
            phys.step(FIXED_PHYSICS_DT, THROTTLE);
            if (phys.velocity.length() * 3.6 >= 50 && t50 < 0) {
              t50 = s * FIXED_PHYSICS_DT;
              break;
            }
          }
          return t50 > 0 ? t50 : 6.0;
        } finally {
          rapier.dispose();
        }
      };

      const tAsphalt = runStrip(48);
      const tCobble = runStrip(76);
      const tGravel = runStrip(104);
      const tSand = runStrip(133);
      const passed =
        tAsphalt <= tGravel + 0.05 && tAsphalt <= tSand + 0.05 && Number.isFinite(tSand);
      return {
        id,
        name: 'Multi-Surface Traction (0–50 km/h)',
        measured: `Tarmac ${tAsphalt.toFixed(2)}s · Cobble ${tCobble.toFixed(2)}s · Gravel ${tGravel.toFixed(2)}s · Sand ${tSand.toFixed(2)}s`,
        target: 'Surface-differentiated traction',
        passed,
      };
    }

    // collision-integrity
    {
      const barrier: WorldCollider = {
        type: 'box',
        minX: -6,
        maxX: 6,
        minZ: -38,
        maxZ: -32,
        maxY: 2.5,
      };
      const { rapier, phys } = createSim(car, tuning, [barrier]);
      try {
        phys.reset(new THREE.Vector3(0, 0, 24), 0);
        let impactSpeedKmh = 0;
        let totalHits = 0;
        for (let s = 0; s < 600; s++) {
          const preKmh = phys.velocity.length() * 3.6;
          phys.step(FIXED_PHYSICS_DT, THROTTLE);
          const cols = phys.drainCollisions();
          if (cols.length > 0 && impactSpeedKmh === 0) {
            impactSpeedKmh = preKmh;
          }
          totalHits += cols.length;
        }
        const postKmh = phys.velocity.length() * 3.6;
        const tel = phys.getTelemetry();
        const noTunnel = phys.position.z >= -32.8 && Number.isFinite(phys.position.z);
        const passed =
          totalHits >= 1 &&
          impactSpeedKmh > 40 &&
          postKmh < 25 &&
          tel.damage.overallIntegrity < 100 &&
          noTunnel;
        return {
          id: 'collision-integrity',
          name: 'Barrier Collision & Momentum',
          measured: `hit @ ${impactSpeedKmh.toFixed(0)} km/h → ${postKmh.toFixed(1)} km/h, integrity ${tel.damage.overallIntegrity}%`,
          target: 'Zero tunneling, realistic impact damage',
          passed,
        };
      } finally {
        rapier.dispose();
      }
    }
  } finally {
    setActiveTerrainMap(prevMap);
  }
}

export async function runAllBenchmarks(
  car: CarSpec,
  tuning: VehicleTuningSetup,
  onProgress?: (completed: number, total: number, latest: BenchmarkMetricItem) => void
): Promise<BenchmarkSuiteSummary> {
  const results: BenchmarkMetricItem[] = [];
  for (let i = 0; i < BENCHMARK_ORDER.length; i++) {
    const id = BENCHMARK_ORDER[i];
    const item = await runSingleBenchmark(id, car, tuning);
    results.push(item);
    onProgress?.(i + 1, BENCHMARK_ORDER.length, item);
    if (typeof window !== 'undefined') {
      await new Promise((r) => window.setTimeout(r, 0));
    }
  }
  const passedCount = results.filter((r) => r.passed).length;
  return {
    carId: car.id,
    carName: car.name,
    timestampIso: new Date().toISOString(),
    passedCount,
    totalCount: results.length,
    results,
  };
}
