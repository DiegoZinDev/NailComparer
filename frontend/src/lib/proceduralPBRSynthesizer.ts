import * as THREE from 'three';
import { evalNailHalfWidth } from './nail3DGeometry';
import {
  buildBlueprintFromLegacySpec,
  type NailFingerDesignSpec,
} from './perFingerVisionAnalyzer';
import type {
  MicroGemElement,
  NailDesignBlueprint,
  OrganicMotifElement,
  RibbonStrokeElement,
} from '../types/nail';

export interface ProceduralPBRBundle {
  specHash: string;
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  metalnessMap: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
  dispose: () => void;
}

const ALBEDO_SIZE = 512;
const AUX_SIZE = 256;
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

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  } else if (clean.length >= 6) {
    const n = parseInt(clean.slice(0, 6), 16);
    if (!Number.isNaN(n)) return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  return [225, 185, 175];
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
  const tc = clamp(t, 0, 1);
  const rr = clampByte(r1 * (1 - tc) + r2 * tc);
  const gg = clampByte(g1 * (1 - tc) + g2 * tc);
  const bb = clampByte(b1 * (1 - tc) + b2 * tc);
  return alpha < 1 ? `rgba(${rr},${gg},${bb},${alpha})` : `rgb(${rr},${gg},${bb})`;
}

function resolveBlueprint(spec: NailFingerDesignSpec): NailDesignBlueprint {
  return spec.blueprint ?? buildBlueprintFromLegacySpec(spec);
}

export function hashFingerSpec(spec: NailFingerDesignSpec): string {
  const bp = resolveBlueprint(spec);
  const g = bp.geometry;
  const b = bp.baseLayer;
  const br = bp.borderLayer;
  const artSig = bp.artElements
    .map((el) => {
      if (el.type === 'ribbon_stroke') {
        return `R:${el.colorHex}:${el.isMetallic ? 1 : 0}:${el.points.map((p) => `${p.u.toFixed(2)},${p.v.toFixed(2)},${p.width.toFixed(2)}`).join(';')}`;
      }
      if (el.type === 'organic_motif') {
        return `M:${el.fillColorHex}:${el.isMetallic ? 1 : 0}:${el.contour.length}:${el.contour[0]?.u.toFixed(2) ?? 0}`;
      }
      return `G:${el.kind}:${el.colorHex}:${el.u.toFixed(2)},${el.v.toFixed(2)},${el.radius.toFixed(2)}`;
    })
    .join('/');

  return [
    'v10',
    g.shape,
    g.freeEdgeRatio.toFixed(2),
    g.profileHalfWidths.map((v) => v.toFixed(2)).join(','),
    b.baseColorHex,
    b.gradientMode,
    b.cuticleColorHex,
    b.midColorHex,
    b.tipColorHex,
    b.finishStyle,
    b.glossiness.toFixed(2),
    br.kind,
    br.colorHex,
    br.thicknessNorm.toFixed(2),
    br.isMetallic ? '1' : '0',
    artSig,
  ].join('|');
}

// Coordinate transform from blueprint UV (u=0..1 left..right, v=0 cuticle .. v=1 tip)
// to Three.js CanvasTexture space (y=0 is top v=1 tip, y=h is bottom v=0 cuticle)
function uvToCanvas(u: number, v: number, w: number, h: number): [number, number] {
  return [u * w, (1 - v) * h];
}

// Maps UV (u, v) to anatomical silhouette coordinate inside UV space
function traceBorderSilhouetteUV(
  ctx: CanvasCtx2D,
  bp: NailDesignBlueprint,
  w: number,
  h: number,
  insetFactor = 0.90
): void {
  const steps = 28;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const v = 0.04 + (i / steps) * 0.935;
    const hw =
      evalNailHalfWidth(v, bp.geometry.shape, {
        tipRoundness: bp.geometry.tipRoundness,
        profileHalfWidths: bp.geometry.profileHalfWidths,
      }) * insetFactor;
    const u = 0.5 - hw * 0.96;
    const [x, y] = uvToCanvas(u, v, w, h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const v = 0.04 + (i / steps) * 0.935;
    const hw =
      evalNailHalfWidth(v, bp.geometry.shape, {
        tipRoundness: bp.geometry.tipRoundness,
        profileHalfWidths: bp.geometry.profileHalfWidths,
      }) * insetFactor;
    const u = 0.5 + hw * 0.96;
    const [x, y] = uvToCanvas(u, v, w, h);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function renderBaseLayer(
  bp: NailDesignBlueprint,
  albedoCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  const {
    baseColorHex,
    gradientMode,
    cuticleColorHex,
    midColorHex,
    tipColorHex,
    finishStyle,
    metallicBase,
    glossiness,
  } = bp.baseLayer;

  // 1. Albedo Base Gradient
  if (gradientMode === 'vertical_ombre') {
    const grad = albedoCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, tipColorHex);
    grad.addColorStop(0.45, midColorHex);
    grad.addColorStop(0.88, cuticleColorHex);
    grad.addColorStop(1.0, shadeHex(cuticleColorHex, -6));
    albedoCtx.fillStyle = grad;
    albedoCtx.fillRect(0, 0, w, h);
  } else if (gradientMode === 'radial_aura') {
    albedoCtx.fillStyle = baseColorHex;
    albedoCtx.fillRect(0, 0, w, h);
    const aura = albedoCtx.createRadialGradient(
      w * 0.5,
      h * 0.48,
      w * 0.04,
      w * 0.5,
      h * 0.48,
      h * 0.46
    );
    aura.addColorStop(0.0, midColorHex);
    aura.addColorStop(0.42, mixHex(midColorHex, baseColorHex, 0.45));
    aura.addColorStop(0.85, baseColorHex);
    aura.addColorStop(1.0, shadeHex(baseColorHex, -8));
    albedoCtx.fillStyle = aura;
    albedoCtx.fillRect(0, 0, w, h);
  } else if (gradientMode === 'cat_eye_band') {
    albedoCtx.fillStyle = baseColorHex;
    albedoCtx.fillRect(0, 0, w, h);
    const band = albedoCtx.createLinearGradient(0, h * 0.12, w, h * 0.88);
    band.addColorStop(0.0, shadeHex(baseColorHex, -8));
    band.addColorStop(0.36, mixHex(baseColorHex, midColorHex, 0.42));
    band.addColorStop(0.50, mixHex(midColorHex, '#FFF7F0', 0.48));
    band.addColorStop(0.64, mixHex(baseColorHex, midColorHex, 0.42));
    band.addColorStop(1.0, shadeHex(baseColorHex, -10));
    albedoCtx.fillStyle = band;
    albedoCtx.fillRect(0, 0, w, h);
  } else if (gradientMode === 'pearl_chrome') {
    const pearl = albedoCtx.createLinearGradient(0, 0, w, h);
    pearl.addColorStop(0.0, shadeHex(baseColorHex, -8));
    pearl.addColorStop(0.30, mixHex(baseColorHex, '#FFFFFF', 0.35));
    pearl.addColorStop(0.52, mixHex(midColorHex, '#FFFFFF', 0.52));
    pearl.addColorStop(0.76, mixHex(baseColorHex, tipColorHex, 0.40));
    pearl.addColorStop(1.0, shadeHex(baseColorHex, -10));
    albedoCtx.fillStyle = pearl;
    albedoCtx.fillRect(0, 0, w, h);

    const sheen = albedoCtx.createRadialGradient(w * 0.44, h * 0.38, w * 0.03, w * 0.5, h * 0.44, w * 0.6);
    sheen.addColorStop(0.0, 'rgba(255,255,255,0.42)');
    sheen.addColorStop(0.55, 'rgba(255,248,242,0.14)');
    sheen.addColorStop(1.0, 'rgba(255,255,255,0)');
    albedoCtx.fillStyle = sheen;
    albedoCtx.fillRect(0, 0, w, h);
  } else {
    // 'solid' — preserves exact deep colors (e.g. #5A0A1E burgundy, black) with zero brown washout!
    const solidGrad = albedoCtx.createLinearGradient(0, 0, 0, h);
    solidGrad.addColorStop(0.0, shadeHex(baseColorHex, 4));
    solidGrad.addColorStop(0.55, baseColorHex);
    solidGrad.addColorStop(1.0, shadeHex(baseColorHex, -6));
    albedoCtx.fillStyle = solidGrad;
    albedoCtx.fillRect(0, 0, w, h);
  }

  // Organic subsurface lunula warmth near proximal cuticle ONLY for light/translucent finishes
  // (never wash deep colors like #5A0A1E or #141414!)
  const [br, bg, bb] = parseHex(baseColorHex);
  const baseLuma = (0.299 * br + 0.587 * bg + 0.114 * bb) / 255;
  const lunulaStrength =
    finishStyle === 'jelly_translucent'
      ? 0.24
      : baseLuma > 0.46
        ? 0.16
        : 0.04;
  if (lunulaStrength > 0.01) {
    const lunula = albedoCtx.createRadialGradient(
      w * 0.5,
      h * 0.96,
      w * 0.04,
      w * 0.5,
      h * 0.94,
      w * 0.30
    );
    lunula.addColorStop(0, `rgba(255, 246, 242, ${lunulaStrength})`);
    lunula.addColorStop(1, 'rgba(255, 246, 242, 0)');
    albedoCtx.fillStyle = lunula;
    albedoCtx.fillRect(0, h * 0.68, w, h * 0.32);
  }

  // 2. Base Metalness & Roughness maps (256×256)
  const baseMetalByte =
    finishStyle === 'chrome_mirror'
      ? 235
      : finishStyle === 'pearl_glazed'
        ? 110
        : finishStyle === 'cat_eye'
          ? 145
          : clampByte(metallicBase * 220);

  metalCtx.fillStyle = `rgb(${baseMetalByte},${baseMetalByte},${baseMetalByte})`;
  metalCtx.fillRect(0, 0, auxW, auxH);

  const roughFloat =
    finishStyle === 'velvet_matte'
      ? 0.34
      : finishStyle === 'chrome_mirror'
        ? 0.08
        : finishStyle === 'pearl_glazed'
          ? 0.11
          : clamp(0.14 - (glossiness - 0.8) * 0.15, 0.09, 0.22);
  const rByte = clampByte(roughFloat * 255);
  roughCtx.fillStyle = `rgb(${rByte},${rByte},${rByte})`;
  roughCtx.fillRect(0, 0, auxW, auxH);
}

function renderBorderLayer(
  bp: NailDesignBlueprint,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  const border = bp.borderLayer;
  if (border.kind === 'none') return;

  const borderColor = border.colorHex || '#D4AF37';
  const strokeW = Math.max(4, w * clamp(border.thicknessNorm, 0.02, 0.28));
  const strokeWAux = strokeW * (auxW / w);
  const metalByte = border.isMetallic ? 245 : 0;
  const roughByte = border.isMetallic ? 20 : 32;
  const reliefByte = border.is3DRaised ? 242 : 158;

  if (border.kind === 'full_metallic_outline') {
    // Contact shadow beneath raised border
    albedoCtx.save();
    albedoCtx.lineJoin = 'round';
    albedoCtx.lineCap = 'round';
    traceBorderSilhouetteUV(albedoCtx, bp, w, h, 0.89);
    albedoCtx.strokeStyle = 'rgba(24, 12, 8, 0.34)';
    albedoCtx.lineWidth = strokeW * 1.38;
    albedoCtx.stroke();

    albedoCtx.strokeStyle = borderColor;
    albedoCtx.lineWidth = strokeW;
    albedoCtx.stroke();

    albedoCtx.strokeStyle = mixHex(borderColor, '#FFF8DF', 0.58, 0.72);
    albedoCtx.lineWidth = strokeW * 0.34;
    albedoCtx.stroke();
    albedoCtx.restore();

    heightCtx.save();
    heightCtx.lineJoin = 'round';
    heightCtx.lineCap = 'round';
    traceBorderSilhouetteUV(heightCtx, bp, w, h, 0.89);
    heightCtx.strokeStyle = `rgb(${reliefByte},${reliefByte},${reliefByte})`;
    heightCtx.lineWidth = strokeW * 1.05;
    heightCtx.stroke();
    heightCtx.strokeStyle = 'rgb(255,255,255)';
    heightCtx.lineWidth = strokeW * 0.42;
    heightCtx.stroke();
    heightCtx.restore();

    metalCtx.save();
    metalCtx.lineJoin = 'round';
    metalCtx.lineCap = 'round';
    traceBorderSilhouetteUV(metalCtx, bp, auxW, auxH, 0.89);
    metalCtx.strokeStyle = `rgb(${metalByte},${metalByte},${metalByte})`;
    metalCtx.lineWidth = strokeWAux * 1.05;
    metalCtx.stroke();
    metalCtx.restore();

    roughCtx.save();
    roughCtx.lineJoin = 'round';
    roughCtx.lineCap = 'round';
    traceBorderSilhouetteUV(roughCtx, bp, auxW, auxH, 0.89);
    roughCtx.strokeStyle = `rgb(${roughByte},${roughByte},${roughByte})`;
    roughCtx.lineWidth = strokeWAux * 1.05;
    roughCtx.stroke();
    roughCtx.restore();
    return;
  }

  if (border.kind === 'cuticle_cuff') {
    const cuffY = h * (1 - 0.06);
    const cuffCurve = h * clamp(border.smileCurveDepth, 0.05, 0.25) * 0.35;
    const drawCuff = (ctx: CanvasCtx2D, cw: number, ch: number) => {
      const yBase = ch * 0.94;
      const dip = ch * clamp(border.smileCurveDepth, 0.05, 0.25) * 0.35;
      ctx.beginPath();
      ctx.moveTo(cw * 0.14, yBase - dip * 0.8);
      ctx.quadraticCurveTo(cw * 0.5, yBase + dip, cw * 0.86, yBase - dip * 0.8);
    };

    albedoCtx.save();
    albedoCtx.lineCap = 'round';
    drawCuff(albedoCtx, w, h);
    albedoCtx.strokeStyle = 'rgba(24, 12, 8, 0.28)';
    albedoCtx.lineWidth = strokeW * 1.3;
    albedoCtx.stroke();
    albedoCtx.strokeStyle = borderColor;
    albedoCtx.lineWidth = strokeW;
    albedoCtx.stroke();
    albedoCtx.strokeStyle = mixHex(borderColor, '#FFF8DF', 0.58, 0.72);
    albedoCtx.lineWidth = strokeW * 0.35;
    albedoCtx.stroke();
    albedoCtx.restore();

    heightCtx.save();
    heightCtx.lineCap = 'round';
    drawCuff(heightCtx, w, h);
    heightCtx.strokeStyle = `rgb(${reliefByte},${reliefByte},${reliefByte})`;
    heightCtx.lineWidth = strokeW;
    heightCtx.stroke();
    heightCtx.restore();

    metalCtx.save();
    metalCtx.lineCap = 'round';
    drawCuff(metalCtx, auxW, auxH);
    metalCtx.strokeStyle = `rgb(${metalByte},${metalByte},${metalByte})`;
    metalCtx.lineWidth = strokeWAux;
    metalCtx.stroke();
    metalCtx.restore();

    roughCtx.save();
    roughCtx.lineCap = 'round';
    drawCuff(roughCtx, auxW, auxH);
    roughCtx.strokeStyle = `rgb(${roughByte},${roughByte},${roughByte})`;
    roughCtx.lineWidth = strokeWAux;
    roughCtx.stroke();
    roughCtx.restore();
    void cuffY;
    void cuffCurve;
    return;
  }

  // French tip variants: 'classic_french' | 'micro_french' | 'v_french'
  const tipDepth =
    border.kind === 'micro_french'
      ? clamp(border.thicknessNorm, 0.04, 0.11)
      : clamp(border.thicknessNorm, 0.12, 0.28);
  const smileDepth = clamp(border.smileCurveDepth, 0.04, 0.32);

  const traceFrenchTip = (ctx: CanvasCtx2D, cw: number, ch: number) => {
    const tipY = ch * tipDepth;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cw, 0);
    if (border.kind === 'v_french') {
      ctx.lineTo(cw, tipY * 0.55);
      ctx.lineTo(cw * 0.5, tipY + ch * smileDepth * 0.35);
      ctx.lineTo(0, tipY * 0.55);
    } else {
      ctx.lineTo(cw, tipY + ch * smileDepth * 0.45);
      ctx.quadraticCurveTo(cw * 0.5, tipY - ch * smileDepth * 0.55, 0, tipY + ch * smileDepth * 0.45);
    }
    ctx.closePath();
  };

  albedoCtx.save();
  traceFrenchTip(albedoCtx, w, h);
  const fGrad = albedoCtx.createLinearGradient(0, 0, w, h * tipDepth);
  fGrad.addColorStop(0.0, shadeHex(borderColor, -8));
  fGrad.addColorStop(0.5, borderColor);
  fGrad.addColorStop(1.0, shadeHex(borderColor, -8));
  albedoCtx.fillStyle = fGrad;
  albedoCtx.fill();

  if (border.isMetallic) {
    albedoCtx.strokeStyle = mixHex(borderColor, '#FFF8DF', 0.45, 0.75);
    albedoCtx.lineWidth = Math.max(2, w * 0.014);
    albedoCtx.stroke();
  }
  albedoCtx.restore();

  heightCtx.save();
  traceFrenchTip(heightCtx, w, h);
  const hVal = border.is3DRaised ? 196 : 138;
  heightCtx.fillStyle = `rgb(${hVal},${hVal},${hVal})`;
  heightCtx.fill();
  heightCtx.restore();

  if (border.isMetallic) {
    metalCtx.save();
    traceFrenchTip(metalCtx, auxW, auxH);
    metalCtx.fillStyle = `rgb(${metalByte},${metalByte},${metalByte})`;
    metalCtx.fill();
    metalCtx.restore();

    roughCtx.save();
    traceFrenchTip(roughCtx, auxW, auxH);
    roughCtx.fillStyle = `rgb(${roughByte},${roughByte},${roughByte})`;
    roughCtx.fill();
    roughCtx.restore();
  }
}

function traceSmoothCatmullRom(
  ctx: CanvasCtx2D,
  pts: ReadonlyArray<{ x: number; y: number }>
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function renderRibbonStroke(
  el: RibbonStrokeElement,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  if (el.points.length < 2) return;

  const avgWidth =
    el.points.reduce((acc, p) => acc + p.width, 0) / el.points.length;
  const lineW = Math.max(3, avgWidth * w);
  const lineWAux = Math.max(2, avgWidth * auxW);

  const pts = el.points.map((p) => {
    const [x, y] = uvToCanvas(p.u, p.v, w, h);
    return { x, y, width: p.width * w };
  });
  const ptsAux = el.points.map((p) => {
    const [x, y] = uvToCanvas(p.u, p.v, auxW, auxH);
    return { x, y };
  });

  // 1. Albedo volumetric metallic/pigment ribbon (shadow -> dark rim -> body -> specular ridge)
  albedoCtx.save();
  albedoCtx.lineCap = 'round';
  albedoCtx.lineJoin = 'round';

  // Soft contact shadow below ribbon
  const shadowPts = pts.map((p) => ({ x: p.x, y: p.y + lineW * 0.14 }));
  traceSmoothCatmullRom(albedoCtx, shadowPts);
  albedoCtx.strokeStyle = 'rgba(26, 12, 8, 0.28)';
  albedoCtx.lineWidth = lineW * 1.26;
  albedoCtx.stroke();

  // Dark metallic/sculpted outer contour
  traceSmoothCatmullRom(albedoCtx, pts);
  albedoCtx.strokeStyle = shadeHex(el.colorHex, -34);
  albedoCtx.lineWidth = lineW * 1.06;
  albedoCtx.stroke();

  // Main ribbon body gradient
  const pFirst = pts[0];
  const pLast = pts[pts.length - 1];
  const bodyGrad = albedoCtx.createLinearGradient(pFirst.x, pFirst.y, pLast.x, pLast.y);
  bodyGrad.addColorStop(0.0, shadeHex(el.colorHex, -18));
  bodyGrad.addColorStop(0.35, el.colorHex);
  bodyGrad.addColorStop(0.55, el.highlightHex);
  bodyGrad.addColorStop(0.80, el.colorHex);
  bodyGrad.addColorStop(1.0, shadeHex(el.colorHex, -22));
  albedoCtx.strokeStyle = bodyGrad;
  albedoCtx.lineWidth = lineW * 0.90;
  albedoCtx.stroke();

  // Crisp crest highlight along cylindrical dome
  const ridgePts = pts.map((p) => ({ x: p.x - lineW * 0.05, y: p.y - lineW * 0.08 }));
  traceSmoothCatmullRom(albedoCtx, ridgePts);
  albedoCtx.strokeStyle = mixHex(el.highlightHex, '#FFFFFF', 0.45, 0.78);
  albedoCtx.lineWidth = Math.max(1.5, lineW * 0.28);
  albedoCtx.stroke();
  albedoCtx.restore();

  // 2. Cylindrical dome height profile in heightCanvas (512×512)
  const peakH = clampByte(115 + el.reliefHeight * 140);
  const midH = clampByte(108 + el.reliefHeight * 95);
  heightCtx.save();
  heightCtx.lineCap = 'round';
  heightCtx.lineJoin = 'round';
  traceSmoothCatmullRom(heightCtx, pts);
  heightCtx.strokeStyle = `rgb(${midH},${midH},${midH})`;
  heightCtx.lineWidth = lineW * 1.04;
  heightCtx.stroke();
  heightCtx.strokeStyle = `rgb(${peakH},${peakH},${peakH})`;
  heightCtx.lineWidth = lineW * 0.48;
  heightCtx.stroke();
  heightCtx.restore();

  // 3. Surgical metalness & roughness over ribbon (256×256)
  if (el.isMetallic) {
    metalCtx.save();
    metalCtx.lineCap = 'round';
    metalCtx.lineJoin = 'round';
    traceSmoothCatmullRom(metalCtx, ptsAux);
    metalCtx.strokeStyle = 'rgb(245,245,245)';
    metalCtx.lineWidth = lineWAux * 1.02;
    metalCtx.stroke();
    metalCtx.restore();

    roughCtx.save();
    roughCtx.lineCap = 'round';
    roughCtx.lineJoin = 'round';
    traceSmoothCatmullRom(roughCtx, ptsAux);
    roughCtx.strokeStyle = 'rgb(20,20,20)';
    roughCtx.lineWidth = lineWAux * 1.02;
    roughCtx.stroke();
    roughCtx.restore();
  }
}

function traceSmoothClosedPolygon(
  ctx: CanvasCtx2D,
  pts: ReadonlyArray<{ x: number; y: number }>
): void {
  const n = pts.length;
  if (n < 3) return;
  ctx.beginPath();
  const startMidX = (pts[n - 1].x + pts[0].x) * 0.5;
  const startMidY = (pts[n - 1].y + pts[0].y) * 0.5;
  ctx.moveTo(startMidX, startMidY);
  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const midX = (curr.x + next.x) * 0.5;
    const midY = (curr.y + next.y) * 0.5;
    ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
  }
  ctx.closePath();
}

function renderOrganicMotif(
  el: OrganicMotifElement,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  if (el.contour.length < 3) return;

  const pts = el.contour.map((c) => {
    const [x, y] = uvToCanvas(c.u, c.v, w, h);
    return { x, y };
  });
  const ptsAux = el.contour.map((c) => {
    const [x, y] = uvToCanvas(c.u, c.v, auxW, auxH);
    return { x, y };
  });

  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let maxR = 4;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d > maxR) maxR = d;
  }

  albedoCtx.save();
  traceSmoothClosedPolygon(albedoCtx, pts);
  const grad = albedoCtx.createRadialGradient(
    cx - maxR * 0.2,
    cy - maxR * 0.2,
    maxR * 0.08,
    cx,
    cy,
    maxR
  );
  grad.addColorStop(0.0, mixHex(el.fillColorHex, '#FFFFFF', 0.28));
  grad.addColorStop(0.65, el.fillColorHex);
  grad.addColorStop(1.0, el.shadeColorHex);
  albedoCtx.fillStyle = grad;
  albedoCtx.fill();

  albedoCtx.strokeStyle = shadeHex(el.shadeColorHex, -12, 0.45);
  albedoCtx.lineWidth = Math.max(1.2, w * 0.005);
  albedoCtx.stroke();
  albedoCtx.restore();

  // Sculpted dome height in heightCanvas
  const hPeak = clampByte(115 + el.reliefHeight * 125);
  heightCtx.save();
  traceSmoothClosedPolygon(heightCtx, pts);
  const hGrad = heightCtx.createRadialGradient(cx, cy, 1, cx, cy, maxR);
  hGrad.addColorStop(0.0, `rgb(${hPeak},${hPeak},${hPeak})`);
  hGrad.addColorStop(1.0, 'rgb(112,112,112)');
  heightCtx.fillStyle = hGrad;
  heightCtx.fill();
  heightCtx.restore();

  if (el.isMetallic) {
    metalCtx.save();
    traceSmoothClosedPolygon(metalCtx, ptsAux);
    metalCtx.fillStyle = 'rgb(235,235,235)';
    metalCtx.fill();
    metalCtx.restore();

    roughCtx.save();
    traceSmoothClosedPolygon(roughCtx, ptsAux);
    roughCtx.fillStyle = 'rgb(24,24,24)';
    roughCtx.fill();
    roughCtx.restore();
  }
}

function renderMicroGem(
  el: MicroGemElement,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  const [px, py] = uvToCanvas(el.u, el.v, w, h);
  const r = Math.max(3, el.radius * w);
  const [pxA, pyA] = uvToCanvas(el.u, el.v, auxW, auxH);
  const rA = Math.max(2, el.radius * auxW);

  albedoCtx.save();
  // Contact AO shadow
  albedoCtx.fillStyle = 'rgba(22, 10, 8, 0.34)';
  albedoCtx.beginPath();
  albedoCtx.arc(px + r * 0.10, py + r * 0.14, r * 1.12, 0, Math.PI * 2);
  albedoCtx.fill();

  const grad = albedoCtx.createRadialGradient(
    px - r * 0.32,
    py - r * 0.32,
    r * 0.08,
    px,
    py,
    r
  );
  if (el.kind === 'gold_bead') {
    grad.addColorStop(0.0, '#FFFDF0');
    grad.addColorStop(0.35, mixHex(el.colorHex, '#FFF2C2', 0.35));
    grad.addColorStop(0.75, el.colorHex);
    grad.addColorStop(1.0, shadeHex(el.colorHex, -42));
  } else if (el.kind === 'pearl') {
    grad.addColorStop(0.0, '#FFFFFF');
    grad.addColorStop(0.45, '#FAF3EE');
    grad.addColorStop(0.85, mixHex(el.colorHex, '#DFD2CC', 0.45));
    grad.addColorStop(1.0, '#B5A29B');
  } else {
    grad.addColorStop(0.0, '#FFFFFF');
    grad.addColorStop(0.4, mixHex(el.colorHex, '#E8F4FF', 0.5));
    grad.addColorStop(0.8, el.colorHex);
    grad.addColorStop(1.0, shadeHex(el.colorHex, -36));
  }
  albedoCtx.fillStyle = grad;
  albedoCtx.beginPath();
  albedoCtx.arc(px, py, r, 0, Math.PI * 2);
  albedoCtx.fill();

  // Sharp studio specular pinpoint
  albedoCtx.fillStyle = 'rgba(255,255,255,0.88)';
  albedoCtx.beginPath();
  albedoCtx.arc(px - r * 0.30, py - r * 0.30, Math.max(1.2, r * 0.22), 0, Math.PI * 2);
  albedoCtx.fill();
  albedoCtx.restore();

  // Hemispherical dome in heightCanvas
  heightCtx.save();
  const hGrad = heightCtx.createRadialGradient(px, py, 0.5, px, py, r);
  hGrad.addColorStop(0.0, 'rgb(255,255,255)');
  hGrad.addColorStop(0.70, 'rgb(212,212,212)');
  hGrad.addColorStop(1.0, 'rgb(104,104,104)');
  heightCtx.fillStyle = hGrad;
  heightCtx.beginPath();
  heightCtx.arc(px, py, r, 0, Math.PI * 2);
  heightCtx.fill();
  heightCtx.restore();

  const mVal = el.kind === 'gold_bead' ? 245 : el.kind === 'pearl' ? 110 : 205;
  metalCtx.save();
  metalCtx.fillStyle = `rgb(${mVal},${mVal},${mVal})`;
  metalCtx.beginPath();
  metalCtx.arc(pxA, pyA, rA, 0, Math.PI * 2);
  metalCtx.fill();
  metalCtx.restore();

  const rVal = el.kind === 'gold_bead' ? 20 : 24;
  roughCtx.save();
  roughCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
  roughCtx.beginPath();
  roughCtx.arc(pxA, pyA, rA, 0, Math.PI * 2);
  roughCtx.fill();
  roughCtx.restore();
}

function paintBlueprintOntoMaps(
  bp: NailDesignBlueprint,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  heightCtx.fillStyle = 'rgb(100,100,100)';
  heightCtx.fillRect(0, 0, w, h);

  renderBaseLayer(bp, albedoCtx, metalCtx, roughCtx, w, h, auxW, auxH);
  renderBorderLayer(bp, albedoCtx, heightCtx, metalCtx, roughCtx, w, h, auxW, auxH);

  for (const el of bp.artElements) {
    if (el.type === 'organic_motif') {
      renderOrganicMotif(el, albedoCtx, heightCtx, metalCtx, roughCtx, w, h, auxW, auxH);
    }
  }
  for (const el of bp.artElements) {
    if (el.type === 'ribbon_stroke') {
      renderRibbonStroke(el, albedoCtx, heightCtx, metalCtx, roughCtx, w, h, auxW, auxH);
    }
  }
  for (const el of bp.artElements) {
    if (el.type === 'micro_gem') {
      renderMicroGem(el, albedoCtx, heightCtx, metalCtx, roughCtx, w, h, auxW, auxH);
    }
  }
}

/**
 * Single-pass fast 3×3 Sobel gradient operator converting `heightCanvas` (512×512)
 * into a crisp tangent-space Normal Map (`< 5ms/finger`).
 */
function buildFastSobelNormalMap(
  heightBytes: Uint8ClampedArray,
  w: number,
  h: number,
  normalStrength: number,
  normalOut: ImageData
): void {
  const out = normalOut.data;
  const strengthScale = normalStrength / (4 * 255);

  for (let y = 0; y < h; y++) {
    const ym1 = y > 0 ? y - 1 : 0;
    const yp1 = y < h - 1 ? y + 1 : h - 1;
    const r0 = ym1 * w;
    const r1 = y * w;
    const r2 = yp1 * w;

    for (let x = 0; x < w; x++) {
      const xm1 = x > 0 ? x - 1 : 0;
      const xp1 = x < w - 1 ? x + 1 : w - 1;

      const tl = heightBytes[(r0 + xm1) << 2];
      const tc = heightBytes[(r0 + x) << 2];
      const tr = heightBytes[(r0 + xp1) << 2];
      const ml = heightBytes[(r1 + xm1) << 2];
      const mr = heightBytes[(r1 + xp1) << 2];
      const bl = heightBytes[(r2 + xm1) << 2];
      const bc = heightBytes[(r2 + x) << 2];
      const br = heightBytes[(r2 + xp1) << 2];

      const gx = (tr + (mr << 1) + br) - (tl + (ml << 1) + bl);
      const gy = (bl + (bc << 1) + br) - (tl + (tc << 1) + tr);

      const p4 = (r1 + x) << 2;
      if (gx === 0 && gy === 0) {
        out[p4] = 128;
        out[p4 + 1] = 128;
        out[p4 + 2] = 255;
        out[p4 + 3] = 255;
        continue;
      }

      const nx = -gx * strengthScale;
      const ny = gy * strengthScale;
      const invLen = 127.5 / Math.sqrt(nx * nx + ny * ny + 1.0);

      out[p4] = clampByte(nx * invLen + 127.5);
      out[p4 + 1] = clampByte(ny * invLen + 127.5);
      out[p4 + 2] = clampByte(invLen + 127.5);
      out[p4 + 3] = 255;
    }
  }
}

/**
 * V10 Lean Clean Vector PBR Compiler (`< 15ms/finger`, ~12 MB total VRAM across all 5 fingers):
 * - Compiles 100% vectorially from `NailDesignBlueprint` (ZERO raw photo pixels, ZERO `displacementMap`, ZERO `bumpMap`).
 * - `map` (`512×512`) & Sobel `normalMap` (`512×512`) for razor-sharp 3D curves & relief.
 * - `roughnessMap` (`256×256`), `metalnessMap` (`256×256`), and `alphaMap` (`256×256` pure opaque on 96%,
 *   soft cuticle feathering strictly on `v ∈ [0, 0.04]`) for 4× lower VRAM footprint.
 */
export function synthesizeCleanPBRBundle(
  spec: NailFingerDesignSpec
): ProceduralPBRBundle {
  const specHash = hashFingerSpec(spec);
  const cached = pbrBundleCache.get(specHash);
  if (cached) return cached;

  const bp = resolveBlueprint(spec);

  const { canvas: albedoCanvas, ctx: albedoCtx } = makeTextureSurface(ALBEDO_SIZE, ALBEDO_SIZE);
  const { ctx: heightCtx } = makeSurface(ALBEDO_SIZE, ALBEDO_SIZE);
  const { canvas: metalCanvas, ctx: metalCtx } = makeTextureSurface(AUX_SIZE, AUX_SIZE);
  const { canvas: roughCanvas, ctx: roughCtx } = makeTextureSurface(AUX_SIZE, AUX_SIZE);

  paintBlueprintOntoMaps(
    bp,
    albedoCtx,
    heightCtx,
    metalCtx,
    roughCtx,
    ALBEDO_SIZE,
    ALBEDO_SIZE,
    AUX_SIZE,
    AUX_SIZE
  );

  const heightPixels = heightCtx.getImageData(0, 0, ALBEDO_SIZE, ALBEDO_SIZE).data;
  const { canvas: normalCanvas, ctx: normalCtx } = makeTextureSurface(ALBEDO_SIZE, ALBEDO_SIZE);
  const normalData = normalCtx.createImageData(ALBEDO_SIZE, ALBEDO_SIZE);

  const hasRaisedRelief =
    bp.borderLayer.is3DRaised || bp.artElements.length > 0;
  const normalStrength = hasRaisedRelief ? 4.4 : 2.2;
  buildFastSobelNormalMap(heightPixels, ALBEDO_SIZE, ALBEDO_SIZE, normalStrength, normalData);
  normalCtx.putImageData(normalData, 0, 0);

  // 256×256 AlphaMap: 100% pure white (255) on 96% of plate; soft cuticle feathering ONLY on v ∈ [0, 0.04]
  const { canvas: alphaCanvas, ctx: alphaCtx } = makeTextureSurface(AUX_SIZE, AUX_SIZE);
  alphaCtx.fillStyle = 'rgb(255,255,255)';
  alphaCtx.fillRect(0, 0, AUX_SIZE, AUX_SIZE);
  const cuticleTopY = Math.round(AUX_SIZE * 0.96);
  const alphaGrad = alphaCtx.createLinearGradient(0, cuticleTopY, 0, AUX_SIZE);
  alphaGrad.addColorStop(0.0, 'rgb(255,255,255)');
  alphaGrad.addColorStop(0.55, 'rgb(192,192,192)');
  alphaGrad.addColorStop(1.0, 'rgb(24,24,24)');
  alphaCtx.fillStyle = alphaGrad;
  alphaCtx.fillRect(0, cuticleTopY, AUX_SIZE, AUX_SIZE - cuticleTopY);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

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
    roughnessMap,
    metalnessMap,
    alphaMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      metalnessMap.dispose();
      alphaMap.dispose();
    },
  };

  if (pbrBundleCache.size >= CACHE_LIMIT) {
    const oldestKey = pbrBundleCache.keys().next().value;
    if (oldestKey) {
      pbrBundleCache.get(oldestKey)?.dispose();
      pbrBundleCache.delete(oldestKey);
    }
  }
  pbrBundleCache.set(specHash, bundle);

  return bundle;
}

export const synthesizeProceduralPBRBundle = synthesizeCleanPBRBundle;

// -----------------------------------------------------------------------------
// Clean Vector Swatch Renderer (ZERO raw photo pixels!)
// -----------------------------------------------------------------------------

function traceAnatomicalSwatchClip(
  ctx: CanvasRenderingContext2D,
  bp: NailDesignBlueprint,
  outW: number,
  outH: number
): { padX: number; padY: number; topY: number; bottomY: number } {
  const padX = outW * 0.14;
  const padY = outH * 0.08;
  const w = outW - padX * 2;
  const h = outH - padY * 2;
  const cx = outW * 0.5;
  const bottomY = outH - padY;
  const topY = padY;

  const steps = 32;
  ctx.beginPath();
  // Left boundary from cuticle (v=0) up to tip (v=1)
  for (let i = 0; i <= steps; i++) {
    const v = i / steps;
    const hw = evalNailHalfWidth(v, bp.geometry.shape, {
      bedFraction: 0.55,
      tipRoundness: bp.geometry.tipRoundness,
      profileHalfWidths: bp.geometry.profileHalfWidths,
    });
    const x = cx - hw * w * 0.98;
    const y = bottomY - v * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  // Right boundary from tip (v=1) back down to cuticle (v=0)
  for (let i = steps; i >= 0; i--) {
    const v = i / steps;
    const hw = evalNailHalfWidth(v, bp.geometry.shape, {
      bedFraction: 0.55,
      tipRoundness: bp.geometry.tipRoundness,
      profileHalfWidths: bp.geometry.profileHalfWidths,
    });
    const x = cx + hw * w * 0.98;
    const y = bottomY - v * h;
    ctx.lineTo(x, y);
  }
  // Smooth rounded proximal cuticle base curve
  const hw0 = evalNailHalfWidth(0, bp.geometry.shape, {
    bedFraction: 0.55,
    profileHalfWidths: bp.geometry.profileHalfWidths,
  });
  ctx.quadraticCurveTo(cx, bottomY + h * 0.055, cx - hw0 * w * 0.98, bottomY);
  ctx.closePath();

  return { padX, padY, topY, bottomY };
}

function applyStudioSwatchLighting(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  padX: number,
  topY: number,
  bottomY: number,
  isVelvet: boolean
): void {
  // Cylindrical C-curve sidewall shading
  const cyl = ctx.createLinearGradient(padX, 0, outW - padX, 0);
  cyl.addColorStop(0.0, 'rgba(16, 8, 10, 0.30)');
  cyl.addColorStop(0.22, 'rgba(255, 255, 255, 0.06)');
  cyl.addColorStop(0.78, 'rgba(255, 255, 255, 0.02)');
  cyl.addColorStop(1.0, 'rgba(16, 8, 10, 0.32)');
  ctx.fillStyle = cyl;
  ctx.fillRect(0, 0, outW, outH);

  // Subtle cuticle base depth
  const rootShade = ctx.createLinearGradient(0, bottomY - outH * 0.16, 0, bottomY);
  rootShade.addColorStop(0, 'rgba(20, 8, 10, 0)');
  rootShade.addColorStop(1, 'rgba(20, 8, 10, 0.22)');
  ctx.fillStyle = rootShade;
  ctx.fillRect(0, bottomY - outH * 0.16, outW, outH * 0.18);

  // Studio gel catchlight reflection
  const peakAlpha = isVelvet ? 0.16 : 0.48;
  const gloss = ctx.createLinearGradient(outW * 0.28, topY, outW * 0.52, bottomY * 0.72);
  gloss.addColorStop(0.0, `rgba(255,255,255,${peakAlpha})`);
  gloss.addColorStop(0.45, `rgba(255,255,255,${peakAlpha * 0.22})`);
  gloss.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.ellipse(outW * 0.39, outH * 0.42, outW * 0.072, outH * 0.24, -0.08, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Renders a crisp 100% vector nail preview onto an `HTMLCanvasElement` directly from the
 * `NailDesignBlueprint` with anatomical `profileHalfWidths` silhouette & studio gel lighting
 * (ZERO raw photo pixels).
 */
export function renderBlueprintNailCanvas(
  spec: NailFingerDesignSpec,
  width = 180,
  height = 260
): HTMLCanvasElement {
  const bp = resolveBlueprint(spec);
  const { canvas, ctx } = makeTextureSurface(width, height);
  const { ctx: dummyHeight } = makeSurface(width, height);
  const { ctx: dummyMetal } = makeSurface(width, height);
  const { ctx: dummyRough } = makeSurface(width, height);

  ctx.clearRect(0, 0, width, height);

  ctx.save();
  const { padX, topY, bottomY } = traceAnatomicalSwatchClip(ctx, bp, width, height);
  ctx.clip();

  paintBlueprintOntoMaps(bp, ctx, dummyHeight, dummyMetal, dummyRough, width, height, width, height);
  applyStudioSwatchLighting(
    ctx,
    width,
    height,
    padX,
    topY,
    bottomY,
    bp.baseLayer.finishStyle === 'velvet_matte'
  );
  ctx.restore();

  return canvas;
}

/**
 * Renders a PNG DataURL swatch directly from `renderBlueprintNailCanvas` (ZERO raw photo pixels).
 */
export function renderProceduralNailSwatchDataUrl(
  spec: NailFingerDesignSpec,
  outW = 180,
  outH = 260
): string {
  const canvas = renderBlueprintNailCanvas(spec, outW, outH);
  return canvas.toDataURL('image/png', 0.92);
}
