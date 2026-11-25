import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { HandTrackerController } from '../lib/handTrackingWorker';
import { computeCoverRect } from '../lib/nailRenderer';
import {
  type DirectionalAmbientLightSample,
  sampleDirectionalSkinLight,
} from '../lib/nailShaderMaterials';
import { ThreeNailScene } from '../lib/threeNailScene';
import type {
  ARViewMode,
  HandSkeletonFrame,
  NailAdjustment,
  NailDesign,
} from '../types/nail';

export interface ARCameraCanvasHandle {
  captureCompositeDataUrl: (studioName: string, logoDataUrl: string | null) => string | null;
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

const AMBIENT_SAMPLE_INTERVAL_MS = 150;

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
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const threeSceneRef = useRef<ThreeNailScene | null>(null);
    const trackerRef = useRef<HandTrackerController | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const demoImgRef = useRef<HTMLImageElement | null>(null);

    const latestCameraFrameRef = useRef<HandSkeletonFrame | null>(null);
    const demoFrameRef = useRef<HandSkeletonFrame | null>(null);
    const ambientRef = useRef<DirectionalAmbientLightSample>(DEFAULT_AMBIENT);
    const lastVideoTimeRef = useRef<number>(-1);
    const lastTrackingRef = useRef<boolean>(false);
    const lastFrameTimeRef = useRef<number>(0);
    const lastAmbientSampleTimeRef = useRef<number>(0);

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

    // Initialize Three.js V9 PBR 3D Nail Scene once on mount
    useEffect(() => {
      const glCanvas = glCanvasRef.current;
      if (!glCanvas) return;
      const sceneEngine = new ThreeNailScene(glCanvas);
      if (sceneEngine.isReady()) {
        threeSceneRef.current = sceneEngine;
      }
      return () => {
        sceneEngine.dispose();
        threeSceneRef.current = null;
      };
    }, []);

    // Initialize decoupled HandTrackerController once on mount
    useEffect(() => {
      let active = true;
      const tracker = new HandTrackerController();
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

    // Preload studio model hand image and extract real HandSkeletonFrame (landmarks + worldLandmarks)
    useEffect(() => {
      let cancelled = false;
      const img = new Image();
      img.src = '/hand-demo.png';
      img.onload = async () => {
        if (cancelled) return;
        demoImgRef.current = img;

        const tracker = trackerRef.current;
        if (!tracker) return;
        const frame = await tracker.detectImage(img);
        if (!cancelled && frame) {
          demoFrameRef.current = frame;
        }
      };

      return () => {
        cancelled = true;
      };
    }, []);

    // Reset tracking state when switching mode or camera facing direction
    useEffect(() => {
      latestCameraFrameRef.current = null;
      lastVideoTimeRef.current = -1;
      trackerRef.current?.resetTracking();
      threeSceneRef.current?.resetTracking();

      const hasDemoFrame = mode === 'studio-demo' && demoFrameRef.current !== null;
      if (lastTrackingRef.current !== hasDemoFrame) {
        lastTrackingRef.current = hasDemoFrame;
        onTrackingChangeRef.current?.(hasDemoFrame);
      }
    }, [mode, facingMode]);

    // Manage WebRTC camera stream with HTTPS secure-context validation & Android fallback
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
              width: { ideal: 1280 },
              height: { ideal: 1920 },
              frameRate: { ideal: 60, max: 60 },
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

    // Sync MediaPipe detection directly to incoming camera frames via requestVideoFrameCallback
    // (with clean fallback to video.currentTime check inside the RAF loop on browsers without rVFC)
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

    // Main 60fps Render Loop: video/demo draw + fallback detection + throttled directional skin light + Three.js V9 render
    useEffect(() => {
      let rafId = 0;

      const renderFrame = (nowMs: number) => {
        const prevTime = lastFrameTimeRef.current;
        const deltaTimeSec =
          prevTime > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - prevTime) / 1000)) : 1 / 60;
        lastFrameTimeRef.current = nowMs;

        const canvas = canvasRef.current;
        if (!canvas) {
          rafId = requestAnimationFrame(renderFrame);
          return;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = canvas.clientWidth || window.innerWidth;
        const cssH = canvas.clientHeight || window.innerHeight;
        const targetW = Math.round(cssW * dpr);
        const targetH = Math.round(cssH * dpr);

        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          rafId = requestAnimationFrame(renderFrame);
          return;
        }

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, cssW, cssH);

        const threeScene = threeSceneRef.current;
        const tracker = trackerRef.current;
        const currentMode = modeRef.current;
        const activeDesignNow = designRef.current;
        const video = videoRef.current;
        const demoImg = demoImgRef.current;

        const canSampleAmbient =
          nowMs - lastAmbientSampleTimeRef.current >= AMBIENT_SAMPLE_INTERVAL_MS;

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
            if (lastTrackingRef.current !== hasHand) {
              lastTrackingRef.current = hasHand;
              onTrackingChangeRef.current?.(hasHand);
            }
          }

          const cameraFrame = latestCameraFrameRef.current;
          if (canSampleAmbient && cameraFrame) {
            ambientRef.current = sampleDirectionalSkinLight(
              video,
              cameraFrame.landmarks,
              ambientRef.current
            );
            lastAmbientSampleTimeRef.current = nowMs;
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
                deltaTimeSec
              );
            } else {
              threeScene.clear(cssW, cssH, dpr);
            }
          }
        } else if (demoImg && demoImg.complete && demoImg.naturalWidth > 0) {
          const rect = computeCoverRect(cssW, cssH, demoImg.naturalWidth, demoImg.naturalHeight);
          ctx.fillStyle = '#120E10';
          ctx.fillRect(0, 0, cssW, cssH);
          ctx.drawImage(demoImg, rect.drawX, rect.drawY, rect.drawW, rect.drawH);

          const demoFrame = demoFrameRef.current;
          if (demoFrame) {
            if (!lastTrackingRef.current) {
              lastTrackingRef.current = true;
              onTrackingChangeRef.current?.(true);
            }
            if (canSampleAmbient) {
              ambientRef.current = sampleDirectionalSkinLight(
                demoImg,
                demoFrame.landmarks,
                ambientRef.current
              );
              lastAmbientSampleTimeRef.current = nowMs;
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
                deltaTimeSec
              );
            } else {
              threeScene.clear(cssW, cssH, dpr);
            }
          }
        } else {
          threeScene?.clear(cssW, cssH, dpr);
        }

        // Subtle editorial vignette for floating glass HUD legibility
        const topVig = ctx.createLinearGradient(0, 0, 0, 140);
        topVig.addColorStop(0, 'rgba(10, 8, 9, 0.45)');
        topVig.addColorStop(1, 'rgba(10, 8, 9, 0)');
        ctx.fillStyle = topVig;
        ctx.fillRect(0, 0, cssW, 140);

        const botVig = ctx.createLinearGradient(0, cssH - 220, 0, cssH);
        botVig.addColorStop(0, 'rgba(10, 8, 9, 0)');
        botVig.addColorStop(1, 'rgba(10, 8, 9, 0.58)');
        ctx.fillStyle = botVig;
        ctx.fillRect(0, cssH - 220, cssW, 220);

        ctx.restore();
        rafId = requestAnimationFrame(renderFrame);
      };

      rafId = requestAnimationFrame(renderFrame);
      return () => cancelAnimationFrame(rafId);
    }, []);

    useImperativeHandle(ref, () => ({
      captureCompositeDataUrl(studioName: string, logoDataUrl: string | null) {
        const srcCanvas = canvasRef.current;
        if (!srcCanvas) return null;

        const out = document.createElement('canvas');
        out.width = srcCanvas.width;
        out.height = srcCanvas.height;
        const ctx = out.getContext('2d');
        if (!ctx) return null;

        // Layer 1: Camera / Model Hand background
        ctx.drawImage(srcCanvas, 0, 0);

        // Layer 2: WebGL V9 3D Volumetric Nails overlay
        const glCanvas = glCanvasRef.current;
        if (glCanvas && glCanvas.width > 0 && glCanvas.height > 0) {
          ctx.drawImage(glCanvas, 0, 0, out.width, out.height);
        }

        // Layer 3: Editorial studio watermark
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

        return out.toDataURL('image/png', 0.95);
      },
    }));

    return (
      <div className="ar-viewport">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="ar-hidden-video"
          aria-hidden="true"
        />
        <canvas ref={canvasRef} className="ar-canvas" />
        <canvas ref={glCanvasRef} className="ar-webgl-overlay" aria-hidden="true" />

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
