import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import type { NailDesign, NailShape } from '../types/nail';

export interface NailCropFrame {
  /** Normalized focal center X (0..1) on the source image */
  cx: number;
  /** Normalized focal center Y (0..1) on the source image */
  cy: number;
  /** Angle in radians to rotate the finger upright along -Y */
  angleRad: number;
  /** Base vertical span in source pixels at zoom = 1.0 */
  baseSpanPx: number;
}

export interface DetectedNailTarget {
  id: string;
  /** Short quick-switch button label: "Unha 1", "Unha 2", ... */
  shortLabel: string;
  /** Anatomical finger name when detected by MediaPipe */
  fingerName: string;
  frame: NailCropFrame;
  /** Crisp preview thumbnail of strictly this nail's interior */
  thumbDataUrl: string;
  dominantColor: string;
  /** Automatically inferred 3D shape from chromatic contour segmentation */
  detectedShape: NailShape;
  /** Automatically inferred extension length ratio (0.82 to 1.65) */
  detectedLength: number;
  /** Contour diagnostic metrics */
  contourMetrics: {
    aspectRatio: number;
    tipTaper: number;
  };
}

export interface NailExtractionResult {
  sourceImage: HTMLImageElement;
  method: 'mediapipe' | 'smart-macro';
  detectedNails: DetectedNailTarget[];
  initialIndex: number;
}

export interface LoupeAdjustment {
  /** Pan offset X in normalized units of current visible crop width */
  offsetX: number;
  /** Pan offset Y in normalized units of current visible crop height */
  offsetY: number;
  /** Loupe zoom multiplier (2.0x to 8.0x; default 4.5x focuses strictly inside the nail plate) */
  zoom: number;
  /** Fine manual rotation in degrees (-45 to +45) */
  rotationDeg: number;
}

export interface PBRTextureBundle {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  metalnessMap: THREE.CanvasTexture;
  alphaMap: THREE.CanvasTexture;
  dispose: () => void;
}

export const DEFAULT_LOUPE_ZOOM = 4.5;
export const MIN_LOUPE_ZOOM = 2.0;
export const MAX_LOUPE_ZOOM = 8.0;

export const DEFAULT_LOUPE_ADJUSTMENT: LoupeAdjustment = {
  offsetX: 0,
  offsetY: 0,
  zoom: DEFAULT_LOUPE_ZOOM,
  rotationDeg: 0,
};

let cachedImageLandmarker: HandLandmarker | null = null;
let imageLandmarkerPromise: Promise<HandLandmarker | null> | null = null;

async function getImageHandLandmarker(): Promise<HandLandmarker | null> {
  if (cachedImageLandmarker) return cachedImageLandmarker;
  if (!imageLandmarkerPromise) {
    imageLandmarkerPromise = (async () => {
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
          minHandDetectionConfidence: 0.3,
          minHandPresenceConfidence: 0.3,
        });
        cachedImageLandmarker = landmarker;
        return landmarker;
      } catch {
        imageLandmarkerPromise = null;
        return null;
      }
    })();
  }
  return imageLandmarkerPromise;
}

type ScratchCanvas = OffscreenCanvas | HTMLCanvasElement;
type ScratchContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createScratchCanvas(w: number, h: number): {
  canvas: ScratchCanvas;
  ctx: ScratchContext;
} {
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

function createOutputCanvas(w: number, h: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d', { willReadFrequently: true })!;
  return { canvas: el, ctx };
}

function loadImageFromFile(file: File, maxDim = 1600): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo da foto.'));
    reader.onload = () => {
      const rawImg = new Image();
      rawImg.onerror = () => reject(new Error('Formato de imagem inválido.'));
      rawImg.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(rawImg.naturalWidth, rawImg.naturalHeight));
        if (scale >= 0.99) {
          resolve(rawImg);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(rawImg.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(rawImg.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawImg);
          return;
        }
        ctx.drawImage(rawImg, 0, 0, canvas.width, canvas.height);
        const normalized = new Image();
        normalized.onload = () => resolve(normalized);
        normalized.onerror = () => resolve(rawImg);
        normalized.src = canvas.toDataURL('image/jpeg', 0.94);
      };
      rawImg.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const FINGER_DEFS: Array<{
  name: string;
  tipIdx: number;
  dipIdx: number;
  pipIdx: number;
  priority: number;
}> = [
  { name: 'Dedo Médio', tipIdx: 12, dipIdx: 11, pipIdx: 10, priority: 1.3 },
  { name: 'Indicador', tipIdx: 8, dipIdx: 7, pipIdx: 6, priority: 1.25 },
  { name: 'Anelar', tipIdx: 16, dipIdx: 15, pipIdx: 14, priority: 1.15 },
  { name: 'Mínimo', tipIdx: 20, dipIdx: 19, pipIdx: 18, priority: 0.9 },
  { name: 'Polegar', tipIdx: 4, dipIdx: 3, pipIdx: 2, priority: 0.85 },
];

/**
 * Perceptual Lab-like chroma conversion for skin vs nail plate segmentation.
 */
function rgbToLabLike(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const l = 0.299 * rn + 0.587 * gn + 0.114 * bn;
  const a = 0.5 * (rn - gn) + 0.25 * (rn - bn);
  const bCh = 0.25 * (rn + gn) - 0.5 * bn;
  return [l * 100, a * 120, bCh * 120];
}

function deltaColorLab(
  c1: [number, number, number],
  c2: [number, number, number]
): number {
  const dl = (c1[0] - c2[0]) * 0.65;
  const da = (c1[1] - c2[1]) * 1.35;
  const db = (c1[2] - c2[2]) * 1.25;
  return Math.hypot(dl, da, db);
}

/**
 * Chromatic Skin-vs-Nail Segmentation & Contour Analysis:
 * 1. Samples phalanx skin color between PIP -> DIP.
 * 2. Renders an upright ROI centered around DIP -> TIP and extending past TIP.
 * 3. Segments nail plate pixels by DeltaColor vs skin + lateral continuity.
 * 4. Measures aspectRatio = nailLength / nailWidth & tipTaper = widthAt85% / widthAt45%.
 * 5. Infers exact 3D shape (stiletto, almond, coffin, square, natural) and extensionLength.
 */
function analyzeNailContourAndShape(
  img: HTMLImageElement,
  pipNorm: { x: number; y: number },
  dipNorm: { x: number; y: number },
  tipNorm: { x: number; y: number }
): {
  detectedShape: NailShape;
  detectedLength: number;
  aspectRatio: number;
  tipTaper: number;
  refinedCx: number;
  refinedCy: number;
} {
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;

  const fallbackCx = dipNorm.x + 0.65 * (tipNorm.x - dipNorm.x);
  const fallbackCy = dipNorm.y + 0.65 * (tipNorm.y - dipNorm.y);
  const fallback = {
    detectedShape: 'almond' as NailShape,
    detectedLength: 1.08,
    aspectRatio: 1.6,
    tipTaper: 0.48,
    refinedCx: fallbackCx,
    refinedCy: fallbackCy,
  };

  try {
    // 1. Sample skin color along phalanx PIP -> DIP
    const { ctx: skinCtx } = createScratchCanvas(24, 24);
    const sx = ((pipNorm.x + dipNorm.x) * 0.5) * imgW;
    const sy = ((pipNorm.y + dipNorm.y) * 0.5) * imgH;
    const segPx = Math.max(
      18,
      Math.hypot((tipNorm.x - dipNorm.x) * imgW, (tipNorm.y - dipNorm.y) * imgH)
    );
    const patch = Math.max(8, Math.round(segPx * 0.25));
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
    const skinData = skinCtx.getImageData(0, 0, 24, 24).data;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sc = 0;
    for (let i = 0; i < skinData.length; i += 4) {
      sr += skinData[i];
      sg += skinData[i + 1];
      sb += skinData[i + 2];
      sc++;
    }
    const skinLab = rgbToLabLike(sr / Math.max(1, sc), sg / Math.max(1, sc), sb / Math.max(1, sc));

    // 2. Render upright ROI from DIP extending 0.75x past TIP
    const roiW = 64;
    const roiH = 96;
    const { ctx: roiCtx } = createScratchCanvas(roiW, roiH);
    const dx = (tipNorm.x - dipNorm.x) * imgW;
    const dy = (tipNorm.y - dipNorm.y) * imgH;
    const angleRad = Math.atan2(dy, dx) + Math.PI / 2;
    const anchorX = (dipNorm.x + 0.72 * (tipNorm.x - dipNorm.x)) * imgW;
    const anchorY = (dipNorm.y + 0.72 * (tipNorm.y - dipNorm.y)) * imgH;
    const roiSpanH = segPx * 1.9;
    const scale = roiH / roiSpanH;

    roiCtx.save();
    roiCtx.translate(roiW / 2, roiH / 2);
    roiCtx.scale(scale, scale);
    roiCtx.rotate(-angleRad);
    roiCtx.drawImage(img, -anchorX, -anchorY);
    roiCtx.restore();

    const { data } = roiCtx.getImageData(0, 0, roiW, roiH);

    // Sample background color at top corners of ROI (beyond fingertip)
    const cornerOffsets = [0, (roiW - 1) * 4, (roiW * 2 + 2) * 4, (roiW * 2 + roiW - 3) * 4];
    let br = 0;
    let bg = 0;
    let bb = 0;
    for (const off of cornerOffsets) {
      br += data[off];
      bg += data[off + 1];
      bb += data[off + 2];
    }
    const bgLab = rgbToLabLike(br / 4, bg / 4, bb / 4);

    // 3. Segment nail plate scanlines from bottom (cuticle near y = roiH * 0.78) upward toward tip (y -> 0)
    const rowWidths = new Float32Array(roiH);
    let minY = roiH;
    let maxY = 0;
    let maxWidth = 0;
    let sumRowCenterX = 0;
    let activeRows = 0;

    for (let y = Math.round(roiH * 0.06); y < Math.round(roiH * 0.86); y++) {
      // Find contiguous central run of pixels distinct from both skin and far background
      const centerX = Math.floor(roiW / 2);
      const isNailPixel = (x: number): boolean => {
        const idx = (y * roiW + x) * 4;
        const pLab = rgbToLabLike(data[idx], data[idx + 1], data[idx + 2]);
        const dSkin = deltaColorLab(pLab, skinLab);
        const dBg = deltaColorLab(pLab, bgLab);
        // Edge continuity luminance check vs neighbor
        const nIdx = (y * roiW + Math.max(0, x - 1)) * 4;
        const grad =
          Math.abs(data[idx] - data[nIdx]) +
          Math.abs(data[idx + 1] - data[nIdx + 1]) +
          Math.abs(data[idx + 2] - data[nIdx + 2]);
        return (dSkin > 10.5 || grad > 38) && dBg > 7.5;
      };

      // Probe within inner 65% horizontally
      let left = centerX;
      let right = centerX;
      let seedFound = false;
      for (let offset = 0; offset <= 10; offset++) {
        if (centerX + offset < roiW - 4 && isNailPixel(centerX + offset)) {
          left = centerX + offset;
          right = left;
          seedFound = true;
          break;
        }
        if (centerX - offset >= 4 && isNailPixel(centerX - offset)) {
          left = centerX - offset;
          right = left;
          seedFound = true;
          break;
        }
      }
      if (!seedFound) continue;

      let missLeft = 0;
      while (left > 3 && missLeft < 2) {
        if (isNailPixel(left - 1)) {
          left--;
          missLeft = 0;
        } else {
          missLeft++;
          left--;
        }
      }
      let missRight = 0;
      while (right < roiW - 4 && missRight < 2) {
        if (isNailPixel(right + 1)) {
          right++;
          missRight = 0;
        } else {
          missRight++;
          right++;
        }
      }

      const w = right - left + 1;
      if (w >= 5 && w <= roiW * 0.72) {
        rowWidths[y] = w;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (w > maxWidth) maxWidth = w;
        sumRowCenterX += (left + right) * 0.5;
        activeRows++;
      }
    }

    if (activeRows < 8 || maxWidth < 6) {
      return fallback;
    }

    const nailLength = Math.max(10, maxY - minY);
    const aspectRatio = nailLength / Math.max(6, maxWidth);

    // Measure width at 45% (mid-plate, measured from cuticle maxY upward toward minY) and 85% (near free-edge tip)
    const sampleBandWidth = (fracFromCuticle: number): number => {
      const targetY = Math.round(maxY - nailLength * fracFromCuticle);
      let acc = 0;
      let cnt = 0;
      for (let dyBand = -2; dyBand <= 2; dyBand++) {
        const yy = Math.max(0, Math.min(roiH - 1, targetY + dyBand));
        if (rowWidths[yy] > 0) {
          acc += rowWidths[yy];
          cnt++;
        }
      }
      return cnt > 0 ? acc / cnt : 0;
    };

    const widthAt45 = Math.max(4, sampleBandWidth(0.45) || maxWidth);
    const widthAt85 = sampleBandWidth(0.85);
    const tipTaper = Math.max(0.08, Math.min(1.15, widthAt85 / widthAt45));

    // 4. Infer 3D NailShape & Extension Length
    let detectedShape: NailShape = 'almond';
    if (aspectRatio < 1.35) {
      detectedShape = 'natural';
    } else if (tipTaper < 0.34) {
      detectedShape = 'stiletto';
    } else if (tipTaper < 0.58) {
      detectedShape = 'almond';
    } else if (tipTaper < 0.76) {
      detectedShape = 'coffin';
    } else {
      detectedShape = 'square';
    }

    // Map aspectRatio (1.05 .. 2.75) -> extensionLength (0.82 .. 1.65)
    const detectedLength = Number(
      Math.max(0.82, Math.min(1.65, 0.72 + (aspectRatio - 0.95) * 0.52)).toFixed(2)
    );

    // Refine center inside segmented plate
    const avgLocalX = sumRowCenterX / activeRows - roiW / 2;
    const avgLocalY = (minY + maxY) * 0.5 - roiH / 2;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const shiftX = (avgLocalX * cosA - avgLocalY * sinA) / scale;
    const shiftY = (avgLocalX * sinA + avgLocalY * cosA) / scale;
    const refinedCx = Math.max(0.05, Math.min(0.95, (anchorX + shiftX * 0.35) / imgW));
    const refinedCy = Math.max(0.05, Math.min(0.95, (anchorY + shiftY * 0.35) / imgH));

    return {
      detectedShape,
      detectedLength,
      aspectRatio: Number(aspectRatio.toFixed(2)),
      tipTaper: Number(tipTaper.toFixed(2)),
      refinedCx,
      refinedCy,
    };
  } catch {
    return fallback;
  }
}

/**
 * Fallback when photo is an extreme macro close-up without a full hand:
 * detects up to 3 sharpest nail-detail focal zones across the central frame so
 * the nail designer still gets 1-tap Unha 1 / Unha 2 / Unha 3 switching + 4.5x Loupe zoom.
 */
function buildSmartMacroTargets(img: HTMLImageElement): DetectedNailTarget[] {
  const sampleSize = 96;
  const { ctx } = createScratchCanvas(sampleSize, sampleSize);

  const zones = [
    { name: 'Centro', minX: 34, maxX: 62 },
    { name: 'Esquerda', minX: 16, maxX: 40 },
    { name: 'Direita', minX: 56, maxX: 80 },
  ];

  const minSide = Math.min(img.naturalWidth, img.naturalHeight);
  const baseSpanPx = minSide * 1.38;
  const targets: DetectedNailTarget[] = [];

  if (ctx) {
    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);

    zones.forEach((z, idx) => {
      let bestX = (z.minX + z.maxX) / 2;
      let bestY = 46;
      let bestScore = -1;

      for (let cy = 22; cy <= 74; cy += 8) {
        for (let cx = z.minX; cx <= z.maxX; cx += 6) {
          let energy = 0;
          let sat = 0;
          let count = 0;
          for (let y = cy - 6; y <= cy + 6; y += 2) {
            for (let x = cx - 6; x <= cx + 6; x += 2) {
              const i = (y * sampleSize + x) * 4;
              const iR = (y * sampleSize + Math.min(sampleSize - 1, x + 1)) * 4;
              const iD = (Math.min(sampleSize - 1, y + 1) * sampleSize + x) * 4;
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              const lum = 0.299 * r + 0.587 * g + 0.114 * b;
              const lumR = 0.299 * data[iR] + 0.587 * data[iR + 1] + 0.114 * data[iR + 2];
              const lumD = 0.299 * data[iD] + 0.587 * data[iD + 1] + 0.114 * data[iD + 2];
              energy += Math.abs(lum - lumR) + Math.abs(lum - lumD);
              const mx = Math.max(r, g, b);
              const mn = Math.min(r, g, b);
              sat += mx > 0 ? (mx - mn) / mx : 0;
              count++;
            }
          }
          const score = energy / Math.max(1, count) + (sat / Math.max(1, count)) * 24;
          if (score > bestScore) {
            bestScore = score;
            bestX = cx;
            bestY = cy;
          }
        }
      }

      const frame: NailCropFrame = {
        cx: bestX / sampleSize,
        cy: bestY / sampleSize,
        angleRad: 0,
        baseSpanPx,
      };
      const thumbDataUrl = renderLoupeNailTexture(img, frame, DEFAULT_LOUPE_ADJUSTMENT, 84, 126);
      targets.push({
        id: `macro-${idx + 1}`,
        shortLabel: `Unha ${idx + 1}`,
        fingerName: `Foco ${z.name}`,
        frame,
        thumbDataUrl,
        dominantColor: sampleHexSync(img, frame),
        detectedShape: 'almond',
        detectedLength: 1.12,
        contourMetrics: { aspectRatio: 1.65, tipTaper: 0.48 },
      });
    });
  }

  if (targets.length === 0) {
    const frame: NailCropFrame = { cx: 0.5, cy: 0.48, angleRad: 0, baseSpanPx };
    targets.push({
      id: 'macro-1',
      shortLabel: 'Unha 1',
      fingerName: 'Centro',
      frame,
      thumbDataUrl: renderLoupeNailTexture(img, frame, DEFAULT_LOUPE_ADJUSTMENT, 84, 126),
      dominantColor: '#D4A383',
      detectedShape: 'almond',
      detectedLength: 1.1,
      contourMetrics: { aspectRatio: 1.6, tipTaper: 0.5 },
    });
  }

  return targets;
}

/**
 * Geometric & UV Reference Extractor (V4):
 * Runs MediaPipe HandLandmarker (IMAGE mode), segments skin vs nail plate,
 * infers true 3D nail shape & extension length, and calibrates 4.5x Loupe extraction.
 */
export async function analyzeReferencePhoto(file: File): Promise<NailExtractionResult> {
  const img = await loadImageFromFile(file, 1600);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const landmarker = await getImageHandLandmarker();
  if (landmarker) {
    try {
      const result = landmarker.detect(img);
      const hands = result.landmarks ?? [];

      const rawCandidates: Array<{
        score: number;
        xPos: number;
        fingerName: string;
        frame: NailCropFrame;
        detectedShape: NailShape;
        detectedLength: number;
        contourMetrics: { aspectRatio: number; tipTaper: number };
      }> = [];

      for (const hand of hands) {
        if (!hand || hand.length < 21) continue;

        for (const f of FINGER_DEFS) {
          const tip = hand[f.tipIdx];
          const dip = hand[f.dipIdx];
          const pip = hand[f.pipIdx];

          if (
            tip.x < 0.04 ||
            tip.x > 0.96 ||
            tip.y < 0.04 ||
            tip.y > 0.96 ||
            dip.x < 0.03 ||
            dip.x > 0.97 ||
            dip.y < 0.03 ||
            dip.y > 0.97
          ) {
            continue;
          }

          const dx = (tip.x - dip.x) * w;
          const dy = (tip.y - dip.y) * h;
          const segLen = Math.hypot(dx, dy);
          if (segLen < 18) continue;

          const baseSeg = Math.hypot((dip.x - pip.x) * w, (dip.y - pip.y) * h);
          const refLen = Math.max(segLen, baseSeg * 0.62);

          const contour = analyzeNailContourAndShape(img, pip, dip, tip);

          // Nail plate focal center: blend geometric DIP + 0.65*(TIP-DIP) with contour centroid
          const nailCx = contour.refinedCx;
          const nailCy = contour.refinedCy;

          const angleRad = Math.atan2(dy, dx) + Math.PI / 2;
          const baseSpanPx = Math.max(120, refLen * 2.52);

          const centerDist = Math.hypot(nailCx - 0.5, nailCy - 0.5);
          const score = (refLen / Math.min(w, h)) * f.priority * (1.35 - centerDist * 0.75);

          rawCandidates.push({
            score,
            xPos: nailCx,
            fingerName: f.name,
            frame: {
              cx: nailCx,
              cy: nailCy,
              angleRad,
              baseSpanPx,
            },
            detectedShape: contour.detectedShape,
            detectedLength: contour.detectedLength,
            contourMetrics: {
              aspectRatio: contour.aspectRatio,
              tipTaper: contour.tipTaper,
            },
          });
        }
      }

      if (rawCandidates.length > 0) {
        const topFive = rawCandidates.sort((a, b) => b.score - a.score).slice(0, 5);
        const bestCandidate = topFive[0];
        const ordered = [...topFive].sort((a, b) => a.xPos - b.xPos);
        const initialIndex = Math.max(0, ordered.indexOf(bestCandidate));

        const detectedNails: DetectedNailTarget[] = ordered.map((item, idx) => ({
          id: `nail-${idx + 1}`,
          shortLabel: `Unha ${idx + 1}`,
          fingerName: item.fingerName,
          frame: item.frame,
          thumbDataUrl: renderLoupeNailTexture(img, item.frame, DEFAULT_LOUPE_ADJUSTMENT, 84, 126),
          dominantColor: sampleHexSync(img, item.frame),
          detectedShape: item.detectedShape,
          detectedLength: item.detectedLength,
          contourMetrics: item.contourMetrics,
        }));

        return {
          sourceImage: img,
          method: 'mediapipe',
          detectedNails,
          initialIndex,
        };
      }
    } catch {
      // Fall through cleanly to smart macro targets
    }
  }

  return {
    sourceImage: img,
    method: 'smart-macro',
    detectedNails: buildSmartMacroTargets(img),
    initialIndex: 0,
  };
}

/**
 * Renders the surgically zoomed & rotated inner nail-plate texture into a clean upright PNG DataURL (320x480).
 * At zoom=4.5x, captures strictly the decorated nail plate interior without skin, rings, or background.
 */
export function renderLoupeNailTexture(
  img: HTMLImageElement,
  frame: NailCropFrame,
  adjust: LoupeAdjustment,
  outW = 320,
  outH = 480
): string {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const clampedZoom = Math.max(MIN_LOUPE_ZOOM, Math.min(MAX_LOUPE_ZOOM, adjust.zoom));
  const totalAngle = frame.angleRad + (adjust.rotationDeg * Math.PI) / 180;

  const effectiveH = Math.max(24, frame.baseSpanPx / clampedZoom);
  const effectiveW = effectiveH * (outW / outH);

  const panLocalX = -adjust.offsetX * effectiveW;
  const panLocalY = -adjust.offsetY * effectiveH;
  const cosA = Math.cos(totalAngle);
  const sinA = Math.sin(totalAngle);
  const srcCx = frame.cx * img.naturalWidth + (panLocalX * cosA - panLocalY * sinA);
  const srcCy = frame.cy * img.naturalHeight + (panLocalX * sinA + panLocalY * cosA);

  const uniformScale = outH / effectiveH;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(outW / 2, outH / 2);
  ctx.scale(uniformScale, uniformScale);
  ctx.rotate(-totalAngle);
  ctx.drawImage(img, -srcCx, -srcCy);
  ctx.restore();

  return canvas.toDataURL('image/png', 0.94);
}

/**
 * Generates an entire in-memory PBR texture suite from an albedo image or canvas:
 * - map: Base Color / Albedo
 * - normalMap: Tangent-space normal map via 3x3 Sobel luminance gradient
 * - roughnessMap: Glossy low roughness on gel/chrome, higher on velvet/matte
 * - metalnessMap: Detects metallic gold/chrome/pearl ridges via luminance + warm gold chroma + Sobel magnitude
 * - alphaMap: Organic proximal cuticle skin-melt gradient mask (v ∈ [0, 0.16])
 */
export function generatePBRTextureMaps(
  sourceImgOrCanvas: HTMLImageElement | HTMLCanvasElement,
  options: {
    finish?: NailDesign['finish'];
    patternType?: NailDesign['patternType'];
    width?: number;
    height?: number;
  } = {}
): PBRTextureBundle {
  const w = options.width ?? 256;
  const h = options.height ?? 384;
  const finish = options.finish ?? 'glossy';
  const patternType = options.patternType ?? 'solid';

  const { canvas: mapCanvas, ctx: mapCtx } = createOutputCanvas(w, h);
  mapCtx.imageSmoothingEnabled = true;
  mapCtx.imageSmoothingQuality = 'high';
  mapCtx.drawImage(sourceImgOrCanvas, 0, 0, w, h);

  const srcPixels = mapCtx.getImageData(0, 0, w, h).data;

  // Luminance buffer for 3x3 Sobel
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    luma[i] = (0.299 * srcPixels[p] + 0.587 * srcPixels[p + 1] + 0.114 * srcPixels[p + 2]) / 255;
  }

  const { canvas: normalCanvas, ctx: normalCtx } = createOutputCanvas(w, h);
  const normalImgData = normalCtx.createImageData(w, h);

  const { canvas: roughCanvas, ctx: roughCtx } = createOutputCanvas(w, h);
  const roughImgData = roughCtx.createImageData(w, h);

  const { canvas: metalCanvas, ctx: metalCtx } = createOutputCanvas(w, h);
  const metalImgData = metalCtx.createImageData(w, h);

  const { canvas: alphaCanvas, ctx: alphaCtx } = createOutputCanvas(w, h);
  const alphaImgData = alphaCtx.createImageData(w, h);

  const isChrome = finish === 'chrome' || patternType === 'chrome' || patternType === 'aurora';
  const isVelvet = finish === 'velvet';
  const isFoil = finish === 'glitter' || patternType === 'gold-foil';
  const normalStrength = isFoil ? 4.2 : isVelvet ? 2.6 : 3.2;

  const sampleLuma = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return luma[cy * w + cx];
  };

  for (let y = 0; y < h; y++) {
    // In canvas coords, y = 0 is top (nail tip, v=1) and y = h - 1 is bottom (cuticle, v=0)
    const vCoord = 1 - y / Math.max(1, h - 1);
    // Smooth organic cuticle skin-melt gradient mask at proximal base v ∈ [0, 0.16]
    const tCuticle = Math.max(0, Math.min(1, vCoord / 0.16));
    const smoothCuticle = tCuticle * tCuticle * (3 - 2 * tCuticle);
    const alphaByte = Math.round(smoothCuticle * 255);

    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const p4 = idx * 4;

      const r = srcPixels[p4] / 255;
      const g = srcPixels[p4 + 1] / 255;
      const b = srcPixels[p4 + 2] / 255;

      // 3x3 Sobel luminance gradient
      const tl = sampleLuma(x - 1, y - 1);
      const tc = sampleLuma(x, y - 1);
      const tr = sampleLuma(x + 1, y - 1);
      const ml = sampleLuma(x - 1, y);
      const mr = sampleLuma(x + 1, y);
      const bl = sampleLuma(x - 1, y + 1);
      const bc = sampleLuma(x, y + 1);
      const br = sampleLuma(x + 1, y + 1);

      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const gradMag = Math.hypot(gx, gy);

      // Tangent-space normal
      const nx = -gx * normalStrength;
      const ny = gy * normalStrength;
      const nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      normalImgData.data[p4] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      normalImgData.data[p4 + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      normalImgData.data[p4 + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      normalImgData.data[p4 + 3] = 255;

      // Metalness detection: warm gold chroma + high specular luminance + Sobel relief ridges
      const maxC = Math.max(r, g, b);
      const warmGold = Math.max(0, Math.min(1, (r - b) * 1.9 * smoothstep(0.32, 0.86, maxC)));
      const brightChrome = smoothstep(0.68, 0.96, luma[idx]) * (isChrome ? 0.85 : 0.3);
      const edgeRelief = Math.min(1, gradMag * 2.8);
      const baseMetal = isChrome ? 0.62 : isFoil ? 0.28 : 0.04;
      const metalness = Math.max(
        0,
        Math.min(1, baseMetal + warmGold * 0.55 + edgeRelief * 0.42 + brightChrome * 0.35)
      );
      const metalByte = Math.round(metalness * 255);

      metalImgData.data[p4] = metalByte;
      metalImgData.data[p4 + 1] = metalByte;
      metalImgData.data[p4 + 2] = metalByte;
      metalImgData.data[p4 + 3] = 255;

      // Roughness map: glossy gel has very low roughness (0.08..0.16), metallic accents ~0.12, velvet ~0.48
      let roughness = isVelvet ? 0.48 : isChrome ? 0.11 : 0.14;
      if (metalness > 0.45) {
        roughness = Math.min(roughness, 0.14);
      } else if (gradMag > 0.22 && isVelvet) {
        roughness = 0.56;
      }
      const roughByte = Math.round(Math.max(0.05, Math.min(0.88, roughness)) * 255);

      roughImgData.data[p4] = roughByte;
      roughImgData.data[p4 + 1] = roughByte;
      roughImgData.data[p4 + 2] = roughByte;
      roughImgData.data[p4 + 3] = 255;

      // Alpha map (luminance used by Three.js alphaMap)
      alphaImgData.data[p4] = alphaByte;
      alphaImgData.data[p4 + 1] = alphaByte;
      alphaImgData.data[p4 + 2] = alphaByte;
      alphaImgData.data[p4 + 3] = 255;
    }
  }

  normalCtx.putImageData(normalImgData, 0, 0);
  roughCtx.putImageData(roughImgData, 0, 0);
  metalCtx.putImageData(metalImgData, 0, 0);
  alphaCtx.putImageData(alphaImgData, 0, 0);

  const map = new THREE.CanvasTexture(mapCanvas);
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

  return {
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
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-5, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function sampleHexSync(img: HTMLImageElement, frame: NailCropFrame): string {
  try {
    const { ctx } = createScratchCanvas(16, 24);
    const effectiveH = Math.max(20, frame.baseSpanPx / DEFAULT_LOUPE_ZOOM);
    const scale = 24 / effectiveH;
    ctx.translate(8, 12);
    ctx.scale(scale, scale);
    ctx.rotate(-frame.angleRad);
    ctx.drawImage(img, -frame.cx * img.naturalWidth, -frame.cy * img.naturalHeight);

    const { data } = ctx.getImageData(3, 5, 10, 14);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (n === 0) return '#D4A383';
    return (
      '#' +
      [r / n, g / n, b / n]
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
        .join('')
    );
  } catch {
    return '#D4A383';
  }
}
