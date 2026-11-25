import * as THREE from 'three';
import type { ImageLayoutRect } from './nailRenderer';
import type {
  FingerId,
  HandSkeletonFrame,
  LiveFingerCalibration,
  NormalizedPoint,
  Vec3,
} from '../types/nail';

/**
 * MediaPipe 21-point hand landmark index constants.
 *
 * Joint order per finger:
 * - Non-thumb: `[MCP, PIP, DIP, TIP]`
 * - Thumb:     `[CMC, MCP, IP, TIP]`
 */
export const WRIST = 0 as const;

export const FINGER_LANDMARK_INDICES: Record<
  FingerId,
  {
    readonly indices: readonly [number, number, number, number];
    readonly mcp: number;
    readonly pip: number;
    readonly dip: number;
    readonly tip: number;
  }
> = {
  thumb: { indices: [1, 2, 3, 4], mcp: 1, pip: 2, dip: 3, tip: 4 },
  index: { indices: [5, 6, 7, 8], mcp: 5, pip: 6, dip: 7, tip: 8 },
  middle: { indices: [9, 10, 11, 12], mcp: 9, pip: 10, dip: 11, tip: 12 },
  ring: { indices: [13, 14, 15, 16], mcp: 13, pip: 14, dip: 15, tip: 16 },
  pinky: { indices: [17, 18, 19, 20], mcp: 17, pip: 18, dip: 19, tip: 20 },
} as const;

export const HAND_LANDMARK_COUNT = 21 as const;
export const HANDEDNESS_LOCK_FRAMES = 10 as const;

const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_IP = 3;

const DEFAULT_PALM_WRIST_TO_MIDDLE_METERS = 0.085;
const DEFAULT_PALM_INDEX_TO_PINKY_METERS = 0.055;
const THUMB_PRONATION_DEG = 65;
const THUMB_PRONATION_RAD = (THUMB_PRONATION_DEG * Math.PI) / 180;

const ANATOMICAL_METRIC_CLAMPS: Record<
  FingerId,
  {
    distalMin: number;
    distalMax: number;
    distalFallback: number;
    widthMin: number;
    widthMax: number;
    widthFallback: number;
    widthToDistalRatio: number;
    radiusToWidthRatio: number;
  }
> = {
  thumb: {
    distalMin: 0.021,
    distalMax: 0.038,
    distalFallback: 0.029,
    widthMin: 0.0135,
    widthMax: 0.0225,
    widthFallback: 0.0175,
    widthToDistalRatio: 0.60,
    radiusToWidthRatio: 0.56,
  },
  index: {
    distalMin: 0.0155,
    distalMax: 0.0285,
    distalFallback: 0.021,
    widthMin: 0.0105,
    widthMax: 0.0175,
    widthFallback: 0.0138,
    widthToDistalRatio: 0.64,
    radiusToWidthRatio: 0.54,
  },
  middle: {
    distalMin: 0.017,
    distalMax: 0.031,
    distalFallback: 0.023,
    widthMin: 0.011,
    widthMax: 0.0185,
    widthFallback: 0.0144,
    widthToDistalRatio: 0.62,
    radiusToWidthRatio: 0.54,
  },
  ring: {
    distalMin: 0.0155,
    distalMax: 0.0285,
    distalFallback: 0.021,
    widthMin: 0.010,
    widthMax: 0.017,
    widthFallback: 0.0132,
    widthToDistalRatio: 0.62,
    radiusToWidthRatio: 0.54,
  },
  pinky: {
    distalMin: 0.0125,
    distalMax: 0.024,
    distalFallback: 0.0175,
    widthMin: 0.0085,
    widthMax: 0.0145,
    widthFallback: 0.0108,
    widthToDistalRatio: 0.61,
    radiusToWidthRatio: 0.55,
  },
};

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function dist3D(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Exact continuous One-Euro Filter (Casiez et al., CHI 2012).
 * Zero binary `isStationary` gate — smooth speed-adaptive cutoff eliminates both
 * micro-jitter at rest and latency during fast motion.
 */
export class OneEuroFilter {
  public readonly minCutoff: number;
  public readonly beta: number;
  public readonly dCutoff: number;

  private initialized = false;
  private xPrev = 0;
  private dxPrev = 0;

  constructor(minCutoff = 1.0, beta = 0.03, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static smoothingAlpha(dtSec: number, cutoffHz: number): number {
    const tau = 1.0 / (2.0 * Math.PI * Math.max(1e-4, cutoffHz));
    return 1.0 / (1.0 + tau / Math.max(1e-5, dtSec));
  }

  public filter(value: number, dtSec: number): number {
    if (!Number.isFinite(value)) return this.xPrev;

    const dt = clamp(Number.isFinite(dtSec) ? dtSec : 1 / 60, 1e-4, 0.25);

    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = value;
      this.dxPrev = 0;
      return value;
    }

    const dx = (value - this.xPrev) / dt;
    const aD = OneEuroFilter.smoothingAlpha(dt, this.dCutoff);
    const edx = aD * dx + (1.0 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const aX = OneEuroFilter.smoothingAlpha(dt, cutoff);
    const xHat = aX * value + (1.0 - aX) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = edx;
    return xHat;
  }

  public reset(): void {
    this.initialized = false;
    this.xPrev = 0;
    this.dxPrev = 0;
  }
}

export interface FilteredHandSkeleton {
  landmarks2D: Vec3[];
  worldLandmarks: Vec3[];
  handedness: 'Left' | 'Right';
  timestampMs: number;
}

/**
 * Single-phase pre-kinematic continuous filter across all 21 screen landmarks (x, y, z)
 * and all 21 metric world landmarks (x, y, z), plus 10-frame handedness hysteresis.
 * Zero per-frame heap allocations in steady-state `update()`.
 */
export class HandSkeletonFilter {
  private readonly lm2DFiltersX: OneEuroFilter[] = [];
  private readonly lm2DFiltersY: OneEuroFilter[] = [];
  private readonly lm2DFiltersZ: OneEuroFilter[] = [];

  private readonly worldFiltersX: OneEuroFilter[] = [];
  private readonly worldFiltersY: OneEuroFilter[] = [];
  private readonly worldFiltersZ: OneEuroFilter[] = [];

  private readonly outLandmarks2D: Vec3[] = [];
  private readonly outWorldLandmarks: Vec3[] = [];
  private readonly outResult: FilteredHandSkeleton;

  private lockedHandedness: 'Left' | 'Right' | null = null;
  private pendingHandedness: 'Left' | 'Right' | null = null;
  private pendingFrames = 0;

  constructor() {
    for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
      this.lm2DFiltersX.push(new OneEuroFilter(1.0, 0.045, 1.0));
      this.lm2DFiltersY.push(new OneEuroFilter(1.0, 0.045, 1.0));
      this.lm2DFiltersZ.push(new OneEuroFilter(1.0, 0.045, 1.0));

      this.worldFiltersX.push(new OneEuroFilter(0.85, 0.03, 1.0));
      this.worldFiltersY.push(new OneEuroFilter(0.85, 0.03, 1.0));
      this.worldFiltersZ.push(new OneEuroFilter(0.85, 0.03, 1.0));

      this.outLandmarks2D.push({ x: 0, y: 0, z: 0 });
      this.outWorldLandmarks.push({ x: 0, y: 0, z: 0 });
    }

    this.outResult = {
      landmarks2D: this.outLandmarks2D,
      worldLandmarks: this.outWorldLandmarks,
      handedness: 'Right',
      timestampMs: 0,
    };
  }

  private resolveHandedness(raw: 'Left' | 'Right'): 'Left' | 'Right' {
    if (this.lockedHandedness === null) {
      this.lockedHandedness = raw;
      this.pendingHandedness = null;
      this.pendingFrames = 0;
      return raw;
    }

    if (raw === this.lockedHandedness) {
      this.pendingHandedness = null;
      this.pendingFrames = 0;
      return this.lockedHandedness;
    }

    if (this.pendingHandedness === raw) {
      this.pendingFrames += 1;
    } else {
      this.pendingHandedness = raw;
      this.pendingFrames = 1;
    }

    if (this.pendingFrames >= HANDEDNESS_LOCK_FRAMES) {
      this.lockedHandedness = raw;
      this.pendingHandedness = null;
      this.pendingFrames = 0;
    }

    return this.lockedHandedness;
  }

  public update(frame: HandSkeletonFrame, dtSec: number): FilteredHandSkeleton {
    const dt = clamp(Number.isFinite(dtSec) ? dtSec : 1 / 60, 1e-4, 0.25);
    const raw2D: NormalizedPoint[] = frame.landmarks;
    const rawWorld: Vec3[] = frame.worldLandmarks;

    for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
      const p2 = raw2D[i];
      const out2 = this.outLandmarks2D[i];
      if (p2) {
        out2.x = this.lm2DFiltersX[i].filter(p2.x, dt);
        out2.y = this.lm2DFiltersY[i].filter(p2.y, dt);
        out2.z = this.lm2DFiltersZ[i].filter(p2.z ?? 0, dt);
      }

      const pw = rawWorld[i];
      const outW = this.outWorldLandmarks[i];
      if (pw) {
        outW.x = this.worldFiltersX[i].filter(pw.x, dt);
        outW.y = this.worldFiltersY[i].filter(pw.y, dt);
        outW.z = this.worldFiltersZ[i].filter(pw.z, dt);
      }
    }

    this.outResult.handedness = this.resolveHandedness(frame.handedness);
    this.outResult.timestampMs = frame.timestampMs;
    return this.outResult;
  }

  public reset(): void {
    for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
      this.lm2DFiltersX[i].reset();
      this.lm2DFiltersY[i].reset();
      this.lm2DFiltersZ[i].reset();
      this.worldFiltersX[i].reset();
      this.worldFiltersY[i].reset();
      this.worldFiltersZ[i].reset();
      this.outLandmarks2D[i].x = 0;
      this.outLandmarks2D[i].y = 0;
      this.outLandmarks2D[i].z = 0;
      this.outWorldLandmarks[i].x = 0;
      this.outWorldLandmarks[i].y = 0;
      this.outWorldLandmarks[i].z = 0;
    }
    this.lockedHandedness = null;
    this.pendingHandedness = null;
    this.pendingFrames = 0;
    this.outResult.handedness = 'Right';
    this.outResult.timestampMs = 0;
  }
}

export interface PerspectiveHandProjection {
  points3D: THREE.Vector3[];
  handDepthZ: number;
  focalPx: number;
  metersPerPx: number;
}

const DEFAULT_PERSPECTIVE_POINTS: THREE.Vector3[] = Array.from(
  { length: HAND_LANDMARK_COUNT },
  () => new THREE.Vector3()
);

/**
 * Projects filtered 21-point 2D screen landmarks + metric 3D `worldLandmarks` into
 * Three.js perspective camera space in meters (camera at origin `(0,0,0)` looking toward `-Z`,
 * `+X` right, `+Y` up).
 *
 * Projecting any `points3D[i]` back through `THREE.PerspectiveCamera(fovDeg, cssW/cssH, ...)`
 * lands on the exact `object-fit: cover` screen pixel `(screenX, screenY)` with `< 0.001 px` error,
 * while preserving real 3D metric depth foreshortening across all phalanges.
 */
export function projectHandToPerspectiveMeters(
  filtered2D: readonly Vec3[],
  filteredWorld: readonly Vec3[],
  rect: ImageLayoutRect,
  cssW: number,
  cssH: number,
  fovDeg = 58,
  mirrorX = false,
  outPoints?: THREE.Vector3[]
): PerspectiveHandProjection {
  const safeW = Math.max(1, cssW);
  const safeH = Math.max(1, cssH);
  const halfH = safeH * 0.5;
  const halfW = safeW * 0.5;
  const focalPx = halfH / Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5));

  const points3D =
    outPoints && outPoints.length >= HAND_LANDMARK_COUNT
      ? outPoints
      : DEFAULT_PERSPECTIVE_POINTS;

  const wWrist = filteredWorld[WRIST];
  const wMiddle = filteredWorld[MIDDLE_MCP];
  const wIndex = filteredWorld[INDEX_MCP];
  const wPinky = filteredWorld[PINKY_MCP];

  const sWrist = filtered2D[WRIST];
  const sMiddle = filtered2D[MIDDLE_MCP];
  const sIndex = filtered2D[INDEX_MCP];
  const sPinky = filtered2D[PINKY_MCP];

  // Combine 2 rigid palm bones: WRIST(0)->MIDDLE_MCP(9) and INDEX_MCP(5)->PINKY_MCP(17)
  let worldBone1 = DEFAULT_PALM_WRIST_TO_MIDDLE_METERS;
  let worldBone2 = DEFAULT_PALM_INDEX_TO_PINKY_METERS;
  if (wWrist && wMiddle) {
    const d = dist3D(wWrist, wMiddle);
    if (d > 0.025 && d < 0.16) worldBone1 = d;
  }
  if (wIndex && wPinky) {
    const d = dist3D(wIndex, wPinky);
    if (d > 0.02 && d < 0.14) worldBone2 = d;
  }

  let screenBone1 = 0;
  let screenBone2 = 0;
  if (sWrist && sMiddle) {
    const dx = ((mirrorX ? 1 - sMiddle.x : sMiddle.x) - (mirrorX ? 1 - sWrist.x : sWrist.x)) * rect.drawW;
    const dy = (sMiddle.y - sWrist.y) * rect.drawH;
    screenBone1 = Math.hypot(dx, dy);
  }
  if (sIndex && sPinky) {
    const dx = ((mirrorX ? 1 - sPinky.x : sPinky.x) - (mirrorX ? 1 - sIndex.x : sIndex.x)) * rect.drawW;
    const dy = (sPinky.y - sIndex.y) * rect.drawH;
    screenBone2 = Math.hypot(dx, dy);
  }

  // Weight each bone by its projected span relative to its metric length so foreshortened bones
  // naturally defer to the less-foreshortened orthogonal palm bone.
  const worldPalmSpanMeters = worldBone1 + worldBone2;
  const screenPalmSpanPx = Math.max(8, screenBone1 + screenBone2);

  // Also estimate foreshortening compensation from world Z difference along the palm bones
  // so tilting the palm in Z does not shrink screenPalmSpanPx artificially and inflate depth.
  let worldBone1XY = worldBone1;
  let worldBone2XY = worldBone2;
  if (wWrist && wMiddle) {
    worldBone1XY = Math.hypot(wMiddle.x - wWrist.x, wMiddle.y - wWrist.y);
  }
  if (wIndex && wPinky) {
    worldBone2XY = Math.hypot(wPinky.x - wIndex.x, wPinky.y - wIndex.y);
  }
  const apparentWorldSpan = Math.max(0.02, worldBone1XY + worldBone2XY);
  const effectiveWorldSpanMeters =
    apparentWorldSpan > 0.03 ? apparentWorldSpan * 0.72 + worldPalmSpanMeters * 0.28 : worldPalmSpanMeters;

  const handDepthZ = clamp(
    (effectiveWorldSpanMeters * focalPx) / screenPalmSpanPx,
    0.14,
    2.2
  );

  const wristWorldZ = wWrist ? wWrist.z : 0;

  for (let i = 0; i < HAND_LANDMARK_COUNT; i++) {
    const pt2 = filtered2D[i];
    const ptw = filteredWorld[i];
    if (!pt2) {
      points3D[i].set(0, 0, -handDepthZ);
      continue;
    }

    const nx = mirrorX ? 1.0 - pt2.x : pt2.x;
    const screenX = rect.drawX + nx * rect.drawW;
    const screenY = rect.drawY + pt2.y * rect.drawH;

    // In MediaPipe worldLandmarks, +z points AWAY from the camera, so larger z => deeper (-Z in Three.js)
    const relWorldZ = ptw ? ptw.z - wristWorldZ : 0;
    const depthI = Math.max(0.05, handDepthZ + relWorldZ);

    const camX = ((screenX - halfW) / focalPx) * depthI;
    const camY = ((halfH - screenY) / focalPx) * depthI;
    const camZ = -depthI;

    points3D[i].set(camX, camY, camZ);
  }

  return {
    points3D,
    handDepthZ,
    focalPx,
    metersPerPx: handDepthZ / focalPx,
  };
}

// Pre-allocated scratch vectors/quaternions for zero-allocation basis computation
const _axisX = new THREE.Vector3();
const _axisY = new THREE.Vector3();
const _axisZ = new THREE.Vector3();
const _palmLateralX = new THREE.Vector3();
const _palmDorsalZ = new THREE.Vector3();
const _proxSeg = new THREE.Vector3();
const _midSeg = new THREE.Vector3();
const _distSeg = new THREE.Vector3();
const _flexNormal = new THREE.Vector3();
const _thumbOpp = new THREE.Vector3();
const _wristToIndex = new THREE.Vector3();
const _wristToPinky = new THREE.Vector3();
const _pronationQuat = new THREE.Quaternion();
const _basisMat = new THREE.Matrix4();

/**
 * Computes a guaranteed right-handed orthonormal anatomical nail basis `M ∈ SO(3)` (`det(M) === +1`)
 * for a given finger from 21 3D points ALREADY in Three.js camera space (`+X` right, `+Y` up, `+Z` toward camera):
 *
 * - `+Y` (`axisY`): distal longitudinal direction `normalize(TIP - DIP)` (cuticle → free edge)
 * - `+X` (`axisX`): lateral across the nail bed (left → right viewed from dorsal side)
 * - `+Z` (`axisZ = axisX × axisY`): outward dorsal nail-bed normal
 */
export function computeFingerAnatomicalBasis(
  fingerId: FingerId,
  scenePoints3D: readonly THREE.Vector3[],
  handedness: 'Left' | 'Right',
  mirrorX: boolean,
  outMatrix?: THREE.Matrix4
): THREE.Matrix4 {
  const mat = outMatrix ?? _basisMat;
  const spec = FINGER_LANDMARK_INDICES[fingerId];

  const wrist = scenePoints3D[WRIST];
  const indexMcp = scenePoints3D[INDEX_MCP];
  const pinkyMcp = scenePoints3D[PINKY_MCP];

  const mcp = scenePoints3D[spec.mcp];
  const pip = scenePoints3D[spec.pip];
  const dip = scenePoints3D[spec.dip];
  const tip = scenePoints3D[spec.tip];

  if (!dip || !tip || !indexMcp || !pinkyMcp) {
    return mat.identity();
  }

  // 1. Longitudinal distal nail axis (+Y)
  _axisY.subVectors(tip, dip);
  if (_axisY.lengthSq() < 1e-10) {
    _axisY.set(0, 1, 0);
  } else {
    _axisY.normalize();
  }

  // Handedness + mirror parity:
  // Right, mirrorX=false => flipLateral=true  (INDEX_MCP->PINKY_MCP is +X, so INDEX-PINKY is -X -> negate)
  // Right, mirrorX=true  => flipLateral=false
  // Left,  mirrorX=false => flipLateral=false
  // Left,  mirrorX=true  => flipLateral=true
  const flipLateral = (handedness === 'Right') !== mirrorX;

  // Palm lateral reference axis (+X when dorsal faces camera & fingers point +Y)
  _palmLateralX.subVectors(indexMcp, pinkyMcp);
  if (flipLateral) {
    _palmLateralX.negate();
  }
  if (_palmLateralX.lengthSq() < 1e-10) {
    _palmLateralX.set(1, 0, 0);
  } else {
    _palmLateralX.normalize();
  }

  if (fingerId === 'thumb') {
    // Thumb anatomical kinematics with calibrated ~65° pronation around axisY
    const cmc = scenePoints3D[THUMB_CMC] ?? mcp;
    const tMcp = scenePoints3D[THUMB_MCP] ?? pip;
    const tIp = scenePoints3D[THUMB_IP] ?? dip;

    // Outward palm dorsal normal for stable fallback & reference:
    // For Right, mirrorX=false, dorsal facing +Z: (indexMcp - wrist) is (-X,+Y), (pinkyMcp - wrist) is (+X,+Y)
    // (-X,+Y) x (+X,+Y) = -Z; negating when flipLateral gives +Z (dorsal toward camera).
    if (wrist) {
      _wristToIndex.subVectors(indexMcp, wrist);
      _wristToPinky.subVectors(pinkyMcp, wrist);
      _palmDorsalZ.crossVectors(_wristToIndex, _wristToPinky);
      if (flipLateral) _palmDorsalZ.negate();
    } else {
      _palmDorsalZ.set(0, 0, 1);
    }
    if (_palmDorsalZ.lengthSq() < 1e-10) {
      _palmDorsalZ.set(0, 0, 1);
    } else {
      _palmDorsalZ.normalize();
    }

    // Opposition vector from thumb CMC toward index MCP
    _thumbOpp.subVectors(indexMcp, cmc);
    if (_thumbOpp.lengthSq() < 1e-10) {
      _thumbOpp.copy(_palmLateralX);
    } else {
      _thumbOpp.normalize();
    }

    // Thumb flexion plane normal: (MCP - CMC) × (IP - MCP)
    _proxSeg.subVectors(tMcp, cmc);
    _midSeg.subVectors(tIp, tMcp);
    const proxLen = _proxSeg.length();
    const midLen = _midSeg.length();
    _flexNormal.crossVectors(_proxSeg, _midSeg);
    const flexCrossLen = _flexNormal.length();
    const sinThumbFlex =
      proxLen > 1e-5 && midLen > 1e-5 ? flexCrossLen / (proxLen * midLen) : 0;

    // Start from the hand's dorsal plane normal blended smoothly with opposition/flexion cues
    // before applying the anatomical ~65° thumb pronation around axisY.
    // First construct an initial unpronated dorsal normal aligned with the palm dorsal direction.
    _axisZ
      .copy(_palmDorsalZ)
      .addScaledVector(_axisY, -_palmDorsalZ.dot(_axisY));

    if (_axisZ.lengthSq() < 1e-4) {
      // Thumb pointing directly along palm dorsal axis: use opposition cross axisY
      _axisZ.crossVectors(_thumbOpp, _axisY);
      if (flipLateral) _axisZ.negate();
    }

    if (_axisZ.lengthSq() < 1e-6) {
      _axisZ.crossVectors(_palmLateralX, _axisY);
    }
    if (_axisZ.lengthSq() < 1e-6) {
      _axisZ.set(0, 0, 1).addScaledVector(_axisY, -_axisY.z);
    }
    _axisZ.normalize();

    // Blend subtle flexion-plane hinge stabilization when thumb bends significantly
    if (flexCrossLen > 1e-6 && sinThumbFlex > 0.15) {
      _flexNormal.divideScalar(flexCrossLen);
      // Align flexNormal with _axisX = _axisY × _axisZ candidate
      _axisX.crossVectors(_axisY, _axisZ);
      if (_axisX.lengthSq() > 1e-6) {
        _axisX.normalize();
        if (_flexNormal.dot(_axisX) < 0) _flexNormal.negate();
        const wFlex = smoothstep(0.15, 0.45, sinThumbFlex) * 0.35;
        _axisX.lerp(_flexNormal, wFlex);
        _axisX.addScaledVector(_axisY, -_axisX.dot(_axisY));
        if (_axisX.lengthSq() > 1e-6) {
          _axisX.normalize();
          _axisZ.crossVectors(_axisX, _axisY).normalize();
        }
      }
    }

    // Orthonormalize pre-pronation right-handed basis: X = Y × Z, Z = X × Y
    _axisX.crossVectors(_axisY, _axisZ);
    if (_axisX.lengthSq() < 1e-8) {
      _axisX.set(1, 0, 0).addScaledVector(_axisY, -_axisY.x);
    }
    _axisX.normalize();
    _axisZ.crossVectors(_axisX, _axisY).normalize();

    // Apply calibrated ~65° thumb pronation around axisY (right-hand rule around +Y):
    // Rotating +Z by -65° around +Y sends +Z -> (-sin(65°), 0, +cos(65°)) = (-0.906, 0, +0.423),
    // which faces outward-forward (-X, +Z) on a Right dorsal-facing thumb (flipLateral=true),
    // and +65° sends +Z -> (+0.906, 0, +0.423) on a Left dorsal-facing thumb (flipLateral=false).
    const pronationAngle = flipLateral ? -THUMB_PRONATION_RAD : THUMB_PRONATION_RAD;
    _pronationQuat.setFromAxisAngle(_axisY, pronationAngle);
    _axisX.applyQuaternion(_pronationQuat);
    _axisZ.applyQuaternion(_pronationQuat);

    // Final exact Gram-Schmidt right-handed orthonormalization (det(M) === +1)
    _axisZ.crossVectors(_axisX, _axisY).normalize();
    _axisX.crossVectors(_axisY, _axisZ).normalize();

    return mat.makeBasis(_axisX, _axisY, _axisZ);
  }

  // 2. Non-thumb fingers (index, middle, ring, pinky):
  // Smooth blend between rigid palm lateral hinge (`palmLateralX`) and distal finger flexion plane
  // normal (`(PIP - MCP) × (DIP - PIP)`), so curling 0° -> 140° rotates axisZ smoothly into the real dorsal plane.
  _axisX.copy(_palmLateralX);

  if (mcp && pip) {
    _proxSeg.subVectors(pip, mcp);
    _midSeg.subVectors(dip, pip);
    const proxLen = _proxSeg.length();
    const midLen = _midSeg.length();

    if (proxLen > 1e-5 && midLen > 1e-5) {
      _flexNormal.crossVectors(_proxSeg, _midSeg);
      const crossLen = _flexNormal.length();
      const sinFlex = crossLen / (proxLen * midLen);

      // Fallback to (DIP - PIP) × (TIP - DIP) if proximal/middle joints are nearly collinear
      if (sinFlex < 0.12) {
        _distSeg.subVectors(tip, dip);
        const distLen = _distSeg.length();
        if (distLen > 1e-5) {
          _flexNormal.crossVectors(_midSeg, _distSeg);
          const distCrossLen = _flexNormal.length();
          const sinDistFlex = distCrossLen / (midLen * distLen);
          if (sinDistFlex > sinFlex && distCrossLen > 1e-6) {
            _flexNormal.divideScalar(distCrossLen);
            if (_flexNormal.dot(_palmLateralX) < 0) _flexNormal.negate();
            const wFlex = smoothstep(0.12, 0.38, sinDistFlex);
            _axisX.lerp(_flexNormal, wFlex);
          }
        }
      } else if (crossLen > 1e-6) {
        _flexNormal.divideScalar(crossLen);
        if (_flexNormal.dot(_palmLateralX) < 0) _flexNormal.negate();
        const wFlex = smoothstep(0.12, 0.38, sinFlex);
        _axisX.lerp(_flexNormal, wFlex);
      }
    }
  }

  // Project axisX orthogonal to axisY
  _axisX.addScaledVector(_axisY, -_axisX.dot(_axisY));

  if (_axisX.lengthSq() < 1e-6) {
    // Degenerate case where finger axisY aligns closely with palmLateralX:
    // fall back to palm dorsal normal to establish a stable lateral axis
    if (wrist) {
      _wristToIndex.subVectors(indexMcp, wrist);
      _wristToPinky.subVectors(pinkyMcp, wrist);
      _palmDorsalZ.crossVectors(_wristToIndex, _wristToPinky);
      if (flipLateral) _palmDorsalZ.negate();
    } else {
      _palmDorsalZ.set(0, 0, 1);
    }
    if (_palmDorsalZ.lengthSq() < 1e-6) _palmDorsalZ.set(0, 0, 1);
    _palmDorsalZ.normalize();

    _axisX.crossVectors(_axisY, _palmDorsalZ);
    if (_axisX.lengthSq() < 1e-6) {
      _axisX.set(1, 0, 0).addScaledVector(_axisY, -_axisY.x);
      if (_axisX.lengthSq() < 1e-6) {
        _axisX.set(0, 0, 1).addScaledVector(_axisY, -_axisY.z);
      }
    }
  }
  _axisX.normalize();

  // Right-handed orthonormalization: Z = normalize(X × Y), X = normalize(Y × Z) => det(M) === +1
  _axisZ.crossVectors(_axisX, _axisY).normalize();
  _axisX.crossVectors(_axisY, _axisZ).normalize();

  return mat.makeBasis(_axisX, _axisY, _axisZ);
}

export interface FingerMetricDimensions {
  distalLenMeters: number;
  bedLengthMeters: number;
  nailWidthMeters: number;
  phalanxRadiusMeters: number;
  palmThicknessMeters: number;
}

export interface FingerMetricDimensionsOptions {
  livePoints3D?: readonly THREE.Vector3[];
  calibration?: LiveFingerCalibration;
  focalPx?: number;
}

/**
 * Computes real metric finger dimensions (in meters) directly from MediaPipe `worldLandmarks`
 * and, when available, prioritizes the client's live calibrated finger width measured directly
 * from the camera frame (`livePoints3D` + `calibration` + `focalPx`), bounded within safe
 * anatomical salon limits.
 */
export function computeFingerMetricDimensions(
  fingerId: FingerId,
  worldLandmarks: readonly Vec3[],
  options?: FingerMetricDimensionsOptions
): FingerMetricDimensions {
  const spec = FINGER_LANDMARK_INDICES[fingerId];
  const clampCfg = ANATOMICAL_METRIC_CLAMPS[fingerId];

  const dip = worldLandmarks[spec.dip];
  const tip = worldLandmarks[spec.tip];
  const pip = worldLandmarks[spec.pip];
  const mcp = worldLandmarks[spec.mcp];
  const wrist = worldLandmarks[WRIST];
  const indexMcp = worldLandmarks[INDEX_MCP];
  const middleMcp = worldLandmarks[MIDDLE_MCP];
  const pinkyMcp = worldLandmarks[PINKY_MCP];

  let rawDistal = clampCfg.distalFallback;
  if (dip && tip) {
    const d = dist3D(dip, tip);
    if (d > 0.006 && d < 0.055) {
      rawDistal = d;
    } else if (pip && dip) {
      const midLen = dist3D(pip, dip);
      if (midLen > 0.01 && midLen < 0.07) {
        rawDistal = midLen * 0.78;
      }
    }
  }

  const distalLenMeters = clamp(rawDistal, clampCfg.distalMin, clampCfg.distalMax);

  // Estimate global hand size ratio from palm landmarks to refine nail width proportionally
  let palmScaleRatio = 1.0;
  if (wrist && middleMcp && indexMcp && pinkyMcp) {
    const wristToMid = dist3D(wrist, middleMcp);
    const indexToPinky = dist3D(indexMcp, pinkyMcp);
    const palmSpan = wristToMid + indexToPinky;
    if (palmSpan > 0.06 && palmSpan < 0.26) {
      palmScaleRatio = clamp(
        palmSpan / (DEFAULT_PALM_WRIST_TO_MIDDLE_METERS + DEFAULT_PALM_INDEX_TO_PINKY_METERS),
        0.78,
        1.28
      );
    }
  } else if (mcp && pip) {
    const prox = dist3D(mcp, pip);
    if (prox > 0.015 && prox < 0.075) {
      palmScaleRatio = clamp(prox / 0.042, 0.8, 1.25);
    }
  }

  const palmThicknessMeters = clamp(0.022 * palmScaleRatio, 0.015, 0.032);

  // Priority 1: Live camera anatomical calibration (client's real finger width & bed length)
  const livePoints3D = options?.livePoints3D;
  const calibration = options?.calibration;
  const focalPx = options?.focalPx;
  const liveDip3D = livePoints3D?.[spec.dip];
  const liveTip3D = livePoints3D?.[spec.tip];

  if (
    liveDip3D &&
    liveTip3D &&
    calibration &&
    focalPx !== undefined &&
    Number.isFinite(focalPx) &&
    focalPx > 10
  ) {
    const rawLiveDistal3D = liveTip3D.distanceTo(liveDip3D);
    if (Number.isFinite(rawLiveDistal3D) && rawLiveDistal3D > 0.005 && rawLiveDistal3D < 0.065) {
      const liveDistal3D = clamp(rawLiveDistal3D, clampCfg.distalMin, clampCfg.distalMax);
      // Cuticle at lerp(DIP, TIP, 0.20) -> TIP covers ~78% of DIP->TIP distal phalanx
      const bedLengthMeters = clamp(liveDistal3D * 0.78, 0.0085, 0.020);

      const calibratedRatio = clamp(
        calibration.widthToDistalRatio[fingerId] ?? clampCfg.widthToDistalRatio,
        0.42,
        fingerId === 'thumb' ? 0.82 : 0.78
      );
      const ratioWidthMeters = calibratedRatio * liveDistal3D;

      const measuredWidthPx = calibration.widthPx[fingerId];
      const conf = calibration.confidence[fingerId] ?? 0;

      let fingerWidthMeters = ratioWidthMeters;
      if (
        measuredWidthPx !== undefined &&
        Number.isFinite(measuredWidthPx) &&
        measuredWidthPx > 2 &&
        conf > 0.15
      ) {
        const fingerDepthZ = Math.abs(liveDip3D.z * 0.65 + liveTip3D.z * 0.35);
        if (fingerDepthZ > 0.05) {
          const pxWidthMeters = (measuredWidthPx / focalPx) * fingerDepthZ;
          // Blend direct perspective width with pitch-invariant calibrated ratio
          const pxWeight = clamp(0.45 + 0.35 * conf, 0.45, 0.8);
          fingerWidthMeters = pxWidthMeters * pxWeight + ratioWidthMeters * (1 - pxWeight);
        }
      }

      const nailWidthMeters = clamp(fingerWidthMeters * 0.85, 0.0072, 0.021);
      const phalanxRadiusMeters = clamp(fingerWidthMeters * 0.50, 0.0044, 0.0125);

      return {
        distalLenMeters: liveDistal3D,
        bedLengthMeters,
        nailWidthMeters,
        phalanxRadiusMeters,
        palmThicknessMeters,
      };
    }
  }

  // Fallback (legacy / unit tests without live camera calibration): worldLandmarks metrics
  // Natural nail bed covers from lerp(DIP, TIP, 0.22) up to TIP (~78% of DIP->TIP),
  // scaled at 0.72 * distalLenMeters within [8.5 mm, 17.5 mm]
  const bedLengthMeters = clamp(distalLenMeters * 0.72, 0.0085, 0.0175);

  const widthFromDistal = distalLenMeters * clampCfg.widthToDistalRatio;
  const widthFromPalm = clampCfg.widthFallback * palmScaleRatio;
  const nailWidthMeters = clamp(
    widthFromPalm * 0.68 + widthFromDistal * 0.32,
    clampCfg.widthMin,
    clampCfg.widthMax
  );

  const phalanxRadiusMeters = clamp(
    nailWidthMeters * clampCfg.radiusToWidthRatio,
    0.0048,
    0.0135
  );

  return {
    distalLenMeters,
    bedLengthMeters,
    nailWidthMeters,
    phalanxRadiusMeters,
    palmThicknessMeters,
  };
}
