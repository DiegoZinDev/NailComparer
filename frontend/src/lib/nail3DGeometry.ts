import * as THREE from 'three';
import type { NailShape } from '../types/nail';

const COLS = 20;
const ROWS = 24;

export type NailProfileStations = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface VolumetricNailGeometryOptions {
  tipRoundness?: number;
  bedFraction?: number;
  cCurveDepth?: number;
  apexHeight?: number;
  /** Retained solely for caller/DTO compatibility — completely ignored in 3D geometry. */
  profileHalfWidths?: readonly number[];
}

const DEFAULT_BED_FRACTION = 0.58;
const DEFAULT_C_CURVE_DEPTH = 0.22;
const DEFAULT_APEX_HEIGHT = 0.085;
const CUTICLE_FRACTION = 0.16;
const HOLLOW_START_V = 0.40;
const MIN_TIP_FLOOR = 0.085;
const ELLIPSE_OVAL_K = 0.985;
const ELLIPSE_OVAL_DENOM = 1 - Math.sqrt(1 - ELLIPSE_OVAL_K);

/**
 * Minimum real tip half-width floors at v = 1.0 (zero needles / zero cones).
 */
const TIP_MIN_HALF_W: Record<NailShape, number> = {
  stiletto: 0.085,
  almond: 0.14,
  oval: 0.20,
  coffin: 0.28,
  natural: 0.34,
  square: 0.44,
};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates clean, strictly monotonic parametric half-width profile (`0 .. 0.5`) along
 * longitudinal parameter `v ∈ [0, 1]` (`v = 0` is proximal cuticle, `v = 1` is distal free edge):
 *
 * - `v ∈ [0, 0.16]`: smooth convex parabolic cuticle emergence hugging the eponychium.
 * - `v ∈ [0.16, bedFraction]`: strictly parallel (`0.5`) covering 100% of the client's natural nail bed.
 * - `v > bedFraction`: purely analytical, convex, strictly monotonic salon equations for all 6 shapes
 *   (raw `profileHalfWidths` pixel noise is ignored completely).
 */
export function evalNailHalfWidth(
  v: number,
  shape: NailShape,
  options?: VolumetricNailGeometryOptions
): number {
  const vc = clamp01(v);
  const bedFraction = clamp(options?.bedFraction ?? DEFAULT_BED_FRACTION, 0.38, 0.92);
  const tipRoundness =
    options?.tipRoundness !== undefined ? clamp01(options.tipRoundness) : 0.5;
  const minFloor = Math.max(MIN_TIP_FLOOR, TIP_MIN_HALF_W[shape] ?? TIP_MIN_HALF_W.almond);

  // 1) Proximal cuticle zone (v ∈ [0, 0.16]): smooth parabolic curve hugging the eponychium
  if (vc < CUTICLE_FRACTION) {
    const t = vc / CUTICLE_FRACTION;
    const parabolic = 1 - (1 - t) * (1 - t);
    return 0.28 + 0.22 * parabolic;
  }

  // 2) Parallel nail bed sidewalls (v ∈ [0.16, bedFraction]): 100% parallel (halfW = 0.5)
  if (vc <= bedFraction) {
    return 0.5;
  }

  // 3) Free edge (v > bedFraction): strictly smooth, convex & monotonic salon silhouettes
  const t = clamp01((vc - bedFraction) / Math.max(1e-4, 1 - bedFraction));
  const roundnessBias = (tipRoundness - 0.5) * 0.04;
  let hw = 0.5;

  if (shape === 'stiletto') {
    const targetTip = Math.max(minFloor, 0.088 + roundnessBias * 0.5);
    const ovalRound =
      (1 - Math.sqrt(Math.max(0, 1 - ELLIPSE_OVAL_K * t * t))) / ELLIPSE_OVAL_DENOM;
    const curve = 0.85 * Math.pow(t, 1.08) + 0.15 * ovalRound;
    hw = 0.5 - (0.5 - targetTip) * curve;
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'almond') {
    const targetTip = Math.max(minFloor, 0.155 + roundnessBias);
    const ovalRound =
      (1 - Math.sqrt(Math.max(0, 1 - ELLIPSE_OVAL_K * t * t))) / ELLIPSE_OVAL_DENOM;
    const curve = 0.70 * Math.pow(t, 1.15) + 0.30 * ovalRound;
    hw = 0.5 - (0.5 - targetTip) * curve;
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'oval') {
    const targetTip = Math.max(minFloor, 0.215 + roundnessBias);
    const curve =
      (1 - Math.sqrt(Math.max(0, 1 - ELLIPSE_OVAL_K * Math.pow(t, 1.55)))) /
      ELLIPSE_OVAL_DENOM;
    hw = 0.5 - (0.5 - targetTip) * curve;
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'coffin') {
    const targetTip = Math.max(minFloor, 0.295 + roundnessBias * 0.7);
    const mainTarget = targetTip + 0.025;
    const bevel = t > 0.88 ? Math.pow((t - 0.88) / 0.12, 2) * 0.025 : 0;
    hw = 0.5 - (0.5 - mainTarget) * Math.pow(t, 1.08) - bevel;
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'square') {
    const targetTip = Math.max(minFloor, 0.445 + roundnessBias * 0.4);
    if (t <= 0.86) {
      hw = 0.5;
    } else {
      const ct = (t - 0.86) / 0.14;
      hw = 0.5 - (0.5 - targetTip) * (ct * ct);
    }
    return clamp(hw, minFloor, 0.5);
  }

  // 'natural': gentle convex taper after bed toward naturally rounded free edge
  const targetTip = Math.max(minFloor, 0.35 + roundnessBias * 0.8);
  const natCurve = Math.pow(t, 1.55);
  hw = 0.5 - (0.5 - targetTip) * natCurve;
  return clamp(hw, minFloor, 0.5);
}

/**
 * Computes longitudinal Gel Apex elevation along `v ∈ [0, 1]`.
 * Strictly `z = 0` at cuticle base (`v = 0, u = 0.5`) with zero step/lip at cuticle,
 * rising smoothly to the structural gel apex in the nail body (`v ≈ 0.44`)
 * and tapering gracefully toward the free edge.
 */
function evalGelApexZ(
  v: number,
  lengthRatio: number,
  baseApexHeight = DEFAULT_APEX_HEIGHT
): number {
  const apexPeak = 0.44;
  const apexHeight =
    clamp(baseApexHeight, 0.06, 0.11) * Math.min(1.30, Math.max(0.85, lengthRatio));

  if (v <= apexPeak) {
    const t = clamp01(v / apexPeak);
    const rise = t * t * (3 - 2 * t);
    return apexHeight * Math.pow(rise, 0.85);
  }

  const t = clamp01((v - apexPeak) / (1 - apexPeak));
  return apexHeight * (1 - 0.42 * (t * t * (1.4 - 0.4 * t)));
}

/**
 * Evaluates sculpted gel thickness (between dorsal and ventral shells).
 * Tapers smoothly down to 0.012 at proximal cuticle border (v = 0)
 * for an invisible transition with the eponychium skin.
 */
function evalShellThickness(v: number): number {
  if (v < CUTICLE_FRACTION) {
    const t = smoothstep(0, CUTICLE_FRACTION, v);
    return 0.012 + 0.036 * t;
  }
  if (v <= 0.46) {
    return 0.048;
  }
  const t = clamp01((v - 0.46) / 0.54);
  return 0.048 - 0.013 * t;
}

// Reusable scratch objects for zero-allocation surface queries when `out` is provided
const _surfOptions: VolumetricNailGeometryOptions = {};
const _pU0 = new THREE.Vector3();
const _pU1 = new THREE.Vector3();
const _pV0 = new THREE.Vector3();
const _pV1 = new THREE.Vector3();
const _dPdu = new THREE.Vector3();
const _dPdv = new THREE.Vector3();

function evalDorsalSurfacePointInto(
  u: number,
  v: number,
  shape: NailShape,
  bedFraction: number,
  tipRoundness: number,
  cCurveDepth: number,
  apexHeight: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const uc = clamp01(u);
  const vc = clamp01(v);
  _surfOptions.bedFraction = bedFraction;
  _surfOptions.tipRoundness = tipRoundness;

  const halfW = evalNailHalfWidth(vc, shape, _surfOptions);
  const s = uc * 2 - 1;
  const x = s * halfW;
  const y = vc;
  const zCCurve = -cCurveDepth * (1 - Math.cos(s * Math.PI * 0.48));
  const zTop = zCCurve + evalGelApexZ(vc, 1.0, apexHeight);
  return target.set(x, y, zTop);
}

/**
 * Evaluates the exact local dorsal surface position `(x(u,v), y(u,v), zTop(u,v))`
 * and unit outward dorsal normal (`normalize(dP/du × dP/dv)` with `normal.z > 0`)
 * using the exact parametric equations of `createVolumetricNailGeometry`.
 *
 * Pass optional `out` to avoid per-frame allocations inside `requestAnimationFrame`.
 */
export function evaluateNailSurfacePointAndNormal(
  u: number,
  v: number,
  shape: NailShape,
  options?: VolumetricNailGeometryOptions,
  out?: { position: THREE.Vector3; normal: THREE.Vector3 }
): { position: THREE.Vector3; normal: THREE.Vector3 } {
  const bedFraction = clamp(options?.bedFraction ?? DEFAULT_BED_FRACTION, 0.38, 0.92);
  const tipRoundness =
    options?.tipRoundness !== undefined ? clamp01(options.tipRoundness) : 0.5;
  const cCurveDepth = clamp(options?.cCurveDepth ?? DEFAULT_C_CURVE_DEPTH, 0.16, 0.28);
  const apexHeight = clamp(options?.apexHeight ?? DEFAULT_APEX_HEIGHT, 0.06, 0.11);

  const uc = clamp01(u);
  const vc = clamp01(v);

  const result = out ?? {
    position: new THREE.Vector3(),
    normal: new THREE.Vector3(),
  };

  evalDorsalSurfacePointInto(
    uc,
    vc,
    shape,
    bedFraction,
    tipRoundness,
    cCurveDepth,
    apexHeight,
    result.position
  );

  const eps = 1e-4;
  const u0 = Math.max(0, uc - eps);
  const u1 = Math.min(1, uc + eps);
  const v0 = Math.max(0, vc - eps);
  const v1 = Math.min(1, vc + eps);
  const du = Math.max(1e-6, u1 - u0);
  const dv = Math.max(1e-6, v1 - v0);

  evalDorsalSurfacePointInto(
    u0,
    vc,
    shape,
    bedFraction,
    tipRoundness,
    cCurveDepth,
    apexHeight,
    _pU0
  );
  evalDorsalSurfacePointInto(
    u1,
    vc,
    shape,
    bedFraction,
    tipRoundness,
    cCurveDepth,
    apexHeight,
    _pU1
  );
  evalDorsalSurfacePointInto(
    uc,
    v0,
    shape,
    bedFraction,
    tipRoundness,
    cCurveDepth,
    apexHeight,
    _pV0
  );
  evalDorsalSurfacePointInto(
    uc,
    v1,
    shape,
    bedFraction,
    tipRoundness,
    cCurveDepth,
    apexHeight,
    _pV1
  );

  _dPdu.subVectors(_pU1, _pU0).divideScalar(du);
  _dPdv.subVectors(_pV1, _pV0).divideScalar(dv);
  result.normal.crossVectors(_dPdu, _dPdv);

  if (result.normal.lengthSq() < 1e-12) {
    result.normal.set(0, 0, 1);
  } else {
    result.normal.normalize();
    if (result.normal.z < 0) {
      result.normal.negate();
    }
  }

  return result;
}

/**
 * Volumetric 20 × 24 Salon Anatomical Nail Mesh (`V11` — 4× lighter for mobile 60fps):
 * Returns a closed multi-material `THREE.BufferGeometry` with 2 clean geometry groups:
 * - **Group 0** (`materialIndex: 0`): Dorsal sculpted gel shell + smooth lateral, proximal & free-edge rims.
 * - **Group 1** (`materialIndex: 1`): Concave hollowed ventral cavity (`v >= 0.40`) showcasing the transverse
 *   C-curve tunnel (`cCurveDepth ∈ [0.16, 0.28]`) with dedicated UVs `u ∈ [0, 1], v ∈ [0, 1]`.
 *
 * Local coordinate convention:
 * - Origin `(0, 0, 0)` is anchored strictly on the proximal cuticle midline (`u = 0.5, v = 0, z = 0`)
 * - `+Y` grows distally from cuticle (`y = 0`) to free-edge tip (`y = lengthRatio`)
 * - `X` spans width `[-0.5, +0.5]`
 * - `+Z` points outward dorsally from the nail bed, while sidewalls curve toward `-Z` hugging the finger cylinder
 */
export function createVolumetricNailGeometry(
  shape: NailShape,
  options?: VolumetricNailGeometryOptions | number
): THREE.BufferGeometry {
  const resolvedOptions: VolumetricNailGeometryOptions | undefined =
    typeof options === 'number' ? undefined : options;
  const lengthRatio = typeof options === 'number' ? options : 1.0;

  const cCurveDepth = clamp(resolvedOptions?.cCurveDepth ?? DEFAULT_C_CURVE_DEPTH, 0.16, 0.28);
  const apexHeight = clamp(resolvedOptions?.apexHeight ?? DEFAULT_APEX_HEIGHT, 0.06, 0.11);

  const cols = COLS;
  const rows = ROWS;
  const stride = cols + 1;
  const gridVertexCount = (rows + 1) * stride;
  const hollowStartRow = Math.round(rows * HOLLOW_START_V);

  const topPositions: number[] = [];
  const topUVs: number[] = [];
  const botPositions: number[] = [];
  const botUVs: number[] = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows; // 0 = proximal cuticle, 1 = distal free edge
    const halfW = evalNailHalfWidth(v, shape, resolvedOptions);
    const apexZ = evalGelApexZ(v, lengthRatio, apexHeight);
    const thickness = evalShellThickness(v);

    const hollowProgress =
      v <= HOLLOW_START_V
        ? 0
        : Math.sin(clamp01((v - HOLLOW_START_V) / (1 - HOLLOW_START_V)) * (Math.PI / 2));

    const vUnderside =
      r <= hollowStartRow ? 0 : (r - hollowStartRow) / Math.max(1, rows - hollowStartRow);

    for (let c = 0; c <= cols; c++) {
      const uParam = c / cols; // 0 (left sidewall) .. 1 (right sidewall)
      const s = uParam * 2 - 1; // -1 .. +1
      const x = s * halfW;
      const y = v * lengthRatio;

      // Transverse C-Curve: center (s=0) at 0, sidewalls wrap smoothly in -Z
      // At v=0, u=0.5 (s=0), zCCurve === 0 and apexZ === 0 => zTop === 0 strictly!
      const zCCurve = -cCurveDepth * (1 - Math.cos(s * Math.PI * 0.48));
      const zTop = zCCurve + apexZ;

      const edgeMin = v < CUTICLE_FRACTION ? 0.22 : 0.30;
      const lateralTaper =
        edgeMin + (1 - edgeMin) * Math.pow(Math.max(0, Math.sin(Math.PI * uParam)), 0.55);

      const centerConcavity = (1 - s * s) * 0.018 * hollowProgress;
      const zBot = zTop - thickness * lateralTaper + centerConcavity;

      const uTop = clamp01(0.5 + x * 0.96);
      const vTop = v;

      topPositions.push(x, y, zTop);
      topUVs.push(uTop, vTop);

      botPositions.push(x, y, zBot);
      botUVs.push(uParam, vUnderside);
    }
  }

  const positions: number[] = [...topPositions, ...botPositions];
  const uvs: number[] = [...topUVs, ...botUVs];
  const group0Indices: number[] = [];
  const group1Indices: number[] = [];

  // 1) Group 0: Dorsal sculpted surface
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bl = r * stride + c;
      const br = bl + 1;
      const tl = bl + stride;
      const tr = tl + 1;
      group0Indices.push(bl, br, tr);
      group0Indices.push(bl, tr, tl);
    }
  }

  // 2) Ventral surface: proximal seal in Group 0, concave free-edge tunnel in Group 1
  const botOffset = gridVertexCount;
  for (let r = 0; r < rows; r++) {
    const targetGroup = r >= hollowStartRow ? group1Indices : group0Indices;
    for (let c = 0; c < cols; c++) {
      const bl = botOffset + r * stride + c;
      const br = bl + 1;
      const tl = bl + stride;
      const tr = tl + 1;
      targetGroup.push(bl, tr, br);
      targetGroup.push(bl, tl, tr);
    }
  }

  // 3) Closed thickness walls (Group 0) with split rim vertices for clean normals
  const pushRimQuad = (topA: number, topB: number, botA: number, botB: number) => {
    const base = positions.length / 3;
    const copyVert = (srcIdx: number) => {
      positions.push(
        positions[srcIdx * 3],
        positions[srcIdx * 3 + 1],
        positions[srcIdx * 3 + 2]
      );
      uvs.push(uvs[srcIdx * 2], uvs[srcIdx * 2 + 1]);
    };
    copyVert(topA);
    copyVert(topB);
    copyVert(botA);
    copyVert(botB);
    group0Indices.push(base, base + 2, base + 3);
    group0Indices.push(base, base + 3, base + 1);
  };

  // Distal free-edge wall (r = rows)
  for (let c = cols; c > 0; c--) {
    const t0 = rows * stride + c;
    const t1 = rows * stride + (c - 1);
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // Proximal cuticle wall (r = 0)
  for (let c = 0; c < cols; c++) {
    const t0 = c;
    const t1 = c + 1;
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // Left lateral sidewall (c = 0)
  for (let r = rows; r > 0; r--) {
    const t0 = r * stride;
    const t1 = (r - 1) * stride;
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // Right lateral sidewall (c = cols)
  for (let r = 0; r < rows; r++) {
    const t0 = r * stride + cols;
    const t1 = (r + 1) * stride + cols;
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  const allIndices = [...group0Indices, ...group1Indices];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(allIndices);
  geometry.clearGroups();
  geometry.addGroup(0, group0Indices.length, 0);
  geometry.addGroup(group0Indices.length, group1Indices.length, 1);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Conformal Cuticle & Lateral Sulcus Contact Shadow Skirt (`V11`):
 * Curved thin shell following the proximal cuticle contour (`v ∈ [-0.04, bedFraction]`)
 * seated slightly below (`z - 0.008`) the dorsal plate for soft NormalBlending contact AO.
 */
export function createCuticleContactSkirtGeometry(
  shape: NailShape,
  bedFraction = DEFAULT_BED_FRACTION,
  cCurveDepth = DEFAULT_C_CURVE_DEPTH,
  apexHeight = DEFAULT_APEX_HEIGHT
): THREE.BufferGeometry {
  const uCols = 20;
  const vRows = 16;
  const stride = uCols + 1;

  const vStart = -0.04;
  const vEnd = clamp(bedFraction, 0.38, 0.92);
  const clampedCCurve = clamp(cCurveDepth, 0.16, 0.28);
  const clampedApex = clamp(apexHeight, 0.06, 0.11);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= vRows; r++) {
    const vNorm = r / vRows; // 0 .. 1 across skirt span
    const v = vStart + (vEnd - vStart) * vNorm;
    const vClamped = clamp01(v);

    const nailHalfW = evalNailHalfWidth(vClamped, shape, { bedFraction: vEnd });
    const skirtHalfW = nailHalfW * 1.075;
    const apexZ = evalGelApexZ(vClamped, 1.0, clampedApex) * 0.35;

    const proximalArch = v < 0.24 ? Math.cos(((v + 0.04) / 0.28) * (Math.PI / 2)) : 0;

    for (let c = 0; c <= uCols; c++) {
      const uParam = c / uCols;
      const s = uParam * 2 - 1;
      const x = s * skirtHalfW;

      const yContourOffset = -0.018 * (1 - s * s) * Math.max(0, proximalArch);
      const y = v + yContourOffset;

      const zCCurve = -clampedCCurve * (1 - Math.cos(s * Math.PI * 0.50));
      const z = zCCurve + apexZ - 0.008;

      positions.push(x, y, z);
      uvs.push(uParam, vNorm);
    }
  }

  for (let r = 0; r < vRows; r++) {
    for (let c = 0; c < uCols; c++) {
      const bl = r * stride + c;
      const br = bl + 1;
      const tl = bl + stride;
      const tr = tl + 1;
      indices.push(bl, br, tr);
      indices.push(bl, tr, tl);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Lightweight 3D metal stud / caviar bead dome (`SphereGeometry(1, 14, 10)` scaled `(1, 1, 0.72)`).
 */
export function createMetalStudGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 14, 10);
  geo.scale(1, 1, 0.72);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Lightweight 3D pearl cabochon dome (`SphereGeometry(1, 14, 10)` scaled `(1, 1, 0.78)`).
 */
export function createPearlDomeGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 14, 10);
  geo.scale(1, 1, 0.78);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Lightweight faceted cut crystal rhinestone (`CylinderGeometry(0.58, 1.0, 0.56, 8, 1)` rotated +PI/2 in X
 * so the crown/table points along `+Z`).
 */
export function createRhinestoneGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.58, 1.0, 0.56, 8, 1);
  geo.rotateX(Math.PI / 2);
  return geo;
}

/**
 * Lightweight 3D elliptical clear gel droplet (`SphereGeometry(1, 12, 10)` scaled `(0.85, 1.15, 0.65)`).
 */
export function createClearDropGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 12, 10);
  geo.scale(0.85, 1.15, 0.65);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Backward-compatible alias for `createVolumetricNailGeometry`.
 */
export function createNail3DGeometry(
  shape: NailShape,
  lengthRatio = 1.0
): THREE.BufferGeometry {
  return createVolumetricNailGeometry(shape, lengthRatio);
}
