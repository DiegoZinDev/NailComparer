import type {
  FingerId,
  LiveFingerCalibration,
  NormalizedPoint,
} from '../types/nail';
import type { ImageLayoutRect } from './nailRenderer';

const ORDERED_FINGERS: readonly FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
] as const;

const FINGER_DISTAL_INDICES: Record<FingerId, { dip: number; tip: number }> = {
  thumb: { dip: 3, tip: 4 },
  index: { dip: 7, tip: 8 },
  middle: { dip: 11, tip: 12 },
  ring: { dip: 15, tip: 16 },
  pinky: { dip: 19, tip: 20 },
};

const DEFAULT_WIDTH_TO_DISTAL_RATIO: Record<FingerId, number> = {
  thumb: 0.60,
  index: 0.62,
  middle: 0.61,
  ring: 0.60,
  pinky: 0.58,
};

const FINGER_RATIO_CLAMPS: Record<FingerId, { min: number; max: number }> = {
  thumb: { min: 0.46, max: 0.82 },
  index: { min: 0.42, max: 0.78 },
  middle: { min: 0.42, max: 0.78 },
  ring: { min: 0.42, max: 0.78 },
  pinky: { min: 0.42, max: 0.78 },
};

const PROFILE_SAMPLES = 32;
const PROFILE_SPAN_MULT = 1.15;
const MIN_DIST2D_PX = 14;
const EMA_ALPHA = 0.08;
const NAIL_COVERAGE_RATIO = 0.85;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface ScanlineImageBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface ScanlineWidthMeasurement {
  widthPx: number;
  leftEdgeOffsetPx: number;
  rightEdgeOffsetPx: number;
  confidence: number;
}

/**
 * Bilinearly samples RGB from an ImageData-compatible buffer at normalized coordinates (nx, ny) ∈ [0, 1].
 */
function sampleBilinearRgb(
  buffer: ScanlineImageBuffer,
  nx: number,
  ny: number,
  outRgb: [number, number, number]
): void {
  const w = buffer.width;
  const h = buffer.height;
  const x = clamp(nx, 0, 1) * (w - 1);
  const y = clamp(ny, 0, 1) * (h - 1);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const data = buffer.data;

  outRgb[0] = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
  outRgb[1] = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
  outRgb[2] = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
}

function rgbLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Pure function that traces a 32-sample transverse scanline perpendicular to `DIP -> TIP`
 * around `center = lerp(dipScreen, tipScreen, 0.35)` across `[-1.15 * dist2D, +1.15 * dist2D]`
 * and measures the real finger phalanx width in screen pixels.
 *
 * Exported separately so unit tests in Node can validate width extraction directly on synthetic
 * `48x48` / `64x64` buffers without DOM dependencies.
 */
export function measureFingerWidthFromScanline(
  imageData: ScanlineImageBuffer,
  dipScreenX: number,
  dipScreenY: number,
  tipScreenX: number,
  tipScreenY: number,
  rect: ImageLayoutRect,
  mirrorX: boolean,
  // Reusable scratch arrays when called from LiveFingerCalibrator (optional for pure standalone calls)
  scratch?: {
    samplesR: Float32Array;
    samplesG: Float32Array;
    samplesB: Float32Array;
    samplesL: Float32Array;
    grad: Float32Array;
    skinDist: Float32Array;
    edgeScore: Float32Array;
    rgb: [number, number, number];
  }
): ScanlineWidthMeasurement | null {
  if (
    !imageData ||
    imageData.width < 4 ||
    imageData.height < 4 ||
    rect.drawW <= 1 ||
    rect.drawH <= 1
  ) {
    return null;
  }

  const dx = tipScreenX - dipScreenX;
  const dy = tipScreenY - dipScreenY;
  const dist2D = Math.hypot(dx, dy);
  if (!Number.isFinite(dist2D) || dist2D < MIN_DIST2D_PX) {
    return null;
  }

  // Unit vector along DIP -> TIP and perpendicular transverse unit vector
  const ux = dx / dist2D;
  const uy = dy / dist2D;
  const px = -uy;
  const py = ux;

  // Center at 35% of DIP -> TIP (clean skin/proximal nail bed away from background near free edge)
  const centerX = lerp(dipScreenX, tipScreenX, 0.35);
  const centerY = lerp(dipScreenY, tipScreenY, 0.35);

  const halfSpanPx = PROFILE_SPAN_MULT * dist2D;
  const stepPx = (2 * halfSpanPx) / (PROFILE_SAMPLES - 1);

  const samplesR = scratch?.samplesR ?? new Float32Array(PROFILE_SAMPLES);
  const samplesG = scratch?.samplesG ?? new Float32Array(PROFILE_SAMPLES);
  const samplesB = scratch?.samplesB ?? new Float32Array(PROFILE_SAMPLES);
  const samplesL = scratch?.samplesL ?? new Float32Array(PROFILE_SAMPLES);
  const grad = scratch?.grad ?? new Float32Array(PROFILE_SAMPLES);
  const skinDist = scratch?.skinDist ?? new Float32Array(PROFILE_SAMPLES);
  const edgeScore = scratch?.edgeScore ?? new Float32Array(PROFILE_SAMPLES);
  const rgb: [number, number, number] = scratch?.rgb ?? [0, 0, 0];

  const invDrawW = 1 / rect.drawW;
  const invDrawH = 1 / rect.drawH;

  // 1. Sample 32 points along [-1.15 * dist2D, +1.15 * dist2D] perpendicular to DIP->TIP
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const offset = -halfSpanPx + i * stepPx;
    const sx = centerX + px * offset;
    const sy = centerY + py * offset;

    // Map screen pixel back to normalized video/source coordinates [0, 1]
    const rawNx = (sx - rect.drawX) * invDrawW;
    const srcNx = mirrorX ? 1 - rawNx : rawNx;
    const srcNy = (sy - rect.drawY) * invDrawH;

    sampleBilinearRgb(imageData, srcNx, srcNy, rgb);
    samplesR[i] = rgb[0];
    samplesG[i] = rgb[1];
    samplesB[i] = rgb[2];
    samplesL[i] = rgbLuma(rgb[0], rgb[1], rgb[2]);
  }

  // 2. Model phalanx skin reference from the 4 central samples [14..17]
  let refR = 0;
  let refG = 0;
  let refB = 0;
  for (let i = 14; i <= 17; i++) {
    refR += samplesR[i];
    refG += samplesG[i];
    refB += samplesB[i];
  }
  refR *= 0.25;
  refG *= 0.25;
  refB *= 0.25;
  const refL = rgbLuma(refR, refG, refB);

  // Measure internal skin variation inside [13..18] so threshold adapts to lighting/skin tone
  let innerSumDist = 0;
  for (let i = 13; i <= 18; i++) {
    const dR = samplesR[i] - refR;
    const dG = samplesG[i] - refG;
    const dB = samplesB[i] - refB;
    innerSumDist += Math.sqrt(0.35 * dR * dR + 0.45 * dG * dG + 0.20 * dB * dB);
  }
  const innerSkinSpread = innerSumDist / 6;

  // 3. Compute per-sample chromatic skin distance and 1D directional gradient |I[i+1] - I[i-1]|
  let maxColorDist = 0;
  let maxGrad = 0;
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const dR = samplesR[i] - refR;
    const dG = samplesG[i] - refG;
    const dB = samplesB[i] - refB;
    const dL = samplesL[i] - refL;
    // Combine chromatic Euclidean distance with luminance shift
    const cDist = Math.sqrt(0.35 * dR * dR + 0.45 * dG * dG + 0.20 * dB * dB) + 0.25 * Math.abs(dL);
    skinDist[i] = cDist;
    if (cDist > maxColorDist) maxColorDist = cDist;

    if (i === 0 || i === PROFILE_SAMPLES - 1) {
      grad[i] = 0;
    } else {
      const gR = samplesR[i + 1] - samplesR[i - 1];
      const gG = samplesG[i + 1] - samplesG[i - 1];
      const gB = samplesB[i + 1] - samplesB[i - 1];
      const gMag = Math.sqrt(0.35 * gR * gR + 0.45 * gG * gG + 0.20 * gB * gB);
      grad[i] = gMag;
      if (gMag > maxGrad) maxGrad = gMag;
    }
  }

  // Require sufficient contrast between finger skin and background to avoid wild measurements
  const contrastStrength = Math.max(maxColorDist, maxGrad);
  if (contrastStrength < 14) {
    return null;
  }

  // Adaptive background transition threshold (clamped safely above skin shading noise)
  const bgThreshold = Math.max(16, innerSkinSpread * 2.2, maxColorDist * 0.42);

  // Combined 1D boundary score: local gradient peak + outward rise in skin-vs-background contrast
  for (let i = 1; i < PROFILE_SAMPLES - 1; i++) {
    const outwardJump =
      i < 15.5
        ? Math.max(0, skinDist[i - 1] - skinDist[i + 1])
        : Math.max(0, skinDist[i + 1] - skinDist[i - 1]);
    edgeScore[i] = grad[i] * 0.65 + outwardJump * 0.75;
  }
  edgeScore[0] = 0;
  edgeScore[PROFILE_SAMPLES - 1] = 0;

  // 4. March outward from center (15.5) toward left (14 -> 1) and right (17 -> 30)
  // Minimum plausible half-width ~ 0.12 * dist2D, maximum ~ 0.68 * dist2D
  const minCenterIdxOffset = Math.max(1.2, (0.12 * dist2D) / stepPx);
  const maxCenterIdxOffset = Math.min(14.5, (0.68 * dist2D) / stepPx);

  const leftMinIdx = Math.max(1, Math.floor(15.5 - maxCenterIdxOffset));
  const leftMaxIdx = Math.min(14, Math.ceil(15.5 - minCenterIdxOffset));

  const rightMinIdx = Math.max(17, Math.floor(15.5 + minCenterIdxOffset));
  const rightMaxIdx = Math.min(PROFILE_SAMPLES - 2, Math.ceil(15.5 + maxCenterIdxOffset));

  // Find left edge marching from center leftward
  let leftEdgeIdx = -1;
  let leftBestScore = 0;
  for (let i = leftMaxIdx; i >= leftMinIdx; i--) {
    const crossedBg = skinDist[i - 1] >= bgThreshold || skinDist[i] >= bgThreshold;
    const score = edgeScore[i] + (crossedBg ? 8 : 0);
    if (score > leftBestScore) {
      leftBestScore = score;
      leftEdgeIdx = i;
    }
    // Stop early at the first decisive background edge peak so neighboring fingers don't pull the edge out
    if (crossedBg && edgeScore[i] >= maxGrad * 0.48 && edgeScore[i] >= edgeScore[i - 1]) {
      leftEdgeIdx = i;
      leftBestScore = score;
      break;
    }
  }

  // Find right edge marching from center rightward
  let rightEdgeIdx = -1;
  let rightBestScore = 0;
  for (let i = rightMinIdx; i <= rightMaxIdx; i++) {
    const crossedBg = skinDist[i + 1] >= bgThreshold || skinDist[i] >= bgThreshold;
    const score = edgeScore[i] + (crossedBg ? 8 : 0);
    if (score > rightBestScore) {
      rightBestScore = score;
      rightEdgeIdx = i;
    }
    if (crossedBg && edgeScore[i] >= maxGrad * 0.48 && edgeScore[i] >= edgeScore[i + 1]) {
      rightEdgeIdx = i;
      rightBestScore = score;
      break;
    }
  }

  if (leftEdgeIdx < 0 || rightEdgeIdx < 0 || leftBestScore < 10 || rightBestScore < 10) {
    return null;
  }

  // Sub-sample parabolic refinement around each detected 1D gradient edge peak
  const refineEdgeIdx = (idx: number): number => {
    const sPrev = edgeScore[idx - 1] ?? 0;
    const sCurr = edgeScore[idx] ?? 0;
    const sNext = edgeScore[idx + 1] ?? 0;
    const denom = 2 * (sPrev - 2 * sCurr + sNext);
    if (Math.abs(denom) > 1e-4) {
      const delta = clamp((sPrev - sNext) / denom, -0.5, 0.5);
      return idx + delta;
    }
    return idx;
  };

  const refinedLeftIdx = refineEdgeIdx(leftEdgeIdx);
  const refinedRightIdx = refineEdgeIdx(rightEdgeIdx);

  const leftOffsetPx = -halfSpanPx + refinedLeftIdx * stepPx;
  const rightOffsetPx = -halfSpanPx + refinedRightIdx * stepPx;
  const widthPx = rightOffsetPx - leftOffsetPx;

  if (!Number.isFinite(widthPx) || widthPx <= 2) {
    return null;
  }

  // Compute measurement confidence from symmetry & edge contrast sharpness
  const leftDist = Math.abs(leftOffsetPx);
  const rightDist = Math.abs(rightOffsetPx);
  const symmetry = 1 - Math.abs(leftDist - rightDist) / Math.max(1e-3, leftDist + rightDist);
  const strengthConf = clamp(Math.min(leftBestScore, rightBestScore) / 48, 0.15, 1.0);
  const confidence = clamp(strengthConf * (0.45 + 0.55 * symmetry), 0, 1);

  return {
    widthPx,
    leftEdgeOffsetPx: leftOffsetPx,
    rightEdgeOffsetPx: rightOffsetPx,
    confidence,
  };
}

/**
 * Real-time per-finger anatomical width calibrator operating on a single low-resolution
 * (`48x48` or `64x64`) video `ImageData` buffer sampled at ~350ms intervals.
 */
export class LiveFingerCalibrator {
  private readonly smoothedRatio: Record<FingerId, number> = {
    ...DEFAULT_WIDTH_TO_DISTAL_RATIO,
  };
  private readonly lastWidthPx: Partial<Record<FingerId, number>> = {};
  private readonly lastConfidence: Record<FingerId, number> = {
    thumb: 0,
    index: 0,
    middle: 0,
    ring: 0,
    pinky: 0,
  };

  // Pre-allocated scratch buffers so updateFromFrameBuffer performs zero heap array allocations
  private readonly scratch = {
    samplesR: new Float32Array(PROFILE_SAMPLES),
    samplesG: new Float32Array(PROFILE_SAMPLES),
    samplesB: new Float32Array(PROFILE_SAMPLES),
    samplesL: new Float32Array(PROFILE_SAMPLES),
    grad: new Float32Array(PROFILE_SAMPLES),
    skinDist: new Float32Array(PROFILE_SAMPLES),
    edgeScore: new Float32Array(PROFILE_SAMPLES),
    rgb: [0, 0, 0] as [number, number, number],
  };

  private readonly outCalibration: LiveFingerCalibration;

  constructor() {
    this.outCalibration = {
      widthToDistalRatio: { ...this.smoothedRatio },
      widthPx: {},
      confidence: { ...this.lastConfidence },
    };
  }

  public updateFromFrameBuffer(
    imageData: ImageData | ScanlineImageBuffer,
    landmarks2D: readonly NormalizedPoint[],
    rect: ImageLayoutRect,
    cssW: number,
    cssH: number,
    mirrorX: boolean
  ): LiveFingerCalibration {
    if (!imageData || landmarks2D.length < 21 || cssW <= 0 || cssH <= 0) {
      return this.getCalibration();
    }

    for (const fingerId of ORDERED_FINGERS) {
      const idx = FINGER_DISTAL_INDICES[fingerId];
      const dip = landmarks2D[idx.dip];
      const tip = landmarks2D[idx.tip];
      if (!dip || !tip) {
        this.lastConfidence[fingerId] *= 0.85;
        continue;
      }

      const dipNx = mirrorX ? 1 - dip.x : dip.x;
      const tipNx = mirrorX ? 1 - tip.x : tip.x;
      const dipScreenX = rect.drawX + dipNx * rect.drawW;
      const dipScreenY = rect.drawY + dip.y * rect.drawH;
      const tipScreenX = rect.drawX + tipNx * rect.drawW;
      const tipScreenY = rect.drawY + tip.y * rect.drawH;

      const dist2D = Math.hypot(tipScreenX - dipScreenX, tipScreenY - dipScreenY);
      if (!Number.isFinite(dist2D) || dist2D < MIN_DIST2D_PX) {
        // Finger too small or end-on: keep previous EMA ratio, decay live width confidence gently
        this.lastConfidence[fingerId] *= 0.85;
        continue;
      }

      const measurement = measureFingerWidthFromScanline(
        imageData,
        dipScreenX,
        dipScreenY,
        tipScreenX,
        tipScreenY,
        rect,
        mirrorX,
        this.scratch
      );

      if (!measurement) {
        this.lastConfidence[fingerId] *= 0.85;
        continue;
      }

      const rawRatio = measurement.widthPx / dist2D;
      // Discard extreme anatomical outliers before clamping
      if (!Number.isFinite(rawRatio) || rawRatio < 0.25 || rawRatio > 1.15) {
        this.lastConfidence[fingerId] *= 0.85;
        continue;
      }

      const ratioClamp = FINGER_RATIO_CLAMPS[fingerId];
      const clampedRatio = clamp(rawRatio, ratioClamp.min, ratioClamp.max);

      const prevRatio = this.smoothedRatio[fingerId];
      const nextRatio = prevRatio * (1 - EMA_ALPHA) + clampedRatio * EMA_ALPHA;
      this.smoothedRatio[fingerId] = clamp(nextRatio, ratioClamp.min, ratioClamp.max);

      const prevPx = this.lastWidthPx[fingerId];
      const smoothedPx =
        prevPx !== undefined && Number.isFinite(prevPx)
          ? prevPx * (1 - EMA_ALPHA) + measurement.widthPx * EMA_ALPHA
          : measurement.widthPx;
      this.lastWidthPx[fingerId] = smoothedPx;

      const prevConf = this.lastConfidence[fingerId];
      this.lastConfidence[fingerId] = clamp(
        prevConf * (1 - EMA_ALPHA * 2) + measurement.confidence * (EMA_ALPHA * 2),
        0,
        1
      );
    }

    return this.getCalibration();
  }

  /**
   * Converts measured screen-space finger width (px) at calibrated metric depth `fingerDepthZ`
   * into exact anatomical nail plate width in meters (85% coverage of the client's distal phalanx).
   */
  public computeLiveNailWidthMeters(
    fingerId: FingerId,
    measuredWidthPx: number | undefined,
    fingerDepthZ: number,
    focalPx: number,
    fallbackDistalMeters: number
  ): number {
    const ratioClamp = FINGER_RATIO_CLAMPS[fingerId];
    const ratio = clamp(
      this.smoothedRatio[fingerId] ?? DEFAULT_WIDTH_TO_DISTAL_RATIO[fingerId],
      ratioClamp.min,
      ratioClamp.max
    );

    let fingerWidthMeters: number;
    if (
      measuredWidthPx !== undefined &&
      Number.isFinite(measuredWidthPx) &&
      measuredWidthPx > 2 &&
      Number.isFinite(fingerDepthZ) &&
      fingerDepthZ > 0.05 &&
      Number.isFinite(focalPx) &&
      focalPx > 10
    ) {
      fingerWidthMeters = (measuredWidthPx / focalPx) * Math.abs(fingerDepthZ);
    } else {
      fingerWidthMeters = fallbackDistalMeters * ratio;
    }

    const nailWidthMeters = fingerWidthMeters * NAIL_COVERAGE_RATIO;
    return clamp(nailWidthMeters, 0.0072, 0.021);
  }

  public getCalibration(): LiveFingerCalibration {
    for (const fingerId of ORDERED_FINGERS) {
      this.outCalibration.widthToDistalRatio[fingerId] = this.smoothedRatio[fingerId];
      this.outCalibration.confidence[fingerId] = this.lastConfidence[fingerId];
      const wPx = this.lastWidthPx[fingerId];
      if (wPx !== undefined) {
        this.outCalibration.widthPx[fingerId] = wPx;
      } else {
        delete this.outCalibration.widthPx[fingerId];
      }
    }
    return this.outCalibration;
  }

  public reset(): void {
    for (const fingerId of ORDERED_FINGERS) {
      this.smoothedRatio[fingerId] = DEFAULT_WIDTH_TO_DISTAL_RATIO[fingerId];
      delete this.lastWidthPx[fingerId];
      this.lastConfidence[fingerId] = 0;
    }
  }
}
