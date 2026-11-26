import * as THREE from 'three';
import { evalNailHalfWidth } from './nail3DGeometry';
import {
  buildBlueprintFromLegacySpec,
  type NailFingerDesignSpec,
} from './perFingerVisionAnalyzer';
import type {
  MicroGemElement,
  Nail3DAccessorySpec,
  Nail3DFinishType,
  Nail3DManufacturingSpec,
  Nail3DMotifSpec,
  Nail3DStrokeSpec,
  NailDesignBlueprint,
  NailRenderStrategy,
  NailShape,
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
  if (typeof document !== 'undefined') {
    const el = document.createElement('canvas');
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d', { willReadFrequently: true })!;
    return { canvas: el, ctx };
  }
  const off = new OffscreenCanvas(w, h);
  const ctx = off.getContext('2d', { willReadFrequently: true })!;
  return { canvas: off, ctx };
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

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): [number, number, number] {
  const clean = (hex || '').replace('#', '').trim();
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
  const tc = clamp01(t);
  const rr = clampByte(r1 * (1 - tc) + r2 * tc);
  const gg = clampByte(g1 * (1 - tc) + g2 * tc);
  const bb = clampByte(b1 * (1 - tc) + b2 * tc);
  return alpha < 1 ? `rgba(${rr},${gg},${bb},${alpha})` : `rgb(${rr},${gg},${bb})`;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

function deterministicHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRng(seedStr: string): () => number {
  let state = deterministicHash(seedStr) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveBlueprint(spec: NailFingerDesignSpec): NailDesignBlueprint {
  return spec.blueprint ?? buildBlueprintFromLegacySpec(spec);
}

function hashManufacturingSpec(m: Nail3DManufacturingSpec): string {
  const strokeSig = (m.strokes3D ?? [])
    .map(
      (s) =>
        `S:${s.p0[0].toFixed(3)},${s.p0[1].toFixed(3)}:${s.c1[0].toFixed(3)},${s.c1[1].toFixed(3)}:${s.c2[0].toFixed(3)},${s.c2[1].toFixed(3)}:${s.p1[0].toFixed(3)},${s.p1[1].toFixed(3)}:${s.widthNorm.toFixed(3)}:${s.colorHex}:${s.isMetallic ? 1 : 0}:${s.metalness.toFixed(2)}:${s.reliefHeight.toFixed(2)}`
    )
    .join(';');

  const motifSig = (m.motifs ?? [])
    .map(
      (mt) =>
        `M:${mt.kind}:${mt.center[0].toFixed(3)},${mt.center[1].toFixed(3)}:${mt.scale.toFixed(3)}:${mt.rotationDeg.toFixed(1)}:${mt.primaryColorHex}:${mt.secondaryColorHex}:${mt.centerDotColorHex ?? ''}:${mt.is3DRaised ? 1 : 0}:${mt.opacity.toFixed(2)}`
    )
    .join(';');

  const accSig = (m.accessories3D ?? [])
    .map(
      (a) =>
        `A:${a.kind}:${a.u.toFixed(3)},${a.v.toFixed(3)}:${a.radiusNorm.toFixed(3)}:${a.heightRatio.toFixed(2)}:${a.colorHex}:${a.hasBezelRing ? 1 : 0}`
    )
    .join(';');

  return [
    'v11',
    m.fingerId,
    m.handSide ?? '',
    m.shape,
    m.freeEdgeRatio.toFixed(2),
    m.tipRoundness.toFixed(2),
    m.cCurveDepth.toFixed(2),
    m.apexHeight.toFixed(3),
    m.substrateType,
    m.finishType,
    m.trueBaseColorHex,
    m.secondaryColorHex,
    m.cuticleColorHex,
    m.tipColorHex,
    m.gradientType,
    m.metalness.toFixed(2),
    m.roughness.toFixed(2),
    m.clearcoat.toFixed(2),
    m.translucency.toFixed(2),
    m.borderType,
    m.borderColorHex,
    m.borderWidthNorm.toFixed(3),
    m.borderIsMetallic ? '1' : '0',
    m.borderIs3DRaised ? '1' : '0',
    strokeSig,
    motifSig,
    accSig,
  ].join('|');
}

function hashShortString(str: string): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(str.length / 96));
  for (let i = 0; i < str.length; i += step) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${str.length}:${(h >>> 0).toString(36)}`;
}

export function resolveEffectiveRenderStrategy(spec: NailFingerDesignSpec): NailRenderStrategy {
  return (
    spec.renderStrategy ??
    spec.manufacturingSpec?.renderStrategy ??
    (spec.trueUvDataUrl ? 'canonical_uv_delighted' : 'procedural_pbr_3d')
  );
}

export function hashFingerSpec(spec: NailFingerDesignSpec): string {
  const effectiveStrategy = resolveEffectiveRenderStrategy(spec);
  const useTrueUv =
    (effectiveStrategy === 'canonical_uv_delighted' ||
      effectiveStrategy === 'hybrid_uv_plus_pbr_3d') &&
    Boolean(spec.trueUvDataUrl);

  if (useTrueUv && spec.trueUvDataUrl) {
    const accSig = (spec.manufacturingSpec?.accessories3D ?? [])
      .map((a) => `${a.kind}:${a.u.toFixed(2)},${a.v.toFixed(2)}:${a.radiusNorm.toFixed(2)}:${a.hasBezelRing ? 1 : 0}`)
      .join(';');
    return `v13-trueuv|${effectiveStrategy}|${spec.shape}|${hashShortString(spec.trueUvDataUrl)}|${accSig}`;
  }

  if (spec.manufacturingSpec) {
    return `${effectiveStrategy}|${hashManufacturingSpec(spec.manufacturingSpec)}`;
  }

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

// Coordinate transform from blueprint/manufacturing UV (u=0..1 left..right, v=0 cuticle .. v=1 tip)
// to Three.js CanvasTexture space (y=0 is top v=1 tip, y=h is bottom v=0 cuticle)
function uvToCanvas(u: number, v: number, w: number, h: number): [number, number] {
  return [u * w, (1 - v) * h];
}

// Maps UV (u, v) to anatomical silhouette coordinate inside UV space
function traceBorderSilhouetteUV(
  ctx: CanvasCtx2D,
  shape: NailShape,
  tipRoundness: number,
  bedFraction: number,
  profileHalfWidths:
    | [number, number, number, number, number, number, number, number]
    | undefined,
  w: number,
  h: number,
  insetFactor = 0.90
): void {
  const steps = 32;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const v = 0.04 + (i / steps) * 0.935;
    const hw =
      evalNailHalfWidth(v, shape, {
        bedFraction,
        tipRoundness,
        profileHalfWidths,
      }) * insetFactor;
    const u = 0.5 - hw * 0.96;
    const [x, y] = uvToCanvas(u, v, w, h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const v = 0.04 + (i / steps) * 0.935;
    const hw =
      evalNailHalfWidth(v, shape, {
        bedFraction,
        tipRoundness,
        profileHalfWidths,
      }) * insetFactor;
    const u = 0.5 + hw * 0.96;
    const [x, y] = uvToCanvas(u, v, w, h);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// =============================================================================
// V11 Direct PBR Compiler (`Nail3DManufacturingSpec`)
// =============================================================================

function resolveManufacturingBaseColor(m: Nail3DManufacturingSpec): string {
  if (m.trueBaseColorHex && m.trueBaseColorHex.trim()) {
    return m.trueBaseColorHex;
  }
  return '#E5BEB3';
}

function renderManufacturingBaseLayer(
  m: Nail3DManufacturingSpec,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  const baseHex = resolveManufacturingBaseColor(m);
  const secondaryHex = m.secondaryColorHex || mixHex(baseHex, '#FFFFFF', 0.35);
  const cuticleHex = m.cuticleColorHex || shadeHex(baseHex, -6);
  const tipHex = m.tipColorHex || baseHex;
  const finish: Nail3DFinishType = m.finishType;
  const gradType = m.gradientType;

  // 1. Optical Base & Gradient Synthesis (ZERO muddy dark/gray smudges on chrome!)
  if (finish === 'mirror_chrome' || gradType === 'chrome_sheen') {
    // Ultra-clean uniform metallic base with subtle warm-bright chrome sheen
    const chromeGrad = albedoCtx.createLinearGradient(0, 0, w, h);
    chromeGrad.addColorStop(0.0, mixHex(baseHex, '#FFFFFF', 0.06));
    chromeGrad.addColorStop(0.32, mixHex(baseHex, '#FFFDF7', 0.16));
    chromeGrad.addColorStop(0.54, baseHex);
    chromeGrad.addColorStop(0.78, mixHex(baseHex, secondaryHex, 0.14));
    chromeGrad.addColorStop(1.0, mixHex(baseHex, '#FFFFFF', 0.05));
    albedoCtx.fillStyle = chromeGrad;
    albedoCtx.fillRect(0, 0, w, h);

    // Subtle pearlescent sheen ribbon without ever introducing black/gray blotches
    const sheen = albedoCtx.createRadialGradient(
      w * 0.42,
      h * 0.38,
      w * 0.04,
      w * 0.48,
      h * 0.44,
      w * 0.62
    );
    sheen.addColorStop(0.0, 'rgba(255, 253, 245, 0.22)');
    sheen.addColorStop(0.55, 'rgba(255, 250, 238, 0.08)');
    sheen.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
    albedoCtx.fillStyle = sheen;
    albedoCtx.fillRect(0, 0, w, h);
  } else if (finish === 'glazed_pearl') {
    const pearlGrad = albedoCtx.createLinearGradient(0, 0, w, h);
    pearlGrad.addColorStop(0.0, mixHex(baseHex, '#FFFDFB', 0.12));
    pearlGrad.addColorStop(0.36, mixHex(baseHex, secondaryHex, 0.28));
    pearlGrad.addColorStop(0.62, mixHex(baseHex, '#FFFFFF', 0.34));
    pearlGrad.addColorStop(1.0, mixHex(baseHex, tipHex, 0.20));
    albedoCtx.fillStyle = pearlGrad;
    albedoCtx.fillRect(0, 0, w, h);

    // Iridescent glazed halo
    const glaze = albedoCtx.createRadialGradient(
      w * 0.46,
      h * 0.40,
      w * 0.04,
      w * 0.50,
      h * 0.45,
      w * 0.56
    );
    glaze.addColorStop(0.0, 'rgba(255, 252, 255, 0.36)');
    glaze.addColorStop(0.52, 'rgba(246, 238, 255, 0.14)');
    glaze.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
    albedoCtx.fillStyle = glaze;
    albedoCtx.fillRect(0, 0, w, h);
  } else if (finish === 'jelly_translucent') {
    // Natural rosy nail bed warmth near proximal cuticle transitioning into translucent gel
    const naturalBedRose = mixHex('#E7B4AD', cuticleHex, 0.38);
    const jellyGrad = albedoCtx.createLinearGradient(0, 0, 0, h);
    jellyGrad.addColorStop(0.0, tipHex);
    jellyGrad.addColorStop(0.42, baseHex);
    jellyGrad.addColorStop(0.76, mixHex(baseHex, naturalBedRose, 0.42));
    jellyGrad.addColorStop(1.0, naturalBedRose);
    albedoCtx.fillStyle = jellyGrad;
    albedoCtx.fillRect(0, 0, w, h);

    // Soft milky lunula depth at cuticle root
    const lunula = albedoCtx.createRadialGradient(
      w * 0.5,
      h * 0.96,
      w * 0.04,
      w * 0.5,
      h * 0.94,
      w * 0.28
    );
    lunula.addColorStop(0.0, 'rgba(255, 246, 242, 0.26)');
    lunula.addColorStop(1.0, 'rgba(255, 246, 242, 0)');
    albedoCtx.fillStyle = lunula;
    albedoCtx.fillRect(0, h * 0.65, w, h * 0.35);
  } else if (finish === 'cat_eye_magnetic' || gradType === 'cat_eye_diagonal') {
    albedoCtx.fillStyle = baseHex;
    albedoCtx.fillRect(0, 0, w, h);

    // Luminous diagonal magnetic velvet band
    const band = albedoCtx.createLinearGradient(0, h * 0.10, w, h * 0.90);
    band.addColorStop(0.0, shadeHex(baseHex, -10));
    band.addColorStop(0.35, mixHex(baseHex, secondaryHex, 0.44));
    band.addColorStop(0.50, mixHex(secondaryHex, '#FFF9F2', 0.46));
    band.addColorStop(0.65, mixHex(baseHex, secondaryHex, 0.44));
    band.addColorStop(1.0, shadeHex(baseHex, -12));
    albedoCtx.fillStyle = band;
    albedoCtx.fillRect(0, 0, w, h);
  } else {
    // solid_gloss_gel | velvet_matte | glitter_suspension
    // Pure rich pigment (preserves deep burgundy #5A0A1E, obsidian, etc. with zero washout!)
    const solidGrad = albedoCtx.createLinearGradient(0, 0, 0, h);
    solidGrad.addColorStop(0.0, shadeHex(baseHex, 3));
    solidGrad.addColorStop(0.55, baseHex);
    solidGrad.addColorStop(1.0, shadeHex(baseHex, -4));
    albedoCtx.fillStyle = solidGrad;
    albedoCtx.fillRect(0, 0, w, h);
  }

  // Apply explicit vertical_ombre or radial_aura overlays when requested
  if (gradType === 'vertical_ombre') {
    const ombre = albedoCtx.createLinearGradient(0, 0, 0, h);
    ombre.addColorStop(0.0, tipHex);
    ombre.addColorStop(0.48, baseHex);
    ombre.addColorStop(0.90, cuticleHex);
    ombre.addColorStop(1.0, shadeHex(cuticleHex, -5));
    albedoCtx.fillStyle = ombre;
    albedoCtx.fillRect(0, 0, w, h);
  } else if (gradType === 'radial_aura') {
    const aura = albedoCtx.createRadialGradient(
      w * 0.5,
      h * 0.48,
      w * 0.04,
      w * 0.5,
      h * 0.48,
      h * 0.44
    );
    aura.addColorStop(0.0, hexWithAlpha(secondaryHex, 0.96));
    aura.addColorStop(0.38, hexWithAlpha(mixHex(secondaryHex, baseHex, 0.45), 0.78));
    aura.addColorStop(0.78, hexWithAlpha(baseHex, 0.25));
    aura.addColorStop(1.0, hexWithAlpha(baseHex, 0));
    albedoCtx.fillStyle = aura;
    albedoCtx.fillRect(0, 0, w, h);
  }

  // Subtle substrate warmth near proximal root ONLY when non-chrome & translucent/light (zero dark pigment wash)
  if (finish === 'solid_gloss_gel') {
    const [br, bg, bb] = parseHex(baseHex);
    const luma = (0.299 * br + 0.587 * bg + 0.114 * bb) / 255;
    if (luma > 0.50 || m.substrateType === 'natural_sheer' || m.substrateType === 'milky_jelly') {
      const microLunula = albedoCtx.createRadialGradient(
        w * 0.5,
        h * 0.97,
        w * 0.03,
        w * 0.5,
        h * 0.95,
        w * 0.24
      );
      const strength = m.substrateType === 'natural_sheer' ? 0.20 : 0.09;
      microLunula.addColorStop(0, `rgba(255, 245, 240, ${strength})`);
      microLunula.addColorStop(1, 'rgba(255, 245, 240, 0)');
      albedoCtx.fillStyle = microLunula;
      albedoCtx.fillRect(0, h * 0.72, w, h * 0.28);
    } else {
      // Micro-depth at cuticle crease without lightening or muddying deep burgundy/black
      const deepRoot = albedoCtx.createLinearGradient(0, h * 0.88, 0, h);
      deepRoot.addColorStop(0, 'rgba(14, 4, 8, 0)');
      deepRoot.addColorStop(1, 'rgba(14, 4, 8, 0.14)');
      albedoCtx.fillStyle = deepRoot;
      albedoCtx.fillRect(0, h * 0.88, w, h * 0.12);
    }
  }

  // 2. Base Metalness & Roughness maps (256×256)
  let baseMetalFloat = clamp01(m.metalness);
  let baseRoughFloat = clamp(m.roughness, 0.04, 0.55);

  if (finish === 'mirror_chrome') {
    baseMetalFloat = Math.max(0.92, baseMetalFloat || 0.96);
    baseRoughFloat = Math.min(0.08, baseRoughFloat || 0.06);
  } else if (finish === 'glazed_pearl') {
    baseMetalFloat = clamp(m.metalness || 0.42, 0.30, 0.65);
    baseRoughFloat = clamp(m.roughness || 0.12, 0.07, 0.20);
  } else if (finish === 'velvet_matte') {
    baseMetalFloat = clamp(m.metalness || 0.02, 0, 0.10);
    baseRoughFloat = clamp(m.roughness || 0.44, 0.36, 0.55);
  } else if (finish === 'cat_eye_magnetic') {
    baseMetalFloat = clamp(m.metalness || 0.45, 0.25, 0.72);
    baseRoughFloat = clamp(m.roughness || 0.11, 0.06, 0.20);
  }

  const baseMetalByte = clampByte(baseMetalFloat * 255);
  const baseRoughByte = clampByte(baseRoughFloat * 255);

  metalCtx.fillStyle = `rgb(${baseMetalByte},${baseMetalByte},${baseMetalByte})`;
  metalCtx.fillRect(0, 0, auxW, auxH);

  roughCtx.fillStyle = `rgb(${baseRoughByte},${baseRoughByte},${baseRoughByte})`;
  roughCtx.fillRect(0, 0, auxW, auxH);

  // Elevated metalness along the diagonal magnetic band for cat_eye_magnetic
  if (finish === 'cat_eye_magnetic' || gradType === 'cat_eye_diagonal') {
    const bandMetal = clampByte(Math.max(baseMetalFloat, 0.88) * 255);
    const bandMetalGrad = metalCtx.createLinearGradient(0, auxH * 0.10, auxW, auxH * 0.90);
    bandMetalGrad.addColorStop(0.0, `rgba(${bandMetal},${bandMetal},${bandMetal},0)`);
    bandMetalGrad.addColorStop(0.36, `rgba(${bandMetal},${bandMetal},${bandMetal},0.45)`);
    bandMetalGrad.addColorStop(0.50, `rgba(${bandMetal},${bandMetal},${bandMetal},1.0)`);
    bandMetalGrad.addColorStop(0.64, `rgba(${bandMetal},${bandMetal},${bandMetal},0.45)`);
    bandMetalGrad.addColorStop(1.0, `rgba(${bandMetal},${bandMetal},${bandMetal},0)`);
    metalCtx.fillStyle = bandMetalGrad;
    metalCtx.fillRect(0, 0, auxW, auxH);

    const bandRough = clampByte(Math.min(baseRoughFloat, 0.08) * 255);
    const bandRoughGrad = roughCtx.createLinearGradient(0, auxH * 0.10, auxW, auxH * 0.90);
    bandRoughGrad.addColorStop(0.0, `rgba(${bandRough},${bandRough},${bandRough},0)`);
    bandRoughGrad.addColorStop(0.50, `rgba(${bandRough},${bandRough},${bandRough},0.92)`);
    bandRoughGrad.addColorStop(1.0, `rgba(${bandRough},${bandRough},${bandRough},0)`);
    roughCtx.fillStyle = bandRoughGrad;
    roughCtx.fillRect(0, 0, auxW, auxH);
  }

  // Ultra-subtle velvety micro-grain for velvet_matte
  if (finish === 'velvet_matte') {
    const rng = createSeededRng(`velvet:${m.fingerId}:${baseHex}`);
    const step = Math.max(2, Math.round(w / 128));
    albedoCtx.save();
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const n = rng();
        if (n > 0.65) {
          albedoCtx.fillStyle = 'rgba(255,255,255,0.018)';
          albedoCtx.fillRect(x, y, 1, 1);
        } else if (n < 0.25) {
          albedoCtx.fillStyle = 'rgba(0,0,0,0.018)';
          albedoCtx.fillRect(x, y, 1, 1);
        }
      }
    }
    albedoCtx.restore();

    const rAuxStep = Math.max(2, Math.round(auxW / 64));
    roughCtx.save();
    for (let y = 0; y < auxH; y += rAuxStep) {
      for (let x = 0; x < auxW; x += rAuxStep) {
        const delta = Math.round((rng() - 0.5) * 18);
        const rv = clampByte(baseRoughByte + delta);
        roughCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
        roughCtx.fillRect(x, y, rAuxStep, rAuxStep);
      }
    }
    roughCtx.restore();
  }

  // Deterministic metallic micro-glitter particles for glitter_suspension
  if (finish === 'glitter_suspension') {
    const rng = createSeededRng(`glitter:${m.fingerId}:${baseHex}:${secondaryHex}`);
    const count = 135;
    for (let i = 0; i < count; i++) {
      const u = 0.08 + rng() * 0.84;
      const v = 0.06 + rng() * 0.88;
      const [gx, gy] = uvToCanvas(u, v, w, h);
      const r = w * (0.004 + rng() * 0.009);
      const [ax, ay] = uvToCanvas(u, v, auxW, auxH);
      const rAux = Math.max(1.2, auxW * (0.005 + rng() * 0.01));
      const useAlt = rng() > 0.45;
      const flakeHex = useAlt ? mixHex(secondaryHex, '#FFFFFF', 0.55) : mixHex(baseHex, '#FFFDF5', 0.68);
      const alpha = 0.48 + rng() * 0.48;

      albedoCtx.save();
      albedoCtx.translate(gx, gy);
      albedoCtx.rotate(rng() * Math.PI);
      albedoCtx.fillStyle = hexWithAlpha(flakeHex, alpha);
      albedoCtx.beginPath();
      if (i % 3 === 0) {
        albedoCtx.rect(-r, -r, r * 2, r * 2);
      } else {
        albedoCtx.arc(0, 0, r, 0, Math.PI * 2);
      }
      albedoCtx.fill();
      albedoCtx.restore();

      const hPeak = clampByte(115 + rng() * 65);
      heightCtx.fillStyle = `rgb(${hPeak},${hPeak},${hPeak})`;
      heightCtx.beginPath();
      heightCtx.arc(gx, gy, r * 0.9, 0, Math.PI * 2);
      heightCtx.fill();

      metalCtx.fillStyle = 'rgb(245,245,245)';
      metalCtx.beginPath();
      metalCtx.arc(ax, ay, rAux, 0, Math.PI * 2);
      metalCtx.fill();

      roughCtx.fillStyle = 'rgb(18,18,18)';
      roughCtx.beginPath();
      roughCtx.arc(ax, ay, rAux, 0, Math.PI * 2);
      roughCtx.fill();
    }
  }
}

function renderManufacturingBorderLayer(
  m: Nail3DManufacturingSpec,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  if (!m.borderType || m.borderType === 'none') return;

  const borderColor = m.borderColorHex || '#D4AF37';
  const strokeW = Math.max(4, w * clamp(m.borderWidthNorm || 0.055, 0.02, 0.28));
  const strokeWAux = Math.max(2, strokeW * (auxW / w));
  const metalByte = m.borderIsMetallic ? 245 : 0;
  const roughByte = m.borderIsMetallic ? 18 : 28;
  const reliefByte = m.borderIs3DRaised ? 242 : 148;
  const bedFraction = clamp(1 / (1 + clamp(m.freeEdgeRatio || 0.42, 0.12, 1.15)), 0.44, 0.90);

  if (m.borderType === 'full_perimeter_outline') {
    albedoCtx.save();
    albedoCtx.lineJoin = 'round';
    albedoCtx.lineCap = 'round';
    traceBorderSilhouetteUV(
      albedoCtx,
      m.shape,
      m.tipRoundness,
      bedFraction,
      undefined,
      w,
      h,
      0.89
    );
    if (m.borderIs3DRaised) {
      albedoCtx.strokeStyle = 'rgba(22, 10, 8, 0.34)';
      albedoCtx.lineWidth = strokeW * 1.38;
      albedoCtx.stroke();
    }
    albedoCtx.strokeStyle = borderColor;
    albedoCtx.lineWidth = strokeW;
    albedoCtx.stroke();

    if (m.borderIsMetallic) {
      albedoCtx.strokeStyle = mixHex(borderColor, '#FFF8DF', 0.58, 0.72);
      albedoCtx.lineWidth = strokeW * 0.34;
      albedoCtx.stroke();
    }
    albedoCtx.restore();

    if (m.borderIs3DRaised) {
      heightCtx.save();
      heightCtx.lineJoin = 'round';
      heightCtx.lineCap = 'round';
      traceBorderSilhouetteUV(
        heightCtx,
        m.shape,
        m.tipRoundness,
        bedFraction,
        undefined,
        w,
        h,
        0.89
      );
      heightCtx.strokeStyle = `rgb(${reliefByte},${reliefByte},${reliefByte})`;
      heightCtx.lineWidth = strokeW * 1.06;
      heightCtx.stroke();
      heightCtx.strokeStyle = 'rgb(255,255,255)';
      heightCtx.lineWidth = strokeW * 0.42;
      heightCtx.stroke();
      heightCtx.restore();
    }

    metalCtx.save();
    metalCtx.lineJoin = 'round';
    metalCtx.lineCap = 'round';
    traceBorderSilhouetteUV(
      metalCtx,
      m.shape,
      m.tipRoundness,
      bedFraction,
      undefined,
      auxW,
      auxH,
      0.89
    );
    metalCtx.strokeStyle = `rgb(${metalByte},${metalByte},${metalByte})`;
    metalCtx.lineWidth = strokeWAux * 1.05;
    metalCtx.stroke();
    metalCtx.restore();

    roughCtx.save();
    roughCtx.lineJoin = 'round';
    roughCtx.lineCap = 'round';
    traceBorderSilhouetteUV(
      roughCtx,
      m.shape,
      m.tipRoundness,
      bedFraction,
      undefined,
      auxW,
      auxH,
      0.89
    );
    roughCtx.strokeStyle = `rgb(${roughByte},${roughByte},${roughByte})`;
    roughCtx.lineWidth = strokeWAux * 1.05;
    roughCtx.stroke();
    roughCtx.restore();
    return;
  }

  if (m.borderType === 'cuticle_cuff') {
    const drawCuff = (ctx: CanvasCtx2D, cw: number, ch: number) => {
      const yBase = ch * 0.935;
      const dip = ch * 0.055;
      ctx.beginPath();
      ctx.moveTo(cw * 0.14, yBase - dip * 0.85);
      ctx.quadraticCurveTo(cw * 0.50, yBase + dip, cw * 0.86, yBase - dip * 0.85);
    };

    albedoCtx.save();
    albedoCtx.lineCap = 'round';
    drawCuff(albedoCtx, w, h);
    if (m.borderIs3DRaised) {
      albedoCtx.strokeStyle = 'rgba(22, 10, 8, 0.28)';
      albedoCtx.lineWidth = strokeW * 1.32;
      albedoCtx.stroke();
    }
    albedoCtx.strokeStyle = borderColor;
    albedoCtx.lineWidth = strokeW;
    albedoCtx.stroke();
    if (m.borderIsMetallic) {
      albedoCtx.strokeStyle = mixHex(borderColor, '#FFF8DF', 0.58, 0.74);
      albedoCtx.lineWidth = strokeW * 0.34;
      albedoCtx.stroke();
    }
    albedoCtx.restore();

    if (m.borderIs3DRaised) {
      heightCtx.save();
      heightCtx.lineCap = 'round';
      drawCuff(heightCtx, w, h);
      heightCtx.strokeStyle = `rgb(${reliefByte},${reliefByte},${reliefByte})`;
      heightCtx.lineWidth = strokeW;
      heightCtx.stroke();
      heightCtx.restore();
    }

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
    return;
  }

  // French tips: classic_french | micro_french | deep_v_french
  const tipDepth =
    m.borderType === 'micro_french'
      ? clamp(m.borderWidthNorm || 0.065, 0.035, 0.11)
      : m.borderType === 'deep_v_french'
        ? clamp(m.borderWidthNorm || 0.22, 0.14, 0.32)
        : clamp(m.borderWidthNorm || 0.17, 0.10, 0.28);

  const smileDepth =
    m.borderType === 'micro_french'
      ? 0.085
      : m.borderType === 'deep_v_french'
        ? 0.24
        : 0.15;

  const traceFrenchTip = (ctx: CanvasCtx2D, cw: number, ch: number) => {
    const tipY = ch * tipDepth;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cw, 0);
    if (m.borderType === 'deep_v_french') {
      ctx.lineTo(cw, tipY * 0.42);
      ctx.quadraticCurveTo(cw * 0.72, tipY * 0.85, cw * 0.5, tipY + ch * smileDepth * 0.48);
      ctx.quadraticCurveTo(cw * 0.28, tipY * 0.85, 0, tipY * 0.42);
    } else {
      ctx.lineTo(cw, tipY + ch * smileDepth * 0.46);
      ctx.quadraticCurveTo(
        cw * 0.5,
        tipY - ch * smileDepth * 0.58,
        0,
        tipY + ch * smileDepth * 0.46
      );
    }
    ctx.closePath();
  };

  albedoCtx.save();
  traceFrenchTip(albedoCtx, w, h);
  const fGrad = albedoCtx.createLinearGradient(0, 0, w, h * tipDepth);
  fGrad.addColorStop(0.0, shadeHex(borderColor, -6));
  fGrad.addColorStop(0.5, borderColor);
  fGrad.addColorStop(1.0, shadeHex(borderColor, -6));
  albedoCtx.fillStyle = fGrad;
  albedoCtx.fill();

  if (m.borderIsMetallic) {
    albedoCtx.strokeStyle = mixHex(borderColor, '#FFF8DF', 0.45, 0.78);
    albedoCtx.lineWidth = Math.max(2, w * 0.014);
    albedoCtx.stroke();
  }
  albedoCtx.restore();

  if (m.borderIs3DRaised) {
    heightCtx.save();
    traceFrenchTip(heightCtx, w, h);
    const hVal = 196;
    heightCtx.fillStyle = `rgb(${hVal},${hVal},${hVal})`;
    heightCtx.fill();
    heightCtx.restore();
  }

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

function renderManufacturingStroke3D(
  stroke: Nail3DStrokeSpec,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  const [x0, y0] = uvToCanvas(stroke.p0[0], stroke.p0[1], w, h);
  const [cx1, cy1] = uvToCanvas(stroke.c1[0], stroke.c1[1], w, h);
  const [cx2, cy2] = uvToCanvas(stroke.c2[0], stroke.c2[1], w, h);
  const [x1, y1] = uvToCanvas(stroke.p1[0], stroke.p1[1], w, h);

  const [ax0, ay0] = uvToCanvas(stroke.p0[0], stroke.p0[1], auxW, auxH);
  const [acx1, acy1] = uvToCanvas(stroke.c1[0], stroke.c1[1], auxW, auxH);
  const [acx2, acy2] = uvToCanvas(stroke.c2[0], stroke.c2[1], auxW, auxH);
  const [ax1, ay1] = uvToCanvas(stroke.p1[0], stroke.p1[1], auxW, auxH);

  const lineW = Math.max(2.5, clamp(stroke.widthNorm, 0.01, 0.16) * w);
  const lineWAux = Math.max(1.5, clamp(stroke.widthNorm, 0.01, 0.16) * auxW);
  const relief = clamp01(stroke.reliefHeight ?? 0.75);
  const colorHex = stroke.colorHex || '#D4AF37';
  const highlightHex = stroke.isMetallic
    ? mixHex(colorHex, '#FFF9E3', 0.56)
    : mixHex(colorHex, '#FFFFFF', 0.34);

  const traceBezier = (ctx: CanvasCtx2D, ox = 0, oy = 0) => {
    ctx.beginPath();
    ctx.moveTo(x0 + ox, y0 + oy);
    ctx.bezierCurveTo(cx1 + ox, cy1 + oy, cx2 + ox, cy2 + oy, x1 + ox, y1 + oy);
  };

  // 1. Albedo volumetric shading
  albedoCtx.save();
  albedoCtx.lineCap = 'round';
  albedoCtx.lineJoin = 'round';

  // Soft contact AO shadow beneath raised gel/metal stroke
  if (relief > 0.15) {
    traceBezier(albedoCtx, 0, lineW * 0.15);
    albedoCtx.strokeStyle = `rgba(24, 10, 8, ${(0.18 + relief * 0.16).toFixed(2)})`;
    albedoCtx.lineWidth = lineW * 1.24;
    albedoCtx.stroke();
  }

  // Dark sculptural bevel rim
  traceBezier(albedoCtx);
  albedoCtx.strokeStyle = shadeHex(colorHex, stroke.isMetallic ? -34 : -22);
  albedoCtx.lineWidth = lineW * 1.06;
  albedoCtx.stroke();

  // Main body gradient along Bézier chord
  const grad = albedoCtx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0.0, shadeHex(colorHex, -14));
  grad.addColorStop(0.38, colorHex);
  grad.addColorStop(0.56, highlightHex);
  grad.addColorStop(0.82, colorHex);
  grad.addColorStop(1.0, shadeHex(colorHex, -18));
  albedoCtx.strokeStyle = grad;
  albedoCtx.lineWidth = lineW * 0.90;
  albedoCtx.stroke();

  // Cylindrical specular crest ridge
  traceBezier(albedoCtx, -lineW * 0.05, -lineW * 0.07);
  albedoCtx.strokeStyle = mixHex(highlightHex, '#FFFFFF', 0.45, stroke.isMetallic ? 0.80 : 0.46);
  albedoCtx.lineWidth = Math.max(1.2, lineW * 0.26);
  albedoCtx.stroke();
  albedoCtx.restore();

  // 2. Cylindrical height ridge in heightCanvas (for Sobel normalMap)
  if (relief > 0.04) {
    const midH = clampByte(106 + relief * 95);
    const peakH = clampByte(115 + relief * 140);
    heightCtx.save();
    heightCtx.lineCap = 'round';
    heightCtx.lineJoin = 'round';
    traceBezier(heightCtx);
    heightCtx.strokeStyle = `rgb(${midH},${midH},${midH})`;
    heightCtx.lineWidth = lineW * 1.05;
    heightCtx.stroke();
    heightCtx.strokeStyle = `rgb(${peakH},${peakH},${peakH})`;
    heightCtx.lineWidth = lineW * 0.46;
    heightCtx.stroke();
    heightCtx.restore();
  }

  // 3. Surgical metalness & roughness over stroke (256×256)
  const metalVal = stroke.isMetallic
    ? clampByte(clamp(stroke.metalness || 0.95, 0.7, 1.0) * 255)
    : clampByte(clamp01(stroke.metalness || 0) * 255);
  const roughVal = stroke.isMetallic ? 18 : 26;

  metalCtx.save();
  metalCtx.lineCap = 'round';
  metalCtx.lineJoin = 'round';
  metalCtx.beginPath();
  metalCtx.moveTo(ax0, ay0);
  metalCtx.bezierCurveTo(acx1, acy1, acx2, acy2, ax1, ay1);
  metalCtx.strokeStyle = `rgb(${metalVal},${metalVal},${metalVal})`;
  metalCtx.lineWidth = lineWAux * 1.04;
  metalCtx.stroke();
  metalCtx.restore();

  roughCtx.save();
  roughCtx.lineCap = 'round';
  roughCtx.lineJoin = 'round';
  roughCtx.beginPath();
  roughCtx.moveTo(ax0, ay0);
  roughCtx.bezierCurveTo(acx1, acy1, acx2, acy2, ax1, ay1);
  roughCtx.strokeStyle = `rgb(${roughVal},${roughVal},${roughVal})`;
  roughCtx.lineWidth = lineWAux * 1.04;
  roughCtx.stroke();
  roughCtx.restore();
}

function drawRoundedPetal(
  ctx: CanvasCtx2D,
  angleRad: number,
  offsetDist: number,
  lenR: number,
  widthR: number
): void {
  ctx.save();
  ctx.rotate(angleRad);
  ctx.translate(offsetDist, 0);
  ctx.beginPath();
  ctx.moveTo(-lenR * 0.42, 0);
  ctx.bezierCurveTo(-lenR * 0.20, -widthR, lenR * 0.48, -widthR * 0.92, lenR * 0.62, 0);
  ctx.bezierCurveTo(lenR * 0.48, widthR * 0.92, -lenR * 0.20, widthR, -lenR * 0.42, 0);
  ctx.closePath();
  ctx.restore();
}

function drawHeartPath(ctx: CanvasCtx2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.78);
  ctx.bezierCurveTo(-r * 0.95, r * 0.25, -r * 1.05, -r * 0.55, -r * 0.45, -r * 0.78);
  ctx.bezierCurveTo(-r * 0.15, -r * 0.90, 0, -r * 0.55, 0, -r * 0.36);
  ctx.bezierCurveTo(0, -r * 0.55, r * 0.15, -r * 0.90, r * 0.45, -r * 0.78);
  ctx.bezierCurveTo(r * 1.05, -r * 0.55, r * 0.95, r * 0.25, 0, r * 0.78);
  ctx.closePath();
}

function drawStar4PtPath(ctx: CanvasCtx2D, r: number): void {
  const inner = r * 0.24;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(inner * 0.6, -inner * 0.6, r, 0);
  ctx.quadraticCurveTo(inner * 0.6, inner * 0.6, 0, r);
  ctx.quadraticCurveTo(-inner * 0.6, inner * 0.6, -r, 0);
  ctx.quadraticCurveTo(-inner * 0.6, -inner * 0.6, 0, -r);
  ctx.closePath();
}

function renderManufacturingMotif(
  motif: Nail3DMotifSpec,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  const [cx, cy] = uvToCanvas(motif.center[0], motif.center[1], w, h);
  const [ax, ay] = uvToCanvas(motif.center[0], motif.center[1], auxW, auxH);
  const r = Math.max(6, clamp(motif.scale || 0.18, 0.05, 0.65) * w);
  const rAux = Math.max(3, clamp(motif.scale || 0.18, 0.05, 0.65) * auxW);
  const rot = ((motif.rotationDeg || 0) * Math.PI) / 180;
  const alpha = clamp(motif.opacity ?? 1, 0.05, 1.0);
  const primary = motif.primaryColorHex || '#FFF8F4';
  const secondary = motif.secondaryColorHex || shadeHex(primary, -24);
  const centerDot = motif.centerDotColorHex || '#D4AF37';
  const raised = Boolean(motif.is3DRaised);
  const reliefVal = raised ? 236 : 122;

  const drawFlower = (petalCount: number) => {
    const petalLen = r * 0.56;
    const petalWid = petalCount === 4 ? r * 0.32 : r * 0.27;
    const offset = r * 0.44;

    const paintPetals = (
      ctx: CanvasCtx2D,
      px: number,
      py: number,
      pr: number,
      pLen: number,
      pWid: number,
      pOff: number,
      mode: 'albedo' | 'height'
    ) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      if (mode === 'albedo') ctx.globalAlpha = alpha;

      for (let i = 0; i < petalCount; i++) {
        const theta = (i * Math.PI * 2) / petalCount;
        ctx.save();
        ctx.rotate(theta);
        ctx.translate(pOff, 0);

        if (mode === 'albedo' && raised) {
          ctx.beginPath();
          ctx.ellipse(pLen * 0.08, pLen * 0.08, pLen * 0.56, pWid * 1.05, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(20, 8, 6, 0.20)';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.moveTo(-pLen * 0.44, 0);
        ctx.bezierCurveTo(-pLen * 0.18, -pWid, pLen * 0.48, -pWid * 0.90, pLen * 0.64, 0);
        ctx.bezierCurveTo(pLen * 0.48, pWid * 0.90, -pLen * 0.18, pWid, -pLen * 0.44, 0);
        ctx.closePath();

        if (mode === 'albedo') {
          const g = ctx.createRadialGradient(-pLen * 0.12, 0, pLen * 0.06, pLen * 0.10, 0, pLen * 0.65);
          g.addColorStop(0.0, mixHex(primary, secondary, 0.25));
          g.addColorStop(0.55, primary);
          g.addColorStop(1.0, mixHex(primary, '#FFFFFF', 0.28));
          ctx.fillStyle = g;
          ctx.fill();
          ctx.strokeStyle = shadeHex(secondary, -16, 0.42);
          ctx.lineWidth = Math.max(1, pr * 0.035);
          ctx.stroke();
        } else {
          const hg = ctx.createRadialGradient(pLen * 0.06, 0, 1, pLen * 0.06, 0, pLen * 0.68);
          hg.addColorStop(0.0, `rgb(${reliefVal},${reliefVal},${reliefVal})`);
          hg.addColorStop(1.0, 'rgb(110,110,110)');
          ctx.fillStyle = hg;
          ctx.fill();
        }
        ctx.restore();
      }

      // Center pistil dot
      const dotR = Math.max(2, pr * 0.18);
      if (mode === 'albedo') {
        const dg = ctx.createRadialGradient(-dotR * 0.3, -dotR * 0.3, 0.5, 0, 0, dotR);
        dg.addColorStop(0.0, mixHex(centerDot, '#FFFFFF', 0.55));
        dg.addColorStop(0.6, centerDot);
        dg.addColorStop(1.0, shadeHex(centerDot, -32));
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.arc(0, 0, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgb(248,248,248)';
        ctx.beginPath();
        ctx.arc(0, 0, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    paintPetals(albedoCtx, cx, cy, r, petalLen, petalWid, offset, 'albedo');
    if (raised) {
      paintPetals(heightCtx, cx, cy, r, petalLen, petalWid, offset, 'height');
    }
  };

  if (motif.kind === 'flower_5petal') {
    drawFlower(5);
    return;
  }

  if (motif.kind === 'flower_4petal') {
    drawFlower(4);
    return;
  }

  if (motif.kind === 'cherry') {
    const berryR = r * 0.28;
    const leftX = -r * 0.34;
    const rightX = r * 0.30;
    const berryY = r * 0.34;
    const stemTopX = r * 0.04;
    const stemTopY = -r * 0.62;

    const paintCherry = (ctx: CanvasCtx2D, px: number, py: number, mode: 'albedo' | 'height') => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      if (mode === 'albedo') ctx.globalAlpha = alpha;

      // Stems
      ctx.beginPath();
      ctx.moveTo(leftX, berryY - berryR * 0.65);
      ctx.quadraticCurveTo(-r * 0.18, -r * 0.16, stemTopX, stemTopY);
      ctx.moveTo(rightX, berryY - berryR * 0.65);
      ctx.quadraticCurveTo(r * 0.20, -r * 0.14, stemTopX, stemTopY);
      ctx.strokeStyle = mode === 'albedo' ? '#3B6E3A' : 'rgb(142,142,142)';
      ctx.lineWidth = Math.max(1.5, r * 0.055);
      ctx.lineCap = 'round';
      ctx.stroke();

      // Leaf
      ctx.beginPath();
      ctx.moveTo(stemTopX, stemTopY);
      ctx.quadraticCurveTo(stemTopX + r * 0.38, stemTopY - r * 0.16, stemTopX + r * 0.44, stemTopY + r * 0.14);
      ctx.quadraticCurveTo(stemTopX + r * 0.18, stemTopY + r * 0.22, stemTopX, stemTopY);
      ctx.fillStyle = mode === 'albedo' ? '#4C8B48' : 'rgb(154,154,154)';
      ctx.fill();

      // Two glossy cherries
      for (const bx of [leftX, rightX]) {
        if (mode === 'albedo') {
          ctx.fillStyle = 'rgba(20, 6, 8, 0.24)';
          ctx.beginPath();
          ctx.arc(bx + berryR * 0.10, berryY + berryR * 0.14, berryR * 1.06, 0, Math.PI * 2);
          ctx.fill();

          const bg = ctx.createRadialGradient(
            bx - berryR * 0.32,
            berryY - berryR * 0.32,
            berryR * 0.08,
            bx,
            berryY,
            berryR
          );
          bg.addColorStop(0.0, mixHex(primary, '#FFFFFF', 0.35));
          bg.addColorStop(0.55, primary);
          bg.addColorStop(1.0, shadeHex(secondary, -25));
          ctx.fillStyle = bg;
          ctx.beginPath();
          ctx.arc(bx, berryY, berryR, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.ellipse(bx - berryR * 0.32, berryY - berryR * 0.32, berryR * 0.24, berryR * 0.13, -0.6, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const hg = ctx.createRadialGradient(bx, berryY, 1, bx, berryY, berryR);
          hg.addColorStop(0.0, `rgb(${reliefVal},${reliefVal},${reliefVal})`);
          hg.addColorStop(1.0, 'rgb(108,108,108)');
          ctx.fillStyle = hg;
          ctx.beginPath();
          ctx.arc(bx, berryY, berryR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    paintCherry(albedoCtx, cx, cy, 'albedo');
    if (raised) paintCherry(heightCtx, cx, cy, 'height');
    return;
  }

  if (motif.kind === 'heart') {
    albedoCtx.save();
    albedoCtx.translate(cx, cy);
    albedoCtx.rotate(rot);
    albedoCtx.globalAlpha = alpha;
    drawHeartPath(albedoCtx, r * 0.72);
    const hg = albedoCtx.createRadialGradient(-r * 0.18, -r * 0.18, r * 0.05, 0, 0, r * 0.8);
    hg.addColorStop(0.0, mixHex(primary, '#FFFFFF', 0.28));
    hg.addColorStop(0.65, primary);
    hg.addColorStop(1.0, secondary);
    albedoCtx.fillStyle = hg;
    albedoCtx.fill();
    albedoCtx.strokeStyle = shadeHex(secondary, -14, 0.45);
    albedoCtx.lineWidth = Math.max(1, r * 0.04);
    albedoCtx.stroke();
    albedoCtx.restore();

    if (raised) {
      heightCtx.save();
      heightCtx.translate(cx, cy);
      heightCtx.rotate(rot);
      drawHeartPath(heightCtx, r * 0.72);
      heightCtx.fillStyle = `rgb(${reliefVal},${reliefVal},${reliefVal})`;
      heightCtx.fill();
      heightCtx.restore();
    }
    return;
  }

  if (motif.kind === 'star_4pt') {
    const drawStar = (ctx: CanvasCtx2D, px: number, py: number, pr: number, fill: string) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      drawStar4PtPath(ctx, pr * 0.88);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    };

    albedoCtx.save();
    albedoCtx.globalAlpha = alpha;
    drawStar(albedoCtx, cx + r * 0.04, cy + r * 0.05, r, 'rgba(20, 10, 6, 0.25)');
    albedoCtx.translate(cx, cy);
    albedoCtx.rotate(rot);
    drawStar4PtPath(albedoCtx, r * 0.88);
    const sg = albedoCtx.createRadialGradient(0, 0, 1, 0, 0, r * 0.85);
    sg.addColorStop(0.0, mixHex(primary, '#FFFFFF', 0.65));
    sg.addColorStop(0.55, primary);
    sg.addColorStop(1.0, secondary);
    albedoCtx.fillStyle = sg;
    albedoCtx.fill();
    albedoCtx.restore();

    if (raised) {
      drawStar(heightCtx, cx, cy, r, `rgb(${reliefVal},${reliefVal},${reliefVal})`);
    }
    // Starbursts are typically metallic/chrome
    drawStar(metalCtx, ax, ay, rAux, 'rgb(240,240,240)');
    drawStar(roughCtx, ax, ay, rAux, 'rgb(20,20,20)');
    return;
  }

  if (motif.kind === 'bow_3d') {
    const drawBow = (ctx: CanvasCtx2D, px: number, py: number, pr: number, mode: 'albedo' | 'height') => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      if (mode === 'albedo') ctx.globalAlpha = alpha;

      // Two drooping ribbons
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * pr * 0.08, pr * 0.08);
        ctx.quadraticCurveTo(side * pr * 0.34, pr * 0.45, side * pr * 0.50, pr * 0.82);
        ctx.lineTo(side * pr * 0.30, pr * 0.78);
        ctx.quadraticCurveTo(side * pr * 0.16, pr * 0.44, side * pr * 0.03, pr * 0.12);
        ctx.closePath();
        ctx.fillStyle = mode === 'albedo' ? shadeHex(primary, -12) : 'rgb(184,184,184)';
        ctx.fill();
      }

      // Left & right sculpted bow loops
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.bezierCurveTo(
          side * pr * 0.36,
          -pr * 0.56,
          side * pr * 0.96,
          -pr * 0.38,
          side * pr * 0.86,
          0
        );
        ctx.bezierCurveTo(
          side * pr * 0.94,
          pr * 0.38,
          side * pr * 0.36,
          pr * 0.48,
          0,
          0
        );
        ctx.closePath();
        if (mode === 'albedo') {
          const lg = ctx.createLinearGradient(0, -pr * 0.38, side * pr * 0.86, pr * 0.32);
          lg.addColorStop(0.0, mixHex(primary, '#FFFFFF', 0.38));
          lg.addColorStop(0.6, primary);
          lg.addColorStop(1.0, secondary);
          ctx.fillStyle = lg;
          ctx.fill();
          ctx.strokeStyle = shadeHex(secondary, -22, 0.45);
          ctx.lineWidth = Math.max(1, pr * 0.04);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgb(${reliefVal},${reliefVal},${reliefVal})`;
          ctx.fill();
        }
      }

      // Center knot
      ctx.beginPath();
      ctx.ellipse(0, 0, pr * 0.18, pr * 0.15, 0, 0, Math.PI * 2);
      ctx.fillStyle = mode === 'albedo' ? centerDot : 'rgb(252,252,252)';
      ctx.fill();
      ctx.restore();
    };

    drawBow(albedoCtx, cx, cy, r, 'albedo');
    if (raised) drawBow(heightCtx, cx, cy, r, 'height');
    return;
  }

  if (motif.kind === 'marble_veins') {
    const rng = createSeededRng(`marble:${motif.center[0]}:${motif.center[1]}:${primary}`);
    albedoCtx.save();
    albedoCtx.translate(cx, cy);
    albedoCtx.rotate(rot);
    albedoCtx.globalAlpha = alpha;
    albedoCtx.lineCap = 'round';

    for (let i = 0; i < 4; i++) {
      const sy = (i - 1.5) * r * 0.38;
      albedoCtx.beginPath();
      albedoCtx.moveTo(-r * 0.92, sy + (rng() - 0.5) * r * 0.25);
      albedoCtx.bezierCurveTo(
        -r * 0.3,
        sy + (rng() - 0.5) * r * 0.5,
        r * 0.3,
        sy + (rng() - 0.5) * r * 0.5,
        r * 0.92,
        sy + (rng() - 0.5) * r * 0.3
      );
      albedoCtx.strokeStyle = i % 2 === 0 ? hexWithAlpha(primary, 0.72) : hexWithAlpha(secondary, 0.54);
      albedoCtx.lineWidth = Math.max(1.2, r * (0.04 + rng() * 0.04));
      albedoCtx.stroke();
    }
    albedoCtx.restore();
    return;
  }

  if (motif.kind === 'tortoiseshell_spots') {
    const rng = createSeededRng(`tortoise:${motif.center[0]}:${motif.center[1]}:${primary}`);
    albedoCtx.save();
    albedoCtx.translate(cx, cy);
    albedoCtx.rotate(rot);
    albedoCtx.globalAlpha = alpha;
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + rng() * 0.5;
      const dist = r * (0.15 + rng() * 0.52);
      const sx = Math.cos(ang) * dist;
      const sy = Math.sin(ang) * dist;
      const rx = r * (0.16 + rng() * 0.16);
      const ry = r * (0.11 + rng() * 0.14);
      albedoCtx.beginPath();
      albedoCtx.ellipse(sx, sy, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
      albedoCtx.fillStyle = i % 2 === 0 ? primary : secondary;
      albedoCtx.fill();
    }
    albedoCtx.restore();
    return;
  }

  if (motif.kind === 'aura_bloom') {
    albedoCtx.save();
    albedoCtx.globalAlpha = alpha;
    const bloom = albedoCtx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
    bloom.addColorStop(0.0, hexWithAlpha(primary, 0.92));
    bloom.addColorStop(0.50, hexWithAlpha(secondary, 0.48));
    bloom.addColorStop(1.0, hexWithAlpha(secondary, 0));
    albedoCtx.fillStyle = bloom;
    albedoCtx.beginPath();
    albedoCtx.arc(cx, cy, r, 0, Math.PI * 2);
    albedoCtx.fill();
    albedoCtx.restore();
    return;
  }

  // abstract_organic
  albedoCtx.save();
  albedoCtx.translate(cx, cy);
  albedoCtx.rotate(rot);
  albedoCtx.globalAlpha = alpha;
  albedoCtx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    const rad = r * (0.58 + 0.24 * Math.sin(t * 3 + 0.7) + 0.12 * Math.cos(t * 2));
    const px = Math.cos(t) * rad;
    const py = Math.sin(t) * rad * 0.78;
    if (i === 0) albedoCtx.moveTo(px, py);
    else albedoCtx.lineTo(px, py);
  }
  albedoCtx.closePath();
  const og = albedoCtx.createRadialGradient(-r * 0.15, -r * 0.15, r * 0.05, 0, 0, r * 0.9);
  og.addColorStop(0.0, mixHex(primary, '#FFFFFF', 0.28));
  og.addColorStop(0.65, primary);
  og.addColorStop(1.0, secondary);
  albedoCtx.fillStyle = og;
  albedoCtx.fill();
  albedoCtx.restore();

  if (raised) {
    heightCtx.save();
    heightCtx.translate(cx, cy);
    heightCtx.rotate(rot);
    heightCtx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const t = (i / 12) * Math.PI * 2;
      const rad = r * (0.58 + 0.24 * Math.sin(t * 3 + 0.7) + 0.12 * Math.cos(t * 2));
      const px = Math.cos(t) * rad;
      const py = Math.sin(t) * rad * 0.78;
      if (i === 0) heightCtx.moveTo(px, py);
      else heightCtx.lineTo(px, py);
    }
    heightCtx.closePath();
    heightCtx.fillStyle = `rgb(${reliefVal},${reliefVal},${reliefVal})`;
    heightCtx.fill();
    heightCtx.restore();
  }

  void drawRoundedPetal;
}

/**
 * 5. Contact AO & Bezel Rings Under True 3D Accessories:
 * The 3D accessories themselves are rendered as real `InstancedMesh` / `Mesh` geometry!
 * On the 512×512 albedoMap, we ONLY paint a crisp contact AO ring (radius = acc.radiusNorm * 0.56)
 * plus a subtle metallic seating bezel if `acc.hasBezelRing`.
 */
function renderAccessoryContactAO(
  acc: Nail3DAccessorySpec,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): void {
  const [px, py] = uvToCanvas(acc.u, acc.v, w, h);
  const contactR = Math.max(2.5, acc.radiusNorm * 0.56 * w);
  const [pxA, pyA] = uvToCanvas(acc.u, acc.v, auxW, auxH);
  const contactRAux = Math.max(1.5, acc.radiusNorm * 0.56 * auxW);

  albedoCtx.save();
  // Soft physical contact ambient occlusion beneath the seated 3D piece
  const aoGrad = albedoCtx.createRadialGradient(
    px,
    py,
    contactR * 0.25,
    px,
    py,
    contactR * 1.48
  );
  aoGrad.addColorStop(0.0, 'rgba(18, 8, 10, 0.44)');
  aoGrad.addColorStop(0.62, 'rgba(22, 10, 12, 0.28)');
  aoGrad.addColorStop(1.0, 'rgba(22, 10, 12, 0)');
  albedoCtx.fillStyle = aoGrad;
  albedoCtx.beginPath();
  albedoCtx.arc(px, py, contactR * 1.48, 0, Math.PI * 2);
  albedoCtx.fill();

  // Optional fine metallic bezel seating ring on plate
  if (acc.hasBezelRing) {
    const bezelHex =
      acc.kind === 'pearl_dome' || acc.kind === 'rhinestone'
        ? '#D8BA73'
        : acc.colorHex || '#D4AF37';
    albedoCtx.strokeStyle = mixHex(bezelHex, '#FFF7DF', 0.25, 0.88);
    albedoCtx.lineWidth = Math.max(1.5, contactR * 0.22);
    albedoCtx.beginPath();
    albedoCtx.arc(px, py, contactR * 1.02, 0, Math.PI * 2);
    albedoCtx.stroke();
  }
  albedoCtx.restore();

  if (acc.hasBezelRing) {
    heightCtx.save();
    heightCtx.strokeStyle = 'rgb(176,176,176)';
    heightCtx.lineWidth = Math.max(1.5, contactR * 0.22);
    heightCtx.beginPath();
    heightCtx.arc(px, py, contactR * 1.02, 0, Math.PI * 2);
    heightCtx.stroke();
    heightCtx.restore();

    metalCtx.save();
    metalCtx.strokeStyle = 'rgb(240,240,240)';
    metalCtx.lineWidth = Math.max(1.2, contactRAux * 0.24);
    metalCtx.beginPath();
    metalCtx.arc(pxA, pyA, contactRAux * 1.02, 0, Math.PI * 2);
    metalCtx.stroke();
    metalCtx.restore();

    roughCtx.save();
    roughCtx.strokeStyle = 'rgb(22,22,22)';
    roughCtx.lineWidth = Math.max(1.2, contactRAux * 0.24);
    roughCtx.beginPath();
    roughCtx.arc(pxA, pyA, contactRAux * 1.02, 0, Math.PI * 2);
    roughCtx.stroke();
    roughCtx.restore();
  }
}

function paintManufacturingLayers(
  m: Nail3DManufacturingSpec,
  albedoCtx: CanvasCtx2D,
  heightCtx: CanvasCtx2D,
  metalCtx: CanvasCtx2D,
  roughCtx: CanvasCtx2D,
  w: number,
  h: number,
  auxW: number,
  auxH: number
): boolean {
  heightCtx.fillStyle = 'rgb(100,100,100)';
  heightCtx.fillRect(0, 0, w, h);

  // 1. Optical Base
  renderManufacturingBaseLayer(
    m,
    albedoCtx,
    heightCtx,
    metalCtx,
    roughCtx,
    w,
    h,
    auxW,
    auxH
  );

  // 2. Borders & French tips
  renderManufacturingBorderLayer(
    m,
    albedoCtx,
    heightCtx,
    metalCtx,
    roughCtx,
    w,
    h,
    auxW,
    auxH
  );

  // 3. Motifs (10 clean vector types)
  for (const motif of m.motifs ?? []) {
    renderManufacturingMotif(
      motif,
      albedoCtx,
      heightCtx,
      metalCtx,
      roughCtx,
      w,
      h,
      auxW,
      auxH
    );
  }

  // 4. Sculpted 3D cubic Bézier strokes
  for (const stroke of m.strokes3D ?? []) {
    renderManufacturingStroke3D(
      stroke,
      albedoCtx,
      heightCtx,
      metalCtx,
      roughCtx,
      w,
      h,
      auxW,
      auxH
    );
  }

  // 5. Micro contact AO rings under true 3D accessories
  for (const acc of m.accessories3D ?? []) {
    renderAccessoryContactAO(
      acc,
      albedoCtx,
      heightCtx,
      metalCtx,
      roughCtx,
      w,
      h,
      auxW,
      auxH
    );
  }

  const hasRaisedRelief =
    m.borderIs3DRaised ||
    (m.strokes3D?.some((s) => s.reliefHeight > 0.15) ?? false) ||
    (m.motifs?.some((mt) => mt.is3DRaised) ?? false) ||
    m.finishType === 'glitter_suspension';

  return hasRaisedRelief;
}

// =============================================================================
// V10 Fallback Blueprint Compiler (`NailDesignBlueprint`)
// =============================================================================

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
    pearl.addColorStop(0.0, mixHex(baseColorHex, '#FFFFFF', 0.08));
    pearl.addColorStop(0.30, mixHex(baseColorHex, '#FFFFFF', 0.24));
    pearl.addColorStop(0.52, mixHex(midColorHex, '#FFFFFF', 0.34));
    pearl.addColorStop(0.76, mixHex(baseColorHex, tipColorHex, 0.30));
    pearl.addColorStop(1.0, mixHex(baseColorHex, '#FFFFFF', 0.06));
    albedoCtx.fillStyle = pearl;
    albedoCtx.fillRect(0, 0, w, h);

    const sheen = albedoCtx.createRadialGradient(w * 0.44, h * 0.38, w * 0.03, w * 0.5, h * 0.44, w * 0.6);
    sheen.addColorStop(0.0, 'rgba(255,255,255,0.28)');
    sheen.addColorStop(0.55, 'rgba(255,248,242,0.10)');
    sheen.addColorStop(1.0, 'rgba(255,255,255,0)');
    albedoCtx.fillStyle = sheen;
    albedoCtx.fillRect(0, 0, w, h);
  } else {
    const solidGrad = albedoCtx.createLinearGradient(0, 0, 0, h);
    solidGrad.addColorStop(0.0, shadeHex(baseColorHex, 4));
    solidGrad.addColorStop(0.55, baseColorHex);
    solidGrad.addColorStop(1.0, shadeHex(baseColorHex, -6));
    albedoCtx.fillStyle = solidGrad;
    albedoCtx.fillRect(0, 0, w, h);
  }

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
  const bedFraction = clamp(1 / (1 + clamp(bp.geometry.freeEdgeRatio || 0.42, 0.12, 1.15)), 0.44, 0.90);

  if (border.kind === 'full_metallic_outline') {
    albedoCtx.save();
    albedoCtx.lineJoin = 'round';
    albedoCtx.lineCap = 'round';
    traceBorderSilhouetteUV(
      albedoCtx,
      bp.geometry.shape,
      bp.geometry.tipRoundness,
      bedFraction,
      bp.geometry.profileHalfWidths,
      w,
      h,
      0.89
    );
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
    traceBorderSilhouetteUV(
      heightCtx,
      bp.geometry.shape,
      bp.geometry.tipRoundness,
      bedFraction,
      bp.geometry.profileHalfWidths,
      w,
      h,
      0.89
    );
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
    traceBorderSilhouetteUV(
      metalCtx,
      bp.geometry.shape,
      bp.geometry.tipRoundness,
      bedFraction,
      bp.geometry.profileHalfWidths,
      auxW,
      auxH,
      0.89
    );
    metalCtx.strokeStyle = `rgb(${metalByte},${metalByte},${metalByte})`;
    metalCtx.lineWidth = strokeWAux * 1.05;
    metalCtx.stroke();
    metalCtx.restore();

    roughCtx.save();
    roughCtx.lineJoin = 'round';
    roughCtx.lineCap = 'round';
    traceBorderSilhouetteUV(
      roughCtx,
      bp.geometry.shape,
      bp.geometry.tipRoundness,
      bedFraction,
      bp.geometry.profileHalfWidths,
      auxW,
      auxH,
      0.89
    );
    roughCtx.strokeStyle = `rgb(${roughByte},${roughByte},${roughByte})`;
    roughCtx.lineWidth = strokeWAux * 1.05;
    roughCtx.stroke();
    roughCtx.restore();
    return;
  }

  if (border.kind === 'cuticle_cuff') {
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
    return;
  }

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

  albedoCtx.save();
  albedoCtx.lineCap = 'round';
  albedoCtx.lineJoin = 'round';

  const shadowPts = pts.map((p) => ({ x: p.x, y: p.y + lineW * 0.14 }));
  traceSmoothCatmullRom(albedoCtx, shadowPts);
  albedoCtx.strokeStyle = 'rgba(26, 12, 8, 0.28)';
  albedoCtx.lineWidth = lineW * 1.26;
  albedoCtx.stroke();

  traceSmoothCatmullRom(albedoCtx, pts);
  albedoCtx.strokeStyle = shadeHex(el.colorHex, -34);
  albedoCtx.lineWidth = lineW * 1.06;
  albedoCtx.stroke();

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

  const ridgePts = pts.map((p) => ({ x: p.x - lineW * 0.05, y: p.y - lineW * 0.08 }));
  traceSmoothCatmullRom(albedoCtx, ridgePts);
  albedoCtx.strokeStyle = mixHex(el.highlightHex, '#FFFFFF', 0.45, 0.78);
  albedoCtx.lineWidth = Math.max(1.5, lineW * 0.28);
  albedoCtx.stroke();
  albedoCtx.restore();

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

  albedoCtx.fillStyle = 'rgba(255,255,255,0.88)';
  albedoCtx.beginPath();
  albedoCtx.arc(px - r * 0.30, py - r * 0.30, Math.max(1.2, r * 0.22), 0, Math.PI * 2);
  albedoCtx.fill();
  albedoCtx.restore();

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
): boolean {
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

  return bp.borderLayer.is3DRaised || bp.artElements.length > 0;
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
 * V13 Gaussian Feathered AlphaMap (`256×256` POT, iOS Safari + Android Chrome WebGL2 safe):
 * - Cuticle (`v ∈ [0, 0.10]`): Gaussian ramp `f(t) = 1 - exp(-(t / sigma)^2)` from 0 at `v=0` to 255 at `v=0.10`.
 * - Lateral margins (`u ∈ [0, 0.04]` & `[0.96, 1.0]`): ultra-refined Gaussian ramp eliminating white halos.
 * - Free edge (`v ∈ [0.10, 1.0]`, interior): 100% crisp opaque (255) with 1.5% tip micro-AA.
 */
function buildGaussianFeatheredAlphaCanvas(size: number): HTMLCanvasElement {
  const { canvas, ctx } = makeTextureSurface(size, size);
  const imgData = ctx.createImageData(size, size);
  const d = imgData.data;

  const gaussianRamp = (tNorm: number, sigma = 0.42): number => {
    if (tNorm <= 0) return 0;
    if (tNorm >= 1) return 1;
    // Normalized so f(0)=0 and f(1)=1 smoothly
    const raw = 1 - Math.exp(-(tNorm * tNorm) / (sigma * sigma));
    const norm = 1 - Math.exp(-1 / (sigma * sigma));
    return clamp01(raw / norm);
  };

  for (let y = 0; y < size; y++) {
    // Three.js UV convention: y = 0 is tip (v = 1), y = size - 1 is cuticle (v = 0)
    const v = 1 - y / Math.max(1, size - 1);
    const cuticleFactor = v < 0.10 ? gaussianRamp(v / 0.10, 0.44) : 1.0;
    const tipFactor = v > 0.985 ? gaussianRamp((1 - v) / 0.015, 0.46) : 1.0;

    for (let x = 0; x < size; x++) {
      const u = x / Math.max(1, size - 1);
      const leftFactor = u < 0.04 ? gaussianRamp(u / 0.04, 0.42) : 1.0;
      const rightFactor = u > 0.96 ? gaussianRamp((1 - u) / 0.04, 0.42) : 1.0;

      const alphaByte = clampByte(cuticleFactor * tipFactor * leftFactor * rightFactor * 255);
      const idx = (y * size + x) * 4;
      d[idx] = alphaByte;
      d[idx + 1] = alphaByte;
      d[idx + 2] = alphaByte;
      d[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * V12 Pixel-Derived Physical PBR Synthesis from Photorealistic `512×512` True UV Texture:
 * - `normalMap` (`512×512`, `NoColorSpace`): luminance `L = 0.299R + 0.587G + 0.114B` ->
 *   3×3 Gaussian pre-blur `[1,2,1; 2,4,2; 1,2,1]/16` -> Sobel 3×3 (`strength = 3.2`) -> tangent-space normals.
 * - `metalnessMap` (`256×256`) & `roughnessMap` (`256×256`): detects chrome/gold/champagne/silver/gem
 *   specular contrast & metallic chromatic signature, outputting continuous metalness up to `0.85`
 *   (lifting floor to `0.55..0.85` on full-plate chrome) and roughness `0.08..0.16` (gloss/chrome) or `0.18..0.28` (matte).
 */
function deriveTrueUvPBRMapsFromImage(
  img: HTMLImageElement,
  albedoCtx: CanvasRenderingContext2D,
  normalCtx: CanvasRenderingContext2D,
  metalCtx: CanvasRenderingContext2D,
  roughCtx: CanvasRenderingContext2D,
  albedoSize: number,
  auxSize: number
): void {
  // 1. Draw real 512x512 True UV texture cleanly into albedo canvas
  albedoCtx.clearRect(0, 0, albedoSize, albedoSize);
  albedoCtx.drawImage(img, 0, 0, albedoSize, albedoSize);
  const srcRgba = albedoCtx.getImageData(0, 0, albedoSize, albedoSize).data;

  // 2. Luminance field + 3x3 [1,2,1; 2,4,2; 1,2,1]/16 pre-blur to kill JPEG compression noise
  const nPx = albedoSize * albedoSize;
  const luma = new Float32Array(nPx);
  for (let i = 0; i < nPx; i++) {
    const p = i * 4;
    luma[i] = (0.299 * srcRgba[p] + 0.587 * srcRgba[p + 1] + 0.114 * srcRgba[p + 2]) / 255;
  }

  const blurred = new Float32Array(nPx);
  for (let y = 0; y < albedoSize; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < albedoSize - 1 ? y + 1 : albedoSize - 1;
    for (let x = 0; x < albedoSize; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < albedoSize - 1 ? x + 1 : albedoSize - 1;
      const sum =
        luma[ym * albedoSize + xm] +
        2 * luma[ym * albedoSize + x] +
        luma[ym * albedoSize + xp] +
        2 * luma[y * albedoSize + xm] +
        4 * luma[y * albedoSize + x] +
        2 * luma[y * albedoSize + xp] +
        luma[yp * albedoSize + xm] +
        2 * luma[yp * albedoSize + x] +
        luma[yp * albedoSize + xp];
      blurred[y * albedoSize + x] = sum * 0.0625;
    }
  }

  // 3. Sobel 3x3 tangent-space normalMap (strength ~ 3.2) giving real 3D relief to metal beads, gems & gel waves
  const normalData = normalCtx.createImageData(albedoSize, albedoSize);
  const nd = normalData.data;
  const sobelStrength = 3.2;

  for (let y = 0; y < albedoSize; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < albedoSize - 1 ? y + 1 : albedoSize - 1;
    for (let x = 0; x < albedoSize; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < albedoSize - 1 ? x + 1 : albedoSize - 1;

      const tl = blurred[ym * albedoSize + xm];
      const tc = blurred[ym * albedoSize + x];
      const tr = blurred[ym * albedoSize + xp];
      const ml = blurred[y * albedoSize + xm];
      const mr = blurred[y * albedoSize + xp];
      const bl = blurred[yp * albedoSize + xm];
      const bc = blurred[yp * albedoSize + x];
      const br = blurred[yp * albedoSize + xp];

      const gx = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * sobelStrength;
      const gy = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * sobelStrength;
      const nx = -gx;
      const ny = gy;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      const idx = (y * albedoSize + x) * 4;
      nd[idx] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      nd[idx + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      nd[idx + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      nd[idx + 3] = 255;
    }
  }
  normalCtx.putImageData(normalData, 0, 0);

  // 4. Downsample to 256x256 to derive continuous metalnessMap (0..0.85) & roughnessMap (0.08..0.28)
  const { ctx: auxSampleCtx } = makeSurface(auxSize, auxSize);
  auxSampleCtx.drawImage(img, 0, 0, auxSize, auxSize);
  const auxRgba = auxSampleCtx.getImageData(0, 0, auxSize, auxSize).data;

  const auxCount = auxSize * auxSize;
  const auxLuma = new Float32Array(auxCount);
  const auxMetallicHint = new Float32Array(auxCount);
  let lumaSum = 0;
  let metallicPlateAccumulator = 0;
  let highContrastCount = 0;

  for (let i = 0; i < auxCount; i++) {
    const p = i * 4;
    const r = auxRgba[p] / 255;
    const g = auxRgba[p + 1] / 255;
    const b = auxRgba[p + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx > 0.001 ? (mx - mn) / mx : 0;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    auxLuma[i] = l;
    lumaSum += l;

    // Gold / champagne / silver / pearl-chrome chromatic signature
    const isWarmGold = r > 0.42 && g > 0.32 && r >= g * 0.96 && g >= b * 1.04 && sat >= 0.14 && sat <= 0.68;
    const isCoolSilver = l > 0.48 && sat < 0.16;
    const hint = isWarmGold ? 0.72 : isCoolSilver ? 0.58 : 0.0;
    auxMetallicHint[i] = hint;
    metallicPlateAccumulator += hint;
  }

  const meanLuma = lumaSum / Math.max(1, auxCount);
  let lumaVarSum = 0;
  for (let i = 0; i < auxCount; i++) {
    const dl = auxLuma[i] - meanLuma;
    lumaVarSum += dl * dl;
    if (Math.abs(dl) > 0.20) highContrastCount++;
  }
  const lumaStd = Math.sqrt(lumaVarSum / Math.max(1, auxCount));
  const avgPlateMetallicHint = metallicPlateAccumulator / Math.max(1, auxCount);
  const isFullPlateChrome =
    avgPlateMetallicHint > 0.34 && (lumaStd > 0.13 || highContrastCount / auxCount > 0.16);

  const metalData = metalCtx.createImageData(auxSize, auxSize);
  const roughData = roughCtx.createImageData(auxSize, auxSize);
  const md = metalData.data;
  const rd = roughData.data;

  for (let y = 0; y < auxSize; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < auxSize - 1 ? y + 1 : auxSize - 1;
    for (let x = 0; x < auxSize; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < auxSize - 1 ? x + 1 : auxSize - 1;
      const i = y * auxSize + x;

      const l = auxLuma[i];
      const grad =
        Math.abs(auxLuma[y * auxSize + xp] - auxLuma[y * auxSize + xm]) +
        Math.abs(auxLuma[yp * auxSize + x] - auxLuma[ym * auxSize + x]);
      const specularContrast = clamp01((l - meanLuma - 0.06) * 2.4 + grad * 1.8);
      const localHint = auxMetallicHint[i];

      let metalVal: number;
      if (isFullPlateChrome) {
        // Full-plate mirror chrome (e.g. gold champagne / silver): lift floor to 0.55..0.85
        metalVal = clamp(0.55 + specularContrast * 0.22 + localHint * 0.14, 0.55, 0.85);
      } else {
        // Selective metallic studs, gold waves, gems & chrome accents: 0.04..0.85
        const gemBoost = specularContrast > 0.45 && localHint > 0.3 ? 0.52 : 0;
        metalVal = clamp(0.04 + localHint * 0.38 + specularContrast * 0.28 + gemBoost, 0.04, 0.85);
      }

      const roughVal = isFullPlateChrome
        ? clamp(0.14 - specularContrast * 0.06, 0.08, 0.15)
        : clamp(0.24 - metalVal * 0.14 - specularContrast * 0.05, 0.08, 0.26);

      const mByte = clampByte(metalVal * 255);
      const rByte = clampByte(roughVal * 255);
      const p = i * 4;
      md[p] = mByte;
      md[p + 1] = mByte;
      md[p + 2] = mByte;
      md[p + 3] = 255;

      rd[p] = rByte;
      rd[p + 1] = rByte;
      rd[p + 2] = rByte;
      rd[p + 3] = 255;
    }
  }

  metalCtx.putImageData(metalData, 0, 0);
  roughCtx.putImageData(roughData, 0, 0);
}

/**
 * V13 Dual-Path PBR Synthesizer:
 * - Resolves explicit `effectiveStrategy`:
 *   - `'procedural_pbr_3d'`: uses clean procedural PBR compiler (`paintManufacturingLayers`),
 *     ignoring `trueUvDataUrl` even if a local fallback populated one (for mirror chrome + real 3D studs).
 *   - `'canonical_uv_delighted'` / `'hybrid_uv_plus_pbr_3d'` with `trueUvDataUrl`: transfers the
 *     silhouette-conformed TrueUV texture + pixel-derived PBR maps AND paints contact AO + bezel rings
 *     beneath any `spec.manufacturingSpec?.accessories3D`.
 * - Strictly POT canvases (`HTMLCanvasElement`) with mipmaps enabled for iOS Safari + Android Chrome WebGL2.
 * - Fires optional `onTextureReady` after async `img.onload` updates all 4 PBR maps (`needsUpdate = true`).
 */
export function synthesizeCleanPBRBundle(
  spec: NailFingerDesignSpec,
  onTextureReady?: () => void
): ProceduralPBRBundle {
  const effectiveStrategy = resolveEffectiveRenderStrategy(spec);
  const useTrueUvPath =
    (effectiveStrategy === 'canonical_uv_delighted' ||
      effectiveStrategy === 'hybrid_uv_plus_pbr_3d') &&
    Boolean(spec.trueUvDataUrl);

  const specHash = hashFingerSpec(spec);
  const cached = pbrBundleCache.get(specHash);
  if (cached) {
    if (!useTrueUvPath && onTextureReady) {
      onTextureReady();
    }
    return cached;
  }

  const { canvas: albedoCanvas, ctx: albedoCtx } = makeTextureSurface(ALBEDO_SIZE, ALBEDO_SIZE);
  const { canvas: normalCanvas, ctx: normalCtx } = makeTextureSurface(ALBEDO_SIZE, ALBEDO_SIZE);
  const { canvas: metalCanvas, ctx: metalCtx } = makeTextureSurface(AUX_SIZE, AUX_SIZE);
  const { canvas: roughCanvas, ctx: roughCtx } = makeTextureSurface(AUX_SIZE, AUX_SIZE);

  // Instant clean frame-0 base fill (zero black flash while Image decodes asynchronously)
  albedoCtx.fillStyle = spec.manufacturingSpec?.trueBaseColorHex || spec.baseColor || '#D4B483';
  albedoCtx.fillRect(0, 0, ALBEDO_SIZE, ALBEDO_SIZE);
  normalCtx.fillStyle = 'rgb(128,128,255)';
  normalCtx.fillRect(0, 0, ALBEDO_SIZE, ALBEDO_SIZE);
  metalCtx.fillStyle = 'rgb(140,140,140)';
  metalCtx.fillRect(0, 0, AUX_SIZE, AUX_SIZE);
  roughCtx.fillStyle = 'rgb(36,36,36)';
  roughCtx.fillRect(0, 0, AUX_SIZE, AUX_SIZE);

  if (!useTrueUvPath) {
    const { ctx: heightCtx } = makeSurface(ALBEDO_SIZE, ALBEDO_SIZE);
    const hasRaisedRelief = spec.manufacturingSpec
      ? paintManufacturingLayers(
          spec.manufacturingSpec,
          albedoCtx,
          heightCtx,
          metalCtx,
          roughCtx,
          ALBEDO_SIZE,
          ALBEDO_SIZE,
          AUX_SIZE,
          AUX_SIZE
        )
      : paintBlueprintOntoMaps(
          resolveBlueprint(spec),
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
    const normalData = normalCtx.createImageData(ALBEDO_SIZE, ALBEDO_SIZE);
    const normalStrength = hasRaisedRelief ? 4.4 : 2.0;
    buildFastSobelNormalMap(heightPixels, ALBEDO_SIZE, ALBEDO_SIZE, normalStrength, normalData);
    normalCtx.putImageData(normalData, 0, 0);
  }

  // V13 256×256 Gaussian Feathered AlphaMap (cuticle v∈[0,0.10] + lateral edges u∈[0,0.04]∪[0.96,1])
  const alphaCanvas = buildGaussianFeatheredAlphaCanvas(AUX_SIZE);

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.anisotropy = 4;
  map.needsUpdate = true;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.magFilter = THREE.LinearFilter;
  normalMap.anisotropy = 4;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.generateMipmaps = true;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.needsUpdate = true;

  const metalnessMap = new THREE.CanvasTexture(metalCanvas);
  metalnessMap.colorSpace = THREE.NoColorSpace;
  metalnessMap.generateMipmaps = true;
  metalnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  metalnessMap.needsUpdate = true;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.colorSpace = THREE.NoColorSpace;
  alphaMap.generateMipmaps = true;
  alphaMap.minFilter = THREE.LinearMipmapLinearFilter;
  alphaMap.needsUpdate = true;

  let disposed = false;

  if (useTrueUvPath && spec.trueUvDataUrl && typeof Image !== 'undefined') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (disposed) return;
      deriveTrueUvPBRMapsFromImage(
        img,
        albedoCtx,
        normalCtx,
        metalCtx,
        roughCtx,
        ALBEDO_SIZE,
        AUX_SIZE
      );

      // Paint contact AO + bezel rings under any real 3D accessories even in TrueUV / hybrid path
      const accessories = spec.manufacturingSpec?.accessories3D ?? [];
      if (accessories.length > 0) {
        const { ctx: dummyHeightCtx } = makeSurface(ALBEDO_SIZE, ALBEDO_SIZE);
        for (const acc of accessories) {
          renderAccessoryContactAO(
            acc,
            albedoCtx,
            dummyHeightCtx,
            metalCtx,
            roughCtx,
            ALBEDO_SIZE,
            ALBEDO_SIZE,
            AUX_SIZE,
            AUX_SIZE
          );
        }
      }

      map.needsUpdate = true;
      normalMap.needsUpdate = true;
      metalnessMap.needsUpdate = true;
      roughnessMap.needsUpdate = true;
      onTextureReady?.();
    };
    img.src = spec.trueUvDataUrl;
  } else if (onTextureReady) {
    onTextureReady();
  }

  const bundle: ProceduralPBRBundle = {
    specHash,
    map,
    normalMap,
    roughnessMap,
    metalnessMap,
    alphaMap,
    dispose: () => {
      disposed = true;
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
  shape: NailShape,
  tipRoundness: number,
  bedFraction: number,
  profileHalfWidths:
    | [number, number, number, number, number, number, number, number]
    | undefined,
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
  for (let i = 0; i <= steps; i++) {
    const v = i / steps;
    const hw = evalNailHalfWidth(v, shape, {
      bedFraction,
      tipRoundness,
      profileHalfWidths,
    });
    const x = cx - hw * w * 0.98;
    const y = bottomY - v * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const v = i / steps;
    const hw = evalNailHalfWidth(v, shape, {
      bedFraction,
      tipRoundness,
      profileHalfWidths,
    });
    const x = cx + hw * w * 0.98;
    const y = bottomY - v * h;
    ctx.lineTo(x, y);
  }
  const hw0 = evalNailHalfWidth(0, shape, {
    bedFraction,
    tipRoundness,
    profileHalfWidths,
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
  const cyl = ctx.createLinearGradient(padX, 0, outW - padX, 0);
  cyl.addColorStop(0.0, 'rgba(16, 8, 10, 0.28)');
  cyl.addColorStop(0.22, 'rgba(255, 255, 255, 0.06)');
  cyl.addColorStop(0.78, 'rgba(255, 255, 255, 0.02)');
  cyl.addColorStop(1.0, 'rgba(16, 8, 10, 0.30)');
  ctx.fillStyle = cyl;
  ctx.fillRect(0, 0, outW, outH);

  const rootShade = ctx.createLinearGradient(0, bottomY - outH * 0.16, 0, bottomY);
  rootShade.addColorStop(0, 'rgba(20, 8, 10, 0)');
  rootShade.addColorStop(1, 'rgba(20, 8, 10, 0.20)');
  ctx.fillStyle = rootShade;
  ctx.fillRect(0, bottomY - outH * 0.16, outW, outH * 0.18);

  const peakAlpha = isVelvet ? 0.14 : 0.46;
  const gloss = ctx.createLinearGradient(outW * 0.28, topY, outW * 0.52, bottomY * 0.72);
  gloss.addColorStop(0.0, `rgba(255,255,255,${peakAlpha})`);
  gloss.addColorStop(0.45, `rgba(255,255,255,${peakAlpha * 0.22})`);
  gloss.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.ellipse(outW * 0.39, outH * 0.42, outW * 0.072, outH * 0.24, -0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawSwatchAccessoriesPreview(
  accessories: Nail3DAccessorySpec[],
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  for (const acc of accessories) {
    const [px, py] = uvToCanvas(acc.u, acc.v, w, h);
    const r = Math.max(2.5, acc.radiusNorm * w * 0.65);
    ctx.save();
    ctx.fillStyle = 'rgba(18, 8, 10, 0.32)';
    ctx.beginPath();
    ctx.arc(px + r * 0.12, py + r * 0.16, r * 1.15, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.08, px, py, r);
    if (acc.kind === 'pearl_dome') {
      grad.addColorStop(0.0, '#FFFFFF');
      grad.addColorStop(0.55, acc.colorHex || '#F9F4EE');
      grad.addColorStop(1.0, '#BFB0A8');
    } else if (acc.kind === 'rhinestone' || acc.kind === '3d_drop_clear') {
      grad.addColorStop(0.0, '#FFFFFF');
      grad.addColorStop(0.45, mixHex(acc.colorHex || '#E8F4FF', '#FFFFFF', 0.45));
      grad.addColorStop(1.0, '#A5B8CC');
    } else {
      grad.addColorStop(0.0, '#FFFDF2');
      grad.addColorStop(0.45, acc.colorHex || '#D4AF37');
      grad.addColorStop(1.0, shadeHex(acc.colorHex || '#D4AF37', -42));
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(px - r * 0.28, py - r * 0.28, Math.max(1, r * 0.22), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Renders a crisp 100% vector nail preview onto an `HTMLCanvasElement` directly from
 * `Nail3DManufacturingSpec` (V11) or `NailDesignBlueprint` (V10 fallback)
 * (ZERO raw photo pixels).
 */
export function renderBlueprintNailCanvas(
  spec: NailFingerDesignSpec,
  width = 180,
  height = 260
): HTMLCanvasElement {
  const { canvas, ctx } = makeTextureSurface(width, height);
  const { ctx: dummyHeight } = makeSurface(width, height);
  const { ctx: dummyMetal } = makeSurface(width, height);
  const { ctx: dummyRough } = makeSurface(width, height);

  ctx.clearRect(0, 0, width, height);

  if (spec.manufacturingSpec) {
    const m = spec.manufacturingSpec;
    const bedFraction = clamp(1 / (1 + clamp(m.freeEdgeRatio || 0.42, 0.12, 1.15)), 0.44, 0.90);
    ctx.save();
    const { padX, topY, bottomY } = traceAnatomicalSwatchClip(
      ctx,
      m.shape,
      m.tipRoundness,
      bedFraction,
      undefined,
      width,
      height
    );
    ctx.clip();

    paintManufacturingLayers(
      m,
      ctx,
      dummyHeight,
      dummyMetal,
      dummyRough,
      width,
      height,
      width,
      height
    );
    if (m.accessories3D?.length) {
      drawSwatchAccessoriesPreview(m.accessories3D, ctx, width, height);
    }
    applyStudioSwatchLighting(
      ctx,
      width,
      height,
      padX,
      topY,
      bottomY,
      m.finishType === 'velvet_matte'
    );
    ctx.restore();
    return canvas;
  }

  const bp = resolveBlueprint(spec);
  const bedFraction = clamp(1 / (1 + clamp(bp.geometry.freeEdgeRatio || 0.42, 0.12, 1.15)), 0.44, 0.90);

  ctx.save();
  const { padX, topY, bottomY } = traceAnatomicalSwatchClip(
    ctx,
    bp.geometry.shape,
    bp.geometry.tipRoundness,
    bedFraction,
    bp.geometry.profileHalfWidths,
    width,
    height
  );
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

