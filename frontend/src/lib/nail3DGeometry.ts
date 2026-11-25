import * as THREE from 'three';
import type { NailShape } from '../types/nail';

const COLS = 24;
const ROWS = 30;

/**
 * Evaluates half-width profile (0 .. 0.5) along longitudinal parameter v ∈ [0, 1]
 * (v = 0 is proximal cuticle base, v = 1 is distal free edge) for all 5 salon shapes.
 */
export function evalNailHalfWidth(v: number, shape: NailShape): number {
  const cuticleCurve =
    v < 0.14 ? 0.30 + 0.20 * Math.sin((v / 0.14) * (Math.PI / 2)) : 0.5;

  // Keep 100% of full base width across the entire natural nail bed (v <= 0.55)
  // so no side skin is ever exposed; lateral tapering begins strictly past v > 0.55.
  if (v <= 0.55) {
    return cuticleCurve;
  }

  if (shape === 'natural') {
    if (v > 0.68) {
      const t = (v - 0.68) / 0.32;
      return 0.5 * Math.sqrt(Math.max(0.02, 1 - t * t));
    }
    return 0.5;
  }

  if (shape === 'square') {
    if (v > 0.92) {
      const t = (v - 0.92) / 0.08;
      return 0.5 * (1 - 0.12 * t * t);
    }
    return 0.5;
  }

  if (shape === 'coffin') {
    const t = (v - 0.55) / 0.45;
    const base = 0.5 * (1 - 0.48 * Math.pow(t, 1.15));
    return v > 0.96 ? base * (1 - ((v - 0.96) / 0.04) * 0.10) : base;
  }

  if (shape === 'stiletto') {
    const t = (v - 0.55) / 0.45;
    return Math.max(0.028, 0.5 * Math.pow(1 - t, 1.18));
  }

  // Almond (default)
  const t = (v - 0.55) / 0.45;
  return Math.max(0.035, 0.5 * Math.pow(Math.cos(t * (Math.PI / 2)), 0.72));
}

/**
 * Computes longitudinal Gel Apex (Ápice estrutural) elevation along v ∈ [0, 1].
 * Rises swiftly past the cuticle emergence (v >= 0.14) to apex peak (v ≈ 0.38)
 * so the dorsal body clears the finger capsule cleanly, tapering smoothly to free edge (v = 1).
 */
function evalGelApexZ(v: number, lengthRatio: number): number {
  const apexPeak = 0.38;
  const apexHeight = 0.098 * Math.min(1.35, Math.max(0.85, lengthRatio));
  if (v <= apexPeak) {
    const t = v / apexPeak;
    return apexHeight * Math.pow(Math.sin(t * (Math.PI / 2)), 0.72);
  }
  const t = (v - apexPeak) / (1 - apexPeak);
  return apexHeight * (1 - 0.44 * Math.pow(t, 1.35));
}

/**
 * Evaluates sculpted gel thickness (between dorsal and ventral shells).
 * ≈ 0.048 at structural apex, ≈ 0.036 at free edge, tapering softly at cuticle (v = 0).
 */
function evalShellThickness(v: number): number {
  if (v < 0.14) {
    const t = v / 0.14;
    return 0.010 + 0.038 * (t * t * (3 - 2 * t));
  }
  if (v <= 0.38) {
    return 0.048;
  }
  const t = (v - 0.38) / 0.62;
  return 0.048 - 0.012 * t;
}

/**
 * Volumetric 3D Nail Mesh with Real Hollow/Concave Underside (V8):
 * Returns a multi-material closed 3D `THREE.BufferGeometry` with 2 geometry groups:
 * - Group 0 (`materialIndex: 0`): Dorsal sculpted gel shell (24 × 30 grid) + closed lateral, proximal & free-edge thickness walls
 * - Group 1 (`materialIndex: 1`): Concave hollowed underside (`v ∈ [0.36, 1.0]`) arching inward along the transverse C-curve
 *   with continuous subtle lateral sidewall thickness so sideways / palm-facing tilts reveal an authentic sculpted gel underside!
 *
 * Local coordinate convention:
 * - Origin `(0, 0, 0)` is centered at the proximal cuticle base
 * - `+Y` grows distally from cuticle (`y = 0`) to free-edge tip (`y = lengthRatio`)
 * - `X` spans width `[-0.5, +0.5]`
 * - `+Z` points outward dorsally from the nail bed
 */
export function createVolumetricNailGeometry(
  shape: NailShape,
  lengthRatio = 1.0
): THREE.BufferGeometry {
  const cCurveDepth = 0.19;
  const cols = COLS;
  const rows = ROWS;
  const stride = cols + 1;
  const gridVertexCount = (rows + 1) * stride;
  const hollowStartRow = Math.round(rows * 0.36); // v ~ 0.36 starts smooth concave underside

  const topPositions: number[] = [];
  const topUVs: number[] = [];
  const botPositions: number[] = [];
  const botUVs: number[] = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows; // 0 = cuticle, 1 = free edge
    const halfW = evalNailHalfWidth(v, shape);
    const apexZ = evalGelApexZ(v, lengthRatio);
    const thickness = evalShellThickness(v);

    // Ultra-gentle cuticle seating (<= 0.015) so cuticle seats organically without sinking into Z-buffer
    const cuticleTuck =
      v < 0.14
        ? -0.014 * Math.pow(Math.cos((v / 0.14) * (Math.PI / 2)), 1.4)
        : 0;

    // Smooth concave hollow arch beneath the free edge (v ∈ [0.36, 1.0])
    const hollowProgress =
      v <= 0.36 ? 0 : Math.sin(Math.min(1, (v - 0.36) / 0.64) * (Math.PI / 2));

    // Clean longitudinal UV for Group 1 underside: v ∈ [0, 1] from hyponychium base to free-edge tip
    const vUnderside =
      r <= hollowStartRow ? 0 : (r - hollowStartRow) / Math.max(1, rows - hollowStartRow);

    for (let c = 0; c <= cols; c++) {
      const uParam = c / cols; // 0 (left lateral edge) .. 1 (right lateral edge)
      const s = uParam * 2 - 1; // -1 .. +1
      const x = s * halfW;
      const y = v * lengthRatio;

      // Subtle continuous lateral edge thickness (never paper-thin 0 at u=0/1)
      const edgeMin = v < 0.14 ? 0.18 : 0.28;
      const lateralTaper =
        edgeMin + (1 - edgeMin) * Math.pow(Math.max(0, Math.sin(Math.PI * uParam)), 0.55);

      // Transverse C-Curve (Arco C)
      const zCCurve = -cCurveDepth * (1 - Math.cos(s * Math.PI * 0.48));
      const zTop = zCCurve + apexZ + cuticleTuck;

      // Ventral concave hollow: center arches gently upward (+Z) relative to sidewalls for authentic C-tunnel depth
      const centerConcavity = (1 - s * s) * 0.016 * hollowProgress;
      const zBot = zTop - thickness * lateralTaper + centerConcavity;

      const uTop = Math.max(0.01, Math.min(0.99, 0.5 + x * 0.96));
      const vTop = v;

      topPositions.push(x, y, zTop);
      topUVs.push(uTop, vTop);

      botPositions.push(x, y, zBot);
      // Group 1 underside UVs cover clean u ∈ [0, 1] (left->right) and v ∈ [0, 1] (hyponychium->free tip)
      botUVs.push(uParam, vUnderside);
    }
  }

  const positions: number[] = [...topPositions, ...botPositions];
  const uvs: number[] = [...topUVs, ...botUVs];
  const group0Indices: number[] = [];
  const group1Indices: number[] = [];

  // 1) Top dorsal surface (Group 0)
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

  // 2) Bottom ventral surface:
  //    Proximal bed contact cap (r < hollowStartRow) stays in Group 0;
  //    Distal hollowed free-edge underside (r >= hollowStartRow) goes to Group 1 (milky translucent gel)!
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

  // Dedicated duplicated vertices for crisp free-edge, lateral, & proximal thickness wall normals (Group 0)
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

  // 3) Distal free-edge rim wall (r = rows, walking c = cols -> 0)
  for (let c = cols; c > 0; c--) {
    const t0 = rows * stride + c;
    const t1 = rows * stride + (c - 1);
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // 4) Proximal cuticle base cap (r = 0, walking c = 0 -> cols)
  for (let c = 0; c < cols; c++) {
    const t0 = c;
    const t1 = c + 1;
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // 5) Left lateral thickness wall (c = 0, walking r = rows -> 0)
  for (let r = rows; r > 0; r--) {
    const t0 = r * stride;
    const t1 = (r - 1) * stride;
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // 6) Right lateral thickness wall (c = cols, walking r = 0 -> rows)
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
 * Backward-compatible alias for `createVolumetricNailGeometry`.
 */
export function createNail3DGeometry(
  shape: NailShape,
  lengthRatio = 1.0
): THREE.BufferGeometry {
  return createVolumetricNailGeometry(shape, lengthRatio);
}
