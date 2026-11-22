import * as THREE from 'three';
import { MapId, TimeOfDay, WorldCollider } from '../types/vehicle';
import { SurfaceParticleSystem } from './particles';
import {
  BAJA_EAST_LOOP_POINTS,
  BAJA_WASH_POINTS,
  BAJA_WEST_LOOP_POINTS,
  BAJA_WHOOPS_CONNECTOR_POINTS,
  distanceToBajaTrail,
  getTerrainHeightRaw,
  mountainRoadCenterX,
  PROVING_EAST_CONNECTOR_POINTS,
  PROVING_HILL_TRAIL_POINTS,
  PROVING_HILL_WEST_SPUR_POINTS,
  PROVING_NE_CONNECTOR_HUB,
  PROVING_NE_CONNECTOR_NORTH,
  PROVING_NE_CONNECTOR_SOUTH,
  PROVING_NE_CONNECTOR_WEST,
  PROVING_NE_SKIDPAD_CENTER,
  PROVING_NE_SKIDPAD_RADIUS,
  PROVING_SE_DUNES_LINK_POINTS,
  PROVING_SE_EAST_SPUR_POINTS,
  PROVING_SE_RALLY_POINTS,
  PROVING_SW_BADROAD_LINK_POINTS,
  PROVING_SW_TRAIL_POINTS,
  PROVING_SW_WEST_SPUR_POINTS,
  PROVING_WEST_CONNECTOR_POINTS,
  RockBump,
  sampleTerrain,
  setActiveRockBumps,
  setActiveTerrainMap,
  WORLD_HALF_SIZE,
} from './terrain';

export interface WorldHandles {
  sunLight: THREE.DirectionalLight;
  colliders: WorldCollider[];
  particles: SurfaceParticleSystem;
  updateSunFollow: (x: number, z: number) => void;
  setTimeOfDay: (mode: TimeOfDay, renderer: THREE.WebGLRenderer, scene: THREE.Scene) => void;
  dispose: () => void;
}

function createSurfaceDetailTextures(): {
  albedo: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const size = 1024;
  const cAlbedo = document.createElement('canvas');
  cAlbedo.width = size;
  cAlbedo.height = size;
  const ctxA = cAlbedo.getContext('2d')!;

  const cBump = document.createElement('canvas');
  cBump.width = size;
  cBump.height = size;
  const ctxB = cBump.getContext('2d')!;

  ctxA.fillStyle = '#e6e6e6';
  ctxA.fillRect(0, 0, size, size);
  ctxB.fillStyle = '#808080';
  ctxB.fillRect(0, 0, size, size);

  // Layered soil/grass/aggregate mottling patches
  for (let i = 0; i < 650; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 6 + Math.random() * 24;
    const v = 195 + Math.floor(Math.random() * 48);
    ctxA.fillStyle = `rgba(${v},${v},${v},0.18)`;
    ctxA.beginPath();
    ctxA.arc(x, y, r, 0, Math.PI * 2);
    ctxA.fill();

    const bv = 90 + Math.floor(Math.random() * 76);
    ctxB.fillStyle = `rgba(${bv},${bv},${bv},0.24)`;
    ctxB.beginPath();
    ctxB.arc(x, y, r * 0.85, 0, Math.PI * 2);
    ctxB.fill();
  }

  // Crisp pebbles, grass blades, and mineral flecks
  for (let i = 0; i < 64000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = Math.random() < 0.72 ? 1.5 : 3;
    const v = 178 + Math.floor(Math.random() * 76);
    ctxA.fillStyle = `rgb(${v},${v},${v})`;
    ctxA.fillRect(x, y, s, s);

    const b = 70 + Math.floor(Math.random() * 140);
    ctxB.fillStyle = `rgb(${b},${b},${b})`;
    ctxB.fillRect(x, y, s, s);
  }

  // Fine organic streaks (wind-blown sand ripples / tire grit grain)
  ctxA.strokeStyle = 'rgba(200,200,200,0.16)';
  ctxB.strokeStyle = 'rgba(155,155,155,0.22)';
  ctxA.lineWidth = 1.5;
  ctxB.lineWidth = 2;
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 8 + Math.random() * 22;
    ctxA.beginPath();
    ctxA.moveTo(x, y);
    ctxA.lineTo(x + len, y + (Math.random() - 0.5) * 4);
    ctxA.stroke();

    ctxB.beginPath();
    ctxB.moveTo(x, y);
    ctxB.lineTo(x + len, y + (Math.random() - 0.5) * 4);
    ctxB.stroke();
  }

  const albedo = new THREE.CanvasTexture(cAlbedo);
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(360, 360);
  albedo.colorSpace = THREE.SRGBColorSpace;

  const bump = new THREE.CanvasTexture(cBump);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(360, 360);

  return { albedo, bump };
}

function createSignTexture(title: string, subtitle: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0c1220';
  ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 512, 14);
  ctx.fillRect(0, 146, 512, 14);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 76);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '600 22px sans-serif';
  ctx.fillText(subtitle, 256, 120);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHubMarkingsTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 1024);

  // Outer dashed roundabout ring & center calibration crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.48)';
  ctx.lineWidth = 8;
  ctx.setLineDash([28, 22]);
  ctx.beginPath();
  ctx.arc(512, 512, 420, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(148,163,184,0.22)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(512, 512, 230, 0, Math.PI * 2);
  ctx.stroke();

  // Start grid box
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.9)';
  ctx.lineWidth = 10;
  ctx.strokeRect(464, 632, 96, 144);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('START', 512, 818);

  const drawArrow = (x: number, y: number, rot: number, label: string, col: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.lineTo(26, -8);
    ctx.lineTo(10, -8);
    ctx.lineTo(10, 40);
    ctx.lineTo(-10, 40);
    ctx.lineTo(-10, -8);
    ctx.lineTo(-26, -8);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, 76);
    ctx.restore();
  };

  drawArrow(512, 180, 0, 'HIGHWAY', 'rgba(56, 189, 248, 0.92)');
  drawArrow(180, 512, -Math.PI / 2, 'BUMPS', 'rgba(245, 158, 11, 0.92)');
  drawArrow(844, 512, Math.PI / 2, 'RAMPS', 'rgba(248, 113, 113, 0.92)');
  drawArrow(258, 258, -Math.PI / 4, 'HILL CLIMB', 'rgba(74, 222, 128, 0.92)');
  drawArrow(766, 258, Math.PI / 4, 'DRIFT PAD', 'rgba(192, 132, 252, 0.92)');
  drawArrow(512, 892, Math.PI, 'RALLY & CANYON', 'rgba(251, 191, 36, 0.85)');

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTrailRoadTexture(
  baseHex: string,
  rutHex: string,
  bermHex: string
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, size);

  // Feathered horizontal gradient so trail shoulders blend seamlessly into sand/rock/grass
  const grad = ctx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0.0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.11, bermHex);
  grad.addColorStop(0.22, baseHex);
  grad.addColorStop(0.35, rutHex);
  grad.addColorStop(0.5, baseHex);
  grad.addColorStop(0.65, rutHex);
  grad.addColorStop(0.78, baseHex);
  grad.addColorStop(0.89, bermHex);
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Subtle packed-gravel grain & tire tread texture inside the trail
  for (let i = 0; i < 4200; i++) {
    const x = 44 + Math.random() * (size - 88);
    const y = Math.random() * size;
    const edgeFade = Math.min(1, Math.min(x - 40, size - 40 - x) / 60);
    const bright = Math.random() > 0.5 ? 235 : 42;
    ctx.fillStyle = `rgba(${bright},${bright},${bright},${(0.08 * edgeFade).toFixed(3)})`;
    ctx.fillRect(x, y, 2 + Math.random() * 2, 3 + Math.random() * 6);
  }

  // Twin wheel-track chevron tread imprints
  ctx.strokeStyle = 'rgba(28, 18, 10, 0.18)';
  ctx.lineWidth = 3;
  for (const trackX of [size * 0.35, size * 0.65]) {
    for (let y = 0; y < size; y += 28) {
      ctx.beginPath();
      ctx.moveTo(trackX - 18, y);
      ctx.lineTo(trackX, y + 10);
      ctx.lineTo(trackX + 18, y);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createAsphaltMarkingsTexture(dashedCenter: boolean): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  // Subtle worn racing line & dual wheel-path shading
  const wear = ctx.createLinearGradient(0, 0, size, 0);
  wear.addColorStop(0.0, 'rgba(10,14,22,0)');
  wear.addColorStop(0.14, 'rgba(10,14,22,0.28)');
  wear.addColorStop(0.32, 'rgba(10,14,22,0.16)');
  wear.addColorStop(0.5, 'rgba(10,14,22,0.08)');
  wear.addColorStop(0.68, 'rgba(10,14,22,0.16)');
  wear.addColorStop(0.86, 'rgba(10,14,22,0.28)');
  wear.addColorStop(1.0, 'rgba(10,14,22,0)');
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, size, size);

  // Fine asphalt mineral micro-grain inside road ribbon
  for (let i = 0; i < 6000; i++) {
    const x = 60 + Math.random() * (size - 120);
    const y = Math.random() * size;
    const bright = Math.random() > 0.5 ? 210 : 18;
    ctx.fillStyle = `rgba(${bright},${bright},${bright},0.06)`;
    ctx.fillRect(x, y, 2, 3);
  }

  // Crisp shoulder boundary lines
  ctx.fillStyle = 'rgba(241, 245, 249, 0.84)';
  ctx.fillRect(72, 0, 18, size);
  ctx.fillRect(size - 90, 0, 18, size);

  // Center dashed/amber divider
  ctx.fillStyle = dashedCenter ? 'rgba(250, 204, 21, 0.9)' : 'rgba(241, 245, 249, 0.85)';
  for (let y = 32; y < size; y += 256) {
    ctx.fillRect(size * 0.5 - 9, y, 18, 136);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLampPoolTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(254, 240, 199, 0.95)');
  g.addColorStop(0.35, 'rgba(253, 224, 140, 0.45)');
  g.addColorStop(0.75, 'rgba(251, 191, 80, 0.12)');
  g.addColorStop(1, 'rgba(251, 191, 80, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHaloDiscTexture(innerColor: string, outerColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, innerColor);
  g.addColorStop(0.28, outerColor);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createChevronSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(42, 24);
  ctx.lineTo(86, 64);
  ctx.lineTo(42, 104);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createOutdoorReflectionTexture(
  pmremGenerator: THREE.PMREMGenerator,
  mapId: MapId,
  timeOfDay: TimeOfDay
): THREE.Texture {
  const envScene = new THREE.Scene();
  const isNight = timeOfDay === 'night';
  const isDesert = mapId === 'desert-baja' || mapId === 'mountain-pass';

  const skyTop = isNight ? 0x091124 : isDesert ? 0x3b82c4 : 0x2563eb;
  const skyHoriz = isNight ? 0x2a3b62 : isDesert ? 0xf5deb3 : 0xdbeafe;
  const groundCol = isNight ? 0x161d2c : isDesert ? 0x8b6742 : 0x435339;

  const envGeo = new THREE.SphereGeometry(20, 24, 16);
  const pos = envGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const cTop = new THREE.Color(skyTop);
  const cHor = new THREE.Color(skyHoriz);
  const cGnd = new THREE.Color(groundCol);
  const cTmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const ny = pos.getY(i) / 20;
    if (ny >= 0) {
      cTmp.copy(cHor).lerp(cTop, Math.pow(ny, 0.7));
    } else {
      cTmp.copy(cHor).lerp(cGnd, Math.min(1, Math.pow(-ny, 0.5) * 1.3));
    }
    cols[i * 3] = cTmp.r;
    cols[i * 3 + 1] = cTmp.g;
    cols[i * 3 + 2] = cTmp.b;
  }
  envGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const envMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  envScene.add(new THREE.Mesh(envGeo, envMat));

  const sunGeo = new THREE.SphereGeometry(2.2, 12, 12);
  const sunMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(isNight ? 2.6 : 5.5, isNight ? 3.2 : 5.1, isNight ? 4.8 : 4.4),
  });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  sunMesh.position.set(isNight ? -10 : 11, 13, isNight ? -8 : 9);
  envScene.add(sunMesh);

  const fillGeo = new THREE.PlaneGeometry(18, 6);
  const fillMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(isNight ? 1.15 : 2.1, isNight ? 1.45 : 2.3, isNight ? 2.2 : 2.6),
    side: THREE.DoubleSide,
  });
  const fillPanel = new THREE.Mesh(fillGeo, fillMat);
  fillPanel.position.set(-10, 9, -8);
  fillPanel.lookAt(0, 0, 0);
  envScene.add(fillPanel);

  const tex = pmremGenerator.fromScene(envScene, 0.035).texture;
  envGeo.dispose();
  envMat.dispose();
  sunGeo.dispose();
  sunMat.dispose();
  fillGeo.dispose();
  fillMat.dispose();
  return tex;
}

interface AtmosphereTheme {
  fogHex: number;
  fogDensity: number;
  skyHorizon: number;
  skyMid: number;
  skyZenith: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunHex: number;
  sunIntensity: number;
  sunOffset: [number, number, number];
  exposure: number;
}

const MAP_THEMES: Record<MapId, { day: AtmosphereTheme; night: AtmosphereTheme }> = {
  'proving-valley': {
    day: {
      fogHex: 0xb8cde0,
      fogDensity: 0.0009,
      skyHorizon: 0xc9dceb,
      skyMid: 0x6ea2d6,
      skyZenith: 0x26548c,
      hemiSky: 0xbce0ff,
      hemiGround: 0x514c3e,
      hemiIntensity: 1.0,
      sunHex: 0xfff0d4,
      sunIntensity: 2.4,
      sunOffset: [65, 95, 55],
      exposure: 1.06,
    },
    night: {
      fogHex: 0x0f192d,
      fogDensity: 0.00112,
      skyHorizon: 0x223254,
      skyMid: 0x101a33,
      skyZenith: 0x050914,
      hemiSky: 0x4b68a1,
      hemiGround: 0x151b26,
      hemiIntensity: 0.68,
      sunHex: 0x9dbbff,
      sunIntensity: 1.15,
      sunOffset: [-72, 86, -58],
      exposure: 1.14,
    },
  },
  'mountain-pass': {
    day: {
      fogHex: 0xdcc4ad,
      fogDensity: 0.00105,
      skyHorizon: 0xebd1b8,
      skyMid: 0x8ea9c4,
      skyZenith: 0x355983,
      hemiSky: 0xffe4c7,
      hemiGround: 0x6b4534,
      hemiIntensity: 0.95,
      sunHex: 0xffddb5,
      sunIntensity: 2.45,
      sunOffset: [80, 88, 45],
      exposure: 1.06,
    },
    night: {
      fogHex: 0x17182b,
      fogDensity: 0.0012,
      skyHorizon: 0x2e2a47,
      skyMid: 0x14172b,
      skyZenith: 0x060812,
      hemiSky: 0x5b6ba0,
      hemiGround: 0x21191d,
      hemiIntensity: 0.65,
      sunHex: 0xb6ccff,
      sunIntensity: 1.12,
      sunOffset: [-68, 84, -52],
      exposure: 1.14,
    },
  },
  'desert-baja': {
    day: {
      fogHex: 0xebd3ad,
      fogDensity: 0.001,
      skyHorizon: 0xf4deb8,
      skyMid: 0x99bad4,
      skyZenith: 0x3970a8,
      hemiSky: 0xfff0d6,
      hemiGround: 0x966e46,
      hemiIntensity: 1.05,
      sunHex: 0xffe7b8,
      sunIntensity: 2.6,
      sunOffset: [75, 105, 40],
      exposure: 1.06,
    },
    night: {
      fogHex: 0x181c2e,
      fogDensity: 0.00115,
      skyHorizon: 0x342f4d,
      skyMid: 0x161b33,
      skyZenith: 0x060914,
      hemiSky: 0x5a6ea8,
      hemiGround: 0x29221d,
      hemiIntensity: 0.72,
      sunHex: 0xc2d5ff,
      sunIntensity: 1.2,
      sunOffset: [-70, 90, -50],
      exposure: 1.15,
    },
  },
  'highway-circuit': {
    day: {
      fogHex: 0xbcd0e2,
      fogDensity: 0.0009,
      skyHorizon: 0xd0e0ee,
      skyMid: 0x73a1cd,
      skyZenith: 0x2b5a8e,
      hemiSky: 0xc4e2ff,
      hemiGround: 0x3c4654,
      hemiIntensity: 1.0,
      sunHex: 0xfff2da,
      sunIntensity: 2.35,
      sunOffset: [72, 96, 48],
      exposure: 1.05,
    },
    night: {
      fogHex: 0x111a2e,
      fogDensity: 0.00115,
      skyHorizon: 0x27355a,
      skyMid: 0x121c38,
      skyZenith: 0x050914,
      hemiSky: 0x5472ad,
      hemiGround: 0x171d29,
      hemiIntensity: 0.72,
      sunHex: 0xb7ceff,
      sunIntensity: 1.32,
      sunOffset: [-70, 82, -65],
      exposure: 1.14,
    },
  },
  'testing-facility': {
    day: {
      fogHex: 0xcbd5e1,
      fogDensity: 0.00075,
      skyHorizon: 0xdbe5f0,
      skyMid: 0x7da4cc,
      skyZenith: 0x2c5282,
      hemiSky: 0xd8ecff,
      hemiGround: 0x3b4252,
      hemiIntensity: 1.0,
      sunHex: 0xfff5e4,
      sunIntensity: 2.3,
      sunOffset: [75, 110, 50],
      exposure: 1.05,
    },
    night: {
      fogHex: 0x131d31,
      fogDensity: 0.00095,
      skyHorizon: 0x283654,
      skyMid: 0x131c33,
      skyZenith: 0x060a14,
      hemiSky: 0x5d7ab5,
      hemiGround: 0x1e2532,
      hemiIntensity: 0.74,
      sunHex: 0xc8dcff,
      sunIntensity: 1.25,
      sunOffset: [-75, 96, -50],
      exposure: 1.14,
    },
  },
};

function updateSkyDomeColors(
  geo: THREE.BufferGeometry,
  theme: AtmosphereTheme,
  isNight: boolean
): void {
  const pos = geo.attributes.position;
  let colAttr = geo.attributes.color as THREE.BufferAttribute | undefined;
  const cols = colAttr
    ? (colAttr.array as Float32Array)
    : new Float32Array(pos.count * 3);

  const cHorizon = new THREE.Color(theme.skyHorizon);
  const cMid = new THREE.Color(theme.skyMid);
  const cZenith = new THREE.Color(theme.skyZenith);
  const cCloud = new THREE.Color(0xf8fafc);
  const cTmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, y / 900));
    if (t < 0.28) {
      cTmp.copy(cHorizon).lerp(cMid, t / 0.28);
    } else {
      cTmp.copy(cMid).lerp(cZenith, (t - 0.28) / 0.72);
    }
    if (!isNight) {
      const angle = Math.atan2(pos.getZ(i), pos.getX(i));
      const cloudBand =
        y > 40 && y < 230
          ? Math.max(0, Math.sin(angle * 3.0 + y * 0.028) * Math.cos(angle * 5.0 - y * 0.015))
          : 0;
      if (cloudBand > 0.35) {
        cTmp.lerp(cCloud, (cloudBand - 0.35) * 0.28);
      }
    }
    cols[i * 3] = cTmp.r;
    cols[i * 3 + 1] = cTmp.g;
    cols[i * 3 + 2] = cTmp.b;
  }
  if (!colAttr) {
    colAttr = new THREE.BufferAttribute(cols, 3);
    geo.setAttribute('color', colAttr);
  } else {
    colAttr.needsUpdate = true;
  }
}

function createStarfieldPoints(): {
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  mat: THREE.PointsMaterial;
} {
  const count = 950;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cTmp = new THREE.Color();
  const radius = 1360;

  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const v = 0.06 + Math.random() * 0.92;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(v);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    const tint = Math.random();
    if (tint < 0.22) cTmp.setHex(0xbfdbfe);
    else if (tint < 0.36) cTmp.setHex(0xfef3c7);
    else cTmp.setHex(0xf8fafc);
    const brightness = 0.45 + Math.random() * 0.55;
    colors[i * 3] = cTmp.r * brightness;
    colors[i * 3 + 1] = cTmp.g * brightness;
    colors[i * 3 + 2] = cTmp.b * brightness;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.4,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    fog: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, geo, mat };
}

function createCrossedGrassGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const blades = [
    { angle: 0, w: 0.42, h: 0.52 },
    { angle: Math.PI / 3, w: 0.38, h: 0.46 },
    { angle: (2 * Math.PI) / 3, w: 0.4, h: 0.5 },
  ];

  blades.forEach((b, bi) => {
    const base = bi * 4;
    const hw = b.w * 0.5;
    const cos = Math.cos(b.angle);
    const sin = Math.sin(b.angle);
    const lean = 0.08;
    // Bottom-left, bottom-right, top-right, top-left (tapered tuft)
    positions.push(-hw * cos, 0, -hw * sin);
    positions.push(hw * cos, 0, hw * sin);
    positions.push(hw * 0.45 * cos + lean * sin, b.h, hw * 0.45 * sin - lean * cos);
    positions.push(-hw * 0.45 * cos + lean * sin, b.h, -hw * 0.45 * sin - lean * cos);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function warpCoord(u: number): number {
  const s = Math.sign(u);
  const a = Math.abs(u);
  return s * (a * 0.25 + a * a * a * 0.75) * WORLD_HALF_SIZE;
}

export function buildProvingGroundWorld(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  mapId: MapId = 'proving-valley',
  initialTimeOfDay?: TimeOfDay
): WorldHandles {
  setActiveTerrainMap(mapId);
  let activeTimeOfDay: TimeOfDay =
    initialTimeOfDay ?? (mapId === 'highway-circuit' ? 'night' : 'day');
  let activeTheme = MAP_THEMES[mapId][activeTimeOfDay];

  const disposables: { dispose: () => void }[] = [];
  const colliders: WorldCollider[] = [];
  const rockBumps: RockBump[] = [];
  const track = <T extends { dispose: () => void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  // Night-reactive emissive material references (toggled cleanly by setTimeOfDay)
  const gantrySignMats: THREE.MeshStandardMaterial[] = [];
  const lampHeadMats: THREE.MeshStandardMaterial[] = [];
  const lampPoolMats: THREE.MeshBasicMaterial[] = [];
  const lampPoolMeshes: THREE.InstancedMesh[] = [];
  const catEyeMats: THREE.MeshStandardMaterial[] = [];
  const beaconMats: THREE.MeshStandardMaterial[] = [];
  const windowGlowMats: THREE.MeshStandardMaterial[] = [];

  // Gradient Sky Dome, Starfield & Celestial Orbs + Horizon-matched Fog
  const fogColor = new THREE.Color(activeTheme.fogHex);
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(activeTheme.fogHex, activeTheme.fogDensity);
  renderer.toneMappingExposure = activeTheme.exposure;

  const skyGroup = new THREE.Group();
  scene.add(skyGroup);

  const skyDomeGeo = track(new THREE.SphereGeometry(1450, 28, 18));
  updateSkyDomeColors(skyDomeGeo, activeTheme, activeTimeOfDay === 'night');
  const skyDome = new THREE.Mesh(
    skyDomeGeo,
    track(
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      })
    )
  );
  skyGroup.add(skyDome);

  const starfield = createStarfieldPoints();
  track(starfield.geo);
  track(starfield.mat);
  starfield.points.visible = activeTimeOfDay === 'night';
  skyGroup.add(starfield.points);

  // Sun & Moon Visual Orbs + Radial Halos positioned on the sky dome
  const daySunDir = new THREE.Vector3(...MAP_THEMES[mapId].day.sunOffset).normalize();
  const sunOrbGroup = new THREE.Group();
  sunOrbGroup.position.copy(daySunDir).multiplyScalar(1220);
  const sunDisc = new THREE.Mesh(
    track(new THREE.SphereGeometry(28, 16, 16)),
    track(new THREE.MeshBasicMaterial({ color: 0xfff8dc, fog: false }))
  );
  sunOrbGroup.add(sunDisc);
  const sunHaloTex = track(createHaloDiscTexture('rgba(255,244,200,0.85)', 'rgba(253,224,140,0.22)'));
  const sunHalo = new THREE.Mesh(
    track(new THREE.PlaneGeometry(240, 240)),
    track(
      new THREE.MeshBasicMaterial({
        map: sunHaloTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    )
  );
  sunHalo.lookAt(0, 0, 0);
  sunOrbGroup.add(sunHalo);
  sunOrbGroup.visible = activeTimeOfDay === 'day';
  skyGroup.add(sunOrbGroup);

  const nightMoonDir = new THREE.Vector3(...MAP_THEMES[mapId].night.sunOffset).normalize();
  const moonOrbGroup = new THREE.Group();
  moonOrbGroup.position.copy(nightMoonDir).multiplyScalar(1220);
  const moonDisc = new THREE.Mesh(
    track(new THREE.SphereGeometry(24, 16, 16)),
    track(new THREE.MeshBasicMaterial({ color: 0xe6efff, fog: false }))
  );
  moonOrbGroup.add(moonDisc);
  const moonHaloTex = track(createHaloDiscTexture('rgba(200,222,255,0.75)', 'rgba(130,170,255,0.2)'));
  const moonHalo = new THREE.Mesh(
    track(new THREE.PlaneGeometry(180, 180)),
    track(
      new THREE.MeshBasicMaterial({
        map: moonHaloTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      })
    )
  );
  moonHalo.lookAt(0, 0, 0);
  moonOrbGroup.add(moonHalo);
  moonOrbGroup.visible = activeTimeOfDay === 'night';
  skyGroup.add(moonOrbGroup);

  // Lighting tailored per map & Day/Night
  const hemiLight = new THREE.HemisphereLight(
    activeTheme.hemiSky,
    activeTheme.hemiGround,
    activeTheme.hemiIntensity
  );
  hemiLight.position.set(0, 80, 0);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(activeTheme.sunHex, activeTheme.sunIntensity);
  sunLight.position.set(activeTheme.sunOffset[0], activeTheme.sunOffset[1], activeTheme.sunOffset[2]);
  sunLight.castShadow = renderer.shadowMap.enabled;
  const shadowRes = renderer.shadowMap.enabled ? 2048 : 1024;
  sunLight.shadow.mapSize.width = shadowRes;
  sunLight.shadow.mapSize.height = shadowRes;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 220;
  const d = 34;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.bias = -0.00035;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Build warped high-detail terrain BufferGeometry
  const segs = 300;
  const vertCount = (segs + 1) * (segs + 1);
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  const cAsphalt = new THREE.Color(mapId === 'highway-circuit' ? 0x1d232e : 0x252a34);
  const cLaneLine = new THREE.Color(0xe2e8f0);
  const cCurbRed = new THREE.Color(0xc81e1e);
  const cCurbWhite = new THREE.Color(0xf1f5f9);
  const cCobble = new THREE.Color(0x646b76);
  const cBumpYellow = new THREE.Color(0xd97706);
  const cGravel = new THREE.Color(
    mapId === 'mountain-pass' ? 0x8f6b53 : mapId === 'desert-baja' ? 0xa3815d : 0x826148
  );
  const cSand = new THREE.Color(mapId === 'desert-baja' ? 0xd9ad6e : 0xc9a96f);
  const cRock = new THREE.Color(mapId === 'mountain-pass' ? 0x9b5038 : 0x555b66);
  const cGrass = new THREE.Color(0x46683b);
  const cDirtPatch = new THREE.Color(0x6b563e);
  const cTemp = new THREE.Color();

  for (let iz = 0; iz <= segs; iz++) {
    const vz = (iz / segs) * 2 - 1;
    const z = warpCoord(vz);

    for (let ix = 0; ix <= segs; ix++) {
      const ux = (ix / segs) * 2 - 1;
      const x = warpCoord(ux);

      const idx = iz * (segs + 1) + ix;
      const sample = sampleTerrain(x, z);

      positions[idx * 3] = x;
      positions[idx * 3 + 1] = sample.height;
      positions[idx * 3 + 2] = z;

      uvs[idx * 2] = (x + WORLD_HALF_SIZE) / (WORLD_HALF_SIZE * 2);
      uvs[idx * 2 + 1] = (z + WORLD_HALF_SIZE) / (WORLD_HALF_SIZE * 2);

      if (sample.surfaceType === 'asphalt') {
        if (sample.zoneName === 'Stunt Ramp Park' || sample.zoneName === 'Baja Jump Sector') {
          cTemp.set(0x3f4756);
          if (mapId === 'proving-valley' && (x > 83 || x > 119)) cTemp.lerp(cBumpYellow, 0.55);
          if (mapId === 'desert-baja' && (z < 33 || z < -82)) cTemp.lerp(cBumpYellow, 0.65);
        } else {
          cTemp.copy(cAsphalt);
          const centerX = Math.abs(x) < 0.45;
          if (mapId === 'proving-valley') {
            if (sample.zoneName === 'NE Drift Skidpad') {
              const rSkid = Math.hypot(
                x - PROVING_NE_SKIDPAD_CENTER[0],
                z - PROVING_NE_SKIDPAD_CENTER[1]
              );
              cTemp.set(Math.abs(rSkid - 32) < 1.1 ? 0x38bdf8 : 0x222731);
            } else {
              if (centerX && Math.abs(z) > 45 && Math.abs(z) < 205 && Math.sin(z * 0.45) > 0.15) {
                cTemp.copy(cLaneLine);
              }
              if (Math.abs(Math.abs(x) - 9.8) < 0.9 && Math.abs(z) > 48 && Math.abs(z) < 200) {
                cTemp.copy(Math.sin(z * 0.9) > 0 ? cCurbRed : cCurbWhite);
              }
            }
          } else if (mapId === 'highway-circuit') {
            if (centerX && Math.abs(z) < 205 && Math.sin(z * 0.45) > 0.1) {
              cTemp.copy(cLaneLine);
            }
            if (Math.abs(Math.abs(x) - 11.4) < 1.0 && Math.abs(z) < 202) {
              cTemp.copy(Math.sin(z * 0.85) > 0 ? cCurbRed : cCurbWhite);
            }
          } else if (mapId === 'testing-facility') {
            if (sample.zoneName === 'Split-Friction Braking Pad') {
              cTemp.set(x < 46 ? 0x1e2532 : 0xa5d8ff);
            } else if (sample.zoneName === 'R=40m Constant-Radius Skid Pad') {
              const r = Math.hypot(x + 90, z);
              cTemp.set(Math.abs(r - 40) < 1.2 ? 0x38bdf8 : 0x232936);
            } else if (Math.abs(x) < 0.45 && Math.abs(z) <= 290 && Math.sin(z * 0.45) > 0.1) {
              cTemp.copy(cLaneLine);
            } else if (Math.abs(Math.abs(x) - 16.5) < 0.9 && Math.abs(z) <= 295) {
              cTemp.copy(Math.sin(z * 0.7) > 0 ? cCurbRed : cCurbWhite);
            }
          }
        }
      } else if (sample.surfaceType === 'cobble') {
        cTemp.copy(cCobble);
        if (z < -12 && sample.height > 0.14) {
          cTemp.lerp(cBumpYellow, 0.75);
        }
      } else if (sample.surfaceType === 'gravel') {
        cTemp.copy(cGravel);
        const rutMask = Math.sin(x * 0.25 + z * 0.16) * 0.05;
        cTemp.offsetHSL(0, 0, rutMask);
      } else if (sample.surfaceType === 'sand') {
        cTemp.copy(cSand);
        const ripple = Math.sin(x * 0.14 + z * 0.11) * 0.05;
        cTemp.offsetHSL(0, 0, ripple);
      } else if (sample.surfaceType === 'rock') {
        cTemp.copy(cRock).lerp(cGravel, Math.max(0, 1 - sample.height / 20) * 0.4);
        const strata = Math.sin(sample.height * 1.4 + x * 0.08) * 0.05;
        cTemp.offsetHSL(0, 0, strata);
        if (mapId === 'proving-valley' && sample.height > 17.5) {
          cTemp.lerp(new THREE.Color(0xcbd5e1), Math.min(0.42, (sample.height - 17.5) / 10));
        }
      } else {
        cTemp.copy(cGrass);
        const dirtNoise = Math.sin(x * 0.07) * Math.cos(z * 0.09);
        if (dirtNoise > 0.35) {
          cTemp.lerp(cDirtPatch, (dirtNoise - 0.35) * 0.85);
        }
        const varTone = Math.sin(x * 0.08) * Math.cos(z * 0.08) * 0.06;
        cTemp.offsetHSL(varTone * 0.4, 0, varTone);
        if (sample.height > 5.5) {
          cTemp.lerp(cRock, Math.min(0.88, (sample.height - 5.5) / 16));
        }
      }

      colors[idx * 3] = cTemp.r;
      colors[idx * 3 + 1] = cTemp.g;
      colors[idx * 3 + 2] = cTemp.b;
    }
  }

  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * (segs + 1) + ix;
      const b = a + 1;
      const c = a + (segs + 1);
      const dIdx = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, dIdx);
    }
  }

  const terrainGeo = track(new THREE.BufferGeometry());
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  terrainGeo.setIndex(indices);
  terrainGeo.computeVertexNormals();

  const { albedo, bump } = createSurfaceDetailTextures();
  track(albedo);
  track(bump);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  albedo.anisotropy = maxAniso;
  bump.anisotropy = maxAniso;

  const terrainMat = track(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: albedo,
      bumpMap: bump,
      bumpScale: 0.11,
      roughness: 0.92,
      metalness: 0.03,
    })
  );

  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Shared materials & helpers
  const gantryPoleMat = track(
    new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.35 })
  );
  const barrierMat = track(new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 }));
  const hazardMat = track(new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45 }));
  const dummy = new THREE.Object3D();

  const addGantry = (
    x: number,
    z: number,
    rotY: number,
    title: string,
    subtitle: string,
    accent: string
  ) => {
    const g = new THREE.Group();
    const gy = getTerrainHeightRaw(x, z);
    g.position.set(x, gy, z);
    g.rotation.y = rotY;

    const poleGeo = track(new THREE.CylinderGeometry(0.18, 0.24, 6.4, 10));
    const cosR = Math.cos(rotY);
    const sinR = Math.sin(rotY);
    for (const px of [-6.8, 6.8]) {
      const pole = new THREE.Mesh(poleGeo, gantryPoleMat);
      pole.position.set(px, 3.2, 0);
      pole.castShadow = true;
      g.add(pole);

      colliders.push({
        type: 'circle',
        x: x + px * cosR,
        z: z - px * sinR,
        radius: 0.36,
        maxY: gy + 6.4,
      });
    }

    const beam = new THREE.Mesh(track(new THREE.BoxGeometry(14.4, 0.35, 0.35)), gantryPoleMat);
    beam.position.set(0, 6.2, 0);
    beam.castShadow = true;
    g.add(beam);

    const signTex = track(createSignTexture(title, subtitle, accent));
    signTex.anisotropy = maxAniso;
    const isNightNow = activeTimeOfDay === 'night';
    const signMat = track(
      new THREE.MeshStandardMaterial({
        map: signTex,
        emissiveMap: signTex,
        emissive: 0xffffff,
        emissiveIntensity: isNightNow ? 0.85 : 0.08,
        roughness: 0.38,
        metalness: 0.12,
      })
    );
    gantrySignMats.push(signMat);
    const signBoard = new THREE.Mesh(track(new THREE.BoxGeometry(8.8, 2.45, 0.22)), signMat);
    signBoard.position.set(0, 5.25, 0);
    g.add(signBoard);

    scene.add(g);
  };

  const addBarrier = (x: number, z: number, w: number, h: number, dBox: number) => {
    const by = getTerrainHeightRaw(x, z);
    const block = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, dBox)), barrierMat);
    block.position.set(x, by + h * 0.5, z);
    block.castShadow = true;
    block.receiveShadow = true;
    scene.add(block);

    const stripe = new THREE.Mesh(
      track(new THREE.BoxGeometry(w + 0.04, 0.22, dBox + 0.04)),
      hazardMat
    );
    stripe.position.set(x, by + h - 0.2, z);
    scene.add(stripe);

    colliders.push({
      type: 'box',
      minX: x - w * 0.5,
      maxX: x + w * 0.5,
      minZ: z - dBox * 0.5,
      maxZ: z + dBox * 0.5,
      maxY: by + h + 0.5,
      category: 'barrier',
    });
  };

  // Boulders: Low/medium rocks become physical climbable rock bumps; tall cliffs have tight core colliders
  const spawnBoulders = (
    count: number,
    colorHex: number,
    sampler: () => { x: number; z: number } | null
  ) => {
    const rockGeo = track(new THREE.DodecahedronGeometry(1.05, 1));
    const rockMat = track(
      new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.92, flatShading: true })
    );
    const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, count);
    rockInst.castShadow = true;
    rockInst.receiveShadow = true;
    const rCol = new THREE.Color();
    let placed = 0;
    for (let i = 0; i < count * 8 && placed < count; i++) {
      const pt = sampler();
      if (!pt) continue;
      const ry = getTerrainHeightRaw(pt.x, pt.z);
      const sx = 0.72 + Math.random() * 1.35;
      const sy = 0.42 + Math.random() * 0.85;
      const sz = 0.72 + Math.random() * 1.35;
      const embed = 0.24 + sy * 0.14;
      dummy.position.set(pt.x, ry - embed, pt.z);
      dummy.rotation.set(Math.random() * 0.4, Math.random() * Math.PI * 2, Math.random() * 0.4);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      rockInst.setMatrixAt(placed, dummy.matrix);
      rCol.setHex(colorHex).offsetHSL(0, 0, (Math.random() - 0.5) * 0.14);
      rockInst.setColorAt(placed, rCol);

      // Register every scattered boulder as a climbable stone dome so tires drive right over them
      const topHeight = Math.max(0.22, sy * 1.0 - embed);
      rockBumps.push({
        x: pt.x,
        z: pt.z,
        radius: Math.max(sx, sz) * 1.04,
        height: topHeight,
      });
      placed++;
    }
    rockInst.count = placed;
    rockInst.computeBoundingSphere();
    scene.add(rockInst);
  };

  // Small non-blocking Ground Pebbles / Stones & Grass Tufts for rich ground texture
  const spawnGroundPebbles = (
    count: number,
    colorHex: number,
    excludeAsphalt: boolean
  ) => {
    const pebbleGeo = track(new THREE.DodecahedronGeometry(0.18, 0));
    const pebbleMat = track(new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.95 }));
    const inst = new THREE.InstancedMesh(pebbleGeo, pebbleMat, count);
    inst.receiveShadow = true;
    const col = new THREE.Color();
    let placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
      const px = (Math.random() * 2 - 1) * 720;
      const pz = (Math.random() * 2 - 1) * 720;
      const s = sampleTerrain(px, pz);
      if (excludeAsphalt && s.surfaceType === 'asphalt') continue;

      const scale = 0.45 + Math.random() * 1.1;
      dummy.position.set(px, s.height + 0.03, pz);
      dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      dummy.scale.set(scale * 1.2, scale * 0.55, scale);
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      col.setHex(colorHex).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
      inst.setColorAt(placed, col);
      placed++;
    }
    inst.count = placed;
    inst.computeBoundingSphere();
    scene.add(inst);
  };

  const spawnGrassAndScrub = (
    count: number,
    baseHex: number,
    allowedSurfaces: string[]
  ) => {
    const grassGeo = track(createCrossedGrassGeometry());
    const grassMat = track(
      new THREE.MeshStandardMaterial({
        color: baseHex,
        roughness: 0.88,
        side: THREE.DoubleSide,
      })
    );
    const inst = new THREE.InstancedMesh(grassGeo, grassMat, count);
    const gCol = new THREE.Color();
    let placed = 0;
    for (let i = 0; i < count * 4 && placed < count; i++) {
      const gx = (Math.random() * 2 - 1) * 720;
      const gz = (Math.random() * 2 - 1) * 720;
      const s = sampleTerrain(gx, gz);
      if (!allowedSurfaces.includes(s.surfaceType)) continue;
      if (s.normalY < 0.85) continue;

      const sc = 0.75 + Math.random() * 1.05;
      dummy.position.set(gx, s.height - 0.03, gz);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(sc, sc * (0.8 + Math.random() * 0.5), sc);
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      gCol.setHex(baseHex).offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.12);
      inst.setColorAt(placed, gCol);
      placed++;
    }
    inst.count = placed;
    inst.computeBoundingSphere();
    scene.add(inst);
  };

  // Multi-Tier Pine Trees WITH Solid Trunk Colliders
  const spawnTrees = (count: number, crownHex: number, allowedSurface: string) => {
    const trunkGeo = track(new THREE.CylinderGeometry(0.22, 0.38, 3.0, 8));
    trunkGeo.translate(0, 1.5, 0);
    const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.92 }));

    const tier1Geo = track(new THREE.ConeGeometry(2.55, 3.8, 9));
    tier1Geo.translate(0, 3.8, 0);
    const tier2Geo = track(new THREE.ConeGeometry(1.95, 3.6, 9));
    tier2Geo.translate(0, 5.9, 0);
    const tier3Geo = track(new THREE.ConeGeometry(1.25, 3.1, 8));
    tier3Geo.translate(0, 7.8, 0);
    const crownMat = track(new THREE.MeshStandardMaterial({ color: crownHex, roughness: 0.88 }));

    const trunkInstances = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const tier1Instances = new THREE.InstancedMesh(tier1Geo, crownMat, count);
    const tier2Instances = new THREE.InstancedMesh(tier2Geo, crownMat, count);
    const tier3Instances = new THREE.InstancedMesh(tier3Geo, crownMat, count);
    trunkInstances.castShadow = true;
    tier1Instances.castShadow = true;
    tier2Instances.castShadow = true;
    tier3Instances.castShadow = true;

    const crownColor = new THREE.Color();
    let placedTrees = 0;
    let attempts = 0;

    while (placedTrees < count && attempts < 4500) {
      attempts++;
      const angle = Math.random() * Math.PI * 2;
      const rad = 56 + Math.random() * 760;
      const tx = Math.cos(angle) * rad;
      const tz = Math.sin(angle) * rad;
      const s = sampleTerrain(tx, tz);
      if (s.surfaceType !== allowedSurface) continue;
      if (mapId === 'mountain-pass' && Math.abs(tx - Math.sin(tz * 0.022) * 58) < 22) continue;

      const scale = 0.82 + Math.random() * 0.65;
      dummy.position.set(tx, s.height - 0.12, tz);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      trunkInstances.setMatrixAt(placedTrees, dummy.matrix);
      tier1Instances.setMatrixAt(placedTrees, dummy.matrix);
      tier2Instances.setMatrixAt(placedTrees, dummy.matrix);
      tier3Instances.setMatrixAt(placedTrees, dummy.matrix);

      crownColor
        .setHex(crownHex)
        .offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.09);
      tier1Instances.setColorAt(placedTrees, crownColor);
      tier2Instances.setColorAt(placedTrees, crownColor.clone().offsetHSL(0, 0, 0.03));
      tier3Instances.setColorAt(placedTrees, crownColor.clone().offsetHSL(0, 0, 0.06));

      // Tight solid physical collider for the tree trunk
      colliders.push({
        type: 'circle',
        x: tx,
        z: tz,
        radius: 0.38 * scale,
        maxY: s.height + 5.2 * scale,
      });

      placedTrees++;
    }
    trunkInstances.count = placedTrees;
    tier1Instances.count = placedTrees;
    tier2Instances.count = placedTrees;
    tier3Instances.count = placedTrees;
    trunkInstances.computeBoundingSphere();
    tier1Instances.computeBoundingSphere();
    tier2Instances.computeBoundingSphere();
    tier3Instances.computeBoundingSphere();
    scene.add(trunkInstances);
    scene.add(tier1Instances);
    scene.add(tier2Instances);
    scene.add(tier3Instances);
  };

  // Highway guardrails, streetlamps & night ground light pools
  const buildHighwayRailsAndLamps = (skipCenterHub: boolean) => {
    const railPostGeo = track(new THREE.BoxGeometry(0.14, 0.85, 0.14));
    railPostGeo.translate(0, 0.425, 0);
    const railBeamGeo = track(new THREE.BoxGeometry(0.12, 0.32, 6.2));
    const steelMat = track(
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.72, roughness: 0.32 })
    );

    const railX = skipCenterHub ? 12.4 : 13.6;
    const minAbsZ = skipCenterHub ? 50 : 0;
    const railCoords: [number, number][] = [];
    for (let z = -194; z <= 194; z += 6) {
      if (skipCenterHub && (Math.abs(z) < minAbsZ || Math.abs(z - -120) < 12 || Math.abs(z - 122) < 12)) {
        continue;
      }
      railCoords.push([-railX, z], [railX, z]);
    }
    const railPostInst = new THREE.InstancedMesh(railPostGeo, steelMat, railCoords.length);
    const railBeamInst = new THREE.InstancedMesh(railBeamGeo, steelMat, railCoords.length);

    railCoords.forEach(([rx, rz], i) => {
      const ry = getTerrainHeightRaw(rx, rz);
      dummy.position.set(rx, ry, rz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      railPostInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(rx, ry + 0.58, rz);
      dummy.updateMatrix();
      railBeamInst.setMatrixAt(i, dummy.matrix);
    });
    railPostInst.computeBoundingSphere();
    railBeamInst.computeBoundingSphere();
    scene.add(railPostInst);
    scene.add(railBeamInst);

    for (const gx of [-railX, railX]) {
      if (skipCenterHub) {
        // Leave clean openings for NE Skidpad [-120] and SE/SW stages [122]
        colliders.push({ type: 'box', minX: gx - 0.22, maxX: gx + 0.22, minZ: -196, maxZ: -133, maxY: 2.0, category: 'barrier' });
        colliders.push({ type: 'box', minX: gx - 0.22, maxX: gx + 0.22, minZ: -107, maxZ: -50, maxY: 2.0, category: 'barrier' });
        colliders.push({ type: 'box', minX: gx - 0.22, maxX: gx + 0.22, minZ: 50, maxZ: 109, maxY: 2.0, category: 'barrier' });
        colliders.push({ type: 'box', minX: gx - 0.22, maxX: gx + 0.22, minZ: 135, maxZ: 196, maxY: 2.0, category: 'barrier' });
      } else {
        colliders.push({ type: 'box', minX: gx - 0.22, maxX: gx + 0.22, minZ: -192, maxZ: 192, maxY: 2.0, category: 'barrier' });
      }
    }

    const isNightNow = activeTimeOfDay === 'night';
    const lampPoleGeo = track(new THREE.CylinderGeometry(0.1, 0.14, 7.5, 8));
    lampPoleGeo.translate(0, 3.75, 0);
    const lampHeadGeo = track(new THREE.BoxGeometry(1.6, 0.18, 0.45));
    const lampHeadMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        emissive: 0xfef3c7,
        emissiveIntensity: isNightNow ? 3.2 : 0.1,
        roughness: 0.25,
      })
    );
    lampHeadMats.push(lampHeadMat);

    const lampPoolTex = track(createLampPoolTexture());
    const lampPoolGeo = track(new THREE.PlaneGeometry(16, 16));
    lampPoolGeo.rotateX(-Math.PI / 2);
    const lampPoolMat = track(
      new THREE.MeshBasicMaterial({
        map: lampPoolTex,
        transparent: true,
        opacity: isNightNow ? 0.36 : 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    );
    lampPoolMats.push(lampPoolMat);

    const lampCoords: [number, number, number][] = [];
    for (let z = -180; z <= 180; z += 34) {
      if (skipCenterHub && Math.abs(z) < 52) continue;
      lampCoords.push([-(railX + 0.8), z, 0], [railX + 0.8, z, Math.PI]);
    }
    const lampPoleInst = new THREE.InstancedMesh(lampPoleGeo, gantryPoleMat, lampCoords.length);
    const lampHeadInst = new THREE.InstancedMesh(lampHeadGeo, lampHeadMat, lampCoords.length);
    const lampPoolInst = new THREE.InstancedMesh(lampPoolGeo, lampPoolMat, lampCoords.length);
    lampPoolInst.visible = isNightNow;
    lampPoolMeshes.push(lampPoolInst);

    lampCoords.forEach(([lx, lz, rot], i) => {
      const ly = getTerrainHeightRaw(lx, lz);
      dummy.position.set(lx, ly, lz);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lampPoleInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(lx + (rot === 0 ? 0.75 : -0.75), ly + 7.45, lz);
      dummy.updateMatrix();
      lampHeadInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(lx + (rot === 0 ? 4.2 : -4.2), ly + 0.08, lz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      lampPoolInst.setMatrixAt(i, dummy.matrix);

      colliders.push({ type: 'circle', x: lx, z: lz, radius: 0.22, maxY: ly + 7.5 });
    });
    lampPoleInst.computeBoundingSphere();
    lampHeadInst.computeBoundingSphere();
    lampPoolInst.computeBoundingSphere();
    scene.add(lampPoleInst);
    scene.add(lampHeadInst);
    scene.add(lampPoolInst);
  };

  // Terrain-conforming 3D path/road ribbon (5 transverse vertices per ring to hug banked dunes & slopes)
  const buildTerrainPathRibbon = (
    waypoints: readonly [number, number][],
    width: number,
    closed: boolean,
    mat: THREE.Material,
    yOffset = 0.055,
    repeatMeters = 18,
    skipSegment?: (x: number, z: number) => boolean
  ) => {
    const curvePts = waypoints.map(([wx, wz]) => new THREE.Vector3(wx, 0, wz));
    const curve = new THREE.CatmullRomCurve3(curvePts, closed, 'catmullrom', 0.42);
    const totalLen = curve.getLength();
    const steps = Math.max(24, Math.ceil(totalLen / 3.2));
    const colsPerRow = 5;
    const uOffsets = [-0.5, -0.25, 0, 0.25, 0.5];
    const uCoords = [0, 0.25, 0.5, 0.75, 1];

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const rowSkipped: boolean[] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const rx = -tan.z;
      const rz = tan.x;
      const rLen = Math.hypot(rx, rz) || 1;
      const nx = rx / rLen;
      const nz = rz / rLen;

      rowSkipped.push(skipSegment ? skipSegment(pt.x, pt.z) : false);
      const vCoord = (t * totalLen) / repeatMeters;

      for (let c = 0; c < colsPerRow; c++) {
        const px = pt.x + nx * uOffsets[c] * width;
        const pz = pt.z + nz * uOffsets[c] * width;
        const py = getTerrainHeightRaw(px, pz) + yOffset;
        positions.push(px, py, pz);
        uvs.push(uCoords[c], vCoord);
      }
    }

    for (let i = 0; i < steps; i++) {
      if (rowSkipped[i] || rowSkipped[i + 1]) continue;
      for (let c = 0; c < colsPerRow - 1; c++) {
        const a = i * colsPerRow + c;
        const b = a + 1;
        const d = a + colsPerRow;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    if (indices.length === 0) return;
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    scene.add(mesh);
  };

  // Helper to generate rounded-rectangle oval waypoints matching terrain.ts sdRoundedBox(x, z, 210, 210, 75)
  const buildOvalWaypoints = (hx: number, hz: number, r: number): [number, number][] => {
    const pts: [number, number][] = [];
    const ix = hx - r;
    const iz = hz - r;
    const corners: [number, number, number, number][] = [
      [ix, -iz, -Math.PI / 2, 0],
      [ix, iz, 0, Math.PI / 2],
      [-ix, iz, Math.PI / 2, Math.PI],
      [-ix, -iz, Math.PI, Math.PI * 1.5],
    ];
    for (const [cx, cz, a0, a1] of corners) {
      for (let s = 0; s <= 6; s++) {
        const a = a0 + ((a1 - a0) * s) / 6;
        pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    }
    return pts;
  };

  // Helper for illuminated cat-eye road reflectors along sweeping oval corners
  const addCircuitCatEyes = (hx: number, hz: number, r: number, offsetFromCenter: number) => {
    const ovalPts = buildOvalWaypoints(hx, hz, r);
    const curve = new THREE.CatmullRomCurve3(
      ovalPts.map(([px, pz]) => new THREE.Vector3(px, 0, pz)),
      true
    );
    const count = 96;
    const studGeo = track(new THREE.BoxGeometry(0.32, 0.08, 0.32));
    const studMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xfef3c7,
        emissive: 0xf59e0b,
        emissiveIntensity: activeTimeOfDay === 'night' ? 2.6 : 0.3,
        roughness: 0.2,
      })
    );
    catEyeMats.push(studMat);
    const inst = new THREE.InstancedMesh(studGeo, studMat, count * 2);
    let idx = 0;
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const pt = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const rx = -tan.z;
      const rz = tan.x;
      const len = Math.hypot(rx, rz) || 1;
      const nx = rx / len;
      const nz = rz / len;
      for (const s of [-1, 1]) {
        const sx = pt.x + nx * s * offsetFromCenter;
        const sz = pt.z + nz * s * offsetFromCenter;
        const sy = getTerrainHeightRaw(sx, sz) + 0.05;
        dummy.position.set(sx, sy, sz);
        dummy.rotation.set(0, Math.atan2(tan.x, tan.z), 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        inst.setMatrixAt(idx++, dummy.matrix);
      }
    }
    inst.computeBoundingSphere();
    scene.add(inst);
  };

  // --- Map-Specific Architecture, Natural Ground Details & Colliders ---
  if (mapId === 'proving-valley') {
    const isNightNow = activeTimeOfDay === 'night';
    const hubMarkTex = track(createHubMarkingsTexture());
    hubMarkTex.anisotropy = maxAniso;
    const hubMarkMesh = new THREE.Mesh(
      track(new THREE.PlaneGeometry(84, 84)),
      track(
        new THREE.MeshStandardMaterial({
          map: hubMarkTex,
          transparent: true,
          roughness: 0.85,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      )
    );
    hubMarkMesh.rotation.x = -Math.PI / 2;
    hubMarkMesh.position.set(0, 0.03, 0);
    hubMarkMesh.receiveShadow = true;
    scene.add(hubMarkMesh);

    // Gantries across every sector & connected corridor
    addGantry(0, -48, 0, 'HIGH-SPEED HIGHWAY', 'SHIFT UP (E) · GEARS 4-6', '#06B6D4');
    addGantry(-48, 0, Math.PI / 2, 'BAD ROAD & SUSPENSION', 'SPEED BUMPS · MOGULS · COBBLE', '#F59E0B');
    addGantry(48, 0, -Math.PI / 2, 'STUNT RAMPS & DUNES', 'AIRBORNE SUSPENSION TEST', '#EF4444');
    addGantry(-52, -52, Math.PI * 0.25, 'MOUNTAIN HILL CLIMB', 'SUMMIT LOOP TO NORTH CIRCUIT', '#22C55E');
    addGantry(54, -54, -Math.PI * 0.25, 'NE DRIFT SKIDPAD', 'CONNECTED CONSTANT-RADIUS ARENA', '#A855F7');
    addGantry(0, 50, 0, 'RALLY & CANYON STAGES', 'SE GRAVEL · SW DIRT SWITCHBACKS', '#F59E0B');

    // Crash test barriers & impact bollards (Hub East/North area)
    addBarrier(24, -28, 6.5, 1.2, 1.1);
    addBarrier(-24, -28, 6.5, 1.2, 1.1);
    addBarrier(26, 26, 4.8, 1.2, 1.1);

    const bollardGeo = track(new THREE.CylinderGeometry(0.28, 0.3, 1.35, 12));
    for (const bx of [16, 19.5, 23]) {
      const by = getTerrainHeightRaw(bx, -14);
      const bollard = new THREE.Mesh(bollardGeo, hazardMat);
      bollard.position.set(bx, by + 0.675, -14);
      bollard.castShadow = true;
      scene.add(bollard);
      colliders.push({ type: 'circle', x: bx, z: -14, radius: 0.34, maxY: by + 1.8, category: 'barrier' });
    }

    // Multi-Part Architectural Landmark 1: Telemetry Control Tower (SW Hub Corner Apron)
    {
      const tx = -36;
      const tz = 34;
      const ty = getTerrainHeightRaw(tx, tz);
      const towerGroup = new THREE.Group();
      towerGroup.position.set(tx, ty, tz);

      const concreteMat = track(new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 }));
      const steelDarkMat = track(new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.32 }));
      const towerGlassMat = track(
        new THREE.MeshStandardMaterial({
          color: 0x7dd3fc,
          emissive: 0xfef3c7,
          emissiveIntensity: isNightNow ? 1.35 : 0.12,
          roughness: 0.12,
          metalness: 0.45,
        })
      );
      windowGlowMats.push(towerGlassMat);
      const beaconMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xef4444,
          emissive: 0xef4444,
          emissiveIntensity: isNightNow ? 3.5 : 0.6,
        })
      );
      beaconMats.push(beaconMat);

      const plinth = new THREE.Mesh(track(new THREE.BoxGeometry(6.8, 1.2, 6.8)), concreteMat);
      plinth.position.y = 0.6;
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      towerGroup.add(plinth);

      for (const [cx, cz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
        const col = new THREE.Mesh(track(new THREE.CylinderGeometry(0.28, 0.32, 6.5, 10)), steelDarkMat);
        col.position.set(cx, 4.45, cz);
        col.castShadow = true;
        towerGroup.add(col);
      }

      const cabFloor = new THREE.Mesh(track(new THREE.BoxGeometry(7.2, 0.45, 7.2)), steelDarkMat);
      cabFloor.position.y = 7.7;
      cabFloor.castShadow = true;
      towerGroup.add(cabFloor);

      const glassCab = new THREE.Mesh(track(new THREE.BoxGeometry(6.2, 2.4, 6.2)), towerGlassMat);
      glassCab.position.y = 9.1;
      towerGroup.add(glassCab);

      const roofCap = new THREE.Mesh(track(new THREE.BoxGeometry(8.0, 0.42, 8.0)), steelDarkMat);
      roofCap.position.y = 10.5;
      roofCap.castShadow = true;
      towerGroup.add(roofCap);

      const mast = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.14, 3.6, 8)), gantryPoleMat);
      mast.position.y = 12.4;
      towerGroup.add(mast);

      const beacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.26, 12, 12)), beaconMat);
      beacon.position.y = 14.25;
      towerGroup.add(beacon);

      scene.add(towerGroup);
      colliders.push({
        type: 'box',
        minX: tx - 3.6,
        maxX: tx + 3.6,
        minZ: tz - 3.6,
        maxZ: tz + 3.6,
        maxY: ty + 14.5,
      });
    }

    // Multi-Part Architectural Landmark 2: Mountain Summit Weather & Radio Beacon Tower
    {
      const mx = -103;
      const mz = -124;
      const my = getTerrainHeightRaw(mx, mz);
      const summitGroup = new THREE.Group();
      summitGroup.position.set(mx, my, mz);

      const basePad = new THREE.Mesh(
        track(new THREE.CylinderGeometry(2.6, 3.0, 0.7, 12)),
        track(new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 }))
      );
      basePad.position.y = 0.25;
      basePad.receiveShadow = true;
      summitGroup.add(basePad);

      const latticeMat = track(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.55, roughness: 0.35 }));
      const mastBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.24, 0.85, 11.5, 6)), latticeMat);
      mastBody.position.y = 6.1;
      mastBody.castShadow = true;
      summitGroup.add(mastBody);

      const dishBar = new THREE.Mesh(track(new THREE.BoxGeometry(2.8, 0.18, 0.18)), gantryPoleMat);
      dishBar.position.y = 9.4;
      summitGroup.add(dishBar);

      const beaconMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xf43f5e,
          emissive: 0xf43f5e,
          emissiveIntensity: isNightNow ? 3.8 : 0.6,
        })
      );
      beaconMats.push(beaconMat);
      const topBeacon = new THREE.Mesh(track(new THREE.SphereGeometry(0.32, 12, 12)), beaconMat);
      topBeacon.position.y = 12.0;
      summitGroup.add(topBeacon);

      scene.add(summitGroup);
      colliders.push({ type: 'circle', x: mx, z: mz, radius: 2.2, maxY: my + 12.5 });
    }

    // Multi-Part Dunes Jump Framing Arches (wide 12m clear opening over the stunt ramps)
    for (const [ax, az] of [[78, -19], [112, 18]] as const) {
      const ay = getTerrainHeightRaw(ax, az);
      const archGroup = new THREE.Group();
      archGroup.position.set(ax, ay, az);
      const archMat = track(new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.42, metalness: 0.25 }));
      for (const pz of [-6.4, 6.4]) {
        const post = new THREE.Mesh(track(new THREE.CylinderGeometry(0.22, 0.28, 7.6, 10)), gantryPoleMat);
        post.position.set(0, 3.8, pz);
        post.castShadow = true;
        archGroup.add(post);
        colliders.push({ type: 'circle', x: ax, z: az + pz, radius: 0.4, maxY: ay + 7.6 });
      }
      const banner = new THREE.Mesh(track(new THREE.BoxGeometry(0.45, 1.15, 13.6)), archMat);
      banner.position.set(0, 7.2, 0);
      banner.castShadow = true;
      archGroup.add(banner);
      scene.add(archGroup);
    }

    buildHighwayRailsAndLamps(true);
    addCircuitCatEyes(210, 210, 75, 8.6);

    // Curve Chevron Warning Signs along outer corners
    {
      const chevTex = track(createChevronSignTexture());
      const chevMat = track(
        new THREE.MeshStandardMaterial({
          map: chevTex,
          emissiveMap: chevTex,
          emissive: 0xffffff,
          emissiveIntensity: isNightNow ? 0.55 : 0.05,
          roughness: 0.4,
        })
      );
      gantrySignMats.push(chevMat);
      const chevPostGeo = track(new THREE.CylinderGeometry(0.08, 0.1, 2.0, 8));
      chevPostGeo.translate(0, 1.0, 0);
      const chevBoardGeo = track(new THREE.BoxGeometry(1.1, 1.1, 0.12));

      const cornerCenters: [number, number, number, number][] = [
        [135, -135, -Math.PI * 0.45, -0.05],
        [135, 135, 0.05, Math.PI * 0.45],
        [-135, 135, Math.PI * 0.55, Math.PI * 0.95],
        [-135, -135, Math.PI * 1.05, Math.PI * 1.45],
      ];
      const chevCoords: { x: number; z: number; rotY: number }[] = [];
      for (const [cx, cz, a0, a1] of cornerCenters) {
        for (let s = 0; s < 4; s++) {
          const a = a0 + ((a1 - a0) * s) / 3;
          const sx = cx + Math.cos(a) * 86.5;
          const sz = cz + Math.sin(a) * 86.5;
          chevCoords.push({ x: sx, z: sz, rotY: Math.atan2(cx - sx, cz - sz) });
        }
      }
      const postInst = new THREE.InstancedMesh(chevPostGeo, gantryPoleMat, chevCoords.length);
      const boardInst = new THREE.InstancedMesh(chevBoardGeo, chevMat, chevCoords.length);
      chevCoords.forEach((c, i) => {
        const cy = getTerrainHeightRaw(c.x, c.z);
        dummy.position.set(c.x, cy, c.z);
        dummy.rotation.set(0, c.rotY, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        postInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(c.x, cy + 2.05, c.z);
        dummy.updateMatrix();
        boardInst.setMatrixAt(i, dummy.matrix);
        colliders.push({ type: 'circle', x: c.x, z: c.z, radius: 0.22, maxY: cy + 2.6 });
      });
      postInst.computeBoundingSphere();
      boardInst.computeBoundingSphere();
      scene.add(postInst);
      scene.add(boardInst);
    }

    // Crisp 3D asphalt lane markings & ALL connected road ribbons
    const pvAsphaltTex = track(createAsphaltMarkingsTexture(true));
    pvAsphaltTex.anisotropy = maxAniso;
    const pvAsphaltMat = track(
      new THREE.MeshStandardMaterial({
        map: pvAsphaltTex,
        transparent: true,
        roughness: 0.78,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    buildTerrainPathRibbon(buildOvalWaypoints(210, 210, 75), 18, true, pvAsphaltMat, 0.04, 20);
    buildTerrainPathRibbon([[0, -205], [0, -48]], 17, false, pvAsphaltMat, 0.04, 20);
    buildTerrainPathRibbon([[0, 48], [0, 205]], 17, false, pvAsphaltMat, 0.04, 20);
    // West Bad-Road Connector & NE Skidpad Connectors (asphalt)
    buildTerrainPathRibbon(PROVING_WEST_CONNECTOR_POINTS, 15, false, pvAsphaltMat, 0.04, 18);
    buildTerrainPathRibbon(PROVING_NE_CONNECTOR_WEST, 14.5, false, pvAsphaltMat, 0.04, 18);
    buildTerrainPathRibbon(PROVING_NE_CONNECTOR_NORTH, 14.5, false, pvAsphaltMat, 0.04, 18);
    buildTerrainPathRibbon(PROVING_NE_CONNECTOR_SOUTH, 14.5, false, pvAsphaltMat, 0.04, 18);
    buildTerrainPathRibbon(PROVING_NE_CONNECTOR_HUB, 14.5, false, pvAsphaltMat, 0.04, 18);

    // NE Drift Skidpad Concentric Rings & Center Timing Pylon
    {
      const [sx, sz] = PROVING_NE_SKIDPAD_CENTER;
      const ringOuter = new THREE.Mesh(
        track(new THREE.RingGeometry(31.4, 32.6, 64)),
        track(
          new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          })
        )
      );
      ringOuter.rotation.x = -Math.PI / 2;
      ringOuter.position.set(sx, 0.042, sz);
      scene.add(ringOuter);

      const ringInner = new THREE.Mesh(
        track(new THREE.RingGeometry(15.6, 16.4, 48)),
        track(
          new THREE.MeshBasicMaterial({
            color: 0xf59e0b,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8,
          })
        )
      );
      ringInner.rotation.x = -Math.PI / 2;
      ringInner.position.set(sx, 0.042, sz);
      scene.add(ringInner);

      const pylon = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.55, 0.75, 2.2, 12)),
        hazardMat
      );
      pylon.position.set(sx, 1.1, sz);
      pylon.castShadow = true;
      scene.add(pylon);
      colliders.push({ type: 'circle', x: sx, z: sz, radius: 0.8, maxY: 2.5, category: 'barrier' });
    }

    // Connected Gravel & Dirt Trails (Mountain Over-Summit + West Spur + Dunes Link + SE Rally + SW Canyon)
    const pvDirtTex = track(createTrailRoadTexture('#7c5e42', '#4c3825', 'rgba(118,92,62,0.58)'));
    pvDirtTex.anisotropy = maxAniso;
    const pvDirtMat = track(
      new THREE.MeshStandardMaterial({
        map: pvDirtTex,
        transparent: true,
        roughness: 0.92,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    buildTerrainPathRibbon(PROVING_HILL_TRAIL_POINTS, 11.5, false, pvDirtMat, 0.058, 14);
    buildTerrainPathRibbon(PROVING_HILL_WEST_SPUR_POINTS, 10.5, false, pvDirtMat, 0.058, 14);
    buildTerrainPathRibbon(PROVING_EAST_CONNECTOR_POINTS, 14.5, false, pvDirtMat, 0.055, 14);
    buildTerrainPathRibbon(PROVING_SE_RALLY_POINTS, 13.5, false, pvDirtMat, 0.055, 15);
    buildTerrainPathRibbon(PROVING_SE_DUNES_LINK_POINTS, 12.0, false, pvDirtMat, 0.055, 14);
    buildTerrainPathRibbon(PROVING_SE_EAST_SPUR_POINTS, 12.0, false, pvDirtMat, 0.055, 14);
    buildTerrainPathRibbon(PROVING_SW_TRAIL_POINTS, 12.5, false, pvDirtMat, 0.055, 15);
    buildTerrainPathRibbon(PROVING_SW_BADROAD_LINK_POINTS, 11.5, false, pvDirtMat, 0.055, 14);
    buildTerrainPathRibbon(PROVING_SW_WEST_SPUR_POINTS, 11.5, false, pvDirtMat, 0.055, 14);

    spawnTrees(360, 0x2a4d29, 'grass');
    spawnGrassAndScrub(1900, 0x4b7438, ['grass']);
    spawnGroundPebbles(1100, 0x736b60, true);
    spawnBoulders(68, 0x6b7280, () => {
      const rx = -182 + Math.random() * 130;
      const rz = -182 + Math.random() * 130;
      const s = sampleTerrain(rx, rz);
      if (s.surfaceType !== 'rock') return null;
      const dCenter = Math.hypot(rx + 115, rz + 125);
      if (dCenter < 16 || dCenter > 60) return null;
      return { x: rx, z: rz };
    });
    // Additional scattered meadow boulders across expanded valley (off roads)
    spawnBoulders(95, 0x64748b, () => {
      const rx = (Math.random() * 2 - 1) * 760;
      const rz = (Math.random() * 2 - 1) * 760;
      const s = sampleTerrain(rx, rz);
      if (s.surfaceType !== 'grass' || Math.hypot(rx, rz) < 62) return null;
      return { x: rx, z: rz };
    });
  } else if (mapId === 'mountain-pass') {
    addGantry(0, 120, 0, 'REDROCK ASCENT', 'LOW GEAR (1-2) · ENGAGE DIFF LOCK (L)', '#22C55E');
    addGantry(Math.sin(-155 * 0.022) * 58, -155, 0, 'SUMMIT LOOKOUT', '28M ELEVATION GAIN · ROCK CRAWL COMPLETE', '#F59E0B');

    // Continuous winding 3D switchback mountain trail with twin tire ruts
    const mountainPts: [number, number][] = [];
    for (let z = 175; z >= -185; z -= 15) {
      mountainPts.push([mountainRoadCenterX(z), z]);
    }
    const mtnTrailTex = track(
      createTrailRoadTexture('#8c6244', '#583b27', 'rgba(145,103,72,0.55)')
    );
    mtnTrailTex.anisotropy = maxAniso;
    const mtnTrailMat = track(
      new THREE.MeshStandardMaterial({
        map: mtnTrailTex,
        transparent: true,
        roughness: 0.94,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    buildTerrainPathRibbon(mountainPts, 15.5, false, mtnTrailMat, 0.06, 16);

    const stakeGeo = track(new THREE.CylinderGeometry(0.11, 0.14, 1.8, 8));
    stakeGeo.translate(0, 0.9, 0);
    const stakeCapGeo = track(new THREE.BoxGeometry(0.28, 0.25, 0.28));
    const stakeMat = track(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 }));
    const stakeCoords: [number, number][] = [];
    for (let z = 115; z >= -145; z -= 20) {
      const cx = Math.sin(z * 0.022) * 58;
      stakeCoords.push([cx - 12.5, z], [cx + 12.5, z]);
    }
    const stakeInst = new THREE.InstancedMesh(stakeGeo, stakeMat, stakeCoords.length);
    const capInst = new THREE.InstancedMesh(stakeCapGeo, hazardMat, stakeCoords.length);
    stakeCoords.forEach(([sx, sz], i) => {
      const sy = getTerrainHeightRaw(sx, sz);
      dummy.position.set(sx, sy, sz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      stakeInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(sx, sy + 1.8, sz);
      dummy.updateMatrix();
      capInst.setMatrixAt(i, dummy.matrix);

      colliders.push({ type: 'circle', x: sx, z: sz, radius: 0.18, maxY: sy + 2.2 });
    });
    stakeInst.computeBoundingSphere();
    capInst.computeBoundingSphere();
    scene.add(stakeInst);
    scene.add(capInst);

    spawnBoulders(210, 0x8a4e3a, () => {
      const rx = -680 + Math.random() * 1360;
      const rz = -680 + Math.random() * 1360;
      const trailX = Math.sin(rz * 0.022) * 58;
      if (Math.abs(rx - trailX) < 16) return null;
      if (Math.hypot(rx, rz - 145) < 26) return null;
      return { x: rx, z: rz };
    });

    spawnTrees(220, 0x385231, 'rock');
    spawnGrassAndScrub(1400, 0x6f683a, ['rock', 'gravel']);
    spawnGroundPebbles(1300, 0x8a5a44, false);
  } else if (mapId === 'desert-baja') {
    addGantry(0, 92, 0, 'BAJA DESERT WASH', 'HIGH SPEED + MEGA LAUNCH RAMPS', '#F59E0B');
    addGantry(0, -18, 0, 'TWIN DUNE JUMPS', 'TEST LONG-TRAVEL SUSPENSION', '#EF4444');

    // Unmistakable packed desert rally trail system: Center Wash + East Canyon Loop + West Whoops Loop
    const bajaTrailTex = track(
      createTrailRoadTexture('#9c764c', '#634729', 'rgba(180,141,94,0.6)')
    );
    bajaTrailTex.anisotropy = maxAniso;
    const bajaTrailMat = track(
      new THREE.MeshStandardMaterial({
        map: bajaTrailTex,
        transparent: true,
        roughness: 0.92,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    // Center Wash runway (skips steel ramp decks so yellow jump ramps pop cleanly)
    buildTerrainPathRibbon(
      BAJA_WASH_POINTS,
      17.5,
      false,
      bajaTrailMat,
      0.055,
      16,
      (px, pz) =>
        Math.abs(px) < 11 && ((pz >= 23 && pz <= 58) || (pz >= -94 && pz <= -52))
    );
    buildTerrainPathRibbon(BAJA_EAST_LOOP_POINTS, 15.5, false, bajaTrailMat, 0.055, 16);
    buildTerrainPathRibbon(BAJA_WEST_LOOP_POINTS, 15.5, false, bajaTrailMat, 0.055, 16);
    buildTerrainPathRibbon(BAJA_WHOOPS_CONNECTOR_POINTS, 13.5, false, bajaTrailMat, 0.055, 14);

    const flagPoleGeo = track(new THREE.CylinderGeometry(0.08, 0.1, 2.8, 8));
    flagPoleGeo.translate(0, 1.4, 0);
    const flagGeo = track(new THREE.BoxGeometry(0.9, 0.55, 0.06));
    const flagMat = track(new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 }));
    const flagCoords: [number, number][] = [];
    for (let z = 110; z >= -230; z -= 28) {
      flagCoords.push([-13, z], [13, z]);
    }
    for (let z = 80; z >= -100; z -= 26) {
      flagCoords.push([-86, z], [-34, z]);
    }
    // Outer loop corner guide flags along East & West desert paths
    for (const pt of [...BAJA_EAST_LOOP_POINTS, ...BAJA_WEST_LOOP_POINTS]) {
      if (Math.abs(pt[0]) > 25) {
        flagCoords.push([pt[0] + (pt[0] > 0 ? 11 : -11), pt[1]]);
      }
    }
    const fPoleInst = new THREE.InstancedMesh(flagPoleGeo, gantryPoleMat, flagCoords.length);
    const fFlagInst = new THREE.InstancedMesh(flagGeo, flagMat, flagCoords.length);
    flagCoords.forEach(([fx, fz], i) => {
      const fy = getTerrainHeightRaw(fx, fz);
      dummy.position.set(fx, fy, fz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      fPoleInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(fx + (fx < 0 ? -0.45 : 0.45), fy + 2.45, fz);
      dummy.updateMatrix();
      fFlagInst.setMatrixAt(i, dummy.matrix);

      colliders.push({ type: 'circle', x: fx, z: fz, radius: 0.15, maxY: fy + 3.0 });
    });
    fPoleInst.computeBoundingSphere();
    fFlagInst.computeBoundingSphere();
    scene.add(fPoleInst);
    scene.add(fFlagInst);

    spawnBoulders(190, 0x9c724c, () => {
      const rx = -680 + Math.random() * 1360;
      const rz = -680 + Math.random() * 1360;
      if (distanceToBajaTrail(rx, rz) < 16) return null;
      if (rx >= -94 && rx <= -28 && rz >= -120 && rz <= 100) return null;
      if (Math.hypot(rx, rz - 130) < 28) return null;
      return { x: rx, z: rz };
    });
    spawnGrassAndScrub(1200, 0x7b723f, ['sand', 'gravel']);
    spawnGroundPebbles(1200, 0x9b7952, false);
  } else if (mapId === 'testing-facility') {
    addGantry(0, 180, 0, 'TESTING FACILITY STRAIGHT', '600M ACCEL · COAST-DOWN · VMAX LANE', '#A855F7');
    addGantry(0, -180, 0, 'BRAKING & HIGH-SPEED END', 'STOPPING ZONE · PRESS B FOR VECTORS', '#38BDF8');
    addGantry(46, 110, 0, 'SPLIT-MU BRAKE PAD', 'LEFT DRY (1.08) · RIGHT ICE (0.30)', '#22D3EE');

    const tfAsphaltTex = track(createAsphaltMarkingsTexture(true));
    tfAsphaltTex.anisotropy = maxAniso;
    const tfAsphaltMat = track(
      new THREE.MeshStandardMaterial({
        map: tfAsphaltTex,
        transparent: true,
        roughness: 0.72,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    buildTerrainPathRibbon(
      [
        [0, 300],
        [0, -300],
      ],
      30,
      false,
      tfAsphaltMat,
      0.035,
      20
    );

    // Painted R=40m Skid Pad Circle Rings at (-90, 0)
    const skidOuter = new THREE.Mesh(
      track(new THREE.RingGeometry(39.4, 40.6, 72)),
      track(
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        })
      )
    );
    skidOuter.rotation.x = -Math.PI / 2;
    skidOuter.position.set(-90, 0.04, 0);
    scene.add(skidOuter);

    const skidCenter = new THREE.Mesh(
      track(new THREE.CircleGeometry(2.5, 24)),
      track(new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide }))
    );
    skidCenter.rotation.x = -Math.PI / 2;
    skidCenter.position.set(-90, 0.045, 0);
    scene.add(skidCenter);

    // Split-Mu Glossy Ice Strip Overlay (x in [46, 58], z in [-160, 160])
    const iceMat = track(
      new THREE.MeshStandardMaterial({
        color: 0xbae6fd,
        roughness: 0.09,
        metalness: 0.15,
        transparent: true,
        opacity: 0.72,
      })
    );
    const iceStrip = new THREE.Mesh(track(new THREE.PlaneGeometry(12, 320)), iceMat);
    iceStrip.rotation.x = -Math.PI / 2;
    iceStrip.position.set(52, 0.028, 0);
    iceStrip.receiveShadow = true;
    scene.add(iceStrip);

    // ISO Double Lane Change Cones (corridor x in [-44, -22], z in [-130, 20])
    const coneGeo = track(new THREE.ConeGeometry(0.24, 0.72, 10));
    coneGeo.translate(0, 0.36, 0);
    const coneMat = track(new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 }));
    const conePositions: [number, number][] = [];
    // Entry gate
    for (let z = 20; z >= -20; z -= 8) {
      conePositions.push([-30.5, z], [-25.5, z]);
    }
    // Offset lane
    for (let z = -34; z >= -68; z -= 8) {
      conePositions.push([-40.5, z], [-34.5, z]);
    }
    // Exit gate
    for (let z = -82; z >= -124; z -= 8) {
      conePositions.push([-30.5, z], [-25.5, z]);
    }
    const coneInst = new THREE.InstancedMesh(coneGeo, coneMat, conePositions.length);
    coneInst.castShadow = true;
    conePositions.forEach(([cx, cz], idx) => {
      dummy.position.set(cx, 0, cz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      coneInst.setMatrixAt(idx, dummy.matrix);
    });
    coneInst.computeBoundingSphere();
    scene.add(coneInst);

    // Calibration Crash Barrier on east apron edge (safe distance from accel straight)
    addBarrier(74, -220, 8.0, 1.35, 1.4);
  } else {
    addGantry(0, 95, 0, 'MIDNIGHT SPEEDWAY', 'SHIFT GEARS 4-6 FOR 300+ KM/H', '#F43F5E');
    addGantry(0, -95, 0, 'COASTAL LOOP AHEAD', 'BRAKE HARD INTO CORNER APEX', '#38BDF8');

    buildHighwayRailsAndLamps(false);
    addCircuitCatEyes(210, 210, 75, 10.4);

    // Crisp 3D highway lane lines & coastal speedway markings
    const hwAsphaltTex = track(createAsphaltMarkingsTexture(false));
    hwAsphaltTex.anisotropy = maxAniso;
    const hwAsphaltMat = track(
      new THREE.MeshStandardMaterial({
        map: hwAsphaltTex,
        transparent: true,
        roughness: 0.72,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    buildTerrainPathRibbon(buildOvalWaypoints(210, 210, 75), 22, true, hwAsphaltMat, 0.04, 22);
    buildTerrainPathRibbon(
      [
        [0, -205],
        [0, 205],
      ],
      20,
      false,
      hwAsphaltMat,
      0.04,
      22
    );

    addBarrier(36, 40, 5.5, 1.2, 1.1);
    addBarrier(-36, -40, 5.5, 1.2, 1.1);
    addBarrier(210, 40, 1.2, 1.2, 6.0);

    spawnGrassAndScrub(1100, 0x3b4d3f, ['gravel']);
    spawnGroundPebbles(1100, 0x525b66, true);
  }

  // Register climbable stone/rock bumps into terrain sampling
  setActiveRockBumps(rockBumps);

  // GPU Shader-based Surface Particle System (tire smoke, dust plumes, dirt spray, touchdown bursts & sparks)
  const particles = track(new SurfaceParticleSystem(activeTheme.fogHex, activeTheme.fogDensity));
  scene.add(particles.points);

  const updateSunFollow = (x: number, z: number) => {
    sunLight.position.set(
      x + activeTheme.sunOffset[0],
      activeTheme.sunOffset[1],
      z + activeTheme.sunOffset[2]
    );
    sunLight.target.position.set(x, 0, z);
    sunLight.target.updateMatrixWorld();
    skyGroup.position.set(x, 0, z);
  };

  let lastAppliedEnvTex: THREE.Texture | null = null;
  const setTimeOfDay = (
    mode: TimeOfDay,
    targetRenderer: THREE.WebGLRenderer,
    targetScene: THREE.Scene
  ) => {
    activeTimeOfDay = mode;
    const nextTheme = MAP_THEMES[mapId][mode];
    activeTheme = nextTheme;
    const isNight = mode === 'night';

    if (targetScene.background instanceof THREE.Color) {
      targetScene.background.setHex(nextTheme.fogHex);
    } else {
      targetScene.background = new THREE.Color(nextTheme.fogHex);
    }
    if (targetScene.fog instanceof THREE.FogExp2) {
      targetScene.fog.color.setHex(nextTheme.fogHex);
      targetScene.fog.density = nextTheme.fogDensity;
    }

    targetRenderer.toneMappingExposure = nextTheme.exposure;
    updateSkyDomeColors(skyDomeGeo, nextTheme, isNight);
    starfield.points.visible = isNight;
    sunOrbGroup.visible = !isNight;
    moonOrbGroup.visible = isNight;

    hemiLight.color.setHex(nextTheme.hemiSky);
    hemiLight.groundColor.setHex(nextTheme.hemiGround);
    hemiLight.intensity = nextTheme.hemiIntensity;
    sunLight.color.setHex(nextTheme.sunHex);
    sunLight.intensity = nextTheme.sunIntensity;

    // Toggle streetlamps, light pools, glowing signage, cat-eye road studs & beacons
    for (let i = 0; i < gantrySignMats.length; i++) {
      gantrySignMats[i].emissiveIntensity = isNight ? 0.85 : 0.08;
    }
    for (let i = 0; i < lampHeadMats.length; i++) {
      lampHeadMats[i].emissiveIntensity = isNight ? 3.2 : 0.1;
    }
    for (let i = 0; i < lampPoolMats.length; i++) {
      lampPoolMats[i].opacity = isNight ? 0.36 : 0;
    }
    for (let i = 0; i < lampPoolMeshes.length; i++) {
      lampPoolMeshes[i].visible = isNight;
    }
    for (let i = 0; i < catEyeMats.length; i++) {
      catEyeMats[i].emissiveIntensity = isNight ? 2.6 : 0.3;
    }
    for (let i = 0; i < beaconMats.length; i++) {
      beaconMats[i].emissiveIntensity = isNight ? 3.6 : 0.6;
    }
    for (let i = 0; i < windowGlowMats.length; i++) {
      windowGlowMats[i].emissiveIntensity = isNight ? 1.35 : 0.12;
    }

    particles.setFog(nextTheme.fogHex, nextTheme.fogDensity);

    // Refresh PMREM sky reflection environment cleanly without resetting scene or physics
    const pmrem = new THREE.PMREMGenerator(targetRenderer);
    const nextEnv = createOutdoorReflectionTexture(pmrem, mapId, mode);
    pmrem.dispose();
    if (lastAppliedEnvTex) {
      lastAppliedEnvTex.dispose();
    }
    lastAppliedEnvTex = nextEnv;
    targetScene.environment = nextEnv;
  };

  return {
    sunLight,
    colliders,
    particles,
    updateSunFollow,
    setTimeOfDay,
    dispose: () => {
      if (lastAppliedEnvTex) {
        lastAppliedEnvTex.dispose();
        lastAppliedEnvTex = null;
      }
      disposables.forEach((item) => item.dispose());
    },
  };
}
