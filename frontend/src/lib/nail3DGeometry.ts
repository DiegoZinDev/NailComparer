import * as THREE from 'three';
import type { NailShape } from '../types/nail';

const COLS = 24;
const ROWS = 30;

/**
 * Evaluates half-width profile (0 .. 0.5) along longitudinal parameter v ∈ [0, 1]
 * (v = 0 is proximal cuticle base, v = 1 is distal free edge) for all 5 salon shapes.
 */
export function evalNailHalfWidth(v: number, shape: NailShape): number {
  // Proximal cuticle arch (v = 0..0.18) smoothly widens from 0.22 -> 0.50
  const cuticleCurve =
    v < 0.18 ? 0.22 + 0.28 * Math.sin((v / 0.18) * (Math.PI / 2)) : 0.5;

  if (shape === 'natural') {
    if (v > 0.68) {
      const t = (v - 0.68) / 0.32;
      return 0.5 * Math.sqrt(Math.max(0.02, 1 - t * t));
    }
    return cuticleCurve;
  }

  if (shape === 'square') {
    if (v > 0.92) {
      const t = (v - 0.92) / 0.08;
      return 0.48 * (1 - 0.14 * t * t);
    }
    return Math.min(0.49, cuticleCurve * 0.98);
  }

  if (shape === 'coffin') {
    if (v > 0.34) {
      const t = (v - 0.34) / 0.66;
      const base = 0.5 * (1 - 0.46 * Math.pow(t, 1.18));
      return v > 0.96 ? base * (1 - ((v - 0.96) / 0.04) * 0.12) : base;
    }
    return cuticleCurve;
  }

  if (shape === 'stiletto') {
    if (v > 0.28) {
      const t = (v - 0.28) / 0.72;
      return Math.max(0.022, 0.5 * Math.pow(1 - t, 1.15));
    }
    return cuticleCurve;
  }

  // Almond (default)
  if (v > 0.38) {
    const t = (v - 0.38) / 0.62;
    return Math.max(0.03, 0.5 * Math.pow(Math.cos(t * (Math.PI / 2)), 0.78));
  }
  return cuticleCurve;
}

/**
 * Computes longitudinal Gel Apex (Ápice estrutural) elevation along v ∈ [0, 1].
 * Rises cleanly from cuticle (v=0) to apex peak (v≈0.38) and tapers smoothly to free edge (v=1).
 */
function evalGelApexZ(v: number, lengthRatio: number): number {
  const apexPeak = 0.38;
  const apexHeight = 0.068 * Math.min(1.35, Math.max(0.85, lengthRatio));
  if (v <= apexPeak) {
    const t = v / apexPeak;
    return apexHeight * Math.sin(t * (Math.PI / 2));
  }
  const t = (v - apexPeak) / (1 - apexPeak);
  return apexHeight * (1 - 0.52 * Math.pow(t, 1.35));
}

/**
 * Evaluates sculpted gel thickness (between dorsal and ventral shells).
 * ≈ 0.045 at structural apex, ≈ 0.032 at free edge, tapering softly at cuticle.
 */
function evalShellThickness(v: number): number {
  if (v < 0.14) {
    const t = v / 0.14;
    return 0.012 + 0.033 * (t * t * (3 - 2 * t));
  }
  if (v <= 0.38) {
    return 0.045;
  }
  const t = (v - 0.38) / 0.62;
  return 0.045 - 0.013 * t;
}

/**
 * Parametric Anatomical 3D Nail Mesh (V4):
 * Generates a closed 3D solid shell (`THREE.BufferGeometry`) with:
 * - Top dorsal surface (24 x 30 grid) featuring transverse C-Curve (`z_cCurve`) & Gel Apex arch
 * - Underside ventral surface offset by real sculpted gel thickness (0.045 apex -> 0.032 free edge)
 * - Closed stitched lateral & free-edge rim walls so tilted 3D hand poses show true nail thickness
 * - Conformal distortion-free UVs (`u ∈ [0, 1]`, `v ∈ [0, 1]`) and smooth recomputed vertex normals
 *
 * Local coordinate convention:
 * - Origin `(0, 0, 0)` is centered at the proximal cuticle base
 * - `+Y` grows distally from cuticle (`y = 0`) to free-edge tip (`y = lengthRatio`)
 * - `X` spans width `[-0.5, +0.5]`
 * - `+Z` points outward dorsally from the nail bed
 */
export function createNail3DGeometry(
  shape: NailShape,
  lengthRatio = 1.0
): THREE.BufferGeometry {
  const cCurveDepth = 0.18;
  const cols = COLS;
  const rows = ROWS;
  const stride = cols + 1;
  const gridVertexCount = (rows + 1) * stride;

  // Vertex pools:
  // [0 .. gridVertexCount - 1]: Dorsal top surface
  // [gridVertexCount .. 2 * gridVertexCount - 1]: Ventral underside surface
  // Plus dedicated rim ring vertices for crisp side-wall & free-edge normals
  const topPositions: number[] = [];
  const topUVs: number[] = [];
  const botPositions: number[] = [];
  const botUVs: number[] = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows; // 0 = cuticle, 1 = free edge
    const halfW = evalNailHalfWidth(v, shape);
    const apexZ = evalGelApexZ(v, lengthRatio);
    const thickness = evalShellThickness(v);

    for (let c = 0; c <= cols; c++) {
      const s = (c / cols) * 2 - 1; // -1 .. +1
      const x = s * halfW;
      const y = v * lengthRatio;

      // Transverse C-Curve (Arco C)
      const zCCurve = -cCurveDepth * (1 - Math.cos(s * Math.PI * 0.48));
      const zTop = zCCurve + apexZ;
      const zBot = zTop - thickness;

      // Conformal UV mapping (Three.js v=0 is bottom/cuticle, v=1 is top/free edge)
      const uTex = Math.max(0.01, Math.min(0.99, 0.5 + x * 0.96));
      const vTex = v;

      topPositions.push(x, y, zTop);
      topUVs.push(uTex, vTex);

      botPositions.push(x, y, zBot);
      botUVs.push(uTex, vTex);
    }
  }

  const positions: number[] = [...topPositions, ...botPositions];
  const uvs: number[] = [...topUVs, ...botUVs];
  const indices: number[] = [];

  // 1) Top dorsal triangles (CCW when viewed from +Z)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bl = r * stride + c;
      const br = bl + 1;
      const tl = bl + stride;
      const tr = tl + 1;
      indices.push(bl, br, tr);
      indices.push(bl, tr, tl);
    }
  }

  // 2) Bottom ventral triangles (CCW when viewed from -Z)
  const botOffset = gridVertexCount;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bl = botOffset + r * stride + c;
      const br = bl + 1;
      const tl = bl + stride;
      const tr = tl + 1;
      indices.push(bl, tr, br);
      indices.push(bl, tl, tr);
    }
  }

  // Helper to stitch a rim strip with duplicated vertices so side walls have clean normals
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
    // Outward winding: topA -> botA -> botB -> topB
    indices.push(base, base + 2, base + 3);
    indices.push(base, base + 3, base + 1);
  };

  // 3) Right lateral rim wall (c = cols, walking r = 0 -> rows)
  for (let r = 0; r < rows; r++) {
    const t0 = r * stride + cols;
    const t1 = (r + 1) * stride + cols;
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // 4) Distal free-edge rim wall (r = rows, walking c = cols -> 0)
  for (let c = cols; c > 0; c--) {
    const t0 = rows * stride + c;
    const t1 = rows * stride + (c - 1);
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  // 5) Left lateral rim wall (c = 0, walking r = rows -> 0)
  for (let r = rows; r > 0; r--) {
    const t0 = r * stride;
    const t1 = (r - 1) * stride;
    pushRimQuad(t0, t1, botOffset + t0, botOffset + t1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}
