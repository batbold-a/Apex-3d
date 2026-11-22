export type AIBehaviorMode = 'cruise' | 'evade' | 'arena';

export type ColliderCategory =
  | 'player'
  | 'ai'
  | 'barrier'
  | 'terrain'
  | 'world_obstacle';

export interface PinballConfig {
  /** Strictly OFF by default so realistic physics & benchmarks remain isolated. */
  enabled: boolean;
  /** Arcade impulse multiplier (1x .. 5x). */
  multiplier: number;
  /** Configurable upward launch intensity (0 .. 1, subtle 0.25 by default). */
  upwardLaunchScale: number;
  /** Configurable Pinball bounce factor for static barriers/guardrails (0 .. 0.6). */
  barrierBounceScale: number;
  /** Number of dynamic Rapier AI target vehicles (0 .. 8, default 4). */
  aiCount: number;
  /** Active AI driving brain. */
  aiBehavior: AIBehaviorMode;
  /** Desired cruising speed for AI vehicles (km/h). */
  aiTargetSpeedKmh: number;
  /** Aggression / intercept commitment for Arena & Evade behaviors (0 .. 1). */
  aiAggression: number;
  /** Target spawn/respawn ring distance around the player (meters). */
  aiSpawnDistanceM: number;
}

export const DEFAULT_PINBALL_CONFIG: PinballConfig = {
  enabled: false,
  multiplier: 2,
  upwardLaunchScale: 0.2,
  barrierBounceScale: 0.25,
  aiCount: 4,
  aiBehavior: 'arena',
  aiTargetSpeedKmh: 75,
  aiAggression: 0.65,
  aiSpawnDistanceM: 48,
};

export interface PinballImpactEvent {
  worldPointX: number;
  worldPointY: number;
  worldPointZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  /** Effective impulse applied (N*s). */
  impulseNs: number;
  /** Closing speed along contact normal (m/s). */
  closingSpeedMs: number;
  /** Normalized impact severity 0..1 for VFX & audio. */
  severity: number;
  /** True when the player vehicle was one of the colliding bodies. */
  involvesPlayer: boolean;
  otherCategory: ColliderCategory;
}

export interface PinballRadarBlip {
  id: number;
  x: number;
  z: number;
  headingRad: number;
  speedKmh: number;
  carName: string;
  behavior: AIBehaviorMode;
}

export interface PinballTelemetrySummary {
  enabled: boolean;
  multiplier: number;
  upwardLaunchScale: number;
  barrierBounceScale: number;
  aiCount: number;
  activeAiCount: number;
  aiBehavior: AIBehaviorMode;
  aiTargetSpeedKmh: number;
  aiAggression: number;
  aiSpawnDistanceM: number;
  lastImpactImpulseNs: number;
  lastImpactSpeedKmh: number;
  lastImpactAtMs: number;
  hitCount: number;
  perfThrottled: boolean;
  aiRadarBlips: PinballRadarBlip[];
}
