import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type {
  ArtisticPattern,
  FingerId,
  NailDesign,
  NailFingerDesignSpec as BaseNailFingerDesignSpec,
  NailShape,
  StrokeAnchor,
} from '../types/nail';

export type NailExtensionLevel =
  | 'Curta/Natural'
  | 'Pouco Alongada'
  | 'Alongada'
  | 'Muito Alongada (Extrema)';

export type NailFingerDesignSpec = BaseNailFingerDesignSpec & {
  extensionLevel?: NailExtensionLevel;
  aspectRatio?: number;
  lengthMultiplier?: number;
  hasMetallicOutline?: boolean;
  outlineColor?: string;
  uvPatchDataUrl?: string;
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
          minHandDetectionConfidence: 0.28,
          minHandPresenceConfidence: 0.28,
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

function loadImageFromFile(file: File, maxDim = 1600): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
    reader.onload = () => {
      const rawImg = new Image();
      rawImg.onerror = () => reject(new Error('Imagem inválida.'));
      rawImg.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(rawImg.naturalWidth, rawImg.naturalHeight));
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
        norm.src = c.toDataURL('image/jpeg', 0.94);
      };
      rawImg.src = String(reader.result);
    };
    reader.readAsDataURL(file);
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

function rgbToLabLike(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const l = 0.299 * rn + 0.587 * gn + 0.114 * bn;
  const a = 0.5 * (rn - gn) + 0.25 * (rn - bn);
  const bCh = 0.25 * (rn + gn) - 0.5 * bn;
  return [l * 100, a * 120, bCh * 120];
}

function deltaLab(c1: [number, number, number], c2: [number, number, number]): number {
  const dl = (c1[0] - c2[0]) * 0.7;
  const da = (c1[1] - c2[1]) * 1.35;
  const db = (c1[2] - c2[2]) * 1.25;
  return Math.hypot(dl, da, db);
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
  const isWarmGold = r > g * 1.05 && g > b * 1.15 && luma > 0.42 && sat > 0.22;
  // Bright pearl / specular chrome ridge
  const isPearlRidge = luma > 0.78 && gradMag > 0.14;
  return isWarmGold || isPearlRidge;
}

function classifyExtensionFromAspectRatio(aspectRatio: number): {
  extensionLevel: NailExtensionLevel;
  lengthMultiplier: number;
} {
  const ar = Math.max(0.75, Math.min(3.4, aspectRatio));

  if (ar < 1.30) {
    const t = Math.max(0, Math.min(1, (ar - 0.85) / (1.30 - 0.85)));
    return {
      extensionLevel: 'Curta/Natural',
      lengthMultiplier: Number(Math.min(1.65, 0.85 + t * (1.02 - 0.85)).toFixed(2)),
    };
  }
  if (ar < 1.72) {
    const t = Math.max(0, Math.min(1, (ar - 1.30) / (1.72 - 1.30)));
    return {
      extensionLevel: 'Pouco Alongada',
      lengthMultiplier: Number(Math.min(1.65, 1.04 + t * (1.22 - 1.04)).toFixed(2)),
    };
  }
  if (ar < 2.25) {
    const t = Math.max(0, Math.min(1, (ar - 1.72) / (2.25 - 1.72)));
    return {
      extensionLevel: 'Alongada',
      lengthMultiplier: Number(Math.min(1.65, 1.24 + t * (1.44 - 1.24)).toFixed(2)),
    };
  }
  const t = Math.max(0, Math.min(1, (ar - 2.25) / (3.10 - 2.25)));
  return {
    extensionLevel: 'Muito Alongada (Extrema)',
    lengthMultiplier: Number(Math.min(1.65, 1.46 + t * (1.65 - 1.46)).toFixed(2)),
  };
}

function classifyExtensionFromMultiplier(lengthMultiplier: number): NailExtensionLevel {
  if (lengthMultiplier <= 1.03) return 'Curta/Natural';
  if (lengthMultiplier <= 1.23) return 'Pouco Alongada';
  if (lengthMultiplier <= 1.45) return 'Alongada';
  return 'Muito Alongada (Extrema)';
}

/**
 * Generates a rectified 256×256 UV patch strictly from the central 70% of the segmented nail plate
 * using bilinear sampling directly from the source image, followed by chromaticity-preserving
 * Retinex / high-pass lighting equalization to suppress harsh shadows and blown highlights.
 * Orientation: u = 0..1 (left->right), v = 0..1 (cuticle at canvas bottom -> tip at canvas top).
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
  if (nailLen < 8) return undefined;

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
    for (let dy = -2; dy <= 2; dy++) {
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

  // Compute tight source bounding box covering the central 70% plate region
  let minSrcX = imgW;
  let maxSrcX = 0;
  let minSrcY = imgH;
  let maxSrcY = 0;
  const yStart = minY + nailLen * 0.15;
  const yEnd = maxY - nailLen * 0.15;
  for (const ry of [yStart, (yStart + yEnd) * 0.5, yEnd]) {
    const yi = Math.max(minY, Math.min(maxY, Math.round(ry)));
    const l = smoothL[yi];
    const r = smoothR[yi];
    const span = r - l;
    for (const rx of [l + span * 0.15, r - span * 0.15]) {
      const [sx, sy] = roiToImg(rx, ry);
      if (sx < minSrcX) minSrcX = sx;
      if (sx > maxSrcX) maxSrcX = sx;
      if (sy < minSrcY) minSrcY = sy;
      if (sy > maxSrcY) maxSrcY = sy;
    }
  }

  const pad = 6;
  const bx = Math.max(0, Math.floor(minSrcX - pad));
  const by = Math.max(0, Math.floor(minSrcY - pad));
  const bx2 = Math.min(imgW, Math.ceil(maxSrcX + pad));
  const by2 = Math.min(imgH, Math.ceil(maxSrcY + pad));
  const bw = Math.max(4, bx2 - bx);
  const bh = Math.max(4, by2 - by);

  const { ctx: cropCtx } = createScratchCanvas(bw, bh);
  cropCtx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);
  const srcData = cropCtx.getImageData(0, 0, bw, bh).data;

  const size = 256;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = size;
  outCanvas.height = size;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return undefined;

  const outImg = outCtx.createImageData(size, size);
  const patchRGB = new Float32Array(size * size * 3);
  const patchLuma = new Float32Array(size * size);

  // 1. Bilinear sampling strictly over central 70% of nail plate (uPlate, vPlate ∈ [0.15, 0.85])
  for (let py = 0; py < size; py++) {
    // py = 0 is top of canvas (v = 1 tip), py = size-1 is bottom of canvas (v = 0 cuticle)
    const v = 1 - py / (size - 1);
    const vPlate = 0.15 + v * 0.70;
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
    const span = Math.max(2, rx - lx);

    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const uPlate = 0.15 + u * 0.70;
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
      patchLuma[pIdx] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  // 2. Separable low-frequency illumination field estimation (2-pass box blur radius = 28)
  const boxBlur = (src: Float32Array, radius: number): Float32Array => {
    const tmp = new Float32Array(size * size);
    const dst = new Float32Array(size * size);
    const win = radius * 2 + 1;

    // Horizontal pass
    for (let y = 0; y < size; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += src[y * size + Math.max(0, Math.min(size - 1, k))];
      }
      for (let x = 0; x < size; x++) {
        tmp[y * size + x] = sum / win;
        const addX = Math.min(size - 1, x + radius + 1);
        const remX = Math.max(0, x - radius);
        sum += src[y * size + addX] - src[y * size + remX];
      }
    }

    // Vertical pass
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += tmp[Math.max(0, Math.min(size - 1, k)) * size + x];
      }
      for (let y = 0; y < size; y++) {
        dst[y * size + x] = sum / win;
        const addY = Math.min(size - 1, y + radius + 1);
        const remY = Math.max(0, y - radius);
        sum += tmp[addY * size + x] - tmp[remY * size + x];
      }
    }
    return dst;
  };

  const blurPass1 = boxBlur(patchLuma, 28);
  const lowFreqLuma = boxBlur(blurPass1, 20);

  let lumaMean = 0;
  for (let i = 0; i < patchLuma.length; i++) lumaMean += patchLuma[i];
  lumaMean /= patchLuma.length;
  const targetMean = Math.max(55, Math.min(205, lumaMean));

  // 3. Chromaticity-preserving Retinex lighting normalization + gentle specular glare roll-off
  const outBytes = outImg.data;
  for (let i = 0; i < size * size; i++) {
    const r = patchRGB[i * 3];
    const g = patchRGB[i * 3 + 1];
    const b = patchRGB[i * 3 + 2];
    const lum = patchLuma[i];
    const low = Math.max(18, lowFreqLuma[i]);

    // Gentle inverse illumination gain (exponent 0.56 keeps dark/light polish identity intact)
    const ratio = targetMean / low;
    const gain = Math.max(0.72, Math.min(1.38, Math.pow(ratio, 0.56)));

    let rr = r * gain;
    let gg = g * gain;
    let bb = b * gain;

    // Gentle glare compression for blown-out low-saturation specular streaks
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    if (lum > 230 && sat < 0.14) {
      const glareMix = Math.min(0.45, ((lum - 230) / 25) * 0.45);
      const localTarget = Math.min(218, low * gain);
      const scaleGlare = localTarget / Math.max(1, lum * gain);
      rr = rr * (1 - glareMix) + rr * scaleGlare * glareMix;
      gg = gg * (1 - glareMix) + gg * scaleGlare * glareMix;
      bb = bb * (1 - glareMix) + bb * scaleGlare * glareMix;
    }

    const p4 = i * 4;
    outBytes[p4] = Math.max(0, Math.min(255, Math.round(rr)));
    outBytes[p4 + 1] = Math.max(0, Math.min(255, Math.round(gg)));
    outBytes[p4 + 2] = Math.max(0, Math.min(255, Math.round(bb)));
    outBytes[p4 + 3] = 255;
  }

  outCtx.putImageData(outImg, 0, 0);
  try {
    const webp = outCanvas.toDataURL('image/webp', 0.90);
    if (webp.startsWith('data:image/webp')) return webp;
  } catch {
    // Fallback to PNG below
  }
  return outCanvas.toDataURL('image/png');
}

/**
 * Segments strictly the nail plate pixels inside an upright ROI, measures 3D shape & proportions,
 * extracts 3 chromatic layers (base, secondary, accent), classifies the artistic pattern, and
 * detects exact normalized strokeAnchors `(u, v)` for 3D reliefs.
 */
function analyzeSingleNailROI(
  img: HTMLImageElement,
  fingerId: FingerId,
  pipNorm: { x: number; y: number },
  dipNorm: { x: number; y: number },
  tipNorm: { x: number; y: number },
  detectedFromPhoto: boolean
): NailFingerDesignSpec {
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
    aspectRatio: Number((1.15 * defaultMult).toFixed(2)),
    relativeWidth: cfg.defaultWidth,
    baseColor: '#E5BEB3',
    secondaryColor: '#FFF7F3',
    accentColor: '#D4AF37',
    hasMetallicOutline: false,
    outlineColor: undefined,
    pattern: 'solid_gloss',
    strokeAnchors: [],
    metallicIntensity: 0.12,
    glossIntensity: 0.92,
    isImportedReference: true,
  };

  try {
    // 1. Sample phalanx skin color between PIP -> DIP
    const { ctx: skinCtx } = createScratchCanvas(24, 24);
    const sx = ((pipNorm.x + dipNorm.x) * 0.5) * imgW;
    const sy = ((pipNorm.y + dipNorm.y) * 0.5) * imgH;
    const dx = (tipNorm.x - dipNorm.x) * imgW;
    const dy = (tipNorm.y - dipNorm.y) * imgH;
    const segPx = Math.max(18, Math.hypot(dx, dy));
    const patch = Math.max(8, Math.round(segPx * 0.26));

    skinCtx.drawImage(
      img,
      Math.max(0, Math.min(imgW - patch, sx - patch / 2)),
      Math.max(0, Math.min(imgH - patch, sy - patch / 2)),
      patch,
      patch,
      0,
      0,
      24,
      24
    );
    const skinPixels = skinCtx.getImageData(0, 0, 24, 24).data;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sc = 0;
    for (let i = 0; i < skinPixels.length; i += 4) {
      sr += skinPixels[i];
      sg += skinPixels[i + 1];
      sb += skinPixels[i + 2];
      sc++;
    }
    const skinLab = rgbToLabLike(sr / Math.max(1, sc), sg / Math.max(1, sc), sb / Math.max(1, sc));

    // 2. Render upright ROI centered around nail plate (DIP -> past TIP)
    const roiW = 80;
    const roiH = 120;
    const { ctx: roiCtx } = createScratchCanvas(roiW, roiH);
    const angleRad = Math.atan2(dy, dx) + Math.PI / 2;
    const anchorX = (dipNorm.x + 0.7 * (tipNorm.x - dipNorm.x)) * imgW;
    const anchorY = (dipNorm.y + 0.7 * (tipNorm.y - dipNorm.y)) * imgH;
    const roiSpanH = segPx * 1.92;
    const scale = roiH / roiSpanH;

    roiCtx.save();
    roiCtx.translate(roiW / 2, roiH / 2);
    roiCtx.scale(scale, scale);
    roiCtx.rotate(-angleRad);
    roiCtx.drawImage(img, -anchorX, -anchorY);
    roiCtx.restore();

    const { data } = roiCtx.getImageData(0, 0, roiW, roiH);

    // Background lab from upper distal ROI corners
    const cornerOffsets = [0, (roiW - 1) * 4, (roiW * 2 + 2) * 4, (roiW * 3 - 3) * 4];
    let br = 0;
    let bg = 0;
    let bb = 0;
    for (const off of cornerOffsets) {
      br += data[off];
      bg += data[off + 1];
      bb += data[off + 2];
    }
    const bgLab = rgbToLabLike(br / 4, bg / 4, bb / 4);

    // 3. Segment strictly the nail plate pixels (excluding skin/rings/background)
    const rowLeft = new Int16Array(roiH).fill(-1);
    const rowRight = new Int16Array(roiH).fill(-1);
    const rowWidths = new Float32Array(roiH);
    let minY = roiH;
    let maxY = 0;
    let maxWidth = 0;
    let activeRows = 0;

    const isNailPixel = (x: number, y: number): boolean => {
      const idx = (y * roiW + x) * 4;
      const pLab = rgbToLabLike(data[idx], data[idx + 1], data[idx + 2]);
      const dSkin = deltaLab(pLab, skinLab);
      const dBg = deltaLab(pLab, bgLab);
      const nIdx = (y * roiW + Math.max(0, x - 1)) * 4;
      const grad =
        Math.abs(data[idx] - data[nIdx]) +
        Math.abs(data[idx + 1] - data[nIdx + 1]) +
        Math.abs(data[idx + 2] - data[nIdx + 2]);
      return (dSkin > 10.2 || grad > 36) && dBg > 7.2;
    };

    for (let y = Math.round(roiH * 0.06); y < Math.round(roiH * 0.88); y++) {
      const cx = Math.floor(roiW / 2);
      let left = cx;
      let right = cx;
      let found = false;
      for (let off = 0; off <= 12; off++) {
        if (cx + off < roiW - 4 && isNailPixel(cx + off, y)) {
          left = cx + off;
          right = left;
          found = true;
          break;
        }
        if (cx - off >= 4 && isNailPixel(cx - off, y)) {
          left = cx - off;
          right = left;
          found = true;
          break;
        }
      }
      if (!found) continue;

      let missL = 0;
      while (left > 3 && missL < 2) {
        if (isNailPixel(left - 1, y)) {
          left--;
          missL = 0;
        } else {
          missL++;
          left--;
        }
      }
      let missR = 0;
      while (right < roiW - 4 && missR < 2) {
        if (isNailPixel(right + 1, y)) {
          right++;
          missR = 0;
        } else {
          missR++;
          right++;
        }
      }

      const w = right - left + 1;
      if (w >= 6 && w <= roiW * 0.72) {
        rowLeft[y] = left;
        rowRight[y] = right;
        rowWidths[y] = w;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (w > maxWidth) maxWidth = w;
        activeRows++;
      }
    }

    if (activeRows < 8 || maxWidth < 7) {
      // Fallback rectangular plate inside center of ROI
      minY = Math.round(roiH * 0.22);
      maxY = Math.round(roiH * 0.78);
      maxWidth = Math.round(roiW * 0.36);
      for (let y = minY; y <= maxY; y++) {
        rowLeft[y] = Math.round(roiW * 0.32);
        rowRight[y] = Math.round(roiW * 0.68);
        rowWidths[y] = rowRight[y] - rowLeft[y] + 1;
      }
    }

    const nailLength = Math.max(12, maxY - minY);

    const sampleBandWidth = (fracFromCuticle: number): number => {
      const targetY = Math.round(maxY - nailLength * fracFromCuticle);
      let acc = 0;
      let cnt = 0;
      for (let dyb = -2; dyb <= 2; dyb++) {
        const yy = Math.max(0, Math.min(roiH - 1, targetY + dyb));
        if (rowWidths[yy] > 0) {
          acc += rowWidths[yy];
          cnt++;
        }
      }
      return cnt > 0 ? acc / cnt : maxWidth;
    };

    const baseWidth = Math.max(6, sampleBandWidth(0.34), maxWidth * 0.88);
    const aspectRatio = Number((nailLength / baseWidth).toFixed(2));

    const widthAt76 = sampleBandWidth(0.76);
    const widthAt86 = sampleBandWidth(0.86);
    const widthAt95 = sampleBandWidth(0.95);

    // Relative width near tip (topWidth / baseWidth) & tip apex curvature
    const tipTapering = Math.max(0.06, Math.min(1.15, widthAt86 / baseWidth));
    const tipFlatness = Math.max(0, Math.min(1, widthAt95 / Math.max(3, widthAt86)));
    const midToTipSlope = Math.max(0, Math.min(1, (widthAt76 - widthAt95) / baseWidth));
    const apexCurvature = Math.max(
      0,
      Math.min(1, (1 - tipFlatness) * 0.65 + midToTipSlope * 0.35)
    );

    // Shape classification combining aspectRatio, tipTapering (topWidth/baseWidth), and apexCurvature
    // Note: NailShape 'coffin' represents Bailarina in the 3D geometry/material catalog.
    let shape: NailShape = 'almond';
    if (aspectRatio < 1.30) {
      shape = tipTapering >= 0.82 && apexCurvature < 0.32 ? 'square' : 'natural';
    } else if (
      tipTapering < 0.34 ||
      (aspectRatio >= 1.68 && tipTapering < 0.44 && apexCurvature >= 0.46)
    ) {
      shape = 'stiletto';
    } else if (tipTapering >= 0.78 && apexCurvature < 0.36) {
      shape = 'square';
    } else if (tipTapering >= 0.46 && tipTapering < 0.78 && apexCurvature < 0.44) {
      shape = 'coffin';
    } else {
      shape = 'almond';
    }

    const { extensionLevel, lengthMultiplier } = classifyExtensionFromAspectRatio(aspectRatio);
    const relativeLength = lengthMultiplier;
    const relativeWidth = Number(
      Math.max(0.78, Math.min(1.30, cfg.defaultWidth * (baseWidth / (roiW * 0.36)))).toFixed(2)
    );

    // 4. Hyper-Detailed 3-Zone Analysis inside segmented nail plate:
    //    Zone 1: Central Core (u ∈ [0.16, 0.84], v ∈ [0.14, 0.82]) — dominant polish base excluding pure specular glare
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
    let ridgeCount = 0;

    const getLuma = (x: number, y: number): number => {
      const cx = Math.max(0, Math.min(roiW - 1, x));
      const cy = Math.max(0, Math.min(roiH - 1, y));
      const p = (cy * roiW + cx) * 4;
      return (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
    };

    for (let y = minY; y <= maxY; y++) {
      const lx = rowLeft[y];
      const rx = rowRight[y];
      if (lx < 0 || rx <= lx) continue;

      // v = 0 at cuticle (maxY), v = 1 at tip (minY)
      const v = (maxY - y) / nailLength;
      const span = rx - lx;
      if (span < 4) continue;

      for (let x = lx; x <= rx; x++) {
        const p = (y * roiW + x) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const u = (x - lx) / Math.max(1, span);

        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        const gx = getLuma(x + 1, y) - getLuma(x - 1, y);
        const gy = getLuma(x, y + 1) - getLuma(x, y - 1);
        const grad = Math.hypot(gx, gy);

        // Skip extreme outer 1px background/skin bleed on perimeter checks
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

        // Strict inner plate bounds (avoiding sidewall skin bleed)
        if (u < 0.10 || u > 0.90) continue;

        totalPlatePixels++;
        lumaSum += lum;
        lumaSqSum += lum * lum;
        if (grad > 0.13) ridgeCount++;

        // Zone 1: Central Core u ∈ [0.16, 0.84], v ∈ [0.14, 0.82] excluding pure specular highlights
        const isPureSpecularGlare = lum > 0.93 && sat < 0.09 && grad < 0.18;
        if (u >= 0.16 && u <= 0.84 && v >= 0.14 && v <= 0.82 && !isPureSpecularGlare) {
          centralZoneSamples.push([r, g, b]);
        }

        if (v >= 0.72 && v <= 0.94 && u >= 0.2 && u <= 0.8) {
          tipSamples.push([r, g, b]);
        }

        const radialDist = Math.hypot((u - 0.5) * 1.4, (v - 0.5) * 1.2);
        if (radialDist < 0.28) {
          centerAuraSamples.push([r, g, b]);
        } else if (radialDist > 0.44) {
          outerAuraSamples.push([r, g, b]);
        }

        if (isGoldOrMetallicPixel(r, g, b, grad)) {
          accentSamples.push([r, g, b]);
          metallicPoints.push({ u, v, r, g, b, grad });
        }
      }
    }

    // Dominant cluster median for Zone 1 (immune to floral/art blobs occupying < 45% of nail)
    const baseColor = extractDominantColorCluster(centralZoneSamples, defaultSpec.baseColor);
    const baseLab = hexToLab(baseColor);

    const tipColor = medianRgbColor(tipSamples, baseColor);
    const tipLab = hexToLab(tipColor);
    const centerAuraColor = medianRgbColor(centerAuraSamples, baseColor);
    const outerAuraColor = medianRgbColor(outerAuraSamples, baseColor);

    // Zone 2: Evaluate 5% perimeter border contrast / metallic rim
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
      lateralPerimeterSamples.length >= 4 &&
      lateralContrastSamples.length / Math.max(1, lateralPerimeterSamples.length) > 0.22;

    const perimeterCandidateColor =
      perimeterMetallicSamples.length >= 4
        ? medianRgbColor(perimeterMetallicSamples, baseColor)
        : perimeterContrastSamples.length >= 4
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

    // Zone 3: Connected-component blob & stroke detection inside core/body (u ∈ [0.12, 0.88], v ∈ [0.10, 0.88])
    const contrastMask = new Uint8Array(roiW * roiH);
    const maskPixels: Array<{ x: number; y: number; u: number; v: number; r: number; g: number; b: number; isMetal: boolean }> = [];

    for (let y = minY; y <= maxY; y++) {
      const lx = rowLeft[y];
      const rx = rowRight[y];
      if (lx < 0 || rx <= lx) continue;
      const v = (maxY - y) / nailLength;
      if (v < 0.10 || v > 0.88) continue;
      const span = rx - lx;
      for (let x = Math.round(lx + span * 0.12); x <= Math.round(rx - span * 0.12); x++) {
        const p = (y * roiW + x) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        const gx = getLuma(x + 1, y) - getLuma(x - 1, y);
        const gy = getLuma(x, y + 1) - getLuma(x, y - 1);
        const grad = Math.hypot(gx, gy);

        // Exclude smooth specular reflection highlights from artwork blobs
        if (lum > 0.92 && sat < 0.09 && grad < 0.16) continue;

        const pLab = rgbToLabLike(r, g, b);
        const dBase = deltaLab(pLab, baseLab);
        const isMetal = isGoldOrMetallicPixel(r, g, b, grad);
        if (dBase > 15.5 || (isMetal && dBase > 10.5)) {
          contrastMask[y * roiW + x] = 1;
          maskPixels.push({
            x,
            y,
            u: (x - lx) / Math.max(1, span),
            v,
            r,
            g,
            b,
            isMetal,
          });
        }
      }
    }

    // Connected components on contrastMask
    const visited = new Uint8Array(roiW * roiH);
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
      const startIdx = seed.y * roiW + seed.x;
      if (visited[startIdx] || !contrastMask[startIdx]) continue;

      const queue: number[] = [startIdx];
      visited[startIdx] = 1;
      const pts: Array<{ u: number; v: number; r: number; g: number; b: number; isMetal: boolean }> = [];

      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        const cy = Math.floor(cur / roiW);
        const cx = cur - cy * roiW;
        const lx = rowLeft[cy];
        const rx = rowRight[cy];
        const span = Math.max(1, rx - lx);
        const p = cur * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const gx = getLuma(cx + 1, cy) - getLuma(cx - 1, cy);
        const gy = getLuma(cx, cy + 1) - getLuma(cx, cy - 1);
        pts.push({
          u: (cx - lx) / span,
          v: (maxY - cy) / nailLength,
          r,
          g,
          b,
          isMetal: isGoldOrMetallicPixel(r, g, b, Math.hypot(gx, gy)),
        });

        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || nx >= roiW || ny < minY || ny > maxY) continue;
            const nIdx = ny * roiW + nx;
            if (!visited[nIdx] && contrastMask[nIdx]) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }
      }

      if (pts.length < 4) continue;

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

      // 2x2 covariance PCA for eccentricity & stroke orientation
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
      // Detect contrasting inner pistil / center dot inside compact clusters (e.g. gold/light dot inside red flower)
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
        isMetallic: metalHits / pts.length > 0.38,
        dominantColor: domHex,
        centerDotColor:
          innerDotRgbs.length >= 2 ? medianRgbColor(innerDotRgbs, '#D4AF37') : null,
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

    const meaningfulComponents = components.filter((c) => c.count >= 5);
    const elongatedStrokeCount = meaningfulComponents.filter(
      (c) => c.eccentricity >= 0.82 && (c.isMetallic || metallicRatio > 0.03)
    ).length;
    const compactBlobCount = meaningfulComponents.filter(
      (c) => c.eccentricity < 0.84
    ).length;

    const detectedAnchors: StrokeAnchor[] = meaningfulComponents.slice(0, 4).map((c) => ({
      u: Number(Math.max(0.16, Math.min(0.84, c.cu)).toFixed(2)),
      v: Number(Math.max(0.16, Math.min(0.86, c.cv)).toFixed(2)),
      radius: Number(c.radius.toFixed(2)),
      angle: Number(c.angle.toFixed(2)),
    }));
    const strokeAnchors =
      detectedAnchors.length > 0 ? detectedAnchors : clusterStrokeAnchors(metallicPoints);

    // Classify artistic pattern from 3-zone spatial + PCA eccentricity signals
    let pattern: ArtisticPattern = 'solid_gloss';
    let secondaryColor = tipColor;
    let accentColor =
      outlineColor ??
      (accentSamples.length > 4
        ? medianRgbColor(accentSamples, '#D4AF37')
        : '#D4AF37');

    const topBlob = meaningfulComponents[0];
    const hasInnerFloralDot = meaningfulComponents.some((c) => c.centerDotColor !== null);

    if (
      (elongatedStrokeCount >= 1 && metallicRatio > 0.028) ||
      (metallicRatio > 0.048 && ridgeDensity > 0.075 && strokeAnchors.length >= 2 && compactBlobCount === 0)
    ) {
      pattern = 'gold_3d_waves';
      const metalComp = meaningfulComponents.find((c) => c.isMetallic);
      accentColor =
        metalComp?.dominantColor ??
        (accentSamples.length > 3 ? medianRgbColor(accentSamples, '#D4AF37') : accentColor);
      secondaryColor =
        hasMetallicOutline && outlineColor
          ? outlineColor
          : tipColor !== baseColor
            ? tipColor
            : shadeHex(baseColor, 14);
    } else if (
      (compactBlobCount >= 1 && topBlob && topBlob.count >= 8 && (hasInnerFloralDot || compactBlobCount >= 2)) ||
      (meaningfulComponents.length >= 2 && compactBlobCount >= 2 && ridgeDensity > 0.04)
    ) {
      pattern = 'floral_accent';
      const petalBlob =
        meaningfulComponents.find((c) => !c.isMetallic) ?? topBlob;
      secondaryColor = petalBlob ? petalBlob.dominantColor : '#FFFDF9';
      const dotBlob = meaningfulComponents.find((c) => c.centerDotColor !== null);
      accentColor =
        dotBlob?.centerDotColor ??
        outlineColor ??
        (accentSamples.length > 3 ? medianRgbColor(accentSamples, '#D4AF37') : '#D4AF37');
    } else if (baseTipDelta > 16 && radialDelta < 18 && meaningfulComponents.length <= 1) {
      pattern = 'french_tip';
      secondaryColor = tipColor;
    } else if (radialDelta > 15 && meaningfulComponents.length === 0) {
      pattern = 'aura_gradient';
      secondaryColor = centerAuraColor;
    } else if (lumaVariance > 0.032 && meanLuma > 0.58 && meaningfulComponents.length === 0) {
      pattern = 'chrome_mirror';
      secondaryColor = '#FFFFFF';
      accentColor = accentSamples.length > 3 ? accentColor : '#F5E7DF';
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
            ? 0.45
            : 0.08;

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

    return {
      fingerId,
      detectedFromPhoto,
      shape,
      relativeLength,
      lengthMultiplier,
      extensionLevel,
      aspectRatio,
      relativeWidth,
      baseColor,
      secondaryColor,
      accentColor,
      hasMetallicOutline,
      outlineColor,
      pattern,
      strokeAnchors:
        strokeAnchors.length > 0
          ? strokeAnchors
          : defaultAnchorsForPattern(pattern),
      metallicIntensity,
      glossIntensity: pattern === 'chrome_mirror' ? 1.0 : 0.94,
      uvPatchDataUrl,
      isImportedReference: true,
    };
  } catch {
    return defaultSpec;
  }
}

function extractDominantColorCluster(
  samples: Array<[number, number, number]>,
  fallback: string
): string {
  if (samples.length === 0) return fallback;
  if (samples.length < 6) return medianRgbColor(samples, fallback);

  // Coarse 3D RGB quantization (step 24) to isolate dominant base polish even with central nail art
  const bins = new Map<string, { sumR: number; sumG: number; sumB: number; count: number }>();
  for (const [r, g, b] of samples) {
    const key = `${Math.floor(r / 24)}_${Math.floor(g / 24)}_${Math.floor(b / 24)}`;
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
    ([r, g, b]) => deltaLab(rgbToLabLike(r, g, b), seedLab) < 18
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
 * If any of the 5 fingers wasn't visible in the photo (or on 1–3 nail macro shots),
 * propagates cohesive luxury salon harmony across all 5 fingers—preserving ornate accent nail
 * placement on `ring` / `middle` while harmonizing adjacent missing fingers!
 */
function applyHarmonicInheritance(
  partial: Partial<Record<FingerId, NailFingerDesignSpec>>
): Record<FingerId, NailFingerDesignSpec> {
  const detected = ORDERED_FINGERS.map((id) => partial[id]).filter(
    (s): s is NailFingerDesignSpec => Boolean(s)
  );

  // Pick richest artistic spec as accent donor & cleanest gel/french spec as companion donor
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
    // Ring finger inherits ornate accent style if detected anywhere; others harmonize cleanly
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
      aspectRatio: donor.aspectRatio,
      relativeWidth: cfg.defaultWidth,
      hasMetallicOutline: donor.hasMetallicOutline ?? false,
      outlineColor: donor.outlineColor,
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
 * (e.g., extreme macro close-up of 1–3 nails). Analyzes 3 sharpest zones and harmonizes all 5 fingers.
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
    partial[t.fingerId] = analyzeSingleNailROI(img, t.fingerId, pip, dip, tip, true);
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
 * Pillar 1 — Per-Finger Independent Vision Analyzer:
 * Runs MediaPipe HandLandmarker (IMAGE mode, numHands: 2) to locate ALL visible fingers
 * (thumb, index, middle, ring, pinky), segments each nail plate independently, extracts
 * 3 chromatic layers + shape + pattern + strokeAnchors, and harmonizes any unseen fingers.
 */
export async function analyzeReferencePerFinger(file: File): Promise<PerFingerAnalysisResult> {
  const img = await loadImageFromFile(file, 1600);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const landmarker = await getImageHandLandmarker();
  if (landmarker) {
    try {
      const result = landmarker.detect(img);
      const hands = result.landmarks ?? [];
      const partial: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
      const detectedFingerIds: FingerId[] = [];

      for (const hand of hands) {
        if (!hand || hand.length < 21) continue;
        for (const fingerId of ORDERED_FINGERS) {
          if (partial[fingerId]) continue; // keep clearest first detection per anatomical finger
          const cfg = FINGER_LANDMARKS[fingerId];
          const tip = hand[cfg.tipIdx];
          const dip = hand[cfg.dipIdx];
          const pip = hand[cfg.pipIdx];

          if (
            tip.x < 0.03 ||
            tip.x > 0.97 ||
            tip.y < 0.03 ||
            tip.y > 0.97 ||
            dip.x < 0.02 ||
            dip.x > 0.98 ||
            dip.y < 0.02 ||
            dip.y > 0.98
          ) {
            continue;
          }

          const segPx = Math.hypot((tip.x - dip.x) * w, (tip.y - dip.y) * h);
          if (segPx < 16) continue;

          partial[fingerId] = analyzeSingleNailROI(img, fingerId, pip, dip, tip, true);
          detectedFingerIds.push(fingerId);
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
 * Converts any Studio Catalog `NailDesign` into a cohesive 5-finger `NailFingerDesignSpec` map
 * so every Studio preset ALSO renders through the exact same procedural 1024×1024 PBR pipeline!
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
      relativeWidth: cfg.defaultWidth,
      baseColor,
      secondaryColor,
      accentColor,
      hasMetallicOutline: false,
      outlineColor: undefined,
      pattern,
      strokeAnchors: defaultAnchorsForPattern(pattern),
      metallicIntensity,
      glossIntensity,
    };
  }
  return map;
}

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
