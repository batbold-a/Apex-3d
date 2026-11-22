import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CARS } from '../../data/cars';
import {
  AIBehaviorMode,
  PinballConfig,
  PinballImpactEvent,
  PinballRadarBlip,
} from '../../types/pinball';
import { CarSpec, MapId } from '../../types/vehicle';
import { CarVisualRig, createCarVisualRig } from '../carModels';
import {
  CG_CHASSIS,
  CG_DYNAMIC_PROP,
  CG_OBSTACLE,
  CG_TERRAIN,
  packInteractionGroups,
  RapierWorldManager,
} from '../rapierWorld';
import {
  BAJA_EAST_LOOP_POINTS,
  BAJA_WEST_LOOP_POINTS,
  mountainRoadCenterX,
  PLAYABLE_LIMIT,
  sampleTerrain,
  TerrainSample,
} from '../terrain';

const AI_GROUPS = packInteractionGroups(
  CG_DYNAMIC_PROP,
  CG_TERRAIN | CG_OBSTACLE | CG_CHASSIS | CG_DYNAMIC_PROP
);

const OBSTACLE_WHISKER_GROUPS = packInteractionGroups(CG_DYNAMIC_PROP, CG_OBSTACLE);

const AI_PAINTS = [
  '#EF4444', // Racing Red
  '#F59E0B', // Signal Amber
  '#10B981', // Emerald
  '#38BDF8', // Cyan
  '#A855F7', // Ultraviolet
  '#F97316', // Baja Orange
  '#EC4899', // Magenta
  '#E2E8F0', // Arctic Silver
];

const WHEEL_LAYOUT: readonly [number, number, boolean][] = [
  [-1, -1, true], // FL
  [1, -1, true], // FR
  [-1, 1, false], // RL
  [1, 1, false], // RR
];

// Map waypoint loops (XZ meters)
function getMapWaypoints(mapId: MapId): [number, number][] {
  if (mapId === 'proving-valley') {
    const pts: [number, number][] = [];
    const span = 210;
    const r = 75;
    const c = span - r;
    const corners: [number, number, number][] = [
      [c, c, 0],
      [-c, c, Math.PI * 0.5],
      [-c, -c, Math.PI],
      [c, -c, Math.PI * 1.5],
    ];
    for (const [cx, cz, startA] of corners) {
      for (let i = 0; i <= 4; i++) {
        const a = startA + (i / 4) * (Math.PI * 0.5);
        pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    }
    return pts;
  }
  if (mapId === 'mountain-pass') {
    const pts: [number, number][] = [];
    for (let z = 140; z >= -150; z -= 35) {
      pts.push([mountainRoadCenterX(z), z]);
    }
    for (let z = -140; z <= 130; z += 35) {
      pts.push([mountainRoadCenterX(z) + 12, z]);
    }
    return pts;
  }
  if (mapId === 'desert-baja') {
    return [
      ...BAJA_EAST_LOOP_POINTS.map((p) => [p[0], p[1]] as [number, number]),
      ...BAJA_WEST_LOOP_POINTS.slice().reverse().map((p) => [p[0], p[1]] as [number, number]),
    ];
  }
  if (mapId === 'highway-circuit') {
    return [
      [0, 140],
      [0, -140],
      [95, -210],
      [215, -140],
      [215, 140],
      [95, 210],
    ];
  }
  // testing-facility outer perimeter
  return [
    [-70, 220],
    [-70, 40],
    [-85, -90],
    [0, -140],
    [95, -60],
    [95, 180],
    [0, 250],
  ];
}

// Pre-allocated scratch math helpers (zero allocations in 120 Hz loop)
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();
const _v3C = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _mountLocal = new THREE.Vector3();
const _mountWorld = new THREE.Vector3();
const _wheelDirF = new THREE.Vector3();
const _wheelDirR = new THREE.Vector3();
const _eulerTmp = new THREE.Euler(0, 0, 0, 'YXZ');
const _quatTmp = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _normVec = new THREE.Vector3();
const _vecArg = { x: 0, y: 0, z: 0 };
const _ptArg = { x: 0, y: 0, z: 0 };
const _rotArg = { x: 0, y: 0, z: 0, w: 1 };

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export interface AITargetUnit {
  id: number;
  car: CarSpec;
  paintHex: string;
  body: RAPIER.RigidBody;
  colliderHandles: number[];
  rig: CarVisualRig | null;
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  quat: THREE.Quaternion;
  prevQuat: THREE.Quaternion;
  linVel: THREE.Vector3;
  angVel: THREE.Vector3;
  waypointIdx: number;
  laneOffsetM: number;
  speedJitter: number;
  wheelComp: [number, number, number, number];
  prevWheelComp: [number, number, number, number];
  wheelOffsetY: [number, number, number, number];
  wheelSpinAngle: [number, number, number, number];
  wheelGrounded: [boolean, boolean, boolean, boolean];
  wheelTerrain: TerrainSample[];
  steerRad: number;
  throttleCmd: number;
  brakeCmd: number;
  reversing: boolean;
  stuckTimerSec: number;
  recoveryReverseTimerSec: number;
  recoverySteerSign: number;
  upsideDownTimerSec: number;
  farStrandedTimerSec: number;
  arenaRearmTimerSec: number;
  whiskerSteerBias: number;
  whiskerBrakeFactor: number;
  whiskerTickCounter: number;
}

/**
 * Manages 0..8 true dynamic Rapier rigid-body AI target vehicles with
 * 4-corner terrain suspension, simplified tire grip physics, Cruise/Evade/Arena
 * behaviors, obstacle whisker avoidance, stuck recovery, and smart respawning.
 */
export class AITargetFleet {
  private readonly rapier: RapierWorldManager;
  private readonly mapId: MapId;
  private readonly waypoints: [number, number][];
  private scene: THREE.Scene | null;
  private units: AITargetUnit[] = [];
  private bodiesCache: RAPIER.RigidBody[] = [];
  private radarBlipsCache: PinballRadarBlip[] = [];
  private whiskerRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  private substepCount = 0;
  private isNightMode = false;

  constructor(rapier: RapierWorldManager, mapId: MapId, scene: THREE.Scene | null = null) {
    this.rapier = rapier;
    this.mapId = mapId;
    this.waypoints = getMapWaypoints(mapId);
    this.scene = scene;
  }

  public setScene(scene: THREE.Scene | null): void {
    this.scene = scene;
  }

  public setNightMode(isNight: boolean): void {
    this.isNightMode = isNight;
    for (let i = 0; i < this.units.length; i++) {
      this.units[i].rig?.setNightMode(isNight);
    }
  }

  public getUnits(): readonly AITargetUnit[] {
    return this.units;
  }

  public getBodies(): readonly RAPIER.RigidBody[] {
    return this.bodiesCache;
  }

  public getActiveCount(): number {
    return this.units.length;
  }

  private rebuildBodiesCache(): void {
    this.bodiesCache.length = 0;
    for (let i = 0; i < this.units.length; i++) {
      this.bodiesCache.push(this.units[i].body);
    }
  }

  public syncCount(
    targetCount: number,
    playerPos: THREE.Vector3,
    playerHeadingRad: number,
    spawnDistM: number
  ): void {
    const desired = Math.max(0, Math.min(8, Math.round(targetCount)));
    if (desired === this.units.length) return;

    while (this.units.length > desired) {
      const removed = this.units.pop()!;
      this.destroyUnit(removed);
    }

    while (this.units.length < desired) {
      const idx = this.units.length;
      const unit = this.createUnit(idx, playerPos, playerHeadingRad, spawnDistM);
      this.units.push(unit);
    }

    this.rebuildBodiesCache();
  }

  public respawnAll(
    playerPos: THREE.Vector3,
    playerHeadingRad: number,
    spawnDistM: number
  ): void {
    for (let i = 0; i < this.units.length; i++) {
      this.respawnUnit(this.units[i], i, this.units.length, playerPos, playerHeadingRad, spawnDistM);
      this.units[i].rig?.resetDeformation();
    }
  }

  public clear(): void {
    while (this.units.length > 0) {
      const u = this.units.pop()!;
      this.destroyUnit(u);
    }
    this.bodiesCache.length = 0;
    this.radarBlipsCache.length = 0;
  }

  private destroyUnit(unit: AITargetUnit): void {
    for (let i = 0; i < unit.colliderHandles.length; i++) {
      this.rapier.unregisterColliderCategory(unit.colliderHandles[i]);
    }
    if (unit.body.isValid()) {
      this.rapier.world.removeRigidBody(unit.body);
    }
    if (unit.rig) {
      this.scene?.remove(unit.rig.root);
      unit.rig.dispose();
      unit.rig = null;
    }
  }

  private createUnit(
    idx: number,
    playerPos: THREE.Vector3,
    playerHeadingRad: number,
    spawnDistM: number
  ): AITargetUnit {
    // Mix sports coupes, rally, heavy SUVs, and muscle cars across the pack
    const car = CARS[(idx + 1) % CARS.length];
    const paintHex = AI_PAINTS[idx % AI_PAINTS.length];

    const w = car.width;
    const h = car.height;
    const l = car.length;
    const ix = (car.massKg / 12) * (h * h + l * l);
    const iy = (car.massKg / 12) * (w * w + l * l);
    const iz = (car.massKg / 12) * (w * w + h * h);

    const comOffsetY = car.id === 'g63-4x4' ? 0.29 : car.bodyStyle === 'suv' ? 0.25 : -0.02;
    const comOffsetZ = car.id === 'gt3-rs' ? 0.2 : car.id === 'shelby-gt500' ? -0.06 : 0;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 2, 0)
      .setAdditionalMassProperties(
        car.massKg,
        { x: 0, y: comOffsetY, z: comOffsetZ },
        { x: ix, y: iy, z: iz },
        { x: 0, y: 0, z: 0, w: 1 }
      )
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.015)
      .setAngularDamping(0.08)
      .setAdditionalSolverIterations(2);

    const body = this.rapier.world.createRigidBody(bodyDesc);
    const colliderHandles: number[] = [];

    const staticSag = (car.massKg * 9.81) / 4 / car.springStiffness;
    const mountLocalY = car.suspensionRestLength * 0.35;
    const restWheelY = mountLocalY - (car.suspensionRestLength - staticSag);
    const sillLocalY = restWheelY + car.wheelRadius * (car.bodyStyle === 'suv' ? 0.24 : 0.12);

    const hullBevel = 0.05;
    const hullBottomY = sillLocalY + 0.23;
    const hullTopY = Math.max(hullBottomY + 0.34, sillLocalY + 0.6);
    const hullCenterY = (hullBottomY + hullTopY) * 0.5;
    const hullHalfH = Math.max(0.08, (hullTopY - hullBottomY) * 0.5 - hullBevel);

    const activeFlags =
      RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS | RAPIER.ActiveEvents.COLLISION_EVENTS;

    const lowerDesc = RAPIER.ColliderDesc.roundCuboid(
      Math.max(0.2, car.width * 0.44 - hullBevel),
      hullHalfH,
      Math.max(0.4, car.length * 0.42 - hullBevel),
      hullBevel
    )
      .setTranslation(0, hullCenterY, 0)
      .setDensity(0)
      .setFriction(0.14)
      .setRestitution(0.08)
      .setCollisionGroups(AI_GROUPS)
      .setSolverGroups(AI_GROUPS)
      .setActiveEvents(activeFlags)
      .setContactForceEventThreshold(car.massKg * 2.0);

    const lowerCol = this.rapier.world.createCollider(lowerDesc, body);
    colliderHandles.push(lowerCol.handle);
    this.rapier.registerColliderCategory(lowerCol.handle, 'ai');

    const cabinBottomY = hullTopY - 0.04;
    const cabinTopY = sillLocalY + (car.bodyStyle === 'suv' ? 1.24 : 0.94);
    if (cabinTopY > cabinBottomY + 0.14) {
      const cabinBevel = 0.04;
      const cabinCenterY = (cabinBottomY + cabinTopY) * 0.5;
      const cabinHalfH = Math.max(0.05, (cabinTopY - cabinBottomY) * 0.5 - cabinBevel);
      const cabinDesc = RAPIER.ColliderDesc.roundCuboid(
        Math.max(0.2, car.width * 0.36 - cabinBevel),
        cabinHalfH,
        Math.max(0.3, car.length * 0.25 - cabinBevel),
        cabinBevel
      )
        .setTranslation(0, cabinCenterY, car.length * 0.05)
        .setDensity(0)
        .setFriction(0.28)
        .setRestitution(0.08)
        .setCollisionGroups(AI_GROUPS)
        .setSolverGroups(AI_GROUPS)
        .setActiveEvents(activeFlags)
        .setContactForceEventThreshold(car.massKg * 2.0);

      const cabinCol = this.rapier.world.createCollider(cabinDesc, body);
      colliderHandles.push(cabinCol.handle);
      this.rapier.registerColliderCategory(cabinCol.handle, 'ai');
    }

    let rig: CarVisualRig | null = null;
    if (this.scene) {
      rig = createCarVisualRig(car, paintHex);
      rig.setNightMode(this.isNightMode);
      this.scene.add(rig.root);
    }

    const ground0 = sampleTerrain(playerPos.x, playerPos.z);
    const unit: AITargetUnit = {
      id: idx + 1,
      car,
      paintHex,
      body,
      colliderHandles,
      rig,
      pos: new THREE.Vector3(),
      prevPos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      prevQuat: new THREE.Quaternion(),
      linVel: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
      waypointIdx: idx % this.waypoints.length,
      laneOffsetM: ((idx % 3) - 1) * 3.4,
      speedJitter: 0.92 + (idx % 4) * 0.06,
      wheelComp: [0.35, 0.35, 0.35, 0.35],
      prevWheelComp: [0.35, 0.35, 0.35, 0.35],
      wheelOffsetY: [restWheelY, restWheelY, restWheelY, restWheelY],
      wheelSpinAngle: [0, 0, 0, 0],
      wheelGrounded: [true, true, true, true],
      wheelTerrain: [ground0, ground0, ground0, ground0],
      steerRad: 0,
      throttleCmd: 0,
      brakeCmd: 0,
      reversing: false,
      stuckTimerSec: 0,
      recoveryReverseTimerSec: 0,
      recoverySteerSign: idx % 2 === 0 ? 1 : -1,
      upsideDownTimerSec: 0,
      farStrandedTimerSec: 0,
      arenaRearmTimerSec: 0,
      whiskerSteerBias: 0,
      whiskerBrakeFactor: 0,
      whiskerTickCounter: idx * 2,
    };

    this.respawnUnit(unit, idx, Math.max(idx + 1, 4), playerPos, playerHeadingRad, spawnDistM);
    return unit;
  }

  private findSafeSpawnSpot(
    idx: number,
    total: number,
    playerPos: THREE.Vector3,
    playerHeadingRad: number,
    spawnDistM: number
  ): { x: number; z: number; heading: number } {
    const dist = THREE.MathUtils.clamp(spawnDistM, 24, 140);
    // Fan cars ahead & around the player so there's immediate action without spawning directly in front bumper
    const baseAngle = playerHeadingRad + ((idx + 0.5) / Math.max(1, total) - 0.5) * Math.PI * 1.45;

    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = baseAngle + attempt * 0.48;
      const rad = dist + attempt * 6;
      const candX = THREE.MathUtils.clamp(
        playerPos.x - Math.sin(ang) * rad,
        -PLAYABLE_LIMIT + 50,
        PLAYABLE_LIMIT - 50
      );
      const candZ = THREE.MathUtils.clamp(
        playerPos.z - Math.cos(ang) * rad,
        -PLAYABLE_LIMIT + 50,
        PLAYABLE_LIMIT - 50
      );

      // Keep minimum 16m separation from player and 9m from other AI units
      if (Math.hypot(candX - playerPos.x, candZ - playerPos.z) < 16) continue;

      let crowded = false;
      for (let u = 0; u < this.units.length; u++) {
        const other = this.units[u];
        if (Math.hypot(candX - other.pos.x, candZ - other.pos.z) < 9) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      // Check terrain slope isn't a sheer cliff
      const sample = sampleTerrain(candX, candZ);
      if (sample.normalY < 0.72) continue;

      // Face roughly perpendicular or toward player's forward corridor
      const toPlayerYaw = Math.atan2(candX - playerPos.x, candZ - playerPos.z);
      return { x: candX, z: candZ, heading: toPlayerYaw };
    }

    // Fallback to nearest clear waypoint
    const wp = this.waypoints[idx % this.waypoints.length];
    return { x: wp[0], z: wp[1], heading: playerHeadingRad };
  }

  private respawnUnit(
    unit: AITargetUnit,
    idx: number,
    total: number,
    playerPos: THREE.Vector3,
    playerHeadingRad: number,
    spawnDistM: number
  ): void {
    const spot = this.findSafeSpawnSpot(idx, total, playerPos, playerHeadingRad, spawnDistM);
    const ground = sampleTerrain(spot.x, spot.z);
    const car = unit.car;
    const staticSag = (car.massKg * 9.81) / 4 / car.springStiffness;
    const mountY = car.suspensionRestLength * 0.35;
    const clearance = car.wheelRadius + (car.suspensionRestLength - staticSag) - mountY + 0.08;

    _eulerTmp.set(0, spot.heading, 0, 'YXZ');
    _quatTmp.setFromEuler(_eulerTmp);
    _normVec.set(ground.normalX, ground.normalY, ground.normalZ).normalize();
    _tiltQuat.setFromUnitVectors(_upAxis, _normVec);
    _quatTmp.premultiply(_tiltQuat);

    _vecArg.x = spot.x + _normVec.x * clearance;
    _vecArg.y = ground.height + _normVec.y * clearance;
    _vecArg.z = spot.z + _normVec.z * clearance;
    _rotArg.x = _quatTmp.x;
    _rotArg.y = _quatTmp.y;
    _rotArg.z = _quatTmp.z;
    _rotArg.w = _quatTmp.w;

    unit.body.setTranslation(_vecArg, true);
    unit.body.setRotation(_rotArg, true);
    _vecArg.x = 0;
    _vecArg.y = 0;
    _vecArg.z = 0;
    unit.body.setLinvel(_vecArg, true);
    unit.body.setAngvel(_vecArg, true);
    unit.body.resetForces(true);
    unit.body.resetTorques(true);

    unit.pos.set(spot.x, ground.height + clearance, spot.z);
    unit.prevPos.copy(unit.pos);
    unit.quat.copy(_quatTmp);
    unit.prevQuat.copy(_quatTmp);
    unit.linVel.set(0, 0, 0);
    unit.angVel.set(0, 0, 0);
    unit.stuckTimerSec = 0;
    unit.recoveryReverseTimerSec = 0;
    unit.upsideDownTimerSec = 0;
    unit.farStrandedTimerSec = 0;
    unit.arenaRearmTimerSec = 0;

    // Pick nearest forward waypoint
    let bestWp = 0;
    let bestD2 = Infinity;
    for (let wi = 0; wi < this.waypoints.length; wi++) {
      const dx = this.waypoints[wi][0] - spot.x;
      const dz = this.waypoints[wi][1] - spot.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestWp = wi;
      }
    }
    unit.waypointIdx = (bestWp + 1) % this.waypoints.length;
  }

  private updateWhiskerAvoidance(unit: AITargetUnit, speedMs: number): void {
    const lookDist = THREE.MathUtils.clamp(9.0 + speedMs * 0.45, 9.0, 20.0);
    const originY = unit.pos.y + 0.55;
    const angles = [0, 0.42, -0.42];
    let leftDist = lookDist;
    let rightDist = lookDist;
    let centerDist = lookDist;

    for (let ai = 0; ai < 3; ai++) {
      const a = angles[ai];
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      // Forward local is (0, 0, -1), rotated horizontally around Y
      const dx = _fwd.x * cosA - _fwd.z * sinA;
      const dz = _fwd.x * sinA + _fwd.z * cosA;
      const dLen = Math.hypot(dx, dz) || 1;

      this.whiskerRay.origin.x = unit.pos.x + (dx / dLen) * (unit.car.length * 0.52);
      this.whiskerRay.origin.y = originY;
      this.whiskerRay.origin.z = unit.pos.z + (dz / dLen) * (unit.car.length * 0.52);
      this.whiskerRay.dir.x = dx / dLen;
      this.whiskerRay.dir.y = 0;
      this.whiskerRay.dir.z = dz / dLen;

      const hit = this.rapier.world.castRay(
        this.whiskerRay,
        lookDist,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
        OBSTACLE_WHISKER_GROUPS
      );
      if (hit) {
        if (ai === 0) centerDist = hit.timeOfImpact;
        else if (ai === 1) leftDist = hit.timeOfImpact;
        else rightDist = hit.timeOfImpact;
      }
    }

    let steerBias = 0;
    if (leftDist < lookDist || rightDist < lookDist || centerDist < lookDist) {
      const leftThreat = 1 - leftDist / lookDist;
      const rightThreat = 1 - rightDist / lookDist;
      const centerThreat = 1 - centerDist / lookDist;
      // Positive steerRad turns left (+Y rotation), negative turns right
      steerBias = (leftThreat - rightThreat) * -1.1;
      if (centerThreat > 0.25 && Math.abs(steerBias) < 0.25) {
        steerBias = leftDist >= rightDist ? 0.85 : -0.85;
      }
    }

    // Soft boundary wall avoidance near PLAYABLE_LIMIT - 48m
    const bound = PLAYABLE_LIMIT - 48;
    if (Math.abs(unit.pos.x) > bound || Math.abs(unit.pos.z) > bound) {
      const toCenterYaw = Math.atan2(unit.pos.x, unit.pos.z); // pointing from origin? wait: forward is -Z -> (0,0,-1) => yaw=atan2(-fwd.x,-fwd.z)
      const desiredYaw = Math.atan2(unit.pos.x, unit.pos.z);
      const currentYaw = Math.atan2(-_fwd.x, -_fwd.z);
      const err = wrapAngle(desiredYaw - currentYaw);
      steerBias = THREE.MathUtils.clamp(err * 1.4, -1, 1);
    }

    unit.whiskerSteerBias = THREE.MathUtils.clamp(steerBias, -1, 1);
    unit.whiskerBrakeFactor = centerDist < 6.0 ? THREE.MathUtils.clamp(1 - centerDist / 6.0, 0, 1) : 0;
  }

  /**
   * 120 Hz fixed-step update BEFORE `rapier.step(dt)`: computes AI navigation,
   * 4-corner terrain spring-damper forces, anti-roll, and simplified physical tire forces.
   */
  public stepBeforeRapier(
    dt: number,
    config: PinballConfig,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerHeadingRad: number,
    perfThrottled: boolean
  ): void {
    this.substepCount++;
    const behavior: AIBehaviorMode = config.aiBehavior;
    const baseTargetMs = (THREE.MathUtils.clamp(config.aiTargetSpeedKmh, 25, 160) / 3.6);
    const aggression = THREE.MathUtils.clamp(config.aiAggression, 0, 1);

    for (let uIdx = 0; uIdx < this.units.length; uIdx++) {
      const unit = this.units[uIdx];
      const body = unit.body;
      if (!body.isValid()) continue;

      unit.prevPos.copy(unit.pos);
      unit.prevQuat.copy(unit.quat);

      const t = body.translation(_vecArg);
      unit.pos.set(t.x, t.y, t.z);
      const r = body.rotation(_rotArg);
      unit.quat.set(r.x, r.y, r.z, r.w);
      const lv = body.linvel(_vecArg);
      unit.linVel.set(lv.x, lv.y, lv.z);
      const av = body.angvel(_vecArg);
      unit.angVel.set(av.x, av.y, av.z);

      body.resetForces(true);
      body.resetTorques(true);

      _fwd.set(0, 0, -1).applyQuaternion(unit.quat).normalize();
      _right.set(1, 0, 0).applyQuaternion(unit.quat).normalize();
      _up.set(0, 1, 0).applyQuaternion(unit.quat).normalize();

      const speedMs = unit.linVel.length();
      const fwdSpeed = unit.linVel.dot(_fwd);

      // Upside-down & out-of-bounds recovery monitoring
      if (_up.y < 0.28) {
        unit.upsideDownTimerSec += dt;
      } else {
        unit.upsideDownTimerSec = Math.max(0, unit.upsideDownTimerSec - dt * 2);
      }

      const distToPlayer = Math.hypot(unit.pos.x - playerPos.x, unit.pos.z - playerPos.z);
      const outOfBounds =
        Math.abs(unit.pos.x) > PLAYABLE_LIMIT - 10 ||
        Math.abs(unit.pos.z) > PLAYABLE_LIMIT - 10 ||
        unit.pos.y < -30;

      if (behavior === 'arena' && distToPlayer > Math.max(220, config.aiSpawnDistanceM * 3.4)) {
        unit.farStrandedTimerSec += dt;
      } else {
        unit.farStrandedTimerSec = 0;
      }

      if (
        outOfBounds ||
        unit.upsideDownTimerSec > 3.2 ||
        unit.farStrandedTimerSec > 6.5
      ) {
        this.respawnUnit(
          unit,
          uIdx,
          this.units.length,
          playerPos,
          playerHeadingRad,
          config.aiSpawnDistanceM
        );
        continue;
      }

      // 1. Obstacle whisker raycasts at ~20 Hz (staggered across units, halved if perf-throttled)
      unit.whiskerTickCounter++;
      const whiskerModulo = perfThrottled ? 12 : 6;
      if (unit.whiskerTickCounter % whiskerModulo === 0) {
        this.updateWhiskerAvoidance(unit, speedMs);
      }

      // 2. Navigation target & behavior logic
      if (unit.arenaRearmTimerSec > 0) {
        unit.arenaRearmTimerSec = Math.max(0, unit.arenaRearmTimerSec - dt);
      }
      if (unit.recoveryReverseTimerSec > 0) {
        unit.recoveryReverseTimerSec = Math.max(0, unit.recoveryReverseTimerSec - dt);
      }

      const wp = this.waypoints[unit.waypointIdx];
      // Add slight lane offset perpendicular to waypoint travel
      const nextWp = this.waypoints[(unit.waypointIdx + 1) % this.waypoints.length];
      const segDx = nextWp[0] - wp[0];
      const segDz = nextWp[1] - wp[1];
      const segLen = Math.hypot(segDx, segDz) || 1;
      let targetX = wp[0] + (-segDz / segLen) * unit.laneOffsetM;
      let targetZ = wp[1] + (segDx / segLen) * unit.laneOffsetM;

      if (Math.hypot(targetX - unit.pos.x, targetZ - unit.pos.z) < 20) {
        unit.waypointIdx = (unit.waypointIdx + 1) % this.waypoints.length;
      }

      let desiredSpeedMs = baseTargetMs * unit.speedJitter;

      if (behavior === 'evade') {
        if (distToPlayer < 68) {
          // Escape vector away from player's future position
          const lead = 0.75 * (0.5 + aggression * 0.6);
          const threatX = playerPos.x + playerVel.x * lead;
          const threatZ = playerPos.z + playerVel.z * lead;
          const escX = unit.pos.x - threatX;
          const escZ = unit.pos.z - threatZ;
          const escLen = Math.hypot(escX, escZ) || 1;
          const jinkSign = uIdx % 2 === 0 ? 1 : -1;
          // Blend away vector + slight perpendicular jink to break straight tailgates
          targetX = unit.pos.x + (escX / escLen) * 52 + (-escZ / escLen) * 18 * jinkSign;
          targetZ = unit.pos.z + (escZ / escLen) * 52 + (escX / escLen) * 18 * jinkSign;
          desiredSpeedMs = baseTargetMs * (1.05 + aggression * 0.28);
        }
      } else if (behavior === 'arena') {
        if (distToPlayer < 190 && unit.arenaRearmTimerSec <= 0) {
          const closingDist = Math.max(8, distToPlayer);
          const leadSec = THREE.MathUtils.clamp(
            (closingDist / Math.max(12, baseTargetMs)) * (0.45 + aggression * 0.55),
            0.2,
            1.4
          );
          targetX = playerPos.x + playerVel.x * leadSec;
          targetZ = playerPos.z + playerVel.z * leadSec;
          desiredSpeedMs = baseTargetMs * (1.0 + aggression * 0.32);

          // If practically nose-locked slow against player, briefly swing out for a clean run-up
          if (distToPlayer < 6.2 && speedMs < 3.5) {
            unit.arenaRearmTimerSec = 1.6;
          }
        } else if (unit.arenaRearmTimerSec > 0) {
          const awayX = unit.pos.x - playerPos.x;
          const awayZ = unit.pos.z - playerPos.z;
          const aLen = Math.hypot(awayX, awayZ) || 1;
          targetX = unit.pos.x + (awayX / aLen) * 45 + (-awayZ / aLen) * 20;
          targetZ = unit.pos.z + (awayZ / aLen) * 45 + (awayX / aLen) * 20;
          desiredSpeedMs = baseTargetMs * 1.1;
        }
      }

      // Compute yaw steering error toward (targetX, targetZ)
      const toTgtX = targetX - unit.pos.x;
      const toTgtZ = targetZ - unit.pos.z;
      const desiredYaw = Math.atan2(-toTgtX, -toTgtZ);
      const currentYaw = Math.atan2(-_fwd.x, -_fwd.z);
      const yawErr = wrapAngle(desiredYaw - currentYaw);

      // Slow down moderately into sharp turns so AI corners predictably instead of washing off roads
      const turnBrakeFactor = THREE.MathUtils.clamp((Math.abs(yawErr) - 0.55) / 1.4, 0, 0.55);
      desiredSpeedMs *= 1 - turnBrakeFactor;

      // Stuck detection -> trigger brief reverse & countersteer recovery
      if (
        unit.recoveryReverseTimerSec <= 0 &&
        unit.throttleCmd > 0.3 &&
        unit.brakeCmd < 0.2 &&
        speedMs < 1.25
      ) {
        unit.stuckTimerSec += dt;
        if (unit.stuckTimerSec > 2.2) {
          unit.recoveryReverseTimerSec = 1.35;
          unit.stuckTimerSec = 0;
          unit.recoverySteerSign = yawErr >= 0 ? -1 : 1;
        }
      } else {
        unit.stuckTimerSec = Math.max(0, unit.stuckTimerSec - dt * 1.5);
      }

      let steerNorm = THREE.MathUtils.clamp(yawErr * 1.45, -1, 1);
      if (Math.abs(unit.whiskerSteerBias) > 0.05) {
        steerNorm = THREE.MathUtils.clamp(steerNorm * 0.55 + unit.whiskerSteerBias * 0.9, -1, 1);
      }

      if (unit.recoveryReverseTimerSec > 0) {
        unit.reversing = true;
        unit.throttleCmd = 0.72;
        unit.brakeCmd = 0;
        steerNorm = unit.recoverySteerSign * 0.85;
      } else {
        unit.reversing = false;
        if (unit.whiskerBrakeFactor > 0.45 && fwdSpeed > 6) {
          unit.throttleCmd = 0;
          unit.brakeCmd = unit.whiskerBrakeFactor;
        } else if (fwdSpeed < desiredSpeedMs) {
          unit.throttleCmd = THREE.MathUtils.clamp((desiredSpeedMs - fwdSpeed) / 6.0, 0.15, 1.0);
          unit.brakeCmd = 0;
        } else {
          unit.throttleCmd = 0;
          unit.brakeCmd = THREE.MathUtils.clamp((fwdSpeed - desiredSpeedMs) / 8.0, 0, 0.8);
        }
      }

      const maxSteerRad = THREE.MathUtils.degToRad(unit.car.maxSteerDeg);
      const speedSteerReduce = THREE.MathUtils.clamp(1 - speedMs / 52, 0.38, 1.0);
      const targetSteerRad = steerNorm * maxSteerRad * speedSteerReduce;
      unit.steerRad += (targetSteerRad - unit.steerRad) * Math.min(1, dt * 10);

      // 3. 4-Corner Physical Suspension & Simplified Tire Physics (Zero-GC)
      const car = unit.car;
      const hx = car.trackWidth * 0.5;
      const hz = car.wheelbase * 0.5;
      const mountLocalY = car.suspensionRestLength * 0.35;
      const springK = car.springStiffness;
      const maxLen = car.suspensionRestLength + car.suspensionMaxTravel;
      const staticSag = (car.massKg * 9.81) / 4 / car.springStiffness;
      const archClearance = car.bodyStyle === 'suv' ? 0.14 : 0.085;
      const minLen = Math.max(
        0.04,
        car.suspensionRestLength - staticSag - (archClearance - 0.005)
      );

      let groundedCount = 0;
      const refreshTerrain = !perfThrottled || (this.substepCount + uIdx) % 2 === 0;

      for (let wi = 0; wi < 4; wi++) {
        const sx = WHEEL_LAYOUT[wi][0];
        const sz = WHEEL_LAYOUT[wi][1];
        const isFront = WHEEL_LAYOUT[wi][2];

        _mountLocal.set(sx * hx, mountLocalY, sz * hz);
        _mountWorld.copy(_mountLocal).applyQuaternion(unit.quat).add(unit.pos);

        if (refreshTerrain) {
          unit.wheelTerrain[wi] = sampleTerrain(_mountWorld.x, _mountWorld.z);
        }
        const ground = unit.wheelTerrain[wi];

        const heightAboveGround = _mountWorld.y - ground.height;
        const rayDist = heightAboveGround / Math.max(0.35, _up.y);
        const legToHub = rayDist - car.wheelRadius;

        if (legToHub <= maxLen && _up.y > 0.1) {
          groundedCount++;
          unit.wheelGrounded[wi] = true;
          const clampedLen = Math.max(minLen, legToHub);
          const comp = Math.max(0, maxLen - clampedLen);
          unit.wheelComp[wi] = THREE.MathUtils.clamp(comp / (maxLen - minLen), 0, 1);
          unit.wheelOffsetY[wi] = mountLocalY - clampedLen;

          const compVel = (comp - unit.prevWheelComp[wi]) / dt;
          unit.prevWheelComp[wi] = comp;

          const damper = compVel >= 0 ? car.damperBump : car.damperRebound;
          let springForce = Math.max(0, comp * springK + compVel * damper);
          if (legToHub < minLen) {
            springForce += (minLen - legToHub) * springK * 2.2;
          }
          springForce = Math.min(springForce, car.massKg * 26);

          // Anti-roll pairing (FL<->FR, RL<->RR)
          const oppIdx = wi % 2 === 0 ? wi + 1 : wi - 1;
          const antiRoll = (unit.wheelComp[wi] - unit.wheelComp[oppIdx]) * car.antiRollStiffness * 0.45;
          const totalSuspN = Math.max(0, springForce + antiRoll);

          // Apply vertical suspension along ground normal/up blend at world wheel mount
          const fx = _up.x * totalSuspN;
          const fy = _up.y * totalSuspN;
          const fz = _up.z * totalSuspN;
          _vecArg.x = fx;
          _vecArg.y = fy;
          _vecArg.z = fz;
          _ptArg.x = _mountWorld.x;
          _ptArg.y = _mountWorld.y;
          _ptArg.z = _mountWorld.z;
          body.addForceAtPoint(_vecArg, _ptArg, true);

          // Wheel contact velocity for simplified combined-slip tire force
          const wv = body.velocityAtPoint(_ptArg, _vecArg);
          const wvx = wv.x;
          const wvy = wv.y;
          const wvz = wv.z;

          const wSteer = isFront ? unit.steerRad : 0;
          const cosS = Math.cos(wSteer);
          const sinS = Math.sin(wSteer);
          _wheelDirF.set(_fwd.x * cosS - _right.x * sinS, _fwd.y * cosS - _right.y * sinS, _fwd.z * cosS - _right.z * sinS).normalize();
          _wheelDirR.set(_right.x * cosS + _fwd.x * sinS, _right.y * cosS + _fwd.y * sinS, _right.z * cosS + _fwd.z * sinS).normalize();

          const vLong = wvx * _wheelDirF.x + wvy * _wheelDirF.y + wvz * _wheelDirF.z;
          const vLat = wvx * _wheelDirR.x + wvy * _wheelDirR.y + wvz * _wheelDirR.z;

          const mu = car.tireGrip * ground.grip * 1.05;
          const maxTireF = mu * totalSuspN;

          // Smooth tanh lateral grip curve (gives crisp cornering + physical drift saturation!)
          const slipSpeed = Math.abs(vLong) + 1.5;
          const slipAngleRatio = vLat / (slipSpeed * 0.16);
          const latForce = -maxTireF * Math.tanh(slipAngleRatio);

          // Longitudinal drive / brake / rolling resistance
          const peakDriveN = (car.horsepower * 735) / Math.max(6.5, Math.abs(vLong) + 4.5);
          const perWheelDriveN = Math.min(peakDriveN * 0.34, car.massKg * 3.8);
          let longForce = 0;
          if (unit.reversing) {
            longForce = -perWheelDriveN * 0.55 * unit.throttleCmd;
          } else if (unit.throttleCmd > 0.01) {
            longForce = perWheelDriveN * unit.throttleCmd;
          }
          if (unit.brakeCmd > 0.01 && Math.abs(vLong) > 0.25) {
            longForce -= Math.sign(vLong) * (car.maxBrakeForce * 0.26 * unit.brakeCmd);
          }
          longForce -= vLong * ground.rollingResistance * car.massKg * 0.4;
          longForce = THREE.MathUtils.clamp(longForce, -maxTireF * 0.92, maxTireF * 0.92);

          // Apply tire forces slightly above ground (sill level) so turns produce visible chassis roll
          const tirePtX = _mountWorld.x - _up.x * (clampedLen * 0.65);
          const tirePtY = _mountWorld.y - _up.y * (clampedLen * 0.65);
          const tirePtZ = _mountWorld.z - _up.z * (clampedLen * 0.65);

          _vecArg.x = _wheelDirF.x * longForce + _wheelDirR.x * latForce;
          _vecArg.y = _wheelDirF.y * longForce + _wheelDirR.y * latForce;
          _vecArg.z = _wheelDirF.z * longForce + _wheelDirR.z * latForce;
          _ptArg.x = tirePtX;
          _ptArg.y = tirePtY;
          _ptArg.z = tirePtZ;
          body.addForceAtPoint(_vecArg, _ptArg, true);

          unit.wheelSpinAngle[wi] += (vLong / Math.max(0.2, car.wheelRadius)) * dt;
        } else {
          unit.wheelGrounded[wi] = false;
          unit.wheelComp[wi] = 0;
          unit.prevWheelComp[wi] = 0;
          unit.wheelOffsetY[wi] = mountLocalY - maxLen;
          unit.wheelSpinAngle[wi] += (fwdSpeed / Math.max(0.2, car.wheelRadius)) * dt * 0.85;
        }
      }

      // 4. Aerodynamic drag + subtle angular stabilization when grounded (allows full flips in air/crashes)
      if (speedMs > 1.0) {
        const dragMag = 0.5 * 1.225 * car.dragCoeff * 2.3 * speedMs * speedMs;
        _vecArg.x = (-unit.linVel.x / speedMs) * dragMag;
        _vecArg.y = (-unit.linVel.y / speedMs) * dragMag;
        _vecArg.z = (-unit.linVel.z / speedMs) * dragMag;
        body.addForce(_vecArg, true);
      }

      if (groundedCount >= 2) {
        const w = car.width;
        const h = car.height;
        const l = car.length;
        const ix = (car.massKg / 12) * (h * h + l * l);
        const iy = (car.massKg / 12) * (w * w + l * l);
        const iz = (car.massKg / 12) * (w * w + h * h);
        const dampScale = 1.6;
        _vecArg.x = -unit.angVel.x * ix * dampScale;
        _vecArg.y = -unit.angVel.y * iy * 0.45;
        _vecArg.z = -unit.angVel.z * iz * dampScale * 1.4;
        body.addTorque(_vecArg, true);
      }
    }
  }

  public syncAfterRapierStep(): void {
    for (let i = 0; i < this.units.length; i++) {
      const unit = this.units[i];
      if (!unit.body.isValid()) continue;
      const t = unit.body.translation(_vecArg);
      unit.pos.set(t.x, t.y, t.z);
      const r = unit.body.rotation(_rotArg);
      unit.quat.set(r.x, r.y, r.z, r.w);
      const lv = unit.body.linvel(_vecArg);
      unit.linVel.set(lv.x, lv.y, lv.z);
      const av = unit.body.angvel(_vecArg);
      unit.angVel.set(av.x, av.y, av.z);
    }
  }

  public applyImpactDeformation(impact: PinballImpactEvent): void {
    if (impact.severity < 0.08) return;
    for (let i = 0; i < this.units.length; i++) {
      const unit = this.units[i];
      const dist = Math.hypot(
        impact.worldPointX - unit.pos.x,
        impact.worldPointY - unit.pos.y,
        impact.worldPointZ - unit.pos.z
      );
      if (dist < unit.car.length * 0.9) {
        if (unit.rig) {
          _tiltQuat.copy(unit.quat).invert();
          _v3A
            .set(
              impact.worldPointX - unit.pos.x,
              impact.worldPointY - unit.pos.y,
              impact.worldPointZ - unit.pos.z
            )
            .applyQuaternion(_tiltQuat);
          _v3B
            .set(impact.normalX, impact.normalY, impact.normalZ)
            .applyQuaternion(_tiltQuat)
            .normalize();
          unit.rig.applyDeformation(_v3A, _v3B, impact.severity);
        }
        // Trigger brief Arena circle-back cooldown on hit so AI re-stages next charge
        unit.arenaRearmTimerSec = Math.max(unit.arenaRearmTimerSec, 1.35);
      }
    }
  }

  public updateVisuals(alpha: number): void {
    for (let i = 0; i < this.units.length; i++) {
      const unit = this.units[i];
      const rig = unit.rig;
      if (!rig) continue;

      rig.root.position.lerpVectors(unit.prevPos, unit.pos, alpha);
      rig.root.quaternion.slerpQuaternions(unit.prevQuat, unit.quat, alpha);

      const tailBase = this.isNightMode ? 1.55 : 0.6;
      rig.brakeLightMat.emissiveIntensity = unit.brakeCmd > 0.12 ? 3.4 : tailBase;
      rig.reverseLightMat.emissiveIntensity = unit.reversing ? 3.0 : 0.06;

      const mountLocalY = unit.car.suspensionRestLength * 0.35;
      const springTopY = mountLocalY + 0.14;
      const springNaturalLen = unit.car.suspensionRestLength * 0.92;
      let anyGrounded = false;

      for (let wi = 0; wi < 4; wi++) {
        const isRight = wi === 1 || wi === 3;
        const isFront = wi < 2;
        rig.wheelPivots[wi].position.y = unit.wheelOffsetY[wi];
        rig.wheelPivots[wi].rotation.y = isFront ? unit.steerRad : 0;
        rig.wheelSpinGroups[wi].rotation.x = -unit.wheelSpinAngle[wi];

        const currentLen = Math.max(0.08, springTopY - unit.wheelOffsetY[wi]);
        const scaleY = THREE.MathUtils.clamp(currentLen / springNaturalLen, 0.22, 1.38);
        rig.springMeshes[wi].scale.y = scaleY;
        rig.damperRods[wi].scale.y = scaleY;
        rig.controlArms[wi].position.y = unit.wheelOffsetY[wi] * 0.5;
        rig.controlArms[wi].rotation.z = (isRight ? 1 : -1) * Math.atan2(unit.wheelOffsetY[wi], 0.32);

        if (unit.wheelGrounded[wi]) anyGrounded = true;
      }

      const shadowMat = rig.contactShadow.material as THREE.MeshBasicMaterial;
      shadowMat.opacity = anyGrounded ? 0.45 : 0.14;
    }
  }

  public getRadarBlips(behavior: AIBehaviorMode): PinballRadarBlip[] {
    this.radarBlipsCache.length = this.units.length;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      _v3C.set(0, 0, -1).applyQuaternion(u.quat);
      const headingRad = Math.atan2(-_v3C.x, -_v3C.z);
      const speedKmh = Math.round(u.linVel.length() * 3.6);
      let blip = this.radarBlipsCache[i];
      if (!blip) {
        blip = {
          id: u.id,
          x: u.pos.x,
          z: u.pos.z,
          headingRad,
          speedKmh,
          carName: u.car.name,
          behavior,
        };
        this.radarBlipsCache[i] = blip;
      } else {
        blip.id = u.id;
        blip.x = u.pos.x;
        blip.z = u.pos.z;
        blip.headingRad = headingRad;
        blip.speedKmh = speedKmh;
        blip.carName = u.car.name;
        blip.behavior = behavior;
      }
    }
    return this.radarBlipsCache;
  }
}
