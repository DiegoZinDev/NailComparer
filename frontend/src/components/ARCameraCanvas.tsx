import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { HandTrackerController } from '../lib/handTrackingWorker';
import { LiveFingerCalibrator } from '../lib/liveFingerCalibrator';
import { type ImageLayoutRect, computeCoverRect } from '../lib/nailRenderer';
import {
  type DirectionalAmbientLightSample,
  sampleDirectionalLightFromImageData,
} from '../lib/nailShaderMaterials';
import { ThreeNailScene } from '../lib/threeNailScene';
import type {
  ARViewMode,
  HandSkeletonFrame,
  LiveFingerCalibration,
  NailAdjustment,
  NailDesign,
} from '../types/nail';

export interface ARCameraCanvasHandle {
  captureCompositeDataUrl: (studioName: string, logoDataUrl: string | null) => string | null;
  captureRawFrameDataUrl: () => string | null;
}

interface ARCameraCanvasProps {
  mode: ARViewMode;
  onModeChange: (mode: ARViewMode) => void;
  facingMode: 'environment' | 'user';
  activeDesign: NailDesign | null;
  adjustment: NailAdjustment;
  compareClean: boolean;
  onTrackingChange?: (detected: boolean) => void;
  onCameraNotice?: (message: string | null) => void;
  onRequestImportClient?: () => void;
  onRequestImportStudio?: () => void;
}

const DEFAULT_AMBIENT: DirectionalAmbientLightSample = {
  r: 0.78,
  g: 0.63,
  b: 0.54,
  luma: 0.66,
  lightAzimuthX: -0.22,
  lightElevationY: 0.58,
};

const SAMPLE_INTERVAL_MS = 350;
const SAMPLE_SIZE = 64;
const HAND_LOSS_RESET_MS = 1800;

type ThreeNailSceneV10 = ThreeNailScene & {
  renderHandFrame: (
    cssW: number,
    cssH: number,
    dpr: number,
    rect: ImageLayoutRect,
    frame: HandSkeletonFrame | null,
    design: NailDesign | null,
    adjustment: NailAdjustment,
    ambient: DirectionalAmbientLightSample,
    mirrorX?: boolean,
    deltaTimeSec?: number,
    calibration?: LiveFingerCalibration
  ) => void;
  renderNow?: () => void;
};

export const ARCameraCanvas = React.forwardRef<ARCameraCanvasHandle, ARCameraCanvasProps>(
  function ARCameraCanvas(
    {
      mode,
      onModeChange,
      facingMode,
      activeDesign,
      adjustment,
      compareClean,
      onTrackingChange,
      onCameraNotice,
      onRequestImportClient,
      onRequestImportStudio,
    },
    ref
  ) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const threeSceneRef = useRef<ThreeNailSceneV10 | null>(null);
    const trackerRef = useRef<HandTrackerController | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const demoImgRef = useRef<HTMLImageElement | null>(null);

    // Single offscreen 64x64 sampler canvas + LiveFingerCalibrator shared between width calibration & directional lighting
    const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const sampleCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const calibratorRef = useRef<LiveFingerCalibrator>(new LiveFingerCalibrator());
    const calibrationRef = useRef<LiveFingerCalibration | undefined>(undefined);

    const latestCameraFrameRef = useRef<HandSkeletonFrame | null>(null);
    const demoFrameRef = useRef<HandSkeletonFrame | null>(null);
    const ambientRef = useRef<DirectionalAmbientLightSample>(DEFAULT_AMBIENT);
    const lastVideoTimeRef = useRef<number>(-1);
    const lastTrackingRef = useRef<boolean>(false);
    const lastHandSeenMsRef = useRef<number>(0);
    const lastFrameTimeRef = useRef<number>(0);
    const lastSampleTimeRef = useRef<number>(0);

    // Keep latest props in refs so 60fps RAF never restarts on slider drag or design switch
    const designRef = useRef<NailDesign | null>(activeDesign);
    designRef.current = activeDesign;
    const adjustmentRef = useRef(adjustment);
    adjustmentRef.current = adjustment;
    const compareCleanRef = useRef(compareClean);
    compareCleanRef.current = compareClean;
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const facingRef = useRef(facingMode);
    facingRef.current = facingMode;
    const onTrackingChangeRef = useRef(onTrackingChange);
    onTrackingChangeRef.current = onTrackingChange;

    const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'ready' | 'unavailable'>(
      'idle'
    );
    const [modelReady, setModelReady] = useState(false);

    // Initialize Three.js V10 PBR 3D Nail Scene once on mount
    useEffect(() => {
      const glCanvas = glCanvasRef.current;
      if (!glCanvas) return;
      const sceneEngine = new ThreeNailScene(glCanvas) as ThreeNailSceneV10;
      if (sceneEngine.isReady()) {
        threeSceneRef.current = sceneEngine;
      }
      return () => {
        sceneEngine.dispose();
        threeSceneRef.current = null;
      };
    }, []);

    // Initialize decoupled HandTrackerController singleton (~30Hz pacing) once on mount
    useEffect(() => {
      let active = true;
      const tracker = new HandTrackerController({ minIntervalMs: 30 });
      trackerRef.current = tracker;

      void tracker.init().then((ok) => {
        if (active) {
          setModelReady(ok);
        }
      });

      return () => {
        active = false;
        tracker.dispose();
        trackerRef.current = null;
      };
    }, []);

    // Detect landmarks on the directly rendered studio model <img> once both image and tracker are ready
    useEffect(() => {
      if (!modelReady) return;
      let cancelled = false;
      const img = demoImgRef.current;
      if (!img) return;

      const analyzeDemoImage = async () => {
        if (cancelled || demoFrameRef.current || !img.complete || img.naturalWidth <= 0) return;
        const tracker = trackerRef.current;
        if (!tracker || !tracker.isReady()) return;
        const frame = await tracker.detectImage(img);
        if (!cancelled && frame) {
          demoFrameRef.current = frame;
          lastHandSeenMsRef.current = performance.now();
          if (modeRef.current === 'studio-demo' && !lastTrackingRef.current) {
            lastTrackingRef.current = true;
            onTrackingChangeRef.current?.(true);
          }
        }
      };

      if (img.complete && img.naturalWidth > 0) {
        void analyzeDemoImage();
      } else {
        img.addEventListener('load', analyzeDemoImage, { once: true });
      }

      return () => {
        cancelled = true;
        img.removeEventListener('load', analyzeDemoImage);
      };
    }, [modelReady]);

    // Reset tracking & finger calibration when switching mode or camera facing direction
    useEffect(() => {
      latestCameraFrameRef.current = null;
      lastVideoTimeRef.current = -1;
      lastSampleTimeRef.current = 0;
      lastHandSeenMsRef.current = 0;
      calibratorRef.current.reset();
      calibrationRef.current = undefined;
      trackerRef.current?.resetTracking();
      threeSceneRef.current?.resetTracking();

      const hasDemoFrame = mode === 'studio-demo' && demoFrameRef.current !== null;
      if (lastTrackingRef.current !== hasDemoFrame) {
        lastTrackingRef.current = hasDemoFrame;
        onTrackingChangeRef.current?.(hasDemoFrame);
      }
    }, [mode, facingMode]);

    // Manage WebRTC camera stream with smooth mobile-friendly constraints & Android fallback
    useEffect(() => {
      if (mode !== 'camera') {
        setCameraState('idle');
        if (videoRef.current?.srcObject) {
          const stream = videoRef.current.srcObject as MediaStream;
          stream.getTracks().forEach((t) => t.stop());
          videoRef.current.srcObject = null;
        }
        return;
      }

      let active = true;
      let activeStream: MediaStream | null = null;
      setCameraState('starting');

      async function openCameraStream(): Promise<MediaStream> {
        const attempts: MediaStreamConstraints[] = [
          {
            audio: false,
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 720, max: 1280 },
              height: { ideal: 1280, max: 1920 },
              frameRate: { ideal: 30, max: 60 },
            },
          },
          {
            audio: false,
            video: {
              facingMode: { ideal: facingMode },
            },
          },
          {
            audio: false,
            video: true,
          },
        ];

        let lastErr: unknown;
        for (const constraints of attempts) {
          try {
            return await navigator.mediaDevices.getUserMedia(constraints);
          } catch (err) {
            lastErr = err;
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
              throw err;
            }
          }
        }
        throw lastErr;
      }

      async function startCamera() {
        if (!window.isSecureContext) {
          if (active) {
            setCameraState('unavailable');
            onCameraNotice?.(
              'Câmera AR exige contexto seguro HTTPS (ou localhost). Mantendo Mão Modelo calibrada.'
            );
            onModeChange('studio-demo');
          }
          return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
          if (active) {
            setCameraState('unavailable');
            onCameraNotice?.(
              'Navegador sem suporte a getUserMedia. Usando Mão Modelo em modo estúdio.'
            );
            onModeChange('studio-demo');
          }
          return;
        }

        try {
          onCameraNotice?.(null);
          const stream = await openCameraStream();
          if (!active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          activeStream = stream;
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            await video.play();
            if (active) setCameraState('ready');
          }
        } catch (err) {
          if (active) {
            setCameraState('unavailable');
            const isDenied =
              err instanceof DOMException &&
              (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
            onCameraNotice?.(
              isDenied
                ? 'Permissão de câmera negada. Libere a câmera nas configurações do navegador ou app.'
                : 'Nenhuma câmera disponível neste dispositivo. Usando Mão Modelo calibrada.'
            );
            onModeChange('studio-demo');
          }
        }
      }

      void startCamera();

      return () => {
        active = false;
        if (activeStream) {
          activeStream.getTracks().forEach((t) => t.stop());
        }
      };
    }, [mode, facingMode, onModeChange, onCameraNotice]);

    // Sync MediaPipe ~30Hz detection directly to incoming camera frames via requestVideoFrameCallback
    // (with fallback to video.currentTime check inside the RAF loop on browsers without rVFC)
    useEffect(() => {
      if (mode !== 'camera') return;
      const video = videoRef.current;
      if (!video) return;

      type VideoWithRVFC = HTMLVideoElement & {
        requestVideoFrameCallback?: (
          callback: (now: number, metadata: { mediaTime: number }) => void
        ) => number;
        cancelVideoFrameCallback?: (handle: number) => void;
      };

      const v = video as VideoWithRVFC;
      if (typeof v.requestVideoFrameCallback !== 'function') {
        return;
      }

      let cancelled = false;
      let vfcHandle = 0;

      const onVideoFrame = (nowMs: number, metadata: { mediaTime: number }) => {
        if (cancelled) return;

        const tracker = trackerRef.current;
        if (
          tracker &&
          tracker.isReady() &&
          video.readyState >= 2 &&
          video.videoWidth > 0
        ) {
          lastVideoTimeRef.current = video.currentTime;
          const tsMs =
            Number.isFinite(metadata.mediaTime) && metadata.mediaTime > 0
              ? metadata.mediaTime * 1000
              : nowMs;
          const detectedFrame = tracker.detectVideo(video, tsMs);
          latestCameraFrameRef.current = detectedFrame;

          const hasHand = detectedFrame !== null;
          if (hasHand) {
            lastHandSeenMsRef.current = nowMs;
          } else if (
            lastHandSeenMsRef.current > 0 &&
            nowMs - lastHandSeenMsRef.current > HAND_LOSS_RESET_MS
          ) {
            calibratorRef.current.reset();
            calibrationRef.current = undefined;
            lastHandSeenMsRef.current = 0;
          }

          if (lastTrackingRef.current !== hasHand) {
            lastTrackingRef.current = hasHand;
            onTrackingChangeRef.current?.(hasHand);
          }
        }

        if (!cancelled && typeof v.requestVideoFrameCallback === 'function') {
          vfcHandle = v.requestVideoFrameCallback(onVideoFrame);
        }
      };

      vfcHandle = v.requestVideoFrameCallback(onVideoFrame);

      return () => {
        cancelled = true;
        if (typeof v.cancelVideoFrameCallback === 'function' && vfcHandle) {
          v.cancelVideoFrameCallback(vfcHandle);
        }
      };
    }, [mode, cameraState]);

    // Main 60fps Zero-DrawImage Loop: WebGL 3D overlay + fallback ~30Hz tracking + shared 350ms 64x64 readback
    useEffect(() => {
      let rafId = 0;

      const getSampleContext = (): CanvasRenderingContext2D | null => {
        if (!sampleCanvasRef.current) {
          const c = document.createElement('canvas');
          c.width = SAMPLE_SIZE;
          c.height = SAMPLE_SIZE;
          sampleCanvasRef.current = c;
          sampleCtxRef.current = c.getContext('2d', { willReadFrequently: true });
        }
        return sampleCtxRef.current;
      };

      const runShared64Readback = (
        source: HTMLVideoElement | HTMLImageElement,
        frame: HandSkeletonFrame,
        rect: ImageLayoutRect,
        cssW: number,
        cssH: number,
        mirrorX: boolean,
        nowMs: number
      ) => {
        const sampleCtx = getSampleContext();
        if (!sampleCtx) return;

        try {
          // Single 64x64 drawImage in raw unmirrored source UV space [0,1]x[0,1]:
          // LiveFingerCalibrator maps screen coordinates via rect & mirrorX back into unmirrored source UV space,
          // and sampleDirectionalLightFromImageData samples raw landmarks directly with rect=(0,0,1,1), mirrorX=false.
          sampleCtx.drawImage(source, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
          const imageData = sampleCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

          calibrationRef.current = calibratorRef.current.updateFromFrameBuffer(
            imageData,
            frame.landmarks,
            rect,
            cssW,
            cssH,
            mirrorX
          );

          ambientRef.current = sampleDirectionalLightFromImageData(
            imageData,
            frame.landmarks,
            { drawX: 0, drawY: 0, drawW: 1, drawH: 1 },
            1,
            1,
            false,
            ambientRef.current
          );
          lastSampleTimeRef.current = nowMs;
        } catch {
          // Ignore transient video frame readback issues
        }
      };

      const renderFrame = (nowMs: number) => {
        const prevTime = lastFrameTimeRef.current;
        const deltaTimeSec =
          prevTime > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - prevTime) / 1000)) : 1 / 60;
        lastFrameTimeRef.current = nowMs;

        const viewport = viewportRef.current;
        const glCanvas = glCanvasRef.current;
        const threeScene = threeSceneRef.current;

        if (!viewport || !glCanvas) {
          rafId = requestAnimationFrame(renderFrame);
          return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = viewport.clientWidth || glCanvas.clientWidth || window.innerWidth;
        const cssH = viewport.clientHeight || glCanvas.clientHeight || window.innerHeight;

        const tracker = trackerRef.current;
        const currentMode = modeRef.current;
        const activeDesignNow = designRef.current;
        const video = videoRef.current;
        const demoImg = demoImgRef.current;
        const canSample = nowMs - lastSampleTimeRef.current >= SAMPLE_INTERVAL_MS;

        if (
          currentMode === 'camera' &&
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0
        ) {
          const mirrorX = facingRef.current === 'user';
          const rect = computeCoverRect(cssW, cssH, video.videoWidth, video.videoHeight);

          // Fallback detection when requestVideoFrameCallback is unavailable
          const supportsRVFC =
            typeof (video as HTMLVideoElement & { requestVideoFrameCallback?: unknown })
              .requestVideoFrameCallback === 'function';
          if (
            !supportsRVFC &&
            tracker &&
            tracker.isReady() &&
            video.currentTime !== lastVideoTimeRef.current
          ) {
            lastVideoTimeRef.current = video.currentTime;
            const detectedFrame = tracker.detectVideo(video, nowMs);
            latestCameraFrameRef.current = detectedFrame;
            const hasHand = detectedFrame !== null;
            if (hasHand) {
              lastHandSeenMsRef.current = nowMs;
            } else if (
              lastHandSeenMsRef.current > 0 &&
              nowMs - lastHandSeenMsRef.current > HAND_LOSS_RESET_MS
            ) {
              calibratorRef.current.reset();
              calibrationRef.current = undefined;
              lastHandSeenMsRef.current = 0;
            }
            if (lastTrackingRef.current !== hasHand) {
              lastTrackingRef.current = hasHand;
              onTrackingChangeRef.current?.(hasHand);
            }
          }

          const cameraFrame = latestCameraFrameRef.current;
          if (canSample && cameraFrame) {
            runShared64Readback(video, cameraFrame, rect, cssW, cssH, mirrorX, nowMs);
          }

          if (threeScene) {
            if (!compareCleanRef.current && cameraFrame && activeDesignNow) {
              threeScene.renderHandFrame(
                cssW,
                cssH,
                dpr,
                rect,
                cameraFrame,
                activeDesignNow,
                adjustmentRef.current,
                ambientRef.current,
                mirrorX,
                deltaTimeSec,
                calibrationRef.current
              );
            } else {
              threeScene.clear(cssW, cssH, dpr);
            }
          }
        } else if (
          currentMode === 'studio-demo' &&
          demoImg &&
          demoImg.complete &&
          demoImg.naturalWidth > 0
        ) {
          const rect = computeCoverRect(cssW, cssH, demoImg.naturalWidth, demoImg.naturalHeight);
          const demoFrame = demoFrameRef.current;

          if (demoFrame) {
            if (!lastTrackingRef.current) {
              lastTrackingRef.current = true;
              onTrackingChangeRef.current?.(true);
            }
            if (canSample) {
              runShared64Readback(demoImg, demoFrame, rect, cssW, cssH, false, nowMs);
            }
          }

          if (threeScene) {
            if (!compareCleanRef.current && demoFrame && activeDesignNow) {
              threeScene.renderHandFrame(
                cssW,
                cssH,
                dpr,
                rect,
                demoFrame,
                activeDesignNow,
                adjustmentRef.current,
                ambientRef.current,
                false,
                deltaTimeSec,
                calibrationRef.current
              );
            } else {
              threeScene.clear(cssW, cssH, dpr);
            }
          }
        } else {
          threeScene?.clear(cssW, cssH, dpr);
        }

        rafId = requestAnimationFrame(renderFrame);
      };

      rafId = requestAnimationFrame(renderFrame);
      return () => cancelAnimationFrame(rafId);
    }, []);

    useImperativeHandle(ref, () => ({
      captureCompositeDataUrl(studioName: string, logoDataUrl: string | null) {
        const viewport = viewportRef.current;
        if (!viewport) return null;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = viewport.clientWidth || window.innerWidth;
        const cssH = viewport.clientHeight || window.innerHeight;
        const outW = Math.max(1, Math.round(cssW * dpr));
        const outH = Math.max(1, Math.round(cssH * dpr));

        const out = document.createElement('canvas');
        out.width = outW;
        out.height = outH;
        const ctx = out.getContext('2d');
        if (!ctx) return null;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#120E10';
        ctx.fillRect(0, 0, cssW, cssH);

        // Layer 1: Direct <video> (mirrored when user-facing) or Studio Model <img> matching object-fit: cover
        const currentMode = modeRef.current;
        const video = videoRef.current;
        const demoImg = demoImgRef.current;

        if (
          currentMode === 'camera' &&
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0
        ) {
          const mirrorX = facingRef.current === 'user';
          const rect = computeCoverRect(cssW, cssH, video.videoWidth, video.videoHeight);
          ctx.save();
          if (mirrorX) {
            ctx.translate(cssW, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(
              video,
              cssW - rect.drawX - rect.drawW,
              rect.drawY,
              rect.drawW,
              rect.drawH
            );
          } else {
            ctx.drawImage(video, rect.drawX, rect.drawY, rect.drawW, rect.drawH);
          }
          ctx.restore();
        } else if (demoImg && demoImg.complete && demoImg.naturalWidth > 0) {
          const rect = computeCoverRect(cssW, cssH, demoImg.naturalWidth, demoImg.naturalHeight);
          ctx.drawImage(demoImg, rect.drawX, rect.drawY, rect.drawW, rect.drawH);
        }

        // Layer 2: Ensure WebGL framebuffer is populated even with preserveDrawingBuffer: false
        const threeScene = threeSceneRef.current;
        const glCanvas = glCanvasRef.current;
        if (threeScene && typeof threeScene.renderNow === 'function') {
          threeScene.renderNow();
        }
        if (glCanvas && glCanvas.width > 0 && glCanvas.height > 0) {
          ctx.drawImage(glCanvas, 0, 0, cssW, cssH);
        }

        ctx.restore();

        // Layer 3: Discreet editorial studio watermark
        const pad = Math.round(out.width * 0.045);
        const fontSize = Math.max(20, Math.round(out.width * 0.032));
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 12;

        if (logoDataUrl) {
          const logo = new Image();
          logo.src = logoDataUrl;
          if (logo.complete && logo.naturalWidth > 0) {
            const size = fontSize * 1.45;
            ctx.save();
            ctx.beginPath();
            ctx.arc(
              out.width - pad - size / 2,
              out.height - pad - size / 2 - fontSize * 0.9,
              size / 2,
              0,
              Math.PI * 2
            );
            ctx.clip();
            ctx.drawImage(
              logo,
              out.width - pad - size,
              out.height - pad - size - fontSize * 0.9,
              size,
              size
            );
            ctx.restore();
          }
        }

        ctx.fillStyle = 'rgba(255, 248, 244, 0.92)';
        ctx.font = `600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
        ctx.fillText(studioName, out.width - pad, out.height - pad - fontSize * 0.65);

        const designLabel = designRef.current?.name ?? 'Mão Natural';
        ctx.fillStyle = 'rgba(255, 248, 244, 0.68)';
        ctx.font = `500 ${Math.round(fontSize * 0.48)}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillText(
          `${designLabel} • Provador AR 3D`,
          out.width - pad,
          out.height - pad
        );
        ctx.restore();

        return out.toDataURL('image/jpeg', 0.92);
      },
      captureRawFrameDataUrl() {
        const currentMode = modeRef.current;
        const video = videoRef.current;
        const demoImg = demoImgRef.current;

        if (
          currentMode === 'camera' &&
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          video.videoHeight > 0
        ) {
          const out = document.createElement('canvas');
          out.width = video.videoWidth;
          out.height = video.videoHeight;
          const ctx = out.getContext('2d');
          if (!ctx) return null;
          const mirrorX = facingRef.current === 'user';
          ctx.save();
          if (mirrorX) {
            ctx.translate(out.width, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(video, 0, 0, out.width, out.height);
          ctx.restore();
          return out.toDataURL('image/jpeg', 0.94);
        }

        if (demoImg && demoImg.complete && demoImg.naturalWidth > 0) {
          const out = document.createElement('canvas');
          out.width = demoImg.naturalWidth;
          out.height = demoImg.naturalHeight;
          const ctx = out.getContext('2d');
          if (!ctx) return null;
          ctx.drawImage(demoImg, 0, 0, out.width, out.height);
          return out.toDataURL('image/jpeg', 0.94);
        }

        return null;
      },
    }));

    return (
      <div ref={viewportRef} className="ar-viewport" style={{ backgroundColor: '#120E10' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
            display: mode === 'camera' ? 'block' : 'none',
          }}
          aria-hidden="true"
        />

        <img
          ref={demoImgRef}
          src="/hand-demo.png"
          alt="Mão Modelo Estúdio"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: mode === 'studio-demo' ? 'block' : 'none',
          }}
        />

        {/* Editorial CSS gradient vignettes replacing per-frame 2D canvas vignette draws */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 140,
            background: 'linear-gradient(to bottom, rgba(10, 8, 9, 0.45), rgba(10, 8, 9, 0))',
            pointerEvents: 'none',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 220,
            background: 'linear-gradient(to top, rgba(10, 8, 9, 0.58), rgba(10, 8, 9, 0))',
            pointerEvents: 'none',
          }}
        />

        <canvas
          ref={glCanvasRef}
          className="ar-webgl-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />

        {mode === 'camera' && cameraState === 'starting' && (
          <div className="ar-camera-status glass-pill">
            Iniciando câmera {modelReady ? 'e motor 3D WebGL...' : 'HD...'}
          </div>
        )}

        {activeDesign === null && (
          <div
            className="glass-panel"
            style={{
              position: 'absolute',
              top: 'calc(76px + var(--safe-top))',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 14,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 14px',
              borderRadius: '999px',
              maxWidth: 'calc(100vw - 28px)',
            }}
          >
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 500,
                color: 'var(--glass-text)',
                whiteSpace: 'nowrap',
              }}
            >
              Mão natural ao vivo • Escolha ou importe uma unha
            </span>
            {onRequestImportClient && (
              <button
                type="button"
                onClick={onRequestImportClient}
                className="quick-shape-pill is-active"
                style={{ cursor: 'pointer' }}
              >
                Importar Foto
              </button>
            )}
            {onRequestImportStudio && (
              <button
                type="button"
                onClick={onRequestImportStudio}
                className="quick-shape-pill"
                style={{ cursor: 'pointer' }}
              >
                Catálogo
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);
