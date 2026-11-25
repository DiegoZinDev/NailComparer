import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandSkeletonFrame, NormalizedPoint, Vec3 } from '../types/nail';

export type HandTrackerRunningMode = 'VIDEO' | 'IMAGE';

export interface HandTrackerOptions {
  wasmBasePath?: string;
  modelAssetPath?: string;
  delegate?: 'GPU' | 'CPU';
  preferWorker?: boolean;
  minIntervalMs?: number;
}

export interface DetectedImageHandsResult {
  landmarks: NormalizedPoint[][];
  worldLandmarks: Vec3[][];
  handednesses: ('Left' | 'Right')[];
}

const MEDIAPIPE_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const DEFAULT_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const VIDEO_NUM_HANDS = 1;
const VIDEO_MIN_DETECTION_CONFIDENCE = 0.52;
const VIDEO_MIN_PRESENCE_CONFIDENCE = 0.52;
const VIDEO_MIN_TRACKING_CONFIDENCE = 0.55;

const IMAGE_MIN_DETECTION_CONFIDENCE = 0.35;
const IMAGE_MIN_PRESENCE_CONFIDENCE = 0.35;

const DEFAULT_VIDEO_PACING_MS = 30;

// -----------------------------------------------------------------------------
// Module-level HandLandmarker Singleton (shared across AR, studio-demo, and photo analyzer)
// -----------------------------------------------------------------------------
let sharedLandmarker: HandLandmarker | null = null;
let sharedInitPromise: Promise<HandLandmarker | null> | null = null;
let sharedRunningMode: HandTrackerRunningMode = 'VIDEO';
let sharedNumHands = VIDEO_NUM_HANDS;
let singletonBusy = false;
let singletonOpQueue: Promise<void> = Promise.resolve();
let activeControllerCount = 0;

function withSingletonMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = singletonOpQueue.then(async () => {
    singletonBusy = true;
    try {
      return await fn();
    } finally {
      singletonBusy = false;
    }
  });
  singletonOpQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function getOrInitSharedLandmarker(
  wasmBasePath = MEDIAPIPE_WASM_ROOT,
  modelAssetPath = DEFAULT_MODEL_ASSET_PATH,
  preferredDelegate: 'GPU' | 'CPU' = 'GPU'
): Promise<HandLandmarker | null> {
  if (sharedLandmarker) return sharedLandmarker;
  if (sharedInitPromise) return sharedInitPromise;

  sharedInitPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(wasmBasePath);
      let landmarker: HandLandmarker;
      try {
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate: preferredDelegate,
          },
          runningMode: 'VIDEO',
          numHands: VIDEO_NUM_HANDS,
          minHandDetectionConfidence: VIDEO_MIN_DETECTION_CONFIDENCE,
          minHandPresenceConfidence: VIDEO_MIN_PRESENCE_CONFIDENCE,
          minTrackingConfidence: VIDEO_MIN_TRACKING_CONFIDENCE,
        });
      } catch (gpuErr) {
        if (preferredDelegate === 'CPU') throw gpuErr;
        // Safe fallback to CPU delegate on restricted mobile/WebGL devices
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numHands: VIDEO_NUM_HANDS,
          minHandDetectionConfidence: VIDEO_MIN_DETECTION_CONFIDENCE,
          minHandPresenceConfidence: VIDEO_MIN_PRESENCE_CONFIDENCE,
          minTrackingConfidence: VIDEO_MIN_TRACKING_CONFIDENCE,
        });
      }

      sharedLandmarker = landmarker;
      sharedRunningMode = 'VIDEO';
      sharedNumHands = VIDEO_NUM_HANDS;
      return landmarker;
    } catch {
      sharedInitPromise = null;
      return null;
    }
  })();

  return sharedInitPromise;
}

async function ensureSingletonMode(
  landmarker: HandLandmarker,
  mode: HandTrackerRunningMode,
  numHands: number
): Promise<void> {
  if (sharedRunningMode === mode && sharedNumHands === numHands) {
    return;
  }

  if (mode === 'IMAGE') {
    await landmarker.setOptions({
      runningMode: 'IMAGE',
      numHands,
      minHandDetectionConfidence: IMAGE_MIN_DETECTION_CONFIDENCE,
      minHandPresenceConfidence: IMAGE_MIN_PRESENCE_CONFIDENCE,
    });
  } else {
    await landmarker.setOptions({
      runningMode: 'VIDEO',
      numHands,
      minHandDetectionConfidence: VIDEO_MIN_DETECTION_CONFIDENCE,
      minHandPresenceConfidence: VIDEO_MIN_PRESENCE_CONFIDENCE,
      minTrackingConfidence: VIDEO_MIN_TRACKING_CONFIDENCE,
    });
  }

  sharedRunningMode = mode;
  sharedNumHands = numHands;
}

function parseHandedness(
  result: HandLandmarkerResult,
  index: number
): 'Left' | 'Right' {
  const rawCategory =
    result.handedness?.[index]?.[0]?.categoryName ??
    result.handednesses?.[index]?.[0]?.categoryName;
  return rawCategory === 'Left' ? 'Left' : 'Right';
}

function toHandSkeletonFrame(
  result: HandLandmarkerResult | null | undefined,
  timestampMs: number
): HandSkeletonFrame | null {
  if (!result) return null;

  const rawLandmarks = result.landmarks?.[0];
  if (!rawLandmarks || rawLandmarks.length < 21) return null;

  const rawWorld = result.worldLandmarks?.[0];
  if (!rawWorld || rawWorld.length < 21) return null;

  const handedness = parseHandedness(result, 0);
  const landmarks: NormalizedPoint[] = new Array<NormalizedPoint>(21);
  const worldLandmarks: Vec3[] = new Array<Vec3>(21);

  for (let i = 0; i < 21; i++) {
    const lm = rawLandmarks[i];
    landmarks[i] = {
      x: lm.x,
      y: lm.y,
      z: lm.z ?? 0,
    };

    const w = rawWorld[i];
    worldLandmarks[i] = {
      x: w.x,
      y: w.y,
      z: w.z ?? 0,
    };
  }

  return {
    landmarks,
    worldLandmarks,
    handedness,
    timestampMs,
  };
}

function toDetectedImageHandsResult(
  result: HandLandmarkerResult | null | undefined
): DetectedImageHandsResult {
  const empty: DetectedImageHandsResult = {
    landmarks: [],
    worldLandmarks: [],
    handednesses: [],
  };
  if (!result || !result.landmarks || result.landmarks.length === 0) {
    return empty;
  }

  const landmarks: NormalizedPoint[][] = [];
  const worldLandmarks: Vec3[][] = [];
  const handednesses: ('Left' | 'Right')[] = [];

  for (let h = 0; h < result.landmarks.length; h++) {
    const rawLm = result.landmarks[h];
    if (!rawLm || rawLm.length < 21) continue;
    const rawWorld = result.worldLandmarks?.[h];

    const lmList: NormalizedPoint[] = new Array<NormalizedPoint>(21);
    const worldList: Vec3[] = new Array<Vec3>(21);

    for (let i = 0; i < 21; i++) {
      const p = rawLm[i];
      lmList[i] = { x: p.x, y: p.y, z: p.z ?? 0 };

      const w = rawWorld?.[i];
      worldList[i] = w
        ? { x: w.x, y: w.y, z: w.z ?? 0 }
        : { x: 0, y: 0, z: 0 };
    }

    landmarks.push(lmList);
    worldLandmarks.push(worldList);
    handednesses.push(parseHandedness(result, h));
  }

  return { landmarks, worldLandmarks, handednesses };
}

/**
 * Runs IMAGE-mode detection using the shared module-level `HandLandmarker` singleton
 * protected by an async mutex so static photo imports & studio-demo never collide with
 * the live AR video tracking loop and never instantiate duplicate WASM models.
 */
export async function detectHandsOnImageWithSingleton(
  source: HTMLImageElement | HTMLCanvasElement,
  numHands = 2
): Promise<DetectedImageHandsResult> {
  return withSingletonMutex(async () => {
    const landmarker = await getOrInitSharedLandmarker();
    if (!landmarker) {
      return { landmarks: [], worldLandmarks: [], handednesses: [] };
    }

    try {
      await ensureSingletonMode(landmarker, 'IMAGE', numHands);
      const result = landmarker.detect(source);
      return toDetectedImageHandsResult(result);
    } catch {
      return { landmarks: [], worldLandmarks: [], handednesses: [] };
    }
  });
}

/**
 * Decoupled MediaPipe HandLandmarker controller backed by the single module-level
 * `HandLandmarker` singleton, returning unified 21-point `HandSkeletonFrame`
 * (both screen-normalized `landmarks` and metric `worldLandmarks` in meters).
 *
 * Enforces anti-reentrancy (`isDetecting`) and ~30Hz video detection pacing (`minIntervalMs = 30`)
 * so the 60fps UI/WebGL render loop stays silky smooth on mobile devices.
 */
export class HandTrackerController {
  private disposed = false;
  private ready = false;
  private isDetecting = false;
  private isSwitchingToVideo = false;
  private lastVideoTimestampMs = -1;
  private lastDetectWallMs = -Infinity;
  private lastFrame: HandSkeletonFrame | null = null;

  private readonly wasmBasePath: string;
  private readonly modelAssetPath: string;
  private readonly preferredDelegate: 'GPU' | 'CPU';
  private readonly minIntervalMs: number;

  constructor(options?: HandTrackerOptions) {
    this.wasmBasePath = options?.wasmBasePath ?? MEDIAPIPE_WASM_ROOT;
    this.modelAssetPath = options?.modelAssetPath ?? DEFAULT_MODEL_ASSET_PATH;
    this.preferredDelegate = options?.delegate ?? 'GPU';
    this.minIntervalMs = options?.minIntervalMs ?? DEFAULT_VIDEO_PACING_MS;
    activeControllerCount += 1;
  }

  public isReady(): boolean {
    return this.ready && !this.disposed && sharedLandmarker !== null;
  }

  /**
   * Initializes the shared MediaPipe `HandLandmarker` singleton in VIDEO mode.
   * Safe to call multiple times; deduplicates concurrent initialization across consumers.
   */
  public async init(): Promise<boolean> {
    if (this.disposed) return false;
    const landmarker = await getOrInitSharedLandmarker(
      this.wasmBasePath,
      this.modelAssetPath,
      this.preferredDelegate
    );
    if (this.disposed || !landmarker) {
      this.ready = false;
      return false;
    }

    await withSingletonMutex(async () => {
      if (!this.disposed && sharedLandmarker) {
        await ensureSingletonMode(sharedLandmarker, 'VIDEO', VIDEO_NUM_HANDS);
      }
    });

    if (this.disposed) return false;
    this.ready = true;
    return true;
  }

  /**
   * Runs VIDEO-mode hand landmark detection on an active `<video>` / canvas / ImageBitmap source
   * with strictly monotonic timestamp enforcement, anti-reentrancy guard, and configurable
   * ~30Hz pacing (`minIntervalMs = 30`) to keep WebGL/UI at 60fps.
   */
  public detectVideo(
    source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    timestampMs: number
  ): HandSkeletonFrame | null {
    if (this.disposed || !this.ready || !sharedLandmarker) return null;

    // Never collide with an in-flight IMAGE singleton operation or re-entrant call
    if (this.isDetecting || singletonBusy || this.isSwitchingToVideo) {
      return this.lastFrame;
    }

    // If an image call left the singleton in IMAGE mode, queue a safe switch back to VIDEO
    if (sharedRunningMode !== 'VIDEO' || sharedNumHands !== VIDEO_NUM_HANDS) {
      this.isSwitchingToVideo = true;
      void withSingletonMutex(async () => {
        if (!this.disposed && sharedLandmarker) {
          await ensureSingletonMode(sharedLandmarker, 'VIDEO', VIDEO_NUM_HANDS);
        }
      }).finally(() => {
        this.isSwitchingToVideo = false;
      });
      return this.lastFrame;
    }

    const wallNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (wallNow - this.lastDetectWallMs < this.minIntervalMs) {
      return this.lastFrame;
    }

    // MediaPipe VIDEO mode requires strictly increasing timestamps
    const monotonicTs =
      timestampMs > this.lastVideoTimestampMs ? timestampMs : this.lastVideoTimestampMs + 1;
    this.lastVideoTimestampMs = monotonicTs;
    this.lastDetectWallMs = wallNow;
    this.isDetecting = true;

    try {
      const result = sharedLandmarker.detectForVideo(source, monotonicTs);
      const frame = toHandSkeletonFrame(result, monotonicTs);
      this.lastFrame = frame;
      return frame;
    } catch {
      return this.lastFrame;
    } finally {
      this.isDetecting = false;
    }
  }

  /**
   * Runs IMAGE-mode hand landmark detection on a static demo image via the shared singleton.
   */
  public async detectImage(
    source: HTMLImageElement | HTMLCanvasElement
  ): Promise<HandSkeletonFrame | null> {
    if (this.disposed) return null;
    const detected = await detectHandsOnImageWithSingleton(source, 1);
    if (this.disposed || detected.landmarks.length === 0) return null;

    const ts = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      landmarks: detected.landmarks[0],
      worldLandmarks: detected.worldLandmarks[0],
      handedness: detected.handednesses[0] ?? 'Right',
      timestampMs: ts,
    };
  }

  public resetTracking(): void {
    this.lastVideoTimestampMs = -1;
    this.lastDetectWallMs = -Infinity;
    this.lastFrame = null;
  }

  /**
   * Marks this controller inactive without destroying the shared `HandLandmarker` singleton
   * so photo import and AR views continue sharing the warm WASM model with zero reload.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.isDetecting = false;
    this.lastFrame = null;
    activeControllerCount = Math.max(0, activeControllerCount - 1);
  }
}

