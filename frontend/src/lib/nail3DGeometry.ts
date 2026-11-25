import * as THREE from 'three';
import type { NailShape } from '../types/nail';

const COLS = 40;
const ROWS = 48;

export interface VolumetricNailGeometryOptions {
  tipRoundness?: number;
  bedFraction?: number;
}

const DEFAULT_BED_FRACTION = 0.58;
const CUTICLE_FRACTION = 0.16;
const C_CURVE_DEPTH = 0.22;
const HOLLOW_START_V = 0.40;

/**
 * Minimum real tip half-width floors at v = 1.0 (zero spikes / zero cones).
 */
const TIP_MIN_HALF_W: Record<NailShape, number> = {
  stiletto: 0.085,
  almond: 0.14,
  oval: 0.20,
  coffin: 0.28,
  natural: 0.34,
  square: 0.44,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluates half-width profile (0 .. 0.5) along longitudinal parameter v ∈ [0, 1]
 * (v = 0 is proximal cuticle base, v = 1 is distal free edge) for all 6 salon shapes:
 * `'natural' | 'oval' | 'almond' | 'square' | 'coffin' | 'stiletto'`.
 */
export function evalNailHalfWidth(
  v: number,
  shape: NailShape,
  options?: VolumetricNailGeometryOptions
): number {
  const vc = clamp01(v);
  const bedFraction = Math.max(0.45, Math.min(0.72, options?.bedFraction ?? DEFAULT_BED_FRACTION));
  const tipRoundness =
    options?.tipRoundness !== undefined ? clamp01(options.tipRoundness) : 0.5;
  const minFloor = TIP_MIN_HALF_W[shape] ?? TIP_MIN_HALF_W.almond;

  // 1) Proximal cuticle zone (v ∈ [0, 0.16]): smooth parabolic curve hugging the eponychium
  if (vc < CUTICLE_FRACTION) {
    const t = vc / CUTICLE_FRACTION;
    // Smooth parabolic ease from proximal emergence (0.28) to full sidewall width (0.5)
    const parabolic = 1 - (1 - t) * (1 - t);
    return 0.28 + 0.22 * parabolic;
  }

  // 2) Parallel nail bed sidewalls (v ∈ [0.16, bedFraction]): 100% parallel (halfW = 0.5)
  if (vc <= bedFraction) {
    return 0.5;
  }

  // 3) Free edge (v > bedFraction): smooth salon curves with guaranteed real rounded tip floor
  const t = clamp01((vc - bedFraction) / Math.max(1e-4, 1 - bedFraction));
  // tipRoundness modulates tip width subtly within safe salon range without ever violating minFloor
  const roundnessBias = (tipRoundness - 0.5) * 0.04;

  let hw = 0.5;

  if (shape === 'stiletto') {
    // Smooth tapered stiletto ending in a soft rounded apex over v ∈ [0.94, 1.0] (never 0.0!)
    const targetTip = Math.max(minFloor, 0.088 + roundnessBias * 0.5);
    const taper = 0.5 - (0.5 - targetTip) * Math.pow(t, 0.92);
    const apexStart = 0.94;
    if (vc > apexStart) {
      const a = (vc - apexStart) / (1 - apexStart);
      // Soft dome round-off that stays strictly >= minFloor
      const dome = 1 - 0.08 * (1 - Math.sqrt(Math.max(0, 1 - a * a * 0.65)));
      hw = Math.max(minFloor, taper * dome);
    } else {
      hw = Math.max(minFloor, taper);
    }
    return hw;
  }

  if (shape === 'almond') {
    const targetTip = Math.max(minFloor, 0.155 + roundnessBias);
    const curve = Math.pow(Math.sin(t * (Math.PI / 2)), 0.88);
    // Slight dome rounding at the very tip
    const dome = t > 0.86 ? 1 - 0.06 * smoothstep(0.86, 1.0, t) : 1.0;
    hw = Math.max(minFloor, (0.5 - (0.5 - targetTip) * curve) * dome);
    return hw;
  }

  if (shape === 'oval') {
    const targetTip = Math.max(minFloor, 0.215 + roundnessBias);
    const curve = 1 - Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.55)));
    hw = Math.max(minFloor, 0.5 - (0.5 - targetTip) * curve);
    return hw;
  }

  if (shape === 'coffin') {
    // Ballerina/Coffin: crisp straight taper transitioning into softly beveled/rounded corners
    const targetTip = Math.max(minFloor, 0.295 + roundnessBias * 0.7);
    const linearTaper = 0.5 - (0.5 - (targetTip + 0.02)) * Math.pow(t, 0.96);
    const cornerBevel = t > 0.88 ? 1 - 0.055 * smoothstep(0.88, 1.0, t) : 1.0;
    hw = Math.max(minFloor, linearTaper * cornerBevel);
    return hw;
  }

  if (shape === 'square') {
    // Parallel sidewalls all the way down, softly rounded corners in the last 12%
    const targetTip = Math.max(minFloor, 0.445 + roundnessBias * 0.4);
    if (t <= 0.86) {
      hw = 0.5;
    } else {
      const ct = smoothstep(0.86, 1.0, t);
      hw = Math.max(minFloor, 0.5 - (0.5 - targetTip) * ct * ct);
    }
    return hw;
  }

  // 'natural': organic slight taper after bed, gently rounded free edge
  const targetTip = Math.max(minFloor, 0.35 + roundnessBias * 0.8);
  const natCurve = Math.pow(t, 1.45);
  hw = Math.max(minFloor, 0.5 - (0.5 - targetTip) * natCurve);
  return hw;
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
    // C1-smooth rise from exact 0 at v=0 (no step at cuticle, dorsal adherence)
    const rise = t * t * (3 - 2 * t);
    return apexHeight * Math.pow(rise, 0.85);
  }

  const t = clamp01((v - apexPeak) / (1 - apexPeak));
  return apexHeight * (1 - 0.42 * (t * t * (1.4 - 0.4 * t)));
}

/**
 * Evaluates sculpted gel thickness (between dorsal and ventral shells).
 * Tapers smoothly down to 0.012 (~0.15mm normalized) at proximal cuticle border (v = 0)
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
 * Volumetric 40 × 48 Salon Anatomical Nail Mesh (`V9`):
 * Returns a closed multi-material `THREE.BufferGeometry` with 2 clean geometry groups:
 * - **Group 0** (`materialIndex: 0`): Dorsal sculpted gel shell + smooth lateral, proximal & free-edge rims.
 *   Clean UVs `u ∈ [0, 1], v ∈ [0, 1]` compatible with real 3D `displacementMap` relief (~0.3–0.6mm).
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
  // Support both V9 options object and legacy numeric lengthRatio argument
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

    // Smooth concave hollow arch beneath the free edge (v >= 0.40)
    const hollowProgress =
      v <= HOLLOW_START_V
        ? 0
        : Math.sin(clamp01((v - HOLLOW_START_V) / (1 - HOLLOW_START_V)) * (Math.PI / 2));

    // Dedicated Group 1 longitudinal UV: v ∈ [0, 1] from hyponychium boundary (0.40) to free-edge tip (1.0)
    const vUnderside =
      r <= hollowStartRow ? 0 : (r - hollowStartRow) / Math.max(1, rows - hollowStartRow);

    for (let c = 0; c <= cols; c++) {
      const uParam = c / cols; // 0 (left sidewall) .. 1 (right sidewall)
      const s = uParam * 2 - 1; // -1 .. +1
      const x = s * halfW;
      const y = v * lengthRatio;

      // Transverse C-Curve (Arco C = 0.22): center (s=0) sits at 0, sidewalls wrap smoothly in -Z
      // Note: at v=0, u=0.5 (s=0), zCCurve === 0 and apexZ === 0 => zTop === 0 strictly!
      const zCCurve = -C_CURVE_DEPTH * (1 - Math.cos(s * Math.PI * 0.48));
      const zTop = zCCurve + apexZ;

      // Lateral shell thickness tapers cleanly toward sidewalls while staying real/solid at edges
      const edgeMin = v < CUTICLE_FRACTION ? 0.22 : 0.30;
      const lateralTaper =
        edgeMin + (1 - edgeMin) * Math.pow(Math.max(0, Math.sin(Math.PI * uParam)), 0.55);

      // Ventral concave tunnel: center arches upward (+Z) relative to sidewalls to reveal real C-tunnel depth
      const centerConcavity = (1 - s * s) * 0.018 * hollowProgress;
      const zBot = zTop - thickness * lateralTaper + centerConcavity;

      // Clean UV space [0, 1] x [0, 1] aligned with anatomical silhouette for displacementMap & textures
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

  // 2) Ventral surface:
  //    Proximal bed seal (r < hollowStartRow) stays in Group 0;
  //    Distal concave cavity (r >= hollowStartRow, v >= 0.40) goes to Group 1 (underside material).
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
 * Conformal Cuticle & Lateral Sulcus Contact Shadow Skirt (`V9`):
 * Curved thin shell following EXACTLY the proximal cuticle contour (`v ∈ [-0.04, 0.24]`)
 * and lateral nail bed grooves (`v ∈ [0, 0.58]`), seated slightly below (`z - 0.008`)
 * the dorsal plate to render organic AO contact shadow via `MultiplyBlending` with zero flat rectangles.
 */
export function createCuticleContactSkirtGeometry(shape: NailShape): THREE.BufferGeometry {
  const uCols = 32;
  const vRows = 28;
  const stride = uCols + 1;

  const vStart = -0.04;
  const vEnd = DEFAULT_BED_FRACTION; // 0.58

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let r = 0; r <= vRows; r++) {
    const vNorm = r / vRows; // 0 .. 1 across skirt span
    const v = vStart + (vEnd - vStart) * vNorm;
    const vClamped = clamp01(v);

    // Base nail half-width along the contour, flaring gently outward by 7% around cuticle/grooves
    // so the AO gradient feathers softly onto the eponychium and lateral nail folds
    const nailHalfW = evalNailHalfWidth(vClamped, shape, { bedFraction: DEFAULT_BED_FRACTION });
    const skirtHalfW = nailHalfW * 1.075;
    const apexZ = evalGelApexZ(vClamped, 1.0) * 0.35;

    // Parabolic proximal skirt tuck so v = -0.04 wraps around the curved cuticle lunula contour
    const proximalArch = v < 0.24 ? Math.cos(((v + 0.04) / 0.28) * (Math.PI / 2)) : 0;

    for (let c = 0; c <= uCols; c++) {
      const uParam = c / uCols;
      const s = uParam * 2 - 1; // -1 .. +1
      const x = s * skirtHalfW;

      // Subtle parabolic proximal dip at the center vs lateral folds to match real cuticle curvature
      const yContourOffset = -0.018 * (1 - s * s) * Math.max(0, proximalArch);
      const y = v + yContourOffset;

      // Follow the exact C-curve of the finger cylinder, seated 0.008 beneath the dorsal plate
      const zCCurve = -C_CURVE_DEPTH * (1 - Math.cos(s * Math.PI * 0.50));
      const z = zCCurve + apexZ - 0.008;

      positions.push(x, y, z);
      // UV v maps 0 at proximal skin edge (v=-0.04) to 1 at end of bed (v=0.58)
      // while also encoding cuticle band (v <= 0.24) vs lateral sulcus grooves
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
