import * as THREE from 'three';
import { CARS } from '../src/data/cars';
import { VehicleInput, VehiclePhysics } from '../src/engine/physics';
import { ensureRapierInitialized, RapierWorldManager } from '../src/engine/rapierWorld';
import { PLAYABLE_LIMIT, sampleTerrain, setActiveTerrainMap } from '../src/engine/terrain';
import { WorldCollider } from '../src/types/vehicle';

const IDLE_INPUT: VehicleInput = {
  throttle: false,
  brake: false,
  steerLeft: false,
  steerRight: false,
  handbrake: false,
};

const THROTTLE_INPUT: VehicleInput = {
  throttle: true,
  brake: false,
  steerLeft: false,
  steerRight: false,
  handbrake: false,
};

const BRAKE_INPUT: VehicleInput = {
  throttle: false,
  brake: true,
  steerLeft: false,
  steerRight: false,
  handbrake: true,
};

function findSlopeSpot(targetDeg: number): { x: number; z: number; deg: number; heading: number } {
  let best = { x: -115, z: -115, deg: 0, heading: 0, err: 999 };
  for (let x = -220; x <= 220; x += 3) {
    for (let z = -220; z <= 220; z += 3) {
      const s = sampleTerrain(x, z);
      const deg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(s.normalY, -1, 1)));
      const err = Math.abs(deg - targetDeg);
      if (err < best.err) {
        const heading = Math.atan2(s.normalX, s.normalZ);
        best = { x, z, deg, heading, err };
      }
    }
  }
  return best;
}

async function run() {
  await ensureRapierInitialized();
  setActiveTerrainMap('mountain-pass');

  const gt3 = CARS.find((c) => c.id === 'gt3-rs') ?? CARS[0];

  const colliders: WorldCollider[] = [
    { type: 'box', minX: -4, maxX: 4, minZ: -38, maxZ: -34, maxY: 3.0 },
  ];

  // Test 1: Flat rest hold
  {
    setActiveTerrainMap('proving-valley');
    const rapier = new RapierWorldManager(gt3, colliders);
    const phys = new VehiclePhysics(gt3, rapier);
    phys.reset(new THREE.Vector3(0, 0, 16), 0);

    for (let i = 0; i < 360; i++) {
      phys.step(1 / 120, IDLE_INPUT);
    }
    const speedFlat = phys.velocity.length();
    const okFlat = speedFlat < 0.0005 && Number.isFinite(speedFlat);
    console.log(`[1A-1] Flat Rest Creep: ${(speedFlat * 1000).toFixed(4)} mm/s (limit < 0.5 mm/s) -> ${okFlat ? 'PASS' : 'FAIL'}`);
    rapier.dispose();
    if (!okFlat) process.exitCode = 1;
  }

  // Test 2: ~25 deg slope hold (standstill creep + post-brake hold)
  {
    setActiveTerrainMap('mountain-pass');
    const slope = findSlopeSpot(25);
    const rapier = new RapierWorldManager(gt3, []);
    const phys = new VehiclePhysics(gt3, rapier);
    phys.reset(new THREE.Vector3(slope.x, 0, slope.z), slope.heading);

    for (let i = 0; i < 360; i++) {
      phys.step(1 / 120, IDLE_INPUT);
    }
    const pStart = phys.position.clone();
    for (let i = 0; i < 240; i++) {
      phys.step(1 / 120, IDLE_INPUT);
    }
    const driftSpeed = phys.position.distanceTo(pStart) / 2.0;
    const velSlope = phys.velocity.length();
    const okSlope = velSlope < 0.0005 && driftSpeed < 0.0005 && Number.isFinite(velSlope);
    console.log(
      `[1A-2] ${slope.deg.toFixed(1)} deg Slope Creep at (${slope.x},${slope.z}): vel=${(velSlope * 1000).toFixed(4)} mm/s, drift=${(driftSpeed * 1000).toFixed(4)} mm/s (limit < 0.5 mm/s) -> ${okSlope ? 'PASS' : 'FAIL'}`
    );
    rapier.dispose();
    if (!okSlope) process.exitCode = 1;
  }

  // Test 3: 1.5m Drop Test
  {
    setActiveTerrainMap('proving-valley');
    const rapier = new RapierWorldManager(gt3, []);
    const phys = new VehiclePhysics(gt3, rapier);
    const groundY = sampleTerrain(0, 16).height;
    phys.reset(new THREE.Vector3(0, groundY + 1.5, 16), 0);

    let maxPosY = -Infinity;
    let minPosY = Infinity;
    let hasNaN = false;
    for (let i = 0; i < 480; i++) {
      phys.step(1 / 120, IDLE_INPUT);
      if (!Number.isFinite(phys.position.y) || !Number.isFinite(phys.velocity.y)) {
        hasNaN = true;
      }
      if (phys.position.y > maxPosY) maxPosY = phys.position.y;
      if (phys.position.y < minPosY) minPosY = phys.position.y;
    }
    const settleSpeed = phys.velocity.length();
    const okDrop = !hasNaN && maxPosY < groundY + 3.0 && minPosY > groundY - 0.1 && settleSpeed < 0.05;
    console.log(
      `[1A-3] 1.5m Drop Test: settleVel=${(settleSpeed * 1000).toFixed(2)} mm/s, yRange=[${minPosY.toFixed(3)}, ${maxPosY.toFixed(3)}], ground=${groundY.toFixed(3)} -> ${okDrop ? 'PASS' : 'FAIL'}`
    );
    rapier.dispose();
    if (!okDrop) process.exitCode = 1;
  }

  // Test 4: Frame-rate invariance (30 fps vs 120 fps for 0-100 km/h)
  {
    setActiveTerrainMap('proving-valley');
    const runAccel = (frameDt: number) => {
      const rapier = new RapierWorldManager(gt3, []);
      const phys = new VehiclePhysics(gt3, rapier);
      phys.reset(new THREE.Vector3(0, 0, 180), 0);
      let elapsed = 0;
      let hitTime = -1;
      let hitDist = -1;
      while (elapsed < 10) {
        phys.step(frameDt, THROTTLE_INPUT);
        elapsed += frameDt;
        const kmh = phys.velocity.length() * 3.6;
        if (kmh >= 100 && hitTime < 0) {
          hitTime = elapsed;
          hitDist = phys.distanceMeters;
          break;
        }
      }
      rapier.dispose();
      return { hitTime, hitDist };
    };

    const r30 = runAccel(1 / 30);
    const r120 = runAccel(1 / 120);
    const timeVar = Math.abs(r30.hitTime - r120.hitTime) / Math.max(0.01, r120.hitTime);
    const distVar = Math.abs(r30.hitDist - r120.hitDist) / Math.max(0.01, r120.hitDist);
    const okFps = r30.hitTime > 0 && r120.hitTime > 0 && timeVar < 0.02 && distVar < 0.02;
    console.log(
      `[1A-4] FPS Invariance 0-100: 30fps=${r30.hitTime.toFixed(3)}s (${r30.hitDist.toFixed(2)}m), 120fps=${r120.hitTime.toFixed(3)}s (${r120.hitDist.toFixed(2)}m) | diff=${(timeVar * 100).toFixed(2)}% / ${(distVar * 100).toFixed(2)}% -> ${okFps ? 'PASS' : 'FAIL'}`
    );
    if (!okFps) process.exitCode = 1;
  }

  // Test 5: Barrier collision & boundary containment (no tunneling)
  {
    setActiveTerrainMap('proving-valley');
    const rapier = new RapierWorldManager(gt3, colliders);
    const phys = new VehiclePhysics(gt3, rapier);
    phys.reset(new THREE.Vector3(0, 0, 0), 0);
    let collisionCount = 0;
    let maxSev = 0;
    let minZ = Infinity;
    for (let i = 0; i < 420; i++) {
      phys.step(1 / 60, THROTTLE_INPUT);
      const cols = phys.drainCollisions();
      for (const c of cols) {
        collisionCount++;
        maxSev = Math.max(maxSev, c.severity);
      }
      minZ = Math.min(minZ, phys.position.z);
    }
    const stoppedBeforeWall = minZ > -36 && minZ < -25;
    const okWall = collisionCount > 0 && maxSev > 0.05 && stoppedBeforeWall;
    console.log(
      `[1A-5] Barrier Collision: hits=${collisionCount}, maxSev=${maxSev.toFixed(2)}, minZ=${minZ.toFixed(2)} -> ${okWall ? 'PASS' : 'FAIL'}`
    );
    rapier.dispose();
    if (!okWall) process.exitCode = 1;
  }

  // Test 6: All 5 cars sanity check + boundary wall check
  {
    setActiveTerrainMap('proving-valley');
    for (const c of CARS) {
      const rapier = new RapierWorldManager(c, []);
      const phys = new VehiclePhysics(c, rapier);
      phys.reset(new THREE.Vector3(0, 0, 16), 0);
      for (let i = 0; i < 180; i++) {
        phys.step(1 / 60, THROTTLE_INPUT);
      }
      const kmh = phys.velocity.length() * 3.6;
      const valid = Number.isFinite(kmh) && kmh > 30 && Math.abs(phys.position.x) < PLAYABLE_LIMIT;
      console.log(`[1A-6] Car Sanity (${c.id}): 3s speed=${kmh.toFixed(1)} km/h, valid=${valid}`);
      rapier.dispose();
      if (!valid) process.exitCode = 1;
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
