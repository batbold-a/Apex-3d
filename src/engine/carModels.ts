import * as THREE from 'three';
import { CarSpec, DamageTelemetry } from '../types/vehicle';

export interface CarVisualRig {
  root: THREE.Group;
  chassisGroup: THREE.Group;
  bodyPaintMat: THREE.MeshPhysicalMaterial;
  brakeLightMat: THREE.MeshStandardMaterial;
  reverseLightMat: THREE.MeshStandardMaterial;
  steeringWheelGroup: THREE.Group;
  shifterStick: THREE.Group;
  wheelPivots: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  wheelSpinGroups: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  springMeshes: [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh];
  damperRods: [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh];
  controlArms: [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D];
  contactShadow: THREE.Mesh;
  applyDeformation: (localPoint: THREE.Vector3, localNormal: THREE.Vector3, severity: number) => void;
  updateDamageVisuals: (damage: DamageTelemetry) => void;
  setNightMode: (isNight: boolean) => void;
  resetDeformation: () => void;
  dispose: () => void;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 26, 128, 128, 124);
  grad.addColorStop(0, 'rgba(0,0,0,0.82)');
  grad.addColorStop(0.58, 'rgba(0,0,0,0.46)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTireTreadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#181b21';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#090b0f';
  for (let x = 0; x < 256; x += 14) {
    ctx.fillRect(x, 0, 4, 52);
    ctx.fillRect(x + 7, 76, 4, 52);
  }
  ctx.fillRect(0, 26, 256, 4);
  ctx.fillRect(0, 61, 256, 6);
  ctx.fillRect(0, 98, 256, 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBrakeRotorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(0, 0, 256, 256);
  for (let r = 46; r < 122; r += 6) {
    ctx.strokeStyle = r % 12 === 0 ? '#64748b' : '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#1e293b';
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    for (const rr of [68, 88, 108]) {
      const px = 128 + Math.cos(ang + rr * 0.015) * rr;
      const py = 128 + Math.sin(ang + rr * 0.015) * rr;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLicensePlateTexture(text: string, accentHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, 28, 64);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 60);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 142, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createDashboardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#090d14';
  ctx.fillRect(0, 0, 256, 96);
  for (const cx of [74, 182]) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, 50, 32, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, 50, 32, Math.PI * 1.9, Math.PI * 2.25);
    ctx.stroke();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, 50);
    ctx.lineTo(cx - 18, 32);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createHelicalSpringGeometry(radius: number, height: number, turns: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const steps = turns * 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(angle) * radius, t * height, Math.sin(angle) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, steps, 0.017, 7, false);
}

// Realistic rounded-shoulder radial tire geometry via LatheGeometry (no flat cardboard drum edges)
function createRealisticTireGeometry(radius: number, width: number): THREE.BufferGeometry {
  const hw = width * 0.5;
  const rimR = radius * 0.66;
  const shoulderR = radius * 0.94;
  const bulgeX = hw * 1.045;
  const pts = [
    new THREE.Vector2(rimR, -hw * 0.86),
    new THREE.Vector2(rimR + (radius - rimR) * 0.35, -bulgeX),
    new THREE.Vector2(shoulderR, -hw * 0.96),
    new THREE.Vector2(radius, -hw * 0.74),
    new THREE.Vector2(radius, hw * 0.74),
    new THREE.Vector2(shoulderR, hw * 0.96),
    new THREE.Vector2(rimR + (radius - rimR) * 0.35, bulgeX),
    new THREE.Vector2(rimR, hw * 0.86),
  ];
  const geo = new THREE.LatheGeometry(pts, 36);
  geo.rotateZ(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// Sculpted wheel-arch fender flare eyebrow (flush against carved arch)
function createFenderFlareGeometry(
  outerR: number,
  innerR: number,
  depth: number,
  startAng = -0.06,
  endAng = Math.PI + 0.06
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, startAng, endAng, false);
  shape.absarc(0, 0, innerR, endAng, startAng, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.024,
    bevelSegments: 3,
    curveSegments: 22,
  });
  geo.translate(0, 0, -depth * 0.5);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

interface SideProfileSpec {
  sillY: number;
  noseTipY: number;
  hoodFrontY: number;
  hoodRearY: number;
  beltY: number;
  trunkRearY: number;
  rearBumperY: number;
  frontOverhang: number;
  rearOverhang: number;
  frontAxleZ: number;
  rearAxleZ: number;
  archRadius: number;
  archCenterY: number;
  hoodBevelZ: number;
  trunkZ: number;
  isFastback?: boolean;
  isSuvRear?: boolean;
}

// Extrudes a crisp, beveled 2D side silhouette (Z vs Y) along X with real carved wheel-arch cutouts!
function createSideSilhouetteGeometry(
  spec: SideProfileSpec,
  width: number,
  bevelSize = 0.05,
  bevelThickness = 0.08
): THREE.BufferGeometry {
  // Shape XY maps to (z, y) before rotating +90 deg around Y (so shape +X -> -Z or +Z carefully).
  // After rotateY(Math.PI / 2): local X' = +Z_shape, local Z' = -X_shape!
  // Let's draw shapeX = -worldZ (so front -Z is at +shapeX, rear +Z is at -shapeX), then rotateY(-Math.PI / 2):
  // rotateY(-PI/2): (x, y, z) -> (-z, y, x). Wait: let's verify!
  // Standard rotation around Y by +theta: x' = x cos + z sin, z' = -x sin + z cos.
  // For theta = -Math.PI/2 (cos=0, sin=-1): x' = -z, z' = +x!
  // So if we draw shapeX = worldZ and extrude along shapeZ in [-width/2, +width/2], then rotateY(-Math.PI/2):
  // worldX = -shapeZ (centered at 0!), worldY = shapeY, worldZ = shapeX!! Exact 1:1 mapping!
  const shape = new THREE.Shape();
  const zFront = spec.frontAxleZ - spec.frontOverhang;
  const zRear = spec.rearAxleZ + spec.rearOverhang;
  const r = spec.archRadius;
  const cy = spec.archCenterY;

  // Start at bottom of front bumper chin
  shape.moveTo(zFront + 0.08, spec.sillY + 0.04);
  // Front lower valance up to nose tip & hood front edge
  shape.lineTo(zFront, spec.noseTipY);
  shape.quadraticCurveTo(zFront + 0.03, spec.hoodFrontY, zFront + spec.hoodBevelZ, spec.hoodFrontY);
  // Hood line up to windshield cowl
  shape.lineTo(spec.hoodRearY > spec.hoodFrontY ? spec.frontAxleZ + 0.62 : spec.frontAxleZ + 0.55, spec.hoodRearY);
  // Beltline along doors to rear quarter / decklid
  shape.lineTo(spec.trunkZ, spec.beltY);
  if (spec.isSuvRear) {
    shape.lineTo(zRear - 0.05, spec.trunkRearY);
    shape.lineTo(zRear, spec.rearBumperY + 0.08);
  } else {
    shape.quadraticCurveTo(zRear - 0.14, spec.trunkRearY, zRear, spec.rearBumperY + 0.06);
  }
  shape.lineTo(zRear - 0.03, spec.sillY + 0.05);

  // Rear wheel-arch cutout (going backward -> forward around rear axle)
  const rearEndX = spec.rearAxleZ + r;
  const rearStartX = spec.rearAxleZ - r;
  shape.lineTo(rearEndX, spec.sillY);
  const archSpanY = Math.max(0.05, spec.sillY - cy);
  const startAng = Math.asin(Math.min(0.95, archSpanY / r));
  shape.absarc(spec.rearAxleZ, cy, r, startAng, Math.PI - startAng, false);
  shape.lineTo(rearStartX, spec.sillY);

  // Rocker sill between axles
  const frontEndX = spec.frontAxleZ + r;
  shape.lineTo(frontEndX, spec.sillY);

  // Front wheel-arch cutout
  shape.absarc(spec.frontAxleZ, cy, r, startAng, Math.PI - startAng, false);
  shape.lineTo(zFront + 0.08, spec.sillY + 0.04);

  const innerW = Math.max(0.1, width - bevelThickness * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerW,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 4,
    curveSegments: 18,
  });
  geo.translate(0, 0, -innerW * 0.5);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

// Creates a solid extruded cabin greenhouse shell (or glass core) following side profile (z, y)
function createCabinExtrusion(
  ptsZY: [number, number][],
  width: number,
  bevelSize = 0.035,
  bevelThickness = 0.06
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(ptsZY[0][0], ptsZY[0][1]);
  for (let i = 1; i < ptsZY.length; i++) {
    shape.lineTo(ptsZY[i][0], ptsZY[i][1]);
  }
  shape.closePath();

  const innerW = Math.max(0.1, width - bevelThickness * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerW,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geo.translate(0, 0, -innerW * 0.5);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

function createHeadlightPoolTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  for (const cx of [88, 168]) {
    const grad = ctx.createRadialGradient(cx, 240, 6, cx, 118, 150);
    grad.addColorStop(0, 'rgba(241, 248, 255, 0.88)');
    grad.addColorStop(0.35, 'rgba(219, 238, 255, 0.42)');
    grad.addColorStop(0.75, 'rgba(186, 220, 255, 0.12)');
    grad.addColorStop(1, 'rgba(186, 220, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - 18, 248);
    ctx.lineTo(cx - 88, 12);
    ctx.lineTo(cx + 88, 12);
    ctx.lineTo(cx + 18, 248);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCarVisualRig(
  car: CarSpec,
  initialColor?: string,
  options?: { enableSpotBeams?: boolean }
): CarVisualRig {
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  interface DeformableEntry {
    mesh: THREE.Mesh;
    restPos: Float32Array;
    restNormals: Float32Array;
  }
  const deformables: DeformableEntry[] = [];
  const registerDeformable = (mesh: THREE.Mesh): THREE.Mesh => {
    const pos = mesh.geometry.attributes.position;
    const norm = mesh.geometry.attributes.normal;
    deformables.push({
      mesh,
      restPos: new Float32Array(pos.array as Float32Array),
      restNormals: new Float32Array(norm.array as Float32Array),
    });
    return mesh;
  };

  const root = new THREE.Group();
  const chassisGroup = new THREE.Group();
  root.add(chassisGroup);

  const paintColor = initialColor ?? car.defaultColor;
  const isG63 = car.id === 'g63-4x4';
  const isDefender = car.id === 'defender-v8';

  // Automotive Clearcoat & Trim PBR Materials
  const bodyPaintMat = track(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(paintColor),
      metalness: 0.72,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      envMapIntensity: 1.45,
    })
  );

  const carbonMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x11151d,
      metalness: 0.35,
      roughness: 0.48,
    })
  );

  const glossBlackMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x0b0e14,
      metalness: 0.25,
      roughness: 0.15,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
    })
  );

  const trimMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1e2430,
      metalness: 0.38,
      roughness: 0.44,
    })
  );

  const chromeMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xe8edf5,
      metalness: 0.96,
      roughness: 0.1,
      envMapIntensity: 1.6,
    })
  );

  const amberMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.55,
      roughness: 0.2,
    })
  );

  // Dark automotive smoked glass with glossy sky reflections
  const glassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x09111c,
      metalness: 0.22,
      roughness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.72,
      envMapIntensity: 1.8,
    })
  );

  const headlightMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 2.4,
      roughness: 0.08,
    })
  );

  const drlMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xcffafe,
      emissiveIntensity: 2.8,
      roughness: 0.08,
    })
  );

  const brakeLightMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xef4444,
      emissiveIntensity: 0.7,
      roughness: 0.18,
    })
  );

  const reverseLightMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      emissive: 0xffffff,
      emissiveIntensity: 0.08,
      roughness: 0.15,
    })
  );

  const tireTex = track(createTireTreadTexture());
  const tireMat = track(
    new THREE.MeshStandardMaterial({
      map: tireTex,
      roughness: 0.86,
      metalness: 0.04,
    })
  );

  const rotorTex = track(createBrakeRotorTexture());
  const rotorMat = track(
    new THREE.MeshStandardMaterial({
      map: rotorTex,
      metalness: 0.88,
      roughness: 0.25,
    })
  );

  const rimMat = track(
    new THREE.MeshStandardMaterial({
      color: car.bodyStyle === 'rally' ? 0xd97706 : isG63 ? 0x111827 : 0xd4d8e0,
      metalness: 0.88,
      roughness: 0.18,
      envMapIntensity: 1.4,
    })
  );

  const caliperMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(car.caliperColor),
      metalness: 0.45,
      roughness: 0.26,
    })
  );

  const springMat = track(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(car.springColor),
      metalness: 0.55,
      roughness: 0.22,
    })
  );

  // Compute exact static wheel center Y so the body sits naturally over the tires (no monster-truck gap!)
  const staticSag = (car.massKg * 9.81) / 4 / car.springStiffness;
  const mountLocalY = car.suspensionRestLength * 0.35;
  const restWheelY = mountLocalY - (car.suspensionRestLength - staticSag);

  const halfL = car.length * 0.5;
  const halfW = car.width * 0.5;
  const hx = car.trackWidth * 0.5;
  const hz = car.wheelbase * 0.5;

  // Wheel arch cutout sits centered cleanly around static wheel center
  const archClearance = car.bodyStyle === 'suv' ? 0.14 : 0.085;
  const archInnerR = car.wheelRadius + archClearance;
  const archOuterR = archInnerR + (car.bodyStyle === 'suv' ? 0.105 : 0.08);
  const sillY = restWheelY + car.wheelRadius * (car.bodyStyle === 'suv' ? 0.22 : 0.08);

  // 1. Bespoke Extruded Side-Silhouette Bodywork with Real Carved Wheel-Arch Cutouts
  let bodyProfile: SideProfileSpec;
  let cabinPts: [number, number][] = [];
  let cabinWidth = car.width * 0.78;
  let greenhouseHeight = 0.48;
  let beltY = sillY + 0.56;

  if (car.bodyStyle === 'suv') {
    beltY = sillY + 0.66;
    greenhouseHeight = isG63 ? 0.62 : 0.58;
    const hoodH = sillY + 0.64;
    bodyProfile = {
      sillY,
      noseTipY: sillY + 0.22,
      hoodFrontY: hoodH - 0.05,
      hoodRearY: beltY + 0.02,
      beltY,
      trunkRearY: beltY,
      rearBumperY: sillY + 0.12,
      frontOverhang: halfL - hz,
      rearOverhang: halfL - hz,
      frontAxleZ: -hz,
      rearAxleZ: hz,
      archRadius: archInnerR,
      archCenterY: restWheelY + 0.02,
      hoodBevelZ: 0.14,
      trunkZ: halfL - 0.18,
      isSuvRear: true,
    };
    cabinWidth = car.width * 0.85;
    cabinPts = [
      [-0.86, beltY - 0.04],
      [-0.58, beltY + greenhouseHeight],
      [halfL - 0.24, beltY + greenhouseHeight],
      [halfL - 0.08, beltY - 0.04],
    ];
  } else if (car.bodyStyle === 'coupe') {
    // Porsche 911 GT3 RS: low sweeping front bumper, arched hood, muscular rear ducktail haunch
    beltY = sillY + 0.47;
    greenhouseHeight = 0.44;
    bodyProfile = {
      sillY,
      noseTipY: sillY + 0.16,
      hoodFrontY: sillY + 0.34,
      hoodRearY: beltY,
      beltY: beltY + 0.04,
      trunkRearY: beltY + 0.07,
      rearBumperY: sillY + 0.14,
      frontOverhang: halfL - hz,
      rearOverhang: halfL - hz,
      frontAxleZ: -hz,
      rearAxleZ: hz,
      archRadius: archInnerR,
      archCenterY: restWheelY + 0.02,
      hoodBevelZ: 0.32,
      trunkZ: halfL - 0.52,
    };
    cabinWidth = car.width * 0.74;
    cabinPts = [
      [-0.86, beltY - 0.04],
      [-0.26, beltY + greenhouseHeight],
      [0.42, beltY + greenhouseHeight - 0.02],
      [halfL - 0.32, beltY + 0.03],
      [halfL - 0.28, beltY - 0.06],
    ];
  } else if (car.bodyStyle === 'rally') {
    // Subaru WRX STI: 3-box rally sedan with aggressive nose and rear deck
    beltY = sillY + 0.52;
    greenhouseHeight = 0.48;
    bodyProfile = {
      sillY,
      noseTipY: sillY + 0.2,
      hoodFrontY: sillY + 0.44,
      hoodRearY: beltY,
      beltY,
      trunkRearY: beltY + 0.02,
      rearBumperY: sillY + 0.16,
      frontOverhang: halfL - hz,
      rearOverhang: halfL - hz,
      frontAxleZ: -hz,
      rearAxleZ: hz,
      archRadius: archInnerR,
      archCenterY: restWheelY + 0.02,
      hoodBevelZ: 0.2,
      trunkZ: halfL - 0.62,
    };
    cabinWidth = car.width * 0.77;
    cabinPts = [
      [-0.95, beltY - 0.04],
      [-0.44, beltY + greenhouseHeight],
      [0.62, beltY + greenhouseHeight],
      [1.26, beltY - 0.02],
    ];
  } else {
    // Shelby GT500: long aggressive muscle hood, fastback roofline, sculpted rear haunch
    beltY = sillY + 0.54;
    greenhouseHeight = 0.46;
    bodyProfile = {
      sillY,
      noseTipY: sillY + 0.22,
      hoodFrontY: sillY + 0.47,
      hoodRearY: beltY + 0.02,
      beltY: beltY + 0.03,
      trunkRearY: beltY + 0.04,
      rearBumperY: sillY + 0.16,
      frontOverhang: halfL - hz,
      rearOverhang: halfL - hz,
      frontAxleZ: -hz,
      rearAxleZ: hz,
      archRadius: archInnerR,
      archCenterY: restWheelY + 0.02,
      hoodBevelZ: 0.18,
      trunkZ: halfL - 0.58,
    };
    cabinWidth = car.width * 0.75;
    cabinPts = [
      [-0.64, beltY - 0.04],
      [-0.08, beltY + greenhouseHeight],
      [0.64, beltY + greenhouseHeight - 0.02],
      [halfL - 0.42, beltY + 0.02],
      [halfL - 0.36, beltY - 0.06],
    ];
  }

  // Main extruded body shell (carved wheel arches + chamfered automotive edges)
  const mainBodyGeo = track(
    createSideSilhouetteGeometry(
      bodyProfile,
      car.width * 0.94,
      car.bodyStyle === 'suv' ? 0.045 : 0.06,
      car.bodyStyle === 'suv' ? 0.07 : 0.09
    )
  );
  const mainBodyMesh = registerDeformable(new THREE.Mesh(mainBodyGeo, bodyPaintMat));
  mainBodyMesh.castShadow = true;
  mainBodyMesh.receiveShadow = true;
  chassisGroup.add(mainBodyMesh);

  // Dark inner wheel-well liners arched cleanly along X (around the tire, tucked inside fender flare)
  const linerGeo = track(
    new THREE.CylinderGeometry(archInnerR - 0.01, archInnerR - 0.01, 0.34, 20, 1, true, 0, Math.PI)
  );
  linerGeo.rotateZ(Math.PI / 2);
  const linerMat = track(
    new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.92, side: THREE.DoubleSide })
  );

  // Flared Painted / Trim Wheel-Arch Eyebrows seated cleanly around each carved arch
  const archFlareMat = isG63 ? bodyPaintMat : car.bodyStyle === 'suv' ? trimMat : bodyPaintMat;
  const archFlareGeo = track(
    createFenderFlareGeometry(
      archOuterR,
      archInnerR - 0.015,
      car.bodyStyle === 'suv' ? 0.13 : 0.09,
      0.04,
      Math.PI - 0.04
    )
  );

  for (const [ax, az, isRight] of [
    [-halfW + 0.01, -hz, false],
    [halfW - 0.01, -hz, true],
    [-halfW + 0.01, hz, false],
    [halfW - 0.01, hz, true],
  ] as [number, number, boolean][]) {
    const arch = registerDeformable(new THREE.Mesh(track(archFlareGeo.clone()), archFlareMat));
    arch.position.set(ax, bodyProfile.archCenterY, az);
    arch.castShadow = true;
    chassisGroup.add(arch);

    // Lower black mud-spat trim edge on G63/SUV arches (matching image_2887a908.png)
    if (isG63) {
      const lip = new THREE.Mesh(track(new THREE.BoxGeometry(0.11, 0.045, 0.14)), trimMat);
      lip.position.set(ax + (isRight ? 0.01 : -0.01), sillY + 0.01, az - archOuterR + 0.04);
      chassisGroup.add(lip);
    }

    const liner = new THREE.Mesh(linerGeo, linerMat);
    liner.position.set(ax + (isRight ? -0.23 : 0.23), bodyProfile.archCenterY, az);
    chassisGroup.add(liner);
  }

  // 2. Real Greenhouse: Dark Glossy Tinted Glass Core + Body-Painted A/B/C/D Pillars & Cambered Roof
  const glassCoreGeo = track(
    createCabinExtrusion(cabinPts, cabinWidth - 0.04, 0.025, 0.04)
  );
  const glassCoreMesh = new THREE.Mesh(glassCoreGeo, glassMat);
  glassCoreMesh.renderOrder = 2;
  chassisGroup.add(glassCoreMesh);

  // Solid painted roof panel + rain-rail trim sitting cleanly atop the greenhouse
  const roofTopY = beltY + greenhouseHeight + 0.015;
  const roofZStart = cabinPts[1][0];
  const roofZEnd = cabinPts[2][0];
  const roofLen = roofZEnd - roofZStart;
  const roofCenterZ = (roofZStart + roofZEnd) * 0.5;
  const roofMat = isDefender ? trimMat : bodyPaintMat;

  const roofCapPts: [number, number][] = [
    [roofZStart - 0.04, roofTopY - 0.045],
    [roofZStart + 0.04, roofTopY + 0.015],
    [roofZEnd - 0.04, roofTopY + 0.015],
    [roofZEnd + (car.bodyStyle === 'suv' ? 0.06 : 0.02), roofTopY - 0.045],
  ];
  const roofCapGeo = track(
    createCabinExtrusion(roofCapPts, cabinWidth + 0.02, 0.02, 0.045)
  );
  const roofCapMesh = registerDeformable(new THREE.Mesh(roofCapGeo, roofMat));
  roofCapMesh.castShadow = true;
  chassisGroup.add(roofCapMesh);

  // Build crisp painted A, B, C, (and D) pillars + window frame dividers on both sides!
  const addPillar = (xSide: number, zBot: number, yBot: number, zTop: number, yTop: number, thickZ: number, mat: THREE.Material) => {
    const dz = zTop - zBot;
    const dy = yTop - yBot;
    const len = Math.hypot(dz, dy);
    const pGeo = track(new THREE.BoxGeometry(0.055, len + 0.04, thickZ));
    const pMesh = new THREE.Mesh(pGeo, mat);
    pMesh.position.set(xSide, (yBot + yTop) * 0.5, (zBot + zTop) * 0.5);
    pMesh.rotation.x = Math.atan2(dz, dy);
    pMesh.castShadow = true;
    chassisGroup.add(pMesh);
  };

  const pillarX = cabinWidth * 0.5 - 0.015;
  for (const sign of [-1, 1]) {
    const px = sign * pillarX;
    // Front A-Pillar (body paint)
    addPillar(px, cabinPts[0][0] + 0.03, beltY - 0.01, cabinPts[1][0] + 0.02, roofTopY - 0.02, 0.085, bodyPaintMat);
    // B-Pillar (gloss black automotive window trim)
    addPillar(px, 0.02, beltY - 0.01, 0.05, roofTopY - 0.02, 0.1, glossBlackMat);

    if (car.bodyStyle === 'suv') {
      // C-Pillar (body paint, separating rear door & cargo quarter window just like image_2887a908.png!)
      addPillar(px, 0.92, beltY - 0.01, 0.94, roofTopY - 0.02, 0.11, isG63 ? bodyPaintMat : glossBlackMat);
      // D-Pillar (solid rear corner pillar)
      addPillar(px, cabinPts[3][0] - 0.06, beltY - 0.01, cabinPts[2][0] - 0.04, roofTopY - 0.02, 0.16, bodyPaintMat);
    } else {
      // Coupe/Sedan C-Pillar
      const cBotZ = cabinPts[cabinPts.length - 1][0] - 0.06;
      addPillar(px, cBotZ, beltY - 0.01, cabinPts[2][0] - 0.03, roofTopY - 0.02, 0.15, bodyPaintMat);
    }

    // Black upper & lower window beltline weather-strip trim
    const topStrip = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.03, 0.025, roofLen + 0.04)),
      glossBlackMat
    );
    topStrip.position.set(px + sign * 0.01, roofTopY - 0.045, roofCenterZ);
    chassisGroup.add(topStrip);

    const botStrip = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.035, 0.03, cabinPts[cabinPts.length - 1][0] - cabinPts[0][0] - 0.08)),
      glossBlackMat
    );
    botStrip.position.set(
      px + sign * 0.012,
      beltY + 0.005,
      (cabinPts[0][0] + cabinPts[cabinPts.length - 1][0]) * 0.5
    );
    chassisGroup.add(botStrip);
  }

  // Shark-fin antenna (non-G63)
  if (!isG63) {
    const fin = new THREE.Mesh(track(new THREE.ConeGeometry(0.032, 0.11, 8)), glossBlackMat);
    fin.position.set(0, roofTopY + 0.05, roofZEnd - 0.16);
    fin.rotation.x = -0.35;
    chassisGroup.add(fin);
  }

  // 3. Door Shutlines, Handles, Side Rub-Strips & Running Boards / Side Skirts
  const sideX = car.width * 0.475;
  for (const sign of [-1, 1]) {
    const sx = sign * sideX;

    if (car.bodyStyle === 'suv') {
      // Running boards / Side-step boards with silver trim lip (signature G63 / Defender feature!)
      const stepBoard = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.16, 0.055, car.wheelbase - archInnerR * 2.05)),
        trimMat
      );
      stepBoard.position.set(sign * (halfW - 0.04), sillY + 0.025, 0);
      stepBoard.castShadow = true;
      chassisGroup.add(stepBoard);

      const stepChrome = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.025, 0.025, car.wheelbase - archInnerR * 2.1)),
        chromeMat
      );
      stepChrome.position.set(sign * (halfW + 0.035), sillY + 0.025, 0);
      chassisGroup.add(stepChrome);

      // Horizontal protective black body rub-strip with silver accent (matching image_2887a908.png!)
      const rubLen = car.length * 0.72;
      const rubStrip = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.035, 0.045, rubLen)),
        glossBlackMat
      );
      rubStrip.position.set(sx + sign * 0.005, beltY - 0.14, 0.06);
      chassisGroup.add(rubStrip);

      // Front fender amber/silver reflector marker
      const marker = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.036, 0.025, 0.24)),
        amberMat
      );
      marker.position.set(sx + sign * 0.008, beltY - 0.14, -hz + 0.12);
      chassisGroup.add(marker);

      // Front & Rear Door Handles
      for (const hzDoor of [-0.08, 0.82]) {
        const handle = new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.032, 0.16)), glossBlackMat);
        handle.position.set(sx + sign * 0.015, beltY - 0.075, hzDoor);
        chassisGroup.add(handle);
      }

      // Vertical door panel shutline grooves
      for (const szDoor of [-0.74, 0.04, 0.94]) {
        const seam = new THREE.Mesh(
          track(new THREE.BoxGeometry(0.012, beltY - sillY - 0.12, 0.012)),
          carbonMat
        );
        seam.position.set(sx - sign * 0.004, (beltY + sillY) * 0.5 + 0.02, szDoor);
        chassisGroup.add(seam);
      }
    } else {
      // Carbon side skirts for coupe/rally/muscle
      const skirt = registerDeformable(
        new THREE.Mesh(
          track(new THREE.BoxGeometry(0.11, 0.06, car.wheelbase - archInnerR * 2.02)),
          carbonMat
        )
      );
      skirt.position.set(sign * (halfW - 0.05), sillY + 0.02, 0);
      chassisGroup.add(skirt);

      const handle = new THREE.Mesh(track(new THREE.BoxGeometry(0.035, 0.028, 0.16)), chromeMat);
      handle.position.set(sx + sign * 0.01, beltY - 0.08, 0.28);
      chassisGroup.add(handle);

      // Side brake cooling duct / fender vent
      const vent = new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.14, 0.24)), carbonMat);
      vent.position.set(sx, sillY + 0.28, -hz + archInnerR + 0.24);
      chassisGroup.add(vent);
    }
  }

  // 4. Front Grille, Intercooler, Splitter, Bumper & Rear Diffuser
  const frontZ = -halfL;
  const rearZ = halfL;

  if (car.bodyStyle !== 'suv') {
    const splitter = registerDeformable(
      new THREE.Mesh(
        track(new THREE.BoxGeometry(car.width * 0.92, 0.045, 0.26)),
        carbonMat
      )
    );
    splitter.position.set(0, sillY + 0.03, frontZ + 0.05);
    splitter.castShadow = true;
    chassisGroup.add(splitter);
  } else {
    // Rugged front bumper + skid guard
    const frontBumper = registerDeformable(
      new THREE.Mesh(
        track(new THREE.BoxGeometry(car.width * 0.92, 0.18, 0.22)),
        isG63 ? bodyPaintMat : trimMat
      )
    );
    frontBumper.position.set(0, sillY + 0.15, frontZ + 0.04);
    frontBumper.castShadow = true;
    chassisGroup.add(frontBumper);
  }

  // Front Intake Grille + Vertical Panamericana Bars (G63) or Honeycomb Slats
  const grilleY = isG63 ? sillY + 0.44 : car.bodyStyle === 'suv' ? sillY + 0.44 : sillY + 0.18;
  const grilleW = isG63 ? car.width * 0.46 : car.width * 0.56;
  const grilleH = isG63 ? 0.28 : car.bodyStyle === 'suv' ? 0.24 : 0.16;

  const grilleBacking = new THREE.Mesh(
    track(new THREE.BoxGeometry(grilleW, grilleH, 0.06)),
    glossBlackMat
  );
  grilleBacking.position.set(0, grilleY, frontZ + 0.02);
  chassisGroup.add(grilleBacking);

  if (isG63) {
    // Chrome AMG vertical Panamericana slats + iconic center star ring
    for (let vx = -grilleW * 0.42; vx <= grilleW * 0.42; vx += 0.075) {
      const vBar = new THREE.Mesh(track(new THREE.BoxGeometry(0.016, grilleH - 0.03, 0.075)), chromeMat);
      vBar.position.set(vx, grilleY, frontZ + 0.015);
      chassisGroup.add(vBar);
    }
    const ring = new THREE.Mesh(track(new THREE.TorusGeometry(0.085, 0.014, 8, 22)), chromeMat);
    ring.position.set(0, grilleY, frontZ - 0.025);
    chassisGroup.add(ring);
  } else {
    for (const barOff of [-0.045, 0, 0.045]) {
      const slat = new THREE.Mesh(
        track(new THREE.BoxGeometry(grilleW - 0.06, 0.016, 0.075)),
        car.bodyStyle === 'suv' ? trimMat : carbonMat
      );
      slat.position.set(0, grilleY + barOff, frontZ + 0.015);
      chassisGroup.add(slat);
    }
  }

  // Lower metallic intercooler core
  const intercooler = new THREE.Mesh(
    track(new THREE.BoxGeometry(car.width * 0.44, 0.11, 0.05)),
    chromeMat
  );
  intercooler.position.set(0, sillY + 0.11, frontZ + 0.06);
  chassisGroup.add(intercooler);

  // Rear Diffuser + Underbody Floorpan + Rear Muffler
  const diffuserY = sillY + (car.bodyStyle === 'suv' ? 0.14 : 0.08);
  const rearDiffuser = registerDeformable(
    new THREE.Mesh(track(new THREE.BoxGeometry(car.width * 0.78, 0.12, 0.2)), carbonMat)
  );
  rearDiffuser.position.set(0, diffuserY, rearZ - 0.04);
  chassisGroup.add(rearDiffuser);

  for (const fx of [-0.36, -0.12, 0.12, 0.36]) {
    const finMesh = new THREE.Mesh(track(new THREE.BoxGeometry(0.024, 0.12, 0.22)), trimMat);
    finMesh.position.set(fx, diffuserY - 0.01, rearZ - 0.03);
    chassisGroup.add(finMesh);
  }

  const underbody = new THREE.Mesh(
    track(new THREE.BoxGeometry(car.width * 0.72, 0.045, car.length * 0.8)),
    carbonMat
  );
  underbody.position.set(0, sillY + 0.02, 0);
  chassisGroup.add(underbody);

  // Windshield Wipers
  const wiperY = beltY + 0.02;
  const wiperZ = cabinPts[0][0] + 0.04;
  for (const wx of [-0.28, 0.18]) {
    const wiper = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.016, 0.02)), carbonMat);
    wiper.position.set(wx, wiperY, wiperZ);
    wiper.rotation.y = 0.22;
    wiper.rotation.z = 0.08;
    chassisGroup.add(wiper);
  }

  // Rear License Plate
  const plateCode =
    car.bodyStyle === 'coupe'
      ? 'GT3-911'
      : car.bodyStyle === 'rally'
        ? 'WRX-STI'
        : isG63
          ? 'AMG-G63'
          : isDefender
            ? 'DEF-110'
            : 'GT-500';
  const plateTex = track(createLicensePlateTexture(plateCode, car.defaultColor));
  const plateMat = track(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4 }));
  const plateMesh = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.12, 0.025)), plateMat);
  plateMesh.position.set(0, sillY + (car.bodyStyle === 'suv' ? 0.26 : 0.26), rearZ + 0.015);
  chassisGroup.add(plateMesh);

  // 5. Car-Specific Exterior Signatures
  if (isG63) {
    // G63 4x4²: Signature steel bull-bar brush guard + hood-top turn signal pods + twin chrome side-exit exhausts!
    const bullBar = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.28, 0.024, 8, 18, Math.PI)),
      glossBlackMat
    );
    bullBar.position.set(0, grilleY - 0.08, frontZ - 0.07);
    chassisGroup.add(bullBar);
    for (const bx of [-0.28, 0.28]) {
      const upright = new THREE.Mesh(track(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8)), glossBlackMat);
      upright.position.set(bx, grilleY - 0.16, frontZ - 0.07);
      chassisGroup.add(upright);
    }

    // Iconic G-Wagon hood-top turn-signal indicator pods!
    for (const tx of [-halfW * 0.72, halfW * 0.72]) {
      const podBase = new THREE.Mesh(track(new THREE.BoxGeometry(0.075, 0.055, 0.16)), glossBlackMat);
      podBase.position.set(tx, beltY + 0.02, frontZ + 0.34);
      chassisGroup.add(podBase);
      const podLens = new THREE.Mesh(track(new THREE.BoxGeometry(0.065, 0.038, 0.07)), amberMat);
      podLens.position.set(tx, beltY + 0.032, frontZ + 0.29);
      chassisGroup.add(podLens);
    }

    // Twin chrome side-exit AMG exhaust pipes tucked neatly beneath rear doors (matching image_2887a908.png!)
    for (const sign of [-1, 1]) {
      for (const ez of [0.38, 0.54]) {
        const sidePipe = new THREE.Mesh(track(new THREE.CylinderGeometry(0.034, 0.036, 0.16, 12)), chromeMat);
        sidePipe.rotation.z = Math.PI / 2;
        sidePipe.position.set(sign * (halfW - 0.04), sillY - 0.03, ez);
        chassisGroup.add(sidePipe);
      }
    }

    // Rear-mounted Spare Tire Carrier with body-painted ring cover
    const spareGroup = new THREE.Group();
    spareGroup.position.set(0, beltY - 0.04, rearZ + 0.12);
    const spareTire = new THREE.Mesh(
      track(new THREE.CylinderGeometry(car.wheelRadius * 0.76, car.wheelRadius * 0.76, 0.22, 24)),
      glossBlackMat
    );
    spareTire.rotation.x = Math.PI / 2;
    spareTire.castShadow = true;
    spareGroup.add(spareTire);
    const spareCover = new THREE.Mesh(
      track(new THREE.CylinderGeometry(car.wheelRadius * 0.66, car.wheelRadius * 0.66, 0.24, 24)),
      bodyPaintMat
    );
    spareCover.rotation.x = Math.PI / 2;
    spareGroup.add(spareCover);
    chassisGroup.add(spareGroup);
  } else if (isDefender) {
    // Land Rover Defender 110: Expedition Roof Rack + Orange Recovery Boards + LED Bar + Side Snorkel + Exposed Rear Spare
    const rack = new THREE.Mesh(track(new THREE.BoxGeometry(cabinWidth * 0.9, 0.05, 2.05)), glossBlackMat);
    rack.position.set(0, roofTopY + 0.045, roofCenterZ + 0.1);
    chassisGroup.add(rack);
    for (const cz of [-0.3, 0.25, 0.8, 1.35]) {
      const bar = new THREE.Mesh(track(new THREE.BoxGeometry(cabinWidth * 0.92, 0.03, 0.06)), trimMat);
      bar.position.set(0, roofTopY + 0.075, cz);
      chassisGroup.add(bar);
    }
    for (const bx of [-0.32, 0.32]) {
      const board = new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.035, 0.88)), caliperMat);
      board.position.set(bx, roofTopY + 0.095, 0.75);
      chassisGroup.add(board);
    }
    const roofLedBar = new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.065, 0.075)), drlMat);
    roofLedBar.position.set(0, roofTopY + 0.07, roofZStart - 0.04);
    chassisGroup.add(roofLedBar);

    const snorkel = new THREE.Mesh(track(new THREE.BoxGeometry(0.085, 0.68, 0.1)), glossBlackMat);
    snorkel.position.set(halfW + 0.01, beltY + 0.22, -0.82);
    chassisGroup.add(snorkel);

    const spareGroup = new THREE.Group();
    spareGroup.position.set(0, beltY - 0.05, rearZ + 0.11);
    const spareTire = new THREE.Mesh(
      track(new THREE.CylinderGeometry(car.wheelRadius * 0.78, car.wheelRadius * 0.78, 0.22, 24)),
      tireMat
    );
    spareTire.rotation.x = Math.PI / 2;
    spareTire.castShadow = true;
    spareGroup.add(spareTire);
    const spareRim = new THREE.Mesh(
      track(new THREE.CylinderGeometry(car.wheelRadius * 0.5, car.wheelRadius * 0.5, 0.23, 18)),
      rimMat
    );
    spareRim.rotation.x = Math.PI / 2;
    spareGroup.add(spareRim);
    chassisGroup.add(spareGroup);
  } else if (car.bodyStyle === 'coupe') {
    // 911 GT3 RS: Swan-neck carbon wing + endplates + hood NACA ducts + front bumper canards + rear light bar
    const wingBlade = new THREE.Mesh(
      track(new THREE.BoxGeometry(car.width * 0.98, 0.035, 0.32)),
      carbonMat
    );
    wingBlade.position.set(0, roofTopY + 0.02, rearZ - 0.18);
    wingBlade.rotation.x = 0.09;
    wingBlade.castShadow = true;
    chassisGroup.add(wingBlade);

    for (const sx of [-car.width * 0.49, car.width * 0.49]) {
      const ep = new THREE.Mesh(track(new THREE.BoxGeometry(0.028, 0.2, 0.38)), carbonMat);
      ep.position.set(sx, roofTopY, rearZ - 0.18);
      chassisGroup.add(ep);
    }
    for (const sx of [-0.36, 0.36]) {
      const pylon = new THREE.Mesh(track(new THREE.BoxGeometry(0.032, 0.38, 0.11)), carbonMat);
      pylon.position.set(sx, (beltY + roofTopY) * 0.5 + 0.04, rearZ - 0.22);
      pylon.rotation.x = 0.14;
      chassisGroup.add(pylon);
    }
    for (const vx of [-0.26, 0.26]) {
      const vent = new THREE.Mesh(track(new THREE.BoxGeometry(0.2, 0.024, 0.34)), carbonMat);
      vent.position.set(vx, beltY - 0.05, frontZ + 0.72);
      vent.rotation.x = 0.12;
      chassisGroup.add(vent);
    }
    for (const cx of [-halfW * 0.94, halfW * 0.94]) {
      const canard = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.02, 0.22)), carbonMat);
      canard.position.set(cx, sillY + 0.14, frontZ + 0.26);
      canard.rotation.z = cx < 0 ? 0.22 : -0.22;
      chassisGroup.add(canard);
    }
    const lightBar = new THREE.Mesh(
      track(new THREE.BoxGeometry(car.width * 0.82, 0.032, 0.03)),
      brakeLightMat
    );
    lightBar.position.set(0, beltY - 0.06, rearZ - 0.005);
    chassisGroup.add(lightBar);
  } else if (car.bodyStyle === 'rally') {
    // WRX STI: Raised hood scoop + large rally fog lights + 4 mudflaps + tall WRC wing
    const scoop = new THREE.Mesh(track(new THREE.BoxGeometry(0.56, 0.095, 0.44)), bodyPaintMat);
    scoop.position.set(0, beltY - 0.01, frontZ + 0.92);
    chassisGroup.add(scoop);

    const scoopIntake = new THREE.Mesh(track(new THREE.BoxGeometry(0.46, 0.06, 0.05)), glossBlackMat);
    scoopIntake.position.set(0, beltY - 0.01, frontZ + 0.7);
    chassisGroup.add(scoopIntake);

    for (const fx of [-halfW * 0.62, halfW * 0.62]) {
      const fog = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16)), drlMat);
      fog.rotation.x = Math.PI / 2;
      fog.position.set(fx, sillY + 0.13, frontZ + 0.02);
      chassisGroup.add(fog);
    }
    for (const [mx, mz] of [
      [-hx, -hz + archInnerR + 0.02],
      [hx, -hz + archInnerR + 0.02],
      [-hx, hz + archInnerR + 0.02],
      [hx, hz + archInnerR + 0.02],
    ]) {
      const flap = new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.22, 0.024)), caliperMat);
      flap.position.set(mx, sillY - 0.04, mz);
      chassisGroup.add(flap);
    }
    const wing = new THREE.Mesh(track(new THREE.BoxGeometry(car.width * 0.86, 0.045, 0.25)), bodyPaintMat);
    wing.position.set(0, beltY + 0.34, rearZ - 0.18);
    wing.castShadow = true;
    chassisGroup.add(wing);
    for (const sx of [-0.54, 0.54]) {
      const ep = new THREE.Mesh(track(new THREE.BoxGeometry(0.038, 0.32, 0.27)), bodyPaintMat);
      ep.position.set(sx, beltY + 0.19, rearZ - 0.18);
      chassisGroup.add(ep);
    }
  } else {
    // Shelby GT500: Twin white racing stripes + Cobra hood heat extractor + carbon track wing
    const stripeMat = track(
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2, metalness: 0.18 })
    );
    for (const sx of [-0.18, 0.18]) {
      const hoodStripe = new THREE.Mesh(track(new THREE.BoxGeometry(0.21, 0.015, 1.48)), stripeMat);
      hoodStripe.position.set(sx, beltY - 0.02, frontZ + 0.96);
      hoodStripe.rotation.x = 0.05;
      chassisGroup.add(hoodStripe);

      const roofStripe = new THREE.Mesh(track(new THREE.BoxGeometry(0.21, 0.018, roofLen)), stripeMat);
      roofStripe.position.set(sx, roofTopY + 0.02, roofCenterZ);
      chassisGroup.add(roofStripe);
    }
    const hoodVent = new THREE.Mesh(track(new THREE.BoxGeometry(0.6, 0.03, 0.38)), carbonMat);
    hoodVent.position.set(0, beltY, frontZ + 1.08);
    chassisGroup.add(hoodVent);

    const wing = new THREE.Mesh(track(new THREE.BoxGeometry(car.width * 0.88, 0.042, 0.24)), carbonMat);
    wing.position.set(0, beltY + 0.24, rearZ - 0.14);
    wing.castShadow = true;
    chassisGroup.add(wing);
    for (const sx of [-0.46, 0.46]) {
      const stand = new THREE.Mesh(track(new THREE.BoxGeometry(0.038, 0.18, 0.15)), carbonMat);
      stand.position.set(sx, beltY + 0.13, rearZ - 0.15);
      chassisGroup.add(stand);
    }
  }

  // 6. Sculpted Recessed Headlights & Taillights
  const hlY = isG63 ? grilleY : car.bodyStyle === 'suv' ? grilleY + 0.04 : sillY + 0.32;
  const blY = car.bodyStyle === 'suv' ? sillY + 0.34 : beltY - 0.12;
  for (const sx of [-halfW * 0.68, halfW * 0.68]) {
    const hlPod = new THREE.Mesh(
      track(new THREE.BoxGeometry(0.28, isG63 ? 0.22 : 0.12, 0.06)),
      glossBlackMat
    );
    hlPod.position.set(sx, hlY, frontZ + 0.02);
    chassisGroup.add(hlPod);

    const hlLens = new THREE.Mesh(
      track(new THREE.CylinderGeometry(isG63 ? 0.075 : 0.048, isG63 ? 0.075 : 0.048, 0.07, 16)),
      headlightMat
    );
    hlLens.rotation.x = Math.PI / 2;
    hlLens.position.set(sx, hlY, frontZ + 0.012);
    chassisGroup.add(hlLens);

    if (isG63) {
      const halo = new THREE.Mesh(track(new THREE.TorusGeometry(0.088, 0.011, 6, 20)), drlMat);
      halo.position.set(sx, hlY, frontZ - 0.018);
      chassisGroup.add(halo);
    } else {
      const drl = new THREE.Mesh(track(new THREE.BoxGeometry(0.24, 0.022, 0.04)), drlMat);
      drl.position.set(sx, hlY - 0.045, frontZ + 0.005);
      chassisGroup.add(drl);
    }

    if (car.bodyStyle === 'muscle') {
      for (const offset of [-0.085, 0, 0.085]) {
        const bar = new THREE.Mesh(track(new THREE.BoxGeometry(0.045, 0.13, 0.04)), brakeLightMat);
        bar.position.set(sx + offset, blY, rearZ - 0.005);
        chassisGroup.add(bar);
      }
    } else {
      const bl = new THREE.Mesh(track(new THREE.BoxGeometry(0.28, 0.068, 0.04)), brakeLightMat);
      bl.position.set(sx, blY, rearZ - 0.005);
      chassisGroup.add(bl);
    }

    const rl = new THREE.Mesh(track(new THREE.BoxGeometry(0.11, 0.036, 0.04)), reverseLightMat);
    rl.position.set(sx * 0.72, blY - 0.08, rearZ - 0.005);
    chassisGroup.add(rl);
  }

  // Real Headlight SpotLight Beams + Subtle Ground Beam Pool (active in Night mode)
  const spotBeams: THREE.SpotLight[] = [];
  let headlightPoolMesh: THREE.Mesh | null = null;
  let headlightPoolMat: THREE.MeshBasicMaterial | null = null;
  let isNightActive = false;
  let frontDamageFactor = 1.0;

  if (options?.enableSpotBeams) {
    for (const sx of [-halfW * 0.64, halfW * 0.64]) {
      const spot = track(
        new THREE.SpotLight(0xf1f6ff, 0, 105, Math.PI * 0.24, 0.68, 1.15)
      );
      spot.castShadow = false;
      spot.position.set(sx, hlY, frontZ - 0.06);
      spot.target.position.set(sx * 0.75, Math.max(-0.6, hlY - 1.55), frontZ - 34);
      chassisGroup.add(spot);
      chassisGroup.add(spot.target);
      spotBeams.push(spot);
    }

    const poolTex = track(createHeadlightPoolTexture());
    headlightPoolMat = track(
      new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    );
    headlightPoolMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(7.6, 22)), headlightPoolMat);
    headlightPoolMesh.rotation.x = -Math.PI / 2;
    headlightPoolMesh.position.set(0, 0.06, frontZ - 11.2);
    headlightPoolMesh.visible = false;
    root.add(headlightPoolMesh);
  }

  // Rear Chrome Exhaust Tips (non-G63)
  if (!isG63) {
    const exY = diffuserY - 0.01;
    const exOffsets = car.bodyStyle === 'coupe' ? [-0.1, 0.1] : [-0.54, -0.42, 0.42, 0.54];
    const exGeo = track(new THREE.CylinderGeometry(0.044, 0.048, 0.16, 14, 1, true));
    exGeo.rotateX(Math.PI / 2);
    for (const exX of exOffsets) {
      const ex = new THREE.Mesh(exGeo, chromeMat);
      ex.position.set(exX, exY, rearZ + 0.02);
      chassisGroup.add(ex);
    }
  }

  // Sculpted Side Mirrors (body-painted cap + black stalk + turn signal strip)
  const sideMirrors: THREE.Group[] = [];
  for (const sx of [-halfW - 0.03, halfW + 0.03]) {
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(sx, beltY + 0.08, cabinPts[0][0] + 0.12);
    const stalk = new THREE.Mesh(track(new THREE.BoxGeometry(0.09, 0.03, 0.05)), glossBlackMat);
    stalk.position.set(sx < 0 ? 0.04 : -0.04, -0.02, 0);
    mirrorGroup.add(stalk);
    const cap = new THREE.Mesh(track(new THREE.BoxGeometry(0.15, 0.09, 0.11)), bodyPaintMat);
    cap.castShadow = true;
    mirrorGroup.add(cap);
    chassisGroup.add(mirrorGroup);
    sideMirrors.push(mirrorGroup);
  }

  // 7. Interior Cockpit (Visible through tinted windows & cockpit camera)
  const dashY = beltY - 0.02;
  const dashMesh = new THREE.Mesh(
    track(new THREE.BoxGeometry(cabinWidth * 0.86, 0.2, 0.36)),
    trimMat
  );
  dashMesh.position.set(0, dashY, -0.58);
  chassisGroup.add(dashMesh);

  const gaugeTex = track(createDashboardTexture());
  const gaugeScreen = new THREE.Mesh(
    track(new THREE.PlaneGeometry(0.32, 0.11)),
    track(new THREE.MeshBasicMaterial({ map: gaugeTex }))
  );
  gaugeScreen.position.set(-0.34, dashY + 0.06, -0.395);
  chassisGroup.add(gaugeScreen);

  for (const seatX of [-0.34, 0.34]) {
    const seatBack = new THREE.Mesh(track(new THREE.BoxGeometry(0.36, 0.54, 0.11)), trimMat);
    seatBack.position.set(seatX, dashY + 0.05, 0.24);
    seatBack.rotation.x = 0.18;
    chassisGroup.add(seatBack);
  }

  const consoleMesh = new THREE.Mesh(track(new THREE.BoxGeometry(0.22, 0.18, 0.82)), trimMat);
  consoleMesh.position.set(0, dashY - 0.1, -0.15);
  chassisGroup.add(consoleMesh);

  const shifterStick = new THREE.Group();
  shifterStick.position.set(0, dashY - 0.01, -0.22);
  const stalk = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.014, 0.16, 8)), chromeMat);
  stalk.position.y = 0.08;
  shifterStick.add(stalk);
  const knob = new THREE.Mesh(track(new THREE.SphereGeometry(0.032, 10, 10)), caliperMat);
  knob.position.y = 0.16;
  shifterStick.add(knob);
  chassisGroup.add(shifterStick);

  const steeringWheelGroup = new THREE.Group();
  steeringWheelGroup.position.set(-0.34, dashY + 0.09, -0.35);
  steeringWheelGroup.rotation.x = -0.3;
  steeringWheelGroup.add(
    new THREE.Mesh(track(new THREE.TorusGeometry(0.155, 0.02, 10, 26)), carbonMat)
  );
  steeringWheelGroup.add(new THREE.Mesh(track(new THREE.BoxGeometry(0.29, 0.028, 0.02)), chromeMat));
  const spokeV = new THREE.Mesh(track(new THREE.BoxGeometry(0.032, 0.15, 0.02)), chromeMat);
  spokeV.position.y = -0.075;
  steeringWheelGroup.add(spokeV);
  const topStripe = new THREE.Mesh(track(new THREE.BoxGeometry(0.024, 0.044, 0.044)), caliperMat);
  topStripe.position.y = 0.155;
  steeringWheelGroup.add(topStripe);
  chassisGroup.add(steeringWheelGroup);

  // 8. Articulated 4-Corner Suspension + LatheGeometry Radial Tires + Machined-Lip Alloy Wheels
  const springTopY = mountLocalY + 0.14;
  const springNaturalLen = car.suspensionRestLength * 0.92;
  const springGeo = track(createHelicalSpringGeometry(0.072, springNaturalLen, 8));
  const damperGeo = track(new THREE.CylinderGeometry(0.026, 0.026, springNaturalLen, 10));
  damperGeo.translate(0, springNaturalLen * 0.5, 0);
  const armLegGeo = track(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 8));
  armLegGeo.rotateZ(Math.PI / 2);

  const tireGeo = track(createRealisticTireGeometry(car.wheelRadius, car.wheelWidth));
  const rimOuterR = car.wheelRadius * 0.67;

  const rimLipGeo = track(new THREE.TorusGeometry(rimOuterR * 0.98, 0.016, 10, 32));
  rimLipGeo.rotateY(Math.PI / 2);

  const barrelGeo = track(
    new THREE.CylinderGeometry(rimOuterR, rimOuterR, car.wheelWidth * 0.84, 28)
  );
  barrelGeo.rotateZ(Math.PI / 2);

  const discGeo = track(
    new THREE.CylinderGeometry(car.wheelRadius * 0.54, car.wheelRadius * 0.54, 0.032, 24)
  );
  discGeo.rotateZ(Math.PI / 2);

  const centerCapGeo = track(
    new THREE.CylinderGeometry(car.wheelRadius * 0.18, car.wheelRadius * 0.18, 0.045, 18)
  );
  centerCapGeo.rotateZ(Math.PI / 2);

  const wheelCoords: [number, number, boolean][] = [
    [-hx, -hz, false],
    [hx, -hz, true],
    [-hx, hz, false],
    [hx, hz, true],
  ];

  const wheelPivots: THREE.Group[] = [];
  const wheelSpinGroups: THREE.Group[] = [];
  const springMeshes: THREE.Mesh[] = [];
  const damperRods: THREE.Mesh[] = [];
  const controlArms: THREE.Object3D[] = [];

  for (let i = 0; i < 4; i++) {
    const [wx, wz, isRight] = wheelCoords[i];
    const strutX = wx + (isRight ? -0.11 : 0.11);
    const outSign = isRight ? 1 : -1;

    const springMesh = new THREE.Mesh(springGeo, springMat);
    springMesh.position.set(strutX, springTopY, wz);
    springMesh.rotation.x = Math.PI;
    chassisGroup.add(springMesh);
    springMeshes.push(springMesh);

    const damperMesh = new THREE.Mesh(damperGeo, chromeMat);
    damperMesh.position.set(strutX, springTopY, wz);
    damperMesh.rotation.x = Math.PI;
    chassisGroup.add(damperMesh);
    damperRods.push(damperMesh);

    const topCap = new THREE.Mesh(track(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 12)), trimMat);
    topCap.position.set(strutX, springTopY + 0.015, wz);
    chassisGroup.add(topCap);

    const armGroup = new THREE.Group();
    armGroup.position.set(wx + (isRight ? -0.18 : 0.18), 0, wz);
    const armFront = new THREE.Mesh(armLegGeo, trimMat);
    armFront.position.z = -0.09;
    armFront.rotation.y = isRight ? 0.38 : -0.38;
    const armRear = new THREE.Mesh(armLegGeo, trimMat);
    armRear.position.z = 0.09;
    armRear.rotation.y = isRight ? -0.38 : 0.38;
    armGroup.add(armFront);
    armGroup.add(armRear);
    root.add(armGroup);
    controlArms.push(armGroup);

    const pivot = new THREE.Group();
    pivot.position.set(wx, 0, wz);
    root.add(pivot);
    wheelPivots.push(pivot);

    const knuckle = new THREE.Mesh(track(new THREE.BoxGeometry(0.07, 0.2, 0.12)), trimMat);
    knuckle.position.set(isRight ? -0.09 : 0.09, 0.04, 0);
    pivot.add(knuckle);

    const caliperMesh = new THREE.Mesh(track(new THREE.BoxGeometry(0.08, 0.16, 0.11)), caliperMat);
    caliperMesh.position.set(isRight ? -0.04 : 0.04, 0.03, 0.14);
    pivot.add(caliperMesh);

    const spinGroup = new THREE.Group();
    pivot.add(spinGroup);
    wheelSpinGroups.push(spinGroup);

    const tireMesh = new THREE.Mesh(tireGeo, tireMat);
    tireMesh.castShadow = true;
    tireMesh.receiveShadow = true;
    spinGroup.add(tireMesh);

    // Dark recessed wheel barrel + brake rotor
    spinGroup.add(new THREE.Mesh(barrelGeo, carbonMat));
    spinGroup.add(new THREE.Mesh(discGeo, rotorMat));

    const outerFaceX = outSign * (car.wheelWidth * 0.43);

    // Machined silver outer rim flange lip (matches G63 AMG monoblock & sport wheels!)
    const rimLip = new THREE.Mesh(rimLipGeo, chromeMat);
    rimLip.position.x = outerFaceX;
    spinGroup.add(rimLip);

    // Center hub cap + chrome emblem ring
    const hubCap = new THREE.Mesh(centerCapGeo, isG63 ? glossBlackMat : caliperMat);
    hubCap.position.x = outerFaceX - outSign * 0.005;
    spinGroup.add(hubCap);

    if (isG63) {
      // Signature G63 AMG 6-spoke satin-black monoblock aero-dish face + machined center emblem
      const dish = new THREE.Mesh(
        track(new THREE.CylinderGeometry(rimOuterR * 0.92, rimOuterR * 0.92, 0.03, 28)),
        glossBlackMat
      );
      dish.rotation.z = Math.PI / 2;
      dish.position.x = outerFaceX - outSign * 0.015;
      spinGroup.add(dish);

      const spokeBarGeo = track(new THREE.BoxGeometry(0.035, rimOuterR * 1.75, 0.095));
      for (let s = 0; s < 3; s++) {
        const bar = new THREE.Mesh(spokeBarGeo, rimMat);
        bar.position.x = outerFaceX;
        bar.rotation.x = (s * Math.PI) / 3;
        spinGroup.add(bar);
      }

      const starRing = new THREE.Mesh(track(new THREE.TorusGeometry(car.wheelRadius * 0.14, 0.01, 6, 16)), chromeMat);
      starRing.rotation.y = Math.PI / 2;
      starRing.position.x = outerFaceX + outSign * 0.018;
      spinGroup.add(starRing);
    } else {
      // Split-Y or multi-spoke motorsport alloy design + 5 chrome lug bolts
      const numSpokes = car.bodyStyle === 'rally' || car.bodyStyle === 'coupe' ? 10 : 5;
      const spokeGeo = track(
        new THREE.BoxGeometry(0.04, rimOuterR * 0.92, numSpokes === 10 ? 0.028 : 0.045)
      );
      for (let s = 0; s < numSpokes; s++) {
        const ang = (s * Math.PI * 2) / numSpokes;
        const sp = new THREE.Mesh(spokeGeo, rimMat);
        sp.position.set(
          outerFaceX,
          Math.cos(ang) * rimOuterR * 0.48,
          Math.sin(ang) * rimOuterR * 0.48
        );
        sp.rotation.x = -ang;
        spinGroup.add(sp);
      }
      for (let s = 0; s < 5; s++) {
        const lugAng = (s * Math.PI * 2) / 5;
        const lug = new THREE.Mesh(track(new THREE.CylinderGeometry(0.011, 0.011, 0.025, 6)), chromeMat);
        lug.rotation.z = Math.PI / 2;
        lug.position.set(
          outerFaceX + outSign * 0.015,
          Math.cos(lugAng) * car.wheelRadius * 0.13,
          Math.sin(lugAng) * car.wheelRadius * 0.13
        );
        spinGroup.add(lug);
      }
    }
  }

  // 9. Grounded Contact Shadow
  const shadowTex = track(createContactShadowTexture());
  const shadowMat = track(
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
    })
  );
  const contactShadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(car.width * 1.44, car.length * 1.24)),
    shadowMat
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.02;
  root.add(contactShadow);

  const applyDeformation = (
    localPoint: THREE.Vector3,
    localNormal: THREE.Vector3,
    severity: number
  ) => {
    const sev = Math.max(0.08, Math.min(1, severity));
    const impactRadius = 0.72 + sev * 0.92;
    const maxDent = 0.09 + sev * 0.34;
    const maxTotalDisp = 0.42;

    for (let m = 0; m < deformables.length; m++) {
      const entry = deformables[m];
      const posAttr = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const rest = entry.restPos;
      const ox = entry.mesh.position.x;
      const oy = entry.mesh.position.y;
      const oz = entry.mesh.position.z;

      let modified = false;
      for (let i = 0; i < arr.length; i += 3) {
        const vx = arr[i] + ox;
        const vy = arr[i + 1] + oy;
        const vz = arr[i + 2] + oz;

        const dx = vx - localPoint.x;
        const dy = vy - localPoint.y;
        const dz = vz - localPoint.z;
        const dist = Math.hypot(dx, dy, dz);

        if (dist < impactRadius) {
          modified = true;
          const falloff = Math.pow(1 - dist / impactRadius, 1.55);
          const crinkle = Math.sin(vx * 13.7 + vy * 19.3 + vz * 11.1) * 0.032 * sev * falloff;
          const push = maxDent * falloff;

          let nx = arr[i] + localNormal.x * push + crinkle * 0.6;
          let ny = arr[i + 1] + localNormal.y * push + Math.abs(crinkle) * 0.75;
          let nz = arr[i + 2] + localNormal.z * push + crinkle * 0.6;

          const rx = nx - rest[i];
          const ry = ny - rest[i + 1];
          const rz = nz - rest[i + 2];
          const disp = Math.hypot(rx, ry, rz);
          if (disp > maxTotalDisp) {
            const s = maxTotalDisp / disp;
            nx = rest[i] + rx * s;
            ny = rest[i + 1] + ry * s;
            nz = rest[i + 2] + rz * s;
          }

          arr[i] = nx;
          arr[i + 1] = ny;
          arr[i + 2] = nz;
        }
      }

      if (modified) {
        posAttr.needsUpdate = true;
        entry.mesh.geometry.computeVertexNormals();
      }
    }
  };

  const syncLightIntensities = () => {
    const hlMult = (isNightActive ? 5.6 : 2.3) * frontDamageFactor;
    const drlMult = (isNightActive ? 4.4 : 2.7) * frontDamageFactor;
    headlightMat.emissiveIntensity = hlMult;
    drlMat.emissiveIntensity = drlMult;

    const beamIntensity = isNightActive ? 34 * frontDamageFactor : 0;
    for (let i = 0; i < spotBeams.length; i++) {
      spotBeams[i].intensity = beamIntensity;
    }
    if (headlightPoolMesh && headlightPoolMat) {
      headlightPoolMesh.visible = isNightActive && frontDamageFactor > 0.15;
      headlightPoolMat.opacity = isNightActive ? 0.24 * frontDamageFactor : 0;
    }
  };

  const setNightMode = (isNight: boolean) => {
    isNightActive = isNight;
    syncLightIntensities();
  };

  const updateDamageVisuals = (damage: DamageTelemetry) => {
    frontDamageFactor = Math.max(0.12, 1 - damage.front * 0.92);
    syncLightIntensities();

    if (sideMirrors[0]) {
      sideMirrors[0].rotation.z = damage.left * 0.85;
      sideMirrors[0].rotation.y = -damage.left * 0.55;
      sideMirrors[0].visible = damage.left < 0.9;
    }
    if (sideMirrors[1]) {
      sideMirrors[1].rotation.z = -damage.right * 0.85;
      sideMirrors[1].rotation.y = damage.right * 0.55;
      sideMirrors[1].visible = damage.right < 0.9;
    }

    for (let i = 0; i < 4; i++) {
      const dmg = 1 - damage.suspensionHealth[i] / 100;
      const sideSign = i === 0 || i === 2 ? 1 : -1;
      wheelPivots[i].rotation.z = sideSign * dmg * 0.24;
    }
  };

  const resetDeformation = () => {
    for (let m = 0; m < deformables.length; m++) {
      const entry = deformables[m];
      const posAttr = entry.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const normAttr = entry.mesh.geometry.attributes.normal as THREE.BufferAttribute;
      (posAttr.array as Float32Array).set(entry.restPos);
      (normAttr.array as Float32Array).set(entry.restNormals);
      posAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
    }
    frontDamageFactor = 1.0;
    syncLightIntensities();
    for (const mirror of sideMirrors) {
      mirror.rotation.set(0, 0, 0);
      mirror.visible = true;
    }
    for (let i = 0; i < 4; i++) {
      wheelPivots[i].rotation.z = 0;
    }
  };

  return {
    root,
    chassisGroup,
    bodyPaintMat,
    brakeLightMat,
    reverseLightMat,
    steeringWheelGroup,
    shifterStick,
    wheelPivots: wheelPivots as [THREE.Group, THREE.Group, THREE.Group, THREE.Group],
    wheelSpinGroups: wheelSpinGroups as [THREE.Group, THREE.Group, THREE.Group, THREE.Group],
    springMeshes: springMeshes as [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh],
    damperRods: damperRods as [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh],
    controlArms: controlArms as [THREE.Object3D, THREE.Object3D, THREE.Object3D, THREE.Object3D],
    contactShadow,
    applyDeformation,
    updateDamageVisuals,
    setNightMode,
    resetDeformation,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
