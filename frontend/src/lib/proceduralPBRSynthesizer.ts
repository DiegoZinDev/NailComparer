import * as THREE from 'three';
import type { NailFingerDesignSpec } from '../types/nail';

export interface ProceduralPBRBundle {
  specHash: string;
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
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

export function hashFingerSpec(spec: NailFingerDesignSpec): string {
  const anchors = spec.strokeAnchors
    .map((a) => `${a.u.toFixed(2)},${a.v.toFixed(2)},${a.radius.toFixed(2)},${a.angle.toFixed(2)}`)
    .join(';');
  return [
    spec.pattern,
    spec.baseColor,
    spec.secondaryColor,
    spec.accentColor,
    spec.metallicIntensity.toFixed(2),
    spec.glossIntensity.toFixed(2),
    anchors,
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
      // Clean translucent gel base + sculpted 3D vector gold/chrome organic ribbons anchored to strokeAnchors
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
        // Albedo metallic gold ribbon with specular core
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

        // Crisp inner highlight ridge
        albedoCtx.strokeStyle = 'rgba(255, 252, 240, 0.72)';
        albedoCtx.lineWidth = lineW * 0.28;
        albedoCtx.beginPath();
        albedoCtx.moveTo(x0, y0 - lineW * 0.08);
        albedoCtx.bezierCurveTo(cx1, cy1 - lineW * 0.08, cx2, cy2 - lineW * 0.08, x1, y1 - lineW * 0.08);
        albedoCtx.stroke();

        // Sculpted 3D heightfield ridge (220 -> 255)
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

        // Metalness mask (0.90 -> rgb(230,230,230))
        metalCtx.lineCap = 'round';
        metalCtx.strokeStyle = 'rgb(230,230,230)';
        metalCtx.lineWidth = lineW * 1.02;
        metalCtx.beginPath();
        metalCtx.moveTo(x0, y0);
        metalCtx.bezierCurveTo(cx1, cy1, cx2, cy2, x1, y1);
        metalCtx.stroke();
      };

      // Primary sweeping sculptural wave anchored through detected strokeAnchors
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

      // Raised molten-gold droplets at strokeAnchors
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
      // Ethereal airbrushed radial aura bloom centered on nail plate
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

      // Soft pearlescent micro-shimmer veil
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

      // Soft metallic micro-dust in center
      const dust = metalCtx.createRadialGradient(w * 0.5, h * 0.48, 4, w * 0.5, h * 0.48, w * 0.32);
      dust.addColorStop(0, 'rgb(95,95,95)');
      dust.addColorStop(1, 'rgb(0,0,0)');
      metalCtx.fillStyle = dust;
      metalCtx.fillRect(0, 0, w, h);
      break;
    }

    case 'french_tip': {
      // Sheer milky gel bed + razor-crisp curved smile line + hairline metallic rim
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

      // Hairline metallic accent rim along smile curve
      albedoCtx.strokeStyle = accent;
      albedoCtx.globalAlpha = 0.78;
      albedoCtx.lineWidth = w * 0.018;
      albedoCtx.beginPath();
      albedoCtx.moveTo(0, tipY + h * 0.058);
      albedoCtx.quadraticCurveTo(w * 0.5, tipY - h * 0.132, w, tipY + h * 0.058);
      albedoCtx.stroke();
      albedoCtx.restore();

      // Subtle raised gel smile ridge on heightfield & metallic hairline
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
      // Translucent pearl/blush base + delicate botanical 5-petal flowers + raised pearl/gold stamens
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

        // Raised pearl/gold stamen core
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
 * Synthesizes crystal-clear 1024×1024 procedural PBR maps from `NailFingerDesignSpec`,
 * converting the sculpted vector heightfield into a true tangent-space `normalMap` + `bumpMap`
 * via a 3×3 Sobel operator. Cached by `specHash` for 0 per-frame allocation at 60fps.
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

  paintProceduralLayers(spec, albedoCtx, heightCtx, metalCtx, w, h);

  const heightPixels = heightCtx.getImageData(0, 0, w, h).data;
  const metalPixels = metalCtx.getImageData(0, 0, w, h).data;

  // Build Normal Map, Bump Map, and Roughness Map via 3×3 Sobel over sculpted heightfield
  const { canvas: normalCanvas, ctx: normalCtx } = makeTextureSurface(w, h);
  const normalData = normalCtx.createImageData(w, h);

  const { canvas: bumpCanvas, ctx: bumpCtx } = makeTextureSurface(w, h);
  const bumpData = bumpCtx.createImageData(w, h);

  const { canvas: roughCanvas, ctx: roughCtx } = makeTextureSurface(w, h);
  const roughData = roughCtx.createImageData(w, h);

  const normalStrength =
    spec.pattern === 'gold_3d_waves' || spec.pattern === 'floral_accent' ? 4.4 : 2.8;
  const isVelvet = spec.glossIntensity < 0.65;
  const baseRough = isVelvet ? 0.38 : spec.pattern === 'chrome_mirror' ? 0.1 : 0.14;

  const sampleH = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return heightPixels[(cy * w + cx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const p4 = idx * 4;

      const tl = sampleH(x - 1, y - 1);
      const tc = sampleH(x, y - 1);
      const tr = sampleH(x + 1, y - 1);
      const ml = sampleH(x - 1, y);
      const mr = sampleH(x + 1, y);
      const bl = sampleH(x - 1, y + 1);
      const bc = sampleH(x, y + 1);
      const br = sampleH(x + 1, y + 1);

      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);

      const nx = -gx * normalStrength;
      const ny = gy * normalStrength;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      normalData.data[p4] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      normalData.data[p4 + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      normalData.data[p4 + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      normalData.data[p4 + 3] = 255;

      const hByte = heightPixels[p4];
      bumpData.data[p4] = hByte;
      bumpData.data[p4 + 1] = hByte;
      bumpData.data[p4 + 2] = hByte;
      bumpData.data[p4 + 3] = 255;

      const metalVal = metalPixels[p4] / 255;
      const rough = metalVal > 0.5 ? 0.1 : baseRough;
      const roughByte = clampByte(rough * 255);
      roughData.data[p4] = roughByte;
      roughData.data[p4 + 1] = roughByte;
      roughData.data[p4 + 2] = roughByte;
      roughData.data[p4 + 3] = 255;
    }
  }

  normalCtx.putImageData(normalData, 0, 0);
  bumpCtx.putImageData(bumpData, 0, 0);
  roughCtx.putImageData(roughData, 0, 0);

  // 512×512 Smooth organic cuticle skin-melt feather at proximal base (v ∈ [0, 0.14])
  const { canvas: alphaCanvas, ctx: alphaCtx } = makeTextureSurface(ALPHA_SIZE, ALPHA_SIZE);
  const alphaGrad = alphaCtx.createLinearGradient(0, ALPHA_SIZE * 0.86, 0, ALPHA_SIZE);
  alphaGrad.addColorStop(0, 'rgb(255,255,255)');
  alphaGrad.addColorStop(0.55, 'rgb(210,210,210)');
  alphaGrad.addColorStop(1, 'rgb(18,18,18)');
  alphaCtx.fillStyle = 'rgb(255,255,255)';
  alphaCtx.fillRect(0, 0, ALPHA_SIZE, ALPHA_SIZE);
  alphaCtx.fillStyle = alphaGrad;
  alphaCtx.fillRect(0, ALPHA_SIZE * 0.86, ALPHA_SIZE, ALPHA_SIZE * 0.14);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.needsUpdate = true;

  const metalnessMap = new THREE.CanvasTexture(metalCanvas);
  metalnessMap.needsUpdate = true;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.needsUpdate = true;

  const bundle: ProceduralPBRBundle = {
    specHash,
    map,
    normalMap,
    bumpMap,
    roughnessMap,
    metalnessMap,
    alphaMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      bumpMap.dispose();
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
  return bundle;
}

/**
 * Renders a crystal-clear 180×260 vector preview DataURL of the reconstructed procedural nail
 * so ImportReferenceModal and the dock display clean procedural art instead of raw bitmap crops!
 */
export function renderProceduralNailSwatchDataUrl(
  spec: NailFingerDesignSpec,
  outW = 180,
  outH = 260
): string {
  const { canvas, ctx } = makeTextureSurface(outW, outH);
  const { ctx: dummyHeight } = makeSurface(outW, outH);
  const { ctx: dummyMetal } = makeSurface(outW, outH);

  ctx.clearRect(0, 0, outW, outH);

  // Clip into anatomical salon nail silhouette matching spec.shape
  const padX = outW * 0.14;
  const padY = outH * 0.08;
  const w = outW - padX * 2;
  const h = outH - padY * 2;
  const cx = outW / 2;
  const bottomY = outH - padY;
  const topY = padY;

  ctx.save();
  ctx.beginPath();
  if (spec.shape === 'square') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.lineTo(cx - w * 0.48, topY + h * 0.06);
    ctx.quadraticCurveTo(cx - w * 0.48, topY, cx - w * 0.34, topY);
    ctx.lineTo(cx + w * 0.34, topY);
    ctx.quadraticCurveTo(cx + w * 0.48, topY, cx + w * 0.48, topY + h * 0.06);
    ctx.lineTo(cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else if (spec.shape === 'coffin') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.5, bottomY - h * 0.45, cx - w * 0.36, topY + h * 0.2, cx - w * 0.24, topY);
    ctx.lineTo(cx + w * 0.24, topY);
    ctx.bezierCurveTo(cx + w * 0.36, topY + h * 0.2, cx + w * 0.5, bottomY - h * 0.45, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else if (spec.shape === 'stiletto') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.48, bottomY - h * 0.44, cx - w * 0.24, topY + h * 0.18, cx, topY);
    ctx.bezierCurveTo(cx + w * 0.24, topY + h * 0.18, cx + w * 0.48, bottomY - h * 0.44, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else if (spec.shape === 'natural') {
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.48, bottomY - h * 0.48, cx - w * 0.42, topY + h * 0.08, cx, topY + h * 0.05);
    ctx.bezierCurveTo(cx + w * 0.42, topY + h * 0.08, cx + w * 0.48, bottomY - h * 0.48, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  } else {
    // Almond
    ctx.moveTo(cx - w * 0.44, bottomY - h * 0.12);
    ctx.bezierCurveTo(cx - w * 0.5, bottomY - h * 0.46, cx - w * 0.34, topY + h * 0.1, cx, topY);
    ctx.bezierCurveTo(cx + w * 0.34, topY + h * 0.1, cx + w * 0.5, bottomY - h * 0.46, cx + w * 0.44, bottomY - h * 0.12);
    ctx.quadraticCurveTo(cx, bottomY + h * 0.04, cx - w * 0.44, bottomY - h * 0.12);
  }
  ctx.closePath();
  ctx.clip();

  paintProceduralLayers(spec, ctx, dummyHeight, dummyMetal, outW, outH);

  // Subtle C-curve lateral shading & glossy studio highlight
  const cyl = ctx.createLinearGradient(padX, 0, outW - padX, 0);
  cyl.addColorStop(0, 'rgba(18, 10, 12, 0.28)');
  cyl.addColorStop(0.2, 'rgba(255, 255, 255, 0.06)');
  cyl.addColorStop(0.8, 'rgba(255, 255, 255, 0.02)');
  cyl.addColorStop(1, 'rgba(18, 10, 12, 0.30)');
  ctx.fillStyle = cyl;
  ctx.fillRect(0, 0, outW, outH);

  const gloss = ctx.createLinearGradient(outW * 0.28, topY, outW * 0.52, bottomY * 0.7);
  gloss.addColorStop(0, 'rgba(255,255,255,0.52)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.ellipse(outW * 0.39, outH * 0.42, outW * 0.075, outH * 0.24, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return canvas.toDataURL('image/png', 0.92);
}
