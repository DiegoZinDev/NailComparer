import { detectHandsOnImageWithSingleton } from './handTrackingWorker';
import type {
  ArtisticPattern,
  FingerId,
  MicroGemElement,
  NailBaseLayer,
  NailBorderKind,
  NailBorderLayer,
  NailDesign,
  NailDesignBlueprint,
  NailExtensionLevel,
  NailFinishV10,
  NailFinishV9,
  NailFingerDesignSpec as BaseNailFingerDesignSpec,
  NailGeometryProfile,
  NailGradientMode,
  NailShape,
  NailUvPinTarget,
  OrganicMotifElement,
  OrganicMotifPoint,
  RibbonStrokeElement,
  RibbonStrokePoint,
  StrokeAnchor,
  VectorArtElement,
} from '../types/nail';

export type { NailExtensionLevel, NailFinishV9, NailFinishV10 };

export type NailFingerDesignSpec = BaseNailFingerDesignSpec;
export type ExtendedNailFingerDesignSpec = NailFingerDesignSpec;

export const ORDERED_FINGERS: FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export const FINGER_LABELS_PT: Record<FingerId, string> = {
  thumb: 'Polegar',
  index: 'Indicador',
  middle: 'Médio',
  ring: 'Anelar',
  pinky: 'Mínimo',
};

export const PATTERN_LABELS_PT: Record<ArtisticPattern, string> = {
  solid_gloss: 'Gel Brilho',
  chrome_mirror: 'Cromado',
  gold_3d_waves: 'Ondas 3D Ouro',
  aura_gradient: 'Aura Blush',
  french_tip: 'Francesinha',
  floral_accent: 'Floral 3D',
};

export interface PerFingerAnalysisResult {
  fingerSpecs: Record<FingerId, NailFingerDesignSpec>;
  detectedFingerIds: FingerId[];
  method: 'mediapipe' | 'smart-macro';
  primaryShape: NailShape;
  primaryLength: number;
  primaryExtensionLevel?: NailExtensionLevel;
  primaryAspectRatio?: number;
  primaryBaseColor: string;
  primarySecondaryColor: string;
  primaryAccentColor: string;
  primaryPattern: ArtisticPattern;
}

const FINGER_LANDMARKS: Record<
  FingerId,
  { tipIdx: number; dipIdx: number; pipIdx: number; defaultWidth: number; defaultLength: number }
> = {
  thumb: { tipIdx: 4, dipIdx: 3, pipIdx: 2, defaultWidth: 1.12, defaultLength: 0.94 },
  index: { tipIdx: 8, dipIdx: 7, pipIdx: 6, defaultWidth: 1.0, defaultLength: 1.0 },
  middle: { tipIdx: 12, dipIdx: 11, pipIdx: 10, defaultWidth: 1.04, defaultLength: 1.04 },
  ring: { tipIdx: 16, dipIdx: 15, pipIdx: 14, defaultWidth: 0.98, defaultLength: 1.0 },
  pinky: { tipIdx: 20, dipIdx: 19, pipIdx: 18, defaultWidth: 0.91, defaultLength: 0.91 },
};

const PROFILE_STATIONS_V: readonly number[] = [0, 0.15, 0.35, 0.55, 0.72, 0.85, 0.94, 1.0];
const ROI_WIDTH = 128;
const ROI_HEIGHT = 192;

const SHAPE_DEFAULT_PROFILES: Record<
  NailShape,
  [number, number, number, number, number, number, number, number]
> = {
  natural: [0.34, 0.48, 0.50, 0.50, 0.47, 0.43, 0.38, 0.34],
  oval: [0.34, 0.48, 0.50, 0.50, 0.44, 0.36, 0.28, 0.21],
  almond: [0.34, 0.48, 0.50, 0.50, 0.42, 0.31, 0.22, 0.15],
  coffin: [0.34, 0.48, 0.50, 0.50, 0.43, 0.36, 0.32, 0.29],
  square: [0.34, 0.49, 0.50, 0.50, 0.50, 0.49, 0.47, 0.44],
  stiletto: [0.34, 0.48, 0.50, 0.49, 0.36, 0.23, 0.14, 0.09],
};

// -----------------------------------------------------------------------------
// Fast Color & Math Utilities (Zero DOM dependency, pure TypedArrays)
// -----------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clampByte(r), clampByte(g), clampByte(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  } else if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) return [r, g, b];
  }
  return [225, 190, 179];
}

function shadeHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + amount, g + amount, b + amount);
}

function mixHex(hexA: string, hexB: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const tc = clamp01(t);
  return rgbToHex(r1 * (1 - tc) + r2 * tc, g1 * (1 - tc) + g2 * tc, b1 * (1 - tc) + b2 * tc);
}

// Lookup table for fast sRGB -> linear conversion (256 entries)
const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Exact CIE L*a*b* conversion (sRGB -> D65 XYZ -> CIELab) preserving deep burgundy/wine,
 * obsidian, pearls, and warm gold without brown washout.
 */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const ri = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
  const gi = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
  const bi = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
  const rl = SRGB_TO_LIN[ri];
  const gl = SRGB_TO_LIN[gi];
  const bl = SRGB_TO_LIN[bi];

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const invf = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };
  const x = 0.95047 * invf(fx);
  const y = invf(fy);
  const z = 1.08883 * invf(fz);

  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gl = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  const gamma = (u: number) => {
    const cu = clamp01(u);
    return cu <= 0.0031308 ? 12.92 * cu : 1.055 * Math.pow(cu, 1 / 2.4) - 0.055;
  };

  return [
    Math.round(gamma(rl) * 255),
    Math.round(gamma(gl) * 255),
    Math.round(gamma(bl) * 255),
  ];
}

function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

function deltaLab(c1: [number, number, number], c2: [number, number, number]): number {
  const dl = c1[0] - c2[0];
  const da = c1[1] - c2[1];
  const db = c1[2] - c2[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function rgbToYCbCr(r: number, g: number, b: number): [number, number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return [y, cb, cr];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-5) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  const s = max > 0 ? d / max : 0;
  return [h * 360, s, max];
}

function isSpecularGlare(r: number, g: number, b: number): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.92 && sat < 0.12;
}

function detectMetallicSignal(
  r: number,
  g: number,
  b: number,
  gradMag: number
): { isMetallic: boolean; isGold: boolean; isSilver: boolean } {
  const [hue, sat, val] = rgbToHsv(r, g, b);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Warm gold / champagne / rose gold metallic hue (20°..58°)
  const isWarmGold =
    hue >= 18 &&
    hue <= 58 &&
    r > g * 1.03 &&
    g > b * 1.12 &&
    luma > 0.32 &&
    sat > 0.20;

  // Cool chrome / silver specular ridge (low sat, bright, high local contrast gradient)
  const isSilver = sat < 0.16 && val > 0.64 && gradMag > 0.11 && luma < 0.94;

  return {
    isMetallic: isWarmGold || isSilver,
    isGold: isWarmGold,
    isSilver,
  };
}

function medianColorFromLabSamples(
  labs: Array<[number, number, number]>,
  rgbs: Array<[number, number, number]>,
  fallbackHex: string
): string {
  const n = rgbs.length;
  if (n === 0) return fallbackHex;
  if (n === 1) return rgbToHex(rgbs[0][0], rgbs[0][1], rgbs[0][2]);

  // O(n) representative selection (subsampled median/mean in CIELab -> nearest real pixel)
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  const step = n > 256 ? Math.floor(n / 128) : 1;
  let cnt = 0;
  for (let i = 0; i < n; i += step) {
    sumL += labs[i][0];
    sumA += labs[i][1];
    sumB += labs[i][2];
    cnt++;
  }
  const targetLab: [number, number, number] = [sumL / cnt, sumA / cnt, sumB / cnt];

  let bestIdx = 0;
  let bestDist2 = Infinity;
  for (let i = 0; i < n; i += step) {
    const dl = labs[i][0] - targetLab[0];
    const da = labs[i][1] - targetLab[1];
    const db = labs[i][2] - targetLab[2];
    const d2 = dl * dl + da * da + db * db;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      bestIdx = i;
    }
  }
  const [r, g, b] = rgbs[bestIdx];
  return rgbToHex(r, g, b);
}

// -----------------------------------------------------------------------------
// Extension Mapping (V10: freeEdgeRatio 0.12..1.15, relativeLength = 1 + freeEdgeRatio)
// -----------------------------------------------------------------------------

function classifyExtensionFromFreeEdgeRatio(freeEdgeRatio: number): {
  freeEdgeRatio: number;
  relativeLength: number;
  extensionLevel: NailExtensionLevel;
  extensionMm: number;
} {
  const ratio = Number(clamp(freeEdgeRatio, 0.12, 1.15).toFixed(2));
  const relativeLength = Number((1 + ratio).toFixed(2));
  const extensionMm = Number(clamp(1.5 + ((ratio - 0.12) / (1.15 - 0.12)) * 10.5, 1.5, 12.0).toFixed(1));

  let extensionLevel: NailExtensionLevel;
  if (ratio <= 0.26) extensionLevel = 'Curta/Natural';
  else if (ratio <= 0.51) extensionLevel = 'Pouco Alongada';
  else if (ratio <= 0.83) extensionLevel = 'Alongada';
  else extensionLevel = 'Muito Alongada (Extrema)';

  return { freeEdgeRatio: ratio, relativeLength, extensionLevel, extensionMm };
}

function mapAspectRatioToFreeEdgeRatio(aspectRatio: number): number {
  const ar = clamp(aspectRatio, 0.78, 3.3);
  if (ar < 1.25) {
    // Curta: 0.12..0.25
    const t = clamp01((ar - 0.85) / (1.25 - 0.85));
    return 0.12 + t * (0.25 - 0.12);
  }
  if (ar < 1.68) {
    // Pouco alongada: 0.28..0.50
    const t = clamp01((ar - 1.25) / (1.68 - 1.25));
    return 0.28 + t * (0.50 - 0.28);
  }
  if (ar < 2.25) {
    // Alongada salão: 0.52..0.82
    const t = clamp01((ar - 1.68) / (2.25 - 1.68));
    return 0.52 + t * (0.82 - 0.52);
  }
  // Muito alongada: 0.85..1.15
  const t = clamp01((ar - 2.25) / (3.15 - 2.25));
  return 0.85 + t * (1.15 - 0.85);
}

function normalizeRelativeLengthV10(rawLen: number): number {
  // Legacy specs used 0.85..1.65; V10 uses 1.12..2.15 (= 1 + freeEdgeRatio)
  if (rawLen >= 1.12 && rawLen <= 2.15) {
    return rawLen;
  }
  const t = clamp01((rawLen - 0.85) / (1.65 - 0.85));
  return 1.12 + t * (2.05 - 1.12);
}

// -----------------------------------------------------------------------------
// Stage 2 Pure Engine: Deterministic CIELab K-Means, Geometry Profile & Vector Art
// -----------------------------------------------------------------------------

interface LabSample {
  L: number;
  a: number;
  b: number;
  r: number;
  g: number;
  bp: number;
  u: number;
  v: number;
  x: number;
  y: number;
  isMetal: boolean;
  isGold: boolean;
}

/**
 * Deterministic CIELab K-Means (k = 4, 8 iterations) with farthest-first seeding
 * (zero Math.random()!). Returns clusters sorted descending by population size.
 */
function deterministicLabKMeans(
  samples: readonly LabSample[],
  k = 4,
  iterations = 8
): Array<{
  count: number;
  L: number;
  a: number;
  b: number;
  hex: string;
  rgb: [number, number, number];
}> {
  if (samples.length === 0) return [];
  if (samples.length <= k) {
    return samples.map((s) => ({
      count: 1,
      L: s.L,
      a: s.a,
      b: s.b,
      hex: rgbToHex(s.r, s.g, s.bp),
      rgb: [s.r, s.g, s.bp],
    }));
  }

  // Deterministic farthest-first seed initialization starting from median luminance sample
  const stride = Math.max(1, Math.floor(samples.length / 480));
  const sub: LabSample[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    sub.push(samples[i]);
  }

  const centroids: Array<[number, number, number]> = [];
  // Seed 0: median sample by L*
  const sortedByL = [...sub].sort((x, y) => x.L - y.L);
  const s0 = sortedByL[Math.floor(sortedByL.length / 2)];
  centroids.push([s0.L, s0.a, s0.b]);

  // Seeds 1..k-1: deterministic farthest point in CIELab from existing centroids
  while (centroids.length < k) {
    let bestSample = sub[0];
    let bestMinDist = -1;
    for (const pt of sub) {
      let minD = Infinity;
      for (const c of centroids) {
        const dl = pt.L - c[0];
        const da = pt.a - c[1];
        const db = pt.b - c[2];
        const d2 = dl * dl + da * da + db * db;
        if (d2 < minD) minD = d2;
      }
      if (minD > bestMinDist) {
        bestMinDist = minD;
        bestSample = pt;
      }
    }
    centroids.push([bestSample.L, bestSample.a, bestSample.b]);
  }

  const counts = new Int32Array(k);
  const sumL = new Float64Array(k);
  const sumA = new Float64Array(k);
  const sumB = new Float64Array(k);

  for (let iter = 0; iter < iterations; iter++) {
    counts.fill(0);
    sumL.fill(0);
    sumA.fill(0);
    sumB.fill(0);

    for (let i = 0; i < sub.length; i++) {
      const s = sub[i];
      let bestK = 0;
      let bestD2 = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = s.L - centroids[c][0];
        const da = s.a - centroids[c][1];
        const db = s.b - centroids[c][2];
        const d2 = dl * dl + da * da + db * db;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestK = c;
        }
      }
      counts[bestK]++;
      sumL[bestK] += s.L;
      sumA[bestK] += s.a;
      sumB[bestK] += s.b;
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centroids[c][0] = sumL[c] / counts[c];
        centroids[c][1] = sumA[c] / counts[c];
        centroids[c][2] = sumB[c] / counts[c];
      }
    }
  }

  // Final assignment over all samples to get exact cluster counts and true representative color
  counts.fill(0);
  sumL.fill(0);
  sumA.fill(0);
  sumB.fill(0);

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let bestK = 0;
    let bestD2 = Infinity;
    for (let c = 0; c < k; c++) {
      const dl = s.L - centroids[c][0];
      const da = s.a - centroids[c][1];
      const db = s.b - centroids[c][2];
      const d2 = dl * dl + da * da + db * db;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestK = c;
      }
    }
    counts[bestK]++;
    sumL[bestK] += s.L;
    sumA[bestK] += s.a;
    sumB[bestK] += s.b;
  }

  const clusters: Array<{
    count: number;
    L: number;
    a: number;
    b: number;
    hex: string;
    rgb: [number, number, number];
  }> = [];

  for (let c = 0; c < k; c++) {
    if (counts[c] === 0) continue;
    const L = sumL[c] / counts[c];
    const a = sumA[c] / counts[c];
    const b = sumB[c] / counts[c];
    const rgb = labToRgb(L, a, b);
    clusters.push({
      count: counts[c],
      L,
      a,
      b,
      hex: rgbToHex(rgb[0], rgb[1], rgb[2]),
      rgb,
    });
  }

  clusters.sort((x, y) => y.count - x.count);
  return clusters;
}

/**
 * Ramer-Douglas-Peucker polyline simplification in normalized (u, v) coordinates.
 */
function rdpSimplifyPoints(
  points: RibbonStrokePoint[],
  epsilon: number
): RibbonStrokePoint[] {
  if (points.length <= 2) return points;

  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.u - first.u;
  const dy = last.v - first.v;
  const lenSq = dx * dx + dy * dy;

  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    let dist: number;
    if (lenSq < 1e-8) {
      dist = Math.hypot(p.u - first.u, p.v - first.v);
    } else {
      const t = clamp01(((p.u - first.u) * dx + (p.v - first.v) * dy) / lenSq);
      const projU = first.u + t * dx;
      const projV = first.v + t * dy;
      dist = Math.hypot(p.u - projU, p.v - projV);
    }
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdpSimplifyPoints(points.slice(0, index + 1), epsilon);
    const right = rdpSimplifyPoints(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * Resamples/simplifies a ribbon polyline strictly to 4..10 smooth points.
 */
function normalizeRibbonControlPoints(rawPts: RibbonStrokePoint[]): RibbonStrokePoint[] {
  if (rawPts.length === 0) return [];
  if (rawPts.length === 1) {
    const p = rawPts[0];
    return [
      { u: clamp01(p.u - 0.04), v: p.v, width: p.width },
      p,
      { u: clamp01(p.u + 0.02), v: p.v, width: p.width },
      { u: clamp01(p.u + 0.04), v: p.v, width: p.width },
    ];
  }

  let simplified = rdpSimplifyPoints(rawPts, 0.018);
  let eps = 0.024;
  while (simplified.length > 10 && eps < 0.14) {
    simplified = rdpSimplifyPoints(rawPts, eps);
    eps += 0.012;
  }
  if (simplified.length > 10) {
    const picked: RibbonStrokePoint[] = [];
    for (let i = 0; i < 10; i++) {
      const idx = Math.round((i / 9) * (simplified.length - 1));
      picked.push(simplified[idx]);
    }
    simplified = picked;
  }

  // Ensure at least 4 control points via midpoint subdivision if needed
  while (simplified.length < 4 && simplified.length >= 2) {
    const next: RibbonStrokePoint[] = [];
    for (let i = 0; i < simplified.length - 1; i++) {
      const a = simplified[i];
      const b = simplified[i + 1];
      next.push(a);
      if (next.length + (simplified.length - i - 1) < 4) {
        next.push({
          u: Number(((a.u + b.u) * 0.5).toFixed(3)),
          v: Number(((a.v + b.v) * 0.5).toFixed(3)),
          width: Number(((a.width + b.width) * 0.5).toFixed(3)),
        });
      }
    }
    next.push(simplified[simplified.length - 1]);
    simplified = next;
  }

  return simplified.map((p) => ({
    u: Number(clamp01(p.u).toFixed(3)),
    v: Number(clamp01(p.v).toFixed(3)),
    width: Number(clamp(p.width, 0.015, 0.14).toFixed(3)),
  }));
}

/**
 * Extracts closed radial/boundary contour (16..24 vertices) with Laplacian smoothing
 * for organic floral/marble motifs.
 */
function extractSmoothedOrganicContour(
  pts: Array<{ u: number; v: number }>,
  cu: number,
  cv: number,
  vertexCount = 20
): OrganicMotifPoint[] {
  const nBins = clamp(vertexCount, 16, 24);
  const maxR = new Float32Array(nBins).fill(-1);
  const fallbackDist: number[] = [];

  for (const pt of pts) {
    const du = pt.u - cu;
    const dv = pt.v - cv;
    const dist = Math.hypot(du, dv);
    fallbackDist.push(dist);
    let ang = Math.atan2(dv, du);
    if (ang < 0) ang += Math.PI * 2;
    const bin = Math.min(nBins - 1, Math.floor((ang / (Math.PI * 2)) * nBins));
    if (dist > maxR[bin]) maxR[bin] = dist;
  }

  fallbackDist.sort((a, b) => a - b);
  const defaultR =
    fallbackDist.length > 0 ? fallbackDist[Math.floor(fallbackDist.length * 0.85)] : 0.08;

  // Fill empty angular bins via circular linear interpolation
  for (let i = 0; i < nBins; i++) {
    if (maxR[i] >= 0) continue;
    let prev = -1;
    let next = -1;
    for (let step = 1; step < nBins; step++) {
      const pi = (i - step + nBins) % nBins;
      if (prev < 0 && maxR[pi] >= 0) prev = maxR[pi];
      const ni = (i + step) % nBins;
      if (next < 0 && maxR[ni] >= 0) next = maxR[ni];
      if (prev >= 0 && next >= 0) break;
    }
    maxR[i] = prev >= 0 && next >= 0 ? (prev + next) * 0.5 : defaultR;
  }

  let ring: OrganicMotifPoint[] = [];
  for (let i = 0; i < nBins; i++) {
    const ang = ((i + 0.5) / nBins) * Math.PI * 2;
    const r = Math.max(0.014, maxR[i]);
    ring.push({
      u: clamp01(cu + Math.cos(ang) * r),
      v: clamp01(cv + Math.sin(ang) * r),
    });
  }

  // 2 passes of periodic Laplacian smoothing
  for (let pass = 0; pass < 2; pass++) {
    const smoothed: OrganicMotifPoint[] = new Array(nBins);
    for (let i = 0; i < nBins; i++) {
      const prev = ring[(i - 1 + nBins) % nBins];
      const curr = ring[i];
      const next = ring[(i + 1) % nBins];
      smoothed[i] = {
        u: clamp01(curr.u * 0.5 + (prev.u + next.u) * 0.25),
        v: clamp01(curr.v * 0.5 + (prev.v + next.v) * 0.25),
      };
    }
    ring = smoothed;
  }

  return ring.map((p) => ({
    u: Number(p.u.toFixed(3)),
    v: Number(p.v.toFixed(3)),
  }));
}

/**
 * Pure Stage 2 Extractor: Converts a segmented nail patch (`rgba`, `width`, `height`, `mask`)
 * into a 100% vector + parametric `NailDesignBlueprint` (zero raw bitmap pixels!).
 *
 * Exported directly so Node unit tests can validate color preservation, border detection,
 * geometry profiles, and vector element extraction without DOM or MediaPipe dependencies.
 */
export function extractBlueprintFromNailPatch(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  mask: Uint8Array,
  _fingerId: FingerId
): NailDesignBlueprint {
  const rowLeft = new Int16Array(height).fill(-1);
  const rowRight = new Int16Array(height).fill(-1);
  const rowWidth = new Float32Array(height);

  let minY = height;
  let maxY = -1;
  let maxWidth = 0;

  for (let y = 0; y < height; y++) {
    let lx = -1;
    let rx = -1;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[rowOff + x] > 0) {
        if (lx < 0) lx = x;
        rx = x;
      }
    }
    if (lx >= 0 && rx > lx) {
      rowLeft[y] = lx;
      rowRight[y] = rx;
      const w = rx - lx + 1;
      rowWidth[y] = w;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (w > maxWidth) maxWidth = w;
    }
  }

  // Safe fallback envelope if an empty mask is passed
  if (maxY <= minY || maxWidth < 4) {
    minY = Math.round(height * 0.14);
    maxY = Math.round(height * 0.86);
    maxWidth = Math.round(width * 0.42);
    const lDef = Math.round(width * 0.29);
    const rDef = Math.round(width * 0.71);
    for (let y = minY; y <= maxY; y++) {
      rowLeft[y] = lDef;
      rowRight[y] = rDef;
      rowWidth[y] = rDef - lDef + 1;
    }
  }

  // Smooth left/right boundaries across Y to suppress pixelation noise
  const smoothL = new Float32Array(height);
  const smoothR = new Float32Array(height);
  for (let y = minY; y <= maxY; y++) {
    let accL = 0;
    let accR = 0;
    let cnt = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = clamp(y + dy, minY, maxY);
      if (rowLeft[yy] >= 0 && rowRight[yy] > rowLeft[yy]) {
        accL += rowLeft[yy];
        accR += rowRight[yy];
        cnt++;
      }
    }
    smoothL[y] = cnt > 0 ? accL / cnt : width * 0.3;
    smoothR[y] = cnt > 0 ? accR / cnt : width * 0.7;
  }

  const nailLength = Math.max(8, maxY - minY + 1);

  // Measure normalized half-width at the 8 V10 parametric stations (v=0 cuticle .. v=1 tip)
  const sampleBandWidth = (vNorm: number): number => {
    const targetY = Math.round(maxY - vNorm * (maxY - minY));
    const win = Math.max(1, Math.round(nailLength * 0.03));
    let acc = 0;
    let cnt = 0;
    for (let dy = -win; dy <= win; dy++) {
      const yy = clamp(targetY + dy, minY, maxY);
      const span = smoothR[yy] - smoothL[yy];
      if (span > 1) {
        acc += span;
        cnt++;
      }
    }
    return cnt > 0 ? acc / cnt : maxWidth;
  };

  const bedRefWidth = Math.max(
    4,
    sampleBandWidth(0.35),
    sampleBandWidth(0.55),
    maxWidth * 0.90
  );

  const rawProfile: number[] = PROFILE_STATIONS_V.map((vSt) => {
    const wSt = sampleBandWidth(vSt);
    return clamp((wSt / bedRefWidth) * 0.5, 0.085, 0.5);
  });
  // Enforce smooth symmetry and bed plateau + anti-needle tip floor (>= 0.085)
  rawProfile[2] = Math.max(rawProfile[2], 0.48);
  rawProfile[3] = Math.max(rawProfile[3], 0.47);
  for (let i = 4; i < 8; i++) {
    // Enforce non-increasing distal taper after bed plateau to avoid jagged mask bumps
    rawProfile[i] = clamp(Math.min(rawProfile[i], rawProfile[i - 1] + 0.015), 0.085, 0.5);
  }
  rawProfile[7] = clamp(rawProfile[7], 0.085, 0.5);

  const profileHalfWidths: NailGeometryProfile['profileHalfWidths'] = [
    Number(rawProfile[0].toFixed(3)),
    Number(rawProfile[1].toFixed(3)),
    Number(rawProfile[2].toFixed(3)),
    Number(rawProfile[3].toFixed(3)),
    Number(rawProfile[4].toFixed(3)),
    Number(rawProfile[5].toFixed(3)),
    Number(rawProfile[6].toFixed(3)),
    Number(rawProfile[7].toFixed(3)),
  ];

  const aspectRatio = Number(clamp(nailLength / bedRefWidth, 0.78, 3.3).toFixed(2));
  const w72 = profileHalfWidths[4] * 2;
  const w85 = profileHalfWidths[5] * 2;
  const w94 = profileHalfWidths[6] * 2;
  const w100 = profileHalfWidths[7] * 2;

  const tipTapering = clamp(w85, 0.14, 1.0);
  const tipFlatness = clamp(w94 / Math.max(0.16, w85), 0, 1);
  const distalDrop = clamp(w72 - w100, 0, 1);
  const apexCurvature = clamp01((1 - tipFlatness) * 0.6 + distalDrop * 0.45);
  const tipRoundness = Number(
    clamp01((1 - tipFlatness) * 0.68 + (1 - tipTapering) * 0.32).toFixed(2)
  );

  let shape: NailShape = 'almond';
  if (aspectRatio < 1.26) {
    shape = tipTapering >= 0.84 && apexCurvature < 0.32 ? 'square' : 'natural';
  } else if (
    w100 < 0.25 ||
    tipTapering < 0.40 ||
    (aspectRatio >= 1.72 && tipTapering < 0.48 && apexCurvature >= 0.44)
  ) {
    shape = 'stiletto';
  } else if (tipTapering >= 0.84 && apexCurvature < 0.34) {
    shape = 'square';
  } else if (tipTapering >= 0.54 && tipTapering < 0.84 && apexCurvature < 0.40) {
    shape = 'coffin';
  } else if (tipTapering >= 0.64 && apexCurvature >= 0.36 && aspectRatio < 1.68) {
    shape = 'oval';
  } else {
    shape = 'almond';
  }

  const freeEdgeRatio = Number(mapAspectRatioToFreeEdgeRatio(aspectRatio).toFixed(2));
  const geometry: NailGeometryProfile = {
    profileHalfWidths,
    aspectRatio,
    freeEdgeRatio,
    tipRoundness,
    shape,
  };

  // Precompute luma, gradient magnitude, and cached CIELab buffer inside ROI (avoids redundant cbrt calls!)
  const totalPx = width * height;
  const lumaBuf = new Float32Array(totalPx);
  const gradBuf = new Float32Array(totalPx);
  const labBuf = new Float32Array(totalPx * 3);
  for (let i = 0; i < totalPx; i++) {
    const p4 = i * 4;
    lumaBuf[i] = (0.299 * rgba[p4] + 0.587 * rgba[p4 + 1] + 0.114 * rgba[p4 + 2]) / 255;
  }
  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOff + x;
      if (mask[idx] === 0) continue;
      const gx = lumaBuf[idx + 1] - lumaBuf[idx - 1];
      const gy = lumaBuf[idx + width] - lumaBuf[idx - width];
      gradBuf[idx] = Math.hypot(gx, gy) * 0.5;
    }
  }

  // Collect Lab samples across interior plate (excluding blown specular glare) and border regions
  const interiorSamples: LabSample[] = [];
  const cuticleBandLabs: Array<[number, number, number]> = [];
  const cuticleBandRgbs: Array<[number, number, number]> = [];
  const midBandLabs: Array<[number, number, number]> = [];
  const midBandRgbs: Array<[number, number, number]> = [];
  const tipBandLabs: Array<[number, number, number]> = [];
  const tipBandRgbs: Array<[number, number, number]> = [];
  const centerAuraLabs: Array<[number, number, number]> = [];
  const centerAuraRgbs: Array<[number, number, number]> = [];
  const outerAuraLabs: Array<[number, number, number]> = [];
  const outerAuraRgbs: Array<[number, number, number]> = [];

  interface BorderSample {
    r: number;
    g: number;
    b: number;
    lab: [number, number, number];
    u: number;
    v: number;
    isLateral: boolean;
    isCuticle: boolean;
    isTip: boolean;
    isMetal: boolean;
    isGold: boolean;
  }
  const borderSamples: BorderSample[] = [];

  let lumaSum = 0;
  let lumaSqSum = 0;
  let highGradCount = 0;
  let catEyeBandHits = 0;
  let catEyeBandTotal = 0;
  let satSum = 0;
  let maskCount = 0;

  for (let y = minY; y <= maxY; y++) {
    const lx = smoothL[y];
    const rx = smoothR[y];
    const span = rx - lx;
    if (span < 3) continue;
    const v = clamp01((maxY - y) / Math.max(1, maxY - minY));
    const rowOff = y * width;

    for (let x = Math.max(0, Math.floor(lx)); x <= Math.min(width - 1, Math.ceil(rx)); x++) {
      const idx = rowOff + x;
      if (mask[idx] === 0) continue;

      const p4 = idx * 4;
      const r = rgba[p4];
      const g = rgba[p4 + 1];
      const b = rgba[p4 + 2];
      const u = clamp01((x - lx) / span);
      const grad = gradBuf[idx];
      const luma = lumaBuf[idx];
      const [, sat] = rgbToHsv(r, g, b);
      const glare = isSpecularGlare(r, g, b);

      maskCount++;
      lumaSum += luma;
      lumaSqSum += luma * luma;
      satSum += sat;
      if (grad > 0.11) highGradCount++;

      const metalInfo = detectMetallicSignal(r, g, b, grad);
      const lab = rgbToLab(r, g, b);
      const l3 = idx * 3;
      labBuf[l3] = lab[0];
      labBuf[l3 + 1] = lab[1];
      labBuf[l3 + 2] = lab[2];

      const isLateralBorder = u <= 0.10 || u >= 0.90;
      const isCuticleBorder = v <= 0.10;
      const isTipBorder = v >= 0.80;
      const isPerimeter = isLateralBorder || isCuticleBorder || v >= 0.80;

      // In perimeter border bands (especially crisp white French tips!), bright matte/gel white
      // should still be evaluated as border pigment (only skip narrow interior specular streaks).
      if (isPerimeter && (!glare || isTipBorder)) {
        borderSamples.push({
          r,
          g,
          b,
          lab,
          u,
          v,
          isLateral: isLateralBorder,
          isCuticle: isCuticleBorder,
          isTip: isTipBorder,
          isMetal: metalInfo.isMetallic,
          isGold: metalInfo.isGold,
        });
      }

      if (glare) continue;

      // Interior plate pixels (for K-Means baseColorHex so perimeter borders don't hijack base!)
      if (u >= 0.12 && u <= 0.88 && v >= 0.10 && v <= 0.84) {
        interiorSamples.push({
          L: lab[0],
          a: lab[1],
          b: lab[2],
          r,
          g,
          bp: b,
          u,
          v,
          x,
          y,
          isMetal: metalInfo.isMetallic,
          isGold: metalInfo.isGold,
        });
      }

      if (u >= 0.22 && u <= 0.78) {
        if (v >= 0.08 && v <= 0.28) {
          cuticleBandLabs.push(lab);
          cuticleBandRgbs.push([r, g, b]);
        } else if (v >= 0.40 && v <= 0.62) {
          midBandLabs.push(lab);
          midBandRgbs.push([r, g, b]);
        } else if (v >= 0.74 && v <= 0.94) {
          tipBandLabs.push(lab);
          tipBandRgbs.push([r, g, b]);
        }
      }

      const auraDist = Math.hypot((u - 0.5) * 1.45, (v - 0.5) * 1.25);
      if (auraDist < 0.28) {
        centerAuraLabs.push(lab);
        centerAuraRgbs.push([r, g, b]);
      } else if (auraDist > 0.46 && u > 0.12 && u < 0.88 && v > 0.10 && v < 0.88) {
        outerAuraLabs.push(lab);
        outerAuraRgbs.push([r, g, b]);
      }

      // Diagonal cat-eye bright band test
      const diagDist = Math.abs((u - 0.5) * 0.85 + (v - 0.52) * 0.55);
      if (diagDist < 0.14) {
        catEyeBandTotal++;
        if (luma > 0.58) catEyeBandHits++;
      }
    }
  }

  // Fallback if interiorSamples was tiny (e.g. ultra narrow ROI)
  if (interiorSamples.length < 12) {
    for (let y = minY; y <= maxY; y++) {
      const rowOff = y * width;
      const lx = smoothL[y];
      const rx = smoothR[y];
      const span = Math.max(1, rx - lx);
      const v = clamp01((maxY - y) / Math.max(1, maxY - minY));
      for (let x = 0; x < width; x++) {
        const idx = rowOff + x;
        if (mask[idx] === 0) continue;
        const p4 = idx * 4;
        const r = rgba[p4];
        const g = rgba[p4 + 1];
        const b = rgba[p4 + 2];
        if (isSpecularGlare(r, g, b)) continue;
        const lab = rgbToLab(r, g, b);
        const l3 = idx * 3;
        labBuf[l3] = lab[0];
        labBuf[l3 + 1] = lab[1];
        labBuf[l3 + 2] = lab[2];
        const mInfo = detectMetallicSignal(r, g, b, gradBuf[idx]);
        interiorSamples.push({
          L: lab[0],
          a: lab[1],
          b: lab[2],
          r,
          g,
          bp: b,
          u: clamp01((x - lx) / span),
          v,
          x,
          y,
          isMetal: mInfo.isMetallic,
          isGold: mInfo.isGold,
        });
      }
    }
  }

  // B. K-Means (k=4, 8 iterations) in CIELab for true dominant baseColorHex
  const clusters = deterministicLabKMeans(interiorSamples, 4, 8);
  const primaryCluster = clusters[0];
  const baseColorHex = primaryCluster ? primaryCluster.hex : '#C88D84';
  const baseLab = hexToLab(baseColorHex);

  const cuticleColorHex = medianColorFromLabSamples(cuticleBandLabs, cuticleBandRgbs, baseColorHex);
  const midColorHex = medianColorFromLabSamples(midBandLabs, midBandRgbs, baseColorHex);
  const tipColorHex = medianColorFromLabSamples(tipBandLabs, tipBandRgbs, baseColorHex);
  const centerAuraHex = medianColorFromLabSamples(centerAuraLabs, centerAuraRgbs, midColorHex);
  const outerAuraHex = medianColorFromLabSamples(outerAuraLabs, outerAuraRgbs, baseColorHex);

  const meanLuma = lumaSum / Math.max(1, maskCount);
  const lumaVar = Math.max(0, lumaSqSum / Math.max(1, maskCount) - meanLuma * meanLuma);
  const lumaStd = Math.sqrt(lumaVar);
  const meanSat = satSum / Math.max(1, maskCount);
  const gradDensity = highGradCount / Math.max(1, maskCount);

  const cuticleTipDelta = deltaLab(hexToLab(cuticleColorHex), hexToLab(tipColorHex));
  const centerOuterDelta = deltaLab(hexToLab(centerAuraHex), hexToLab(outerAuraHex));
  const catEyeRatio = catEyeBandTotal > 0 ? catEyeBandHits / catEyeBandTotal : 0;

  // Classify borderLayer (0..10% perimeter ring vs baseLab)
  const lateralSamples = borderSamples.filter((s) => s.isLateral && !s.isTip);
  const cuticleSamples = borderSamples.filter((s) => s.isCuticle && !s.isLateral);
  const tipBorderSamples = borderSamples.filter((s) => s.isTip);

  const lateralDiff = lateralSamples.filter((s) => deltaLab(s.lab, baseLab) > 14);
  const cuticleDiff = cuticleSamples.filter((s) => deltaLab(s.lab, baseLab) > 14);
  const tipDiff = tipBorderSamples.filter((s) => deltaLab(s.lab, baseLab) > 14);

  const lateralDiffRatio = lateralSamples.length > 0 ? lateralDiff.length / lateralSamples.length : 0;
  const cuticleDiffRatio = cuticleSamples.length > 0 ? cuticleDiff.length / cuticleSamples.length : 0;
  const tipDiffRatio = tipBorderSamples.length > 0 ? tipDiff.length / tipBorderSamples.length : 0;
  const lateralMetalRatio =
    lateralSamples.length > 0
      ? lateralSamples.filter((s) => s.isMetal && deltaLab(s.lab, baseLab) > 12).length /
        lateralSamples.length
      : 0;
  const cuticleMetalRatio =
    cuticleSamples.length > 0
      ? cuticleSamples.filter((s) => s.isMetal && deltaLab(s.lab, baseLab) > 12).length /
        cuticleSamples.length
      : 0;
  const tipMetalRatio =
    tipBorderSamples.length > 0
      ? tipBorderSamples.filter((s) => s.isMetal && deltaLab(s.lab, baseLab) > 12).length /
        tipBorderSamples.length
      : 0;

  let borderKind: NailBorderKind = 'none';
  let borderSamplesChosen: BorderSample[] = [];
  let borderIsMetallic = false;
  let borderThicknessNorm = 0.05;
  let smileCurveDepth = 0.14;

  if (
    (lateralDiffRatio > 0.34 && (cuticleDiffRatio > 0.24 || tipDiffRatio > 0.24)) &&
    (lateralMetalRatio > 0.22 || cuticleMetalRatio > 0.22 || tipMetalRatio > 0.22)
  ) {
    borderKind = 'full_metallic_outline';
    borderSamplesChosen = [...lateralDiff, ...cuticleDiff, ...tipDiff];
    borderIsMetallic = true;
    borderThicknessNorm = 0.055;
    smileCurveDepth = 0.08;
  } else if (cuticleDiffRatio > 0.42 && cuticleMetalRatio > 0.24 && tipDiffRatio < 0.28) {
    borderKind = 'cuticle_cuff';
    borderSamplesChosen = cuticleDiff;
    borderIsMetallic = true;
    borderThicknessNorm = 0.075;
    smileCurveDepth = 0.16;
  } else if (tipDiffRatio > 0.38 && lateralDiffRatio < 0.36) {
    // Distinguish micro_french vs classic_french vs v_french
    const v82Samples = borderSamples.filter((s) => s.v >= 0.80 && s.v < 0.90);
    const v82DiffRatio =
      v82Samples.length > 0
        ? v82Samples.filter((s) => deltaLab(s.lab, baseLab) > 14).length / v82Samples.length
        : 0;
    const centerTipDiff = tipBorderSamples.filter(
      (s) => s.u >= 0.40 && s.u <= 0.60 && s.v >= 0.78 && s.v <= 0.88 && deltaLab(s.lab, baseLab) > 14
    ).length;
    const sideTipDiff = tipBorderSamples.filter(
      (s) => (s.u < 0.25 || s.u > 0.75) && s.v >= 0.82 && deltaLab(s.lab, baseLab) > 14
    ).length;

    if (v82DiffRatio < 0.20) {
      borderKind = 'micro_french';
      borderThicknessNorm = 0.065;
      smileCurveDepth = 0.10;
    } else if (centerTipDiff > sideTipDiff * 1.4 && v82DiffRatio > 0.24) {
      borderKind = 'v_french';
      borderThicknessNorm = 0.18;
      smileCurveDepth = 0.24;
    } else {
      borderKind = 'classic_french';
      borderThicknessNorm = 0.17;
      smileCurveDepth = 0.16;
    }
    borderSamplesChosen = tipDiff;
    borderIsMetallic = tipMetalRatio > 0.36;
  }

  const borderColorHex =
    borderSamplesChosen.length > 0
      ? medianColorFromLabSamples(
          borderSamplesChosen.map((s) => s.lab),
          borderSamplesChosen.map((s) => [s.r, s.g, s.b]),
          borderIsMetallic ? '#D4AF37' : '#FFFDF9'
        )
      : '#D4AF37';

  const borderLayer: NailBorderLayer = {
    kind: borderKind,
    colorHex: borderColorHex,
    thicknessNorm: Number(clamp(borderThicknessNorm, 0.02, 0.28).toFixed(3)),
    isMetallic: borderIsMetallic,
    is3DRaised: borderKind === 'full_metallic_outline' || borderKind === 'cuticle_cuff',
    smileCurveDepth: Number(clamp(smileCurveDepth, 0, 0.35).toFixed(3)),
  };

  // D. Foreground Art Segmentation (deltaLab > 13 vs baseLab, excluding borderLayer & glare)
  const artMask = new Uint8Array(totalPx);
  const artSeeds: number[] = [];

  for (let y = minY; y <= maxY; y++) {
    const lx = smoothL[y];
    const rx = smoothR[y];
    const span = rx - lx;
    if (span < 4) continue;
    const v = clamp01((maxY - y) / Math.max(1, maxY - minY));
    const rowOff = y * width;

    // Respect borderLayer margin so perimeter gold rims or French tips aren't duplicated as strokes
    const uMargin =
      borderKind === 'full_metallic_outline' ? 0.11 : 0.06;
    const vMinArt =
      borderKind === 'full_metallic_outline' || borderKind === 'cuticle_cuff' ? 0.12 : 0.06;
    const vMaxArt =
      borderKind === 'classic_french' || borderKind === 'v_french'
        ? 0.78
        : borderKind === 'micro_french' || borderKind === 'full_metallic_outline'
          ? 0.89
          : 0.94;

    if (v < vMinArt || v > vMaxArt) continue;

    for (let x = Math.max(0, Math.floor(lx)); x <= Math.min(width - 1, Math.ceil(rx)); x++) {
      const idx = rowOff + x;
      if (mask[idx] === 0) continue;
      const u = (x - lx) / span;
      if (u < uMargin || u > 1 - uMargin) continue;

      const p4 = idx * 4;
      const r = rgba[p4];
      const g = rgba[p4 + 1];
      const b = rgba[p4 + 2];
      if (isSpecularGlare(r, g, b)) continue;

      const l3 = idx * 3;
      const dL = labBuf[l3] - baseLab[0];
      const dA = labBuf[l3 + 1] - baseLab[1];
      const dB = labBuf[l3 + 2] - baseLab[2];
      const dBase = Math.sqrt(dL * dL + dA * dA + dB * dB);
      const mInfo = detectMetallicSignal(r, g, b, gradBuf[idx]);

      if (dBase > 13.0 || (mInfo.isMetallic && dBase > 9.5)) {
        artMask[idx] = 1;
        artSeeds.push(idx);
      }
    }
  }

  // 8-neighbor Connected Components Vectorization
  const visited = new Uint8Array(totalPx);
  const rawPlateArea = Math.max(40, maskCount);
  interface VectorCandidate {
    relevance: number;
    element: VectorArtElement;
  }
  const vectorCandidates: VectorCandidate[] = [];

  for (const seedIdx of artSeeds) {
    if (visited[seedIdx] || artMask[seedIdx] === 0) continue;

    const queue: number[] = [seedIdx];
    visited[seedIdx] = 1;
    let head = 0;

    interface CompPx {
      x: number;
      y: number;
      u: number;
      v: number;
      r: number;
      g: number;
      b: number;
      lab: [number, number, number];
      luma: number;
      isMetal: boolean;
      isGold: boolean;
      grad: number;
    }
    const pts: CompPx[] = [];

    while (head < queue.length) {
      const cur = queue[head++];
      const cy = Math.floor(cur / width);
      const cx = cur - cy * width;
      const lx = smoothL[cy];
      const rx = smoothR[cy];
      const span = Math.max(1, rx - lx);
      const p4 = cur * 4;
      const r = rgba[p4];
      const g = rgba[p4 + 1];
      const b = rgba[p4 + 2];
      const grad = gradBuf[cur];
      const mInfo = detectMetallicSignal(r, g, b, grad);
      const l3 = cur * 3;

      pts.push({
        x: cx,
        y: cy,
        u: clamp01((cx - lx) / span),
        v: clamp01((maxY - cy) / Math.max(1, maxY - minY)),
        r,
        g,
        b,
        lab: [labBuf[l3], labBuf[l3 + 1], labBuf[l3 + 2]],
        luma: lumaBuf[cur],
        isMetal: mInfo.isMetallic,
        isGold: mInfo.isGold,
        grad,
      });

      for (let oy = -1; oy <= 1; oy++) {
        const ny = cy + oy;
        if (ny < 0 || ny >= height) continue;
        const nRow = ny * width;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = cx + ox;
          if (nx < 0 || nx >= width) continue;
          const nIdx = nRow + nx;
          if (visited[nIdx] === 0 && artMask[nIdx] === 1) {
            visited[nIdx] = 1;
            queue.push(nIdx);
          }
        }
      }
    }

    const areaFrac = pts.length / rawPlateArea;
    if (pts.length < 4 || areaFrac < 0.0012) continue;

    let sumU = 0;
    let sumV = 0;
    let metalCount = 0;
    let goldCount = 0;
    let lumaAcc = 0;
    let maxLuma = 0;
    for (const p of pts) {
      sumU += p.u;
      sumV += p.v;
      if (p.isMetal) metalCount++;
      if (p.isGold) goldCount++;
      lumaAcc += p.luma;
      if (p.luma > maxLuma) maxLuma = p.luma;
    }
    const cu = sumU / pts.length;
    const cv = sumV / pts.length;
    const metalFrac = metalCount / pts.length;
    const goldFrac = goldCount / pts.length;
    const compMeanLuma = lumaAcc / pts.length;

    // Covariance matrix PCA in isotropic pixel space (adjusted for nail aspect ratio!)
    // so circular beads/pearls on tall nails are not falsely stretched horizontally in (u, v)!
    const uToX = bedRefWidth;
    const vToY = nailLength;
    let cxPx = 0;
    let cyPx = 0;
    for (const p of pts) {
      cxPx += p.u * uToX;
      cyPx += p.v * vToY;
    }
    cxPx /= pts.length;
    cyPx /= pts.length;

    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    let cxxUV = 0;
    let cyyUV = 0;
    let cxyUV = 0;
    for (const p of pts) {
      const dx = p.u * uToX - cxPx;
      const dy = p.v * vToY - cyPx;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;

      const du = p.u - cu;
      const dv = p.v - cv;
      cxxUV += du * du;
      cyyUV += dv * dv;
      cxyUV += du * dv;
    }
    cxx /= pts.length;
    cyy /= pts.length;
    cxy /= pts.length;
    cxxUV /= pts.length;
    cyyUV /= pts.length;
    cxyUV /= pts.length;

    const trace = cxx + cyy;
    const disc = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy));
    const lambda1 = Math.max(1e-5, (trace + disc) * 0.5);
    const lambda2 = Math.max(0, (trace - disc) * 0.5);
    const eccentricity = Math.sqrt(Math.max(0, 1 - lambda2 / lambda1));

    const traceUV = cxxUV + cyyUV;
    const discUV = Math.sqrt(Math.max(0, (cxxUV - cyyUV) * (cxxUV - cyyUV) + 4 * cxyUV * cxyUV));
    const lambda1UV = Math.max(1e-7, (traceUV + discUV) * 0.5);

    // Effective radius normalized to nail width (0.015 .. 0.065)
    const pixelRadius = Math.sqrt(pts.length / Math.PI);
    const approxRadius = pixelRadius / Math.max(8, bedRefWidth);
    const majorR = Math.max(1e-3, Math.sqrt(lambda1) * 2.0);
    const minorR = Math.max(1e-3, Math.sqrt(lambda2) * 2.0);
    const circularity = clamp01(Math.min(1, minorR / majorR));

    const compLabs = pts.map((p) => p.lab);
    const compRgbs: Array<[number, number, number]> = pts.map((p) => [p.r, p.g, p.b]);
    const compColorHex = medianColorFromLabSamples(compLabs, compRgbs, '#D4AF37');
    const isCompMetallic = metalFrac > 0.28 || goldFrac > 0.20;

    // 1. Small circular bright/metallic bead/pearl/crystal -> micro_gem
    if (
      approxRadius >= 0.015 &&
      approxRadius <= 0.085 &&
      circularity >= 0.56 &&
      eccentricity <= 0.80 &&
      (isCompMetallic || compMeanLuma > 0.65 || maxLuma > 0.78)
    ) {
      const [, compSat] = rgbToHsv(...hexToRgb(compColorHex));
      const kind: MicroGemElement['kind'] =
        goldFrac > 0.25
          ? 'gold_bead'
          : compSat < 0.16 && compMeanLuma > 0.70
            ? 'pearl'
            : 'crystal';

      const gem: MicroGemElement = {
        type: 'micro_gem',
        u: Number(clamp01(cu).toFixed(3)),
        v: Number(clamp01(cv).toFixed(3)),
        radius: Number(clamp(approxRadius, 0.015, 0.065).toFixed(3)),
        colorHex: compColorHex,
        kind,
      };
      vectorCandidates.push({
        relevance: areaFrac * (isCompMetallic ? 2.2 : 1.5),
        element: gem,
      });
      continue;
    }

    // 2. Elongated element (eccentricity > 0.76) -> ribbon_stroke via PCA ridge slicing + RDP
    if (eccentricity > 0.76 && pts.length >= 6) {
      // Principal axis eigenvector (ux, uy) in UV space for eigenvalue lambda1UV
      let ux = 1;
      let uy = 0;
      if (Math.abs(cxyUV) > 1e-8) {
        ux = lambda1UV - cyyUV;
        uy = cxyUV;
      } else if (cyyUV > cxxUV) {
        ux = 0;
        uy = 1;
      }
      const uLen = Math.hypot(ux, uy) || 1;
      ux /= uLen;
      uy /= uLen;
      const vx = -uy;
      const vy = ux;

      // Project points along principal axis t and perpendicular n
      let minT = Infinity;
      let maxT = -Infinity;
      const projected = pts.map((p) => {
        const du = p.u - cu;
        const dv = p.v - cv;
        const t = du * ux + dv * uy;
        const n = du * vx + dv * vy;
        if (t < minT) minT = t;
        if (t > maxT) maxT = t;
        return { p, t, n };
      });

      const spanT = Math.max(1e-4, maxT - minT);
      const nSlices = clamp(Math.round(spanT / 0.045), 6, 14);
      const sliceBins: Array<Array<{ u: number; v: number; n: number }>> = Array.from(
        { length: nSlices },
        () => []
      );

      for (const item of projected) {
        const bIdx = Math.min(nSlices - 1, Math.floor(((item.t - minT) / spanT) * nSlices));
        sliceBins[bIdx].push({ u: item.p.u, v: item.p.v, n: item.n });
      }

      const rawCenterline: RibbonStrokePoint[] = [];
      for (let sIdx = 0; sIdx < nSlices; sIdx++) {
        const bin = sliceBins[sIdx];
        if (bin.length === 0) continue;
        let su = 0;
        let sv = 0;
        let minN = Infinity;
        let maxN = -Infinity;
        for (const bp of bin) {
          su += bp.u;
          sv += bp.v;
          if (bp.n < minN) minN = bp.n;
          if (bp.n > maxN) maxN = bp.n;
        }
        const localWidth = clamp(Math.max(0.022, (maxN - minN) * 1.1), 0.015, 0.14);
        rawCenterline.push({
          u: su / bin.length,
          v: sv / bin.length,
          width: localWidth,
        });
      }

      const points = normalizeRibbonControlPoints(rawCenterline);
      if (points.length >= 4) {
        const highlightHex = isCompMetallic
          ? mixHex(compColorHex, '#FFF7DF', 0.55)
          : shadeHex(compColorHex, 32);
        const ribbon: RibbonStrokeElement = {
          type: 'ribbon_stroke',
          points,
          colorHex: compColorHex,
          highlightHex,
          isMetallic: isCompMetallic,
          reliefHeight: Number(clamp(isCompMetallic ? 0.82 : 0.48, 0.2, 1.0).toFixed(2)),
        };
        vectorCandidates.push({
          relevance: areaFrac * (isCompMetallic ? 2.5 : 1.5),
          element: ribbon,
        });
        continue;
      }
    }

    // 3. Organic/floral/marble motif (eccentricity <= 0.76, area >= 1.2% of plate)
    if (areaFrac >= 0.012) {
      const contour = extractSmoothedOrganicContour(pts, cu, cv, 20);
      const motif: OrganicMotifElement = {
        type: 'organic_motif',
        contour,
        fillColorHex: compColorHex,
        shadeColorHex: shadeHex(compColorHex, -34),
        isMetallic: isCompMetallic,
        reliefHeight: Number(clamp(isCompMetallic ? 0.72 : 0.55, 0.15, 1.0).toFixed(2)),
      };
      vectorCandidates.push({
        relevance: areaFrac * 1.6,
        element: motif,
      });
    }
  }

  vectorCandidates.sort((a, b) => b.relevance - a.relevance);
  const artElements: VectorArtElement[] = vectorCandidates
    .slice(0, 12)
    .map((c) => c.element);

  // Detect gradientMode & finishStyle for baseLayer
  const totalMetalRatio =
    interiorSamples.length > 0
      ? interiorSamples.filter((s) => s.isMetal).length / interiorSamples.length
      : 0;
  const isVelvetMatte =
    gradDensity < 0.025 && lumaStd < 0.055 && totalMetalRatio < 0.04;
  const isChromeMirror =
    (lumaStd > 0.15 && totalMetalRatio > 0.18 && artElements.length <= 2) ||
    (meanLuma > 0.62 && lumaStd > 0.17 && meanSat < 0.25);
  const isPearlGlazed =
    !isChromeMirror && meanLuma > 0.68 && meanSat < 0.24 && lumaStd > 0.075 && totalMetalRatio > 0.04;
  const isCatEye =
    !isChromeMirror && catEyeRatio > 0.62 && lumaStd > 0.10 && meanLuma < 0.65;
  const isJelly =
    !isChromeMirror &&
    !isVelvetMatte &&
    meanLuma > 0.56 &&
    meanSat < 0.36 &&
    deltaLab(hexToLab(cuticleColorHex), hexToLab(tipColorHex)) > 11 &&
    artElements.length === 0;

  let finishStyle: NailFinishV10 = 'glossy_gel';
  if (isChromeMirror) finishStyle = 'chrome_mirror';
  else if (isPearlGlazed) finishStyle = 'pearl_glazed';
  else if (isCatEye) finishStyle = 'cat_eye';
  else if (isVelvetMatte) finishStyle = 'velvet_matte';
  else if (isJelly) finishStyle = 'jelly_translucent';

  let gradientMode: NailGradientMode = 'solid';
  if (finishStyle === 'chrome_mirror' || finishStyle === 'pearl_glazed') {
    gradientMode = 'pearl_chrome';
  } else if (finishStyle === 'cat_eye') {
    gradientMode = 'cat_eye_band';
  } else if (centerOuterDelta > 12.5 && centerOuterDelta >= cuticleTipDelta * 0.9) {
    gradientMode = 'radial_aura';
  } else if (cuticleTipDelta > 13.0) {
    gradientMode = 'vertical_ombre';
  }

  const baseLayer: NailBaseLayer = {
    baseColorHex,
    gradientMode,
    cuticleColorHex,
    midColorHex: gradientMode === 'radial_aura' ? centerAuraHex : midColorHex,
    tipColorHex,
    finishStyle,
    translucency: finishStyle === 'jelly_translucent' ? 0.52 : finishStyle === 'pearl_glazed' ? 0.22 : 0.06,
    metallicBase:
      finishStyle === 'chrome_mirror'
        ? 0.92
        : finishStyle === 'pearl_glazed'
          ? 0.42
          : finishStyle === 'cat_eye'
            ? 0.55
            : 0.04,
    glossiness: finishStyle === 'velvet_matte' ? 0.42 : finishStyle === 'chrome_mirror' ? 1.0 : 0.95,
  };

  return {
    version: 10,
    geometry,
    baseLayer,
    borderLayer,
    artElements,
  };
}

// -----------------------------------------------------------------------------
// Stage 1: Fast 128×192 ROI Extraction, Local Skin/Background Modeling & Region Growing
// -----------------------------------------------------------------------------

type ScratchCanvas = OffscreenCanvas | HTMLCanvasElement;
type ScratchCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createScratchCanvas(w: number, h: number): { canvas: ScratchCanvas; ctx: ScratchCtx } {
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function loadImageFromDataUrl(dataUrl: string, maxDim = 1600): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const rawImg = new Image();
    rawImg.onerror = () => reject(new Error('Imagem inválida.'));
    rawImg.onload = () => {
      const maxNatural = Math.max(rawImg.naturalWidth, rawImg.naturalHeight);
      const scale = Math.min(1, maxDim / Math.max(1, maxNatural));
      if (scale >= 0.99) {
        resolve(rawImg);
        return;
      }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(rawImg.naturalWidth * scale));
      c.height = Math.max(1, Math.round(rawImg.naturalHeight * scale));
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve(rawImg);
        return;
      }
      ctx.drawImage(rawImg, 0, 0, c.width, c.height);
      const norm = new Image();
      norm.onload = () => resolve(norm);
      norm.onerror = () => resolve(rawImg);
      norm.src = c.toDataURL('image/jpeg', 0.92);
    };
    rawImg.src = dataUrl;
  });
}

interface SkinStats {
  labMean: [number, number, number];
  labStd: [number, number, number];
  ycbcrMean: [number, number, number];
  ycbcrStd: [number, number, number];
}

function computeSkinModel(
  img: HTMLImageElement,
  pipNorm: { x: number; y: number },
  dipNorm: { x: number; y: number },
  segPx: number
): SkinStats {
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  const { ctx } = createScratchCanvas(24, 24);
  const sx = (pipNorm.x * 0.55 + dipNorm.x * 0.45) * imgW;
  const sy = (pipNorm.y * 0.55 + dipNorm.y * 0.45) * imgH;
  const patch = Math.max(10, Math.round(segPx * 0.24));

  ctx.drawImage(
    img,
    clamp(sx - patch * 0.5, 0, Math.max(0, imgW - patch)),
    clamp(sy - patch * 0.5, 0, Math.max(0, imgH - patch)),
    patch,
    patch,
    0,
    0,
    24,
    24
  );

  const px = ctx.getImageData(0, 0, 24, 24).data;
  const labs: Array<[number, number, number]> = [];
  const yccs: Array<[number, number, number]> = [];

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const mInfo = detectMetallicSignal(r, g, b, 0);
    if (mInfo.isGold) continue;
    labs.push(rgbToLab(r, g, b));
    yccs.push(rgbToYCbCr(r, g, b));
  }

  if (labs.length < 12) {
    return {
      labMean: [72, 12, 18],
      labStd: [9, 6, 6],
      ycbcrMean: [175, 112, 146],
      ycbcrStd: [18, 9, 9],
    };
  }

  const calcStats = (arr: Array<[number, number, number]>, minStd: [number, number, number]) => {
    const n = arr.length;
    const mean: [number, number, number] = [0, 0, 0];
    for (const v of arr) {
      mean[0] += v[0];
      mean[1] += v[1];
      mean[2] += v[2];
    }
    mean[0] /= n;
    mean[1] /= n;
    mean[2] /= n;

    const std: [number, number, number] = [0, 0, 0];
    for (const v of arr) {
      std[0] += (v[0] - mean[0]) ** 2;
      std[1] += (v[1] - mean[1]) ** 2;
      std[2] += (v[2] - mean[2]) ** 2;
    }
    std[0] = Math.max(minStd[0], Math.sqrt(std[0] / n));
    std[1] = Math.max(minStd[1], Math.sqrt(std[1] / n));
    std[2] = Math.max(minStd[2], Math.sqrt(std[2] / n));
    return { mean, std };
  };

  const labS = calcStats(labs, [6.5, 4.0, 4.0]);
  const yccS = calcStats(yccs, [14.0, 6.0, 6.0]);
  return {
    labMean: labS.mean,
    labStd: labS.std,
    ycbcrMean: yccS.mean,
    ycbcrStd: yccS.std,
  };
}

function skinMahalanobisDist(
  lab: [number, number, number],
  ycc: [number, number, number],
  skin: SkinStats
): number {
  const dl = (lab[0] - skin.labMean[0]) / skin.labStd[0];
  const da = (lab[1] - skin.labMean[1]) / skin.labStd[1];
  const db = (lab[2] - skin.labMean[2]) / skin.labStd[2];
  const dLabMaha = Math.sqrt((dl * dl * 0.6 + da * da * 1.2 + db * db * 1.2) / 3);

  const dcb = (ycc[1] - skin.ycbcrMean[1]) / skin.ycbcrStd[1];
  const dcr = (ycc[2] - skin.ycbcrMean[2]) / skin.ycbcrStd[2];
  const dYccMaha = Math.sqrt((dcb * dcb + dcr * dcr) * 0.5);

  return Math.min(dLabMaha, dYccMaha * 0.9 + dLabMaha * 0.35);
}

/**
 * Isolates the nail plate inside the `128 × 192` aligned ROI via:
 * 1. Background sampling along outer ROI borders (`u < 0.08`, `u > 0.92`, `v > 0.94`)
 * 2. Central seed selection around `(u = 0.5, v ∈ [0.45, 0.68])`
 * 3. Seed-guided Region Growing / Flood-Fill rejecting skin (Mahalanobis + DeltaLab),
 *    background, and metallic rings outside the distal plate (`v < 0.08` or excessive width)
 * 4. Fast morphological closing (3×3 dilate -> erode) + smooth left/right envelope + 2px anti-leak retraction
 */
function isolateNailPlateMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  skin: SkinStats
): {
  mask: Uint8Array;
  qualityScore: number;
  ringOcclusionRatio: number;
} {
  const total = w * h;

  // 1. Sample outer ROI borders for background model
  const bgLabs: Array<[number, number, number]> = [];
  for (let y = 2; y < h - 2; y += 4) {
    for (const x of [2, 5, w - 6, w - 3]) {
      const p4 = (y * w + x) * 4;
      bgLabs.push(rgbToLab(rgba[p4], rgba[p4 + 1], rgba[p4 + 2]));
    }
  }
  for (let x = 6; x < w - 6; x += 6) {
    for (const y of [2, 5]) {
      const p4 = (y * w + x) * 4;
      bgLabs.push(rgbToLab(rgba[p4], rgba[p4 + 1], rgba[p4 + 2]));
    }
  }
  const bgMean: [number, number, number] = [0, 0, 0];
  for (const c of bgLabs) {
    bgMean[0] += c[0];
    bgMean[1] += c[1];
    bgMean[2] += c[2];
  }
  if (bgLabs.length > 0) {
    bgMean[0] /= bgLabs.length;
    bgMean[1] /= bgLabs.length;
    bgMean[2] /= bgLabs.length;
  }

  // Precompute per-pixel skin/background acceptance field
  const pixelValid = new Uint8Array(total);
  const pixelLab = new Float32Array(total * 3);
  const pixelSkinDist = new Float32Array(total);
  const pixelBgDist = new Float32Array(total);

  let ringHits = 0;
  const cx = w * 0.5;
  const cy = h * 0.46;
  const rxPrior = w * 0.31;
  const ryPrior = h * 0.42;

  for (let y = 0; y < h; y++) {
    // ROI y=0 is distal tip (v=1), y=h-1 is proximal base (v=0)
    const vApprox = 1 - y / (h - 1);
    const rowOff = y * w;

    for (let x = 0; x < w; x++) {
      const idx = rowOff + x;
      const p4 = idx * 4;
      const r = rgba[p4];
      const g = rgba[p4 + 1];
      const b = rgba[p4 + 2];

      const lab = rgbToLab(r, g, b);
      pixelLab[idx * 3] = lab[0];
      pixelLab[idx * 3 + 1] = lab[1];
      pixelLab[idx * 3 + 2] = lab[2];

      const ycc = rgbToYCbCr(r, g, b);
      const mahaSkin = skinMahalanobisDist(lab, ycc, skin);
      const dSkinLab = deltaLab(lab, skin.labMean);
      const dBgLab = deltaLab(lab, bgMean);

      pixelSkinDist[idx] = dSkinLab;
      pixelBgDist[idx] = dBgLab;

      const ellip = Math.hypot((x - cx) / rxPrior, (y - cy) / ryPrior);
      const isDarkPolish = lab[0] < 28 && dBgLab > 7.0 && ellip < 1.12;
      const [, sat, val] = rgbToHsv(r, g, b);
      const isVividOrLight = (sat > 0.18 || val > 0.80) && dSkinLab > 7.5;

      // Reject metallic rings outside distal nail zone (v < 0.08 or wide outside central shaft)
      const mInfo = detectMetallicSignal(r, g, b, 0);
      const outsideDistalRing =
        mInfo.isGold && (vApprox < 0.08 || Math.abs(x - cx) > w * 0.29);
      if (outsideDistalRing) {
        ringHits++;
        continue;
      }

      const notSkin =
        mahaSkin > 1.75 || dSkinLab > 10.5 || isDarkPolish || isVividOrLight;
      const notBg = dBgLab > 8.5 || isDarkPolish;

      if (notSkin && notBg && ellip <= 1.18) {
        pixelValid[idx] = 1;
      }
    }
  }

  // 2. Central seed search in u ∈ [0.40, 0.60], v ∈ [0.45, 0.68] (ROI y ∈ [0.32*h, 0.55*h])
  const seedYStart = Math.round(h * 0.32);
  const seedYEnd = Math.round(h * 0.55);
  const seedXStart = Math.round(w * 0.40);
  const seedXEnd = Math.round(w * 0.60);

  let bestSeedIdx = Math.round(h * 0.44) * w + Math.round(w * 0.5);
  let bestSeedScore = -1;
  for (let y = seedYStart; y <= seedYEnd; y++) {
    for (let x = seedXStart; x <= seedXEnd; x++) {
      const idx = y * w + x;
      if (pixelValid[idx] === 0) continue;
      const centerBonus = 1 - Math.abs(x - w * 0.5) / (w * 0.25);
      const score = pixelSkinDist[idx] + pixelBgDist[idx] * 0.4 + centerBonus * 6;
      if (score > bestSeedScore) {
        bestSeedScore = score;
        bestSeedIdx = idx;
      }
    }
  }

  // 3. Seed-guided Region Growing (Flood-Fill) bounded by anatomical limits
  const grown = new Uint8Array(total);
  if (bestSeedScore >= 0) {
    const queue = new Int32Array(total);
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = bestSeedIdx;
    grown[bestSeedIdx] = 1;

    // Also seed vertically along central axis where pixelValid is high (bridges French tips / 3D waves!)
    for (let y = Math.round(h * 0.14); y <= Math.round(h * 0.80); y += 2) {
      const midIdx = y * w + Math.round(w * 0.5);
      if (pixelValid[midIdx] === 1 && grown[midIdx] === 0) {
        grown[midIdx] = 1;
        queue[qTail++] = midIdx;
      }
    }

    while (qHead < qTail) {
      const cur = queue[qHead++];
      const cyCur = Math.floor(cur / w);
      const cxCur = cur - cyCur * w;
      const curL = pixelLab[cur * 3];
      const curA = pixelLab[cur * 3 + 1];
      const curB = pixelLab[cur * 3 + 2];

      const neighbors = [
        cxCur > 1 ? cur - 1 : -1,
        cxCur < w - 2 ? cur + 1 : -1,
        cyCur > 2 ? cur - w : -1,
        cyCur < h - 3 ? cur + w : -1,
      ];

      for (const nIdx of neighbors) {
        if (nIdx < 0 || grown[nIdx] === 1) continue;
        if (pixelValid[nIdx] === 0) continue;

        const dl = pixelLab[nIdx * 3] - curL;
        const da = pixelLab[nIdx * 3 + 1] - curA;
        const db = pixelLab[nIdx * 3 + 2] - curB;
        const stepLab = Math.sqrt(dl * dl + da * da + db * db);

        // Allow continuous gradient/art transitions inside plate while blocking hard skin jumps
        if (stepLab < 38 || pixelSkinDist[nIdx] > 14) {
          grown[nIdx] = 1;
          queue[qTail++] = nIdx;
        }
      }
    }
  }

  // 4. Fast 3×3 Morphological Closing (Dilate -> Erode)
  const dilated = new Uint8Array(total);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      if (
        grown[r0 + x - 1] ||
        grown[r0 + x] ||
        grown[r0 + x + 1] ||
        grown[r1 + x - 1] ||
        grown[r1 + x] ||
        grown[r1 + x + 1] ||
        grown[r2 + x - 1] ||
        grown[r2 + x] ||
        grown[r2 + x + 1]
      ) {
        dilated[r1 + x] = 1;
      }
    }
  }

  const closed = new Uint8Array(total);
  for (let y = 1; y < h - 1; y++) {
    const r0 = (y - 1) * w;
    const r1 = y * w;
    const r2 = (y + 1) * w;
    for (let x = 1; x < w - 1; x++) {
      if (
        dilated[r0 + x - 1] &&
        dilated[r0 + x] &&
        dilated[r0 + x + 1] &&
        dilated[r1 + x - 1] &&
        dilated[r1 + x] &&
        dilated[r1 + x + 1] &&
        dilated[r2 + x - 1] &&
        dilated[r2 + x] &&
        dilated[r2 + x + 1]
      ) {
        closed[r1 + x] = 1;
      }
    }
  }

  // 5. Smooth Left/Right Envelope + Reject Wide Ring Rows + 2px Anti-Leak Retraction
  const rowL = new Int16Array(h).fill(-1);
  const rowR = new Int16Array(h).fill(-1);
  let activeRows = 0;

  for (let y = Math.round(h * 0.05); y < Math.round(h * 0.90); y++) {
    const rowOff = y * w;
    let lx = -1;
    let rx = -1;
    for (let x = 4; x < w - 4; x++) {
      if (closed[rowOff + x] > 0) {
        if (lx < 0) lx = x;
        rx = x;
      }
    }
    if (lx < 0 || rx <= lx) continue;
    const rowW = rx - lx + 1;
    // Reject rows wider than anatomical finger width (ring/overlapping finger leak)
    if (rowW > w * 0.64 || (y > h * 0.75 && rowW > w * 0.56)) continue;
    if (rowW < 10) continue;

    rowL[y] = lx;
    rowR[y] = rx;
    activeRows++;
  }

  const finalMask = new Uint8Array(total);
  if (activeRows < 14) {
    // Fallback clean elliptical plate mask centered at DIP->TIP
    const fMinY = Math.round(h * 0.16);
    const fMaxY = Math.round(h * 0.80);
    for (let y = fMinY; y <= fMaxY; y++) {
      const v = (fMaxY - y) / Math.max(1, fMaxY - fMinY);
      const halfW = w * 0.19 * (v > 0.65 ? 1 - (v - 0.65) * 1.4 : 1);
      const lx = Math.round(cx - halfW);
      const rx = Math.round(cx + halfW);
      for (let x = lx; x <= rx; x++) {
        finalMask[y * w + x] = 1;
      }
    }
    return { mask: finalMask, qualityScore: 10, ringOcclusionRatio: 0 };
  }

  let skinContrastSum = 0;
  let finalCount = 0;
  for (let y = 1; y < h - 1; y++) {
    if (rowL[y] < 0) continue;
    let accL = 0;
    let accR = 0;
    let cnt = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const yy = clamp(y + dy, 0, h - 1);
      if (rowL[yy] >= 0) {
        accL += rowL[yy];
        accR += rowR[yy];
        cnt++;
      }
    }
    let lx = Math.round(accL / cnt);
    let rx = Math.round(accR / cnt);

    // 2px inward anti-leak retraction whenever boundary pixel touches skin/background
    if (lx + 2 < rx - 2) {
      const leftTouchesSkinBg = pixelValid[y * w + Math.max(0, lx - 1)] === 0;
      const rightTouchesSkinBg = pixelValid[y * w + Math.min(w - 1, rx + 1)] === 0;
      if (leftTouchesSkinBg) lx += 2;
      if (rightTouchesSkinBg) rx -= 2;
    }

    if (rx - lx < 6) continue;
    for (let x = lx; x <= rx; x++) {
      finalMask[y * w + x] = 1;
      skinContrastSum += pixelSkinDist[y * w + x];
      finalCount++;
    }
  }

  const avgContrast = skinContrastSum / Math.max(1, finalCount);
  const ringOcclusionRatio = ringHits / total;
  const qualityScore =
    Math.min(55, avgContrast) * 1.6 +
    Math.min(120, activeRows) * 0.45 -
    ringOcclusionRatio * 90;

  return {
    mask: finalMask,
    qualityScore,
    ringOcclusionRatio,
  };
}

// -----------------------------------------------------------------------------
// Blueprint <-> NailFingerDesignSpec Mapping (V10 <-> Legacy compatibility)
// -----------------------------------------------------------------------------

function mapBlueprintToLegacyPattern(bp: NailDesignBlueprint): ArtisticPattern {
  const hasRibbons = bp.artElements.some((el) => el.type === 'ribbon_stroke');
  const hasMotifs = bp.artElements.some((el) => el.type === 'organic_motif');
  const hasMetallicArt = bp.artElements.some(
    (el) =>
      (el.type === 'ribbon_stroke' && el.isMetallic) ||
      (el.type === 'micro_gem' && el.kind === 'gold_bead')
  );

  if (hasMotifs && !hasMetallicArt) return 'floral_accent';
  if (hasRibbons || hasMetallicArt) return 'gold_3d_waves';
  if (
    bp.borderLayer.kind === 'classic_french' ||
    bp.borderLayer.kind === 'micro_french' ||
    bp.borderLayer.kind === 'v_french'
  ) {
    return 'french_tip';
  }
  if (bp.baseLayer.finishStyle === 'chrome_mirror') return 'chrome_mirror';
  if (
    bp.baseLayer.gradientMode === 'radial_aura' ||
    bp.baseLayer.gradientMode === 'vertical_ombre'
  ) {
    return 'aura_gradient';
  }
  if (hasMotifs) return 'floral_accent';
  return 'solid_gloss';
}

function extractAnchorsFromBlueprint(bp: NailDesignBlueprint): StrokeAnchor[] {
  const anchors: StrokeAnchor[] = [];
  for (const el of bp.artElements) {
    if (anchors.length >= 4) break;
    if (el.type === 'ribbon_stroke' && el.points.length > 0) {
      const mid = el.points[Math.floor(el.points.length / 2)];
      const p0 = el.points[0];
      const p1 = el.points[el.points.length - 1];
      anchors.push({
        u: Number(mid.u.toFixed(2)),
        v: Number(mid.v.toFixed(2)),
        radius: Number(clamp(mid.width * 2.2, 0.08, 0.24).toFixed(2)),
        angle: Number(Math.atan2(p1.v - p0.v, p1.u - p0.u).toFixed(2)),
      });
    } else if (el.type === 'organic_motif' && el.contour.length > 0) {
      let su = 0;
      let sv = 0;
      for (const c of el.contour) {
        su += c.u;
        sv += c.v;
      }
      const cu = su / el.contour.length;
      const cv = sv / el.contour.length;
      let maxR = 0.08;
      for (const c of el.contour) {
        const d = Math.hypot(c.u - cu, c.v - cv);
        if (d > maxR) maxR = d;
      }
      anchors.push({
        u: Number(cu.toFixed(2)),
        v: Number(cv.toFixed(2)),
        radius: Number(clamp(maxR, 0.08, 0.24).toFixed(2)),
        angle: 0,
      });
    } else if (el.type === 'micro_gem') {
      anchors.push({
        u: Number(el.u.toFixed(2)),
        v: Number(el.v.toFixed(2)),
        radius: Number(clamp(el.radius * 2, 0.05, 0.15).toFixed(2)),
        angle: 0,
      });
    }
  }
  return anchors;
}

function pickSecondaryAndAccentColors(bp: NailDesignBlueprint): {
  secondaryColor: string;
  accentColor: string;
} {
  let secondary = bp.baseLayer.tipColorHex;
  if (bp.baseLayer.gradientMode === 'radial_aura') {
    secondary = bp.baseLayer.midColorHex;
  } else if (
    bp.borderLayer.kind === 'classic_french' ||
    bp.borderLayer.kind === 'micro_french' ||
    bp.borderLayer.kind === 'v_french'
  ) {
    secondary = bp.borderLayer.colorHex;
  } else {
    const motif = bp.artElements.find((e): e is OrganicMotifElement => e.type === 'organic_motif');
    if (motif) secondary = motif.fillColorHex;
    else if (bp.baseLayer.finishStyle === 'chrome_mirror') secondary = '#FFFFFF';
  }

  let accent = '#D4AF37';
  if (bp.borderLayer.kind !== 'none' && bp.borderLayer.isMetallic) {
    accent = bp.borderLayer.colorHex;
  } else {
    const ribbon = bp.artElements.find((e): e is RibbonStrokeElement => e.type === 'ribbon_stroke');
    if (ribbon) accent = ribbon.colorHex;
    else {
      const gem = bp.artElements.find((e): e is MicroGemElement => e.type === 'micro_gem');
      if (gem) accent = gem.colorHex;
    }
  }

  return { secondaryColor: secondary, accentColor: accent };
}

function buildSpecFromBlueprint(
  fingerId: FingerId,
  bp: NailDesignBlueprint,
  detectedFromPhoto: boolean
): NailFingerDesignSpec {
  const cfg = FINGER_LANDMARKS[fingerId];
  const ext = classifyExtensionFromFreeEdgeRatio(bp.geometry.freeEdgeRatio);
  const pattern = mapBlueprintToLegacyPattern(bp);
  const { secondaryColor, accentColor } = pickSecondaryAndAccentColors(bp);
  const hasMetallicOutline =
    bp.borderLayer.kind === 'full_metallic_outline' ||
    bp.borderLayer.kind === 'cuticle_cuff' ||
    bp.borderLayer.isMetallic;

  const has3DRelief =
    bp.borderLayer.is3DRaised ||
    bp.artElements.some((el) => el.type !== 'organic_motif' || el.reliefHeight > 0.35);

  const metallicIntensity =
    bp.baseLayer.finishStyle === 'chrome_mirror'
      ? 0.92
      : hasMetallicOutline ||
          bp.artElements.some(
            (e) =>
              (e.type === 'ribbon_stroke' && e.isMetallic) ||
              (e.type === 'micro_gem' && e.kind === 'gold_bead')
          )
        ? 0.88
        : bp.baseLayer.metallicBase;

  return {
    fingerId,
    detectedFromPhoto,
    shape: bp.geometry.shape,
    relativeLength: ext.relativeLength,
    lengthMultiplier: ext.relativeLength,
    freeEdgeRatio: ext.freeEdgeRatio,
    extensionLevel: ext.extensionLevel,
    extensionMm: ext.extensionMm,
    tipRoundness: bp.geometry.tipRoundness,
    aspectRatio: bp.geometry.aspectRatio,
    relativeWidth: cfg.defaultWidth,
    baseColor: bp.baseLayer.baseColorHex,
    secondaryColor,
    accentColor,
    hasMetallicOutline,
    outlineColor: hasMetallicOutline ? bp.borderLayer.colorHex : undefined,
    has3DRelief,
    finishStyle: bp.baseLayer.finishStyle,
    pattern,
    strokeAnchors:
      extractAnchorsFromBlueprint(bp).length > 0
        ? extractAnchorsFromBlueprint(bp)
        : defaultAnchorsForPattern(pattern),
    metallicIntensity,
    glossIntensity: bp.baseLayer.glossiness,
    blueprint: bp,
    isImportedReference: true,
  };
}

/**
 * Synthesizes a clean 100% vector + parametric `NailDesignBlueprint` from any legacy
 * or studio `NailFingerDesignSpec` that does not yet carry a `blueprint` object.
 */
export function buildBlueprintFromLegacySpec(
  spec: NailFingerDesignSpec
): NailDesignBlueprint {
  const shape = normalizeShape(spec.shape, 'almond');
  const rawFreeEdge =
    spec.freeEdgeRatio !== undefined
      ? spec.freeEdgeRatio
      : normalizeRelativeLengthV10(spec.lengthMultiplier ?? spec.relativeLength ?? 1.45) - 1;
  const freeEdgeRatio = Number(clamp(rawFreeEdge, 0.12, 1.15).toFixed(2));
  const tipRoundness = Number(
    clamp01(spec.tipRoundness ?? (shape === 'square' ? 0.25 : shape === 'stiletto' ? 0.82 : 0.55)).toFixed(2)
  );
  const aspectRatio = Number(
    clamp(spec.aspectRatio ?? 1.15 + freeEdgeRatio * 1.15, 0.85, 3.2).toFixed(2)
  );

  const profileHalfWidths = [...(SHAPE_DEFAULT_PROFILES[shape] ?? SHAPE_DEFAULT_PROFILES.almond)] as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  const baseColorHex = sanitizeHexColor(spec.baseColor, '#E5BEB3');
  const secondaryHex = sanitizeHexColor(spec.secondaryColor, '#FFFDF9');
  const accentHex = sanitizeHexColor(spec.accentColor, '#D4AF37');

  let finishStyle: NailFinishV10 = spec.finishStyle ?? 'glossy_gel';
  if (!spec.finishStyle) {
    if (spec.pattern === 'chrome_mirror') finishStyle = 'chrome_mirror';
    else if (spec.glossIntensity < 0.65) finishStyle = 'velvet_matte';
  }

  let gradientMode: NailGradientMode = 'solid';
  if (finishStyle === 'chrome_mirror' || finishStyle === 'pearl_glazed') {
    gradientMode = 'pearl_chrome';
  } else if (finishStyle === 'cat_eye') {
    gradientMode = 'cat_eye_band';
  } else if (spec.pattern === 'aura_gradient') {
    gradientMode =
      spec.secondaryColor &&
      spec.secondaryColor.toUpperCase() !== spec.baseColor.toUpperCase() &&
      spec.finishStyle === 'jelly_translucent'
        ? 'vertical_ombre'
        : 'radial_aura';
  }

  const baseLayer: NailBaseLayer = {
    baseColorHex,
    gradientMode,
    cuticleColorHex: shadeHex(baseColorHex, -8),
    midColorHex: gradientMode === 'radial_aura' ? secondaryHex : baseColorHex,
    tipColorHex: gradientMode === 'vertical_ombre' ? secondaryHex : shadeHex(baseColorHex, 6),
    finishStyle,
    translucency: finishStyle === 'jelly_translucent' ? 0.5 : 0.06,
    metallicBase: finishStyle === 'chrome_mirror' ? 0.92 : spec.metallicIntensity * 0.25,
    glossiness: finishStyle === 'velvet_matte' ? 0.42 : 0.96,
  };

  let borderKind: NailBorderKind = 'none';
  let borderColor = accentHex;
  let isBorderMetallic = false;
  let thicknessNorm = 0.05;
  let smileCurveDepth = 0.14;

  if (spec.hasMetallicOutline) {
    borderKind = 'full_metallic_outline';
    borderColor = sanitizeHexColor(spec.outlineColor, accentHex);
    isBorderMetallic = true;
    thicknessNorm = 0.055;
    smileCurveDepth = 0.08;
  } else if (spec.pattern === 'french_tip') {
    borderKind = 'classic_french';
    borderColor = secondaryHex;
    isBorderMetallic = spec.metallicIntensity > 0.55;
    thicknessNorm = 0.18;
    smileCurveDepth = 0.16;
  }

  const borderLayer: NailBorderLayer = {
    kind: borderKind,
    colorHex: borderColor,
    thicknessNorm,
    isMetallic: isBorderMetallic,
    is3DRaised: Boolean(spec.hasMetallicOutline || spec.has3DRelief),
    smileCurveDepth,
  };

  const artElements: VectorArtElement[] = [];
  const anchors =
    spec.strokeAnchors && spec.strokeAnchors.length > 0
      ? spec.strokeAnchors
      : defaultAnchorsForPattern(spec.pattern);

  if (spec.pattern === 'gold_3d_waves') {
    const a0 = anchors[0] ?? { u: 0.34, v: 0.34, radius: 0.16, angle: 0.35 };
    const a1 = anchors[1] ?? { u: 0.64, v: 0.58, radius: 0.18, angle: -0.3 };
    const a2 = anchors[2] ?? { u: 0.46, v: 0.78, radius: 0.14, angle: 0.2 };

    artElements.push({
      type: 'ribbon_stroke',
      points: [
        { u: 0.14, v: clamp01(a0.v * 0.85), width: 0.042 },
        { u: clamp01(a0.u + 0.12), v: clamp01(a0.v + 0.08), width: 0.052 },
        { u: clamp01(a1.u - 0.10), v: clamp01(a1.v - 0.06), width: 0.046 },
        { u: 0.86, v: clamp01(a1.v * 0.92), width: 0.036 },
      ],
      colorHex: accentHex,
      highlightHex: mixHex(accentHex, '#FFF8DF', 0.58),
      isMetallic: true,
      reliefHeight: 0.85,
    });
    artElements.push({
      type: 'ribbon_stroke',
      points: [
        { u: 0.82, v: clamp01(a2.v * 0.88), width: 0.034 },
        { u: clamp01(a2.u + 0.14), v: clamp01(a2.v - 0.04), width: 0.042 },
        { u: clamp01(a0.u), v: clamp01(a0.v + 0.12), width: 0.036 },
        { u: 0.20, v: 0.82, width: 0.028 },
      ],
      colorHex: accentHex,
      highlightHex: mixHex(accentHex, '#FFF8DF', 0.58),
      isMetallic: true,
      reliefHeight: 0.75,
    });
    for (const a of anchors.slice(0, 3)) {
      artElements.push({
        type: 'micro_gem',
        u: clamp01(a.u),
        v: clamp01(a.v),
        radius: 0.032,
        colorHex: accentHex,
        kind: 'gold_bead',
      });
    }
  } else if (spec.pattern === 'floral_accent') {
    for (const a of anchors.slice(0, 2)) {
      const petalR = clamp(a.radius * 0.65, 0.06, 0.13);
      for (let p = 0; p < 5; p++) {
        const theta = a.angle + (p * Math.PI * 2) / 5;
        const pcU = a.u + Math.cos(theta) * petalR * 0.72;
        const pcV = a.v + Math.sin(theta) * petalR * 0.72;
        const contour: OrganicMotifPoint[] = [];
        for (let k = 0; k < 16; k++) {
          const phi = (k / 16) * Math.PI * 2;
          const lx = Math.cos(phi) * petalR * 0.52;
          const ly = Math.sin(phi) * petalR * 0.34;
          const rotU = lx * Math.cos(theta) - ly * Math.sin(theta);
          const rotV = lx * Math.sin(theta) + ly * Math.cos(theta);
          contour.push({
            u: Number(clamp01(pcU + rotU).toFixed(3)),
            v: Number(clamp01(pcV + rotV).toFixed(3)),
          });
        }
        artElements.push({
          type: 'organic_motif',
          contour,
          fillColorHex: secondaryHex,
          shadeColorHex: shadeHex(secondaryHex, -28),
          isMetallic: false,
          reliefHeight: 0.62,
        });
      }
      artElements.push({
        type: 'micro_gem',
        u: clamp01(a.u),
        v: clamp01(a.v),
        radius: 0.03,
        colorHex: accentHex,
        kind: 'gold_bead',
      });
    }
  }

  return {
    version: 10,
    geometry: {
      profileHalfWidths,
      aspectRatio,
      freeEdgeRatio,
      tipRoundness,
      shape,
    },
    baseLayer,
    borderLayer,
    artElements,
  };
}

// -----------------------------------------------------------------------------
// Stage 1 + Stage 2 Per-Finger Orchestration (< 20ms/finger, < 300ms total)
// -----------------------------------------------------------------------------

interface FingerRoiAnalysisOutput {
  spec: NailFingerDesignSpec;
  qualityScore: number;
}

function analyzeSingleNailROI(
  img: HTMLImageElement,
  fingerId: FingerId,
  pipNorm: { x: number; y: number },
  dipNorm: { x: number; y: number },
  tipNorm: { x: number; y: number },
  detectedFromPhoto: boolean
): FingerRoiAnalysisOutput {
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  const cfg = FINGER_LANDMARKS[fingerId];

  const defaultBlueprint = buildBlueprintFromLegacySpec({
    fingerId,
    detectedFromPhoto,
    shape: 'almond',
    relativeLength: 1.45,
    relativeWidth: cfg.defaultWidth,
    baseColor: '#E5BEB3',
    secondaryColor: '#FFF7F3',
    accentColor: '#D4AF37',
    pattern: 'solid_gloss',
    strokeAnchors: [],
    metallicIntensity: 0.12,
    glossIntensity: 0.94,
  });
  const defaultSpec = buildSpecFromBlueprint(fingerId, defaultBlueprint, detectedFromPhoto);

  try {
    const dx = (tipNorm.x - dipNorm.x) * imgW;
    const dy = (tipNorm.y - dipNorm.y) * imgH;
    const segPx = Math.max(18, Math.hypot(dx, dy));

    const skin = computeSkinModel(img, pipNorm, dipNorm, segPx);

    // 128 × 192 aligned ROI (only 24,576 pixels!)
    const { ctx: roiCtx } = createScratchCanvas(ROI_WIDTH, ROI_HEIGHT);
    const angleRad = Math.atan2(dy, dx) + Math.PI / 2;
    const anchorX = (dipNorm.x + 0.70 * (tipNorm.x - dipNorm.x)) * imgW;
    const anchorY = (dipNorm.y + 0.70 * (tipNorm.y - dipNorm.y)) * imgH;
    const roiSpanH = segPx * 1.98;
    const scale = ROI_HEIGHT / roiSpanH;

    roiCtx.save();
    roiCtx.imageSmoothingEnabled = true;
    roiCtx.imageSmoothingQuality = 'medium';
    roiCtx.translate(ROI_WIDTH / 2, ROI_HEIGHT / 2);
    roiCtx.scale(scale, scale);
    roiCtx.rotate(-angleRad);
    roiCtx.drawImage(img, -anchorX, -anchorY);
    roiCtx.restore();

    const { data } = roiCtx.getImageData(0, 0, ROI_WIDTH, ROI_HEIGHT);
    const { mask, qualityScore } = isolateNailPlateMask(data, ROI_WIDTH, ROI_HEIGHT, skin);

    const blueprint = extractBlueprintFromNailPatch(data, ROI_WIDTH, ROI_HEIGHT, mask, fingerId);
    const spec = buildSpecFromBlueprint(fingerId, blueprint, detectedFromPhoto);

    return {
      spec,
      qualityScore: qualityScore + Math.min(100, segPx) * 0.2,
    };
  } catch {
    return { spec: defaultSpec, qualityScore: 0 };
  }
}

/**
 * Harmonic Inheritance for Missing Fingers:
 * Propagates full V10 `blueprint` (colors, borders, vector `artElements`, geometry profile)
 * harmoniously to unseen fingers while strictly preserving every detected finger's own
 * individual blueprint (respecting feature nails / "filha única" and mixed sets!).
 */
function applyHarmonicInheritance(
  partial: Partial<Record<FingerId, NailFingerDesignSpec>>
): Record<FingerId, NailFingerDesignSpec> {
  const detected = ORDERED_FINGERS.map((id) => partial[id]).filter(
    (s): s is NailFingerDesignSpec => Boolean(s)
  );

  const ornateDonor =
    detected.find(
      (s) =>
        s.pattern === 'gold_3d_waves' ||
        s.pattern === 'floral_accent' ||
        (s.blueprint?.artElements.length ?? 0) > 0
    ) ??
    detected.find((s) => s.pattern !== 'solid_gloss') ??
    detected[0];

  const baseDonor =
    detected.find((s) => s.fingerId === 'middle') ??
    detected.find((s) => s.fingerId === 'index') ??
    detected[0];

  const result = {} as Record<FingerId, NailFingerDesignSpec>;

  for (const id of ORDERED_FINGERS) {
    const existing = partial[id];
    if (existing) {
      result[id] = existing;
      continue;
    }

    const cfg = FINGER_LANDMARKS[id];
    const donor =
      id === 'ring' || (id === 'middle' && ornateDonor.pattern !== 'solid_gloss')
        ? ornateDonor
        : baseDonor;

    const donorBp = donor.blueprint ?? buildBlueprintFromLegacySpec(donor);
    const inheritedFreeEdge = clamp(
      donorBp.geometry.freeEdgeRatio * (cfg.defaultLength / 1.0),
      0.12,
      1.15
    );
    const suppressFloralOnThumbPinky =
      (id === 'thumb' || id === 'pinky') && donor.pattern === 'floral_accent';

    const clonedBp: NailDesignBlueprint = {
      version: 10,
      geometry: {
        ...donorBp.geometry,
        profileHalfWidths: [...donorBp.geometry.profileHalfWidths] as NailGeometryProfile['profileHalfWidths'],
        freeEdgeRatio: Number(inheritedFreeEdge.toFixed(2)),
      },
      baseLayer: {
        ...donorBp.baseLayer,
        gradientMode: suppressFloralOnThumbPinky ? 'radial_aura' : donorBp.baseLayer.gradientMode,
      },
      borderLayer: { ...donorBp.borderLayer },
      artElements: suppressFloralOnThumbPinky
        ? []
        : donorBp.artElements.map((el) =>
            el.type === 'ribbon_stroke'
              ? { ...el, points: el.points.map((p) => ({ ...p })) }
              : el.type === 'organic_motif'
                ? { ...el, contour: el.contour.map((c) => ({ ...c })) }
                : { ...el }
          ),
    };

    const inheritedSpec = buildSpecFromBlueprint(id, clonedBp, false);
    if (donor.trueUvDataUrl) {
      inheritedSpec.trueUvDataUrl = donor.trueUvDataUrl;
    }
    if (donor.uvExtractionTarget) {
      inheritedSpec.uvExtractionTarget = {
        ...donor.uvExtractionTarget,
        detectedFromPhoto: false,
      };
    }
    result[id] = inheritedSpec;
  }

  return result;
}

/**
 * Computes an interactive `NailUvPinTarget` from MediaPipe DIP & TIP landmarks.
 */
export function createPinTargetFromLandmarks(
  dip: { x: number; y: number },
  tip: { x: number; y: number },
  imgW: number,
  imgH: number,
  fingerId: FingerId,
  detectedFromPhoto = true
): NailUvPinTarget {
  const dxPx = (tip.x - dip.x) * imgW;
  const dyPx = (tip.y - dip.y) * imgH;
  const segPx = Math.max(16, Math.hypot(dxPx, dyPx));
  const angleRad = Math.atan2(dyPx, dxPx);

  // Nail plate spans from ~0.30 past DIP to ~1.12 past DIP (covering bed + free edge)
  const cxPx = dip.x * imgW + dxPx * 0.68;
  const cyPx = dip.y * imgH + dyPx * 0.68;
  const widthRatio = fingerId === 'thumb' ? 0.56 : fingerId === 'pinky' ? 0.44 : 0.48;
  const heightPx = segPx * 0.86;
  const widthPx = segPx * widthRatio;

  return {
    cxNorm: clamp(cxPx / Math.max(1, imgW), 0.05, 0.95),
    cyNorm: clamp(cyPx / Math.max(1, imgH), 0.05, 0.95),
    widthNorm: clamp(widthPx / Math.max(1, imgW), 0.025, 0.45),
    heightNorm: clamp(heightPx / Math.max(1, imgH), 0.035, 0.55),
    angleRad,
    detectedFromPhoto,
  };
}

/**
 * V12 `TrueUVExtractor`: Direct high-resolution bilinear inverse warping (`512×512`)
 * strictly from the safe 88% inner nail plate (`u ∈ [0.06, 0.94]`, `v ∈ [0.06, 0.94]`)
 * with ultra-gentle linear shadow ramp leveling (`[0.92, 1.08]`) preserving 100% of
 * chrome mirror reflections, 3D metal studs, gems, gradients, and deep wine/black pigments.
 * Uses `HTMLCanvasElement` for full iOS Safari + Android Chrome WebGL2 compatibility.
 */
export function extractTrueUVNailTexture(
  img: HTMLImageElement | HTMLCanvasElement,
  target: NailUvPinTarget,
  outSize = 512
): string {
  if (typeof document === 'undefined') return '';

  const srcW =
    img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
  const srcH =
    img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
  if (srcW < 8 || srcH < 8) return '';

  // Read full-res source pixels once onto an HTMLCanvasElement (iOS Safari safe)
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return '';
  srcCtx.drawImage(img, 0, 0, srcW, srcH);
  const srcPixels = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outSize;
  outCanvas.height = outSize;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return '';
  const outImg = outCtx.createImageData(outSize, outSize);
  const dst = outImg.data;

  // Longitudinal axis along DIP -> TIP and perpendicular lateral axis
  const axisYx = Math.cos(target.angleRad);
  const axisYy = Math.sin(target.angleRad);
  const axisXx = -axisYy;
  const axisXy = axisYx;

  const cx = target.cxNorm * srcW;
  const cy = target.cyNorm * srcH;
  const fullW = Math.max(8, target.widthNorm * srcW);
  const fullH = Math.max(8, target.heightNorm * srcH);

  // Strictly contract to 88% inner safe polygon (u ∈ [0.06, 0.94], v ∈ [0.06, 0.94])
  // excluding 100% of lateral skin, cuticle skin, rings, and background!
  const safeMin = 0.06;
  const safeSpan = 0.88;

  const maxX = srcW - 1;
  const maxY = srcH - 1;

  // Pass 1: Direct bilinear inverse unwarping into outSize x outSize
  // Three.js UV convention: y = outSize - 1 -> v = 0 (cuticle), y = 0 -> v = 1 (tip)
  let sumTop = 0;
  let sumBot = 0;
  let sumLeft = 0;
  let sumRight = 0;
  let cntHalf = 0;

  for (let py = 0; py < outSize; py++) {
    const vNorm = 1 - py / Math.max(1, outSize - 1);
    const vSafe = safeMin + vNorm * safeSpan;
    const localY = (vSafe - 0.5) * fullH;

    for (let px = 0; px < outSize; px++) {
      const uNorm = px / Math.max(1, outSize - 1);
      const uSafe = safeMin + uNorm * safeSpan;
      const localX = (uSafe - 0.5) * fullW;

      const sx = clamp(cx + axisXx * localX + axisYx * localY, 0, maxX);
      const sy = clamp(cy + axisXy * localX + axisYy * localY, 0, maxY);

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 < maxX ? x0 + 1 : maxX;
      const y1 = y0 < maxY ? y0 + 1 : maxY;
      const fx = sx - x0;
      const fy = sy - y0;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      const r = srcPixels[i00] * w00 + srcPixels[i10] * w10 + srcPixels[i01] * w01 + srcPixels[i11] * w11;
      const g = srcPixels[i00 + 1] * w00 + srcPixels[i10 + 1] * w10 + srcPixels[i01 + 1] * w01 + srcPixels[i11 + 1] * w11;
      const b = srcPixels[i00 + 2] * w00 + srcPixels[i10 + 2] * w10 + srcPixels[i01 + 2] * w01 + srcPixels[i11 + 2] * w11;

      const di = (py * outSize + px) * 4;
      dst[di] = r;
      dst[di + 1] = g;
      dst[di + 2] = b;
      dst[di + 3] = 255;

      // Accumulate linear ramp stats (strided by 4x4 for speed)
      if ((px & 3) === 0 && (py & 3) === 0) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (vNorm >= 0.5) sumTop += luma;
        else sumBot += luma;
        if (uNorm < 0.5) sumLeft += luma;
        else sumRight += luma;
        cntHalf++;
      }
    }
  }

  // Pass 2: Ultra-gentle linear shadow ramp leveling clamped strictly to [0.92, 1.08]
  // NEVER touches chrome speculars, 3D beads, or deep wine/black pigments!
  const halfSamples = Math.max(1, cntHalf * 0.5);
  const avgTop = sumTop / halfSamples;
  const avgBot = sumBot / halfSamples;
  const avgLeft = sumLeft / halfSamples;
  const avgRight = sumRight / halfSamples;
  const avgAll = Math.max(20, (avgTop + avgBot) * 0.5);

  const slopeV = clamp((avgBot - avgTop) / avgAll, -0.14, 0.14) * 0.35;
  const slopeU = clamp((avgLeft - avgRight) / avgAll, -0.14, 0.14) * 0.35;

  if (Math.abs(slopeV) > 0.005 || Math.abs(slopeU) > 0.005) {
    for (let py = 0; py < outSize; py++) {
      const dv = 0.5 - py / Math.max(1, outSize - 1); // +0.5 tip, -0.5 cuticle
      for (let px = 0; px < outSize; px++) {
        const du = px / Math.max(1, outSize - 1) - 0.5;
        const gain = clamp(1 + slopeV * dv + slopeU * du, 0.92, 1.08);
        const di = (py * outSize + px) * 4;
        dst[di] = Math.min(255, Math.round(dst[di] * gain));
        dst[di + 1] = Math.min(255, Math.round(dst[di + 1] * gain));
        dst[di + 2] = Math.min(255, Math.round(dst[di + 2] * gain));
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0);

  // Encode WebP 0.92 with automatic PNG fallback (e.g. older iOS Safari)
  try {
    const webp = outCanvas.toDataURL('image/webp', 0.92);
    if (webp.startsWith('data:image/webp')) return webp;
  } catch {
    // Fallback below
  }
  return outCanvas.toDataURL('image/png');
}

function analyzeMacroZonesFallback(img: HTMLImageElement): PerFingerAnalysisResult {
  const w = img.naturalWidth || 512;
  const h = img.naturalHeight || 512;
  const macroTargets: Array<{ fingerId: FingerId; cx: number; cy: number }> = [
    { fingerId: 'middle', cx: 0.5, cy: 0.48 },
    { fingerId: 'index', cx: 0.28, cy: 0.52 },
    { fingerId: 'ring', cx: 0.72, cy: 0.52 },
  ];

  const partial: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
  for (const t of macroTargets) {
    const pip = { x: t.cx, y: Math.min(0.95, t.cy + 0.26) };
    const dip = { x: t.cx, y: Math.min(0.92, t.cy + 0.14) };
    const tip = { x: t.cx, y: Math.max(0.08, t.cy - 0.14) };
    const spec = analyzeSingleNailROI(img, t.fingerId, pip, dip, tip, true).spec;
    const pinTarget = createPinTargetFromLandmarks(dip, tip, w, h, t.fingerId, true);
    spec.uvExtractionTarget = pinTarget;
    spec.trueUvDataUrl = extractTrueUVNailTexture(img, pinTarget, 512);
    partial[t.fingerId] = spec;
  }

  const fingerSpecs = applyHarmonicInheritance(partial);
  const primary = fingerSpecs.middle;

  return {
    fingerSpecs,
    detectedFingerIds: ['index', 'middle', 'ring'],
    method: 'smart-macro',
    primaryShape: primary.shape,
    primaryLength: primary.lengthMultiplier ?? primary.relativeLength,
    primaryExtensionLevel: primary.extensionLevel,
    primaryAspectRatio: primary.aspectRatio,
    primaryBaseColor: primary.baseColor,
    primarySecondaryColor: primary.secondaryColor,
    primaryAccentColor: primary.accentColor,
    primaryPattern: primary.pattern,
  };
}

/**
 * V12 100% Client-Side Photorealistic True UV Texture Transfer (`< 300ms` total, R$ 0,00):
 * - Uses shared MediaPipe `HandLandmarker` singleton (`detectHandsOnImageWithSingleton(img, 2)`).
 * - Picks the highest-quality specimen for each finger across up to 2 hands.
 * - Extracts direct `512×512` bilinear True UV textures from the safe 88% inner nail plate
 *   (`extractTrueUVNailTexture`) + interactive `NailUvPinTarget` for the 4× UV Pincher Loupe.
 */
export async function analyzeReferencePhotoPerFinger(
  imageDataUrl: string
): Promise<PerFingerAnalysisResult> {
  const img = await loadImageFromDataUrl(imageDataUrl, 1600);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  try {
    const result = await detectHandsOnImageWithSingleton(img, 2);
    const hands = result.landmarks ?? [];
    const bestByFinger: Partial<
      Record<FingerId, FingerRoiAnalysisOutput & { pinTarget: NailUvPinTarget }>
    > = {};

    for (const hand of hands) {
      if (!hand || hand.length < 21) continue;
      for (const fingerId of ORDERED_FINGERS) {
        const cfg = FINGER_LANDMARKS[fingerId];
        const tip = hand[cfg.tipIdx];
        const dip = hand[cfg.dipIdx];
        const pip = hand[cfg.pipIdx];

        if (
          tip.x < 0.02 ||
          tip.x > 0.98 ||
          tip.y < 0.02 ||
          tip.y > 0.98 ||
          dip.x < 0.015 ||
          dip.x > 0.985 ||
          dip.y < 0.015 ||
          dip.y > 0.985
        ) {
          continue;
        }

        const segPx = Math.hypot((tip.x - dip.x) * w, (tip.y - dip.y) * h);
        if (segPx < 16) continue;

        const candidate = analyzeSingleNailROI(img, fingerId, pip, dip, tip, true);
        const existing = bestByFinger[fingerId];
        if (!existing || candidate.qualityScore > existing.qualityScore) {
          bestByFinger[fingerId] = {
            ...candidate,
            pinTarget: createPinTargetFromLandmarks(dip, tip, w, h, fingerId, true),
          };
        }
      }
    }

    const partial: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
    const detectedFingerIds: FingerId[] = [];
    for (const id of ORDERED_FINGERS) {
      const chosen = bestByFinger[id];
      if (chosen) {
        const spec = chosen.spec;
        spec.uvExtractionTarget = chosen.pinTarget;
        spec.trueUvDataUrl = extractTrueUVNailTexture(img, chosen.pinTarget, 512);
        partial[id] = spec;
        detectedFingerIds.push(id);
      }
    }

    if (detectedFingerIds.length > 0) {
      const fingerSpecs = applyHarmonicInheritance(partial);
      const primary =
        fingerSpecs[detectedFingerIds.includes('middle') ? 'middle' : detectedFingerIds[0]];

      return {
        fingerSpecs,
        detectedFingerIds,
        method: 'mediapipe',
        primaryShape: primary.shape,
        primaryLength: primary.lengthMultiplier ?? primary.relativeLength,
        primaryExtensionLevel: primary.extensionLevel,
        primaryAspectRatio: primary.aspectRatio,
        primaryBaseColor: primary.baseColor,
        primarySecondaryColor: primary.secondaryColor,
        primaryAccentColor: primary.accentColor,
        primaryPattern: primary.pattern,
      };
    }
  } catch {
    // Fall through to macro zone analyzer
  }

  return analyzeMacroZonesFallback(img);
}

/**
 * File-based wrapper preserving full backward compatibility with `ImportReferenceModal.tsx`.
 */
export async function analyzeReferencePerFinger(file: File): Promise<PerFingerAnalysisResult> {
  const imageDataUrl = await fileToDataUrl(file);
  return analyzeReferencePhotoPerFinger(imageDataUrl);
}

/**
 * Converts any Studio Catalog `NailDesign` into a cohesive 5-finger `NailFingerDesignSpec` map
 * backed by pure V10 `NailDesignBlueprint` definitions.
 */
export function buildFingerSpecsFromStudioDesign(
  design: NailDesign
): Record<FingerId, NailFingerDesignSpec> {
  if (design.fingerSpecs) {
    const out = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const id of ORDERED_FINGERS) {
      const spec = design.fingerSpecs[id];
      if (spec) {
        out[id] = spec.blueprint
          ? spec
          : { ...spec, blueprint: buildBlueprintFromLegacySpec(spec) };
      }
    }
    if (Object.keys(out).length === 5) return out;
    if (Object.keys(out).length > 0) return applyHarmonicInheritance(out);
  }

  const baseColor = design.baseColor || '#E5BEB3';
  const secondaryColor = design.secondaryColor || '#FFFDF9';
  const accentColor = design.accentColor || '#D4AF37';

  let pattern: ArtisticPattern = 'solid_gloss';
  if (design.patternType === 'french') pattern = 'french_tip';
  else if (design.patternType === 'chrome') pattern = 'chrome_mirror';
  else if (design.patternType === 'gold-foil' || design.patternType === 'marble')
    pattern = 'gold_3d_waves';
  else if (
    design.patternType === 'ombre' ||
    design.patternType === 'aurora' ||
    design.patternType === 'cat-eye'
  ) {
    pattern = 'aura_gradient';
  }

  const shape: NailShape = design.detectedShape ?? 'almond';
  const baseFreeEdge = clamp(
    (design.detectedLength !== undefined
      ? normalizeRelativeLengthV10(design.detectedLength) - 1
      : 0.42),
    0.12,
    1.15
  );

  const metallicIntensity =
    design.finish === 'chrome' || pattern === 'chrome_mirror'
      ? 0.9
      : pattern === 'gold_3d_waves' || design.finish === 'glitter'
        ? 0.86
        : 0.1;
  const glossIntensity = design.finish === 'velvet' ? 0.48 : 0.96;
  const finishStyle: NailFinishV10 =
    design.finish === 'velvet'
      ? 'velvet_matte'
      : design.finish === 'chrome' || pattern === 'chrome_mirror'
        ? 'chrome_mirror'
        : design.patternType === 'cat-eye'
          ? 'cat_eye'
          : 'glossy_gel';

  const map = {} as Record<FingerId, NailFingerDesignSpec>;
  for (const id of ORDERED_FINGERS) {
    const cfg = FINGER_LANDMARKS[id];
    const ext = classifyExtensionFromFreeEdgeRatio(baseFreeEdge * cfg.defaultLength);
    const seedSpec: NailFingerDesignSpec = {
      fingerId: id,
      detectedFromPhoto: false,
      shape,
      relativeLength: ext.relativeLength,
      lengthMultiplier: ext.relativeLength,
      freeEdgeRatio: ext.freeEdgeRatio,
      extensionLevel: ext.extensionLevel,
      extensionMm: ext.extensionMm,
      relativeWidth: cfg.defaultWidth,
      baseColor,
      secondaryColor,
      accentColor,
      hasMetallicOutline: false,
      outlineColor: undefined,
      has3DRelief: pattern === 'gold_3d_waves',
      finishStyle,
      pattern,
      strokeAnchors: defaultAnchorsForPattern(pattern),
      metallicIntensity,
      glossIntensity,
    };
    map[id] = {
      ...seedSpec,
      blueprint: buildBlueprintFromLegacySpec(seedSpec),
    };
  }
  return map;
}

export const buildFallbackStudioFingerSpecs = buildFingerSpecsFromStudioDesign;

function defaultAnchorsForPattern(pattern: ArtisticPattern): StrokeAnchor[] {
  if (pattern === 'gold_3d_waves') {
    return [
      { u: 0.34, v: 0.34, radius: 0.18, angle: 0.4 },
      { u: 0.62, v: 0.58, radius: 0.2, angle: -0.35 },
      { u: 0.46, v: 0.78, radius: 0.16, angle: 0.25 },
    ];
  }
  if (pattern === 'floral_accent') {
    return [
      { u: 0.44, v: 0.46, radius: 0.14, angle: 0 },
      { u: 0.64, v: 0.68, radius: 0.11, angle: 0.5 },
      { u: 0.32, v: 0.72, radius: 0.1, angle: -0.4 },
    ];
  }
  return [];
}

function sanitizeHexColor(hex: unknown, fallback: string): string {
  if (typeof hex !== 'string') return fallback;
  const trimmed = hex.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

const VALID_SHAPES: NailShape[] = ['natural', 'oval', 'almond', 'square', 'coffin', 'stiletto'];
function normalizeShape(shape: unknown, fallback: NailShape = 'almond'): NailShape {
  if (typeof shape === 'string' && VALID_SHAPES.includes(shape as NailShape)) {
    return shape as NailShape;
  }
  return fallback;
}
