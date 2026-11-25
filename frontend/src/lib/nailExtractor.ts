import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export interface NailCropFrame {
  /** Normalized focal center X (0..1) on the source image */
  cx: number;
  /** Normalized focal center Y (0..1) on the source image */
  cy: number;
  /** Angle in radians to rotate the finger upright along -Y */
  angleRad: number;
  /** Base vertical span in source pixels at zoom = 1.0 (at default zoom=4.5, crops strictly inside the nail plate) */
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
 * Fallback when photo is an extreme macro close-up without a full hand:
 * detects up to 3 sharpest nail-detail focal zones across the central frame so
 * the nail designer still gets 1-tap Unha 1 / Unha 2 / Unha 3 switching + 4.5x Loupe zoom.
 */
function buildSmartMacroTargets(img: HTMLImageElement): DetectedNailTarget[] {
  const sampleSize = 96;
  const off = document.createElement('canvas');
  off.width = sampleSize;
  off.height = sampleSize;
  const ctx = off.getContext('2d');

  const zones = [
    { name: 'Centro', minX: 34, maxX: 62 },
    { name: 'Esquerda', minX: 16, maxX: 40 },
    { name: 'Direita', minX: 56, maxX: 80 },
  ];

  const minSide = Math.min(img.naturalWidth, img.naturalHeight);
  // At default zoom = 4.5x, effectiveH = baseSpanPx / 4.5 ~= 0.30 * minSide (tight inside nail!)
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
    });
  }

  return targets;
}

/**
 * Nail Loupe Extractor:
 * Runs MediaPipe HandLandmarker (IMAGE mode) over the uploaded reference photo,
 * locates every visible nail plate using nailCenter = DIP + 0.65 * (TIP - DIP),
 * computes exact upright orientation, and calibrates 4.5x default loupe zoom
 * strictly inside the inner nail plate (excluding skin, rings, and background).
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

          // Exact nail plate center: DIP + 0.65 * (TIP - DIP)
          const nailCx = dip.x + 0.65 * (tip.x - dip.x);
          const nailCy = dip.y + 0.65 * (tip.y - dip.y);

          // Finger axis angle so rotating by -angleRad stands the nail straight up (-Y)
          const angleRad = Math.atan2(dy, dx) + Math.PI / 2;

          // Calibrated so at default zoom = 4.5x, effectiveH = baseSpanPx / 4.5 ~= 0.56 * refLen
          // and effectiveW ~= 0.35 * refLen -> strictly INSIDE the nail plate (zero skin/rings/bg!)
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
          });
        }
      }

      if (rawCandidates.length > 0) {
        // Keep up to 5 highest-scoring nails, then order left-to-right for intuitive Unha 1..5 pills
        const topFive = rawCandidates
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
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
 * Renders the surgically zoomed & rotated inner nail-plate texture into a clean upright PNG DataURL.
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

  // Convert upright pan offsets back into source image space
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

function sampleHexSync(img: HTMLImageElement, frame: NailCropFrame): string {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 24;
    const ctx = c.getContext('2d');
    if (!ctx) return '#D4A383';

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
