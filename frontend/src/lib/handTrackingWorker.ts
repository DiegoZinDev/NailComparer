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
}

const DEFAULT_WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const FALLBACK_WASM_BASE_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const DEFAULT_MODEL_ASSET_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const MEDIAPIPE_NUM_HANDS = 1;
const MEDIAPIPE_MIN_DETECTION_CONFIDENCE = 0.52;
const MEDIAPIPE_MIN_PRESENCE_CONFIDENCE = 0.52;
const MEDIAPIPE_MIN_TRACKING_CONFIDENCE = 0.55;

function toHandSkeletonFrame(
  result: HandLandmarkerResult | null | undefined,
  timestampMs: number
): HandSkeletonFrame | null {
  if (!result) return null;

  const rawLandmarks = result.landmarks?.[0];
  if (!rawLandmarks || rawLandmarks.length < 21) return null;

  const rawWorld = result.worldLandmarks?.[0];
  if (!rawWorld || rawWorld.length < 21) return null;

  const rawCategory =
    result.handedness?.[0]?.[0]?.categoryName ??
    result.handednesses?.[0]?.[0]?.categoryName;
  const handedness: 'Left' | 'Right' = rawCategory === 'Left' ? 'Left' : 'Right';

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

/**
 * Decoupled MediaPipe HandLandmarker controller returning unified 21-point `HandSkeletonFrame`
 * (both screen-normalized `landmarks` and metric `worldLandmarks` in meters).
 *
 * Uses safe main-thread execution with MediaPipe WASM/GPU delegates (avoiding Vite/Vercel
 * Worker-import/importScripts WASM bundling failures) while preserving an asynchronous
 * decoupled architecture (`init`, `detectVideo`, `detectImage`, `dispose`).
 */
export class HandTrackerController {
  private videoLandmarker: HandLandmarker | null = null;
  private imageLandmarker: HandLandmarker | null = null;
  private visionFileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
  private initPromise: Promise<void> | null = null;
  private imageInitPromise: Promise<HandLandmarker | null> | null = null;
  private disposed = false;
  private ready = false;
  private lastVideoTimestampMs = -1;

  private readonly wasmBasePath: string;
  private readonly modelAssetPath: string;
  private readonly preferredDelegate: 'GPU' | 'CPU';

  constructor(options?: HandTrackerOptions) {
    this.wasmBasePath = options?.wasmBasePath ?? DEFAULT_WASM_BASE_PATH;
    this.modelAssetPath = options?.modelAssetPath ?? DEFAULT_MODEL_ASSET_PATH;
    this.preferredDelegate = options?.delegate ?? 'GPU';
  }

  public isReady(): boolean {
    return this.ready && !this.disposed && this.videoLandmarker !== null;
  }

  private async resolveVisionFileset() {
    if (this.visionFileset) return this.visionFileset;
    try {
      this.visionFileset = await FilesetResolver.forVisionTasks(this.wasmBasePath);
    } catch {
      this.visionFileset = await FilesetResolver.forVisionTasks(FALLBACK_WASM_BASE_PATH);
    }
    return this.visionFileset;
  }

  private async createLandmarker(runningMode: HandTrackerRunningMode): Promise<HandLandmarker> {
    const vision = await this.resolveVisionFileset();
    try {
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.modelAssetPath,
          delegate: this.preferredDelegate,
        },
        runningMode,
        numHands: MEDIAPIPE_NUM_HANDS,
        minHandDetectionConfidence: MEDIAPIPE_MIN_DETECTION_CONFIDENCE,
        minHandPresenceConfidence: MEDIAPIPE_MIN_PRESENCE_CONFIDENCE,
        minTrackingConfidence: MEDIAPIPE_MIN_TRACKING_CONFIDENCE,
      });
    } catch (gpuErr) {
      if (this.preferredDelegate === 'CPU') throw gpuErr;
      // Safe fallback to CPU delegate if WebGL/GPU delegate fails on restricted devices
      return await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.modelAssetPath,
          delegate: 'CPU',
        },
        runningMode,
        numHands: MEDIAPIPE_NUM_HANDS,
        minHandDetectionConfidence: MEDIAPIPE_MIN_DETECTION_CONFIDENCE,
        minHandPresenceConfidence: MEDIAPIPE_MIN_PRESENCE_CONFIDENCE,
        minTrackingConfidence: MEDIAPIPE_MIN_TRACKING_CONFIDENCE,
      });
    }
  }

  /**
   * Initializes the primary VIDEO-mode MediaPipe `HandLandmarker`.
   * Safe to call multiple times; deduplicates concurrent initialization.
   */
  public async init(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.videoLandmarker) {
      this.ready = true;
      return true;
    }

    if (!this.initPromise) {
      this.initPromise = (async () => {
        const landmarker = await this.createLandmarker('VIDEO');
        if (this.disposed) {
          landmarker.close();
          return;
        }
        this.videoLandmarker = landmarker;
        this.ready = true;
      })().catch((err) => {
        this.initPromise = null;
        this.ready = false;
        throw err;
      });
    }

    try {
      await this.initPromise;
      return this.isReady();
    } catch {
      return false;
    }
  }

  private async ensureImageLandmarker(): Promise<HandLandmarker | null> {
    if (this.disposed) return null;
    if (this.imageLandmarker) return this.imageLandmarker;

    if (!this.imageInitPromise) {
      this.imageInitPromise = (async () => {
        const landmarker = await this.createLandmarker('IMAGE');
        if (this.disposed) {
          landmarker.close();
          return null;
        }
        this.imageLandmarker = landmarker;
        return landmarker;
      })().catch(() => {
        this.imageInitPromise = null;
        return null;
      });
    }

    return this.imageInitPromise;
  }

  /**
   * Runs VIDEO-mode hand landmark detection on an active `<video>` / canvas / ImageBitmap source
   * with strictly monotonic timestamp enforcement required by MediaPipe.
   */
  public detectVideo(
    source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap,
    timestampMs: number
  ): HandSkeletonFrame | null {
    if (this.disposed || !this.videoLandmarker) return null;

    // MediaPipe VIDEO mode requires strictly increasing timestamps
    const monotonicTs =
      timestampMs > this.lastVideoTimestampMs ? timestampMs : this.lastVideoTimestampMs + 1;
    this.lastVideoTimestampMs = monotonicTs;

    try {
      const result = this.videoLandmarker.detectForVideo(source, monotonicTs);
      return toHandSkeletonFrame(result, monotonicTs);
    } catch {
      return null;
    }
  }

  /**
   * Runs IMAGE-mode hand landmark detection on a static demo image (`HTMLImageElement`,
   * `HTMLCanvasElement`, or `ImageBitmap`), lazily initializing an IMAGE-mode landmarker.
   */
  public async detectImage(
    source: HTMLImageElement | HTMLCanvasElement | ImageBitmap
  ): Promise<HandSkeletonFrame | null> {
    if (this.disposed) return null;
    const landmarker = await this.ensureImageLandmarker();
    if (!landmarker || this.disposed) return null;

    try {
      const ts = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const result = landmarker.detect(source);
      return toHandSkeletonFrame(result, ts);
    } catch {
      return null;
    }
  }

  public resetTracking(): void {
    this.lastVideoTimestampMs = -1;
  }

  public dispose(): void {
    this.disposed = true;
    this.ready = false;

    if (this.videoLandmarker) {
      try {
        this.videoLandmarker.close();
      } catch {
        // Ignore cleanup errors
      }
      this.videoLandmarker = null;
    }

    if (this.imageLandmarker) {
      try {
        this.imageLandmarker.close();
      } catch {
        // Ignore cleanup errors
      }
      this.imageLandmarker = null;
    }

    this.initPromise = null;
    this.imageInitPromise = null;
    this.visionFileset = null;
  }
}
