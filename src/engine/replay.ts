import * as THREE from 'three';
import {
  CarSpec,
  ReplayCameraMode,
  SurfaceType,
  TelemetryData,
} from '../types/vehicle';
import { VehiclePhysics } from './physics';
import { getTerrainHeightRaw } from './terrain';

export const MAX_REPLAY_SECONDS = 30.0;
const SAMPLE_INTERVAL_SEC = 1 / 60;
const RING_CAPACITY = 1920; // >30s at 60 Hz with buffer headroom
const MAX_LINE_SAMPLES = 540;

export interface ReplayFrame {
  timeSec: number;
  posX: number;
  posY: number;
  posZ: number;
  quatX: number;
  quatY: number;
  quatZ: number;
  quatW: number;
  velX: number;
  velY: number;
  velZ: number;
  speedMs: number;
  speedKmh: number;
  steerSmooth: number;
  throttleSmooth: number;
  brakeSmooth: number;
  handbrakeSmooth: number;
  gearIndex: number;
  gearLabel: string;
  rpm: number;
  redlineRpm: number;
  maxRpm: number;
  engineLoad: number;
  boostBar: number;
  engineDamage: number;
  absActive: boolean;
  driftMode: boolean;
  diffLock: boolean;
  lateralG: number;
  longitudinalG: number;
  pitchDeg: number;
  rollDeg: number;
  headingDeg: number;
  distanceKm: number;
  surfaceType: SurfaceType;
  surfaceName: string;
  surfaceGrip: number;
  avgRoughness: number;
  slopeGradePct: number;
  wheelOffsetY: [number, number, number, number];
  wheelSteerRad: [number, number, number, number];
  wheelSpinAngle: [number, number, number, number];
  wheelCompression: [number, number, number, number];
  wheelSlip: [number, number, number, number];
  wheelSlipAngleDeg: [number, number, number, number];
  wheelSlipRatio: [number, number, number, number];
  wheelAngularVel: [number, number, number, number];
  wheelGroundContact: [boolean, boolean, boolean, boolean];
  suspensionDamage: [number, number, number, number];
  overallIntegrity: number;
  engineHealth: number;
}

export function createEmptyReplayFrame(): ReplayFrame {
  return {
    timeSec: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    quatX: 0,
    quatY: 0,
    quatZ: 0,
    quatW: 1,
    velX: 0,
    velY: 0,
    velZ: 0,
    speedMs: 0,
    speedKmh: 0,
    steerSmooth: 0,
    throttleSmooth: 0,
    brakeSmooth: 0,
    handbrakeSmooth: 0,
    gearIndex: 1,
    gearLabel: '1',
    rpm: 900,
    redlineRpm: 7000,
    maxRpm: 8000,
    engineLoad: 0,
    boostBar: 0,
    engineDamage: 0,
    absActive: false,
    driftMode: false,
    diffLock: false,
    lateralG: 0,
    longitudinalG: 0,
    pitchDeg: 0,
    rollDeg: 0,
    headingDeg: 0,
    distanceKm: 0,
    surfaceType: 'asphalt',
    surfaceName: 'Smooth Asphalt',
    surfaceGrip: 1.08,
    avgRoughness: 0.04,
    slopeGradePct: 0,
    wheelOffsetY: [0, 0, 0, 0],
    wheelSteerRad: [0, 0, 0, 0],
    wheelSpinAngle: [0, 0, 0, 0],
    wheelCompression: [0.35, 0.35, 0.35, 0.35],
    wheelSlip: [0, 0, 0, 0],
    wheelSlipAngleDeg: [0, 0, 0, 0],
    wheelSlipRatio: [0, 0, 0, 0],
    wheelAngularVel: [0, 0, 0, 0],
    wheelGroundContact: [true, true, true, true],
    suspensionDamage: [0, 0, 0, 0],
    overallIntegrity: 100,
    engineHealth: 100,
  };
}

function copyFrame(src: ReplayFrame, dst: ReplayFrame): void {
  dst.timeSec = src.timeSec;
  dst.posX = src.posX;
  dst.posY = src.posY;
  dst.posZ = src.posZ;
  dst.quatX = src.quatX;
  dst.quatY = src.quatY;
  dst.quatZ = src.quatZ;
  dst.quatW = src.quatW;
  dst.velX = src.velX;
  dst.velY = src.velY;
  dst.velZ = src.velZ;
  dst.speedMs = src.speedMs;
  dst.speedKmh = src.speedKmh;
  dst.steerSmooth = src.steerSmooth;
  dst.throttleSmooth = src.throttleSmooth;
  dst.brakeSmooth = src.brakeSmooth;
  dst.handbrakeSmooth = src.handbrakeSmooth;
  dst.gearIndex = src.gearIndex;
  dst.gearLabel = src.gearLabel;
  dst.rpm = src.rpm;
  dst.redlineRpm = src.redlineRpm;
  dst.maxRpm = src.maxRpm;
  dst.engineLoad = src.engineLoad;
  dst.boostBar = src.boostBar;
  dst.engineDamage = src.engineDamage;
  dst.absActive = src.absActive;
  dst.driftMode = src.driftMode;
  dst.diffLock = src.diffLock;
  dst.lateralG = src.lateralG;
  dst.longitudinalG = src.longitudinalG;
  dst.pitchDeg = src.pitchDeg;
  dst.rollDeg = src.rollDeg;
  dst.headingDeg = src.headingDeg;
  dst.distanceKm = src.distanceKm;
  dst.surfaceType = src.surfaceType;
  dst.surfaceName = src.surfaceName;
  dst.surfaceGrip = src.surfaceGrip;
  dst.avgRoughness = src.avgRoughness;
  dst.slopeGradePct = src.slopeGradePct;
  dst.overallIntegrity = src.overallIntegrity;
  dst.engineHealth = src.engineHealth;
  for (let i = 0; i < 4; i++) {
    dst.wheelOffsetY[i] = src.wheelOffsetY[i];
    dst.wheelSteerRad[i] = src.wheelSteerRad[i];
    dst.wheelSpinAngle[i] = src.wheelSpinAngle[i];
    dst.wheelCompression[i] = src.wheelCompression[i];
    dst.wheelSlip[i] = src.wheelSlip[i];
    dst.wheelSlipAngleDeg[i] = src.wheelSlipAngleDeg[i];
    dst.wheelSlipRatio[i] = src.wheelSlipRatio[i];
    dst.wheelAngularVel[i] = src.wheelAngularVel[i];
    dst.wheelGroundContact[i] = src.wheelGroundContact[i];
    dst.suspensionDamage[i] = src.suspensionDamage[i];
  }
}

// Pre-allocated scratch helpers (zero GC in recording & playback loops)
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _eulerTmp = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwdTmp = new THREE.Vector3();
const _rightTmp = new THREE.Vector3();

/**
 * Fixed-capacity pre-allocated 30-second telemetry ring buffer with O(log N)
 * timestamp lookup and slerp/lerp frame interpolation for smooth slow motion.
 */
export class TelemetryReplayRecorder {
  private readonly slots: ReplayFrame[];
  private head = 0;
  private count = 0;
  private simClock = 0;
  private sampleAccum = 0;

  constructor() {
    this.slots = new Array<ReplayFrame>(RING_CAPACITY);
    for (let i = 0; i < RING_CAPACITY; i++) {
      this.slots[i] = createEmptyReplayFrame();
    }
  }

  public clear(): void {
    this.head = 0;
    this.count = 0;
    this.simClock = 0;
    this.sampleAccum = 0;
  }

  public getFrameCount(): number {
    return this.count;
  }

  public getDurationSec(): number {
    if (this.count < 2) return 0;
    const oldest = this.slots[this.head];
    const newest = this.slots[(this.head + this.count - 1) % RING_CAPACITY];
    return Math.max(0, newest.timeSec - oldest.timeSec);
  }

  public getSlotAt(index: number): ReplayFrame {
    return this.slots[(this.head + index) % RING_CAPACITY];
  }

  public record(p: VehiclePhysics, dt: number, force = false): void {
    this.simClock += dt;
    this.sampleAccum += dt;
    if (!force && this.count > 0 && this.sampleAccum < SAMPLE_INTERVAL_SEC) {
      return;
    }
    this.sampleAccum = 0;

    let writeIdx: number;
    if (this.count < RING_CAPACITY) {
      writeIdx = (this.head + this.count) % RING_CAPACITY;
      this.count++;
    } else {
      writeIdx = this.head;
      this.head = (this.head + 1) % RING_CAPACITY;
    }

    const slot = this.slots[writeIdx];
    slot.timeSec = this.simClock;
    slot.posX = p.position.x;
    slot.posY = p.position.y;
    slot.posZ = p.position.z;
    slot.quatX = p.quaternion.x;
    slot.quatY = p.quaternion.y;
    slot.quatZ = p.quaternion.z;
    slot.quatW = p.quaternion.w;
    slot.velX = p.velocity.x;
    slot.velY = p.velocity.y;
    slot.velZ = p.velocity.z;
    slot.speedMs = p.velocity.length();
    slot.speedKmh = Math.round(slot.speedMs * 3.6);
    slot.steerSmooth = p.steerSmooth;
    slot.throttleSmooth = p.throttleSmooth;
    slot.brakeSmooth = p.brakeSmooth;
    slot.handbrakeSmooth = p.handbrakeSmooth;
    slot.gearIndex = p.gearIndex;
    slot.gearLabel = p.getGearLabel();
    slot.rpm = p.engineRpm;
    slot.redlineRpm = p.car.redlineRpm;
    slot.maxRpm = p.car.maxRpm;
    slot.engineLoad = p.engineLoad;
    slot.boostBar = p.boostBar;
    slot.engineDamage = p.engineDamage;
    slot.absActive = p.absActive;
    slot.driftMode = p.driftMode;
    slot.diffLock = p.car.hasDiffLock && p.diffLock;
    slot.lateralG = p.lateralG;
    slot.longitudinalG = p.longitudinalG;

    _fwdTmp.set(0, 0, -1).applyQuaternion(p.quaternion).normalize();
    _rightTmp.set(1, 0, 0).applyQuaternion(p.quaternion).normalize();
    _eulerTmp.setFromQuaternion(p.quaternion, 'YXZ');

    slot.pitchDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(_fwdTmp.y, -1, 1)));
    slot.rollDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(_rightTmp.y, -1, 1)));
    slot.headingDeg = ((THREE.MathUtils.radToDeg(-_eulerTmp.y) % 360) + 360) % 360;
    slot.distanceKm = p.distanceMeters / 1000;

    const centerTerr = p.wheelTerrain[2] ?? p.wheelTerrain[0];
    slot.surfaceType = centerTerr?.surfaceType ?? 'asphalt';
    slot.surfaceName = centerTerr?.surfaceName ?? 'Smooth Asphalt';
    slot.surfaceGrip = centerTerr?.grip ?? 1.08;
    slot.slopeGradePct = centerTerr
      ? Math.round(Math.tan(Math.acos(THREE.MathUtils.clamp(centerTerr.normalY, 0.5, 1))) * 100)
      : 0;

    let roughSum = 0;
    let avgSuspDmg = 0;
    const maxNorm = Math.max(0.05, p.car.suspensionMaxTravel);
    for (let i = 0; i < 4; i++) {
      slot.wheelOffsetY[i] = p.wheelOffsetY[i];
      slot.wheelSteerRad[i] = p.steering.wheelAnglesRad[i];
      slot.wheelSpinAngle[i] = p.wheelSpinAngle[i];
      slot.wheelCompression[i] = Math.min(1, p.wheelCompression[i] / maxNorm);
      slot.wheelSlip[i] = p.wheelSlip[i];
      slot.wheelSlipAngleDeg[i] = p.tires.slipAngleDeg[i];
      slot.wheelSlipRatio[i] = p.tires.slipRatio[i];
      slot.wheelAngularVel[i] = p.wheelAngularVel[i];
      slot.wheelGroundContact[i] = p.wheelGroundContact[i];
      slot.suspensionDamage[i] = p.suspensionDamage[i];
      roughSum += (p.wheelTerrain[i]?.roughness ?? 0) * 0.25;
      avgSuspDmg += p.suspensionDamage[i] * 0.25;
    }
    slot.avgRoughness = roughSum;

    const avgBodyDmg = (p.frontDamage + p.rearDamage + p.leftDamage + p.rightDamage) * 0.25;
    slot.overallIntegrity = Math.max(
      0,
      Math.round((1 - (avgBodyDmg * 0.45 + p.engineDamage * 0.3 + avgSuspDmg * 0.25)) * 100)
    );
    slot.engineHealth = Math.round((1 - p.engineDamage) * 100);

    // Trim strictly to rolling 30.0s window
    while (this.count > 2) {
      const oldest = this.slots[this.head];
      if (slot.timeSec - oldest.timeSec > MAX_REPLAY_SECONDS) {
        this.head = (this.head + 1) % RING_CAPACITY;
        this.count--;
      } else {
        break;
      }
    }
  }

  public sampleAt(offsetSec: number, out: ReplayFrame): boolean {
    if (this.count === 0) return false;
    if (this.count === 1) {
      copyFrame(this.getSlotAt(0), out);
      out.timeSec = 0;
      return true;
    }

    const baseTime = this.getSlotAt(0).timeSec;
    const duration = Math.max(0, this.getSlotAt(this.count - 1).timeSec - baseTime);
    const clampedOffset = Math.max(0, Math.min(duration, offsetSec));
    const targetTime = baseTime + clampedOffset;

    let lo = 0;
    let hi = this.count - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (this.getSlotAt(mid).timeSec <= targetTime) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const a = this.getSlotAt(lo);
    const b = this.getSlotAt(hi);
    const span = b.timeSec - a.timeSec;
    const jumpDistSq =
      (b.posX - a.posX) * (b.posX - a.posX) +
      (b.posY - a.posY) * (b.posY - a.posY) +
      (b.posZ - a.posZ) * (b.posZ - a.posZ);

    if (span <= 1e-5 || jumpDistSq > 64) {
      const pick = span > 1e-5 && targetTime - a.timeSec > span * 0.5 ? b : a;
      copyFrame(pick, out);
      out.timeSec = clampedOffset;
      return true;
    }

    const t = Math.max(0, Math.min(1, (targetTime - a.timeSec) / span));
    const lerp = THREE.MathUtils.lerp;

    out.timeSec = clampedOffset;
    out.posX = lerp(a.posX, b.posX, t);
    out.posY = lerp(a.posY, b.posY, t);
    out.posZ = lerp(a.posZ, b.posZ, t);

    _qA.set(a.quatX, a.quatY, a.quatZ, a.quatW);
    _qB.set(b.quatX, b.quatY, b.quatZ, b.quatW);
    _qOut.slerpQuaternions(_qA, _qB, t);
    out.quatX = _qOut.x;
    out.quatY = _qOut.y;
    out.quatZ = _qOut.z;
    out.quatW = _qOut.w;

    out.velX = lerp(a.velX, b.velX, t);
    out.velY = lerp(a.velY, b.velY, t);
    out.velZ = lerp(a.velZ, b.velZ, t);
    out.speedMs = lerp(a.speedMs, b.speedMs, t);
    out.speedKmh = Math.round(out.speedMs * 3.6);
    out.steerSmooth = lerp(a.steerSmooth, b.steerSmooth, t);
    out.throttleSmooth = lerp(a.throttleSmooth, b.throttleSmooth, t);
    out.brakeSmooth = lerp(a.brakeSmooth, b.brakeSmooth, t);
    out.handbrakeSmooth = lerp(a.handbrakeSmooth, b.handbrakeSmooth, t);
    out.rpm = lerp(a.rpm, b.rpm, t);
    out.redlineRpm = a.redlineRpm;
    out.maxRpm = a.maxRpm;
    out.engineLoad = lerp(a.engineLoad, b.engineLoad, t);
    out.boostBar = lerp(a.boostBar, b.boostBar, t);
    out.engineDamage = lerp(a.engineDamage, b.engineDamage, t);
    out.lateralG = lerp(a.lateralG, b.lateralG, t);
    out.longitudinalG = lerp(a.longitudinalG, b.longitudinalG, t);
    out.pitchDeg = lerp(a.pitchDeg, b.pitchDeg, t);
    out.rollDeg = lerp(a.rollDeg, b.rollDeg, t);

    const hDiff = ((b.headingDeg - a.headingDeg + 540) % 360) - 180;
    out.headingDeg = (a.headingDeg + hDiff * t + 360) % 360;
    out.distanceKm = lerp(a.distanceKm, b.distanceKm, t);
    out.avgRoughness = lerp(a.avgRoughness, b.avgRoughness, t);

    const discrete = t >= 0.5 ? b : a;
    out.gearIndex = discrete.gearIndex;
    out.gearLabel = discrete.gearLabel;
    out.absActive = discrete.absActive;
    out.driftMode = discrete.driftMode;
    out.diffLock = discrete.diffLock;
    out.surfaceType = discrete.surfaceType;
    out.surfaceName = discrete.surfaceName;
    out.surfaceGrip = discrete.surfaceGrip;
    out.slopeGradePct = discrete.slopeGradePct;
    out.overallIntegrity = discrete.overallIntegrity;
    out.engineHealth = discrete.engineHealth;

    for (let i = 0; i < 4; i++) {
      out.wheelOffsetY[i] = lerp(a.wheelOffsetY[i], b.wheelOffsetY[i], t);
      out.wheelSteerRad[i] = lerp(a.wheelSteerRad[i], b.wheelSteerRad[i], t);
      out.wheelSpinAngle[i] = lerp(a.wheelSpinAngle[i], b.wheelSpinAngle[i], t);
      out.wheelCompression[i] = lerp(a.wheelCompression[i], b.wheelCompression[i], t);
      out.wheelSlip[i] = lerp(a.wheelSlip[i], b.wheelSlip[i], t);
      out.wheelSlipAngleDeg[i] = lerp(a.wheelSlipAngleDeg[i], b.wheelSlipAngleDeg[i], t);
      out.wheelSlipRatio[i] = lerp(a.wheelSlipRatio[i], b.wheelSlipRatio[i], t);
      out.wheelAngularVel[i] = lerp(a.wheelAngularVel[i], b.wheelAngularVel[i], t);
      out.wheelGroundContact[i] = discrete.wheelGroundContact[i];
      out.suspensionDamage[i] = lerp(a.suspensionDamage[i], b.suspensionDamage[i], t);
    }

    return true;
  }

  public fillTelemetrySnapshot(frame: ReplayFrame, base: TelemetryData, car: CarSpec): TelemetryData {
    return {
      ...base,
      speedKmh: frame.speedKmh,
      speedMs: frame.speedMs,
      rpm: Math.round(frame.rpm),
      redlineRpm: car.redlineRpm,
      maxRpm: car.maxRpm,
      gearIndex: frame.gearIndex,
      gearLabel: frame.gearLabel,
      throttle: frame.throttleSmooth,
      brake: frame.brakeSmooth,
      handbrake: frame.handbrakeSmooth,
      steerNorm: frame.steerSmooth,
      diffLock: frame.diffLock,
      driftMode: frame.driftMode,
      surfaceType: frame.surfaceType,
      surfaceName: frame.surfaceName,
      surfaceGrip: frame.surfaceGrip,
      surfaceRoughness: frame.avgRoughness,
      slopeGradePct: frame.slopeGradePct,
      wheelCompression: [
        frame.wheelCompression[0],
        frame.wheelCompression[1],
        frame.wheelCompression[2],
        frame.wheelCompression[3],
      ],
      wheelGroundContact: [
        frame.wheelGroundContact[0],
        frame.wheelGroundContact[1],
        frame.wheelGroundContact[2],
        frame.wheelGroundContact[3],
      ],
      wheelSlip: [
        frame.wheelSlip[0],
        frame.wheelSlip[1],
        frame.wheelSlip[2],
        frame.wheelSlip[3],
      ],
      pitchDeg: Number(frame.pitchDeg.toFixed(1)),
      rollDeg: Number(frame.rollDeg.toFixed(1)),
      isAirborne:
        !frame.wheelGroundContact[0] &&
        !frame.wheelGroundContact[1] &&
        !frame.wheelGroundContact[2] &&
        !frame.wheelGroundContact[3],
      posX: frame.posX,
      posZ: frame.posZ,
      headingDeg: Math.round(frame.headingDeg),
      distanceKm: Number(frame.distanceKm.toFixed(2)),
      damage: {
        ...base.damage,
        overallIntegrity: frame.overallIntegrity,
        engineHealth: frame.engineHealth,
        suspensionHealth: [
          Math.round((1 - frame.suspensionDamage[0]) * 100),
          Math.round((1 - frame.suspensionDamage[1]) * 100),
          Math.round((1 - frame.suspensionDamage[2]) * 100),
          Math.round((1 - frame.suspensionDamage[3]) * 100),
        ],
      },
      engineLoad: Number(frame.engineLoad.toFixed(2)),
      boostBar: Number(frame.boostBar.toFixed(2)),
      absActive: frame.absActive,
      lateralG: Number(frame.lateralG.toFixed(2)),
      longitudinalG: Number(frame.longitudinalG.toFixed(2)),
      steeringAnglesDeg: [
        Number(THREE.MathUtils.radToDeg(frame.wheelSteerRad[0]).toFixed(1)),
        Number(THREE.MathUtils.radToDeg(frame.wheelSteerRad[1]).toFixed(1)),
      ],
      wheelRpm: [
        Math.round((frame.wheelAngularVel[0] * 60) / (2 * Math.PI)),
        Math.round((frame.wheelAngularVel[1] * 60) / (2 * Math.PI)),
        Math.round((frame.wheelAngularVel[2] * 60) / (2 * Math.PI)),
        Math.round((frame.wheelAngularVel[3] * 60) / (2 * Math.PI)),
      ],
      slipRatio: [
        Number(frame.wheelSlipRatio[0].toFixed(2)),
        Number(frame.wheelSlipRatio[1].toFixed(2)),
        Number(frame.wheelSlipRatio[2].toFixed(2)),
        Number(frame.wheelSlipRatio[3].toFixed(2)),
      ],
      slipAngleDeg: [
        Number(frame.wheelSlipAngleDeg[0].toFixed(1)),
        Number(frame.wheelSlipAngleDeg[1].toFixed(1)),
        Number(frame.wheelSlipAngleDeg[2].toFixed(1)),
        Number(frame.wheelSlipAngleDeg[3].toFixed(1)),
      ],
    };
  }
}

/**
 * 3D Telemetry-Colored Driving Line Ribbon rendered along the road surface
 * during Replay Mode. Highlights driven path up to current playback time and
 * shows upcoming braking/drift zones transparently ahead.
 */
const _lineFastColor = new THREE.Color(0x10b981);
const _lineCruiseColor = new THREE.Color(0x38bdf8);
const _lineDriftColor = new THREE.Color(0xfbbf24);
const _lineBrakeColor = new THREE.Color(0xf43f5e);
const _lineTmpColor = new THREE.Color();

export class ReplayLineVisualizer {
  public readonly mesh: THREE.Mesh;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly times: Float32Array;
  private readonly sampleScratch = createEmptyReplayFrame();

  constructor(fogHex: number, fogDensity: number) {
    const vertCount = MAX_LINE_SAMPLES * 2;
    this.positions = new Float32Array(vertCount * 3);
    this.colors = new Float32Array(vertCount * 3);
    this.times = new Float32Array(vertCount);

    const indices: number[] = [];
    for (let i = 0; i < MAX_LINE_SAMPLES - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage)
    );
    this.geometry.setAttribute(
      'aTime',
      new THREE.BufferAttribute(this.times, 1).setUsage(THREE.DynamicDrawUsage)
    );
    this.geometry.setIndex(indices);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCurrentTime: { value: 0 },
        uFogColor: { value: new THREE.Color(fogHex) },
        uFogDensity: { value: fogDensity },
      },
      vertexShader: `
        attribute float aTime;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vTime;
        varying float vFogDepth;
        void main() {
          vColor = color;
          vTime = aTime;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vFogDepth = max(0.5, -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uCurrentTime;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec3 vColor;
        varying float vTime;
        varying float vFogDepth;
        void main() {
          float isDriven = step(vTime, uCurrentTime + 0.04);
          float headGlow = exp(-abs(vTime - uCurrentTime) * 1.8) * 0.35;
          float alpha = mix(0.24, 0.84, isDriven) + headGlow * 0.25;
          vec3 col = vColor * (0.9 + headGlow);
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          vec3 finalCol = mix(col, uFogColor, clamp(fogFactor * 0.85, 0.0, 1.0));
          gl_FragColor = vec4(finalCol, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  public setFog(fogHex: number, fogDensity: number): void {
    this.material.uniforms.uFogColor.value.setHex(fogHex);
    this.material.uniforms.uFogDensity.value = fogDensity;
  }

  public rebuildFromRecorder(recorder: TelemetryReplayRecorder, car: CarSpec): void {
    const duration = recorder.getDurationSec();
    const totalFrames = recorder.getFrameCount();
    if (totalFrames < 2 || duration <= 0.05) {
      this.geometry.setDrawRange(0, 0);
      return;
    }

    const count = Math.min(MAX_LINE_SAMPLES, Math.max(24, Math.ceil(duration * 16)));
    const halfWidth = Math.max(0.42, car.trackWidth * 0.34);
    const groundDrop = car.wheelRadius * 0.72;

    let prevX = 0;
    let prevY = 0;
    let prevZ = 0;
    let prevDirX = 0;
    let prevDirZ = -1;

    for (let i = 0; i < count; i++) {
      const frac = count > 1 ? i / (count - 1) : 0;
      const t = frac * duration;
      recorder.sampleAt(t, this.sampleScratch);

      const x = this.sampleScratch.posX;
      const z = this.sampleScratch.posZ;
      const terrainY = getTerrainHeightRaw(x, z);
      const y = Math.max(terrainY + 0.08, this.sampleScratch.posY - groundDrop);

      let dx = 0;
      let dz = -1;
      if (i > 0) {
        const vx = x - prevX;
        const vz = z - prevZ;
        const dist = Math.hypot(vx, vz);
        if (dist > 0.05 && dist < 8.0) {
          dx = vx / dist;
          dz = vz / dist;
        } else {
          // Teleport break or stationary: orient along car heading
          const q = _qA.set(
            this.sampleScratch.quatX,
            this.sampleScratch.quatY,
            this.sampleScratch.quatZ,
            this.sampleScratch.quatW
          );
          _fwdTmp.set(0, 0, -1).applyQuaternion(q);
          const flen = Math.hypot(_fwdTmp.x, _fwdTmp.z) || 1;
          dx = _fwdTmp.x / flen;
          dz = _fwdTmp.z / flen;

          if (dist >= 8.0) {
            // Collapse previous strip edge cleanly across teleport jump
            const prevV = (i - 1) * 2 * 3;
            this.positions[prevV] = prevX;
            this.positions[prevV + 1] = prevY;
            this.positions[prevV + 2] = prevZ;
            this.positions[prevV + 3] = prevX;
            this.positions[prevV + 4] = prevY;
            this.positions[prevV + 5] = prevZ;
          }
        }
      } else {
        const q = _qA.set(
          this.sampleScratch.quatX,
          this.sampleScratch.quatY,
          this.sampleScratch.quatZ,
          this.sampleScratch.quatW
        );
        _fwdTmp.set(0, 0, -1).applyQuaternion(q);
        const flen = Math.hypot(_fwdTmp.x, _fwdTmp.z) || 1;
        dx = _fwdTmp.x / flen;
        dz = _fwdTmp.z / flen;
      }

      if (i > 0 && Math.hypot(x - prevX, z - prevZ) >= 8.0) {
        // Collapse start of post-jump segment too
        const v0 = i * 2 * 3;
        this.positions[v0] = x;
        this.positions[v0 + 1] = y;
        this.positions[v0 + 2] = z;
        this.positions[v0 + 3] = x;
        this.positions[v0 + 4] = y;
        this.positions[v0 + 5] = z;
      } else {
        const nx = -dz;
        const nz = dx;
        const v0 = i * 2 * 3;
        this.positions[v0] = x + nx * halfWidth;
        this.positions[v0 + 1] = y;
        this.positions[v0 + 2] = z + nz * halfWidth;
        this.positions[v0 + 3] = x - nx * halfWidth;
        this.positions[v0 + 4] = y;
        this.positions[v0 + 5] = z - nz * halfWidth;
      }

      // Telemetry color coding: brake -> drift/slide -> throttle/speed
      const maxRearSlip = Math.max(this.sampleScratch.wheelSlip[2], this.sampleScratch.wheelSlip[3]);
      if (this.sampleScratch.brakeSmooth > 0.18 || this.sampleScratch.absActive) {
        _lineTmpColor.copy(_lineCruiseColor).lerp(_lineBrakeColor, Math.min(1, this.sampleScratch.brakeSmooth * 1.2 + 0.35));
      } else if (maxRearSlip > 0.3 || Math.abs(this.sampleScratch.lateralG) > 0.72) {
        _lineTmpColor.copy(_lineCruiseColor).lerp(_lineDriftColor, Math.min(1, Math.max(maxRearSlip, Math.abs(this.sampleScratch.lateralG) - 0.3)));
      } else {
        const speedNorm = Math.min(1, this.sampleScratch.speedKmh / 160);
        _lineTmpColor.copy(_lineCruiseColor).lerp(_lineFastColor, speedNorm);
      }

      const c0 = i * 2 * 3;
      this.colors[c0] = _lineTmpColor.r;
      this.colors[c0 + 1] = _lineTmpColor.g;
      this.colors[c0 + 2] = _lineTmpColor.b;
      this.colors[c0 + 3] = _lineTmpColor.r;
      this.colors[c0 + 4] = _lineTmpColor.g;
      this.colors[c0 + 5] = _lineTmpColor.b;

      this.times[i * 2] = t;
      this.times[i * 2 + 1] = t;

      prevX = x;
      prevY = y;
      prevZ = z;
      prevDirX = dx;
      prevDirZ = dz;
    }
    void prevDirX;
    void prevDirZ;

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aTime as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, (count - 1) * 6);
  }

  public setCurrentTime(timeSec: number): void {
    this.material.uniforms.uCurrentTime.value = timeSec;
  }

  public setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

type DirectorShotKind = 'trackside' | 'curb' | 'helicopter' | 'fender' | 'chase';

const DIRECTOR_SHOT_SEQUENCE: { kind: DirectorShotKind; label: string; durationSec: number }[] = [
  { kind: 'trackside', label: 'Trackside Telephoto', durationSec: 3.6 },
  { kind: 'fender', label: 'Low Fender Hero', durationSec: 3.2 },
  { kind: 'curb', label: 'Curb Apex Pan', durationSec: 3.4 },
  { kind: 'helicopter', label: 'Chopper Orbit', durationSec: 3.8 },
  { kind: 'chase', label: 'Hero Wide Chase', durationSec: 3.2 },
];

const _dirFutureFrame = createEmptyReplayFrame();
const _dirFwd = new THREE.Vector3();
const _dirRight = new THREE.Vector3();
const _dirUp = new THREE.Vector3(0, 1, 0);
const _camDesired = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _camLookSmoothed = new THREE.Vector3();
const _camQ = new THREE.Quaternion();
const _tmpLocalOff = new THREE.Vector3();
const _tmpLocalLook = new THREE.Vector3();
const _tmpFramePos = new THREE.Vector3();

/**
 * Choreographed broadcast & cinematic camera director for Replay Mode.
 */
export class ReplayCameraController {
  private shotIndex = 0;
  private shotStartReplayTime = -1;
  private anchorPos = new THREE.Vector3();
  private anchorValid = false;
  private snapNextFrame = true;
  private currentLabel = 'Trackside Telephoto';
  private chopperPhase = 0.6;
  private rollRad = 0;

  public reset(replayTimeSec: number): void {
    this.shotIndex = 0;
    this.shotStartReplayTime = replayTimeSec;
    this.anchorValid = false;
    this.snapNextFrame = true;
    this.currentLabel = DIRECTOR_SHOT_SEQUENCE[0].label;
    this.rollRad = 0;
  }

  public requestCut(): void {
    this.anchorValid = false;
    this.snapNextFrame = true;
  }

  public getActiveShotLabel(mode: ReplayCameraMode): string {
    if (mode === 'director') return this.currentLabel;
    switch (mode) {
      case 'trackside':
        return 'Trackside Telephoto';
      case 'helicopter':
        return 'Chopper Orbit';
      case 'fender':
        return 'Low Fender Hero';
      case 'chase':
        return 'Hero Chase';
      case 'hood':
        return 'Bumper / Hood';
      case 'cockpit':
        return 'Driver POV';
    }
  }

  private placeTracksideAnchor(
    recorder: TelemetryReplayRecorder,
    replayTimeSec: number,
    curbLow: boolean,
    sideSign: number,
    car: CarSpec
  ): void {
    const duration = recorder.getDurationSec();
    const lookahead = curbLow ? 1.15 : 1.75;
    const anchorTime = Math.min(duration, replayTimeSec + lookahead);
    recorder.sampleAt(anchorTime, _dirFutureFrame);

    _camQ.set(
      _dirFutureFrame.quatX,
      _dirFutureFrame.quatY,
      _dirFutureFrame.quatZ,
      _dirFutureFrame.quatW
    );
    _dirFwd.set(0, 0, -1).applyQuaternion(_camQ).normalize();
    _dirRight.set(1, 0, 0).applyQuaternion(_camQ).normalize();

    const lateralDist = curbLow ? 4.2 + car.width * 0.6 : 7.8 + car.width * 0.9;
    const forwardLead = curbLow ? 2.5 : 4.2;
    const ax = _dirFutureFrame.posX + _dirFwd.x * forwardLead + _dirRight.x * lateralDist * sideSign;
    const az = _dirFutureFrame.posZ + _dirFwd.z * forwardLead + _dirRight.z * lateralDist * sideSign;
    const groundY = getTerrainHeightRaw(ax, az);
    const heightAboveGround = curbLow ? 0.52 : 2.15;

    this.anchorPos.set(ax, Math.max(groundY, _dirFutureFrame.posY) + heightAboveGround, az);
    this.anchorValid = true;
  }

  public updateCamera(
    camera: THREE.PerspectiveCamera,
    mode: ReplayCameraMode,
    frame: ReplayFrame,
    recorder: TelemetryReplayRecorder,
    car: CarSpec,
    dt: number,
    realDt: number,
    camYawOffset: number,
    camPitchOffset: number,
    camZoomScale: number,
    isDraggingCam: boolean
  ): void {
    const duration = recorder.getDurationSec();

    // Detect timeline loop/rewind jump
    if (frame.timeSec + 0.4 < this.shotStartReplayTime) {
      this.reset(frame.timeSec);
    }

    let effectiveKind: DirectorShotKind | 'hood' | 'cockpit' = 'trackside';
    if (mode === 'director') {
      const activeSpec = DIRECTOR_SHOT_SEQUENCE[this.shotIndex % DIRECTOR_SHOT_SEQUENCE.length];
      if (this.shotStartReplayTime < 0) {
        this.shotStartReplayTime = frame.timeSec;
      }
      if (frame.timeSec - this.shotStartReplayTime >= activeSpec.durationSec) {
        this.shotIndex = (this.shotIndex + 1) % DIRECTOR_SHOT_SEQUENCE.length;
        this.shotStartReplayTime = frame.timeSec;
        this.anchorValid = false;
        this.snapNextFrame = true;
      }
      const nextSpec = DIRECTOR_SHOT_SEQUENCE[this.shotIndex % DIRECTOR_SHOT_SEQUENCE.length];
      effectiveKind = nextSpec.kind;
      this.currentLabel = nextSpec.label;
    } else {
      effectiveKind = mode;
      this.currentLabel = this.getActiveShotLabel(mode);
    }

    _camQ.set(frame.quatX, frame.quatY, frame.quatZ, frame.quatW);
    _dirFwd.set(0, 0, -1).applyQuaternion(_camQ).normalize();
    _dirRight.set(1, 0, 0).applyQuaternion(_camQ).normalize();

    let targetFov = 54;
    let targetRoll = 0;

    if (effectiveKind === 'trackside' || effectiveKind === 'curb') {
      const isCurb = effectiveKind === 'curb';
      const sideSign = (this.shotIndex % 2 === 0 ? 1 : -1) * (frame.lateralG >= 0 ? 1 : -1 || 1);
      if (!this.anchorValid || camera.position.distanceTo(_camLook.set(frame.posX, frame.posY, frame.posZ)) > 72) {
        this.placeTracksideAnchor(recorder, frame.timeSec, isCurb, sideSign, car);
        // Re-anchor smoothly ahead if car passed far beyond tripod (>38m)
      } else {
        const toCarX = frame.posX - this.anchorPos.x;
        const toCarZ = frame.posZ - this.anchorPos.z;
        const dist = Math.hypot(toCarX, toCarZ);
        const passed = toCarX * _dirFwd.x + toCarZ * _dirFwd.z > 22 && dist > 30;
        if (passed && frame.timeSec + 0.8 < duration) {
          this.placeTracksideAnchor(recorder, frame.timeSec, isCurb, -sideSign, car);
          this.snapNextFrame = true;
        }
      }

      _camDesired.copy(this.anchorPos);
      _camLook.set(frame.posX + _dirFwd.x * 0.6, frame.posY + (isCurb ? 0.45 : 0.68), frame.posZ + _dirFwd.z * 0.6);

      const distToCar = _camDesired.distanceTo(_camLook);
      // Telephoto lens zooms tighter at medium-far distances for true motorsport broadcast compression
      targetFov = isCurb
        ? THREE.MathUtils.clamp(38 + (16 / Math.max(5, distToCar)) * 12, 34, 52)
        : THREE.MathUtils.clamp(28 + (22 / Math.max(6, distToCar)) * 14, 28, 48);
      targetRoll = THREE.MathUtils.clamp(-frame.lateralG * 0.025, -0.045, 0.045);
    } else if (effectiveKind === 'helicopter') {
      this.chopperPhase += dt * 0.28;
      const orbitYaw = this.chopperPhase + camYawOffset;
      const rad = (11.5 + Math.min(4.5, frame.speedMs * 0.1)) * camZoomScale;
      const elev = 5.4 + rad * Math.sin(Math.max(0.18, camPitchOffset * 0.9));
      _camDesired.set(
        frame.posX - _dirFwd.x * 4.5 + Math.cos(orbitYaw) * rad,
        frame.posY + elev,
        frame.posZ - _dirFwd.z * 4.5 + Math.sin(orbitYaw) * rad
      );
      const groundAtCam = getTerrainHeightRaw(_camDesired.x, _camDesired.z);
      _camDesired.y = Math.max(_camDesired.y, groundAtCam + 1.6);
      _camLook.set(frame.posX + _dirFwd.x * 2.2, frame.posY + 0.55, frame.posZ + _dirFwd.z * 2.2);
      targetFov = 50;
      targetRoll = THREE.MathUtils.clamp(frame.lateralG * 0.035, -0.06, 0.06);
    } else if (effectiveKind === 'fender') {
      const side = frame.lateralG >= 0 ? -1 : 1;
      const baseYaw = Math.atan2(_dirFwd.x, _dirFwd.z) + side * 0.72 + camYawOffset;
      const dist = (2.65 + car.width * 0.55) * camZoomScale;
      _camDesired.set(
        frame.posX + Math.sin(baseYaw) * dist + _dirFwd.x * 0.45,
        frame.posY + 0.48 + Math.max(-0.15, (camPitchOffset - 0.22) * 1.4),
        frame.posZ + Math.cos(baseYaw) * dist + _dirFwd.z * 0.45
      );
      const groundAtCam = getTerrainHeightRaw(_camDesired.x, _camDesired.z);
      _camDesired.y = Math.max(_camDesired.y, groundAtCam + 0.28);
      _camLook.set(
        frame.posX + _dirFwd.x * (car.wheelbase * 0.35),
        frame.posY + 0.36,
        frame.posZ + _dirFwd.z * (car.wheelbase * 0.35)
      );
      targetFov = 56;
      targetRoll = THREE.MathUtils.clamp(-frame.lateralG * 0.055, -0.09, 0.09);
    } else if (effectiveKind === 'chase') {
      const baseDist = (5.6 + car.length * 0.35 + Math.min(1.4, frame.speedKmh / 180)) * camZoomScale;
      const baseYaw = Math.atan2(_dirFwd.x, _dirFwd.z);
      const totalYaw = baseYaw + camYawOffset;
      const cosP = Math.cos(camPitchOffset);
      const sinP = Math.sin(camPitchOffset);
      _camDesired.set(
        frame.posX - Math.sin(totalYaw) * baseDist * cosP,
        frame.posY + car.height * 0.52 + baseDist * sinP,
        frame.posZ - Math.cos(totalYaw) * baseDist * cosP
      );
      const groundAtCam = getTerrainHeightRaw(_camDesired.x, _camDesired.z);
      _camDesired.y = Math.max(_camDesired.y, groundAtCam + 0.55);
      _camLook.set(frame.posX + Math.sin(totalYaw) * 4.0, frame.posY + 0.72, frame.posZ + Math.cos(totalYaw) * 4.0);
      targetFov = THREE.MathUtils.clamp(58 + (frame.speedKmh / 280) * 14, 58, 72);
      targetRoll = THREE.MathUtils.clamp(-frame.lateralG * 0.04, -0.065, 0.065);
    } else if (effectiveKind === 'hood') {
      _tmpLocalOff.set(0, car.height * 0.68, -car.length * 0.16);
      const lookSin = Math.sin(camYawOffset);
      const lookCos = Math.cos(camYawOffset);
      _tmpLocalLook.set(-lookSin * 18, car.height * 0.56 - (camPitchOffset - 0.22) * 10, -lookCos * 18);
      _tmpFramePos.set(frame.posX, frame.posY, frame.posZ);
      _camDesired.copy(_tmpLocalOff).applyQuaternion(_camQ).add(_tmpFramePos);
      _camLook.copy(_tmpLocalLook).applyQuaternion(_camQ).add(_tmpFramePos);
      targetFov = 64;
      this.snapNextFrame = true;
    } else {
      // cockpit
      const seatY = car.bodyStyle === 'suv' ? 1.18 : 0.88;
      _tmpLocalOff.set(-0.34, seatY, 0.05);
      const lookSin = Math.sin(camYawOffset);
      const lookCos = Math.cos(camYawOffset);
      _tmpLocalLook.set(-0.22 - lookSin * 18, seatY - 0.06 - (camPitchOffset - 0.22) * 10, -lookCos * 18);
      _tmpFramePos.set(frame.posX, frame.posY, frame.posZ);
      _camDesired.copy(_tmpLocalOff).applyQuaternion(_camQ).add(_tmpFramePos);
      _camLook.copy(_tmpLocalLook).applyQuaternion(_camQ).add(_tmpFramePos);
      targetFov = 66;
      this.snapNextFrame = true;
    }

    if (this.snapNextFrame) {
      camera.position.copy(_camDesired);
      _camLookSmoothed.copy(_camLook);
      camera.fov = targetFov;
      this.rollRad = targetRoll;
      this.snapNextFrame = false;
    } else {
      const dampLambda = isDraggingCam ? 20 : effectiveKind === 'trackside' || effectiveKind === 'curb' ? 16 : 8.5;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, _camDesired.x, dampLambda, realDt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, _camDesired.y, dampLambda, realDt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, _camDesired.z, dampLambda, realDt);
      _camLookSmoothed.lerp(_camLook, Math.min(1, realDt * 12));
      camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, realDt);
      this.rollRad = THREE.MathUtils.damp(this.rollRad, targetRoll, 5, realDt);
    }

    camera.updateProjectionMatrix();

    if (effectiveKind === 'hood' || effectiveKind === 'cockpit') {
      _dirUp.set(0, 1, 0).applyQuaternion(_camQ);
      camera.up.copy(_dirUp);
    } else {
      // Subtle horizon Dutch roll around camera's forward axis for cinematic weight
      _dirFwd.copy(_camLookSmoothed).sub(camera.position).normalize();
      camera.up.set(0, 1, 0).applyAxisAngle(_dirFwd, this.rollRad);
    }
    camera.lookAt(_camLookSmoothed);
  }
}
