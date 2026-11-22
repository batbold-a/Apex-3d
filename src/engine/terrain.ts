import { MapId, SurfaceType } from '../types/vehicle';

export interface TerrainSample {
  height: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  surfaceType: SurfaceType;
  surfaceName: string;
  grip: number;
  rollingResistance: number;
  roughness: number;
  zoneName: string;
}

export const WORLD_HALF_SIZE = 1150;
export const PLAYABLE_LIMIT = 900;

export interface RockBump {
  x: number;
  z: number;
  radius: number;
  height: number;
}

const ROCK_CELL_SIZE = 12;
let activeMapId: MapId = 'proving-valley';
let rockGrid: Map<number, RockBump[]> = new Map();

function rockCellKey(cx: number, cz: number): number {
  return ((cx + 512) << 12) | ((cz + 512) & 0xfff);
}

export function setActiveRockBumps(bumps: RockBump[]): void {
  rockGrid.clear();
  for (let i = 0; i < bumps.length; i++) {
    const b = bumps[i];
    const minCx = Math.floor((b.x - b.radius) / ROCK_CELL_SIZE);
    const maxCx = Math.floor((b.x + b.radius) / ROCK_CELL_SIZE);
    const minCz = Math.floor((b.z - b.radius) / ROCK_CELL_SIZE);
    const maxCz = Math.floor((b.z + b.radius) / ROCK_CELL_SIZE);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = rockCellKey(cx, cz);
        let list = rockGrid.get(key);
        if (!list) {
          list = [];
          rockGrid.set(key, list);
        }
        list.push(b);
      }
    }
  }
}

function sampleRockBumpHeight(x: number, z: number): number {
  if (rockGrid.size === 0) return 0;
  const cx = Math.floor(x / ROCK_CELL_SIZE);
  const cz = Math.floor(z / ROCK_CELL_SIZE);
  const list = rockGrid.get(rockCellKey(cx, cz));
  if (!list) return 0;
  let extra = 0;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const dx = x - b.x;
    const dz = z - b.z;
    const d2 = dx * dx + dz * dz;
    const r2 = b.radius * b.radius;
    if (d2 < r2) {
      const t = 1 - d2 / r2;
      // Ellipsoid-like dome profile matches DodecahedronGeometry stone shoulders so tires climb cleanly
      const h = b.height * Math.pow(t, 0.58);
      if (h > extra) extra = h;
    }
  }
  return extra;
}

export function setActiveTerrainMap(mapId: MapId): void {
  activeMapId = mapId;
  rockGrid.clear();
}

export function getActiveTerrainMap(): MapId {
  return activeMapId;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Signed distance to a rounded rectangle centered at (0,0) with half-extents (hx, hz) and corner radius r
function sdRoundedBox(px: number, pz: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(px) - hx + r;
  const qz = Math.abs(pz) - hz + r;
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  const inDist = Math.min(Math.max(qx, qz), 0);
  return outDist + inDist - r;
}

function distanceToCircuit(x: number, z: number): number {
  return Math.abs(sdRoundedBox(x, z, 210, 210, 75));
}

function distanceToStraight(x: number, z: number): number {
  const dx = Math.abs(x);
  const dz = Math.max(0, Math.abs(z) - 210);
  return Math.hypot(dx, dz);
}

function distanceToHub(x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x) - 46);
  const dz = Math.max(0, Math.abs(z) - 46);
  return Math.hypot(dx, dz);
}

// Mountain Pass winding climb road distance helper
export function mountainRoadCenterX(z: number): number {
  return Math.sin(z * 0.022) * 58;
}

export const BAJA_WASH_POINTS: readonly [number, number][] = [
  [0, 238],
  [0, 130],
  [0, 0],
  [0, -120],
  [0, -245],
];

export const BAJA_EAST_LOOP_POINTS: readonly [number, number][] = [
  [0, -245],
  [72, -262],
  [162, -206],
  [208, -92],
  [212, 45],
  [166, 178],
  [76, 244],
  [0, 238],
];

export const BAJA_WEST_LOOP_POINTS: readonly [number, number][] = [
  [0, -245],
  [-64, -242],
  [-152, -172],
  [-178, -45],
  [-168, 96],
  [-116, 202],
  [-56, 238],
  [0, 238],
];

export const BAJA_WHOOPS_CONNECTOR_POINTS: readonly [number, number][] = [
  [0, 126],
  [-56, 114],
  [-60, 60],
  [-60, -85],
  [-54, -142],
  [0, -168],
];

export const PROVING_HILL_TRAIL_POINTS: readonly [number, number][] = [
  [-44, -44],
  [-66, -66],
  [-88, -88],
  [-104, -108],
  [-116, -124],
  [-122, -148],
  [-116, -176],
  [-115, -210],
];

export const PROVING_HILL_WEST_SPUR_POINTS: readonly [number, number][] = [
  [-116, -124],
  [-145, -125],
  [-178, -125],
  [-210, -125],
];

export const PROVING_WEST_CONNECTOR_POINTS: readonly [number, number][] = [
  [-210, 0],
  [-156, 0],
];

export const PROVING_EAST_CONNECTOR_POINTS: readonly [number, number][] = [
  [162, 0],
  [210, 0],
];

export const PROVING_NE_SKIDPAD_CENTER: readonly [number, number] = [120, -120];
export const PROVING_NE_SKIDPAD_RADIUS = 44;

export const PROVING_NE_CONNECTOR_WEST: readonly [number, number][] = [
  [0, -120],
  [80, -120],
];

export const PROVING_NE_CONNECTOR_NORTH: readonly [number, number][] = [
  [120, -160],
  [120, -210],
];

export const PROVING_NE_CONNECTOR_SOUTH: readonly [number, number][] = [
  [120, -80],
  [120, -48],
];

export const PROVING_NE_CONNECTOR_HUB: readonly [number, number][] = [
  [44, -44],
  [72, -72],
  [92, -92],
];

export const PROVING_SE_RALLY_POINTS: readonly [number, number][] = [
  [0, 122],
  [54, 114],
  [106, 92],
  [148, 116],
  [142, 162],
  [98, 178],
  [88, 210],
];

export const PROVING_SE_DUNES_LINK_POINTS: readonly [number, number][] = [
  [116, 50],
  [110, 92],
];

export const PROVING_SE_EAST_SPUR_POINTS: readonly [number, number][] = [
  [147, 134],
  [210, 134],
];

export const PROVING_SW_TRAIL_POINTS: readonly [number, number][] = [
  [0, 122],
  [-56, 112],
  [-105, 86],
  [-152, 114],
  [-146, 164],
  [-104, 178],
  [-95, 210],
];

export const PROVING_SW_BADROAD_LINK_POINTS: readonly [number, number][] = [
  [-105, 42],
  [-105, 86],
];

export const PROVING_SW_WEST_SPUR_POINTS: readonly [number, number][] = [
  [-150, 120],
  [-210, 120],
];

function distToSegmentSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-6) return wx * wx + wz * wz;
  let t = (wx * vx + wz * vz) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + t * vx);
  const dz = pz - (az + t * vz);
  return dx * dx + dz * dz;
}

function distToPolyline(px: number, pz: number, pts: readonly [number, number][]): number {
  let minSq = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const dSq = distToSegmentSq(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

export function distanceToBajaTrail(x: number, z: number): number {
  const dWash = Math.abs(x) <= 26 && z >= -255 && z <= 248 ? Math.abs(x) : distToPolyline(x, z, BAJA_WASH_POINTS);
  const dEast = distToPolyline(x, z, BAJA_EAST_LOOP_POINTS);
  const dWest = distToPolyline(x, z, BAJA_WEST_LOOP_POINTS);
  const dWhoops = distToPolyline(x, z, BAJA_WHOOPS_CONNECTOR_POINTS);
  return Math.min(dWash, dEast, dWest, dWhoops);
}

export function getTerrainHeightRaw(x: number, z: number): number {
  return getBaseTerrainHeight(x, z) + sampleRockBumpHeight(x, z);
}

export function getBaseTerrainHeight(x: number, z: number): number {
  let h = 0;

  if (activeMapId === 'proving-valley') {
    const naturalWave =
      Math.sin(x * 0.025) * Math.cos(z * 0.025) * 1.4 +
      Math.sin(x * 0.06 + z * 0.04) * 0.45;

    const dCircuit = distanceToCircuit(x, z);
    const dStraight = distanceToStraight(x, z);
    const dHub = distanceToHub(x, z);

    const dSkidpad = Math.hypot(
      x - PROVING_NE_SKIDPAD_CENTER[0],
      z - PROVING_NE_SKIDPAD_CENTER[1]
    );
    const dWestConn = distToPolyline(x, z, PROVING_WEST_CONNECTOR_POINTS);
    const dEastConn = distToPolyline(x, z, PROVING_EAST_CONNECTOR_POINTS);
    const dNeWest = distToPolyline(x, z, PROVING_NE_CONNECTOR_WEST);
    const dNeNorth = distToPolyline(x, z, PROVING_NE_CONNECTOR_NORTH);
    const dNeSouth = distToPolyline(x, z, PROVING_NE_CONNECTOR_SOUTH);
    const dNeHub = distToPolyline(x, z, PROVING_NE_CONNECTOR_HUB);
    const dAsphaltConn = Math.min(dWestConn, dEastConn, dNeWest, dNeNorth, dNeSouth, dNeHub);

    const dSeRally = Math.min(
      distToPolyline(x, z, PROVING_SE_RALLY_POINTS),
      distToPolyline(x, z, PROVING_SE_DUNES_LINK_POINTS),
      distToPolyline(x, z, PROVING_SE_EAST_SPUR_POINTS)
    );
    const dSwTrail = Math.min(
      distToPolyline(x, z, PROVING_SW_TRAIL_POINTS),
      distToPolyline(x, z, PROVING_SW_BADROAD_LINK_POINTS),
      distToPolyline(x, z, PROVING_SW_WEST_SPUR_POINTS)
    );
    const dGravelConn = Math.min(dSeRally, dSwTrail);

    const roadMask = Math.min(
      smoothstep(10, 22, dCircuit),
      smoothstep(10, 22, dStraight),
      smoothstep(4, 18, dHub),
      smoothstep(PROVING_NE_SKIDPAD_RADIUS, PROVING_NE_SKIDPAD_RADIUS + 14, dSkidpad),
      smoothstep(8.5, 19, dAsphaltConn),
      0.24 + 0.76 * smoothstep(7.5, 18, dGravelConn)
    );

    h += naturalWave * roadMask;

    // Suspension & Bad-Road Proving Strip (West Zone)
    if (x >= -160 && x <= -48 && z >= -46 && z <= 46) {
      const fadeX = smoothstep(-160, -148, x) * (1 - smoothstep(-58, -48, x));
      const fadeZ = smoothstep(-46, -38, z) * (1 - smoothstep(38, 46, z));
      const mask = fadeX * fadeZ;

      if (z < -12) {
        const laneMask = mask * (1 - smoothstep(-18, -12, z));
        const bumpPhase = (x + 150) * 0.68;
        const speedBumps = Math.pow(Math.max(0, Math.sin(bumpPhase)), 4) * 0.32;
        const washboard = Math.sin(x * 2.1) * 0.05;
        h = h * (1 - laneMask) + (speedBumps + washboard) * laneMask;
      } else if (z <= 14) {
        const laneMask = mask * smoothstep(-15, -10, z) * (1 - smoothstep(10, 15, z));
        const mogul =
          Math.sin(x * 0.48) * Math.sin(z * 0.55) * 0.44 +
          Math.cos(x * 0.95 + z * 0.8) * 0.12;
        h = h * (1 - laneMask) + mogul * laneMask;
      } else {
        const laneMask = mask * smoothstep(12, 18, z);
        const cobble =
          Math.sin(x * 2.6) * Math.cos(z * 2.4) * 0.08 +
          Math.sin(x * 0.55 + 1.2) * Math.cos(z * 0.6) * 0.2;
        h = h * (1 - laneMask) + cobble * laneMask;
      }
    }

    // Stunt Ramp & Sand Dunes Park (East Zone)
    if (x >= 48 && x <= 170 && z >= -56 && z <= 56) {
      const fadeX = smoothstep(48, 58, x) * (1 - smoothstep(158, 170, x));
      const fadeZ = smoothstep(-56, -46, z) * (1 - smoothstep(46, 56, z));
      const dunesConnFade = Math.min(smoothstep(5, 16, dEastConn), smoothstep(5, 16, dNeSouth));
      const mask = fadeX * fadeZ * dunesConnFade;
      const dunes = Math.sin(x * 0.09) * Math.cos(z * 0.08) * 1.25;
      h = h * (1 - mask * 0.85) + dunes * mask * 0.85;

      if (x >= 70 && x <= 94 && z >= -30 && z <= -8) {
        const rz = smoothstep(-30, -26, z) * (1 - smoothstep(-12, -8, z));
        if (x <= 86) {
          const t = smoothstep(70, 86, x);
          h += t * t * 2.4 * rz;
        } else {
          const drop = 1 - smoothstep(86, 89, x);
          h += 2.4 * drop * rz;
        }
      }
      if (x >= 103 && x <= 132 && z >= 6 && z <= 30) {
        const rz = smoothstep(6, 10, z) * (1 - smoothstep(26, 30, z));
        if (x <= 122) {
          const t = smoothstep(103, 122, x);
          h += t * t * 3.4 * rz;
        } else {
          const drop = 1 - smoothstep(122, 125.5, x);
          h += 3.4 * drop * rz;
        }
      }
    }

    // Mountain Hill Climb (NW Sector — continuous climb + summit + north/west descent exits)
    if (x >= -206 && x <= -40 && z >= -206 && z <= -46) {
      const cx = -115;
      const cz = -125;
      const dist = Math.hypot((x - cx) / 68, (z - cz) / 62);
      if (dist < 1.18) {
        const hillMask = 1 - smoothstep(0.18, 1.18, dist);
        const mountainBase = hillMask * 21.5;
        const dHillTrail = Math.min(
          distToPolyline(x, z, PROVING_HILL_TRAIL_POINTS),
          distToPolyline(x, z, PROVING_HILL_WEST_SPUR_POINTS)
        );
        const trailSmooth = smoothstep(3.5, 10.5, dHillTrail);
        const rockyNoise =
          (Math.sin(x * 0.35 + z * 0.25) * 0.28 +
            Math.cos(x * 0.72 - z * 0.65) * 0.14) *
          smoothstep(0.95, 0.25, dist) *
          (0.18 + 0.82 * trailSmooth);
        h += mountainBase + rockyNoise;
      }
    }
  } else if (activeMapId === 'mountain-pass') {
    // Redrock Mountain Ascent: climbs smoothly from south valley (z=+150, h=0) to north summit (z=-170, h=28m)
    const climbT = smoothstep(125, -155, z);
    const roadX = mountainRoadCenterX(z);
    const distFromTrail = Math.abs(x - roadX);
    const onTrailMask = 1 - smoothstep(11, 24, distFromTrail);

    // Base slope
    h = climbT * 27.5;

    // Cross-axle rocky articulation ruts & creek wash on off-trail slopes & rock crawl sections
    const valleySlope =
      Math.min(26, Math.pow(Math.max(0, (distFromTrail - 12) / 58), 1.35) * 11) +
      Math.sin(x * 0.045) * Math.cos(z * 0.045) * 3.5;

    // Articulation rock ledges across trail around z in [10..60] and [-100..-50]
    const ledgeZone =
      smoothstep(75, 55, z) * (1 - smoothstep(10, -5, z)) +
      smoothstep(-45, -60, z) * (1 - smoothstep(-105, -120, z));
    const articulationRuts =
      (Math.sin(x * 0.55) * Math.sin(z * 0.42) * 0.42 +
        Math.cos(x * 0.9 - z * 0.7) * 0.14) *
      ledgeZone *
      smoothstep(130, 110, z);

    // Flat summit lookout plateau at z < -155
    const summitFlat = smoothstep(-145, -168, z);
    h += valleySlope * (1 - onTrailMask) * (1 - summitFlat * 0.7) + articulationRuts;

    // Flat spawn apron around (0, 145)
    const spawnDist = Math.hypot(x, z - 145);
    const spawnFlat = 1 - smoothstep(12, 26, spawnDist);
    h *= 1 - spawnFlat;
  } else if (activeMapId === 'desert-baja') {
    // Baja Canyon & Dunes: high-speed desert wash + Grand East/West Desert Trail Loops + whoops & twin jumps
    const dWash = Math.abs(x);
    const washFlatten = z >= -260 && z <= 250 ? smoothstep(10, 26, dWash) : 1;
    const dLoopTrail = Math.min(
      distToPolyline(x, z, BAJA_EAST_LOOP_POINTS),
      distToPolyline(x, z, BAJA_WEST_LOOP_POINTS),
      distToPolyline(x, z, BAJA_WHOOPS_CONNECTOR_POINTS)
    );
    // Keep gentle rolling elevation along outer loops (28% of full dune amplitude) while grading out harsh cross-ridges
    const trailFlatten = 0.28 + 0.72 * smoothstep(9, 24, dLoopTrail);
    const dunes =
      (Math.sin(x * 0.042) * Math.cos(z * 0.038) * 4.2 +
        Math.sin((x - z) * 0.075) * 1.65) *
      washFlatten *
      trailFlatten;
    h += dunes;

    // Rhythm suspension whoops along west dune trail (x in [-85, -35], z in [-110, 90])
    if (x >= -90 && x <= -30 && z >= -115 && z <= 95) {
      const m =
        smoothstep(-90, -78, x) *
        (1 - smoothstep(-42, -30, x)) *
        smoothstep(-115, -100, z) *
        (1 - smoothstep(80, 95, z));
      h += Math.sin(z * 0.52) * 0.52 * m;
    }

    // Twin Desert Mega Launch Ramps along center desert wash (facing North -Z)
    if (Math.abs(x) <= 10 && z >= 20 && z <= 58) {
      const rx = 1 - smoothstep(6, 10, Math.abs(x));
      if (z >= 28) {
        const t = 1 - smoothstep(28, 56, z);
        h += t * t * 3.6 * rx;
      } else {
        const drop = smoothstep(22, 28, z);
        h += 3.6 * drop * rx;
      }
    }
    if (Math.abs(x) <= 11 && z >= -95 && z <= -52) {
      const rx = 1 - smoothstep(7, 11, Math.abs(x));
      if (z >= -86) {
        const t = 1 - smoothstep(-86, -54, z);
        h += t * t * 4.5 * rx;
      } else {
        const drop = smoothstep(-94, -86, z);
        h += 4.5 * drop * rx;
      }
    }

    // Smooth spawn plateau at (0, 130)
    const spawnDist = Math.hypot(x, z - 130);
    h *= smoothstep(14, 30, spawnDist);
  } else if (activeMapId === 'testing-facility') {
    // Vehicle Testing Facility: ultra-flat calibrated arena + east Suspension Rebound / Bump Rig
    h = 0;

    // Suspension Rebound / Speed-Bump Calibration Rig (x in [90, 130], z in [-90, 90])
    if (x >= 90 && x <= 130 && z >= -90 && z <= 90) {
      const rx = smoothstep(90, 94, x) * (1 - smoothstep(126, 130, x));
      if (z >= -65 && z <= -15) {
        const rz = smoothstep(-65, -60, z) * (1 - smoothstep(-20, -15, z));
        const bump = Math.pow(Math.max(0, Math.sin((z + 60) * 0.44)), 3) * 0.26;
        h += bump * rx * rz;
      } else if (z >= 20 && z <= 65) {
        // Calibrated 0.28m step drop plateau
        const stepUp = smoothstep(20, 24, z) * (1 - smoothstep(56, 60, z));
        h += 0.28 * stepUp * rx;
      }
    }
  } else {
    // Midnight Coast Highway: wide outer speedway oval + central 4-lane speed straight + twin coastal jumps
    const dCircuit = distanceToCircuit(x, z);
    const dStraight = distanceToStraight(x, z);
    const roadMask = Math.min(smoothstep(13, 28, dCircuit), smoothstep(13, 28, dStraight));

    // Gentle banked coastal cliffs outside the asphalt
    const coastalWave =
      Math.sin(x * 0.022) * Math.cos(z * 0.022) * 2.8 +
      Math.min(18, Math.max(0, (x - 110) * 0.06)) +
      Math.sin(x * 0.014 + z * 0.012) * 2.2;
    h += coastalWave * roadMask;

    // Gentle speed crest at z in [-55, -25] on east side bypass (x in [85, 115])
    if (x >= 82 && x <= 118 && z >= -55 && z <= -15) {
      const m = smoothstep(82, 90, x) * (1 - smoothstep(110, 118, x));
      const rampT = 1 - smoothstep(-48, -18, z);
      if (z >= -48) {
        h += rampT * rampT * 2.2 * m;
      } else {
        h += 2.2 * smoothstep(-54, -48, z) * m;
      }
    }
  }

  // Outer Natural Mountain Perimeter (matches expanded 1.8km playable boundary)
  const radial = Math.max(Math.abs(x), Math.abs(z));
  if (radial > 880) {
    const rim = smoothstep(880, 1130, radial);
    const ridgeNoise =
      26 +
      Math.sin(x * 0.03) * 8 +
      Math.cos(z * 0.035) * 8 +
      Math.sin((x + z) * 0.06) * 4;
    h += rim * rim * ridgeNoise;
  }

  return h;
}

export function classifySurface(
  x: number,
  z: number,
  slopeY: number
): {
  surfaceType: SurfaceType;
  surfaceName: string;
  grip: number;
  rollingResistance: number;
  roughness: number;
  zoneName: string;
} {
  if (activeMapId === 'proving-valley') {
    const dCircuit = distanceToCircuit(x, z);
    const dStraight = distanceToStraight(x, z);
    const dHub = distanceToHub(x, z);

    if (dCircuit < 10.5 || dStraight < 10.5 || dHub < 2.5) {
      const zone =
        dHub < 2.5
          ? 'Proving Ground Hub'
          : dStraight < 10.5
            ? 'High-Speed Straight'
            : 'Grand Asphalt Circuit';
      return {
        surfaceType: 'asphalt',
        surfaceName: 'Smooth Asphalt',
        grip: 1.08,
        rollingResistance: 0.011,
        roughness: 0.04,
        zoneName: zone,
      };
    }

    if (x >= -158 && x <= -50 && z >= -44 && z <= 44) {
      if (z < -12) {
        return {
          surfaceType: 'cobble',
          surfaceName: 'Speed-Bump & Washboard',
          grip: 0.84,
          rollingResistance: 0.036,
          roughness: 0.68,
          zoneName: 'Suspension Test Strip',
        };
      }
      if (z <= 14) {
        return {
          surfaceType: 'gravel',
          surfaceName: 'Cross-Axle Moguls',
          grip: 0.72,
          rollingResistance: 0.048,
          roughness: 0.85,
          zoneName: 'Articulation Moguls',
        };
      }
      return {
        surfaceType: 'cobble',
        surfaceName: 'Rough Cobblestone',
        grip: 0.8,
        rollingResistance: 0.04,
        roughness: 0.72,
        zoneName: 'Cobblestone Strip',
      };
    }

    if (x >= 50 && x <= 165 && z >= -52 && z <= 52) {
      const onRamp =
        (x >= 70 && x <= 90 && z >= -28 && z <= -10) ||
        (x >= 103 && x <= 126 && z >= 8 && z <= 28);
      if (onRamp) {
        return {
          surfaceType: 'asphalt',
          surfaceName: 'Steel Launch Ramp',
          grip: 1.02,
          rollingResistance: 0.014,
          roughness: 0.08,
          zoneName: 'Stunt Ramp Park',
        };
      }
      return {
        surfaceType: 'sand',
        surfaceName: 'Deep Sand Dunes',
        grip: 0.72,
        rollingResistance: 0.056,
        roughness: 0.42,
        zoneName: 'Sand Dunes & Ramps',
      };
    }

    const dSkidpad = Math.hypot(
      x - PROVING_NE_SKIDPAD_CENTER[0],
      z - PROVING_NE_SKIDPAD_CENTER[1]
    );
    const dWestConn = distToPolyline(x, z, PROVING_WEST_CONNECTOR_POINTS);
    const dEastConn = distToPolyline(x, z, PROVING_EAST_CONNECTOR_POINTS);
    const dNeWest = distToPolyline(x, z, PROVING_NE_CONNECTOR_WEST);
    const dNeNorth = distToPolyline(x, z, PROVING_NE_CONNECTOR_NORTH);
    const dNeSouth = distToPolyline(x, z, PROVING_NE_CONNECTOR_SOUTH);
    const dNeHub = distToPolyline(x, z, PROVING_NE_CONNECTOR_HUB);

    if (
      dSkidpad <= PROVING_NE_SKIDPAD_RADIUS ||
      dWestConn < 8.5 ||
      dEastConn < 8.5 ||
      dNeWest < 8.5 ||
      dNeNorth < 8.5 ||
      dNeSouth < 8.5 ||
      dNeHub < 8.5
    ) {
      const zone =
        dSkidpad <= PROVING_NE_SKIDPAD_RADIUS
          ? 'NE Drift Skidpad'
          : dWestConn < 8.5
            ? 'West Link Road'
            : dEastConn < 8.5
              ? 'East Link Road'
              : 'NE Skidpad Connector';
      return {
        surfaceType: 'asphalt',
        surfaceName: dSkidpad <= PROVING_NE_SKIDPAD_RADIUS ? 'Skidpad Tarmac' : 'Smooth Asphalt',
        grip: 1.08,
        rollingResistance: 0.011,
        roughness: 0.03,
        zoneName: zone,
      };
    }

    const dSeRally = Math.min(
      distToPolyline(x, z, PROVING_SE_RALLY_POINTS),
      distToPolyline(x, z, PROVING_SE_DUNES_LINK_POINTS),
      distToPolyline(x, z, PROVING_SE_EAST_SPUR_POINTS)
    );
    const dSwTrail = Math.min(
      distToPolyline(x, z, PROVING_SW_TRAIL_POINTS),
      distToPolyline(x, z, PROVING_SW_BADROAD_LINK_POINTS),
      distToPolyline(x, z, PROVING_SW_WEST_SPUR_POINTS)
    );

    const dHillTrail = Math.min(
      distToPolyline(x, z, PROVING_HILL_TRAIL_POINTS),
      distToPolyline(x, z, PROVING_HILL_WEST_SPUR_POINTS)
    );

    if (dHillTrail < 7.5) {
      return {
        surfaceType: 'gravel',
        surfaceName: slopeY < 0.96 ? 'Mountain Switchback Trail' : 'Hill Access Trail',
        grip: 0.88,
        rollingResistance: 0.026,
        roughness: 0.25,
        zoneName: 'Mountain Hill Climb',
      };
    }

    const mDist = Math.hypot((x + 115) / 68, (z + 125) / 62);
    if (mDist < 1.15) {
      return {
        surfaceType: 'rock',
        surfaceName: slopeY < 0.96 ? 'Steep Rocky Incline' : 'Rocky Mountain Trail',
        grip: 0.7,
        rollingResistance: 0.062,
        roughness: 0.78,
        zoneName: 'Mountain Hill Climb',
      };
    }

    if (dSeRally < 8.5) {
      return {
        surfaceType: 'gravel',
        surfaceName: 'Packed Gravel Stage',
        grip: 0.88,
        rollingResistance: 0.025,
        roughness: 0.24,
        zoneName: 'SE Rally Gravel Stage',
      };
    }

    if (dSwTrail < 8.5) {
      return {
        surfaceType: 'gravel',
        surfaceName: 'Packed Canyon Dirt',
        grip: 0.84,
        rollingResistance: 0.032,
        roughness: 0.3,
        zoneName: 'SW Canyon Dirt Trail',
      };
    }

    return {
      surfaceType: 'grass',
      surfaceName: 'Dirt & Meadow',
      grip: 0.78,
      rollingResistance: 0.034,
      roughness: 0.28,
      zoneName: 'Open Proving Grounds',
    };
  }

  if (activeMapId === 'mountain-pass') {
    const roadX = mountainRoadCenterX(z);
    const distFromTrail = Math.abs(x - roadX);
    if (z < -150 && Math.abs(x - roadX) < 35) {
      return {
        surfaceType: 'rock',
        surfaceName: 'Summit Plateau',
        grip: 0.88,
        rollingResistance: 0.028,
        roughness: 0.35,
        zoneName: 'Mountain Summit',
      };
    }
    if (z > 125 && Math.hypot(x, z - 145) < 24) {
      return {
        surfaceType: 'gravel',
        surfaceName: 'Basecamp Gravel Pad',
        grip: 0.92,
        rollingResistance: 0.024,
        roughness: 0.18,
        zoneName: 'Valley Basecamp',
      };
    }
    if (distFromTrail < 12) {
      return {
        surfaceType: 'gravel',
        surfaceName: slopeY < 0.95 ? 'Steep Switchback Gravel' : 'Mountain Switchback',
        grip: 0.78,
        rollingResistance: 0.044,
        roughness: 0.62,
        zoneName: 'Redrock Ascent Trail',
      };
    }
    return {
      surfaceType: 'rock',
      surfaceName: 'Boulder Ridge & Scree',
      grip: 0.64,
      rollingResistance: 0.068,
      roughness: 0.88,
      zoneName: 'Off-Trail Canyon',
    };
  }

  if (activeMapId === 'desert-baja') {
    const onRamp =
      (Math.abs(x) <= 9 && z >= 26 && z <= 57) ||
      (Math.abs(x) <= 10 && z >= -90 && z <= -53);
    if (onRamp) {
      return {
        surfaceType: 'asphalt',
        surfaceName: 'Baja Steel Launch Ramp',
        grip: 1.04,
        rollingResistance: 0.015,
        roughness: 0.08,
        zoneName: 'Baja Jump Sector',
      };
    }
    if (Math.abs(x) < 12 && z >= -255 && z <= 248) {
      return {
        surfaceType: 'gravel',
        surfaceName: 'Packed Desert Wash',
        grip: 0.9,
        rollingResistance: 0.024,
        roughness: 0.24,
        zoneName: 'High-Speed Desert Wash',
      };
    }
    if (x >= -85 && x <= -35 && z >= -110 && z <= 90) {
      return {
        surfaceType: 'sand',
        surfaceName: 'Rhythm Suspension Whoops',
        grip: 0.74,
        rollingResistance: 0.052,
        roughness: 0.82,
        zoneName: 'Baja Whoops Track',
      };
    }
    if (distanceToBajaTrail(x, z) < 10.5) {
      return {
        surfaceType: 'gravel',
        surfaceName: 'Packed Baja Trail',
        grip: 0.88,
        rollingResistance: 0.026,
        roughness: 0.28,
        zoneName: x >= 0 ? 'East Canyon Dune Loop' : 'West Desert Loop',
      };
    }
    return {
      surfaceType: 'sand',
      surfaceName: 'Soft Baja Dunes',
      grip: 0.7,
      rollingResistance: 0.058,
      roughness: 0.48,
      zoneName: 'Open Sand Dunes',
    };
  }

  if (activeMapId === 'testing-facility') {
    // Split-friction braking pad (x in [34, 58], z in [-160, 160])
    if (x >= 34 && x <= 58 && z >= -160 && z <= 160) {
      if (x < 46) {
        return {
          surfaceType: 'asphalt',
          surfaceName: 'Split-μ Dry Left (1.08)',
          grip: 1.08,
          rollingResistance: 0.01,
          roughness: 0.02,
          zoneName: 'Split-Friction Braking Pad',
        };
      }
      return {
        surfaceType: 'asphalt',
        surfaceName: 'Split-μ Polished Ice (0.30)',
        grip: 0.3,
        rollingResistance: 0.005,
        roughness: 0.01,
        zoneName: 'Split-Friction Braking Pad',
      };
    }

    // Multi-Surface Traction Strips (x in [34, 148], z in [180, 290])
    if (x >= 34 && x <= 148 && z >= 180 && z <= 290) {
      if (x < 62) {
        return {
          surfaceType: 'asphalt',
          surfaceName: 'Test Strip: Tarmac',
          grip: 1.08,
          rollingResistance: 0.01,
          roughness: 0.02,
          zoneName: 'Multi-Surface Traction Pad',
        };
      }
      if (x < 90) {
        return {
          surfaceType: 'cobble',
          surfaceName: 'Test Strip: Cobble',
          grip: 0.84,
          rollingResistance: 0.032,
          roughness: 0.52,
          zoneName: 'Multi-Surface Traction Pad',
        };
      }
      if (x < 118) {
        return {
          surfaceType: 'gravel',
          surfaceName: 'Test Strip: Gravel',
          grip: 0.72,
          rollingResistance: 0.044,
          roughness: 0.64,
          zoneName: 'Multi-Surface Traction Pad',
        };
      }
      return {
        surfaceType: 'sand',
        surfaceName: 'Test Strip: Deep Sand',
        grip: 0.66,
        rollingResistance: 0.06,
        roughness: 0.45,
        zoneName: 'Multi-Surface Traction Pad',
      };
    }

    // R = 40m Constant-Radius Skid Pad centered at (-90, 0)
    const skidDist = Math.hypot(x + 90, z);
    if (skidDist <= 56) {
      return {
        surfaceType: 'asphalt',
        surfaceName: 'Skid Pad Tarmac (R=40m)',
        grip: 1.08,
        rollingResistance: 0.01,
        roughness: 0.02,
        zoneName: 'R=40m Constant-Radius Skid Pad',
      };
    }

    // Suspension Rebound / Bump Calibration Rig
    if (x >= 90 && x <= 130 && z >= -90 && z <= 90) {
      return {
        surfaceType: 'cobble',
        surfaceName: 'Calibration Bumps & Drop',
        grip: 0.96,
        rollingResistance: 0.022,
        roughness: 0.55,
        zoneName: 'Suspension Calibration Rig',
      };
    }

    // ISO Double Lane Change Corridor
    if (x >= -46 && x <= -20 && z >= -150 && z <= 35) {
      return {
        surfaceType: 'asphalt',
        surfaceName: 'ISO Lane-Change Tarmac',
        grip: 1.08,
        rollingResistance: 0.01,
        roughness: 0.02,
        zoneName: 'ISO Double Lane Change',
      };
    }

    // Main 600m Acceleration / Coast-Down / Top-Speed Lane
    if (Math.abs(x) <= 18 && Math.abs(z) <= 300) {
      return {
        surfaceType: 'asphalt',
        surfaceName: 'Precision Proving Tarmac',
        grip: 1.08,
        rollingResistance: 0.01,
        roughness: 0.02,
        zoneName: '600m Proving Straight',
      };
    }

    return {
      surfaceType: 'asphalt',
      surfaceName: 'Proving Apron Tarmac',
      grip: 1.04,
      rollingResistance: 0.012,
      roughness: 0.03,
      zoneName: 'Vehicle Testing Facility',
    };
  }

  // Midnight Coast Highway
  const dCircuit = distanceToCircuit(x, z);
  const dStraight = distanceToStraight(x, z);
  if (dCircuit < 12.5 || dStraight < 12.5) {
    return {
      surfaceType: 'asphalt',
      surfaceName: 'Track-Prepped Tarmac',
      grip: 1.14,
      rollingResistance: 0.009,
      roughness: 0.02,
      zoneName: dStraight < 12.5 ? 'Coastal Speed Straight' : 'Midnight Loop',
    };
  }
  return {
    surfaceType: 'gravel',
    surfaceName: 'Coastal Shoulder',
    grip: 0.82,
    rollingResistance: 0.032,
    roughness: 0.26,
    zoneName: 'Coastal Runoff',
  };
}

export function sampleTerrain(x: number, z: number): TerrainSample {
  const eps = 0.25;
  const h = getTerrainHeightRaw(x, z);
  const hL = getTerrainHeightRaw(x - eps, z);
  const hR = getTerrainHeightRaw(x + eps, z);
  const hD = getTerrainHeightRaw(x, z - eps);
  const hU = getTerrainHeightRaw(x, z + eps);

  const nx = hL - hR;
  const ny = 2 * eps;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;

  const normalX = nx / len;
  const normalY = ny / len;
  const normalZ = nz / len;

  const surface = classifySurface(x, z, normalY);

  return {
    height: h,
    normalX,
    normalY,
    normalZ,
    ...surface,
  };
}
