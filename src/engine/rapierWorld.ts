import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { ColliderCategory } from '../types/pinball';
import { CarSpec, CollisionEvent, WorldCollider } from '../types/vehicle';
import { PLAYABLE_LIMIT, sampleTerrain } from './terrain';

// Collision bitmask groups (16-bit membership upper | 16-bit filter lower)
export const CG_TERRAIN = 0x0001;
export const CG_OBSTACLE = 0x0002;
export const CG_CHASSIS = 0x0004;
export const CG_WHEEL_PROBE = 0x0008;
export const CG_DYNAMIC_PROP = 0x0010;

export function packInteractionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

const TERRAIN_GROUPS = packInteractionGroups(
  CG_TERRAIN,
  CG_CHASSIS | CG_WHEEL_PROBE | CG_DYNAMIC_PROP
);
const OBSTACLE_GROUPS = packInteractionGroups(
  CG_OBSTACLE,
  CG_CHASSIS | CG_WHEEL_PROBE | CG_DYNAMIC_PROP
);
const CHASSIS_GROUPS = packInteractionGroups(
  CG_CHASSIS,
  CG_TERRAIN | CG_OBSTACLE | CG_DYNAMIC_PROP
);

let rapierInitPromise: Promise<typeof RAPIER> | null = null;
let rapierInitialized = false;

export async function ensureRapierInitialized(): Promise<typeof RAPIER> {
  if (rapierInitialized) return RAPIER;
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init().then(() => {
      rapierInitialized = true;
      return RAPIER;
    });
  }
  return rapierInitPromise;
}

export function isRapierReady(): boolean {
  return rapierInitialized;
}

export const FIXED_PHYSICS_DT = 1 / 120;

// Pre-allocated scratch helpers (zero GC inside 120 Hz loop)
const _vVec = { x: 0, y: 0, z: 0 };
const _vPoint = { x: 0, y: 0, z: 0 };
const _qRot = { x: 0, y: 0, z: 0, w: 1 };
const _tmpDir = { x: 0, y: 0, z: 0 };
const _tmpForce = new THREE.Vector3();
const _tmpWorldPos = new THREE.Vector3();
const _tmpLocalPos = new THREE.Vector3();
const _tmpWorldNorm = new THREE.Vector3();
const _tmpLocalNorm = new THREE.Vector3();
const _tmpInvQ = new THREE.Quaternion();
const _tmpBodyPos = new THREE.Vector3();
const _tmpBodyQuat = new THREE.Quaternion();
const _eulerTmp = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Manages the Rapier 3D physics World, terrain Heightfield, static world colliders,
 * collision bitmask filtering, chassis rigid-body creation, and ContactForceEvent extraction.
 * Rapier exclusively owns rigid-body integration of the vehicle chassis.
 */
export class RapierWorldManager {
  public readonly world: RAPIER.World;
  public readonly eventQueue: RAPIER.EventQueue;

  public chassisBody!: RAPIER.RigidBody;
  private chassisColliderHandles = new Set<number>();
  private chassisColliders: RAPIER.Collider[] = [];
  private colliderCategories = new Map<number, ColliderCategory>();
  private terrainCollider: RAPIER.Collider | null = null;
  private obstacleColliders: RAPIER.Collider[] = [];
  private activeCar: CarSpec;
  private playerCollisionEventsEnabled = false;

  // Reusable Ray for wheel/ground queries
  private queryRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private queryFilterGroups = packInteractionGroups(
    CG_WHEEL_PROBE,
    CG_TERRAIN | CG_OBSTACLE | CG_DYNAMIC_PROP
  );

  constructor(car: CarSpec, colliders: WorldCollider[] = []) {
    if (!rapierInitialized) {
      throw new Error('Rapier WASM must be initialized via ensureRapierInitialized() before constructing RapierWorldManager.');
    }

    this.activeCar = car;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_PHYSICS_DT;
    this.world.numSolverIterations = 8;
    this.world.numInternalPgsIterations = 2;
    this.world.maxCcdSubsteps = 2;

    this.eventQueue = new RAPIER.EventQueue(true);

    this.buildTerrainHeightfield();
    this.buildBoundaryWalls();
    this.setWorldColliders(colliders);
    this.createChassisRigidBody(car);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  private warpCoord(u: number, limit: number): number {
    const s = Math.sign(u);
    const a = Math.abs(u);
    return s * (a * 0.45 + a * a * a * 0.55) * limit;
  }

  private buildTerrainHeightfield(): void {
    // 280 x 280 warped TriMesh for tight slope fidelity on steep mountain-pass switchbacks
    const segs = 280;
    const halfSpan = PLAYABLE_LIMIT + 20;
    const verts = new Float32Array((segs + 1) * (segs + 1) * 3);
    const indices = new Uint32Array(segs * segs * 6);

    for (let iz = 0; iz <= segs; iz++) {
      const z = this.warpCoord((iz / segs) * 2 - 1, halfSpan);
      for (let ix = 0; ix <= segs; ix++) {
        const x = this.warpCoord((ix / segs) * 2 - 1, halfSpan);
        const k = iz * (segs + 1) + ix;
        verts[k * 3] = x;
        verts[k * 3 + 1] = sampleTerrain(x, z).height;
        verts[k * 3 + 2] = z;
      }
    }

    let ptr = 0;
    for (let iz = 0; iz < segs; iz++) {
      for (let ix = 0; ix < segs; ix++) {
        const a = iz * (segs + 1) + ix;
        const b = a + 1;
        const d = a + segs + 1;
        const e = d + 1;
        indices[ptr++] = a;
        indices[ptr++] = d;
        indices[ptr++] = b;
        indices[ptr++] = b;
        indices[ptr++] = d;
        indices[ptr++] = e;
      }
    }

    const desc = RAPIER.ColliderDesc.trimesh(verts, indices)
      .setFriction(0.18)
      .setRestitution(0.04)
      .setCollisionGroups(TERRAIN_GROUPS)
      .setSolverGroups(TERRAIN_GROUPS);

    this.terrainCollider = this.world.createCollider(desc);
    this.colliderCategories.set(this.terrainCollider.handle, 'terrain');
  }

  private buildBoundaryWalls(): void {
    const limit = PLAYABLE_LIMIT;
    const wallThick = 4.0;
    const wallHalfH = 24.0;
    const wallSpan = limit + wallThick;

    const specs: [number, number, number, number][] = [
      [0, -(limit + wallThick), wallSpan, wallThick],
      [0, limit + wallThick, wallSpan, wallThick],
      [-(limit + wallThick), 0, wallThick, wallSpan],
      [limit + wallThick, 0, wallThick, wallSpan],
    ];

    for (const [wx, wz, hx, hz] of specs) {
      const desc = RAPIER.ColliderDesc.cuboid(hx, wallHalfH, hz)
        .setTranslation(wx, wallHalfH * 0.5 - 4, wz)
        .setFriction(0.12)
        .setRestitution(0.28)
        .setCollisionGroups(OBSTACLE_GROUPS)
        .setSolverGroups(OBSTACLE_GROUPS);
      const col = this.world.createCollider(desc);
      this.colliderCategories.set(col.handle, 'world_obstacle');
    }
  }

  public setWorldColliders(colliders: WorldCollider[]): void {
    for (let i = 0; i < this.obstacleColliders.length; i++) {
      const c = this.obstacleColliders[i];
      this.colliderCategories.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    this.obstacleColliders.length = 0;

    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];
      let desc: RAPIER.ColliderDesc;
      if (col.type === 'circle') {
        const baseY = sampleTerrain(col.x, col.z).height;
        const topY = col.maxY ?? baseY + 6.0;
        const h = Math.max(1.0, topY - baseY + 1.0);
        desc = RAPIER.ColliderDesc.cylinder(h * 0.5, col.radius)
          .setTranslation(col.x, baseY + h * 0.5 - 0.5, col.z);
      } else {
        const cx = (col.minX + col.maxX) * 0.5;
        const cz = (col.minZ + col.maxZ) * 0.5;
        const hx = Math.max(0.1, (col.maxX - col.minX) * 0.5);
        const hz = Math.max(0.1, (col.maxZ - col.minZ) * 0.5);
        const baseY = sampleTerrain(cx, cz).height;
        const topY = col.maxY ?? baseY + 2.5;
        const h = Math.max(0.6, topY - baseY + 0.8);
        desc = RAPIER.ColliderDesc.cuboid(hx, h * 0.5, hz)
          .setTranslation(cx, baseY + h * 0.5 - 0.4, cz);
      }

      desc
        .setFriction(0.14)
        .setRestitution(0.24)
        .setCollisionGroups(OBSTACLE_GROUPS)
        .setSolverGroups(OBSTACLE_GROUPS);

      const created = this.world.createCollider(desc);
      this.obstacleColliders.push(created);
      this.colliderCategories.set(created.handle, col.category ?? 'world_obstacle');
    }
  }

  public registerColliderCategory(handle: number, category: ColliderCategory): void {
    this.colliderCategories.set(handle, category);
  }

  public unregisterColliderCategory(handle: number): void {
    this.colliderCategories.delete(handle);
  }

  public getColliderCategory(handle: number): ColliderCategory {
    return this.colliderCategories.get(handle) ?? 'world_obstacle';
  }

  public isPlayerChassisCollider(handle: number): boolean {
    return this.chassisColliderHandles.has(handle);
  }

  public setPlayerCollisionEventsEnabled(enabled: boolean): void {
    if (this.playerCollisionEventsEnabled === enabled) return;
    this.playerCollisionEventsEnabled = enabled;
    const flags = enabled
      ? RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS | RAPIER.ActiveEvents.COLLISION_EVENTS
      : RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
    for (let i = 0; i < this.chassisColliders.length; i++) {
      const col = this.chassisColliders[i];
      if (col.isValid()) {
        col.setActiveEvents(flags);
      }
    }
  }

  public createChassisRigidBody(car: CarSpec): void {
    if (this.chassisBody) {
      for (const h of this.chassisColliderHandles) {
        this.colliderCategories.delete(h);
      }
      this.world.removeRigidBody(this.chassisBody);
      this.chassisColliderHandles.clear();
      this.chassisColliders.length = 0;
    }
    this.activeCar = car;

    // Principal moments of inertia for box-approximated sprung mass
    const w = car.width;
    const h = car.height;
    const l = car.length;
    const ix = (car.massKg / 12) * (h * h + l * l);
    const iy = (car.massKg / 12) * (w * w + l * l);
    const iz = (car.massKg / 12) * (w * w + h * h);

    // Authentic Center of Gravity height (tall SUVs roll noticeably; low sports coupes stay flat) + longitudinal engine bias
    const comOffsetY = car.id === 'g63-4x4' ? 0.29 : car.bodyStyle === 'suv' ? 0.25 : -0.02;
    const comOffsetZ = car.id === 'gt3-rs' ? 0.2 : car.id === 'shelby-gt500' ? -0.06 : 0;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1.0, 0)
      .setAdditionalMassProperties(
        car.massKg,
        { x: 0, y: comOffsetY, z: comOffsetZ },
        { x: ix, y: iy, z: iz },
        { x: 0, y: 0, z: 0, w: 1 }
      )
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.01)
      .setAngularDamping(0.06)
      .setAdditionalSolverIterations(4);

    this.chassisBody = this.world.createRigidBody(bodyDesc);

    // Compute sill clearance matching visual carModels.ts so chassis hull clears flat/bumpy ground
    const staticSag = (car.massKg * 9.81) / 4 / car.springStiffness;
    const mountLocalY = car.suspensionRestLength * 0.35;
    const restWheelY = mountLocalY - (car.suspensionRestLength - staticSag);
    const sillLocalY = restWheelY + car.wheelRadius * (car.bodyStyle === 'suv' ? 0.24 : 0.12);

    const hullBevel = 0.05;
    const hullBottomY = sillLocalY + 0.23;
    const hullTopY = Math.max(hullBottomY + 0.34, sillLocalY + 0.6);
    const hullCenterY = (hullBottomY + hullTopY) * 0.5;
    const hullHalfH = Math.max(0.08, (hullTopY - hullBottomY) * 0.5 - hullBevel);

    // Bevelled main lower hull (subtract bevel radius since Rapier roundCuboid inflates outer surface by borderRadius)
    const lowerFlags = this.playerCollisionEventsEnabled
      ? RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS | RAPIER.ActiveEvents.COLLISION_EVENTS
      : RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
    const lowerDesc = RAPIER.ColliderDesc.roundCuboid(
      Math.max(0.2, car.width * 0.44 - hullBevel),
      hullHalfH,
      Math.max(0.4, car.length * 0.42 - hullBevel),
      hullBevel
    )
      .setTranslation(0, hullCenterY, 0)
      .setDensity(0)
      .setFriction(0.12)
      .setRestitution(0.06)
      .setCollisionGroups(CHASSIS_GROUPS)
      .setSolverGroups(CHASSIS_GROUPS)
      .setActiveEvents(lowerFlags)
      .setContactForceEventThreshold(car.massKg * 2.4);

    const lowerCollider = this.world.createCollider(lowerDesc, this.chassisBody);
    this.chassisColliderHandles.add(lowerCollider.handle);
    this.chassisColliders.push(lowerCollider);
    this.colliderCategories.set(lowerCollider.handle, 'player');

    // Upper cabin/greenhouse collider for authentic rollover roof contact
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
        .setCollisionGroups(CHASSIS_GROUPS)
        .setSolverGroups(CHASSIS_GROUPS)
        .setActiveEvents(lowerFlags)
        .setContactForceEventThreshold(car.massKg * 2.4);

      const cabinCollider = this.world.createCollider(cabinDesc, this.chassisBody);
      this.chassisColliderHandles.add(cabinCollider.handle);
      this.chassisColliders.push(cabinCollider);
      this.colliderCategories.set(cabinCollider.handle, 'player');
    }
  }

  public teleportChassis(pos: THREE.Vector3, headingOrQuat: number | THREE.Quaternion): void {
    if (typeof headingOrQuat === 'number') {
      _eulerTmp.set(0, headingOrQuat, 0, 'YXZ');
      _tmpBodyQuat.setFromEuler(_eulerTmp);
    } else {
      _tmpBodyQuat.copy(headingOrQuat);
    }

    _vVec.x = pos.x;
    _vVec.y = pos.y;
    _vVec.z = pos.z;
    _qRot.x = _tmpBodyQuat.x;
    _qRot.y = _tmpBodyQuat.y;
    _qRot.z = _tmpBodyQuat.z;
    _qRot.w = _tmpBodyQuat.w;

    this.chassisBody.setTranslation(_vVec, true);
    this.chassisBody.setRotation(_qRot, true);
    _vVec.x = 0;
    _vVec.y = 0;
    _vVec.z = 0;
    this.chassisBody.setLinvel(_vVec, true);
    this.chassisBody.setAngvel(_vVec, true);
    this.chassisBody.resetForces(true);
    this.chassisBody.resetTorques(true);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  public clearAccumulatedForces(): void {
    this.chassisBody.resetForces(true);
    this.chassisBody.resetTorques(true);
  }

  public addForce(fx: number, fy: number, fz: number): void {
    _vVec.x = fx;
    _vVec.y = fy;
    _vVec.z = fz;
    this.chassisBody.addForce(_vVec, true);
  }

  public addTorque(tx: number, ty: number, tz: number): void {
    _vVec.x = tx;
    _vVec.y = ty;
    _vVec.z = tz;
    this.chassisBody.addTorque(_vVec, true);
  }

  public addForceAtPoint(
    fx: number,
    fy: number,
    fz: number,
    px: number,
    py: number,
    pz: number
  ): void {
    _vVec.x = fx;
    _vVec.y = fy;
    _vVec.z = fz;
    _vPoint.x = px;
    _vPoint.y = py;
    _vPoint.z = pz;
    this.chassisBody.addForceAtPoint(_vVec, _vPoint, true);
  }

  /**
   * Raycast against static world obstacles (excluding terrain heightfield when exact analytical ground is used)
   * or full filtered ground/obstacle world. Zero-allocation hot path.
   */
  public castSuspensionRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number
  ): { hit: boolean; toi: number; nx: number; ny: number; nz: number } {
    this.queryRay.origin.x = ox;
    this.queryRay.origin.y = oy;
    this.queryRay.origin.z = oz;
    this.queryRay.dir.x = dx;
    this.queryRay.dir.y = dy;
    this.queryRay.dir.z = dz;

    const hit = this.world.castRayAndGetNormal(
      this.queryRay,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
      this.queryFilterGroups,
      undefined,
      this.chassisBody
    );
    if (!hit) {
      return { hit: false, toi: maxDist, nx: 0, ny: 1, nz: 0 };
    }
    return {
      hit: true,
      toi: hit.timeOfImpact,
      nx: hit.normal.x,
      ny: hit.normal.y,
      nz: hit.normal.z,
    };
  }

  public step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
  }

  public readBodyPose(
    posOut: THREE.Vector3,
    quatOut: THREE.Quaternion,
    linVelOut: THREE.Vector3,
    angVelOut: THREE.Vector3
  ): void {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    const v = this.chassisBody.linvel();
    const w = this.chassisBody.angvel();
    posOut.set(t.x, t.y, t.z);
    quatOut.set(r.x, r.y, r.z, r.w);
    linVelOut.set(v.x, v.y, v.z);
    angVelOut.set(w.x, w.y, w.z);
  }

  /**
   * Extracts real Rapier ContactForceEvents involving non-terrain obstacle/barrier/wall hits
   * (plus hard chassis bottom-outs or rollovers) and pushes CollisionEvents for visual deformation & damage.
   */
  public drainContactImpacts(
    outEvents: CollisionEvent[],
    onCollisionEvent?: (h1: number, h2: number, started: boolean) => void,
    onContactForceEvent?: (
      h1: number,
      h2: number,
      forceMag: number,
      dirX: number,
      dirY: number,
      dirZ: number
    ) => void
  ): {
    maxSeverity: number;
    hitLocalX: number;
    hitLocalZ: number;
    isRoofOrSide: boolean;
  } {
    let maxSeverity = 0;
    let bestLocalX = 0;
    let bestLocalZ = 0;
    let bestRoofOrSide = false;

    const pos = this.chassisBody.translation();
    const rot = this.chassisBody.rotation();
    _tmpBodyPos.set(pos.x, pos.y, pos.z);
    _tmpBodyQuat.set(rot.x, rot.y, rot.z, rot.w);
    _tmpInvQ.copy(_tmpBodyQuat).invert();

    const terrainHandle = this.terrainCollider?.handle ?? -1;

    this.eventQueue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const forceMag = ev.totalForceMagnitude();
      const dir = ev.maxForceDirection(_tmpDir);

      if (onContactForceEvent) {
        onContactForceEvent(h1, h2, forceMag, dir.x, dir.y, dir.z);
      }

      const h1Chassis = this.chassisColliderHandles.has(h1);
      const h2Chassis = this.chassisColliderHandles.has(h2);
      if (!h1Chassis && !h2Chassis) return;

      const otherHandle = h1Chassis ? h2 : h1;
      const isGroundTouch = otherHandle === terrainHandle;

      // Ignore light terrain belly touches; only flag real obstacle impacts or hard slams
      const deltaV = (forceMag * FIXED_PHYSICS_DT) / this.activeCar.massKg;
      const minDeltaV = isGroundTouch ? 4.8 : 1.3;
      if (deltaV < minDeltaV) return;

      const sign = h1Chassis ? 1 : -1;
      _tmpWorldNorm.set(dir.x * sign, dir.y * sign, dir.z * sign).normalize();
      _tmpLocalNorm.copy(_tmpWorldNorm).applyQuaternion(_tmpInvQ).normalize();

      // Approximate contact location on chassis perimeter along opposing inward normal
      const halfW = this.activeCar.width * 0.45;
      const halfL = this.activeCar.length * 0.46;
      const halfH = this.activeCar.height * 0.4;
      _tmpLocalPos.set(
        THREE.MathUtils.clamp(-_tmpLocalNorm.x * halfW, -halfW, halfW),
        THREE.MathUtils.clamp(-_tmpLocalNorm.y * halfH + 0.25, -0.1, this.activeCar.height * 0.7),
        THREE.MathUtils.clamp(-_tmpLocalNorm.z * halfL, -halfL, halfL)
      );
      _tmpWorldPos.copy(_tmpLocalPos).applyQuaternion(_tmpBodyQuat).add(_tmpBodyPos);

      const severity = Math.min(1, (deltaV - minDeltaV) / 14);
      if (severity > maxSeverity) {
        maxSeverity = severity;
        bestLocalX = _tmpLocalPos.x;
        bestLocalZ = _tmpLocalPos.z;
        bestRoofOrSide = Math.abs(_tmpLocalNorm.y) > 0.45 || !isGroundTouch;
      }

      outEvents.push({
        localPointX: _tmpLocalPos.x,
        localPointY: _tmpLocalPos.y,
        localPointZ: _tmpLocalPos.z,
        localNormalX: _tmpLocalNorm.x,
        localNormalY: _tmpLocalNorm.y,
        localNormalZ: _tmpLocalNorm.z,
        worldPointX: _tmpWorldPos.x,
        worldPointY: _tmpWorldPos.y,
        worldPointZ: _tmpWorldPos.z,
        severity,
      });
    });

    if (onCollisionEvent) {
      this.eventQueue.drainCollisionEvents(onCollisionEvent);
    } else {
      this.eventQueue.drainCollisionEvents(() => {});
    }

    return {
      maxSeverity,
      hitLocalX: bestLocalX,
      hitLocalZ: bestLocalZ,
      isRoofOrSide: bestRoofOrSide,
    };
  }

  public dispose(): void {
    this.eventQueue.free();
    this.world.free();
  }
}

export { _tmpForce, _tmpWorldPos };
