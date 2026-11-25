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
};

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
      lengthMultiplier: Number((0.85 + t * (1.02 - 0.85)).toFixed(2)),
    };
  }
  if (ar < 1.72) {
    const t = Math.max(0, Math.min(1, (ar - 1.30) / (1.72 - 1.30)));
    return {
      extensionLevel: 'Pouco Alongada',
      lengthMultiplier: Number((1.05 + t * (1.25 - 1.05)).toFixed(2)),
    };
  }
  if (ar < 2.25) {
    const t = Math.max(0, Math.min(1, (ar - 1.72) / (2.25 - 1.72)));
    return {
      extensionLevel: 'Alongada',
      lengthMultiplier: Number((1.28 + t * (1.52 - 1.28)).toFixed(2)),
    };
  }
  const t = Math.max(0, Math.min(1, (ar - 2.25) / (3.10 - 2.25)));
  return {
    extensionLevel: 'Muito Alongada (Extrema)',
    lengthMultiplier: Number((1.55 + t * (1.85 - 1.55)).toFixed(2)),
  };
}

function classifyExtensionFromMultiplier(lengthMultiplier: number): NailExtensionLevel {
  if (lengthMultiplier <= 1.03) return 'Curta/Natural';
  if (lengthMultiplier <= 1.26) return 'Pouco Alongada';
  if (lengthMultiplier <= 1.53) return 'Alongada';
  return 'Muito Alongada (Extrema)';
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

  const defaultMult = Number(Math.max(0.85, Math.min(1.85, cfg.defaultLength)).toFixed(2));
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
    pattern: 'solid_gloss',
    strokeAnchors: [],
    metallicIntensity: 0.12,
    glossIntensity: 0.92,
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

    // 4. Extract 3 chromatic layers & classify artistic pattern strictly inside segmented nail plate
    const baseSamples: Array<[number, number, number]> = [];
    const tipSamples: Array<[number, number, number]> = [];
    const centerSamples: Array<[number, number, number]> = [];
    const borderSamples: Array<[number, number, number]> = [];
    const accentSamples: Array<[number, number, number]> = [];
    const metallicPoints: Array<{ u: number; v: number; r: number; g: number; b: number; grad: number }> = [];

    let totalPlatePixels = 0;
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

      // Shrink laterally by 12% to strictly avoid sidewall skin bleed
      const xStart = Math.round(lx + span * 0.12);
      const xEnd = Math.round(rx - span * 0.12);

      for (let x = xStart; x <= xEnd; x++) {
        const p = (y * roiW + x) * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const u = (x - lx) / Math.max(1, span);

        const gx = getLuma(x + 1, y) - getLuma(x - 1, y);
        const gy = getLuma(x, y + 1) - getLuma(x, y - 1);
        const grad = Math.hypot(gx, gy);
        const lum = getLuma(x, y);

        totalPlatePixels++;
        lumaSum += lum;
        lumaSqSum += lum * lum;
        if (grad > 0.13) ridgeCount++;

        if (v >= 0.15 && v <= 0.55) {
          baseSamples.push([r, g, b]);
        }
        if (v >= 0.62 && v <= 0.92) {
          tipSamples.push([r, g, b]);
        }

        const radialDist = Math.hypot((u - 0.5) * 1.4, (v - 0.5) * 1.2);
        if (radialDist < 0.28) {
          centerSamples.push([r, g, b]);
        } else if (radialDist > 0.45) {
          borderSamples.push([r, g, b]);
        }

        if (isGoldOrMetallicPixel(r, g, b, grad)) {
          accentSamples.push([r, g, b]);
          metallicPoints.push({ u, v, r, g, b, grad });
        }
      }
    }

    const baseColor = medianRgbColor(baseSamples, defaultSpec.baseColor);
    const tipColor = medianRgbColor(tipSamples, baseColor);
    const centerColor = medianRgbColor(centerSamples, baseColor);
    const borderColor = medianRgbColor(borderSamples, baseColor);

    const baseLab = hexToLab(baseColor);
    const tipLab = hexToLab(tipColor);
    const centerLab = hexToLab(centerColor);
    const borderLab = hexToLab(borderColor);

    const baseTipDelta = deltaLab(baseLab, tipLab);
    const radialDelta = deltaLab(centerLab, borderLab);

    const meanLuma = lumaSum / Math.max(1, totalPlatePixels);
    const lumaVariance = Math.max(0, lumaSqSum / Math.max(1, totalPlatePixels) - meanLuma * meanLuma);
    const ridgeDensity = ridgeCount / Math.max(1, totalPlatePixels);
    const metallicRatio = metallicPoints.length / Math.max(1, totalPlatePixels);

    // Cluster metallic/accent points into up to 4 clean strokeAnchors
    const strokeAnchors = clusterStrokeAnchors(metallicPoints);

    // Classify artistic pattern from real chromatic & gradient signals
    let pattern: ArtisticPattern = 'solid_gloss';
    let secondaryColor = tipColor;
    let accentColor =
      accentSamples.length > 4
        ? medianRgbColor(accentSamples, '#D4AF37')
        : '#D4AF37';

    if (metallicRatio > 0.045 && ridgeDensity > 0.075 && strokeAnchors.length >= 2) {
      pattern = 'gold_3d_waves';
      secondaryColor = tipColor !== baseColor ? tipColor : shadeHex(baseColor, 14);
    } else if (baseTipDelta > 16 && radialDelta < 18) {
      pattern = 'french_tip';
      secondaryColor = tipColor;
    } else if (radialDelta > 15) {
      pattern = 'aura_gradient';
      baseSamples.length > 0 && (secondaryColor = centerColor);
    } else if (lumaVariance > 0.032 && meanLuma > 0.58) {
      pattern = 'chrome_mirror';
      secondaryColor = '#FFFFFF';
      accentColor = accentSamples.length > 3 ? accentColor : '#F5E7DF';
    } else if (strokeAnchors.length >= 3 && ridgeDensity > 0.055) {
      pattern = 'floral_accent';
      secondaryColor = '#FFFDF9';
    } else {
      pattern = 'solid_gloss';
      secondaryColor = shadeHex(baseColor, -14);
    }

    const metallicIntensity =
      pattern === 'chrome_mirror'
        ? 0.92
        : pattern === 'gold_3d_waves'
          ? 0.88
          : pattern === 'floral_accent'
            ? 0.45
            : 0.08;

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
      pattern,
      strokeAnchors:
        strokeAnchors.length > 0
          ? strokeAnchors
          : defaultAnchorsForPattern(pattern),
      metallicIntensity,
      glossIntensity: pattern === 'chrome_mirror' ? 1.0 : 0.94,
    };
  } catch {
    return defaultSpec;
  }
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
          1.85,
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
      pattern: inheritedPattern,
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
  const baseLen = Math.max(0.85, Math.min(1.85, design.detectedLength ?? 1.05));
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
      Math.max(0.85, Math.min(1.85, baseLen * cfg.defaultLength)).toFixed(2)
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
