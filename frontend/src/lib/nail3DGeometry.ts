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
  profileHalfWidths?: NailProfileStations;
}

const DEFAULT_BED_FRACTION = 0.58;
const CUTICLE_FRACTION = 0.16;
const C_CURVE_DEPTH = 0.22;
const HOLLOW_START_V = 0.40;
const MIN_TIP_FLOOR = 0.085;

/**
 * 8 longitudinal stations corresponding to `NailGeometryProfile.profileHalfWidths`:
 * `v = [0, 0.15, 0.35, 0.55, 0.72, 0.85, 0.94, 1.0]`.
 */
const PROFILE_STATIONS_V: readonly number[] = [0, 0.15, 0.35, 0.55, 0.72, 0.85, 0.94, 1.0];
const FREE_EDGE_REF_START_V = 0.55;

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
 * Fritsch-Carlson monotone piecewise cubic Hermite interpolation (PCHIP) over the 8 profile stations.
 * Guarantees C1 continuity, exact station interpolation, and zero overshoot/ringing.
 */
function evalMonotoneHermiteProfile(
  vRef: number,
  stationsV: readonly number[],
  values: readonly number[]
): number {
  const n = stationsV.length;
  if (vRef <= stationsV[0]) return values[0];
  if (vRef >= stationsV[n - 1]) return values[n - 1];

  // Locate interval [i, i + 1]
  let idx = 0;
  for (let i = 0; i < n - 1; i++) {
    if (vRef >= stationsV[i] && vRef <= stationsV[i + 1]) {
      idx = i;
      break;
    }
  }

  const secants = new Float64Array(n - 1);
  const hs = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const h = Math.max(1e-5, stationsV[i + 1] - stationsV[i]);
    hs[i] = h;
    secants[i] = (values[i + 1] - values[i]) / h;
  }

  const tangents = new Float64Array(n);
  tangents[0] = secants[0];
  tangents[n - 1] = secants[n - 2];

  for (let i = 1; i < n - 1; i++) {
    const d0 = secants[i - 1];
    const d1 = secants[i];
    if (d0 === 0 || d1 === 0 || d0 * d1 < 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * hs[i] + hs[i - 1];
      const w2 = hs[i] + 2 * hs[i - 1];
      tangents[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
  }

  const h = hs[idx];
  const s = (vRef - stationsV[idx]) / h;
  const s2 = s * s;
  const s3 = s2 * s;

  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  return (
    h00 * values[idx] +
    h10 * h * tangents[idx] +
    h01 * values[idx + 1] +
    h11 * h * tangents[idx + 1]
  );
}

/**
 * Evaluates half-width profile (0 .. 0.5) along longitudinal parameter v ∈ [0, 1]
 * (v = 0 is proximal cuticle base, v = 1 is distal free edge):
 *
 * - `v ∈ [0, 0.16]`: smooth parabolic cuticle emergence hugging the eponychium.
 * - `v ∈ [0.16, bedFraction]`: strictly parallel (`0.5`) so the client's natural nail bed
 *   is covered 100% edge-to-edge without pinching or gaps.
 * - `v > bedFraction`: either C1-smooth PCHIP interpolation of `profileHalfWidths[8]`
 *   with anti-needle floor (`>= 0.085`), or smooth salon equations for all 6 shapes.
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

  // 3) Free edge (v > bedFraction)
  const t = clamp01((vc - bedFraction) / Math.max(1e-4, 1 - bedFraction));

  if (options?.profileHalfWidths && options.profileHalfWidths.length === 8) {
    const raw = options.profileHalfWidths;
    // Normalize relative to the reference bed peak so v = bedFraction starts cleanly at 0.5
    const bedPeak = Math.max(0.25, raw[2], raw[3]);
    const scaleToBed = 0.5 / bedPeak;
    const scaled: number[] = new Array(8);
    for (let i = 0; i < 8; i++) {
      const val = Number.isFinite(raw[i]) ? raw[i] * scaleToBed : 0.5;
      scaled[i] = clamp(val, MIN_TIP_FLOOR, 0.5);
    }

    const vRef = FREE_EDGE_REF_START_V + (1 - FREE_EDGE_REF_START_V) * t;
    const splineVal = evalMonotoneHermiteProfile(vRef, PROFILE_STATIONS_V, scaled);

    // Smoothstep entry blend guarantees exact C1 continuity (val = 0.5, d/dv = 0) at v = bedFraction
    // while reaching 1.0 before the distal tip stations (vRef >= 0.72)
    const entryBlend = smoothstep(0, 0.30, t);
    const hw = (1 - entryBlend) * 0.5 + entryBlend * splineVal;
    return clamp(hw, MIN_TIP_FLOOR, 0.5);
  }

  // Fallback analytical salon equations for all 6 shapes
  const roundnessBias = (tipRoundness - 0.5) * 0.04;
  let hw = 0.5;

  if (shape === 'stiletto') {
    const targetTip = Math.max(minFloor, 0.088 + roundnessBias * 0.5);
    const taper = 0.5 - (0.5 - targetTip) * Math.pow(t, 0.92);
    const apexStart = 0.94;
    if (vc > apexStart) {
      const a = (vc - apexStart) / (1 - apexStart);
      const dome = 1 - 0.08 * (1 - Math.sqrt(Math.max(0, 1 - a * a * 0.65)));
      hw = Math.max(minFloor, taper * dome);
    } else {
      hw = Math.max(minFloor, taper);
    }
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'almond') {
    const targetTip = Math.max(minFloor, 0.155 + roundnessBias);
    const curve = Math.pow(Math.sin(t * (Math.PI / 2)), 0.88);
    const dome = t > 0.86 ? 1 - 0.06 * smoothstep(0.86, 1.0, t) : 1.0;
    hw = Math.max(minFloor, (0.5 - (0.5 - targetTip) * curve) * dome);
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'oval') {
    const targetTip = Math.max(minFloor, 0.215 + roundnessBias);
    const curve = 1 - Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.55)));
    hw = Math.max(minFloor, 0.5 - (0.5 - targetTip) * curve);
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'coffin') {
    const targetTip = Math.max(minFloor, 0.295 + roundnessBias * 0.7);
    const linearTaper = 0.5 - (0.5 - (targetTip + 0.02)) * Math.pow(t, 0.96);
    const cornerBevel = t > 0.88 ? 1 - 0.055 * smoothstep(0.88, 1.0, t) : 1.0;
    hw = Math.max(minFloor, linearTaper * cornerBevel);
    return clamp(hw, minFloor, 0.5);
  }

  if (shape === 'square') {
    const targetTip = Math.max(minFloor, 0.445 + roundnessBias * 0.4);
    if (t <= 0.86) {
      hw = 0.5;
    } else {
      const ct = smoothstep(0.86, 1.0, t);
      hw = Math.max(minFloor, 0.5 - (0.5 - targetTip) * ct * ct);
    }
    return clamp(hw, minFloor, 0.5);
  }

  // 'natural': organic slight taper after bed, gently rounded free edge
  const targetTip = Math.max(minFloor, 0.35 + roundnessBias * 0.8);
  const natCurve = Math.pow(t, 1.45);
  hw = Math.max(minFloor, 0.5 - (0.5 - targetTip) * natCurve);
  return clamp(hw, minFloor, 0.5);
}

/**
 * Computes longitudinal Gel Apex (Ápice estrutural) elevation along v ∈ [0, 1].
 * Strictly z = 0 at cuticle base (v = 0, u = 0.5) with zero step/lip at cuticle,
 * rising smoothly to the structural gel apex in the nail body (v ≈ 0.35–0.55)
 * and tapering gracefully toward the free edge.
 */
function evalGelApexZ(v: number, lengthRatio: number): number {
  const apexPeak = 0.44;
  const apexHeight = 0.088 * Math.min(1.30, Math.max(0.85, lengthRatio));

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

/**
 * Volumetric 20 × 24 Salon Anatomical Nail Mesh (`V10` — 4× lighter for mobile 60fps):
 * Returns a closed multi-material `THREE.BufferGeometry` with 2 clean geometry groups:
 * - **Group 0** (`materialIndex: 0`): Dorsal sculpted gel shell + smooth lateral, proximal & free-edge rims.
 * - **Group 1** (`materialIndex: 1`): Concave hollowed ventral cavity (`v >= 0.40`) showcasing the transverse
 *   C-curve tunnel (`cCurveDepth = 0.22`) with dedicated UVs `u ∈ [0, 1], v ∈ [0, 1]`.
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
    const apexZ = evalGelApexZ(v, lengthRatio);
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

      // Transverse C-Curve (Arco C = 0.22): center (s=0) at 0, sidewalls wrap smoothly in -Z
      // At v=0, u=0.5 (s=0), zCCurve === 0 and apexZ === 0 => zTop === 0 strictly!
      const zCCurve = -C_CURVE_DEPTH * (1 - Math.cos(s * Math.PI * 0.48));
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
 * Conformal Cuticle & Lateral Sulcus Contact Shadow Skirt (`V10`):
 * Curved thin shell following the proximal cuticle contour (`v ∈ [-0.04, 0.24]`)
 * and dynamic lateral nail bed grooves (`v ∈ [0, bedFraction]`), seated slightly below (`z - 0.008`)
 * the dorsal plate to render organic AO contact shadow via `MultiplyBlending`.
 */
export function createCuticleContactSkirtGeometry(
  shape: NailShape,
  bedFraction = DEFAULT_BED_FRACTION
): THREE.BufferGeometry {
  const uCols = 20;
  const vRows = 16;
  const stride = uCols + 1;

  const vStart = -0.04;
  const vEnd = clamp(bedFraction, 0.38, 0.92);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= vRows; r++) {
    const vNorm = r / vRows; // 0 .. 1 across skirt span
    const v = vStart + (vEnd - vStart) * vNorm;
    const vClamped = clamp01(v);

    const nailHalfW = evalNailHalfWidth(vClamped, shape, { bedFraction: vEnd });
    const skirtHalfW = nailHalfW * 1.075;
    const apexZ = evalGelApexZ(vClamped, 1.0) * 0.35;

    const proximalArch = v < 0.24 ? Math.cos(((v + 0.04) / 0.28) * (Math.PI / 2)) : 0;

    for (let c = 0; c <= uCols; c++) {
      const uParam = c / uCols;
      const s = uParam * 2 - 1;
      const x = s * skirtHalfW;

      const yContourOffset = -0.018 * (1 - s * s) * Math.max(0, proximalArch);
      const y = v + yContourOffset;

      const zCCurve = -C_CURVE_DEPTH * (1 - Math.cos(s * Math.PI * 0.50));
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
 * Backward-compatible alias for `createVolumetricNailGeometry`.
 */
export function createNail3DGeometry(
  shape: NailShape,
  lengthRatio = 1.0
): THREE.BufferGeometry {
  return createVolumetricNailGeometry(shape, lengthRatio);
}
