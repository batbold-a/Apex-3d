import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
  DEFAULT_PINBALL_CONFIG,
  PinballConfig,
  PinballImpactEvent,
  PinballTelemetrySummary,
} from '../../types/pinball';
import { MapId } from '../../types/vehicle';
import { EngineAudio } from '../audio';
import { SurfaceParticleSystem } from '../particles';
import { VehiclePhysics } from '../physics';
import { RapierWorldManager } from '../rapierWorld';
import { AITargetFleet } from './AITargetFleet';
import { PinballImpulseSolver } from './PinballImpulseSolver';

const _playerFwd = new THREE.Vector3();

/**
 * Self-contained coordinator for Pinball Mode.
 * Isolates PinballImpulseSolver and AITargetFleet behind strict enable guards
 * so standard realistic driving and physics benchmarks remain untouched when OFF.
 */
export class PinballMode {
  private readonly physics: VehiclePhysics;
  private readonly rapier: RapierWorldManager;
  public readonly solver: PinballImpulseSolver;
  public readonly fleet: AITargetFleet;

  private config: PinballConfig = { ...DEFAULT_PINBALL_CONFIG };
  private bodiesBuffer: RAPIER.RigidBody[] = [];
  private pendingImpacts: PinballImpactEvent[] = [];

  private lastImpactImpulseNs = 0;
  private lastImpactSpeedKmh = 0;
  private lastImpactAtMs = 0;
  private hitCount = 0;
  private attachedHooks = false;

  constructor(
    physics: VehiclePhysics,
    rapier: RapierWorldManager,
    mapId: MapId,
    scene: THREE.Scene | null = null
  ) {
    this.physics = physics;
    this.rapier = rapier;
    this.solver = new PinballImpulseSolver(rapier);
    this.fleet = new AITargetFleet(rapier, mapId, scene);
  }

  public setScene(scene: THREE.Scene | null): void {
    this.fleet.setScene(scene);
  }

  public setNightMode(isNight: boolean): void {
    this.fleet.setNightMode(isNight);
  }

  public getConfig(): PinballConfig {
    return this.config;
  }

  private getPlayerHeadingRad(): number {
    _playerFwd.set(0, 0, -1).applyQuaternion(this.physics.currQuaternion);
    return Math.atan2(-_playerFwd.x, -_playerFwd.z);
  }

  public setConfig(next: PinballConfig): void {
    const wasEnabled = this.config.enabled;
    this.config = {
      ...next,
      multiplier: THREE.MathUtils.clamp(Math.round(next.multiplier), 1, 5),
      upwardLaunchScale: THREE.MathUtils.clamp(next.upwardLaunchScale, 0, 1),
      barrierBounceScale: THREE.MathUtils.clamp(next.barrierBounceScale, 0, 0.6),
      aiCount: THREE.MathUtils.clamp(Math.round(next.aiCount), 0, 8),
      aiTargetSpeedKmh: THREE.MathUtils.clamp(next.aiTargetSpeedKmh, 25, 160),
      aiAggression: THREE.MathUtils.clamp(next.aiAggression, 0, 1),
      aiSpawnDistanceM: THREE.MathUtils.clamp(next.aiSpawnDistanceM, 24, 140),
    };

    if (!this.config.enabled) {
      if (wasEnabled || this.attachedHooks) {
        this.disableInternal();
      }
      return;
    }

    if (!wasEnabled || !this.attachedHooks) {
      this.enableInternal();
    }

    this.fleet.syncCount(
      this.config.aiCount,
      this.physics.currPosition,
      this.getPlayerHeadingRad(),
      this.config.aiSpawnDistanceM
    );
  }

  private enableInternal(): void {
    this.rapier.setPlayerCollisionEventsEnabled(true);
    this.solver.reset();
    this.physics.setPinballHooks({
      onBeforeStep: this.handleBeforeRapierStep,
      onAfterStep: this.handleAfterRapierStep,
      onCollisionEvent: this.solver.recordCollisionEvent,
      onContactForceEvent: this.solver.recordContactForceEvent,
    });
    this.attachedHooks = true;
  }

  private disableInternal(): void {
    this.physics.setPinballHooks(null);
    this.rapier.setPlayerCollisionEventsEnabled(false);
    this.fleet.clear();
    this.solver.reset();
    this.pendingImpacts.length = 0;
    this.attachedHooks = false;
  }

  public respawnAiFleet(): void {
    if (!this.config.enabled) return;
    this.fleet.syncCount(
      this.config.aiCount,
      this.physics.currPosition,
      this.getPlayerHeadingRad(),
      this.config.aiSpawnDistanceM
    );
    this.fleet.respawnAll(
      this.physics.currPosition,
      this.getPlayerHeadingRad(),
      this.config.aiSpawnDistanceM
    );
  }

  private handleBeforeRapierStep = (dt: number): void => {
    if (!this.config.enabled) return;

    const perfThrottled = this.physics.perfMonitor.overloadActive;
    const heading = this.getPlayerHeadingRad();

    this.fleet.stepBeforeRapier(
      dt,
      this.config,
      this.physics.currPosition,
      this.physics.velocity,
      heading,
      perfThrottled
    );

    const aiBodies = this.fleet.getBodies();
    this.bodiesBuffer.length = 0;
    if (this.rapier.chassisBody && this.rapier.chassisBody.isValid()) {
      this.bodiesBuffer.push(this.rapier.chassisBody);
    }
    for (let i = 0; i < aiBodies.length; i++) {
      this.bodiesBuffer.push(aiBodies[i]);
    }
    this.solver.capturePreStepMotions(this.bodiesBuffer);
  };

  private handleAfterRapierStep = (dt: number): void => {
    if (!this.config.enabled) return;
    this.fleet.syncAfterRapierStep();
    this.solver.resolveQueuedContacts(dt, this.config);
    this.solver.drainImpacts(this.pendingImpacts);
  };

  /**
   * Frame-rate visual interpolation, pooled particle bursts, AI deformation & crash audio.
   */
  public updateFrameVisuals(
    particles: SurfaceParticleSystem | null,
    audio: EngineAudio | null,
    isSoftwareGl: boolean
  ): PinballImpactEvent[] {
    if (!this.config.enabled) return [];

    this.fleet.updateVisuals(this.physics.getRenderAlpha());

    const drained = this.pendingImpacts.splice(0, this.pendingImpacts.length);
    if (drained.length > 0) {
      let maxSeverity = 0;
      const perfThrottled = isSoftwareGl || this.physics.perfMonitor.overloadActive;

      for (let i = 0; i < drained.length; i++) {
        const imp = drained[i];
        this.fleet.applyImpactDeformation(imp);
        particles?.emitPinballBurst(
          imp.worldPointX,
          imp.worldPointY,
          imp.worldPointZ,
          imp.normalX,
          imp.normalY,
          imp.normalZ,
          imp.severity,
          perfThrottled
        );
        if (imp.severity > maxSeverity) {
          maxSeverity = imp.severity;
        }
        if (imp.involvesPlayer) {
          this.lastImpactImpulseNs = Math.round(imp.impulseNs);
          this.lastImpactSpeedKmh = Math.round(imp.closingSpeedMs * 3.6);
          this.lastImpactAtMs = Date.now();
          this.hitCount += 1;
        }
      }

      if (maxSeverity > 0.05) {
        audio?.playImpact(Math.min(1, maxSeverity * 1.15));
      }
    }

    return drained;
  }

  public getTelemetrySummary(): PinballTelemetrySummary {
    return {
      enabled: this.config.enabled,
      multiplier: this.config.multiplier,
      upwardLaunchScale: this.config.upwardLaunchScale,
      barrierBounceScale: this.config.barrierBounceScale,
      aiCount: this.config.aiCount,
      activeAiCount: this.fleet.getActiveCount(),
      aiBehavior: this.config.aiBehavior,
      aiTargetSpeedKmh: this.config.aiTargetSpeedKmh,
      aiAggression: this.config.aiAggression,
      aiSpawnDistanceM: this.config.aiSpawnDistanceM,
      lastImpactImpulseNs: this.lastImpactImpulseNs,
      lastImpactSpeedKmh: this.lastImpactSpeedKmh,
      lastImpactAtMs: this.lastImpactAtMs,
      hitCount: this.hitCount,
      perfThrottled: this.physics.perfMonitor.overloadActive,
      aiRadarBlips: this.config.enabled ? this.fleet.getRadarBlips(this.config.aiBehavior) : [],
    };
  }

  public dispose(): void {
    this.disableInternal();
  }
}
