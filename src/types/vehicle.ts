export type DrivetrainType = 'RWD' | 'AWD' | '4WD';

export type CarBodyStyle = 'coupe' | 'rally' | 'suv' | 'muscle';

export type CameraMode = 'chase' | 'hood' | 'cockpit' | 'wheel' | 'orbit';

export type SurfaceType = 'asphalt' | 'cobble' | 'gravel' | 'rock' | 'sand' | 'grass';

export type HudMode = 'horizon' | 'beamng';

export type TimeOfDay = 'day' | 'night';

export type ReplayCameraMode =
  | 'director'
  | 'trackside'
  | 'helicopter'
  | 'fender'
  | 'chase'
  | 'hood'
  | 'cockpit';

export interface ReplayStateSummary {
  recordingEnabled: boolean;
  isReplaying: boolean;
  isPlaying: boolean;
  playbackSpeed: number;
  cameraMode: ReplayCameraMode;
  activeDirectorShot: string;
  cinemaBars: boolean;
  showDrivingLine: boolean;
  showReplayTelemetry: boolean;
  currentTimeSec: number;
  durationSec: number;
  bufferedSeconds: number;
  frameCount: number;
}

export type MapId =
  | 'proving-valley'
  | 'mountain-pass'
  | 'desert-baja'
  | 'highway-circuit'
  | 'testing-facility';

export interface MapSpec {
  id: MapId;
  name: string;
  subtitle: string;
  difficulty: string;
  surfaceSummary: string;
  recommendedGear: string;
  spawnPos: [number, number, number];
  spawnHeading: number;
  accentColor: string;
}

export interface CarSpec {
  id: string;
  name: string;
  subtitle: string;
  engineLabel: string;
  bodyStyle: CarBodyStyle;
  drivetrain: DrivetrainType;
  hasDiffLock: boolean;
  horsepower: number;
  peakTorqueNm: number;
  massKg: number;
  topSpeedKmh: number;
  // Dimensions in meters
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  trackWidth: number;
  wheelRadius: number;
  wheelWidth: number;
  // Suspension physics
  suspensionRestLength: number;
  suspensionMaxTravel: number;
  springStiffness: number; // N/m per wheel
  damperBump: number; // Ns/m compression
  damperRebound: number; // Ns/m extension
  antiRollStiffness: number; // N/m lateral anti-roll
  // Engine & transmission
  idleRpm: number;
  redlineRpm: number;
  maxRpm: number;
  // [R, N, 1..N] mapped by gearIndex (-1..N)
  reverseRatio: number;
  forwardRatios: number[];
  finalDrive: number;
  // Brakes & tires
  maxBrakeForce: number;
  handbrakeForce: number;
  tireGrip: number;
  offroadBias: number; // 0..1 how well it handles rough/loose terrain
  dragCoeff: number;
  downforceCoeff: number;
  maxSteerDeg: number;
  // Audio character
  engineBaseFreq: number;
  hasTurbo: boolean;
  hasSupercharger: boolean;
  // Visual paints
  defaultColor: string;
  paintOptions: { name: string; hex: string }[];
  caliperColor: string;
  springColor: string;
}

export type TireCompoundId =
  | 'street'
  | 'sport'
  | 'semi-slick'
  | 'offroad-at'
  | 'mud-terrain';

export interface VehicleTuningSetup {
  // Engine & induction
  powerMultiplier: number; // 0.85..1.45
  boostPressureScale: number; // 0.8..1.35
  // Transmission & Differentials
  gearRatios: number[];
  finalDrive: number;
  clutchEngagementRate: number; // 0.5..2.0 (bite sharpness)
  awdFrontSplit: number; // 0..0.55
  diffFrontAccelLock: number; // 0..1
  diffFrontDecelLock: number; // 0..1
  diffFrontPreloadNm: number; // 0..350
  diffRearAccelLock: number; // 0..1
  diffRearDecelLock: number; // 0..1
  diffRearPreloadNm: number; // 0..450
  diffCenterLock: number; // 0..1
  // Suspension & Alignment
  springRateScaleFront: number; // 0.7..1.5
  springRateScaleRear: number; // 0.7..1.5
  damperBumpScale: number; // 0.6..1.6
  damperReboundScale: number; // 0.6..1.6
  antiRollFrontNmPerM: number;
  antiRollRearNmPerM: number;
  bumpStopStiffness: number; // N/m
  rideHeightOffsetM: number; // -0.05..+0.08
  frontCamberDeg: number; // -4.5..+1.0
  rearCamberDeg: number; // -4.0..+1.0
  frontToeDeg: number; // -0.6..+0.6 (+ toe in)
  rearToeDeg: number; // -0.6..+0.6 (+ toe in)
  casterDeg: number; // 3.0..9.5
  steeringRatioScale: number; // 0.75..1.35
  // Tires & Brakes & Aero
  tireCompound: TireCompoundId;
  tirePressurePsiFront: number; // 20..44
  tirePressurePsiRear: number; // 20..44
  brakeBiasFront: number; // 0.45..0.78
  absEnabled: boolean;
  aeroDragScale: number; // 0.85..1.3
  downforceScale: number; // 0.5..1.6
}

export interface DamageTelemetry {
  overallIntegrity: number; // 0..100%
  front: number; // 0..1 damage
  rear: number; // 0..1 damage
  left: number; // 0..1 damage
  right: number; // 0..1 damage
  engineHealth: number; // 0..100%
  suspensionHealth: [number, number, number, number]; // 0..100% [FL, FR, RL, RR]
  alignmentPullDeg: number;
}

export interface CollisionEvent {
  localPointX: number;
  localPointY: number;
  localPointZ: number;
  localNormalX: number;
  localNormalY: number;
  localNormalZ: number;
  worldPointX: number;
  worldPointY: number;
  worldPointZ: number;
  severity: number; // 0..1
}

export type WorldCollider =
  | {
      type: 'circle';
      x: number;
      z: number;
      radius: number;
      maxY?: number;
      category?: 'barrier' | 'world_obstacle';
    }
  | {
      type: 'box';
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
      maxY?: number;
      category?: 'barrier' | 'world_obstacle';
    };

export interface TelemetryData {
  speedKmh: number;
  speedMs: number;
  rpm: number;
  redlineRpm: number;
  maxRpm: number;
  gearIndex: number; // -1 = R, 0 = N, 1..6 = gears
  gearLabel: string;
  autoShift: boolean;
  throttle: number;
  brake: number;
  handbrake: number;
  steerNorm: number; // -1..1
  engineTorqueNm: number;
  wheelTorqueNm: number;
  gearRatioActive: number;
  diffLock: boolean;
  hasDiffLock: boolean;
  driftMode: boolean;
  surfaceType: SurfaceType;
  surfaceName: string;
  surfaceGrip: number;
  surfaceRoughness: number;
  slopeGradePct: number;
  // [FL, FR, RL, RR]
  wheelCompression: [number, number, number, number]; // 0..1 normalized
  wheelGroundContact: [boolean, boolean, boolean, boolean];
  wheelSlip: [number, number, number, number];
  pitchDeg: number;
  rollDeg: number;
  isLugging: boolean;
  isRevLimiting: boolean;
  isAirborne: boolean;
  posX: number;
  posZ: number;
  headingDeg: number;
  distanceKm: number;
  zoneName: string;
  damage: DamageTelemetry;
  // Milestone 1B rich dynamics telemetry
  engineLoad?: number; // 0..1
  boostBar?: number;
  engineTempC?: number;
  absActive?: boolean;
  lateralG?: number;
  longitudinalG?: number;
  selfAligningTorqueNm?: number;
  steeringAnglesDeg?: [number, number];
  wheelRpm?: [number, number, number, number];
  slipRatio?: [number, number, number, number];
  slipAngleDeg?: [number, number, number, number];
  normalLoadN?: [number, number, number, number];
  tireForceLongN?: [number, number, number, number];
  tireForceLatN?: [number, number, number, number];
  tireTempC?: [number, number, number, number];
  tireWear?: [number, number, number, number];
  brakeTempC?: [number, number, number, number];
  perf?: {
    physicsStepMs: number;
    renderFps: number;
    overloadActive: boolean;
    substepsLastFrame: number;
  };
}
