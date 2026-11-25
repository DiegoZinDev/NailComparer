import * as THREE from 'three';
import type { NailFingerDesignSpec } from './perFingerVisionAnalyzer';

export interface ProceduralPBRBundle {
  specHash: string;
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  displacementMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  metalnessMap: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
  dispose: () => void;
}

const PBR_SIZE = 1024;
const ALPHA_SIZE = 512;
const CACHE_LIMIT = 24;

const pbrBundleCache = new Map<string, ProceduralPBRBundle>();

type CanvasSurface = OffscreenCanvas | HTMLCanvasElement;
type CanvasCtx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeSurface(w: number, h: number): { canvas: CanvasSurface; ctx: CanvasCtx2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const off = new OffscreenCanvas(w, h);
    const ctx = off.getContext('2d', { willReadFrequently: true });
    if (ctx) return { canvas: off, ctx };
  }
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d', { willReadFrequently: true })!;
  return { canvas: el, ctx };
}

function makeTextureSurface(w: number, h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d', { willReadFrequently: true })!;
  return { canvas: el, ctx };
}

function hashShortString(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function hashFingerSpec(spec: NailFingerDesignSpec): string {
  const anchors = spec.strokeAnchors
    .map((a) => `${a.u.toFixed(2)},${a.v.toFixed(2)},${a.radius.toFixed(2)},${a.angle.toFixed(2)}`)
    .join(';');
  const sig = (val?: string) => (val ? `${val.length}:${hashShortString(val)}` : '');
  return [
    spec.pattern,
    spec.baseColor,
    spec.secondaryColor,
    spec.accentColor,
    spec.metallicIntensity.toFixed(2),
    spec.glossIntensity.toFixed(2),
    spec.finishStyle ?? '',
    spec.hasMetallicOutline ? '1' : '0',
    spec.outlineColor ?? '',
    spec.has3DRelief ? '1' : '0',
    anchors,
    sig(spec.uvPatchDataUrl),
    sig(spec.normalMapDataUrl),
    sig(spec.displacementMapDataUrl),
    sig(spec.metalnessMapDataUrl),
    sig(spec.roughnessMapDataUrl),
  ].join('|');
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [225, 185, 175];
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function shadeHex(hex: string, delta: number, alpha = 1): string {
  const [r, g, b] = parseHex(hex);
  const rr = clampByte(r + delta);
  const gg = clampByte(g + delta);
  const bb = clampByte(b + delta);
  return alpha < 1 ? `rgba(${rr},${gg},${bb},${alpha})` : `rgb(${rr},${gg},${bb})`;
}

function mixHex(hexA: string, hexB: string, t: number, alpha = 1): string {
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  const rr = clampByte(r1 * (1 - t) + r2 * t);
  const gg = clampByte(g1 * (1 - t) + g2 * t);
  const bb = clampByte(b1 * (1 - t) + b2 * t);
  return alpha < 1 ? `rgba(${rr},${gg},${bb},${alpha})` : `rgb(${rr},${gg},${bb})`;
}

/**
 * Draws the procedural vector artwork onto Albedo, Heightfield (0..255), and Metalness (0..255) canvases.
 * Used ONLY for studio catalog presets or frame-0 placeholder before `uvPatchDataUrl` loads.
 * Note: Three.js UV convention has `v = 0` at bottom of canvas (cuticle, `y = h`) and `v = 1` at top (`y = 0`).
 */
function paintProceduralLayers(
  spec: NailFingerDesignSpec,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  w: number,
  h: number
): void {
  const base = spec.baseColor || '#E5BEB3';
  const secondary = spec.secondaryColor || '#FFFDF9';
  const accent = spec.accentColor || '#D4AF37';

  // Reset Height (flat gel surface = mid-grey 100) & Metalness (0 = dielectric gel)
  heightCtx.fillStyle = 'rgb(100,100,100)';
  heightCtx.fillRect(0, 0, w, h);

  metalCtx.fillStyle = 'rgb(0,0,0)';
  metalCtx.fillRect(0, 0, w, h);

  // Base gel pigment coat with subtle lunula subsurface warmth near proximal cuticle (bottom y -> h)
  const gelGrad = albedoCtx.createLinearGradient(0, 0, 0, h);
  gelGrad.addColorStop(0, shadeHex(base, 8));
  gelGrad.addColorStop(0.58, base);
  gelGrad.addColorStop(0.86, mixHex(base, '#FFF1EC', 0.16));
  gelGrad.addColorStop(1, shadeHex(base, -10));
  albedoCtx.fillStyle = gelGrad;
  albedoCtx.fillRect(0, 0, w, h);

  // Subtle natural nail lunula glow near cuticle
  const lunula = albedoCtx.createRadialGradient(w * 0.5, h * 0.96, w * 0.04, w * 0.5, h * 0.94, w * 0.34);
  lunula.addColorStop(0, 'rgba(255, 246, 242, 0.24)');
  lunula.addColorStop(1, 'rgba(255, 246, 242, 0)');
  albedoCtx.fillStyle = lunula;
  albedoCtx.fillRect(0, h * 0.65, w, h * 0.35);

  const anchors =
    spec.strokeAnchors.length > 0
      ? spec.strokeAnchors
      : [
          { u: 0.34, v: 0.36, radius: 0.16, angle: 0.35 },
          { u: 0.64, v: 0.58, radius: 0.18, angle: -0.3 },
          { u: 0.48, v: 0.78, radius: 0.14, angle: 0.2 },
        ];

  switch (spec.pattern) {
    case 'chrome_mirror': {
      const mirror = albedoCtx.createLinearGradient(0, 0, w, h);
      mirror.addColorStop(0, shadeHex(base, -14));
      mirror.addColorStop(0.24, secondary);
      mirror.addColorStop(0.48, accent);
      mirror.addColorStop(0.72, '#FFFFFF');
      mirror.addColorStop(1, shadeHex(base, -18));
      albedoCtx.fillStyle = mirror;
      albedoCtx.fillRect(0, 0, w, h);

      const pearlGlow = albedoCtx.createRadialGradient(
        w * 0.42,
        h * 0.38,
        w * 0.04,
        w * 0.5,
        h * 0.46,
        w * 0.62
      );
      pearlGlow.addColorStop(0, 'rgba(255,255,255,0.68)');
      pearlGlow.addColorStop(0.55, 'rgba(248, 232, 224, 0.22)');
      pearlGlow.addColorStop(1, 'rgba(255,255,255,0)');
      albedoCtx.fillStyle = pearlGlow;
      albedoCtx.fillRect(0, 0, w, h);

      const mByte = clampByte(Math.max(0.75, spec.metallicIntensity) * 235);
      metalCtx.fillStyle = `rgb(${mByte},${mByte},${mByte})`;
      metalCtx.fillRect(0, 0, w, h);
      break;
    }

    case 'gold_3d_waves': {
      albedoCtx.save();
      heightCtx.save();
      metalCtx.save();

      const drawRibbon = (
        x0: number,
        y0: number,
        cx1: number,
        cy1: number,
        cx2: number,
        cy2: number,
        x1: number,
        y1: number,
        lineW: number
      ) => {
        albedoCtx.lineCap = 'round';
        albedoCtx.lineJoin = 'round';
        const gGrad = albedoCtx.createLinearGradient(x0, y0, x1, y1);
        gGrad.addColorStop(0, shadeHex(accent, -26));
        gGrad.addColorStop(0.35, accent);
        gGrad.addColorStop(0.55, '#FFF5D6');
        gGrad.addColorStop(0.8, accent);
        gGrad.addColorStop(1, shadeHex(accent, -34));

        albedoCtx.strokeStyle = 'rgba(42, 24, 12, 0.24)';
        albedoCtx.lineWidth = lineW * 1.24;
        albedoCtx.beginPath();
        albedoCtx.moveTo(x0, y0 + lineW * 0.14);
        albedoCtx.bezierCurveTo(cx1, cy1 + lineW * 0.14, cx2, cy2 + lineW * 0.14, x1, y1 + lineW * 0.14);
        albedoCtx.stroke();

        albedoCtx.strokeStyle = gGrad;
        albedoCtx.lineWidth = lineW;
        albedoCtx.beginPath();
        albedoCtx.moveTo(x0, y0);
        albedoCtx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        albedoCtx.stroke();

        albedoCtx.strokeStyle = 'rgba(255, 252, 240, 0.72)';
        albedoCtx.lineWidth = lineW * 0.28;
        albedoCtx.beginPath();
        albedoCtx.moveTo(x0, y0 - lineW * 0.08);
        albedoCtx.bezierCurveTo(cx1, cy1 - lineW * 0.08, cx2, cy2 - lineW * 0.08, x1, y1 - lineW * 0.08);
        albedoCtx.stroke();

        heightCtx.lineCap = 'round';
        heightCtx.strokeStyle = 'rgb(210,210,210)';
        heightCtx.lineWidth = lineW * 1.05;
        heightCtx.beginPath();
        heightCtx.moveTo(x0, y0);
        heightCtx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        heightCtx.stroke();

        heightCtx.strokeStyle = 'rgb(255,255,255)';
        heightCtx.lineWidth = lineW * 0.45;
        heightCtx.beginPath();
        heightCtx.moveTo(x0, y0);
        heightCtx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        heightCtx.stroke();

        metalCtx.lineCap = 'round';
        metalCtx.strokeStyle = 'rgb(230,230,230)';
        metalCtx.lineWidth = lineW * 1.02;
        metalCtx.beginPath();
        metalCtx.moveTo(x0, y0);
        metalCtx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        metalCtx.stroke();
      };

      const a0 = anchors[0];
      const a1 = anchors[1] ?? { u: 0.65, v: 0.56, radius: 0.16, angle: -0.3 };
      const a2 = anchors[2] ?? { u: 0.42, v: 0.76, radius: 0.14, angle: 0.25 };

      drawRibbon(
        w * 0.14,
        h * (1 - a0.v * 0.85),
        w * (a0.u + 0.18),
        h * (1 - a0.v - 0.12),
        w * (a1.u - 0.14),
        h * (1 - a1.v + 0.08),
        w * 0.88,
        h * (1 - a1.v * 0.92),
        w * 0.044
      );

      drawRibbon(
        w * 0.82,
        h * (1 - a2.v * 0.9),
        w * (a2.u + 0.22),
        h * (1 - a2.v + 0.06),
        w * (a0.u - 0.12),
        h * (1 - a0.v - 0.04),
        w * 0.2,
        h * 0.18,
        w * 0.032
      );

      for (const anchor of anchors) {
        const px = anchor.u * w;
        const py = (1 - anchor.v) * h;
        const r = Math.max(w * 0.028, anchor.radius * w * 0.22);

        const dropGrad = albedoCtx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r);
        dropGrad.addColorStop(0, '#FFF7DF');
        dropGrad.addColorStop(0.45, accent);
        dropGrad.addColorStop(1, shadeHex(accent, -36));
        albedoCtx.fillStyle = dropGrad;
        albedoCtx.beginPath();
        albedoCtx.ellipse(px, py, r * 1.15, r * 0.85, anchor.angle, 0, Math.PI * 2);
        albedoCtx.fill();

        const hGrad = heightCtx.createRadialGradient(px, py, 1, px, py, r);
        hGrad.addColorStop(0, 'rgb(255,255,255)');
        hGrad.addColorStop(1, 'rgb(135,135,135)');
        heightCtx.fillStyle = hGrad;
        heightCtx.beginPath();
        heightCtx.ellipse(px, py, r * 1.15, r * 0.85, anchor.angle, 0, Math.PI * 2);
        heightCtx.fill();

        metalCtx.fillStyle = 'rgb(232,232,232)';
        metalCtx.beginPath();
        metalCtx.ellipse(px, py, r * 1.12, r * 0.82, anchor.angle, 0, Math.PI * 2);
        metalCtx.fill();
      }

      albedoCtx.restore();
      heightCtx.restore();
      metalCtx.restore();
      break;
    }

    case 'aura_gradient': {
      const aura = albedoCtx.createRadialGradient(
        w * 0.5,
        h * 0.48,
        w * 0.04,
        w * 0.5,
        h * 0.48,
        h * 0.44
      );
      aura.addColorStop(0, secondary);
      aura.addColorStop(0.38, mixHex(secondary, base, 0.42));
      aura.addColorStop(0.82, base);
      aura.addColorStop(1, shadeHex(base, -12));
      albedoCtx.fillStyle = aura;
      albedoCtx.fillRect(0, 0, w, h);

      const shimmer = albedoCtx.createRadialGradient(
        w * 0.46,
        h * 0.42,
        w * 0.02,
        w * 0.5,
        h * 0.46,
        w * 0.36
      );
      shimmer.addColorStop(0, shadeHex(accent, 25, 0.34));
      shimmer.addColorStop(1, 'rgba(255,255,255,0)');
      albedoCtx.fillStyle = shimmer;
      albedoCtx.fillRect(0, 0, w, h);

      const dust = metalCtx.createRadialGradient(w * 0.5, h * 0.48, 4, w * 0.5, h * 0.48, w * 0.32);
      dust.addColorStop(0, 'rgb(95,95,95)');
      dust.addColorStop(1, 'rgb(0,0,0)');
      metalCtx.fillStyle = dust;
      metalCtx.fillRect(0, 0, w, h);
      break;
    }

    case 'french_tip': {
      const tipY = h * 0.28;
      albedoCtx.save();
      albedoCtx.beginPath();
      albedoCtx.moveTo(0, 0);
      albedoCtx.lineTo(w, 0);
      albedoCtx.lineTo(w, tipY + h * 0.06);
      albedoCtx.quadraticCurveTo(w * 0.5, tipY - h * 0.13, 0, tipY + h * 0.06);
      albedoCtx.closePath();

      const tipGrad = albedoCtx.createLinearGradient(0, 0, w, tipY);
      tipGrad.addColorStop(0, shadeHex(secondary, -8));
      tipGrad.addColorStop(0.5, secondary);
      tipGrad.addColorStop(1, shadeHex(secondary, -8));
      albedoCtx.fillStyle = tipGrad;
      albedoCtx.fill();

      albedoCtx.strokeStyle = accent;
      albedoCtx.globalAlpha = 0.78;
      albedoCtx.lineWidth = w * 0.018;
      albedoCtx.beginPath();
      albedoCtx.moveTo(0, tipY + h * 0.058);
      albedoCtx.quadraticCurveTo(w * 0.5, tipY - h * 0.132, w, tipY + h * 0.058);
      albedoCtx.stroke();
      albedoCtx.restore();

      heightCtx.strokeStyle = 'rgb(168,168,168)';
      heightCtx.lineWidth = w * 0.022;
      heightCtx.beginPath();
      heightCtx.moveTo(0, tipY + h * 0.058);
      heightCtx.quadraticCurveTo(w * 0.5, tipY - h * 0.132, w, tipY + h * 0.058);
      heightCtx.stroke();

      metalCtx.strokeStyle = 'rgb(215,215,215)';
      metalCtx.lineWidth = w * 0.018;
      metalCtx.beginPath();
      metalCtx.moveTo(0, tipY + h * 0.058);
      metalCtx.quadraticCurveTo(w * 0.5, tipY - h * 0.132, w, tipY + h * 0.058);
      metalCtx.stroke();
      break;
    }

    case 'floral_accent': {
      for (const anchor of anchors.slice(0, 3)) {
        const cx = anchor.u * w;
        const cy = (1 - anchor.v) * h;
        const petalDist = Math.max(w * 0.055, anchor.radius * w * 0.58);

        for (let p = 0; p < 5; p++) {
          const theta = anchor.angle + (p * Math.PI * 2) / 5;
          const px = cx + Math.cos(theta) * petalDist * 0.65;
          const py = cy + Math.sin(theta) * petalDist * 0.65;

          const pGrad = albedoCtx.createRadialGradient(px, py, 2, px, py, petalDist * 0.62);
          pGrad.addColorStop(0, '#FFFFFF');
          pGrad.addColorStop(0.65, secondary);
          pGrad.addColorStop(1, shadeHex(secondary, -16, 0.85));
          albedoCtx.fillStyle = pGrad;
          albedoCtx.beginPath();
          albedoCtx.ellipse(px, py, petalDist * 0.54, petalDist * 0.34, theta, 0, Math.PI * 2);
          albedoCtx.fill();

          const hpGrad = heightCtx.createRadialGradient(px, py, 2, px, py, petalDist * 0.56);
          hpGrad.addColorStop(0, 'rgb(205,205,205)');
          hpGrad.addColorStop(1, 'rgb(115,115,115)');
          heightCtx.fillStyle = hpGrad;
          heightCtx.beginPath();
          heightCtx.ellipse(px, py, petalDist * 0.52, petalDist * 0.32, theta, 0, Math.PI * 2);
          heightCtx.fill();
        }

        const coreR = petalDist * 0.28;
        const coreGrad = albedoCtx.createRadialGradient(
          cx - coreR * 0.3,
          cy - coreR * 0.3,
          1,
          cx,
          cy,
          coreR
        );
        coreGrad.addColorStop(0, '#FFF8DF');
        coreGrad.addColorStop(0.5, accent);
        coreGrad.addColorStop(1, shadeHex(accent, -30));
        albedoCtx.fillStyle = coreGrad;
        albedoCtx.beginPath();
        albedoCtx.arc(cx, cy, coreR, 0, Math.PI * 2);
        albedoCtx.fill();

        heightCtx.fillStyle = 'rgb(252,252,252)';
        heightCtx.beginPath();
        heightCtx.arc(cx, cy, coreR, 0, Math.PI * 2);
        heightCtx.fill();

        metalCtx.fillStyle = 'rgb(230,230,230)';
        metalCtx.beginPath();
        metalCtx.arc(cx, cy, coreR, 0, Math.PI * 2);
        metalCtx.fill();
      }
      break;
    }

    case 'solid_gloss':
    default:
      break;
  }
}

/**
 * Multi-scale Scharr/Sobel gradient operator converting a 0..255 heightfield array into
 * tangent-space Normal Map + Bump/Displacement Map ImageData.
 */
function buildNormalAndBumpFromHeightBytes(
  heightBytes: Uint8ClampedArray,
  w: number,
  h: number,
  normalStrength: number,
  normalOut: ImageData,
  bumpOut: ImageData,
  dispOut: ImageData
): void {
  const sampleH = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return heightBytes[(cy * w + cx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p4 = (y * w + x) * 4;

      // 3x3 Scharr operator (higher rotational symmetry than standard Sobel) + 2px micro-relief tap
      const tl = sampleH(x - 1, y - 1);
      const tc = sampleH(x, y - 1);
      const tr = sampleH(x + 1, y - 1);
      const ml = sampleH(x - 1, y);
      const mr = sampleH(x + 1, y);
      const bl = sampleH(x - 1, y + 1);
      const bc = sampleH(x, y + 1);
      const br = sampleH(x + 1, y + 1);

      const gxFine = (3 * tr + 10 * mr + 3 * br - (3 * tl + 10 * ml + 3 * bl)) / 16;
      const gyFine = (3 * bl + 10 * bc + 3 * br - (3 * tl + 10 * tc + 3 * tr)) / 16;

      const gxWide = (sampleH(x + 3, y) - sampleH(x - 3, y)) * 0.5;
      const gyWide = (sampleH(x, y + 3) - sampleH(x, y - 3)) * 0.5;

      const gx = gxFine * 0.72 + gxWide * 0.28;
      const gy = gyFine * 0.72 + gyWide * 0.28;

      const nx = -gx * normalStrength;
      const ny = gy * normalStrength;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      normalOut.data[p4] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      normalOut.data[p4 + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      normalOut.data[p4 + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      normalOut.data[p4 + 3] = 255;

      const hByte = heightBytes[p4];
      bumpOut.data[p4] = hByte;
      bumpOut.data[p4 + 1] = hByte;
      bumpOut.data[p4 + 2] = hByte;
      bumpOut.data[p4 + 3] = 255;

      dispOut.data[p4] = hByte;
      dispOut.data[p4 + 1] = hByte;
      dispOut.data[p4 + 2] = hByte;
      dispOut.data[p4 + 3] = 255;
    }
  }
}

function loadImageOptional(src?: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Synthesizes crystal-clear 1024×1024 PBR maps from `NailFingerDesignSpec`:
 * - Includes `displacementMap`, `normalMap`, `bumpMap`, `roughnessMap`, `metalnessMap`, `alphaMap`.
 * - `alphaMap` (`512×512`) is pure opaque white (`255`) across 96% of the nail, with soft cuticle
 *   feathering EXCLUSIVELY on the proximal 4% (`v ∈ [0, 0.04]`, `y ∈ [0.96*H, H]`) — zero lateral/tip white halo!
 * - Hybrid Imported Reference Mode (`spec.uvPatchDataUrl`):
 *   Renders the real reconstructed UV texture directly onto `albedoMap` (`1024×1024`) preserving 100%
 *   of deep colors, flowers, pearls, and metallic outlines — NEVER overwritten by cartoon templates —
 *   and derives true `displacementMap`, Scharr `normalMap`, `metalnessMap` (`190–255` on metals/caviar beads),
 *   and `roughnessMap` (`0.08–0.16` on gloss/metals, `0.28–0.38` on `velvet_matte`) from the real pixels
 *   (or loads backend-provided PBR maps directly when supplied).
 */
export function synthesizeProceduralPBRBundle(
  spec: NailFingerDesignSpec
): ProceduralPBRBundle {
  const specHash = hashFingerSpec(spec);
  const cached = pbrBundleCache.get(specHash);
  if (cached) return cached;

  const w = PBR_SIZE;
  const h = PBR_SIZE;
  const { canvas: albedoCanvas, ctx: albedoCtx } = makeTextureSurface(w, h);
  const { ctx: heightCtx } = makeSurface(w, h);
  const { canvas: metalCanvas, ctx: metalCtx } = makeTextureSurface(w, h);

  if (spec.uvPatchDataUrl) {
    // Immediate neutral base fill on frame 0 (never cartoon art!) while async image decodes off-RAF
    albedoCtx.fillStyle = spec.baseColor || '#5A0A1E';
    albedoCtx.fillRect(0, 0, w, h);
    heightCtx.fillStyle = 'rgb(100,100,100)';
    heightCtx.fillRect(0, 0, w, h);
    metalCtx.fillStyle = 'rgb(0,0,0)';
    metalCtx.fillRect(0, 0, w, h);
  } else {
    paintProceduralLayers(spec, albedoCtx, heightCtx, metalCtx, w, h);
  }

  const heightPixels = heightCtx.getImageData(0, 0, w, h).data;
  const metalPixels = metalCtx.getImageData(0, 0, w, h).data;

  const { canvas: normalCanvas, ctx: normalCtx } = makeTextureSurface(w, h);
  const normalData = normalCtx.createImageData(w, h);

  const { canvas: bumpCanvas, ctx: bumpCtx } = makeTextureSurface(w, h);
  const bumpData = bumpCtx.createImageData(w, h);

  const { canvas: dispCanvas, ctx: dispCtx } = makeTextureSurface(w, h);
  const dispData = dispCtx.createImageData(w, h);

  const { canvas: roughCanvas, ctx: roughCtx } = makeTextureSurface(w, h);
  const roughData = roughCtx.createImageData(w, h);

  const normalStrength =
    spec.pattern === 'gold_3d_waves' || spec.pattern === 'floral_accent' || spec.has3DRelief
      ? 4.6
      : 2.8;
  const isVelvet =
    spec.finishStyle === 'velvet_matte' || (!spec.finishStyle && spec.glossIntensity < 0.65);
  const baseRough = isVelvet
    ? 0.33
    : spec.pattern === 'chrome_mirror' || spec.finishStyle === 'chrome_mirror'
      ? 0.09
      : 0.13;

  buildNormalAndBumpFromHeightBytes(
    heightPixels,
    w,
    h,
    normalStrength,
    normalData,
    bumpData,
    dispData
  );

  for (let i = 0; i < w * h; i++) {
    const p4 = i * 4;
    const metalVal = metalPixels[p4] / 255;
    const rough = metalVal > 0.5 ? 0.09 : baseRough;
    const roughByte = clampByte(rough * 255);
    roughData.data[p4] = roughByte;
    roughData.data[p4 + 1] = roughByte;
    roughData.data[p4 + 2] = roughByte;
    roughData.data[p4 + 3] = 255;
  }

  normalCtx.putImageData(normalData, 0, 0);
  bumpCtx.putImageData(bumpData, 0, 0);
  dispCtx.putImageData(dispData, 0, 0);
  roughCtx.putImageData(roughData, 0, 0);

  // 512×512 AlphaMap: 100% pure opaque white (255) on 96% of the nail,
  // with soft cuticle feathering EXCLUSIVELY on the proximal 4% (v ∈ [0, 0.04], y ∈ [0.96*H, H]).
  // Zero semi-transparent pixels on lateral sidewalls or free edge -> ZERO white halo!
  const { canvas: alphaCanvas, ctx: alphaCtx } = makeTextureSurface(ALPHA_SIZE, ALPHA_SIZE);
  alphaCtx.fillStyle = 'rgb(255,255,255)';
  alphaCtx.fillRect(0, 0, ALPHA_SIZE, ALPHA_SIZE);

  const cuticleTopY = Math.round(ALPHA_SIZE * 0.96);
  const alphaGrad = alphaCtx.createLinearGradient(0, cuticleTopY, 0, ALPHA_SIZE);
  alphaGrad.addColorStop(0, 'rgb(255,255,255)');
  alphaGrad.addColorStop(0.55, 'rgb(196,196,196)');
  alphaGrad.addColorStop(1, 'rgb(24,24,24)');
  alphaCtx.fillStyle = alphaGrad;
  alphaCtx.fillRect(0, cuticleTopY, ALPHA_SIZE, ALPHA_SIZE - cuticleTopY);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.needsUpdate = true;

  const displacementMap = new THREE.CanvasTexture(dispCanvas);
  displacementMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.needsUpdate = true;

  const metalnessMap = new THREE.CanvasTexture(metalCanvas);
  metalnessMap.needsUpdate = true;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.needsUpdate = true;

  let disposed = false;
  const bundle: ProceduralPBRBundle = {
    specHash,
    map,
    normalMap,
    bumpMap,
    displacementMap,
    roughnessMap,
    metalnessMap,
    alphaMap,
    dispose: () => {
      disposed = true;
      map.dispose();
      normalMap.dispose();
      bumpMap.dispose();
      displacementMap.dispose();
      roughnessMap.dispose();
      metalnessMap.dispose();
      alphaMap.dispose();
    },
  };

  if (pbrBundleCache.size >= CACHE_LIMIT) {
    const oldestKey = pbrBundleCache.keys().next().value;
    if (oldestKey) {
      const oldest = pbrBundleCache.get(oldestKey);
      oldest?.dispose();
      pbrBundleCache.delete(oldestKey);
    }
  }
  pbrBundleCache.set(specHash, bundle);

  // Hybrid True-Fidelity Pipeline for Imported Reference Photos (`spec.uvPatchDataUrl`):
  // Loads the 512x512 or 1024x1024 rectified texture off-RAF, writes it directly onto `albedoMap`
  // (preserving 100% real color, florals, pearls, gold outlines), and synthesizes real relief PBR maps
  // (or loads backend-provided normal/displacement/metalness/roughness maps when present).
  if (spec.uvPatchDataUrl) {
    void (async () => {
      const [patchImg, backendNormal, backendDisp, backendMetal, backendRough] = await Promise.all([
        loadImageOptional(spec.uvPatchDataUrl),
        loadImageOptional(spec.normalMapDataUrl),
        loadImageOptional(spec.displacementMapDataUrl),
        loadImageOptional(spec.metalnessMapDataUrl),
        loadImageOptional(spec.roughnessMapDataUrl),
      ]);

      if (disposed || !patchImg) return;

      // 1. Render real UV texture directly onto 1024×1024 albedoMap (NO cartoon template!)
      albedoCtx.save();
      albedoCtx.clearRect(0, 0, w, h);
      albedoCtx.imageSmoothingEnabled = true;
      albedoCtx.imageSmoothingQuality = 'high';
      albedoCtx.drawImage(patchImg, 0, 0, w, h);

      // Ultra-discreet 3% cuticle-only base-color feathering (v < 0.03) if desired for seamless root melt
      const [baseR, baseG, baseB] = parseHex(spec.baseColor || '#5A0A1E');
      const rootFeatherY = Math.round(h * 0.97);
      const rootGrad = albedoCtx.createLinearGradient(0, rootFeatherY, 0, h);
      rootGrad.addColorStop(0, `rgba(${baseR},${baseG},${baseB},0)`);
      rootGrad.addColorStop(1, `rgba(${baseR},${baseG},${baseB},0.38)`);
      albedoCtx.fillStyle = rootGrad;
      albedoCtx.fillRect(0, rootFeatherY, w, h - rootFeatherY);
      albedoCtx.restore();

      // 2. Work at 512×512 analysis resolution to extract real pixel relief, metallic rims, pearls & caviar beads
      const analysisSize = 512;
      const { ctx: workCtx } = makeSurface(analysisSize, analysisSize);
      workCtx.imageSmoothingEnabled = true;
      workCtx.imageSmoothingQuality = 'high';
      workCtx.drawImage(patchImg, 0, 0, analysisSize, analysisSize);
      const srcData = workCtx.getImageData(0, 0, analysisSize, analysisSize).data;

      const patchLuma = new Float32Array(analysisSize * analysisSize);
      for (let i = 0; i < analysisSize * analysisSize; i++) {
        const p4 = i * 4;
        patchLuma[i] =
          (0.299 * srcData[p4] + 0.587 * srcData[p4 + 1] + 0.114 * srcData[p4 + 2]) / 255;
      }

      const baseLuma = (0.299 * baseR + 0.587 * baseG + 0.114 * baseB) / 255;

      const { ctx: reliefHeightCtx } = makeSurface(analysisSize, analysisSize);
      const { ctx: reliefMetalCtx } = makeSurface(analysisSize, analysisSize);
      const { ctx: reliefRoughCtx } = makeSurface(analysisSize, analysisSize);

      const hPatchImg = reliefHeightCtx.createImageData(analysisSize, analysisSize);
      const mPatchImg = reliefMetalCtx.createImageData(analysisSize, analysisSize);
      const rPatchImg = reliefRoughCtx.createImageData(analysisSize, analysisSize);

      for (let py = 0; py < analysisSize; py++) {
        for (let px = 0; px < analysisSize; px++) {
          const idx = py * analysisSize + px;
          const p4 = idx * 4;
          const r = srcData[p4];
          const g = srcData[p4 + 1];
          const b = srcData[p4 + 2];

          const l = patchLuma[idx];
          const lL = patchLuma[py * analysisSize + Math.max(0, px - 1)];
          const lR = patchLuma[py * analysisSize + Math.min(analysisSize - 1, px + 1)];
          const lU = patchLuma[Math.max(0, py - 1) * analysisSize + px];
          const lD = patchLuma[Math.min(analysisSize - 1, py + 1) * analysisSize + px];
          const grad = Math.hypot(lR - lL, lD - lU);
          const localAvg = (lL + lR + lU + lD) * 0.25;
          const highFreq = Math.abs(l - localAvg);

          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

          // Precision detection of warm gold, champagne metallic waves, silver/chrome, caviar beads & pearls
          const isWarmGold = r > g * 1.04 && g > b * 1.14 && l > 0.34 && sat > 0.18;
          const isSilverChrome =
            sat < 0.18 && l > 0.66 && (grad > 0.08 || highFreq > 0.035 || l - baseLuma > 0.24);
          const isPearlOrBead = l > 0.74 && (grad > 0.07 || highFreq > 0.03);
          const chromaDiff =
            (Math.abs(r - baseR) + Math.abs(g - baseG) + Math.abs(b - baseB)) / (255 * 3);
          const isSculptedFloral = chromaDiff > 0.16 && (grad > 0.05 || highFreq > 0.022 || l > baseLuma + 0.12);

          const isMetallicDetail = isWarmGold || isSilverChrome || isPearlOrBead;

          // Real relief height 0..255: flat gel ~92, sculpted floral petals ~145..205, 3D gold/pearls ~195..255
          const reliefStrength = Math.min(
            1,
            (isMetallicDetail ? 0.56 : 0) +
              (isSculptedFloral ? 0.28 : 0) +
              grad * 2.4 +
              highFreq * 4.8 +
              (chromaDiff > 0.20 ? 0.18 : 0)
          );
          const hVal = clampByte(92 + reliefStrength * 163);
          hPatchImg.data[p4] = hVal;
          hPatchImg.data[p4 + 1] = hVal;
          hPatchImg.data[p4 + 2] = hVal;
          hPatchImg.data[p4 + 3] = 255;

          // Metalness 190..255 strictly over gold/silver/metallic/caviar beads
          const mVal = isMetallicDetail
            ? clampByte(190 + Math.min(1, grad * 1.8 + (isWarmGold ? 0.45 : 0.3)) * 65)
            : spec.pattern === 'chrome_mirror' || spec.finishStyle === 'chrome_mirror'
              ? 210
              : 0;
          mPatchImg.data[p4] = mVal;
          mPatchImg.data[p4 + 1] = mVal;
          mPatchImg.data[p4 + 2] = mVal;
          mPatchImg.data[p4 + 3] = 255;

          // Roughness: 0.08..0.16 on metals & glossy gel, 0.28..0.38 on velvet_matte
          const roughFloat = isMetallicDetail
            ? Math.max(0.08, Math.min(0.16, 0.15 - grad * 0.25))
            : isVelvet
              ? Math.max(0.28, Math.min(0.38, 0.34 - grad * 0.12))
              : Math.max(0.09, Math.min(0.16, 0.13 - grad * 0.10));
          const rVal = clampByte(roughFloat * 255);
          rPatchImg.data[p4] = rVal;
          rPatchImg.data[p4 + 1] = rVal;
          rPatchImg.data[p4 + 2] = rVal;
          rPatchImg.data[p4 + 3] = 255;
        }
      }

      reliefHeightCtx.putImageData(hPatchImg, 0, 0);
      reliefMetalCtx.putImageData(mPatchImg, 0, 0);
      reliefRoughCtx.putImageData(rPatchImg, 0, 0);

      // 3. Upscale/apply height (displacementMap), metalnessMap, roughnessMap & normalMap onto 1024×1024
      const { ctx: upHeightCtx } = makeSurface(w, h);
      upHeightCtx.imageSmoothingEnabled = true;
      upHeightCtx.imageSmoothingQuality = 'high';
      if (backendDisp) {
        upHeightCtx.drawImage(backendDisp, 0, 0, w, h);
      } else {
        upHeightCtx.drawImage(
          reliefHeightCtx.canvas as CanvasImageSource,
          0,
          0,
          analysisSize,
          analysisSize,
          0,
          0,
          w,
          h
        );
      }
      const upHeightData = upHeightCtx.getImageData(0, 0, w, h).data;

      metalCtx.save();
      metalCtx.imageSmoothingEnabled = true;
      metalCtx.imageSmoothingQuality = 'high';
      if (backendMetal) {
        metalCtx.drawImage(backendMetal, 0, 0, w, h);
      } else {
        metalCtx.drawImage(
          reliefMetalCtx.canvas as CanvasImageSource,
          0,
          0,
          analysisSize,
          analysisSize,
          0,
          0,
          w,
          h
        );
      }
      metalCtx.restore();

      roughCtx.save();
      roughCtx.imageSmoothingEnabled = true;
      roughCtx.imageSmoothingQuality = 'high';
      if (backendRough) {
        roughCtx.drawImage(backendRough, 0, 0, w, h);
      } else {
        roughCtx.drawImage(
          reliefRoughCtx.canvas as CanvasImageSource,
          0,
          0,
          analysisSize,
          analysisSize,
          0,
          0,
          w,
          h
        );
      }
      roughCtx.restore();

      if (backendNormal) {
        normalCtx.drawImage(backendNormal, 0, 0, w, h);
        for (let i = 0; i < w * h; i++) {
          const p4 = i * 4;
          const hb = upHeightData[p4];
          bumpData.data[p4] = hb;
          bumpData.data[p4 + 1] = hb;
          bumpData.data[p4 + 2] = hb;
          bumpData.data[p4 + 3] = 255;

          dispData.data[p4] = hb;
          dispData.data[p4 + 1] = hb;
          dispData.data[p4 + 2] = hb;
          dispData.data[p4 + 3] = 255;
        }
        bumpCtx.putImageData(bumpData, 0, 0);
        dispCtx.putImageData(dispData, 0, 0);
      } else {
        buildNormalAndBumpFromHeightBytes(
          upHeightData,
          w,
          h,
          4.2,
          normalData,
          bumpData,
          dispData
        );
        normalCtx.putImageData(normalData, 0, 0);
        bumpCtx.putImageData(bumpData, 0, 0);
        dispCtx.putImageData(dispData, 0, 0);
      }

      // Upload all updated PBR textures cleanly outside RAF
      map.needsUpdate = true;
      normalMap.needsUpdate = true;
      bumpMap.needsUpdate = true;
      displacementMap.needsUpdate = true;
      roughnessMap.needsUpdate = true;
      metalnessMap.needsUpdate = true;
    })();
  }

  return bundle;
}

function traceNailSilhouette(
  ctx: CanvasRenderingContext2D,
  shape: NailFingerDesignSpec['shape'],
  outW: number,
  outH: number
): { padX: number; padY: number; topY: number; bottomY: number } {
  const padX = outW * 0.14;
  const padY = outH * 0.08;
  const w = outW - padX * 2;
  const h = outH - padY * 2;
  const cx = outW / 2;
  const bottomY = outH - padY;
  const topY = padY;

  ctx.beginPath();
  if (shape === 'square') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.lineTo(cx - w * 0.48, topY + h * 0.06);
    ctx.quadraticCurveTo(cx - w * 0.48, topY, cx - w * 0.34, topY);
    ctx.lineTo(cx + w * 0.34, topY);
    ctx.quadraticCurveTo(cx + w * 0.48, topY, cx + w * 0.48, topY + h * 0.06);
    ctx.lineTo(cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else if (shape === 'coffin') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.5, bottomY - h * 0.45, cx - w * 0.36, topY + h * 0.2, cx - w * 0.24, topY);
    ctx.lineTo(cx + w * 0.24, topY);
    ctx.bezierCurveTo(cx + w * 0.36, topY + h * 0.2, cx + w * 0.5, bottomY - h * 0.45, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else if (shape === 'stiletto') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.48, bottomY - h * 0.44, cx - w * 0.24, topY + h * 0.18, cx, topY);
    ctx.bezierCurveTo(cx + w * 0.24, topY + h * 0.18, cx + w * 0.48, bottomY - h * 0.44, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else if (shape === 'natural') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.48, bottomY - h * 0.48, cx - w * 0.42, topY + h * 0.08, cx, topY + h * 0.05);
    ctx.bezierCurveTo(cx + w * 0.42, topY + h * 0.08, cx + w * 0.48, bottomY - h * 0.48, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else {
    // Almond / Oval
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.5, bottomY - h * 0.46, cx - w * 0.34, topY + h * 0.1, cx, topY);
    ctx.bezierCurveTo(cx + w * 0.34, topY + h * 0.1, cx + w * 0.5, bottomY - h * 0.46, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  }
  ctx.closePath();
  return { padX, padY, topY, bottomY };
}

function applyNailSilhouetteLighting(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  padX: number,
  topY: number,
  bottomY: number
): void {
  const cyl = ctx.createLinearGradient(padX, 0, outW - padX, 0);
  cyl.addColorStop(0, 'rgba(18, 10, 12, 0.28)');
  cyl.addColorStop(0.2, 'rgba(255, 255, 255, 0.06)');
  cyl.addColorStop(0.8, 'rgba(255, 255, 255, 0.02)');
  cyl.addColorStop(1, 'rgba(18, 10, 12, 0.30)');
  ctx.fillStyle = cyl;
  ctx.fillRect(0, 0, outW, outH);

  const gloss = ctx.createLinearGradient(outW * 0.28, topY, outW * 0.52, bottomY * 0.7);
  gloss.addColorStop(0, 'rgba(255,255,255,0.48)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.10)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.ellipse(outW * 0.39, outH * 0.42, outW * 0.072, outH * 0.24, -0.08, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Renders a crystal-clear 180×260 preview DataURL of the nail.
 * If `spec.uvPatchDataUrl` is present, synchronously embeds the real UV patch inside an SVG nail
 * silhouette with C-curve shading & gel specular highlight (never brown generic templates!).
 * Otherwise renders the procedural vector swatch onto a Canvas.
 */
export function renderProceduralNailSwatchDataUrl(
  spec: NailFingerDesignSpec,
  outW = 180,
  outH = 260
): string {
  if (spec.uvPatchDataUrl) {
    const padX = outW * 0.14;
    const padY = outH * 0.08;
    const w = outW - padX * 2;
    const h = outH - padY * 2;
    const cx = outW / 2;
    const bottomY = outH - padY;
    const topY = padY;

    let pathD = '';
    if (spec.shape === 'square') {
      pathD = `M ${cx - w * 0.44} ${bottomY - h * 0.12} L ${cx - w * 0.48} ${topY + h * 0.06} Q ${cx - w * 0.48} ${topY} ${cx - w * 0.34} ${topY} L ${cx + w * 0.34} ${topY} Q ${cx + w * 0.48} ${topY} ${cx + w * 0.48} ${topY + h * 0.06} L ${cx + w * 0.44} ${bottomY - h * 0.12} Q ${cx} ${bottomY + h * 0.04} ${cx - w * 0.44} ${bottomY - h * 0.12} Z`;
    } else if (spec.shape === 'coffin') {
      pathD = `M ${cx - w * 0.44} ${bottomY - h * 0.12} C ${cx - w * 0.5} ${bottomY - h * 0.45}, ${cx - w * 0.36} ${topY + h * 0.2}, ${cx - w * 0.24} ${topY} L ${cx + w * 0.24} ${topY} C ${cx + w * 0.36} ${topY + h * 0.2}, ${cx + w * 0.5} ${bottomY - h * 0.45}, ${cx + w * 0.44} ${bottomY - h * 0.12} Q ${cx} ${bottomY + h * 0.04} ${cx - w * 0.44} ${bottomY - h * 0.12} Z`;
    } else if (spec.shape === 'stiletto') {
      pathD = `M ${cx - w * 0.44} ${bottomY - h * 0.12} C ${cx - w * 0.48} ${bottomY - h * 0.44}, ${cx - w * 0.24} ${topY + h * 0.18}, ${cx} ${topY} C ${cx + w * 0.24} ${topY + h * 0.18}, ${cx + w * 0.48} ${bottomY - h * 0.44}, ${cx + w * 0.44} ${bottomY - h * 0.12} Q ${cx} ${bottomY + h * 0.04} ${cx - w * 0.44} ${bottomY - h * 0.12} Z`;
    } else if (spec.shape === 'natural') {
      pathD = `M ${cx - w * 0.44} ${bottomY - h * 0.12} C ${cx - w * 0.48} ${bottomY - h * 0.48}, ${cx - w * 0.42} ${topY + h * 0.08}, ${cx} ${topY + h * 0.05} C ${cx + w * 0.42} ${topY + h * 0.08}, ${cx + w * 0.48} ${bottomY - h * 0.48}, ${cx + w * 0.44} ${bottomY - h * 0.12} Q ${cx} ${bottomY + h * 0.04} ${cx - w * 0.44} ${bottomY - h * 0.12} Z`;
    } else {
      pathD = `M ${cx - w * 0.44} ${bottomY - h * 0.12} C ${cx - w * 0.5} ${bottomY - h * 0.46}, ${cx - w * 0.34} ${topY + h * 0.1}, ${cx} ${topY} C ${cx + w * 0.34} ${topY + h * 0.1}, ${cx + w * 0.5} ${bottomY - h * 0.46}, ${cx + w * 0.44} ${bottomY - h * 0.12} Q ${cx} ${bottomY + h * 0.04} ${cx - w * 0.44} ${bottomY - h * 0.12} Z`;
    }

    const escapedHref = spec.uvPatchDataUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">
  <defs>
    <clipPath id="nailClip"><path d="${pathD}"/></clipPath>
    <linearGradient id="cCurve" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgb(18,10,12)" stop-opacity="0.30"/>
      <stop offset="22%" stop-color="rgb(255,255,255)" stop-opacity="0.06"/>
      <stop offset="78%" stop-color="rgb(255,255,255)" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="rgb(18,10,12)" stop-opacity="0.32"/>
    </linearGradient>
    <linearGradient id="gelGloss" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="white" stop-opacity="0.48"/>
      <stop offset="48%" stop-color="white" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#nailClip)">
    <rect x="0" y="0" width="${outW}" height="${outH}" fill="${spec.baseColor || '#5A0A1E'}"/>
    <image href="${escapedHref}" x="${padX * 0.72}" y="${padY * 0.6}" width="${outW - padX * 1.44}" height="${outH - padY * 1.2}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="0" y="0" width="${outW}" height="${outH}" fill="url(#cCurve)"/>
    <ellipse cx="${outW * 0.39}" cy="${outH * 0.42}" rx="${outW * 0.072}" ry="${outH * 0.24}" transform="rotate(-5 ${outW * 0.39} ${outH * 0.42})" fill="url(#gelGloss)"/>
  </g>
</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  const { canvas, ctx } = makeTextureSurface(outW, outH);
  const { ctx: dummyHeight } = makeSurface(outW, outH);
  const { ctx: dummyMetal } = makeSurface(outW, outH);

  ctx.clearRect(0, 0, outW, outH);

  ctx.save();
  const { padX, topY, bottomY } = traceNailSilhouette(ctx, spec.shape, outW, outH);
  ctx.clip();

  paintProceduralLayers(spec, ctx, dummyHeight, dummyMetal, outW, outH);
  applyNailSilhouetteLighting(ctx, outW, outH, padX, topY, bottomY);
  ctx.restore();

  return canvas.toDataURL('image/png', 0.92);
}
