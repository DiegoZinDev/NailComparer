import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  DEMO_HAND_POSES,
  MEDIAPIPE_FINGER_PAIRS,
  computeCoverRect,
  renderNailsOnRect,
} from '../lib/nailRenderer';
import type { ARViewMode, FingerPose, NailAdjustment, NailDesign } from '../types/nail';

export interface ARCameraCanvasHandle {
  captureCompositeDataUrl: (studioName: string, logoDataUrl: string | null) => string | null;
}

interface ARCameraCanvasProps {
  mode: ARViewMode;
  onModeChange: (mode: ARViewMode) => void;
  facingMode: 'environment' | 'user';
  activeDesign: NailDesign;
  adjustment: NailAdjustment;
  compareClean: boolean;
  onTrackingChange?: (detected: boolean) => void;
  onCameraNotice?: (message: string | null) => void;
}

const SMOOTHING_ALPHA = 0.42;

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
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const demoImgRef = useRef<HTMLImageElement | null>(null);
    const landmarkerRef = useRef<HandLandmarker | null>(null);
    const smoothedPosesRef = useRef<FingerPose[] | null>(null);
    const lastVideoTimeRef = useRef<number>(-1);
    const lastTrackingRef = useRef<boolean>(false);

    // Keep latest props in refs so 60fps RAF never restarts on slider drag
    const designRef = useRef(activeDesign);
    designRef.current = activeDesign;
    const adjustmentRef = useRef(adjustment);
    adjustmentRef.current = adjustment;
    const compareCleanRef = useRef(compareClean);
    compareCleanRef.current = compareClean;
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const facingRef = useRef(facingMode);
    facingRef.current = facingMode;

    const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'ready' | 'unavailable'>(
      'idle'
    );
    const [modelReady, setModelReady] = useState(false);

    // Preload studio model hand image
    useEffect(() => {
      const img = new Image();
      img.src = '/hand-demo.png';
      img.onload = () => {
        demoImgRef.current = img;
      };
    }, []);

    // Initialize MediaPipe HandLandmarker lazily when camera mode is requested
    useEffect(() => {
      if (mode !== 'camera' || landmarkerRef.current) return;
      let cancelled = false;

      async function initLandmarker() {
        try {
          const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
          );
          if (cancelled) return;
          const handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 1,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });
          if (cancelled) {
            handLandmarker.close();
            return;
          }
          landmarkerRef.current = handLandmarker;
          setModelReady(true);
        } catch {
          // If WASM or CDN unavailable offline, fall back gracefully to studio demo
          if (!cancelled) {
            setModelReady(false);
          }
        }
      }

      initLandmarker();
      return () => {
        cancelled = true;
      };
    }, [mode]);

    // Manage WebRTC camera stream
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

      startCamera();

      return () => {
        active = false;
        if (activeStream) {
          activeStream.getTracks().forEach((t) => t.stop());
        }
      };
    }, [mode, facingMode, onModeChange, onCameraNotice]);

    // Main 60fps render + tracking loop
    useEffect(() => {
      let rafId = 0;

      const renderFrame = () => {
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

          // Run MediaPipe detection when a new video frame arrives
          const landmarker = landmarkerRef.current;
          if (landmarker && video.currentTime !== lastVideoTimeRef.current) {
            lastVideoTimeRef.current = video.currentTime;
            try {
              const result = landmarker.detectForVideo(video, performance.now());
              const hand = result.landmarks?.[0];
              if (hand && hand.length >= 21) {
                const rawPoses: FingerPose[] = MEDIAPIPE_FINGER_PAIRS.map((cfg) => {
                  const tip = hand[cfg.tipIdx];
                  const dip = hand[cfg.dipIdx];
                  const pip = hand[cfg.pipIdx];
                  const segLen = Math.hypot(
                    (tip.x - dip.x) * rect.drawW,
                    (tip.y - dip.y) * rect.drawH
                  );
                  const baseSeg = Math.hypot(
                    (dip.x - pip.x) * rect.drawW,
                    (dip.y - pip.y) * rect.drawH
                  );
                  const refLen = Math.max(segLen, baseSeg * 0.72, 16);
                  const widthNorm = (refLen * cfg.widthFactor) / rect.drawW;
                  const lenNorm = (refLen * cfg.lengthFactor) / rect.drawH;

                  return {
                    id: cfg.id,
                    tip: { x: tip.x, y: tip.y },
                    dip: { x: dip.x, y: dip.y },
                    widthScale: widthNorm,
                    lengthScale: lenNorm,
                  };
                });

                if (!smoothedPosesRef.current) {
                  smoothedPosesRef.current = rawPoses;
                } else {
                  smoothedPosesRef.current = rawPoses.map((next, idx) => {
                    const prev = smoothedPosesRef.current![idx];
                    return {
                      ...next,
                      tip: {
                        x: prev.tip.x + (next.tip.x - prev.tip.x) * SMOOTHING_ALPHA,
                        y: prev.tip.y + (next.tip.y - prev.tip.y) * SMOOTHING_ALPHA,
                      },
                      dip: {
                        x: prev.dip.x + (next.dip.x - prev.dip.x) * SMOOTHING_ALPHA,
                        y: prev.dip.y + (next.dip.y - prev.dip.y) * SMOOTHING_ALPHA,
                      },
                      widthScale:
                        prev.widthScale + (next.widthScale - prev.widthScale) * SMOOTHING_ALPHA,
                      lengthScale:
                        prev.lengthScale + (next.lengthScale - prev.lengthScale) * SMOOTHING_ALPHA,
                    };
                  });
                }

                if (!lastTrackingRef.current) {
                  lastTrackingRef.current = true;
                  onTrackingChange?.(true);
                }
              } else {
                smoothedPosesRef.current = null;
                if (lastTrackingRef.current) {
                  lastTrackingRef.current = false;
                  onTrackingChange?.(false);
                }
              }
            } catch {
              // Skip transient frame inference errors
            }
          }

          if (!compareCleanRef.current && smoothedPosesRef.current) {
            renderNailsOnRect(
              ctx,
              rect,
              smoothedPosesRef.current,
              designRef.current,
              adjustmentRef.current,
              mirrorX
            );
          }
        } else if (demoImg && demoImg.complete && demoImg.naturalWidth > 0) {
          // Studio Model Hand (Offline Demo Mode)
          const rect = computeCoverRect(cssW, cssH, demoImg.naturalWidth, demoImg.naturalHeight);

          // Soft ambient backdrop in studio tones around edges if needed
          ctx.fillStyle = '#120E10';
          ctx.fillRect(0, 0, cssW, cssH);
          ctx.drawImage(demoImg, rect.drawX, rect.drawY, rect.drawW, rect.drawH);

          if (!compareCleanRef.current) {
            renderNailsOnRect(
              ctx,
              rect,
              DEMO_HAND_POSES,
              designRef.current,
              adjustmentRef.current,
              false
            );
          }
        }

        // Subtle editorial vignette for floating glass HUD legibility
        const topVig = ctx.createLinearGradient(0, 0, 0, 140);
        topVig.addColorStop(0, 'rgba(10, 8, 9, 0.45)');
        topVig.addColorStop(1, 'rgba(10, 8, 9, 0)');
        ctx.fillStyle = topVig;
        ctx.fillRect(0, 0, cssW, 140);

        const botVig = ctx.createLinearGradient(0, cssH - 210, 0, cssH);
        botVig.addColorStop(0, 'rgba(10, 8, 9, 0)');
        botVig.addColorStop(1, 'rgba(10, 8, 9, 0.55)');
        ctx.fillStyle = botVig;
        ctx.fillRect(0, cssH - 210, cssW, 210);

        ctx.restore();
        rafId = requestAnimationFrame(renderFrame);
      };

      rafId = requestAnimationFrame(renderFrame);
      return () => cancelAnimationFrame(rafId);
    }, [onTrackingChange]);

    useImperativeHandle(ref, () => ({
      captureCompositeDataUrl(studioName: string, logoDataUrl: string | null) {
        const srcCanvas = canvasRef.current;
        if (!srcCanvas) return null;

        const out = document.createElement('canvas');
        out.width = srcCanvas.width;
        out.height = srcCanvas.height;
        const ctx = out.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(srcCanvas, 0, 0);

        // Editorial studio watermark in bottom-right corner
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
            ctx.arc(out.width - pad - size / 2, out.height - pad - size / 2 - fontSize * 0.9, size / 2, 0, Math.PI * 2);
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

        ctx.fillStyle = 'rgba(255, 248, 244, 0.68)';
        ctx.font = `500 ${Math.round(fontSize * 0.48)}px "Plus Jakarta Sans", sans-serif`;
        ctx.fillText(
          `${designRef.current.name} • Provador AR`,
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

        {mode === 'camera' && cameraState === 'starting' && (
          <div className="ar-camera-status glass-pill">
            Iniciando câmera {modelReady ? 'e rastreamento...' : 'HD...'}
          </div>
        )}
      </div>
    );
  }
);
