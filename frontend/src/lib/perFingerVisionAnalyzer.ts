import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type {
  ArtisticPattern,
  FingerId,
  NailDesign,
  NailExtensionLevel,
  NailFinishV9,
  NailFingerDesignSpec as BaseNailFingerDesignSpec,
  NailShape,
  StrokeAnchor,
} from '../types/nail';

export type { NailExtensionLevel, NailFinishV9 };

export type NailFingerDesignSpec = BaseNailFingerDesignSpec & {
  extensionLevel?: NailExtensionLevel;
  extensionMm?: number;
  tipRoundness?: number;
  aspectRatio?: number;
  lengthMultiplier?: number;
  hasMetallicOutline?: boolean;
  outlineColor?: string;
  has3DRelief?: boolean;
  reliefDescription?: string;
  artDescription?: string;
  finishStyle?: NailFinishV9;
  uvPatchDataUrl?: string;
  normalMapDataUrl?: string;
  displacementMapDataUrl?: string;
  metalnessMapDataUrl?: string;
  roughnessMapDataUrl?: string;
  isImportedReference?: boolean;
};

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

const VALID_SHAPES: NailShape[] = ['natural', 'oval', 'almond', 'square', 'coffin', 'stiletto'];
const VALID_PATTERNS: ArtisticPattern[] = [
  'solid_gloss',
  'chrome_mirror',
  'gold_3d_waves',
  'aura_gradient',
  'french_tip',
  'floral_accent',
];

let cachedLandmarker: HandLandmarker | null = null;
let landmarkerPromise: Promise<HandLandmarker | null> | null = null;

async function getImageHandLandmarker(): Promise<HandLandmarker | null> {
  if (cachedLandmarker) return cachedLandmarker;
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
        );
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          numHands: 2,
          minHandDetectionConfidence: 0.26,
          minHandPresenceConfidence: 0.26,
        });
        cachedLandmarker = landmarker;
        return landmarker;
      } catch {
        landmarkerPromise = null;
        return null;
      }
    })();
  }
  return landmarkerPromise;
}

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

function loadImageFromDataUrl(dataUrl: string, maxDim = 2200): Promise<HTMLImageElement> {
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
      norm.src = c.toDataURL('image/jpeg', 0.95);
    };
    rawImg.src = dataUrl;
  });
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

/**
 * True CIE L*a*b* conversion (sRGB -> D65 XYZ -> CIELab) so deep burgundy/wine (#5A0A1E),
 * crimson flowers, skin tones, and warm gold rims remain accurately separated without muddying.
 */
function rgbToLabLike(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaLab(c1: [number, number, number], c2: [number, number, number]): number {
  const dl = (c1[0] - c2[0]) * 0.78;
  const da = (c1[1] - c2[1]) * 1.15;
  const db = (c1[2] - c2[2]) * 1.1;
  return Math.hypot(dl, da, db);
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

function medianRgbColor(samples: Array<[number, number, number]>, fallback: string): string {
  if (samples.length === 0) return fallback;
  const rs = samples.map((s) => s[0]).sort((a, b) => a - b);
  const gs = samples.map((s) => s[1]).sort((a, b) => a - b);
  const bs = samples.map((s) => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  return rgbToHex(rs[mid], gs[mid], bs[mid]);
}

function isGoldOrMetallicPixel(r: number, g: number, b: number, gradMag: number): boolean {
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
  // Warm gold / champagne metallic
  const isWarmGold = r > g * 1.05 && g > b * 1.16 && luma > 0.40 && sat > 0.22;
  // Bright pearl / specular chrome ridge
  const isPearlRidge = luma > 0.78 && gradMag > 0.14;
  return isWarmGold || isPearlRidge;
}

function classifyExtensionFromAspectRatio(aspectRatio: number): {
  extensionLevel: NailExtensionLevel;
  extensionMm: number;
  lengthMultiplier: number;
} {
  const ar = Math.max(0.75, Math.min(3.4, aspectRatio));

  if (ar < 1.30) {
    const t = Math.max(0, Math.min(1, (ar - 0.85) / (1.30 - 0.85)));
    return {
      extensionLevel: 'Curta/Natural',
      extensionMm: Number((1.5 + t * 1.5).toFixed(1)),
      lengthMultiplier: Number(Math.min(1.65, 0.85 + t * (1.02 - 0.85)).toFixed(2)),
    };
  }
  if (ar < 1.72) {
    const t = Math.max(0, Math.min(1, (ar - 1.30) / (1.72 - 1.30)));
    return {
      extensionLevel: 'Pouco Alongada',
      extensionMm: Number((3.0 + t * 2.2).toFixed(1)),
      lengthMultiplier: Number(Math.min(1.65, 1.04 + t * (1.22 - 1.04)).toFixed(2)),
    };
  }
  if (ar < 2.25) {
    const t = Math.max(0, Math.min(1, (ar - 1.72) / (2.25 - 1.72)));
    return {
      extensionLevel: 'Alongada',
      extensionMm: Number((5.2 + t * 3.3).toFixed(1)),
      lengthMultiplier: Number(Math.min(1.65, 1.24 + t * (1.44 - 1.24)).toFixed(2)),
    };
  }
  const t = Math.max(0, Math.min(1, (ar - 2.25) / (3.10 - 2.25)));
  return {
    extensionLevel: 'Muito Alongada (Extrema)',
    extensionMm: Number((8.5 + t * 3.5).toFixed(1)),
    lengthMultiplier: Number(Math.min(1.65, 1.46 + t * (1.65 - 1.46)).toFixed(2)),
  };
}

function classifyExtensionFromMultiplier(lengthMultiplier: number): NailExtensionLevel {
  if (lengthMultiplier <= 1.03) return 'Curta/Natural';
  if (lengthMultiplier <= 1.23) return 'Pouco Alongada';
  if (lengthMultiplier <= 1.45) return 'Alongada';
  return 'Muito Alongada (Extrema)';
}

function computeExtensionMmFromMultiplier(lengthMultiplier: number): number {
  const t = Math.max(0, Math.min(1, (lengthMultiplier - 0.85) / (1.65 - 0.85)));
  return Number((1.5 + t * 10.5).toFixed(1));
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

function normalizeShape(shape: unknown, fallback: NailShape = 'almond'): NailShape {
  if (typeof shape === 'string' && VALID_SHAPES.includes(shape as NailShape)) {
    return shape as NailShape;
  }
  return fallback;
}

function normalizePattern(pattern: unknown, fallback: ArtisticPattern = 'solid_gloss'): ArtisticPattern {
  if (typeof pattern === 'string' && VALID_PATTERNS.includes(pattern as ArtisticPattern)) {
    return pattern as ArtisticPattern;
  }
  return fallback;
}

/**
 * Full 512×512 UV Rectification covering 94% of the segmented nail plate
 * (`u ∈ [0.03, 0.97], v ∈ [0.04, 0.96]`) via direct bilinear sampling from the full-res source photo.
 *
 * CRITICAL FIDELITY GUARANTEE:
 * - NO global Retinex normalization (preserves deep burgundy/wine `#5A0A1E`, obsidian, crimson florals, gold rims).
 * - Surgical specular-glare inpainting ONLY on blown-out specular highlight pixels (`luma > 0.92 && sat < 0.12`),
 *   replacing each glare pixel with the Gaussian/distance-weighted mean of non-specular neighbors within radius 6px.
 * - Orientation: u = 0..1 (left->right), v = 0..1 (cuticle at canvas bottom -> tip at canvas top).
 */
function buildRectifiedNailUVPatch(
  img: HTMLImageElement,
  rowLeft: Int16Array,
  rowRight: Int16Array,
  minY: number,
  maxY: number,
  roiW: number,
  roiH: number,
  anchorX: number,
  anchorY: number,
  scale: number,
  angleRad: number
): string | undefined {
  const nailLen = maxY - minY;
  if (nailLen < 16) return undefined;

  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  if (!imgW || !imgH) return undefined;

  // Smooth segmented left/right boundaries across Y to prevent jagged scanlines
  const smoothL = new Float32Array(roiH);
  const smoothR = new Float32Array(roiH);
  for (let y = minY; y <= maxY; y++) {
    let accL = 0;
    let accR = 0;
    let cnt = 0;
    for (let dy = -4; dy <= 4; dy++) {
      const yy = Math.max(minY, Math.min(maxY, y + dy));
      if (rowLeft[yy] >= 0 && rowRight[yy] > rowLeft[yy]) {
        accL += rowLeft[yy];
        accR += rowRight[yy];
        cnt++;
      }
    }
    smoothL[y] = cnt > 0 ? accL / cnt : roiW * 0.34;
    smoothR[y] = cnt > 0 ? accR / cnt : roiW * 0.66;
  }

  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const roiToImg = (rx: number, ry: number): [number, number] => {
    const ux = (rx - roiW * 0.5) / scale;
    const uy = (ry - roiH * 0.5) / scale;
    return [anchorX + cosA * ux - sinA * uy, anchorY + sinA * ux + cosA * uy];
  };

  // Compute tight source bounding box covering 94% of the segmented plate (u,v in [0.03..0.97], [0.04..0.96])
  let minSrcX = imgW;
  let maxSrcX = 0;
  let minSrcY = imgH;
  let maxSrcY = 0;
  const yStart = minY + nailLen * 0.04;
  const yEnd = maxY - nailLen * 0.04;
  for (let k = 0; k <= 6; k++) {
    const ry = yStart + ((yEnd - yStart) * k) / 6;
    const yi = Math.max(minY, Math.min(maxY, Math.round(ry)));
    const l = smoothL[yi];
    const r = smoothR[yi];
    const span = r - l;
    for (const rx of [l + span * 0.03, (l + r) * 0.5, r - span * 0.03]) {
      const [sx, sy] = roiToImg(rx, ry);
      if (sx < minSrcX) minSrcX = sx;
      if (sx > maxSrcX) maxSrcX = sx;
      if (sy < minSrcY) minSrcY = sy;
      if (sy > maxSrcY) maxSrcY = sy;
    }
  }

  const pad = 12;
  const bx = Math.max(0, Math.floor(minSrcX - pad));
  const by = Math.max(0, Math.floor(minSrcY - pad));
  const bx2 = Math.min(imgW, Math.ceil(maxSrcX + pad));
  const by2 = Math.min(imgH, Math.ceil(maxSrcY + pad));
  const bw = Math.max(8, bx2 - bx);
  const bh = Math.max(8, by2 - by);

  const { ctx: cropCtx } = createScratchCanvas(bw, bh);
  cropCtx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
  const srcData = cropCtx.getImageData(0, 0, bw, bh).data;

  const size = 512;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = size;
  outCanvas.height = size;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return undefined;

  const outImg = outCtx.createImageData(size, size);
  const patchRGB = new Float32Array(size * size * 3);
  const isSpecGlare = new Uint8Array(size * size);

  // 1. Bilinear sampling over 94% of segmented plate: uPlate ∈ [0.03, 0.97], vPlate ∈ [0.04, 0.96]
  for (let py = 0; py < size; py++) {
    // py = 0 is canvas top (v = 1 tip), py = size-1 is canvas bottom (v = 0 cuticle)
    const v = 1 - py / (size - 1);
    const vPlate = 0.04 + v * 0.92;
    const ry = maxY - vPlate * nailLen;
    const y0 = Math.max(minY, Math.min(maxY, Math.floor(ry)));
    const y1 = Math.max(minY, Math.min(maxY, y0 + 1));
    const fy = Math.max(0, Math.min(1, ry - y0));

    const l0 = smoothL[y0];
    const r0 = smoothR[y0];
    const l1 = smoothL[y1];
    const r1 = smoothR[y1];
    const lx = l0 + (l1 - l0) * fy;
    const rx = r0 + (r1 - r0) * fy;
    const span = Math.max(4, rx - lx);

    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const uPlate = 0.03 + u * 0.94;
      const rxf = lx + uPlate * span;
      const [sxAbs, syAbs] = roiToImg(rxf, ry);

      const sx = Math.max(0, Math.min(bw - 1.001, sxAbs - bx));
      const sy = Math.max(0, Math.min(bh - 1.001, syAbs - by));
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const tx = sx - ix;
      const ty = sy - iy;

      const idx00 = (iy * bw + ix) * 4;
      const idx10 = (iy * bw + Math.min(bw - 1, ix + 1)) * 4;
      const idx01 = (Math.min(bh - 1, iy + 1) * bw + ix) * 4;
      const idx11 = (Math.min(bh - 1, iy + 1) * bw + Math.min(bw - 1, ix + 1)) * 4;

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;

      const r =
        srcData[idx00] * w00 +
        srcData[idx10] * w10 +
        srcData[idx01] * w01 +
        srcData[idx11] * w11;
      const g =
        srcData[idx00 + 1] * w00 +
        srcData[idx10 + 1] * w10 +
        srcData[idx01 + 1] * w01 +
        srcData[idx11 + 1] * w11;
      const b =
        srcData[idx00 + 2] * w00 +
        srcData[idx10 + 2] * w10 +
        srcData[idx01 + 2] * w01 +
        srcData[idx11 + 2] * w11;

      const pIdx = py * size + px;
      patchRGB[pIdx * 3] = r;
      patchRGB[pIdx * 3 + 1] = g;
      patchRGB[pIdx * 3 + 2] = b;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

      // Mark ONLY blown-out specular glare highlights (luma > 0.92 && saturation < 0.12)
      if (luma > 0.92 && sat < 0.12) {
        isSpecGlare[pIdx] = 1;
      }
    }
  }

  // 2. Surgical specular-glare inpainting: replace blown highlight pixels with weighted average
  //    of non-specular neighbor pixels within local radius 6..8px (100% preserving real deep colors!)
  const outBytes = outImg.data;
  const searchRadius = 7;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pIdx = py * size + px;
      const p4 = pIdx * 4;

      let rr = patchRGB[pIdx * 3];
      let gg = patchRGB[pIdx * 3 + 1];
      let bb = patchRGB[pIdx * 3 + 2];

      if (isSpecGlare[pIdx]) {
        let sumW = 0;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;

        for (let dy = -searchRadius; dy <= searchRadius; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= size) continue;
          for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            const nx = px + dx;
            if (nx < 0 || nx >= size) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 === 0 || d2 > searchRadius * searchRadius) continue;

            const nIdx = ny * size + nx;
            if (isSpecGlare[nIdx]) continue;

            const w = 1 / (1 + d2 * 0.35);
            sumW += w;
            sumR += patchRGB[nIdx * 3] * w;
            sumG += patchRGB[nIdx * 3 + 1] * w;
            sumB += patchRGB[nIdx * 3 + 2] * w;
          }
        }

        if (sumW > 0) {
          const blend = 0.88;
          rr = rr * (1 - blend) + (sumR / sumW) * blend;
          gg = gg * (1 - blend) + (sumG / sumW) * blend;
          bb = bb * (1 - blend) + (sumB / sumW) * blend;
        }
      }

      outBytes[p4] = Math.max(0, Math.min(255, Math.round(rr)));
      outBytes[p4 + 1] = Math.max(0, Math.min(255, Math.round(gg)));
      outBytes[p4 + 2] = Math.max(0, Math.min(255, Math.round(bb)));
      outBytes[p4 + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  try {
    const webp = outCanvas.toDataURL('image/webp', 0.92);
    if (webp.startsWith('data:image/webp')) return webp;
  } catch {
    // Fallback to PNG below
  }
  return outCanvas.toDataURL('image/png');
}

interface FingerRoiAnalysisOutput {
  spec: NailFingerDesignSpec;
  qualityScore: number;
}

/**
 * High-Resolution (320×480) ROI Segmentation & Analysis for a single finger:
 * - Extracts upright 320×480 ROI directly from the full-res original photo (DIP -> past TIP)
 * - Combines CIELab distance vs PIP->DIP phalanx skin + HSV saturation/luma + Sobel edge magnitude
 *   + anatomical elliptical prior + rejection of wide gold rings outside the distal DIP->TIP plate
 * - Rectifies 512×512 UV texture covering 94% of the plate with surgical glare-only inpainting
 * - Computes qualityScore (sharpness + nail-vs-skin contrast + absence of ring occlusion) for 2-hand selection
 */
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

  const defaultMult = Number(Math.max(0.85, Math.min(1.65, cfg.defaultLength)).toFixed(2));
  const defaultSpec: NailFingerDesignSpec = {
    fingerId,
    detectedFromPhoto,
    shape: 'almond',
    relativeLength: defaultMult,
    lengthMultiplier: defaultMult,
    extensionLevel: classifyExtensionFromMultiplier(defaultMult),
    extensionMm: computeExtensionMmFromMultiplier(defaultMult),
    tipRoundness: 0.55,
    aspectRatio: Number((1.15 * defaultMult).toFixed(2)),
    relativeWidth: cfg.defaultWidth,
    baseColor: '#E5BEB3',
    secondaryColor: '#FFF7F3',
    accentColor: '#D4AF37',
    hasMetallicOutline: false,
    outlineColor: undefined,
    has3DRelief: false,
    pattern: 'solid_gloss',
    strokeAnchors: [],
    metallicIntensity: 0.12,
    glossIntensity: 0.92,
    isImportedReference: true,
  };

  try {
    // 1. Sample phalanx skin color strictly along PIP -> DIP (away from any distal plate/ring edge)
    const { ctx: skinCtx } = createScratchCanvas(28, 28);
    const sx = (pipNorm.x * 0.55 + dipNorm.x * 0.45) * imgW;
    const sy = (pipNorm.y * 0.55 + dipNorm.y * 0.45) * imgH;
    const dx = (tipNorm.x - dipNorm.x) * imgW;
    const dy = (tipNorm.y - dipNorm.y) * imgH;
    const segPx = Math.max(24, Math.hypot(dx, dy));
    const patch = Math.max(10, Math.round(segPx * 0.24));

    skinCtx.drawImage(
      img,
      Math.max(0, Math.min(imgW - patch, sx - patch / 2)),
      Math.max(0, Math.min(imgH - patch, sy - patch / 2)),
      patch,
      patch,
      0,
      0,
      28,
      28
    );
    const skinPixels = skinCtx.getImageData(0, 0, 28, 28).data;
    const skinRgbSamples: Array<[number, number, number]> = [];
    for (let i = 0; i < skinPixels.length; i += 4) {
      const r = skinPixels[i];
      const g = skinPixels[i + 1];
      const b = skinPixels[i + 2];
      const [, sat] = rgbToHsv(r, g, b);
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      // Exclude bright metallic jewelry reflections when estimating phalanx skin reference
      if (!(r > g * 1.06 && g > b * 1.18 && luma > 0.52 && sat > 0.28)) {
        skinRgbSamples.push([r, g, b]);
      }
    }
    const skinHex = medianRgbColor(skinRgbSamples, '#D8B29D');
    const skinLab = hexToLab(skinHex);

    // 2. Render high-resolution upright 320×480 ROI centered around nail plate (DIP -> past TIP)
    const roiW = 320;
    const roiH = 480;
    const { ctx: roiCtx } = createScratchCanvas(roiW, roiH);
    const angleRad = Math.atan2(dy, dx) + Math.PI / 2;
    const anchorX = (dipNorm.x + 0.72 * (tipNorm.x - dipNorm.x)) * imgW;
    const anchorY = (dipNorm.y + 0.72 * (tipNorm.y - dipNorm.y)) * imgH;
    const roiSpanH = segPx * 1.98;
    const scale = roiH / roiSpanH;

    roiCtx.save();
    roiCtx.imageSmoothingEnabled = true;
    roiCtx.imageSmoothingQuality = 'high';
    roiCtx.translate(roiW / 2, roiH / 2);
    roiCtx.scale(scale, scale);
    roiCtx.rotate(-angleRad);
    roiCtx.drawImage(img, -anchorX, -anchorY);
    roiCtx.restore();

    const { data } = roiCtx.getImageData(0, 0, roiW, roiH);

    // Background CIELab from distal upper corners
    const cornerOffsets = [
      (roiW * 4 + 4) * 4,
      (roiW * 4 + roiW - 5) * 4,
      (roiW * 8 + 8) * 4,
      (roiW * 8 + roiW - 9) * 4,
    ];
    let br = 0;
    let bg = 0;
    let bb = 0;
    for (const off of cornerOffsets) {
      br += data[off];
      bg += data[off + 1];
      bb += data[off + 2];
    }
    const bgLab = rgbToLabLike(br / 4, bg / 4, bb / 4);

    // Precompute luma + Sobel edge magnitude across 320×480 ROI
    const lumaMap = new Float32Array(roiW * roiH);
    const sobelMap = new Float32Array(roiW * roiH);
    for (let i = 0; i < roiW * roiH; i++) {
      const p4 = i * 4;
      lumaMap[i] = (0.299 * data[p4] + 0.587 * data[p4 + 1] + 0.114 * data[p4 + 2]) / 255;
    }
    for (let y = 1; y < roiH - 1; y++) {
      for (let x = 1; x < roiW - 1; x++) {
        const tl = lumaMap[(y - 1) * roiW + (x - 1)];
        const tc = lumaMap[(y - 1) * roiW + x];
        const tr = lumaMap[(y - 1) * roiW + (x + 1)];
        const ml = lumaMap[y * roiW + (x - 1)];
        const mr = lumaMap[y * roiW + (x + 1)];
        const bl = lumaMap[(y + 1) * roiW + (x - 1)];
        const bc = lumaMap[(y + 1) * roiW + x];
        const brp = lumaMap[(y + 1) * roiW + (x + 1)];
        const gx = tr + 2 * mr + brp - (tl + 2 * ml + bl);
        const gy = bl + 2 * bc + brp - (tl + 2 * tc + tr);
        sobelMap[y * roiW + x] = Math.hypot(gx, gy) * 0.25;
      }
    }

    // 3. Combined high-precision segmentation:
    //    CIELab distance vs phalanx skin + HSV saturation/luma + Sobel edges
    //    + anatomical elliptical prior + rejection of wide gold rings outside distal plate
    const rowLeft = new Int16Array(roiH).fill(-1);
    const rowRight = new Int16Array(roiH).fill(-1);
    const rowWidths = new Float32Array(roiH);
    let minY = roiH;
    let maxY = 0;
    let maxWidth = 0;
    let activeRows = 0;
    let ringBandRows = 0;

    // Anatomical plate prior ellipse center (slightly distal from ROI center)
    const priorCx = roiW * 0.5;
    const priorCy = roiH * 0.47;
    const priorRx = roiW * 0.27;
    const priorRy = roiH * 0.39;

    const isWideGoldBand = (x: number, y: number): boolean => {
      // Gold rings on proximal/middle phalanx appear near bottom of ROI or outside lateral plate width
      const inDistalCore = y >= roiH * 0.14 && y <= roiH * 0.78 && Math.abs(x - priorCx) <= roiW * 0.23;
      if (inDistalCore) return false;
      const idx = (y * roiW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const [, sat, val] = rgbToHsv(r, g, b);
      return r > g * 1.07 && g > b * 1.18 && val > 0.45 && sat > 0.26;
    };

    const isNailPixel = (x: number, y: number): boolean => {
      const idx = (y * roiW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      if (isWideGoldBand(x, y)) return false;

      const pLab = rgbToLabLike(r, g, b);
      const dSkin = deltaLab(pLab, skinLab);
      const dBg = deltaLab(pLab, bgLab);
      const [, sat, val] = rgbToHsv(r, g, b);
      const edge = sobelMap[y * roiW + x];

      // Anatomical elliptical prior boosts confidence inside expected nail bed and penalizes far flanks
      const ellipDist = Math.hypot((x - priorCx) / priorRx, (y - priorCy) / priorRy);
      const priorBonus = ellipDist <= 1.05 ? 1.8 : Math.max(-4.5, (1.05 - ellipDist) * 7.5);

      const isDeepDarkPolish = val < 0.26 && dBg > 5.0 && ellipDist < 1.15;
      const isVividOrLightPolish = (sat > 0.20 || val > 0.84) && dSkin > 7.5;
      const chromaPass = dSkin + priorBonus > 10.5 || isDeepDarkPolish || isVividOrLightPolish;
      const edgePass = edge > 0.14 && ellipDist < 1.08 && dSkin > 5.5;

      return (chromaPass || edgePass) && (dBg > 6.5 || isDeepDarkPolish);
    };

    const yScanStart = Math.round(roiH * 0.05);
    const yScanEnd = Math.round(roiH * 0.89);

    for (let y = yScanStart; y < yScanEnd; y++) {
      const cx = Math.floor(roiW / 2);
      let left = cx;
      let right = cx;
      let found = false;

      for (let off = 0; off <= Math.round(roiW * 0.14); off++) {
        if (cx + off < roiW - 8 && isNailPixel(cx + off, y)) {
          left = cx + off;
          right = left;
          found = true;
          break;
        }
        if (cx - off >= 8 && isNailPixel(cx - off, y)) {
          left = cx - off;
          right = left;
          found = true;
          break;
        }
      }
      if (!found) continue;

      let missL = 0;
      while (left > 6 && missL < 4) {
        if (isNailPixel(left - 1, y)) {
          left--;
          missL = 0;
        } else {
          missL++;
          left--;
        }
      }
      left += missL;

      let missR = 0;
      while (right < roiW - 7 && missR < 4) {
        if (isNailPixel(right + 1, y)) {
          right++;
          missR = 0;
        } else {
          missR++;
          right++;
        }
      }
      right -= missR;

      const w = right - left + 1;
      // Reject excessively wide proximal rows caused by wide rings or overlapping fingers
      if (y > roiH * 0.72 && w > roiW * 0.56) {
        ringBandRows++;
        continue;
      }

      if (w >= 18 && w <= roiW * 0.68) {
        rowLeft[y] = left;
        rowRight[y] = right;
        rowWidths[y] = w;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (w > maxWidth) maxWidth = w;
        activeRows++;
      }
    }

    if (activeRows < 24 || maxWidth < 24) {
      minY = Math.round(roiH * 0.18);
      maxY = Math.round(roiH * 0.80);
      maxWidth = Math.round(roiW * 0.36);
      for (let y = minY; y <= maxY; y++) {
        rowLeft[y] = Math.round(roiW * 0.32);
        rowRight[y] = Math.round(roiW * 0.68);
        rowWidths[y] = rowRight[y] - rowLeft[y] + 1;
      }
    }

    const nailLength = Math.max(32, maxY - minY);

    const sampleBandWidth = (fracFromCuticle: number): number => {
      const targetY = Math.round(maxY - nailLength * fracFromCuticle);
      let acc = 0;
      let cnt = 0;
      for (let dyb = -6; dyb <= 6; dyb++) {
        const yy = Math.max(0, Math.min(roiH - 1, targetY + dyb));
        if (rowWidths[yy] > 0) {
          acc += rowWidths[yy];
          cnt++;
        }
      }
      return cnt > 0 ? acc / cnt : maxWidth;
    };

    const baseWidth = Math.max(20, sampleBandWidth(0.34), maxWidth * 0.88);
    const aspectRatio = Number((nailLength / baseWidth).toFixed(2));

    const widthAt76 = sampleBandWidth(0.76);
    const widthAt86 = sampleBandWidth(0.86);
    const widthAt95 = sampleBandWidth(0.95);

    const tipTapering = Math.max(0.06, Math.min(1.15, widthAt86 / baseWidth));
    const tipFlatness = Math.max(0, Math.min(1, widthAt95 / Math.max(8, widthAt86)));
    const midToTipSlope = Math.max(0, Math.min(1, (widthAt76 - widthAt95) / baseWidth));
    const apexCurvature = Math.max(
      0,
      Math.min(1, (1 - tipFlatness) * 0.65 + midToTipSlope * 0.35)
    );
    const tipRoundness = Number(
      Math.max(0, Math.min(1, (1 - tipFlatness) * 0.72 + (1 - tipTapering) * 0.28)).toFixed(2)
    );

    let shape: NailShape = 'almond';
    if (aspectRatio < 1.28) {
      shape = tipTapering >= 0.84 && apexCurvature < 0.30 ? 'square' : 'natural';
    } else if (
      tipTapering < 0.34 ||
      (aspectRatio >= 1.72 && tipTapering < 0.44 && apexCurvature >= 0.46)
    ) {
      shape = 'stiletto';
    } else if (tipTapering >= 0.80 && apexCurvature < 0.34) {
      shape = 'square';
    } else if (tipTapering >= 0.46 && tipTapering < 0.80 && apexCurvature < 0.42) {
      shape = 'coffin';
    } else if (tipTapering >= 0.66 && apexCurvature >= 0.36 && aspectRatio < 1.65) {
      shape = 'oval';
    } else {
      shape = 'almond';
    }

    const { extensionLevel, extensionMm, lengthMultiplier } =
      classifyExtensionFromAspectRatio(aspectRatio);
    const relativeLength = lengthMultiplier;
    const relativeWidth = Number(
      Math.max(0.78, Math.min(1.30, cfg.defaultWidth * (baseWidth / (roiW * 0.36)))).toFixed(2)
    );

    // 4. 3-Zone Analysis inside segmented 320×480 plate:
    //    Zone 1: Central Core (u ∈ [0.16, 0.84], v ∈ [0.14, 0.82]) — dominant polish base (deep colors preserved!)
    //    Zone 2: Outer 5% Perimeter Ring — metallic/contrasting outline & french tip detection
    //    Zone 3: Central Elements (Blobs & Strokes) — connected-component PCA eccentricity for floral vs 3D waves
    const centralZoneSamples: Array<[number, number, number]> = [];
    const tipSamples: Array<[number, number, number]> = [];
    const centerAuraSamples: Array<[number, number, number]> = [];
    const outerAuraSamples: Array<[number, number, number]> = [];
    const perimeterSamples: Array<[number, number, number]> = [];
    const lateralPerimeterSamples: Array<[number, number, number]> = [];
    const perimeterMetallicSamples: Array<[number, number, number]> = [];
    const accentSamples: Array<[number, number, number]> = [];
    const metallicPoints: Array<{ u: number; v: number; r: number; g: number; b: number; grad: number }> = [];

    let totalPlatePixels = 0;
    let perimeterTotalPixels = 0;
    let lumaSum = 0;
    let lumaSqSum = 0;
    let sharpnessAcc = 0;
    let contrastAcc = 0;
    let ridgeCount = 0;
    let ringOcclusionPixels = 0;

    // Sample on a 2px stride for fast, crisp 160×240 statistical analysis (~10x sharper than old 80×120)
    const stride = 2;
    for (let y = minY; y <= maxY; y += stride) {
      const lx = rowLeft[y];
      const rx = rowRight[y];
      if (lx < 0 || rx <= lx) continue;

      const v = (maxY - y) / nailLength;
      const span = rx - lx;
      if (span < 10) continue;

      for (let x = lx; x <= rx; x += stride) {
        const p = (y * roiW + x) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const u = (x - lx) / Math.max(1, span);

        const [, sat, val] = rgbToHsv(r, g, b);
        const lum = lumaMap[y * roiW + x];
        const grad = sobelMap[y * roiW + x];

        const isPerimeterRing =
          (u <= 0.08 || u >= 0.92 || v <= 0.06 || v >= 0.94) &&
          u >= 0.015 &&
          u <= 0.985;

        if (isPerimeterRing) {
          const pLab = rgbToLabLike(r, g, b);
          if (deltaLab(pLab, bgLab) > 8.0 && deltaLab(pLab, skinLab) > 7.5) {
            perimeterTotalPixels++;
            perimeterSamples.push([r, g, b]);
            if (u <= 0.09 || u >= 0.91) {
              lateralPerimeterSamples.push([r, g, b]);
            }
            if (isGoldOrMetallicPixel(r, g, b, grad)) {
              perimeterMetallicSamples.push([r, g, b]);
            }
          }
          continue;
        }

        if (u < 0.09 || u > 0.91) continue;

        totalPlatePixels++;
        lumaSum += lum;
        lumaSqSum += lum * lum;
        sharpnessAcc += grad;

        const pLab = rgbToLabLike(r, g, b);
        contrastAcc += deltaLab(pLab, skinLab);

        if (grad > 0.13) ridgeCount++;

        // Track if a thick bright gold band sits across the nail bed (indicating ring occlusion)
        if (v < 0.35 && r > g * 1.07 && g > b * 1.18 && val > 0.5 && sat > 0.28) {
          ringOcclusionPixels++;
        }

        // Zone 1: Central Core u ∈ [0.16, 0.84], v ∈ [0.14, 0.82] excluding blown specular glare
        const isPureSpecularGlare = lum > 0.92 && sat < 0.12 && grad < 0.20;
        if (u >= 0.16 && u <= 0.84 && v >= 0.14 && v <= 0.82 && !isPureSpecularGlare) {
          centralZoneSamples.push([r, g, b]);
        }

        if (v >= 0.72 && v <= 0.94 && u >= 0.2 && u <= 0.8 && !isPureSpecularGlare) {
          tipSamples.push([r, g, b]);
        }

        const radialDist = Math.hypot((u - 0.5) * 1.4, (v - 0.5) * 1.2);
        if (radialDist < 0.28 && !isPureSpecularGlare) {
          centerAuraSamples.push([r, g, b]);
        } else if (radialDist > 0.44 && !isPureSpecularGlare) {
          outerAuraSamples.push([r, g, b]);
        }

        if (isGoldOrMetallicPixel(r, g, b, grad)) {
          accentSamples.push([r, g, b]);
          metallicPoints.push({ u, v, r, g, b, grad });
        }
      }
    }

    const baseColor = extractDominantColorCluster(centralZoneSamples, defaultSpec.baseColor);
    const baseLab = hexToLab(baseColor);

    const tipColor = medianRgbColor(tipSamples, baseColor);
    const tipLab = hexToLab(tipColor);
    const centerAuraColor = medianRgbColor(centerAuraSamples, baseColor);
    const outerAuraColor = medianRgbColor(outerAuraSamples, baseColor);

    // Zone 2: Evaluate perimeter border contrast / metallic rim
    const perimeterContrastSamples = perimeterSamples.filter(
      (rgb) => deltaLab(rgbToLabLike(rgb[0], rgb[1], rgb[2]), baseLab) > 13.5
    );
    const lateralContrastSamples = lateralPerimeterSamples.filter(
      (rgb) => deltaLab(rgbToLabLike(rgb[0], rgb[1], rgb[2]), baseLab) > 13.5
    );

    const perimContrastRatio =
      perimeterTotalPixels > 0 ? perimeterContrastSamples.length / perimeterTotalPixels : 0;
    const perimMetallicRatio =
      perimeterTotalPixels > 0 ? perimeterMetallicSamples.length / perimeterTotalPixels : 0;
    const hasLateralRim =
      lateralPerimeterSamples.length >= 10 &&
      lateralContrastSamples.length / Math.max(1, lateralPerimeterSamples.length) > 0.22;

    const perimeterCandidateColor =
      perimeterMetallicSamples.length >= 8
        ? medianRgbColor(perimeterMetallicSamples, baseColor)
        : perimeterContrastSamples.length >= 8
          ? medianRgbColor(perimeterContrastSamples, baseColor)
          : medianRgbColor(perimeterSamples, baseColor);
    const perimeterLab = hexToLab(perimeterCandidateColor);
    const perimeterDelta = deltaLab(perimeterLab, baseLab);
    const perimeterLumaDiff = Math.abs(perimeterLab[0] - baseLab[0]) / 100;

    const baseTipDelta = deltaLab(baseLab, tipLab);
    const radialDelta = deltaLab(hexToLab(centerAuraColor), hexToLab(outerAuraColor));

    const hasMetallicOutline =
      (perimMetallicRatio > 0.16 && (perimeterDelta > 11 || perimeterLumaDiff > 0.12)) ||
      (hasLateralRim && perimContrastRatio > 0.24 && perimeterDelta > 14.5) ||
      (baseTipDelta > 18 && perimMetallicRatio > 0.12);

    const outlineColor = hasMetallicOutline ? perimeterCandidateColor : undefined;

    // Zone 3: Connected-component analysis at half-res grid (160×240) for crisp floral / 3D wave detection
    const gridW = Math.floor(roiW / stride);
    const gridH = Math.floor(roiH / stride);
    const contrastMask = new Uint8Array(gridW * gridH);
    const maskPixels: Array<{ gx: number; gy: number; x: number; y: number }> = [];

    for (let gy = 0; gy < gridH; gy++) {
      const y = gy * stride;
      if (y < minY || y > maxY) continue;
      const lx = rowLeft[y];
      const rx = rowRight[y];
      if (lx < 0 || rx <= lx) continue;
      const v = (maxY - y) / nailLength;
      if (v < 0.08 || v > 0.90) continue;
      const span = rx - lx;
      const minX = Math.round(lx + span * 0.10);
      const maxX = Math.round(rx - span * 0.10);

      for (let gx = 0; gx < gridW; gx++) {
        const x = gx * stride;
        if (x < minX || x > maxX) continue;
        const p = (y * roiW + x) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const [, sat] = rgbToHsv(r, g, b);
        const lum = lumaMap[y * roiW + x];
        const grad = sobelMap[y * roiW + x];

        if (lum > 0.92 && sat < 0.11 && grad < 0.18) continue;

        const pLab = rgbToLabLike(r, g, b);
        const dBase = deltaLab(pLab, baseLab);
        const isMetal = isGoldOrMetallicPixel(r, g, b, grad);
        if (dBase > 15.0 || (isMetal && dBase > 10.0)) {
          contrastMask[gy * gridW + gx] = 1;
          maskPixels.push({ gx, gy, x, y });
        }
      }
    }

    const visited = new Uint8Array(gridW * gridH);
    interface DetectedComponent {
      count: number;
      cu: number;
      cv: number;
      eccentricity: number;
      angle: number;
      radius: number;
      isMetallic: boolean;
      dominantColor: string;
      centerDotColor: string | null;
    }
    const components: DetectedComponent[] = [];

    for (const seed of maskPixels) {
      const startIdx = seed.gy * gridW + seed.gx;
      if (visited[startIdx] || !contrastMask[startIdx]) continue;

      const queue: number[] = [startIdx];
      visited[startIdx] = 1;
      const pts: Array<{ u: number; v: number; r: number; g: number; b: number; isMetal: boolean }> = [];

      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        const gy = Math.floor(cur / gridW);
        const gx = cur - gy * gridW;
        const cy = gy * stride;
        const cx = gx * stride;
        const lx = rowLeft[cy];
        const rx = rowRight[cy];
        const span = Math.max(1, rx - lx);
        const p = (cy * roiW + cx) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const grad = sobelMap[cy * roiW + cx];
        pts.push({
          u: (cx - lx) / span,
          v: (maxY - cy) / nailLength,
          r,
          g,
          b,
          isMetal: isGoldOrMetallicPixel(r, g, b, grad),
        });

        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const ngx = gx + ox;
            const ngy = gy + oy;
            if (ngx < 0 || ngx >= gridW || ngy < 0 || ngy >= gridH) continue;
            const nIdx = ngy * gridW + ngx;
            if (!visited[nIdx] && contrastMask[nIdx]) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      if (pts.length < 10) continue;

      let sumU = 0;
      let sumV = 0;
      let metalHits = 0;
      const rgbs: Array<[number, number, number]> = [];
      for (const pt of pts) {
        sumU += pt.u;
        sumV += pt.v;
        if (pt.isMetal) metalHits++;
        rgbs.push([pt.r, pt.g, pt.b]);
      }
      const cu = sumU / pts.length;
      const cv = sumV / pts.length;

      let cxx = 0;
      let cyy = 0;
      let cxy = 0;
      for (const pt of pts) {
        const du = pt.u - cu;
        const dv = pt.v - cv;
        cxx += du * du;
        cyy += dv * dv;
        cxy += du * dv;
      }
      cxx /= pts.length;
      cyy /= pts.length;
      cxy /= pts.length;

      const trace = cxx + cyy;
      const disc = Math.sqrt(Math.max(0, (cxx - cyy) * (cxx - cyy) + 4 * cxy * cxy));
      const lambda1 = Math.max(1e-6, (trace + disc) * 0.5);
      const lambda2 = Math.max(0, (trace - disc) * 0.5);
      const eccentricity = Math.sqrt(Math.max(0, 1 - lambda2 / lambda1));
      const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      const radius = Math.max(0.08, Math.min(0.26, Math.sqrt(lambda1) * 2.2));

      const domHex = extractDominantColorCluster(rgbs, '#FFFFFF');
      const domLab = hexToLab(domHex);
      const innerDotRgbs: Array<[number, number, number]> = [];
      for (const pt of pts) {
        if (Math.hypot(pt.u - cu, pt.v - cv) < radius * 0.45) {
          const dDom = deltaLab(rgbToLabLike(pt.r, pt.g, pt.b), domLab);
          if (dDom > 14 || pt.isMetal) {
            innerDotRgbs.push([pt.r, pt.g, pt.b]);
          }
        }
      }

      components.push({
        count: pts.length,
        cu,
        cv,
        eccentricity,
        angle,
        radius,
        isMetallic: metalHits / pts.length > 0.36,
        dominantColor: domHex,
        centerDotColor:
          innerDotRgbs.length >= 4 ? medianRgbColor(innerDotRgbs, '#D4AF37') : null,
      });
    }

    components.sort((a, b) => b.count - a.count);

    const meanLuma = lumaSum / Math.max(1, totalPlatePixels);
    const lumaVariance = Math.max(
      0,
      lumaSqSum / Math.max(1, totalPlatePixels) - meanLuma * meanLuma
    );
    const ridgeDensity = ridgeCount / Math.max(1, totalPlatePixels);
    const metallicRatio = metallicPoints.length / Math.max(1, totalPlatePixels);

    const meaningfulComponents = components.filter((c) => c.count >= 12);
    const elongatedStrokeCount = meaningfulComponents.filter(
      (c) => c.eccentricity >= 0.82 && (c.isMetallic || metallicRatio > 0.025)
    ).length;
    const compactBlobCount = meaningfulComponents.filter(
      (c) => c.eccentricity < 0.84
    ).length;

    const detectedAnchors: StrokeAnchor[] = meaningfulComponents.slice(0, 4).map((c) => ({
      u: Number(Math.max(0.14, Math.min(0.86, c.cu)).toFixed(2)),
      v: Number(Math.max(0.14, Math.min(0.88, c.cv)).toFixed(2)),
      radius: Number(c.radius.toFixed(2)),
      angle: Number(c.angle.toFixed(2)),
    }));
    const strokeAnchors =
      detectedAnchors.length > 0 ? detectedAnchors : clusterStrokeAnchors(metallicPoints);

    let pattern: ArtisticPattern = 'solid_gloss';
    let secondaryColor = tipColor;
    let accentColor =
      outlineColor ??
      (accentSamples.length > 8
        ? medianRgbColor(accentSamples, '#D4AF37')
        : '#D4AF37');

    const topBlob = meaningfulComponents[0];
    const hasInnerFloralDot = meaningfulComponents.some((c) => c.centerDotColor !== null);

    if (
      (elongatedStrokeCount >= 1 && metallicRatio > 0.025) ||
      (metallicRatio > 0.045 && ridgeDensity > 0.070 && strokeAnchors.length >= 2 && compactBlobCount === 0)
    ) {
      pattern = 'gold_3d_waves';
      const metalComp = meaningfulComponents.find((c) => c.isMetallic);
      accentColor =
        metalComp?.dominantColor ??
        (accentSamples.length > 6 ? medianRgbColor(accentSamples, '#D4AF37') : accentColor);
      secondaryColor =
        hasMetallicOutline && outlineColor
          ? outlineColor
          : tipColor !== baseColor
            ? tipColor
            : shadeHex(baseColor, 14);
    } else if (
      (compactBlobCount >= 1 && topBlob && topBlob.count >= 18 && (hasInnerFloralDot || compactBlobCount >= 2)) ||
      (meaningfulComponents.length >= 2 && compactBlobCount >= 2 && ridgeDensity > 0.038)
    ) {
      pattern = 'floral_accent';
      const petalBlob = meaningfulComponents.find((c) => !c.isMetallic) ?? topBlob;
      secondaryColor = petalBlob ? petalBlob.dominantColor : '#FFFDF9';
      const dotBlob = meaningfulComponents.find((c) => c.centerDotColor !== null);
      accentColor =
        dotBlob?.centerDotColor ??
        outlineColor ??
        (accentSamples.length > 6 ? medianRgbColor(accentSamples, '#D4AF37') : '#D4AF37');
    } else if (baseTipDelta > 16 && radialDelta < 18 && meaningfulComponents.length <= 1) {
      pattern = 'french_tip';
      secondaryColor = tipColor;
    } else if (radialDelta > 15 && meaningfulComponents.length === 0) {
      pattern = 'aura_gradient';
      secondaryColor = centerAuraColor;
    } else if (lumaVariance > 0.032 && meanLuma > 0.58 && meaningfulComponents.length === 0) {
      pattern = 'chrome_mirror';
      secondaryColor = '#FFFFFF';
      accentColor = accentSamples.length > 6 ? accentColor : '#F5E7DF';
    } else {
      pattern = 'solid_gloss';
      secondaryColor =
        hasMetallicOutline && outlineColor ? outlineColor : shadeHex(baseColor, -14);
    }

    if (hasMetallicOutline && outlineColor && pattern !== 'floral_accent') {
      accentColor = outlineColor;
    }

    const metallicIntensity =
      pattern === 'chrome_mirror'
        ? 0.92
        : pattern === 'gold_3d_waves' || hasMetallicOutline
          ? 0.88
          : pattern === 'floral_accent'
            ? 0.48
            : 0.08;

    const has3DRelief =
      pattern === 'gold_3d_waves' ||
      pattern === 'floral_accent' ||
      hasMetallicOutline ||
      ridgeDensity > 0.065;

    const uvPatchDataUrl = buildRectifiedNailUVPatch(
      img,
      rowLeft,
      rowRight,
      minY,
      maxY,
      roiW,
      roiH,
      anchorX,
      anchorY,
      scale,
      angleRad
    );

    // Quality score for selecting best specimen across 2 overlapping hands:
    // rewards sharpness + nail-vs-skin Lab contrast + resolution, penalizes ring occlusion.
    const avgSharpness = sharpnessAcc / Math.max(1, totalPlatePixels);
    const avgContrast = contrastAcc / Math.max(1, totalPlatePixels);
    const ringPenalty = (ringOcclusionPixels / Math.max(1, totalPlatePixels)) * 60 + ringBandRows * 0.4;
    const qualityScore =
      avgSharpness * 140 +
      Math.min(45, avgContrast) * 1.4 +
      Math.min(120, segPx) * 0.25 -
      ringPenalty;

    return {
      qualityScore,
      spec: {
        fingerId,
        detectedFromPhoto,
        shape,
        relativeLength,
        lengthMultiplier,
        extensionLevel,
        extensionMm,
        tipRoundness,
        aspectRatio,
        relativeWidth,
        baseColor,
        secondaryColor,
        accentColor,
        hasMetallicOutline,
        outlineColor,
        has3DRelief,
        finishStyle: pattern === 'chrome_mirror' ? 'chrome_mirror' : 'glossy_gel',
        pattern,
        strokeAnchors:
          strokeAnchors.length > 0 ? strokeAnchors : defaultAnchorsForPattern(pattern),
        metallicIntensity,
        glossIntensity: pattern === 'chrome_mirror' ? 1.0 : 0.94,
        uvPatchDataUrl,
        isImportedReference: true,
      },
    };
  } catch {
    return { spec: defaultSpec, qualityScore: 0 };
  }
}

function extractDominantColorCluster(
  samples: Array<[number, number, number]>,
  fallback: string
): string {
  if (samples.length === 0) return fallback;
  if (samples.length < 8) return medianRgbColor(samples, fallback);

  // Coarse 3D RGB quantization (step 20) to isolate dominant base polish even with central nail art
  const bins = new Map<string, { sumR: number; sumG: number; sumB: number; count: number }>();
  for (const [r, g, b] of samples) {
    const key = `${Math.floor(r / 20)}_${Math.floor(g / 20)}_${Math.floor(b / 20)}`;
    const cur = bins.get(key);
    if (cur) {
      cur.sumR += r;
      cur.sumG += g;
      cur.sumB += b;
      cur.count++;
    } else {
      bins.set(key, { sumR: r, sumG: g, sumB: b, count: 1 });
    }
  }

  let bestBin: { sumR: number; sumG: number; sumB: number; count: number } | null = null;
  for (const bin of bins.values()) {
    if (!bestBin || bin.count > bestBin.count) {
      bestBin = bin;
    }
  }
  if (!bestBin) return medianRgbColor(samples, fallback);

  const seedLab = rgbToLabLike(
    bestBin.sumR / bestBin.count,
    bestBin.sumG / bestBin.count,
    bestBin.sumB / bestBin.count
  );
  const clusterSamples = samples.filter(
    ([r, g, b]) => deltaLab(rgbToLabLike(r, g, b), seedLab) < 16
  );
  return medianRgbColor(clusterSamples.length > 0 ? clusterSamples : samples, fallback);
}

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

function clusterStrokeAnchors(
  points: Array<{ u: number; v: number; grad: number }>
): StrokeAnchor[] {
  if (points.length < 4) return [];
  const sorted = [...points].sort((a, b) => b.grad - a.grad);
  const anchors: StrokeAnchor[] = [];
  for (const pt of sorted) {
    if (anchors.length >= 4) break;
    const tooClose = anchors.some((a) => Math.hypot(a.u - pt.u, a.v - pt.v) < 0.18);
    if (!tooClose) {
      anchors.push({
        u: Number(Math.max(0.18, Math.min(0.82, pt.u)).toFixed(2)),
        v: Number(Math.max(0.18, Math.min(0.86, pt.v)).toFixed(2)),
        radius: 0.15,
        angle: Number((((pt.u - 0.5) * 1.4)).toFixed(2)),
      });
    }
  }
  return anchors;
}

/**
 * Harmonic Inheritance for Missing Fingers:
 * Propagates uvPatchDataUrl, colors, reliefs, and proportions harmoniously to unseen fingers
 * (e.g., when only 3–4 fingers are visible in a reference photo).
 */
function applyHarmonicInheritance(
  partial: Partial<Record<FingerId, NailFingerDesignSpec>>
): Record<FingerId, NailFingerDesignSpec> {
  const detected = ORDERED_FINGERS.map((id) => partial[id]).filter(
    (s): s is NailFingerDesignSpec => Boolean(s)
  );

  const ornateDonor =
    detected.find((s) => s.pattern === 'gold_3d_waves' || s.pattern === 'floral_accent') ??
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

    const inheritedPattern: ArtisticPattern =
      id === 'thumb' || id === 'pinky'
        ? donor.pattern === 'floral_accent'
          ? 'aura_gradient'
          : donor.pattern
        : donor.pattern;

    const inheritedLengthMult = Number(
      Math.max(
        0.85,
        Math.min(
          1.65,
          (donor.lengthMultiplier ?? donor.relativeLength) * (cfg.defaultLength / 1.0)
        )
      ).toFixed(2)
    );

    result[id] = {
      ...donor,
      fingerId: id,
      detectedFromPhoto: false,
      relativeLength: inheritedLengthMult,
      lengthMultiplier: inheritedLengthMult,
      extensionLevel:
        donor.extensionLevel ?? classifyExtensionFromMultiplier(inheritedLengthMult),
      extensionMm: donor.extensionMm ?? computeExtensionMmFromMultiplier(inheritedLengthMult),
      aspectRatio: donor.aspectRatio,
      relativeWidth: cfg.defaultWidth,
      hasMetallicOutline: donor.hasMetallicOutline ?? false,
      outlineColor: donor.outlineColor,
      has3DRelief: donor.has3DRelief ?? false,
      pattern: inheritedPattern,
      uvPatchDataUrl: donor.uvPatchDataUrl,
      isImportedReference: donor.isImportedReference ?? true,
      strokeAnchors:
        inheritedPattern === 'gold_3d_waves' || inheritedPattern === 'floral_accent'
          ? donor.strokeAnchors.length > 0
            ? donor.strokeAnchors
            : defaultAnchorsForPattern(inheritedPattern)
          : [],
    };
  }

  return result;
}

/**
 * Fallback macro analyzer when MediaPipe doesn't detect full hand landmarks
 * (e.g., extreme macro close-up of 1–3 nails). Analyzes 3 high-res zones and harmonizes all 5 fingers.
 */
function analyzeMacroZonesFallback(img: HTMLImageElement): PerFingerAnalysisResult {
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
    partial[t.fingerId] = analyzeSingleNailROI(img, t.fingerId, pip, dip, tip, true).spec;
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
 * Normalizes a partial/full `fingerSpecs` payload returned by `POST /api/vision/reconstruct-reference`
 * into a strict, length-clamped 5-finger `PerFingerAnalysisResult`.
 */
function normalizeBackendReconstructionResult(
  payload: Record<string, unknown>
): PerFingerAnalysisResult | null {
  const rawSpecs = payload.fingerSpecs as Partial<Record<FingerId, Partial<NailFingerDesignSpec>>> | undefined;
  if (!rawSpecs || typeof rawSpecs !== 'object') return null;

  const partial: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
  const detectedFingerIds: FingerId[] = [];

  for (const id of ORDERED_FINGERS) {
    const raw = rawSpecs[id];
    if (!raw || typeof raw !== 'object') continue;
    const cfg = FINGER_LANDMARKS[id];
    const lengthMultiplier = Number(
      Math.max(
        0.85,
        Math.min(1.65, Number(raw.lengthMultiplier ?? raw.relativeLength ?? cfg.defaultLength))
      ).toFixed(2)
    );
    const shape = normalizeShape(raw.shape, 'almond');
    const pattern = normalizePattern(raw.pattern, 'solid_gloss');
    const baseColor = sanitizeHexColor(raw.baseColor, '#5A0A1E');
    const secondaryColor = sanitizeHexColor(raw.secondaryColor, '#FFFDF9');
    const accentColor = sanitizeHexColor(raw.accentColor, '#D4AF37');
    const hasMetallicOutline = Boolean(raw.hasMetallicOutline);
    const outlineColor = raw.outlineColor ? sanitizeHexColor(raw.outlineColor, accentColor) : undefined;
    const detectedFromPhoto = raw.detectedFromPhoto !== false;

    if (detectedFromPhoto) {
      detectedFingerIds.push(id);
    }

    partial[id] = {
      fingerId: id,
      detectedFromPhoto,
      shape,
      relativeLength: lengthMultiplier,
      lengthMultiplier,
      extensionLevel:
        (raw.extensionLevel as NailExtensionLevel | undefined) ??
        classifyExtensionFromMultiplier(lengthMultiplier),
      extensionMm:
        typeof raw.extensionMm === 'number'
          ? Math.max(1.5, Math.min(12.0, Number(raw.extensionMm.toFixed(1))))
          : computeExtensionMmFromMultiplier(lengthMultiplier),
      tipRoundness:
        typeof raw.tipRoundness === 'number'
          ? Math.max(0, Math.min(1, Number(raw.tipRoundness.toFixed(2))))
          : undefined,
      aspectRatio: typeof raw.aspectRatio === 'number' ? raw.aspectRatio : undefined,
      relativeWidth:
        typeof raw.relativeWidth === 'number'
          ? Math.max(0.78, Math.min(1.30, Number(raw.relativeWidth.toFixed(2))))
          : cfg.defaultWidth,
      baseColor,
      secondaryColor,
      accentColor,
      hasMetallicOutline,
      outlineColor,
      has3DRelief:
        typeof raw.has3DRelief === 'boolean'
          ? raw.has3DRelief
          : pattern === 'gold_3d_waves' || pattern === 'floral_accent' || hasMetallicOutline,
      reliefDescription: typeof raw.reliefDescription === 'string' ? raw.reliefDescription : undefined,
      artDescription: typeof raw.artDescription === 'string' ? raw.artDescription : undefined,
      finishStyle: raw.finishStyle,
      pattern,
      strokeAnchors: Array.isArray(raw.strokeAnchors)
        ? raw.strokeAnchors
        : defaultAnchorsForPattern(pattern),
      metallicIntensity:
        typeof raw.metallicIntensity === 'number'
          ? Math.max(0, Math.min(1, raw.metallicIntensity))
          : hasMetallicOutline || pattern === 'gold_3d_waves'
            ? 0.88
            : 0.14,
      glossIntensity:
        typeof raw.glossIntensity === 'number'
          ? Math.max(0.4, Math.min(1, raw.glossIntensity))
          : 0.96,
      uvPatchDataUrl: typeof raw.uvPatchDataUrl === 'string' ? raw.uvPatchDataUrl : undefined,
      normalMapDataUrl:
        typeof raw.normalMapDataUrl === 'string' ? raw.normalMapDataUrl : undefined,
      displacementMapDataUrl:
        typeof raw.displacementMapDataUrl === 'string' ? raw.displacementMapDataUrl : undefined,
      metalnessMapDataUrl:
        typeof raw.metalnessMapDataUrl === 'string' ? raw.metalnessMapDataUrl : undefined,
      roughnessMapDataUrl:
        typeof raw.roughnessMapDataUrl === 'string' ? raw.roughnessMapDataUrl : undefined,
      isImportedReference: true,
    };
  }

  if (Object.keys(partial).length === 0) return null;

  const fingerSpecs = applyHarmonicInheritance(partial);
  const finalDetected =
    detectedFingerIds.length > 0
      ? detectedFingerIds
      : (Object.keys(partial) as FingerId[]);
  const primary =
    fingerSpecs[finalDetected.includes('middle') ? 'middle' : finalDetected[0]] ??
    fingerSpecs.middle;

  return {
    fingerSpecs,
    detectedFingerIds: finalDetected,
    method: 'mediapipe',
    primaryShape: normalizeShape(payload.primaryShape, primary.shape),
    primaryLength: Number(
      Math.max(
        0.85,
        Math.min(1.65, Number(payload.primaryLength ?? primary.lengthMultiplier ?? primary.relativeLength))
      ).toFixed(2)
    ),
    primaryExtensionLevel:
      (payload.primaryExtensionLevel as NailExtensionLevel | undefined) ?? primary.extensionLevel,
    primaryAspectRatio:
      typeof payload.primaryAspectRatio === 'number'
        ? payload.primaryAspectRatio
        : primary.aspectRatio,
    primaryBaseColor: sanitizeHexColor(payload.primaryBaseColor, primary.baseColor),
    primarySecondaryColor: sanitizeHexColor(
      payload.primarySecondaryColor,
      primary.secondaryColor
    ),
    primaryAccentColor: sanitizeHexColor(payload.primaryAccentColor, primary.accentColor),
    primaryPattern: normalizePattern(payload.primaryPattern, primary.pattern),
  };
}

async function tryBackendReferenceReconstruction(
  imageDataUrl: string
): Promise<PerFingerAnalysisResult | null> {
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  const endpoint = `${apiBase}/api/vision/reconstruct-reference`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return normalizeBackendReconstructionResult(data);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Primary Hybrid Reconstruction Entry-Point (`imageDataUrl`):
 * 1. Calls `POST /api/vision/reconstruct-reference` (respecting `VITE_API_URL`, 12s timeout).
 *    If backend responds 200 OK with reconstructed `fingerSpecs`, returns high-fidelity AI/VLM result directly.
 * 2. Offline / No-API-Key Local High-Res Fallback:
 *    - Runs MediaPipe `HandLandmarker` (`IMAGE` mode, `numHands: 2`) for overlapping 2-hand photos,
 *      scoring each candidate finger specimen by sharpness + nail-vs-skin CIELab contrast + absence of ring occlusion.
 *    - Extracts 320×480 upright ROIs from the full-res image, segments with combined CIELab + HSV + Sobel + elliptical prior,
 *      rectifies 512×512 UV textures (94% plate) preserving deep colors with surgical glare-only inpainting,
 *      and propagates harmonically across all 5 fingers.
 */
export async function analyzeReferencePhotoPerFinger(
  imageDataUrl: string
): Promise<PerFingerAnalysisResult> {
  const backendResult = await tryBackendReferenceReconstruction(imageDataUrl);
  if (backendResult) {
    return backendResult;
  }

  const img = await loadImageFromDataUrl(imageDataUrl, 2200);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const landmarker = await getImageHandLandmarker();
  if (landmarker) {
    try {
      const result = landmarker.detect(img);
      const hands = result.landmarks ?? [];
      const bestByFinger: Partial<Record<FingerId, FingerRoiAnalysisOutput>> = {};

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
          if (segPx < 18) continue;

          const candidate = analyzeSingleNailROI(img, fingerId, pip, dip, tip, true);
          const existing = bestByFinger[fingerId];
          if (!existing || candidate.qualityScore > existing.qualityScore) {
            bestByFinger[fingerId] = candidate;
          }
        }
      }

      const partial: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
      const detectedFingerIds: FingerId[] = [];
      for (const id of ORDERED_FINGERS) {
        const chosen = bestByFinger[id];
        if (chosen) {
          partial[id] = chosen.spec;
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
      // Fall through to macro analyzer
    }
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
 * so every Studio preset ALSO renders through the exact same 1024×1024 PBR pipeline.
 */
export function buildFingerSpecsFromStudioDesign(
  design: NailDesign
): Record<FingerId, NailFingerDesignSpec> {
  if (design.fingerSpecs) {
    return design.fingerSpecs;
  }

  const baseColor = design.baseColor || '#E5BEB3';
  const secondaryColor = design.secondaryColor || '#FFFDF9';
  const accentColor = design.accentColor || '#D4AF37';

  let pattern: ArtisticPattern = 'solid_gloss';
  if (design.patternType === 'french') pattern = 'french_tip';
  else if (design.patternType === 'chrome') pattern = 'chrome_mirror';
  else if (design.patternType === 'gold-foil' || design.patternType === 'marble')
    pattern = 'gold_3d_waves';
  else if (design.patternType === 'ombre' || design.patternType === 'aurora' || design.patternType === 'cat-eye')
    pattern = 'aura_gradient';

  const shape: NailShape = design.detectedShape ?? 'almond';
  const baseLen = Math.max(0.85, Math.min(1.65, design.detectedLength ?? 1.05));
  const metallicIntensity =
    design.finish === 'chrome' || pattern === 'chrome_mirror'
      ? 0.9
      : pattern === 'gold_3d_waves' || design.finish === 'glitter'
        ? 0.86
        : 0.1;
  const glossIntensity = design.finish === 'velvet' ? 0.56 : 0.96;

  const map = {} as Record<FingerId, NailFingerDesignSpec>;
  for (const id of ORDERED_FINGERS) {
    const cfg = FINGER_LANDMARKS[id];
    const fingerLenMult = Number(
      Math.max(0.85, Math.min(1.65, baseLen * cfg.defaultLength)).toFixed(2)
    );
    map[id] = {
      fingerId: id,
      detectedFromPhoto: false,
      shape,
      relativeLength: fingerLenMult,
      lengthMultiplier: fingerLenMult,
      extensionLevel: classifyExtensionFromMultiplier(fingerLenMult),
      extensionMm: computeExtensionMmFromMultiplier(fingerLenMult),
      relativeWidth: cfg.defaultWidth,
      baseColor,
      secondaryColor,
      accentColor,
      hasMetallicOutline: false,
      outlineColor: undefined,
      has3DRelief: pattern === 'gold_3d_waves',
      pattern,
      strokeAnchors: defaultAnchorsForPattern(pattern),
      metallicIntensity,
      glossIntensity,
    };
  }
  return map;
}

/**
 * Alias exported for callers referencing `buildFallbackStudioFingerSpecs`.
 */
export const buildFallbackStudioFingerSpecs = buildFingerSpecsFromStudioDesign;

function hexToLab(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [70, 0, 0];
  const n = parseInt(clean, 16);
  return rgbToLabLike((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

function shadeHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  return rgbToHex(
    ((num >> 16) & 0xff) + amount,
    ((num >> 8) & 0xff) + amount,
    (num & 0xff) + amount
  );
}
