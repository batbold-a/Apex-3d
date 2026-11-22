import * as THREE from 'three';
import { CarSpec, SurfaceType, TelemetryData } from '../types/vehicle';
import { getTerrainHeightRaw, TerrainSample } from './terrain';

// Particle sprite atlas kinds (2x2 grid):
// 0 = billowing smoke puff (tire smoke, engine smoke)
// 1 = diffuse particulate dust plume (sand/gravel/dirt/rock/cobble dust)
// 2 = chunky clod / gravel chip / dirt spray
// 3 = bright spark / ember
const KIND_SMOKE = 0;
const KIND_DUST = 1;
const KIND_CLOD = 2;
const KIND_SPARK = 3;

const MAX_PARTICLES = 960;

// Pre-allocated scratch vectors/colors for zero-GC updates
const _wheelContactWorld = new THREE.Vector3();
const _carBackwardWorld = new THREE.Vector3();
const _carRightWorld = new THREE.Vector3();
const _carForwardWorld = new THREE.Vector3();
const _tmpColor = new THREE.Color();

const WHEEL_LOCAL_SIGNS: readonly [number, number][] = [
  [-1, -1], // FL
  [1, -1], // FR
  [-1, 1], // RL
  [1, 1], // RR
];

interface SurfaceProfile {
  dustColors: readonly number[];
  sprayColors: readonly number[];
  smokeColors: readonly number[];
  dustOpacity: number;
  dustStartSize: number;
  dustEndSize: number;
  dustLife: number;
  dustGravity: number;
  sprayGravity: number;
  spraySize: number;
  minSpeedForDust: number;
  dustRate: number;
  sprayRate: number;
  smokeMultiplier: number;
}

const SURFACE_PROFILES: Record<SurfaceType, SurfaceProfile> = {
  asphalt: {
    dustColors: [0xd4d4d8, 0xcbd5e1],
    sprayColors: [0x334155, 0x1e293b],
    smokeColors: [0xedf2f7, 0xdbe2ea, 0xc3ccd6],
    dustOpacity: 0.25,
    dustStartSize: 0.35,
    dustEndSize: 1.8,
    dustLife: 0.9,
    dustGravity: -0.6,
    sprayGravity: 14.0,
    spraySize: 0.1,
    minSpeedForDust: 999, // Clean asphalt only smokes on slip/lockup
    dustRate: 0,
    sprayRate: 0,
    smokeMultiplier: 1.0,
  },
  sand: {
    dustColors: [0xe6c387, 0xd8ad6b, 0xc99c58],
    sprayColors: [0xc69451, 0xb17d3b, 0x9c6c31],
    smokeColors: [0xe0bc82, 0xd4a76a],
    dustOpacity: 0.52,
    dustStartSize: 0.52,
    dustEndSize: 3.1,
    dustLife: 1.45,
    dustGravity: -0.55,
    sprayGravity: 12.2,
    spraySize: 0.18,
    minSpeedForDust: 1.6,
    dustRate: 1.05,
    sprayRate: 1.15,
    smokeMultiplier: 0.2,
  },
  gravel: {
    dustColors: [0xbba184, 0xa88e72, 0x967e66],
    sprayColors: [0x6e665c, 0x524b43, 0x7a6a58],
    smokeColors: [0xc7b299, 0xb39d84],
    dustOpacity: 0.48,
    dustStartSize: 0.46,
    dustEndSize: 2.75,
    dustLife: 1.35,
    dustGravity: -0.45,
    sprayGravity: 14.8,
    spraySize: 0.15,
    minSpeedForDust: 1.8,
    dustRate: 0.95,
    sprayRate: 1.0,
    smokeMultiplier: 0.25,
  },
  grass: {
    dustColors: [0x92865d, 0x7e7550, 0x6b6344],
    sprayColors: [0x4c3927, 0x3c2c1d, 0x4f6d2e],
    smokeColors: [0x9b9272, 0x857e63],
    dustOpacity: 0.36,
    dustStartSize: 0.4,
    dustEndSize: 2.05,
    dustLife: 1.05,
    dustGravity: -0.35,
    sprayGravity: 13.0,
    spraySize: 0.17,
    minSpeedForDust: 2.2,
    dustRate: 0.7,
    sprayRate: 0.9,
    smokeMultiplier: 0.15,
  },
  rock: {
    dustColors: [0xac927e, 0x968578, 0x837b73],
    sprayColors: [0x6f5e53, 0x56504b, 0x7e6452],
    smokeColors: [0xb8a392, 0x9f8f82],
    dustOpacity: 0.42,
    dustStartSize: 0.38,
    dustEndSize: 2.15,
    dustLife: 1.15,
    dustGravity: -0.4,
    sprayGravity: 15.2,
    spraySize: 0.14,
    minSpeedForDust: 1.7,
    dustRate: 0.78,
    sprayRate: 0.85,
    smokeMultiplier: 0.3,
  },
  cobble: {
    dustColors: [0x9ca3af, 0x848d99, 0x707986],
    sprayColors: [0x646b76, 0x4b5563],
    smokeColors: [0xdce2e8, 0xc2cad4],
    dustOpacity: 0.32,
    dustStartSize: 0.34,
    dustEndSize: 1.7,
    dustLife: 0.95,
    dustGravity: -0.45,
    sprayGravity: 14.5,
    spraySize: 0.12,
    minSpeedForDust: 3.4,
    dustRate: 0.5,
    sprayRate: 0.45,
    smokeMultiplier: 0.68,
  },
};

function createParticleAtlasTexture(): THREE.CanvasTexture {
  const size = 256;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  // Quadrant 0 (Top-Left: 0,0 -> KIND_SMOKE): Multi-lobe billowing smoke cloud
  {
    const cx = half * 0.5;
    const cy = half * 0.5;
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + (i % 3) * 0.35;
      const dist = i === 0 ? 0 : 12 + (i % 4) * 5.5;
      const lx = cx + Math.cos(ang) * dist;
      const ly = cy + Math.sin(ang) * dist;
      const rad = i === 0 ? 38 : 22 + (i % 3) * 6;
      const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.42)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.2)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lx, ly, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Quadrant 1 (Top-Right: half,0 -> KIND_DUST): Wispy grainy particulate dust plume
  {
    const cx = half + half * 0.5;
    const cy = half * 0.5;
    const baseG = ctx.createRadialGradient(cx, cy, 4, cx, cy, 52);
    baseG.addColorStop(0, 'rgba(255,255,255,0.68)');
    baseG.addColorStop(0.45, 'rgba(255,255,255,0.34)');
    baseG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = baseG;
    ctx.beginPath();
    ctx.arc(cx, cy, 52, 0, Math.PI * 2);
    ctx.fill();

    // Organic fine dust grain pockets inside plume
    for (let i = 0; i < 36; i++) {
      const ang = (i * 2.39996) % (Math.PI * 2);
      const rDist = Math.sqrt(i / 36) * 40;
      const gx = cx + Math.cos(ang) * rDist;
      const gy = cy + Math.sin(ang) * rDist;
      const rDot = 4 + (i % 5) * 3.2;
      const dotG = ctx.createRadialGradient(gx, gy, 0.5, gx, gy, rDot);
      dotG.addColorStop(0, 'rgba(255,255,255,0.38)');
      dotG.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = dotG;
      ctx.beginPath();
      ctx.arc(gx, gy, rDot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Quadrant 2 (Bottom-Left: 0,half -> KIND_CLOD): Chunky irregular dirt / gravel clod
  {
    const cx = half * 0.5;
    const cy = half + half * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    const pts = 9;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const r = 28 + Math.sin(i * 2.7 + 0.6) * 9 + Math.cos(i * 1.9) * 5;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r * 0.86;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // Smaller satellite grit flecks around main clod
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + 0.4;
      const dist = 37 + (j % 2) * 8;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * dist, Math.sin(a) * dist, 5 + (j % 3) * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Quadrant 3 (Bottom-Right: half,half -> KIND_SPARK): Crisp glowing impact spark
  {
    const cx = half + half * 0.5;
    const cy = half + half * 0.5;
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 46);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.88)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class SurfaceParticleSystem {
  public readonly points: THREE.Points;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly atlasTexture: THREE.CanvasTexture;

  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly alphas = new Float32Array(MAX_PARTICLES);
  private readonly rotations = new Float32Array(MAX_PARTICLES);
  private readonly kinds = new Float32Array(MAX_PARTICLES);

  // Simulation-only per-particle state
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly startSize = new Float32Array(MAX_PARTICLES);
  private readonly endSize = new Float32Array(MAX_PARTICLES);
  private readonly baseAlpha = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly spinRate = new Float32Array(MAX_PARTICLES);

  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly rotAttr: THREE.BufferAttribute;
  private readonly kindAttr: THREE.BufferAttribute;

  private cursor = 0;
  private emitCarry: [number, number, number, number] = [0, 0, 0, 0];

  constructor(fogHex: number, fogDensity: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.positions[i * 3 + 1] = -9999;
      this.age[i] = 1;
      this.maxLife[i] = 0;
      this.alphas[i] = 0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    this.rotAttr = new THREE.BufferAttribute(this.rotations, 1).setUsage(THREE.DynamicDrawUsage);
    this.kindAttr = new THREE.BufferAttribute(this.kinds, 1).setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aRotation', this.rotAttr);
    this.geometry.setAttribute('aKind', this.kindAttr);

    this.atlasTexture = createParticleAtlasTexture();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlasTexture },
        uProjectionScale: { value: 520 },
        uFogColor: { value: new THREE.Color(fogHex) },
        uFogDensity: { value: fogDensity },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aRotation;
        attribute float aKind;
        attribute vec3 color;

        uniform float uProjectionScale;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vRotation;
        varying float vKind;
        varying float vFogDepth;

        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vRotation = aRotation;
          vKind = aKind;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float dist = max(0.6, -mvPosition.z);
          vFogDepth = dist;

          gl_PointSize = clamp(aSize * (uProjectionScale / dist), 1.5, 360.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uAtlas;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        varying vec3 vColor;
        varying float vAlpha;
        varying float vRotation;
        varying float vKind;
        varying float vFogDepth;

        void main() {
          if (vAlpha <= 0.004) discard;

          vec2 centered = gl_PointCoord - vec2(0.5);
          float c = cos(vRotation);
          float s = sin(vRotation);
          vec2 rotated = vec2(
            centered.x * c - centered.y * s,
            centered.x * s + centered.y * c
          ) + vec2(0.5);

          if (rotated.x < 0.0 || rotated.x > 1.0 || rotated.y < 0.0 || rotated.y > 1.0) {
            discard;
          }

          // Map sprite kind (0..3) into 2x2 texture atlas
          // Note: CanvasTexture flipY=true puts Canvas top row at UV v in [0.5, 1.0]
          float kindIdx = floor(vKind + 0.5);
          vec2 tileOrigin = vec2(0.0, 0.5);
          if (kindIdx > 2.5) {
            tileOrigin = vec2(0.5, 0.0); // Bottom-Right: Spark
          } else if (kindIdx > 1.5) {
            tileOrigin = vec2(0.0, 0.0); // Bottom-Left: Dirt/Gravel Clod
          } else if (kindIdx > 0.5) {
            tileOrigin = vec2(0.5, 0.5); // Top-Right: Dust Plume
          }

          // Flip Y inside cell to match canvas vertical orientation cleanly
          vec2 localUv = vec2(rotated.x, 1.0 - rotated.y);
          float pad = 0.018;
          vec2 atlasUv = tileOrigin + (pad + localUv * (1.0 - 2.0 * pad)) * 0.5;

          vec4 tex = texture2D(uAtlas, atlasUv);
          float outAlpha = tex.a * vAlpha;
          if (outAlpha <= 0.005) discard;

          vec3 baseRgb = vColor * tex.rgb;
          if (kindIdx > 2.5) {
            baseRgb *= 1.55;
          }

          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          float fogAmount = kindIdx > 2.5 ? fogFactor * 0.3 : fogFactor;
          vec3 finalRgb = mix(baseRgb, uFogColor, clamp(fogAmount, 0.0, 1.0));

          gl_FragColor = vec4(finalRgb, outAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  public setFog(fogHex: number, fogDensity: number): void {
    this.material.uniforms.uFogColor.value.setHex(fogHex);
    this.material.uniforms.uFogDensity.value = fogDensity;
  }

  public spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    options: {
      kind: number;
      life: number;
      startSize: number;
      endSize: number;
      alpha: number;
      gravity: number;
      drag?: number;
      spinRate?: number;
    }
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;

    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;

    _tmpColor.setHex(colorHex);
    this.colors[i * 3] = _tmpColor.r;
    this.colors[i * 3 + 1] = _tmpColor.g;
    this.colors[i * 3 + 2] = _tmpColor.b;

    this.age[i] = 0;
    this.maxLife[i] = options.life;
    this.startSize[i] = options.startSize;
    this.endSize[i] = options.endSize;
    this.sizes[i] = options.startSize;
    this.baseAlpha[i] = options.alpha;
    this.alphas[i] = 0.05;
    this.gravity[i] = options.gravity;
    this.drag[i] = options.drag ?? 1.8;
    this.rotations[i] = Math.random() * Math.PI * 2;
    this.spinRate[i] = options.spinRate ?? (Math.random() - 0.5) * 2.2;
    this.kinds[i] = options.kind;
  }

  public emitVehicleEffects(
    telemetry: TelemetryData,
    car: CarSpec,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
    velocity: THREE.Vector3,
    wheelOffsetY: readonly [number, number, number, number],
    wheelTerrain: readonly TerrainSample[],
    prevWheelContact: boolean[],
    dt: number,
    isSoftwareGl: boolean
  ): void {
    const speedMs = telemetry.speedMs;
    const densityMult = isSoftwareGl ? 0.55 : 1.0;

    _carForwardWorld.set(0, 0, -1).applyQuaternion(quaternion).normalize();
    _carBackwardWorld.copy(_carForwardWorld).negate();
    _carRightWorld.set(1, 0, 0).applyQuaternion(quaternion).normalize();

    const forwardSign = velocity.dot(_carForwardWorld) >= -0.5 ? 1 : -1;
    const hx = car.trackWidth * 0.5;
    const hz = car.wheelbase * 0.5;

    for (let i = 0; i < 4; i++) {
      const grounded = telemetry.wheelGroundContact[i];
      const wasGrounded = prevWheelContact[i];
      prevWheelContact[i] = grounded;

      // Resolve wheel surface from wheel's terrain sample or telemetry.surfaceType fallback
      const wSurf: SurfaceType = wheelTerrain[i]?.surfaceType ?? telemetry.surfaceType;
      const profile = SURFACE_PROFILES[wSurf];

      if (!grounded) {
        this.emitCarry[i] = 0;
        continue;
      }

      const wxLocal = WHEEL_LOCAL_SIGNS[i][0] * hx;
      const wzLocal = WHEEL_LOCAL_SIGNS[i][1] * hz;
      _wheelContactWorld
        .set(wxLocal, wheelOffsetY[i] - car.wheelRadius * 0.85, wzLocal)
        .applyQuaternion(quaternion)
        .add(position);

      // 1. Suspension touchdown burst when landing from a jump
      if (!wasGrounded && speedMs > 2.5) {
        const burstCount = isSoftwareGl ? 3 : 6;
        for (let b = 0; b < burstCount; b++) {
          const ang = (b / burstCount) * Math.PI * 2 + Math.random() * 0.6;
          const outSpeed = 2.2 + Math.random() * 2.8;
          const isAsphalt = wSurf === 'asphalt';
          const burstColor = isAsphalt
            ? profile.smokeColors[b % profile.smokeColors.length]
            : profile.dustColors[b % profile.dustColors.length];
          this.spawn(
            _wheelContactWorld.x + Math.cos(ang) * 0.25,
            _wheelContactWorld.y + 0.1,
            _wheelContactWorld.z + Math.sin(ang) * 0.25,
            Math.cos(ang) * outSpeed + velocity.x * 0.25,
            0.7 + Math.random() * 1.1,
            Math.sin(ang) * outSpeed + velocity.z * 0.25,
            burstColor,
            {
              kind: isAsphalt ? KIND_SMOKE : KIND_DUST,
              life: 0.75 + Math.random() * 0.45,
              startSize: 0.42,
              endSize: isAsphalt ? 1.8 : 2.35,
              alpha: isAsphalt ? 0.35 : profile.dustOpacity * 0.95,
              gravity: -0.45,
              drag: 2.8,
            }
          );
        }
      }

      const slip = telemetry.wheelSlip[i];
      const isRear = i >= 2;
      const wheelRpmAbs = Math.abs(telemetry.wheelRpm?.[i] ?? 0);
      const isBurnoutSpin = telemetry.throttle > 0.35 && wheelRpmAbs > 180 && slip > 0.42;
      const hasRollingSlipEnergy = speedMs > 5.5 && slip > 0.28;
      const handbrakeSlide = isRear && telemetry.handbrake > 0.28 && speedMs > 6.5 && slip > 0.26;
      const activeSmokeSlip = hasRollingSlipEnergy || isBurnoutSpin || handbrakeSlide;
      const slipIntensity = activeSmokeSlip
        ? Math.max(
            slip > 0.26 ? Math.min(1.4, (slip - 0.22) * 1.1) : 0,
            handbrakeSlide ? Math.min(0.85, (speedMs - 5.5) * 0.08) : 0
          )
        : 0;

      // Accumulate time-based emission rate so 30fps and 144fps emit identical volume
      const speedNorm = Math.min(1.5, Math.max(0, (speedMs - profile.minSpeedForDust) / 22));
      const looseActivity = speedMs > profile.minSpeedForDust ? speedNorm * (0.65 + telemetry.throttle * 0.55) : 0;
      const totalDrive = Math.max(slipIntensity * 1.25, looseActivity);
      if (totalDrive <= 0.04) continue;

      const emitHz = (16 + totalDrive * 28) * densityMult;
      this.emitCarry[i] = Math.min(4, this.emitCarry[i] + emitHz * dt);

      while (this.emitCarry[i] >= 1) {
        this.emitCarry[i] -= 1;

        const sideSpread = (Math.random() - 0.5) * 1.6 + WHEEL_LOCAL_SIGNS[i][0] * 0.35;
        const ejectDirSign = forwardSign;

        // A. Tire Smoke on Asphalt / Cobble / Hard Slip
        if (slipIntensity > 0.14 && profile.smokeMultiplier > 0.1) {
          const smokeEnergyScale = Math.min(1.0, 0.32 + speedMs / 18 + telemetry.throttle * 0.38);
          const smokeProb = Math.min(1, slipIntensity * profile.smokeMultiplier * smokeEnergyScale);
          if (Math.random() < smokeProb) {
            const sCol =
              slip > 0.85 && Math.random() < 0.25
                ? 0x9aa3af // hotter dark rubber smoke core
                : profile.smokeColors[Math.floor(Math.random() * profile.smokeColors.length)];

            const kickBack = (1.2 + Math.random() * 1.6) * ejectDirSign;
            this.spawn(
              _wheelContactWorld.x + (Math.random() - 0.5) * 0.22,
              _wheelContactWorld.y + 0.12,
              _wheelContactWorld.z + (Math.random() - 0.5) * 0.22,
              _carBackwardWorld.x * kickBack + _carRightWorld.x * sideSpread * 0.55 + velocity.x * 0.22,
              0.75 + Math.random() * 0.95 + slipIntensity * 0.45,
              _carBackwardWorld.z * kickBack + _carRightWorld.z * sideSpread * 0.55 + velocity.z * 0.22,
              sCol,
              {
                kind: KIND_SMOKE,
                life: 0.95 + Math.random() * 0.5,
                startSize: 0.34 + slipIntensity * 0.12,
                endSize: (1.75 + slipIntensity * 0.75) * (0.65 + 0.35 * smokeEnergyScale),
                alpha: Math.min(0.54, (0.22 + slipIntensity * 0.22) * profile.smokeMultiplier * smokeEnergyScale),
                gravity: -1.15,
                drag: 2.3,
              }
            );
          }
        }

        // B. Surface Dust Plumes (Sand, Gravel, Grass, Rock, Cobble)
        if (profile.dustRate > 0 && (speedMs > profile.minSpeedForDust || slipIntensity > 0.2)) {
          if (Math.random() < Math.min(1, profile.dustRate * (0.45 + totalDrive * 0.55))) {
            const dCol = profile.dustColors[Math.floor(Math.random() * profile.dustColors.length)];
            const trailSpeed = (1.5 + speedMs * 0.14 + Math.random() * 1.8) * ejectDirSign;
            this.spawn(
              _wheelContactWorld.x + (Math.random() - 0.5) * 0.3,
              _wheelContactWorld.y + 0.14,
              _wheelContactWorld.z + (Math.random() - 0.5) * 0.3,
              _carBackwardWorld.x * trailSpeed + _carRightWorld.x * sideSpread + velocity.x * 0.18,
              0.65 + Math.random() * 1.15 + speedNorm * 0.55,
              _carBackwardWorld.z * trailSpeed + _carRightWorld.z * sideSpread + velocity.z * 0.18,
              dCol,
              {
                kind: KIND_DUST,
                life: profile.dustLife * (0.85 + Math.random() * 0.35),
                startSize: profile.dustStartSize,
                endSize: profile.dustEndSize * (0.85 + speedNorm * 0.35),
                alpha: Math.min(0.68, profile.dustOpacity * (0.65 + totalDrive * 0.4)),
                gravity: profile.dustGravity,
                drag: 1.75,
              }
            );
          }
        }

        // C. Ballistic Dirt Spray, Sand Rooster Tails & Gravel Chips
        if (
          profile.sprayRate > 0 &&
          (speedMs > profile.minSpeedForDust * 1.1 || (slipIntensity > 0.18 && telemetry.throttle > 0.25))
        ) {
          const sprayChance = profile.sprayRate * (0.35 + telemetry.throttle * 0.45 + slipIntensity * 0.45);
          if (Math.random() < Math.min(1, sprayChance)) {
            const cCol = profile.sprayColors[Math.floor(Math.random() * profile.sprayColors.length)];
            const roosterVel = (2.8 + speedMs * 0.28 + telemetry.throttle * 3.2 + Math.random() * 2.4) * ejectDirSign;
            const loftVy = 1.6 + Math.random() * 2.4 + speedNorm * 1.1;
            const cSize = profile.spraySize * (0.75 + Math.random() * 0.65);

            this.spawn(
              _wheelContactWorld.x + (Math.random() - 0.5) * 0.22,
              _wheelContactWorld.y + 0.08,
              _wheelContactWorld.z + (Math.random() - 0.5) * 0.22,
              _carBackwardWorld.x * roosterVel + _carRightWorld.x * sideSpread * 1.15 + velocity.x * 0.35,
              loftVy,
              _carBackwardWorld.z * roosterVel + _carRightWorld.z * sideSpread * 1.15 + velocity.z * 0.35,
              cCol,
              {
                kind: KIND_CLOD,
                life: 0.55 + Math.random() * 0.4,
                startSize: cSize,
                endSize: cSize * 1.25,
                alpha: 0.9,
                gravity: profile.sprayGravity,
                drag: 0.85,
                spinRate: (Math.random() - 0.5) * 10,
              }
            );
          }
        }
      }
    }
  }

  public emitImpactSparks(x: number, y: number, z: number, severity: number, isSoftwareGl: boolean): void {
    const count = Math.min(isSoftwareGl ? 6 : 14, Math.max(4, Math.round(4 + severity * 9)));
    for (let s = 0; s < count; s++) {
      this.spawn(
        x + (Math.random() - 0.5) * 0.3,
        y + 0.08 + Math.random() * 0.22,
        z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * (6 + severity * 6),
        2.0 + Math.random() * 4.5,
        (Math.random() - 0.5) * (6 + severity * 6),
        s % 3 === 0 ? 0xfffbeb : s % 3 === 1 ? 0xfbbf24 : 0xf97316,
        {
          kind: KIND_SPARK,
          life: 0.28 + Math.random() * 0.25,
          startSize: 0.22 + Math.random() * 0.12,
          endSize: 0.05,
          alpha: 0.98,
          gravity: 12.0,
          drag: 1.2,
        }
      );
    }
  }

  /**
   * Emits directional collision sparks and chunky debris chips from the pre-allocated
   * ring buffer pool (zero heap allocations) for Pinball Mode smashes.
   */
  public emitPinballBurst(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    severity: number,
    throttled: boolean
  ): void {
    const sparkCount = throttled ? 8 : Math.min(26, Math.max(8, Math.round(8 + severity * 18)));
    const debrisCount = throttled ? 3 : Math.min(10, Math.max(3, Math.round(3 + severity * 7)));
    const speedBase = 5 + severity * 11;

    for (let s = 0; s < sparkCount; s++) {
      const sign = s % 2 === 0 ? 1 : -1;
      const spreadX = (Math.random() - 0.5) * speedBase * 1.1;
      const spreadZ = (Math.random() - 0.5) * speedBase * 1.1;
      this.spawn(
        x + (Math.random() - 0.5) * 0.35,
        y + 0.1 + Math.random() * 0.25,
        z + (Math.random() - 0.5) * 0.35,
        nx * sign * speedBase * 0.45 + spreadX,
        2.2 + Math.random() * (4.5 + severity * 4.5) + Math.abs(ny) * 1.5,
        nz * sign * speedBase * 0.45 + spreadZ,
        s % 3 === 0 ? 0xfffbeb : s % 3 === 1 ? 0xfbbf24 : 0xf97316,
        {
          kind: KIND_SPARK,
          life: 0.32 + Math.random() * 0.28,
          startSize: 0.24 + Math.random() * 0.16,
          endSize: 0.04,
          alpha: 0.98,
          gravity: 13.5,
          drag: 1.1,
        }
      );
    }

    for (let d = 0; d < debrisCount; d++) {
      const sign = d % 2 === 0 ? 1 : -1;
      this.spawn(
        x + (Math.random() - 0.5) * 0.45,
        y + 0.15 + Math.random() * 0.3,
        z + (Math.random() - 0.5) * 0.45,
        nx * sign * speedBase * 0.3 + (Math.random() - 0.5) * 7,
        2.6 + Math.random() * (4.0 + severity * 3.8),
        nz * sign * speedBase * 0.3 + (Math.random() - 0.5) * 7,
        d % 2 === 0 ? 0x334155 : 0x64748b,
        {
          kind: KIND_CLOD,
          life: 0.65 + Math.random() * 0.45,
          startSize: 0.14 + Math.random() * 0.12,
          endSize: 0.16,
          alpha: 0.92,
          gravity: 15.0,
          drag: 0.7,
          spinRate: (Math.random() - 0.5) * 14,
        }
      );
    }
  }

  public emitEngineSmoke(
    x: number,
    y: number,
    z: number,
    engineDamage: number,
    isSoftwareGl: boolean
  ): void {
    if (engineDamage <= 0.32) return;
    if (Math.random() >= (isSoftwareGl ? 0.16 : 0.46) * engineDamage) return;

    this.spawn(
      x + (Math.random() - 0.5) * 0.24,
      y,
      z + (Math.random() - 0.5) * 0.24,
      (Math.random() - 0.5) * 0.85,
      1.35 + Math.random() * 1.4,
      (Math.random() - 0.5) * 0.85,
      engineDamage > 0.65 ? 0x1f2937 : 0x4b5563,
      {
        kind: KIND_SMOKE,
        life: 1.1 + Math.random() * 0.55,
        startSize: 0.36,
        endSize: 1.75 + engineDamage * 0.6,
        alpha: 0.42 + engineDamage * 0.2,
        gravity: -1.4,
        drag: 1.9,
      }
    );
  }

  public update(dt: number, cameraFovDeg: number, viewportHeight: number): void {
    const fovRad = THREE.MathUtils.degToRad(cameraFovDeg);
    this.material.uniforms.uProjectionScale.value =
      Math.max(1, viewportHeight) / (2 * Math.tan(fovRad * 0.5));

    let anyActive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.maxLife[i];
      if (life <= 0) continue;

      this.age[i] += dt;
      const t = this.age[i] / life;

      if (t >= 1) {
        this.maxLife[i] = 0;
        this.alphas[i] = 0;
        this.positions[i * 3 + 1] = -9999;
        anyActive = true;
        continue;
      }

      anyActive = true;

      const idx3 = i * 3;
      this.positions[idx3] += this.vel[idx3] * dt;
      this.positions[idx3 + 1] += this.vel[idx3 + 1] * dt;
      this.positions[idx3 + 2] += this.vel[idx3 + 2] * dt;

      this.vel[idx3 + 1] -= this.gravity[i] * dt;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[idx3] *= damp;
      this.vel[idx3 + 2] *= damp;

      // Ground bounce for heavy clods & impact sparks
      if (this.kinds[i] >= KIND_CLOD - 0.1 && this.vel[idx3 + 1] < 0) {
        const groundY = getTerrainHeightRaw(this.positions[idx3], this.positions[idx3 + 2]);
        if (this.positions[idx3 + 1] <= groundY + 0.05) {
          this.positions[idx3 + 1] = groundY + 0.05;
          this.vel[idx3 + 1] = Math.abs(this.vel[idx3 + 1]) * 0.34;
          this.vel[idx3] *= 0.65;
          this.vel[idx3 + 2] *= 0.65;
        }
      }

      this.rotations[i] += this.spinRate[i] * dt;

      // Smooth size expansion (fast initial bloom, slower drift)
      const sizeCurve = 1 - (1 - t) * (1 - t);
      this.sizes[i] =
        this.startSize[i] + (this.endSize[i] - this.startSize[i]) * sizeCurve;

      // Smooth fade-in over first 12%, soft fade-out to zero
      const fadeIn = t < 0.12 ? t / 0.12 : 1.0;
      const fadeOut = Math.pow(1 - t, 1.35);
      this.alphas[i] = this.baseAlpha[i] * fadeIn * fadeOut;
    }

    if (anyActive) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.rotAttr.needsUpdate = true;
      this.kindAttr.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.atlasTexture.dispose();
  }
}
