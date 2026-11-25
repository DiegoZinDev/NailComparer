import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export interface NailCropFrame {
  /** Normalized focal center X (0..1) on the source image */
  cx: number;
  /** Normalized focal center Y (0..1) on the source image */
  cy: number;
  /** Angle in radians to rotate the finger upright along -Y */
  angleRad: number;
  /** Crop width in source pixels */
  cropW: number;
  /** Crop height in source pixels */
  cropH: number;
}

export interface NailExtractionResult {
  sourceImage: HTMLImageElement;
  method: 'mediapipe' | 'smart-macro';
  detectedFingerLabel: string | null;
  initialFrame: NailCropFrame;
  dominantColor: string;
}

export interface CropAdjustment {
  /** Pan offset X in normalized units of cropW (-1..1) */
  offsetX: number;
  /** Pan offset Y in normalized units of cropH (-1..1) */
  offsetY: number;
  /** Zoom multiplier (0.6..2.6) */
  zoom: number;
  /** Additional manual rotation in degrees (-45..45) */
  rotationDeg: number;
}

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
          minHandDetectionConfidence: 0.35,
          minHandPresenceConfidence: 0.35,
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

function loadImageFromFile(file: File, maxDim = 1440): Promise<HTMLImageElement> {
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
        normalized.src = canvas.toDataURL('image/jpeg', 0.92);
      };
      rawImg.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Fallback for extreme macro close-ups where MediaPipe does not see the full hand:
 * scans a downscaled grid inside the central 64% region to locate the sharpest/most detailed
 * nail-art area and zooms cleanly into it.
 */
function findSmartMacroFrame(img: HTMLImageElement): NailCropFrame {
  const sampleSize = 96;
  const off = document.createElement('canvas');
  off.width = sampleSize;
  off.height = sampleSize;
  const ctx = off.getContext('2d');

  let bestCx = 0.5;
  let bestCy = 0.48;

  if (ctx) {
    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);

    // Divide central zone into a 5x5 grid and score by local edge detail + color richness
    let bestScore = -1;
    const minCell = 18;
    const maxCell = sampleSize - 18;
    const step = 12;

    for (let cy = minCell; cy <= maxCell; cy += step) {
      for (let cx = minCell; cx <= maxCell; cx += step) {
        let energy = 0;
        let satSum = 0;
        let count = 0;
        for (let y = cy - 8; y <= cy + 8; y += 2) {
          for (let x = cx - 8; x <= cx + 8; x += 2) {
            const i = (y * sampleSize + x) * 4;
            const iRight = (y * sampleSize + (x + 1)) * 4;
            const iDown = ((y + 1) * sampleSize + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            const lumR = 0.299 * data[iRight] + 0.587 * data[iRight + 1] + 0.114 * data[iRight + 2];
            const lumD = 0.299 * data[iDown] + 0.587 * data[iDown + 1] + 0.114 * data[iDown + 2];
            energy += Math.abs(lum - lumR) + Math.abs(lum - lumD);

            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            satSum += maxC > 0 ? (maxC - minC) / maxC : 0;
            count++;
          }
        }
        // Mild center preference so we stay on the hero nail instead of background edges
        const distFromCenter = Math.hypot(cx / sampleSize - 0.5, cy / sampleSize - 0.5);
        const centerWeight = 1.25 - distFromCenter * 0.9;
        const score = (energy / count + (satSum / count) * 28) * centerWeight;
        if (score > bestScore) {
          bestScore = score;
          bestCx = cx / sampleSize;
          bestCy = cy / sampleSize;
        }
      }
    }
  }

  const minSide = Math.min(img.naturalWidth, img.naturalHeight);
  // Focused portrait nail-plate window (eliminates surrounding fingers & background)
  const cropW = minSide * 0.34;
  const cropH = cropW * 1.48;

  return {
    cx: bestCx,
    cy: bestCy,
    angleRad: 0,
    cropW,
    cropH,
  };
}

const CANDIDATE_FINGERS: Array<{
  label: string;
  tipIdx: number;
  dipIdx: number;
  pipIdx: number;
  priority: number;
}> = [
  { label: 'Dedo Médio', tipIdx: 12, dipIdx: 11, pipIdx: 10, priority: 1.25 },
  { label: 'Dedo Indicador', tipIdx: 8, dipIdx: 7, pipIdx: 6, priority: 1.2 },
  { label: 'Dedo Anelar', tipIdx: 16, dipIdx: 15, pipIdx: 14, priority: 1.05 },
  { label: 'Dedo Mínimo', tipIdx: 20, dipIdx: 19, pipIdx: 18, priority: 0.85 },
];

/**
 * Runs MediaPipe HandLandmarker (IMAGE mode) over an uploaded reference photo to surgically
 * locate, straighten, and isolate ONLY the inner nail plate texture of the sharpest central finger.
 */
export async function analyzeReferencePhoto(file: File): Promise<NailExtractionResult> {
  const img = await loadImageFromFile(file, 1440);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const landmarker = await getImageHandLandmarker();
  if (landmarker) {
    try {
      const result = landmarker.detect(img);
      const allHands = result.landmarks ?? [];

      let bestCandidate: {
        score: number;
        label: string;
        frame: NailCropFrame;
      } | null = null;

      for (const hand of allHands) {
        if (!hand || hand.length < 21) continue;
        for (const f of CANDIDATE_FINGERS) {
          const tip = hand[f.tipIdx];
          const dip = hand[f.dipIdx];
          const pip = hand[f.pipIdx];

          // Reject fingertips clipped at frame border
          if (
            tip.x < 0.05 ||
            tip.x > 0.95 ||
            tip.y < 0.05 ||
            tip.y > 0.95 ||
            dip.x < 0.04 ||
            dip.x > 0.96 ||
            dip.y < 0.04 ||
            dip.y > 0.96
          ) {
            continue;
          }

          const dx = (tip.x - dip.x) * w;
          const dy = (tip.y - dip.y) * h;
          const segLen = Math.hypot(dx, dy);
          if (segLen < 22) continue;

          const baseSeg = Math.hypot((dip.x - pip.x) * w, (dip.y - pip.y) * h);
          const refLen = Math.max(segLen, baseSeg * 0.65);

          // Center of the nail plate sits just past the DIP->TIP midpoint toward the tip
          const nailCx = dip.x + (tip.x - dip.x) * 0.6;
          const nailCy = dip.y + (tip.y - dip.y) * 0.6;

          const centerDist = Math.hypot(nailCx - 0.5, nailCy - 0.5);
          const score = (refLen / Math.min(w, h)) * f.priority * (1.35 - centerDist * 0.8);

          // Finger orientation angle so rotating by -angleRad aligns finger pointing straight UP (-Y)
          const angleRad = Math.atan2(dy, dx) + Math.PI / 2;

          // Surgical inner nail plate dimensions (narrow enough to exclude skin edges & background)
          const cropW = Math.max(36, refLen * 0.42);
          const cropH = Math.max(54, refLen * 0.72);

          if (!bestCandidate || score > bestCandidate.score) {
            bestCandidate = {
              score,
              label: f.label,
              frame: {
                cx: nailCx,
                cy: nailCy,
                angleRad,
                cropW,
                cropH,
              },
            };
          }
        }
      }

      if (bestCandidate) {
        const previewDataUrl = renderExtractedNailTexture(
          img,
          bestCandidate.frame,
          { offsetX: 0, offsetY: 0, zoom: 1, rotationDeg: 0 },
          96,
          144
        );
        const dominantColor = await sampleDominantHexFromDataUrl(previewDataUrl);
        return {
          sourceImage: img,
          method: 'mediapipe',
          detectedFingerLabel: bestCandidate.label,
          initialFrame: bestCandidate.frame,
          dominantColor,
        };
      }
    } catch {
      // Fall through cleanly to smart macro fallback
    }
  }

  const macroFrame = findSmartMacroFrame(img);
  const previewDataUrl = renderExtractedNailTexture(
    img,
    macroFrame,
    { offsetX: 0, offsetY: 0, zoom: 1, rotationDeg: 0 },
    96,
    144
  );
  const dominantColor = await sampleDominantHexFromDataUrl(previewDataUrl);

  return {
    sourceImage: img,
    method: 'smart-macro',
    detectedFingerLabel: null,
    initialFrame: macroFrame,
    dominantColor,
  };
}

/**
 * Renders the surgically rotated & cropped inner nail plate texture into a clean upright PNG DataURL.
 */
export function renderExtractedNailTexture(
  img: HTMLImageElement,
  frame: NailCropFrame,
  adjust: CropAdjustment,
  outW = 280,
  outH = 420
): string {
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const totalAngle = frame.angleRad + (adjust.rotationDeg * Math.PI) / 180;
  const effectiveW = Math.max(20, frame.cropW / Math.max(0.4, adjust.zoom));
  const effectiveH = Math.max(30, frame.cropH / Math.max(0.4, adjust.zoom));

  // Translate user pan (in upright nail coords) back into source image coordinates
  const panLocalX = -adjust.offsetX * effectiveW;
  const panLocalY = -adjust.offsetY * effectiveH;
  const cosA = Math.cos(totalAngle);
  const sinA = Math.sin(totalAngle);
  const srcCx = frame.cx * img.naturalWidth + (panLocalX * cosA - panLocalY * sinA);
  const srcCy = frame.cy * img.naturalHeight + (panLocalX * sinA + panLocalY * cosA);

  const scaleX = outW / effectiveW;
  const scaleY = outH / effectiveH;
  const uniformScale = Math.max(scaleX, scaleY);

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

function sampleDominantHexFromDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve('#D4A383');
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 36;
      const ctx = c.getContext('2d');
      if (!ctx) {
        resolve('#D4A383');
        return;
      }
      ctx.drawImage(img, 0, 0, 24, 36);
      const { data } = ctx.getImageData(4, 6, 16, 24);
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
      if (n === 0) {
        resolve('#D4A383');
        return;
      }
      const hex =
        '#' +
        [r / n, g / n, b / n]
          .map((v) => Math.round(v).toString(16).padStart(2, '0'))
          .join('');
      resolve(hex);
    };
    img.onerror = () => resolve('#D4A383');
    img.src = dataUrl;
  });
}
