import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  ColliderCategory,
  PinballConfig,
  PinballImpactEvent,
} from '../../types/pinball';
import { FIXED_PHYSICS_DT, RapierWorldManager } from '../rapierWorld';

interface CachedBodyMotion {
  body: RAPIER.RigidBody;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  cx: number;
  cy: number;
  cz: number;
}

interface QueuedForceContact {
  h1: number;
  h2: number;
  forceMag: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

interface PairCooldownState {
  lastTriggerTime: number;
  activeContacts: number;
  rearmed: boolean;
}

// Pre-allocated scratch helpers (zero heap allocations inside 120 Hz step)
const _normal = new THREE.Vector3();
const _contactPt = new THREE.Vector3();
const _ptAccum = new THREE.Vector3();
const _solverPt = { x: 0, y: 0, z: 0 };
const _vecTmp = { x: 0, y: 0, z: 0 };
const _rA = new THREE.Vector3();
const _rB = new THREE.Vector3();
const _velA = new THREE.Vector3();
const _velB = new THREE.Vector3();
const _relVel = new THREE.Vector3();
const _crossA = new THREE.Vector3();
const _crossB = new THREE.Vector3();
const _invIxCrossA = new THREE.Vector3();
const _invIxCrossB = new THREE.Vector3();
const _angTermA = new THREE.Vector3();
const _angTermB = new THREE.Vector3();
const _comA = new THREE.Vector3();
const _comB = new THREE.Vector3();
const _impVec = { x: 0, y: 0, z: 0 };
const _ptVec = { x: 0, y: 0, z: 0 };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mulSdpMat3(
  m: RAPIER.SdpMatrix3,
  v: THREE.Vector3,
  out: THREE.Vector3
): void {
  const x = v.x;
  const y = v.y;
  const z = v.z;
  out.set(
    m.m11 * x + m.m12 * y + m.m13 * z,
    m.m12 * x + m.m22 * y + m.m23 * z,
    m.m13 * x + m.m23 * y + m.m33 * z
  );
}

/**
 * Isolated Rapier contact-normal & effective-mass Pinball impulse solver.
 *
 * Uses Rapier's actual contact manifold normals and contact points (with pre-step
 * velocity snapshots so physical solver resolution does not erase closing speed),
 * real rigid-body inverse mass & world inertia tensors, energy-gated subtle upward
 * lift, collider-category rules, and separation-aware pair cooldowns.
 */
export class PinballImpulseSolver {
  private readonly rapier: RapierWorldManager;
  private simTime = 0;

  private bodyCache = new Map<number, CachedBodyMotion>();
  private pairStates = new Map<string, PairCooldownState>();
  private queuedContacts: QueuedForceContact[] = [];
  private queuedCount = 0;
  private pendingImpacts: PinballImpactEvent[] = [];
  private readonly matTmp: RAPIER.SdpMatrix3;

  constructor(rapier: RapierWorldManager) {
    this.rapier = rapier;
    this.matTmp = new RAPIER.SdpMatrix3(new Float32Array(6));
  }

  public reset(): void {
    this.simTime = 0;
    this.bodyCache.clear();
    this.pairStates.clear();
    this.queuedCount = 0;
    this.pendingImpacts.length = 0;
  }

  /**
   * Captures linear/angular velocities and CoM positions for tracked dynamic vehicle bodies
   * right BEFORE `world.step(dt)` resolves non-penetration constraints.
   */
  public capturePreStepMotions(bodies: readonly RAPIER.RigidBody[]): void {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b || !b.isValid() || !b.isDynamic()) continue;
      const v = b.linvel(_vecTmp);
      const vx = v.x;
      const vy = v.y;
      const vz = v.z;
      const w = b.angvel(_vecTmp);
      const wx = w.x;
      const wy = w.y;
      const wz = w.z;
      const c = b.worldCom(_vecTmp);

      let entry = this.bodyCache.get(b.handle);
      if (!entry) {
        entry = {
          body: b,
          vx,
          vy,
          vz,
          wx,
          wy,
          wz,
          cx: c.x,
          cy: c.y,
          cz: c.z,
        };
        this.bodyCache.set(b.handle, entry);
      } else {
        entry.body = b;
        entry.vx = vx;
        entry.vy = vy;
        entry.vz = vz;
        entry.wx = wx;
        entry.wy = wy;
        entry.wz = wz;
        entry.cx = c.x;
        entry.cy = c.y;
        entry.cz = c.z;
      }
    }
  }

  private getPairKey(id1: number, id2: number): string {
    return id1 <= id2 ? `${id1}:${id2}` : `${id2}:${id1}`;
  }

  private getBodyOrColliderKey(col: RAPIER.Collider): number {
    const parent = col.parent();
    // Negative collider handle cleanly avoids collision with non-negative RigidBody handles
    return parent ? parent.handle : -(col.handle + 1);
  }

  /**
   * Called from Rapier EventQueue.drainCollisionEvents while Pinball Mode is active.
   * Tracks genuine contact start/separation so rapid subsequent impacts re-arm promptly.
   */
  public recordCollisionEvent = (h1: number, h2: number, started: boolean): void => {
    const cat1 = this.rapier.getColliderCategory(h1);
    const cat2 = this.rapier.getColliderCategory(h2);
    if (!this.isPairEligible(cat1, cat2, 1)) return;

    const col1 = this.rapier.world.getCollider(h1);
    const col2 = this.rapier.world.getCollider(h2);
    if (!col1 || !col2) return;

    const key = this.getPairKey(this.getBodyOrColliderKey(col1), this.getBodyOrColliderKey(col2));
    let state = this.pairStates.get(key);
    if (!state) {
      state = {
        lastTriggerTime: -10,
        activeContacts: 0,
        rearmed: true,
      };
      this.pairStates.set(key, state);
    }

    if (started) {
      state.activeContacts += 1;
    } else {
      state.activeContacts = Math.max(0, state.activeContacts - 1);
      if (state.activeContacts === 0) {
        state.rearmed = true;
      }
    }
  };

  /**
   * Called from Rapier EventQueue.drainContactForceEvents right after `world.step(dt)`.
   */
  public recordContactForceEvent = (
    h1: number,
    h2: number,
    forceMag: number,
    dirX: number,
    dirY: number,
    dirZ: number
  ): void => {
    if (this.queuedCount < this.queuedContacts.length) {
      const slot = this.queuedContacts[this.queuedCount];
      slot.h1 = h1;
      slot.h2 = h2;
      slot.forceMag = forceMag;
      slot.dirX = dirX;
      slot.dirY = dirY;
      slot.dirZ = dirZ;
    } else {
      this.queuedContacts.push({ h1, h2, forceMag, dirX, dirY, dirZ });
    }
    this.queuedCount++;
  };

  private isPairEligible(
    cat1: ColliderCategory,
    cat2: ColliderCategory,
    barrierBounceScale: number
  ): boolean {
    const c1Vehicle = cat1 === 'player' || cat1 === 'ai';
    const c2Vehicle = cat2 === 'player' || cat2 === 'ai';
    if (!c1Vehicle && !c2Vehicle) return false;
    if (c1Vehicle && c2Vehicle) return true;
    const other = c1Vehicle ? cat2 : cat1;
    return other === 'barrier' && barrierBounceScale > 0.01;
  }

  private getRuleScale(
    cat1: ColliderCategory,
    cat2: ColliderCategory,
    config: PinballConfig
  ): number {
    const c1Vehicle = cat1 === 'player' || cat1 === 'ai';
    const c2Vehicle = cat2 === 'player' || cat2 === 'ai';
    if (c1Vehicle && c2Vehicle) return 1.0;
    const other = c1Vehicle ? cat2 : cat1;
    if (other === 'barrier') {
      return THREE.MathUtils.clamp(config.barrierBounceScale, 0, 0.6);
    }
    // Terrain, trees, rocks, buildings & boundary walls preserve pure physical collisions
    return 0;
  }

  private readPreOrCurrentVelocity(
    body: RAPIER.RigidBody | null,
    point: THREE.Vector3,
    outVel: THREE.Vector3,
    outCom: THREE.Vector3
  ): void {
    if (!body || !body.isValid() || !body.isDynamic()) {
      outVel.set(0, 0, 0);
      outCom.copy(point);
      return;
    }
    const cached = this.bodyCache.get(body.handle);
    if (cached) {
      outCom.set(cached.cx, cached.cy, cached.cz);
      const rx = point.x - cached.cx;
      const ry = point.y - cached.cy;
      const rz = point.z - cached.cz;
      // v_point = v_com + omega x r
      outVel.set(
        cached.vx + (cached.wy * rz - cached.wz * ry),
        cached.vy + (cached.wz * rx - cached.wx * rz),
        cached.vz + (cached.wx * ry - cached.wy * rx)
      );
      return;
    }
    const c = body.worldCom(_vecTmp);
    outCom.set(c.x, c.y, c.z);
    const v = body.velocityAtPoint({ x: point.x, y: point.y, z: point.z }, _vecTmp);
    outVel.set(v.x, v.y, v.z);
  }

  /**
   * Resolves queued contact events into physically grounded Pinball impulses.
   */
  public resolveQueuedContacts(dt: number, config: PinballConfig): void {
    this.simTime += dt;
    if (!config.enabled || this.queuedCount === 0) {
      this.queuedCount = 0;
      return;
    }

    const world = this.rapier.world;

    for (let i = 0; i < this.queuedCount; i++) {
      const ev = this.queuedContacts[i];
      const cat1 = this.rapier.getColliderCategory(ev.h1);
      const cat2 = this.rapier.getColliderCategory(ev.h2);
      const ruleScale = this.getRuleScale(cat1, cat2, config);
      if (ruleScale <= 0.001) continue;

      const col1 = world.getCollider(ev.h1);
      const col2 = world.getCollider(ev.h2);
      if (!col1 || !col2 || !col1.isValid() || !col2.isValid()) continue;

      const body1 = col1.parent();
      const body2 = col2.parent();
      if (!body1 && !body2) continue;

      const id1 = this.getBodyOrColliderKey(col1);
      const id2 = this.getBodyOrColliderKey(col2);
      if (id1 === id2) continue;

      const pairKey = this.getPairKey(id1, id2);
      let state = this.pairStates.get(pairKey);
      if (!state) {
        state = { lastTriggerTime: -10, activeContacts: 1, rearmed: true };
        this.pairStates.set(pairKey, state);
      }

      const elapsed = this.simTime - state.lastTriggerTime;
      const minCooldown = state.rearmed ? 0.05 : 0.42;
      if (elapsed < minCooldown) continue;

      // Extract actual Rapier contact manifold normal & world contact point
      let foundManifold = false;
      let combinedRestitution = 0.14;
      let deepestDist = Infinity;

      world.contactPair(col1, col2, (manifold, flipped) => {
        const nVec = manifold.normal(_vecTmp);
        // manifold.normal() points from manifold shape1 -> shape2; unflip so normal points col1 -> col2
        const flipSign = flipped ? -1 : 1;
        const nx = nVec.x * flipSign;
        const ny = nVec.y * flipSign;
        const nz = nVec.z * flipSign;

        const solverCount = manifold.numSolverContacts();
        if (solverCount > 0) {
          _ptAccum.set(0, 0, 0);
          let validPts = 0;
          let minD = Infinity;
          for (let si = 0; si < solverCount; si++) {
            const pt = manifold.solverContactPoint(si, _solverPt);
            if (pt) {
              _ptAccum.x += pt.x;
              _ptAccum.y += pt.y;
              _ptAccum.z += pt.z;
              validPts++;
              const d = manifold.solverContactDist(si);
              if (d < minD) minD = d;
            }
          }
          if (validPts > 0 && minD <= deepestDist) {
            deepestDist = minD;
            _contactPt.copy(_ptAccum).multiplyScalar(1 / validPts);
            _normal.set(nx, ny, nz).normalize();
            combinedRestitution = Math.max(0.08, Math.min(0.45, manifold.restitution()));
            foundManifold = true;
          }
        }
      });

      if (!foundManifold) {
        // Fallback if narrow-phase manifold already cleared: use Rapier's maxForceDirection & body midpoint
        const len = Math.hypot(ev.dirX, ev.dirY, ev.dirZ);
        if (len < 1e-4) continue;
        _normal.set(ev.dirX / len, ev.dirY / len, ev.dirZ / len);
        const t1 = col1.translation(_vecTmp);
        const x1 = t1.x;
        const y1 = t1.y;
        const z1 = t1.z;
        const t2 = col2.translation(_vecTmp);
        _contactPt.set((x1 + t2.x) * 0.5, (y1 + t2.y) * 0.5, (z1 + t2.z) * 0.5);
      }

      // Compute pre-impact velocities at exact world contact point
      this.readPreOrCurrentVelocity(body1, _contactPt, _velA, _comA);
      this.readPreOrCurrentVelocity(body2, _contactPt, _velB, _comB);
      _relVel.subVectors(_velA, _velB);

      // Closing speed along normal (A -> B). If negative, orient normal consistently or check if separating.
      let closingSpeed = _relVel.dot(_normal);
      if (closingSpeed < 0) {
        // If contact force direction came from maxForceDirection or opposite sign, align with closing relative velocity
        if (Math.abs(closingSpeed) > 1.8 && -closingSpeed > 1.8 && !foundManifold) {
          _normal.negate();
          closingSpeed = -closingSpeed;
        }
      }

      // Also recover effective closing speed from solver contact force if bodies already bounced slightly
      const minClosingThresholdMs = 1.8; // ~6.5 km/h minimum closing impact
      const invMassA = body1 && body1.isDynamic() ? body1.invMass() : 0;
      const invMassB = body2 && body2.isDynamic() ? body2.invMass() : 0;
      if (invMassA + invMassB <= 0) continue;

      _rA.subVectors(_contactPt, _comA);
      _rB.subVectors(_contactPt, _comB);

      let angularInvMassTerm = 0;
      if (body1 && body1.isDynamic()) {
        _crossA.crossVectors(_rA, _normal);
        const invI = body1.effectiveWorldInvInertia(this.matTmp);
        mulSdpMat3(invI, _crossA, _invIxCrossA);
        _angTermA.crossVectors(_invIxCrossA, _rA);
        angularInvMassTerm += Math.max(0, _angTermA.dot(_normal));
      }
      if (body2 && body2.isDynamic()) {
        _crossB.crossVectors(_rB, _normal);
        const invI = body2.effectiveWorldInvInertia(this.matTmp);
        mulSdpMat3(invI, _crossB, _invIxCrossB);
        _angTermB.crossVectors(_invIxCrossB, _rB);
        angularInvMassTerm += Math.max(0, _angTermB.dot(_normal));
      }

      const denom = invMassA + invMassB + angularInvMassTerm;
      if (denom <= 1e-8) continue;
      const effectiveMass = 1 / denom;

      // Fallback closing speed estimate from Rapier contact force magnitude when pre-cache missed a frame
      const impulseEstimateSpeed = (ev.forceMag * FIXED_PHYSICS_DT) / Math.max(150, effectiveMass);
      const effectiveClosingSpeed = Math.max(closingSpeed, impulseEstimateSpeed * 0.72);
      if (effectiveClosingSpeed < minClosingThresholdMs) continue;

      // Base physical impulse: J_base = (1 + e) * m_eff * v_n
      const baseImpulseNs = (1 + combinedRestitution) * effectiveMass * effectiveClosingSpeed;
      const impactEnergyJ = 0.5 * effectiveMass * effectiveClosingSpeed * effectiveClosingSpeed;

      // Arcade Pinball bonus on top of Rapier's solved contact, strictly governed by real mass & inertia
      const mult = THREE.MathUtils.clamp(config.multiplier, 1, 5);
      const arcadeGain = (0.32 + (mult - 1) * 0.44) * ruleScale;
      const maxSafeImpulse = effectiveMass * 26.0; // Cap max delta-v to prevent tunneling
      const arcadeImpulseNs = Math.min(maxSafeImpulse, baseImpulseNs * arcadeGain);

      // Apply equal-and-opposite normal impulses at the exact contact point (preserves real spin & mass feel!)
      // Normal points from A -> B: A rebounds along -N, B launches along +N
      _ptVec.x = _contactPt.x;
      _ptVec.y = _contactPt.y;
      _ptVec.z = _contactPt.z;

      if (body1 && body1.isDynamic()) {
        _impVec.x = -_normal.x * arcadeImpulseNs;
        _impVec.y = -_normal.y * arcadeImpulseNs;
        _impVec.z = -_normal.z * arcadeImpulseNs;
        body1.applyImpulseAtPoint(_impVec, _ptVec, true);
      }
      if (body2 && body2.isDynamic()) {
        _impVec.x = _normal.x * arcadeImpulseNs;
        _impVec.y = _normal.y * arcadeImpulseNs;
        _impVec.z = _normal.z * arcadeImpulseNs;
        body2.applyImpulseAtPoint(_impVec, _ptVec, true);
      }

      // Energy-gated subtle upward launch: zero on low-speed bumps, scales with energy + multiplier + user scale
      const upwardScale = THREE.MathUtils.clamp(config.upwardLaunchScale, 0, 1);
      if (upwardScale > 0.01) {
        const energyGate = smoothstep(5500, 42000, impactEnergyJ);
        const speedGate = smoothstep(3.0, 9.5, effectiveClosingSpeed);
        const liftFactor =
          upwardScale * 0.26 * (0.55 + 0.16 * mult) * energyGate * speedGate * ruleScale;
        const rawLiftImpulse = arcadeImpulseNs * liftFactor;

        if (rawLiftImpulse > 1) {
          if (body1 && body1.isDynamic()) {
            const cappedJ1 = Math.min(rawLiftImpulse, body1.mass() * 5.8);
            _impVec.x = 0;
            _impVec.y = cappedJ1;
            _impVec.z = 0;
            body1.applyImpulse(_impVec, true);
          }
          if (body2 && body2.isDynamic()) {
            const cappedJ2 = Math.min(rawLiftImpulse, body2.mass() * 5.8);
            _impVec.x = 0;
            _impVec.y = cappedJ2;
            _impVec.z = 0;
            body2.applyImpulse(_impVec, true);
          }
        }
      }

      // Mark pair triggered & awaiting separation
      state.lastTriggerTime = this.simTime;
      state.rearmed = false;

      const involvesPlayer = cat1 === 'player' || cat2 === 'player';
      const otherCat = cat1 === 'player' ? cat2 : cat1 === 'ai' ? cat2 : cat1;
      const severity = Math.min(1, effectiveClosingSpeed / 22);

      this.pendingImpacts.push({
        worldPointX: _contactPt.x,
        worldPointY: _contactPt.y,
        worldPointZ: _contactPt.z,
        normalX: _normal.x,
        normalY: _normal.y,
        normalZ: _normal.z,
        impulseNs: arcadeImpulseNs,
        closingSpeedMs: effectiveClosingSpeed,
        severity,
        involvesPlayer,
        otherCategory: otherCat,
      });
    }

    this.queuedCount = 0;

    // Periodically prune stale pair records that have long separated
    if (this.pairStates.size > 48) {
      for (const [key, st] of this.pairStates) {
        if (st.activeContacts === 0 && this.simTime - st.lastTriggerTime > 2.5) {
          this.pairStates.delete(key);
        }
      }
    }
  }

  public drainImpacts(out: PinballImpactEvent[]): number {
    const n = this.pendingImpacts.length;
    for (let i = 0; i < n; i++) {
      out.push(this.pendingImpacts[i]);
    }
    this.pendingImpacts.length = 0;
    return n;
  }
}
