import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCarVisualRig } from './carModels';
import {
  classifySurface,
  getActiveTerrainMap,
  getBaseTerrainHeight,
  setActiveTerrainMap,
} from './terrain';
import { CarSpec, MapId } from '../types/vehicle';

const carPreviewCache = new Map<string, string>();
const mapPreviewCache = new Map<MapId, string>();

let sharedRenderer: THREE.WebGLRenderer | null = null;
let sharedEnvTex: THREE.Texture | null = null;

function ensurePreviewRenderer(): {
  renderer: THREE.WebGLRenderer;
  envTex: THREE.Texture;
} | null {
  if (sharedRenderer && sharedEnvTex) {
    return { renderer: sharedRenderer, envTex: sharedEnvTex };
  }
  try {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(1);
    renderer.setSize(600, 380, false);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    sharedRenderer = renderer;
    sharedEnvTex = envTex;
    return { renderer, envTex };
  } catch {
    return null;
  }
}

export function disposeLobbyPreviewRenderer(): void {
  if (sharedEnvTex) {
    sharedEnvTex.dispose();
    sharedEnvTex = null;
  }
  if (sharedRenderer) {
    sharedRenderer.dispose();
    sharedRenderer = null;
  }
}

export function renderCarPreviewDataUrl(car: CarSpec, paintHex: string): string | null {
  const key = `${car.id}:${paintHex.toLowerCase()}`;
  const cached = carPreviewCache.get(key);
  if (cached) return cached;

  const ctx = ensurePreviewRenderer();
  if (!ctx) return null;

  const { renderer, envTex } = ctx;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1420);
  scene.environment = envTex;

  // Studio dome gradient backdrop
  const bgGeo = new THREE.SphereGeometry(28, 24, 16);
  const bgPos = bgGeo.attributes.position;
  const bgCols = new Float32Array(bgPos.count * 3);
  const cTop = new THREE.Color(0x0b0f18);
  const cMid = new THREE.Color(0x182235);
  const cTmp = new THREE.Color();
  for (let i = 0; i < bgPos.count; i++) {
    const t = Math.max(0, Math.min(1, (bgPos.getY(i) + 6) / 22));
    cTmp.copy(cMid).lerp(cTop, t);
    bgCols[i * 3] = cTmp.r;
    bgCols[i * 3 + 1] = cTmp.g;
    bgCols[i * 3 + 2] = cTmp.b;
  }
  bgGeo.setAttribute('color', new THREE.BufferAttribute(bgCols, 3));
  const bgMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  scene.add(bgMesh);

  // Subtle automotive showroom turntable floor + ring accent
  const floorGeo = new THREE.CylinderGeometry(3.75, 3.85, 0.08, 48);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x161d2b,
    roughness: 0.42,
    metalness: 0.28,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.y = -0.04;
  scene.add(floorMesh);

  const ringGeo = new THREE.RingGeometry(3.68, 3.74, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.004;
  scene.add(ringMesh);

  // Studio 3-point lighting
  const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.95);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff5e4, 2.35);
  keyLight.position.set(6, 7.5, -5.5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x7dd3fc, 1.45);
  rimLight.position.set(-6.5, 4.2, 5.5);
  scene.add(rimLight);

  // Build real 3D car rig & pose wheels at calibrated static sag + slight 3/4 turn
  const rig = createCarVisualRig(car, paintHex);
  const staticSag = (car.massKg * 9.81) / 4 / car.springStiffness;
  const mountLocalY = car.suspensionRestLength * 0.35;
  const wheelOffsetY = mountLocalY - (car.suspensionRestLength - staticSag);
  const springTopY = mountLocalY + 0.14;
  const springNaturalLen = car.suspensionRestLength * 0.92;
  const scaleY = Math.max(0.06, springTopY - wheelOffsetY) / springNaturalLen;

  for (let i = 0; i < 4; i++) {
    const isRight = i === 1 || i === 3;
    rig.wheelPivots[i].position.y = wheelOffsetY;
    rig.wheelPivots[i].rotation.y = i < 2 ? 0.24 : 0;
    rig.springMeshes[i].scale.y = scaleY;
    rig.damperRods[i].scale.y = scaleY;
    rig.controlArms[i].position.y = wheelOffsetY * 0.5;
    rig.controlArms[i].rotation.z = (isRight ? 1 : -1) * Math.atan2(wheelOffsetY, 0.32);
  }

  const wheelBottomLocalY = wheelOffsetY - car.wheelRadius;
  rig.root.position.y = -wheelBottomLocalY;
  rig.contactShadow.position.y = wheelBottomLocalY + 0.012;
  const shadowMat = rig.contactShadow.material as THREE.MeshBasicMaterial;
  shadowMat.opacity = 0.72;
  scene.add(rig.root);

  // Frame camera uniformly for compact coupes and tall SUVs
  const camera = new THREE.PerspectiveCamera(34, 600 / 380, 0.1, 100);
  const span = Math.max(car.length * 0.96, car.height * 2.15, car.width * 2.05);
  const dist = span * 1.38;
  camera.position.set(dist * 0.82, dist * 0.31 + car.height * 0.22, -dist * 0.82);
  camera.lookAt(0, car.height * 0.42, 0.08);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  carPreviewCache.set(key, dataUrl);

  rig.dispose();
  bgGeo.dispose();
  bgMat.dispose();
  floorGeo.dispose();
  floorMat.dispose();
  ringGeo.dispose();
  ringMat.dispose();

  return dataUrl;
}

const MAP_DIORAMA_PALETTE: Record<
  MapId,
  { skyTop: number; skyHorizon: number; sunHex: number; sunPos: [number, number, number] }
> = {
  'proving-valley': {
    skyTop: 0x1e4a7a,
    skyHorizon: 0x9ec4e6,
    sunHex: 0xfff0d4,
    sunPos: [140, 180, 110],
  },
  'mountain-pass': {
    skyTop: 0x2c4b74,
    skyHorizon: 0xe2bfa0,
    sunHex: 0xffd7ad,
    sunPos: [160, 150, 90],
  },
  'desert-baja': {
    skyTop: 0x2f5e93,
    skyHorizon: 0xf1d3a2,
    sunHex: 0xffe4b0,
    sunPos: [150, 175, 85],
  },
  'highway-circuit': {
    skyTop: 0x070b18,
    skyHorizon: 0x2a355b,
    sunHex: 0xa5c4ff,
    sunPos: [-120, 140, -100],
  },
  'testing-facility': {
    skyTop: 0x1e3a5f,
    skyHorizon: 0xc2d5e8,
    sunHex: 0xfff5e4,
    sunPos: [145, 185, 95],
  },
};

export function renderMapPreviewDataUrl(mapId: MapId): string | null {
  const cached = mapPreviewCache.get(mapId);
  if (cached) return cached;

  const ctx = ensurePreviewRenderer();
  if (!ctx) return null;

  const prevMap = getActiveTerrainMap();
  setActiveTerrainMap(mapId);

  const { renderer, envTex } = ctx;
  const palette = MAP_DIORAMA_PALETTE[mapId];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.skyHorizon);
  scene.fog = new THREE.FogExp2(palette.skyHorizon, 0.0016);
  scene.environment = envTex;

  // Sky gradient dome
  const skyGeo = new THREE.SphereGeometry(750, 20, 14);
  const skyPos = skyGeo.attributes.position;
  const skyCols = new Float32Array(skyPos.count * 3);
  const cTop = new THREE.Color(palette.skyTop);
  const cHor = new THREE.Color(palette.skyHorizon);
  const cTmp = new THREE.Color();
  for (let i = 0; i < skyPos.count; i++) {
    const t = Math.max(0, Math.min(1, skyPos.getY(i) / 420));
    cTmp.copy(cHor).lerp(cTop, Math.pow(t, 0.72));
    skyCols[i * 3] = cTmp.r;
    skyCols[i * 3 + 1] = cTmp.g;
    skyCols[i * 3 + 2] = cTmp.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCols, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Lighting
  const hemi = new THREE.HemisphereLight(palette.skyHorizon, 0x2d2a24, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(palette.sunHex, 2.25);
  sun.position.set(...palette.sunPos);
  scene.add(sun);

  // Sample 3D terrain mesh across core proving area [-245..245]
  const segs = 104;
  const half = 245;
  const vCount = (segs + 1) * (segs + 1);
  const pos = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const indices: number[] = [];

  const cAsphalt = new THREE.Color(mapId === 'highway-circuit' ? 0x1e2533 : 0x262d38);
  const cLane = new THREE.Color(0xe2e8f0);
  const cCurbRed = new THREE.Color(0xdc2626);
  const cCobble = new THREE.Color(0x646b76);
  const cGravel = new THREE.Color(
    mapId === 'mountain-pass' ? 0x9b7054 : mapId === 'desert-baja' ? 0xad875f : 0x87674c
  );
  const cSand = new THREE.Color(mapId === 'desert-baja' ? 0xe0b370 : 0xcfa96c);
  const cRock = new THREE.Color(mapId === 'mountain-pass' ? 0x9e5138 : 0x575d68);
  const cGrass = new THREE.Color(0x476b3b);

  for (let iz = 0; iz <= segs; iz++) {
    const z = -half + (iz / segs) * half * 2;
    for (let ix = 0; ix <= segs; ix++) {
      const x = -half + (ix / segs) * half * 2;
      const idx = iz * (segs + 1) + ix;
      const h = getBaseTerrainHeight(x, z);
      const s = classifySurface(x, z, 0.96);

      pos[idx * 3] = x;
      pos[idx * 3 + 1] = h;
      pos[idx * 3 + 2] = z;

      if (s.surfaceType === 'asphalt') {
        cTmp.copy(cAsphalt);
        if (s.zoneName === 'Stunt Ramp Park' || s.zoneName === 'Baja Jump Sector') {
          cTmp.setHex(0xef4444).lerp(cAsphalt, 0.35);
        } else if (Math.abs(x) < 1.8 && Math.abs(z) < 200) {
          if (mapId === 'highway-circuit') cTmp.setHex(0x38bdf8);
          else cTmp.copy(cLane);
        } else if (
          mapId === 'highway-circuit' &&
          Math.abs(Math.abs(x) - 11.4) < 2.2 &&
          Math.abs(z) < 202
        ) {
          cTmp.copy(cCurbRed);
        }
      } else if (s.surfaceType === 'cobble') {
        cTmp.copy(cCobble);
        if (z < -12 && h > 0.14) cTmp.setHex(0xf59e0b);
      } else if (s.surfaceType === 'gravel') {
        cTmp.copy(cGravel);
      } else if (s.surfaceType === 'sand') {
        cTmp.copy(cSand);
      } else if (s.surfaceType === 'rock') {
        cTmp.copy(cRock).lerp(cGravel, Math.max(0, 1 - h / 22) * 0.35);
      } else {
        cTmp.copy(cGrass);
        if (h > 5.5) cTmp.lerp(cRock, Math.min(0.85, (h - 5.5) / 15));
      }

      col[idx * 3] = cTmp.r;
      col[idx * 3 + 1] = cTmp.g;
      col[idx * 3 + 2] = cTmp.b;
    }
  }

  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iz * (segs + 1) + ix;
      const b = a + 1;
      const c = a + (segs + 1);
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const terrGeo = new THREE.BufferGeometry();
  terrGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  terrGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  terrGeo.setIndex(indices);
  terrGeo.computeVertexNormals();
  const terrMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.04,
  });
  scene.add(new THREE.Mesh(terrGeo, terrMat));

  // Add subtle miniature props (pine silhouettes or highway streetlamp glow dots) for extra diorama depth
  let extraGeo: THREE.BufferGeometry | null = null;
  let extraMat: THREE.Material | null = null;
  if (mapId === 'proving-valley' || mapId === 'mountain-pass') {
    extraGeo = new THREE.ConeGeometry(2.6, 8.5, 6);
    extraGeo.translate(0, 4.2, 0);
    extraMat = new THREE.MeshStandardMaterial({
      color: mapId === 'proving-valley' ? 0x294c28 : 0x354d2d,
      roughness: 0.9,
    });
    const inst = new THREE.InstancedMesh(extraGeo, extraMat, 85);
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < 420 && placed < 85; i++) {
      const rx = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const rz = ((Math.sin(i * 78.233) * 43758.5453) % 1 + 1) % 1;
      const px = (rx * 2 - 1) * 225;
      const pz = (rz * 2 - 1) * 225;
      const surf = classifySurface(px, pz, 0.96);
      if (surf.surfaceType !== (mapId === 'proving-valley' ? 'grass' : 'rock')) continue;
      if (mapId === 'proving-valley' && Math.hypot(px, pz) < 62) continue;
      if (mapId === 'mountain-pass' && Math.abs(px - Math.sin(pz * 0.022) * 58) < 22) continue;
      dummy.position.set(px, getBaseTerrainHeight(px, pz) - 0.3, pz);
      dummy.scale.setScalar(0.8 + (i % 5) * 0.14);
      dummy.updateMatrix();
      inst.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    inst.count = placed;
    scene.add(inst);
  } else if (mapId === 'highway-circuit') {
    extraGeo = new THREE.SphereGeometry(1.4, 8, 8);
    extraMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const inst = new THREE.InstancedMesh(extraGeo, extraMat, 36);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let z = -170; z <= 170 && idx < 36; z += 40) {
      for (const lx of [-14.5, 14.5]) {
        if (idx >= 36) break;
        dummy.position.set(lx, getBaseTerrainHeight(lx, z) + 7.5, z);
        dummy.updateMatrix();
        inst.setMatrixAt(idx++, dummy.matrix);
      }
    }
    inst.count = idx;
    scene.add(inst);
  } else {
    extraGeo = new THREE.DodecahedronGeometry(3.2, 0);
    extraMat = new THREE.MeshStandardMaterial({ color: 0x9b704a, roughness: 0.92, flatShading: true });
    const inst = new THREE.InstancedMesh(extraGeo, extraMat, 45);
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < 160 && placed < 45; i++) {
      const rx = ((Math.sin(i * 19.31) * 43758.5453) % 1 + 1) % 1;
      const rz = ((Math.sin(i * 53.17) * 43758.5453) % 1 + 1) % 1;
      const px = (rx * 2 - 1) * 220;
      const pz = (rz * 2 - 1) * 220;
      if (Math.abs(px) < 22) continue;
      dummy.position.set(px, getBaseTerrainHeight(px, pz) - 0.8, pz);
      dummy.scale.set(1.2, 0.7, 1.1);
      dummy.updateMatrix();
      inst.setMatrixAt(placed++, dummy.matrix);
    }
    inst.count = placed;
    scene.add(inst);
  }

  // Elevated scenic panoramic camera per map
  const camera = new THREE.PerspectiveCamera(36, 600 / 380, 1, 1200);
  if (mapId === 'mountain-pass') {
    camera.position.set(145, 92, 195);
    camera.lookAt(-6, 14, -20);
  } else if (mapId === 'desert-baja') {
    camera.position.set(165, 86, 185);
    camera.lookAt(-12, 4, -8);
  } else if (mapId === 'highway-circuit') {
    camera.position.set(175, 94, 210);
    camera.lookAt(0, 2, -10);
  } else {
    camera.position.set(190, 118, 215);
    camera.lookAt(-10, 4, -10);
  }

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  mapPreviewCache.set(mapId, dataUrl);

  skyGeo.dispose();
  skyMat.dispose();
  terrGeo.dispose();
  terrMat.dispose();
  extraGeo?.dispose();
  extraMat?.dispose();
  setActiveTerrainMap(prevMap);

  return dataUrl;
}
