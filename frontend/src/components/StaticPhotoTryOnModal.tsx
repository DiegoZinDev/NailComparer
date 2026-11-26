import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  Download,
  Hand,
  ImagePlus,
  Loader2,
  MessageCircle,
  MoveHorizontal,
  Sparkles,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { detectHandsOnImageWithSingleton } from '../lib/handTrackingWorker';
import { LiveFingerCalibrator } from '../lib/liveFingerCalibrator';
import {
  type DirectionalAmbientLightSample,
  sampleDirectionalLightFromImageData,
} from '../lib/nailShaderMaterials';
import { ThreeNailScene } from '../lib/threeNailScene';
import {
  TechnicalSheetCard,
  buildWhatsappUrl,
  resolveDesignTechnicalSheet,
} from './TechnicalSheetCard';
import type {
  HandSkeletonFrame,
  LiveFingerCalibration,
  NailAdjustment,
  NailDesign,
  StudioConfig,
} from '../types/nail';

type CompareViewMode = 'before' | 'split' | 'after';

const DEFAULT_AMBIENT: DirectionalAmbientLightSample = {
  r: 0.78,
  g: 0.63,
  b: 0.54,
  luma: 0.66,
  lightAzimuthX: -0.22,
  lightElevationY: 0.58,
};

const MAX_RENDER_EDGE = 1080;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha ao ler a foto selecionada.'));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem.'));
    img.src = src;
  });
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

interface StaticPhotoTryOnModalProps {
  open: boolean;
  activeDesign: NailDesign | null;
  designs: NailDesign[];
  onSelectDesign: (design: NailDesign) => void;
  adjustment: NailAdjustment;
  config: StudioConfig;
  onCaptureCurrentFrame: () => string | null;
  onClose: () => void;
}

export const StaticPhotoTryOnModal: React.FC<StaticPhotoTryOnModalProps> = ({
  open,
  activeDesign,
  designs,
  onSelectDesign,
  adjustment,
  config,
  onCaptureCurrentFrame,
  onClose,
}) => {
  const [beforeDataUrl, setBeforeDataUrl] = useState<string | null>(null);
  const [afterDataUrl, setAfterDataUrl] = useState<string | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [detectedFrames, setDetectedFrames] = useState<HandSkeletonFrame[]>([]);
  const [detecting, setDetecting] = useState<boolean>(false);
  const [rendering, setRendering] = useState<boolean>(false);
  const [noHandDetected, setNoHandDetected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<CompareViewMode>('split');
  const [splitPercent, setSplitPercent] = useState<number>(52);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [exporting, setExporting] = useState<boolean>(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const offscreenGlCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeSceneRef = useRef<ThreeNailScene | null>(null);

  const dragSplitRef = useRef<{ active: boolean; pointerId: number }>({
    active: false,
    pointerId: -1,
  });
  const dragPanRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  // Dispose offscreen Three.js scene when modal unmounts
  useEffect(() => {
    return () => {
      threeSceneRef.current?.dispose();
      threeSceneRef.current = null;
      offscreenGlCanvasRef.current = null;
    };
  }, []);

  const technicalSheet = useMemo(() => {
    if (!activeDesign) return null;
    return resolveDesignTechnicalSheet(activeDesign, config.studioName);
  }, [activeDesign, config.studioName]);

  const resetZoomPan = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const ensureOffscreenScene = useCallback((): {
    canvas: HTMLCanvasElement;
    scene: ThreeNailScene;
  } | null => {
    if (!offscreenGlCanvasRef.current) {
      offscreenGlCanvasRef.current = document.createElement('canvas');
    }
    if (!threeSceneRef.current) {
      const scene = new ThreeNailScene(offscreenGlCanvasRef.current);
      if (!scene.isReady()) {
        scene.dispose();
        return null;
      }
      threeSceneRef.current = scene;
    }
    return {
      canvas: offscreenGlCanvasRef.current,
      scene: threeSceneRef.current,
    };
  }, []);

  const compositeStaticAfterImage = useCallback(
    (
      img: HTMLImageElement,
      frames: HandSkeletonFrame[],
      design: NailDesign | null,
      adj: NailAdjustment
    ): string | null => {
      if (!design || frames.length === 0) return null;
      const engine = ensureOffscreenScene();
      if (!engine) return null;

      const natW = img.naturalWidth || img.width;
      const natH = img.naturalHeight || img.height;
      if (natW <= 0 || natH <= 0) return null;

      const scale = Math.min(1, MAX_RENDER_EDGE / Math.max(natW, natH));
      const renderW = Math.max(1, Math.round(natW * scale));
      const renderH = Math.max(1, Math.round(natH * scale));

      const outCanvas = document.createElement('canvas');
      outCanvas.width = renderW;
      outCanvas.height = renderH;
      const outCtx = outCanvas.getContext('2d');
      if (!outCtx) return null;

      // Base layer: crisp original client hand photo
      outCtx.drawImage(img, 0, 0, renderW, renderH);

      // 64x64 readback for directional ambient light & finger width calibration
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 64;
      sampleCanvas.height = 64;
      const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      let sampleImageData: ImageData | null = null;
      if (sampleCtx) {
        sampleCtx.drawImage(img, 0, 0, 64, 64);
        sampleImageData = sampleCtx.getImageData(0, 0, 64, 64);
      }

      const rect = { drawX: 0, drawY: 0, drawW: renderW, drawH: renderH };

      // Render each detected hand cleanly onto the static photo (zero temporal jitter)
      for (const frame of frames) {
        let ambient = DEFAULT_AMBIENT;
        let calibration: LiveFingerCalibration | undefined;
        if (sampleImageData) {
          const calibrator = new LiveFingerCalibrator();
          calibration = calibrator.updateFromFrameBuffer(
            sampleImageData,
            frame.landmarks,
            rect,
            renderW,
            renderH,
            false
          );
          ambient = sampleDirectionalLightFromImageData(
            sampleImageData,
            frame.landmarks,
            { drawX: 0, drawY: 0, drawW: 1, drawH: 1 },
            1,
            1,
            false,
            DEFAULT_AMBIENT
          );
        }

        engine.scene.resetTracking();
        engine.scene.renderHandFrame(
          renderW,
          renderH,
          1,
          rect,
          frame,
          design,
          adj,
          ambient,
          false,
          1 / 60,
          calibration
        );
        engine.scene.renderNow();

        if (engine.canvas.width > 0 && engine.canvas.height > 0) {
          outCtx.drawImage(engine.canvas, 0, 0, renderW, renderH);
        }
      }

      return outCanvas.toDataURL('image/png');
    },
    [ensureOffscreenScene]
  );

  // Re-render static 3D nails whenever photo, hand detection, activeDesign, or adjustment changes
  useEffect(() => {
    if (!open || !sourceImage || detectedFrames.length === 0 || !activeDesign) {
      if (sourceImage && detectedFrames.length === 0) {
        setAfterDataUrl(null);
      }
      return;
    }

    setRendering(true);
    const rafId = requestAnimationFrame(() => {
      try {
        const rendered = compositeStaticAfterImage(
          sourceImage,
          detectedFrames,
          activeDesign,
          adjustment
        );
        setAfterDataUrl(rendered);
      } catch {
        setError('Não foi possível renderizar as unhas 3D nesta foto.');
      } finally {
        setRendering(false);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [open, sourceImage, detectedFrames, activeDesign, adjustment, compositeStaticAfterImage]);

  const processPhotoDataUrl = useCallback(
    async (dataUrl: string) => {
      setError(null);
      setNoHandDetected(false);
      setDetecting(true);
      setAfterDataUrl(null);
      setDetectedFrames([]);
      resetZoomPan();

      try {
        const img = await loadHtmlImage(dataUrl);
        setBeforeDataUrl(dataUrl);
        setSourceImage(img);

        const detected = await detectHandsOnImageWithSingleton(img, 2);
        if (detected.landmarks.length === 0) {
          setNoHandDetected(true);
          setViewMode('before');
          return;
        }

        const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const frames: HandSkeletonFrame[] = detected.landmarks.map((lm, idx) => ({
          landmarks: lm,
          worldLandmarks: detected.worldLandmarks[idx] ?? lm.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
          handedness: detected.handednesses[idx] ?? 'Right',
          timestampMs: nowMs + idx,
        }));

        setDetectedFrames(frames);
        setViewMode('split');
        setSplitPercent(52);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Falha ao analisar a foto da mão. Tente outra imagem.'
        );
      } finally {
        setDetecting(false);
      }
    },
    [resetZoomPan]
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await processPhotoDataUrl(dataUrl);
    } catch {
      setError('Não foi possível ler o arquivo de imagem.');
    } finally {
      e.target.value = '';
    }
  };

  const handleCaptureLiveFrame = () => {
    const raw = onCaptureCurrentFrame();
    if (!raw) {
      setError('Nenhum frame disponível no momento. Envie uma foto da galeria ou câmera.');
      return;
    }
    void processPhotoDataUrl(raw);
  };

  // Interactive horizontal split slider (pointer/touch)
  const updateSplitFromClientX = useCallback((clientX: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
    setSplitPercent(pct);
  }, []);

  const handleSplitPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragSplitRef.current = { active: true, pointerId: e.pointerId };
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragSplitRef.current.active || dragSplitRef.current.pointerId !== e.pointerId) return;
    e.stopPropagation();
    updateSplitFromClientX(e.clientX);
  };

  const handleSplitPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragSplitRef.current.pointerId === e.pointerId) {
      dragSplitRef.current.active = false;
      dragSplitRef.current.pointerId = -1;
    }
  };

  // Smooth pan when zoom > 1
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragPanRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragPanRef.current.active || dragPanRef.current.pointerId !== e.pointerId) return;
    const stage = stageRef.current;
    if (!stage) return;
    const maxPanX = (stage.clientWidth * (zoom - 1)) / 2;
    const maxPanY = (stage.clientHeight * (zoom - 1)) / 2;
    const nextX = clamp(
      dragPanRef.current.originX + (e.clientX - dragPanRef.current.startX),
      -maxPanX,
      maxPanX
    );
    const nextY = clamp(
      dragPanRef.current.originY + (e.clientY - dragPanRef.current.startY),
      -maxPanY,
      maxPanY
    );
    setPan({ x: nextX, y: nextY });
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragPanRef.current.pointerId === e.pointerId) {
      dragPanRef.current.active = false;
      dragPanRef.current.pointerId = -1;
    }
  };

  const adjustZoom = (delta: number) => {
    setZoom((prev) => {
      const next = clamp(Number((prev + delta).toFixed(2)), 1, 3);
      if (next <= 1) {
        setPan({ x: 0, y: 0 });
      }
      return next;
    });
  };

  // Export composed PNG with white-label studio watermark (respects Antes / Dividido / Depois)
  const buildWatermarkedExportPng = useCallback(async (): Promise<string | null> => {
    if (!beforeDataUrl) return null;
    const beforeImg = await loadHtmlImage(beforeDataUrl);
    const afterImg = afterDataUrl ? await loadHtmlImage(afterDataUrl) : null;

    const w = afterImg?.naturalWidth || beforeImg.naturalWidth;
    const h = afterImg?.naturalHeight || beforeImg.naturalHeight;
    if (w <= 0 || h <= 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (viewMode === 'before' || !afterImg) {
      ctx.drawImage(beforeImg, 0, 0, w, h);
    } else if (viewMode === 'after') {
      ctx.drawImage(afterImg, 0, 0, w, h);
    } else {
      // Split comparison export
      const splitX = Math.round((splitPercent / 100) * w);
      ctx.drawImage(afterImg, 0, 0, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, h);
      ctx.clip();
      ctx.drawImage(beforeImg, 0, 0, w, h);
      ctx.restore();

      // Divider line
      ctx.save();
      ctx.strokeStyle = 'rgba(243, 213, 192, 0.92)';
      ctx.lineWidth = Math.max(2, Math.round(w * 0.0035));
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, h);
      ctx.stroke();

      // Subtle Antes / Depois labels
      const badgeFont = Math.max(14, Math.round(w * 0.022));
      const badgePadX = Math.round(badgeFont * 0.75);
      const badgeH = Math.round(badgeFont * 1.9);
      const drawBadge = (label: string, x: number, alignRight: boolean) => {
        ctx.font = `600 ${badgeFont}px "Plus Jakarta Sans", sans-serif`;
        const tw = ctx.measureText(label).width;
        const bw = tw + badgePadX * 2;
        const bx = alignRight ? x - bw : x;
        const by = Math.round(h * 0.03);
        ctx.fillStyle = 'rgba(16, 13, 15, 0.72)';
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, badgeH, badgeH / 2);
        ctx.fill();
        ctx.fillStyle = '#FAF5F2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + bw / 2, by + badgeH / 2 + 1);
      };
      drawBadge('ANTES', Math.round(w * 0.03), false);
      drawBadge('DEPOIS', Math.round(w * 0.97), true);
      ctx.restore();
    }

    // Discreet editorial white-label watermark
    const pad = Math.round(w * 0.04);
    const fontSize = Math.max(20, Math.round(w * 0.032));
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,0.68)';
    ctx.shadowBlur = 12;

    if (config.logoDataUrl) {
      try {
        const logo = await loadHtmlImage(config.logoDataUrl);
        const size = fontSize * 1.45;
        ctx.save();
        ctx.beginPath();
        ctx.arc(
          w - pad - size / 2,
          h - pad - size / 2 - fontSize * 1.05,
          size / 2,
          0,
          Math.PI * 2
        );
        ctx.clip();
        ctx.drawImage(logo, w - pad - size, h - pad - size - fontSize * 1.05, size, size);
        ctx.restore();
      } catch {
        // Ignore broken logo data URL
      }
    }

    ctx.fillStyle = 'rgba(255, 248, 244, 0.94)';
    ctx.font = `600 ${fontSize}px "Cormorant Garamond", Georgia, serif`;
    ctx.fillText(config.studioName, w - pad, h - pad - fontSize * 0.62);

    const designLabel = activeDesign?.name ?? 'Provador Estático';
    ctx.fillStyle = 'rgba(255, 248, 244, 0.74)';
    ctx.font = `500 ${Math.round(fontSize * 0.46)}px "Plus Jakarta Sans", sans-serif`;
    ctx.fillText(`${designLabel} • Provador Estático 3D`, w - pad, h - pad);
    ctx.restore();

    return canvas.toDataURL('image/png');
  }, [beforeDataUrl, afterDataUrl, viewMode, splitPercent, config.logoDataUrl, config.studioName, activeDesign?.name]);

  const triggerPngDownload = (pngDataUrl: string) => {
    const link = document.createElement('a');
    link.href = pngDataUrl;
    const slug = (activeDesign?.name ?? 'unhas-estatico')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    link.download = `${slug}-antes-depois.png`;
    link.click();
  };

  const handleSaveImage = async () => {
    setExporting(true);
    try {
      const png = await buildWatermarkedExportPng();
      if (png) triggerPngDownload(png);
    } finally {
      setExporting(false);
    }
  };

  const handleWhatsAppShare = async () => {
    setExporting(true);
    try {
      const png = await buildWatermarkedExportPng();
      const shareText =
        technicalSheet?.whatsappText ??
        `Olha o Antes e Depois do modelo *${activeDesign?.name ?? 'Unhas 3D'}* na *${config.studioName}*!`;

      if (png) {
        try {
          const resp = await fetch(png);
          const blob = await resp.blob();
          const file = new File([blob], 'antes-depois-unhas-3d.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: config.studioName,
              text: shareText,
            });
            return;
          }
        } catch {
          // Graceful fallback to PNG download + WhatsApp deep link
        }
        triggerPngDownload(png);
      }

      const waUrl = buildWhatsappUrl(shareText, config.whatsappNumber);
      window.open(waUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setExporting(false);
    }
  };

  const hasResult = Boolean(beforeDataUrl && afterDataUrl && detectedFrames.length > 0);
  const canCompare = hasResult && !detecting;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="static-photo-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-backdrop"
          onClick={onClose}
        >
          <motion.div
            key="static-photo-sheet"
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className="modal-sheet glass-modal static-photo-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="static-photo-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">
                  {config.studioName} • Precisão Sem Tremulação
                </span>
                <h2 id="static-photo-title" className="modal-title">
                  Modo Foto Estática da Mão
                </h2>
              </div>
              <button
                type="button"
                className="icon-mini-btn"
                onClick={onClose}
                aria-label="Fechar modo foto estática"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body static-photo-body">
              {/* Photo Acquisition Bar */}
              <div className="static-upload-grid">
                <label className="upload-action-btn">
                  <Camera size={15} />
                  <span>Tirar Foto</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={detecting}
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>

                <label className="upload-action-btn is-secondary">
                  <Upload size={15} />
                  <span>Galeria</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={detecting}
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>

                <button
                  type="button"
                  className="upload-action-btn is-secondary static-capture-frame-btn"
                  disabled={detecting}
                  onClick={handleCaptureLiveFrame}
                >
                  <Hand size={15} />
                  <span>Usar Tela Atual</span>
                </button>
              </div>

              {/* Quick design switcher if multiple designs exist */}
              {designs.length > 0 && (
                <div className="static-design-strip" role="listbox" aria-label="Escolher modelo">
                  {designs.map((d) => {
                    const isSelected = d.id === activeDesign?.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => onSelectDesign(d)}
                        className={`static-design-chip ${isSelected ? 'is-active' : ''}`}
                      >
                        <span
                          className="static-design-dot"
                          style={{ backgroundColor: d.baseColor }}
                        />
                        <span>{d.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Empty State Prompt */}
              {!beforeDataUrl && !detecting && (
                <div className="static-empty-stage">
                  <div className="static-empty-icon">
                    <ImagePlus size={26} />
                  </div>
                  <h3>Prove o modelo na foto real da cliente</h3>
                  <p>
                    Fotografe ou envie a mão aberta em boa luz. Aplicamos as unhas 3D com precisão
                    estática, comparador Antes/Depois e zoom até 3× sem tremulação.
                  </p>
                </div>
              )}

              {/* Detection / Rendering Loading Indicator */}
              {(detecting || rendering) && (
                <div className="static-status-pill" role="status" aria-live="polite">
                  <Loader2 size={14} className="spin-icon" />
                  <span>
                    {detecting
                      ? 'Detectando os 5 dedos na foto estática...'
                      : 'Aplicando unhas 3D paramétricas...'}
                  </span>
                </div>
              )}

              {/* No Hand Detected Feedback */}
              {noHandDetected && !detecting && (
                <div className="missing-key-banner" role="alert">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} />
                    <strong>Nenhuma mão detectada nesta foto.</strong>
                  </span>
                  <span>
                    Posicione a mão aberta sobre fundo contrastante, com os dedos bem iluminados e
                    nítidos, e tente novamente.
                  </span>
                </div>
              )}

              {!activeDesign && beforeDataUrl && !noHandDetected && (
                <div className="missing-key-banner" role="status">
                  <span>
                    Selecione ou importe um modelo de unha no estúdio para visualizar o resultado
                    em 3D nesta foto.
                  </span>
                </div>
              )}

              {error && <p className="form-error">{error}</p>}

              {/* Interactive Before / After Stage with Zoom & Pan */}
              {beforeDataUrl && (
                <div className="static-comparator-wrap">
                  {/* View Mode + Zoom Bar */}
                  <div className="static-toolbar">
                    <div className="static-view-tabs" role="tablist" aria-label="Modo de visualização">
                      {(
                        [
                          { id: 'before', label: 'Antes' },
                          { id: 'split', label: 'Dividido' },
                          { id: 'after', label: 'Depois' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={viewMode === tab.id}
                          disabled={!canCompare && tab.id !== 'before'}
                          onClick={() => setViewMode(tab.id)}
                          className={`static-view-tab ${viewMode === tab.id ? 'is-active' : ''}`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="static-zoom-controls" aria-label="Controles de zoom">
                      <button
                        type="button"
                        className="icon-mini-btn"
                        onClick={() => adjustZoom(-0.5)}
                        disabled={zoom <= 1}
                        aria-label="Diminuir zoom"
                        title="Diminuir zoom"
                      >
                        <ZoomOut size={14} />
                      </button>
                      <button
                        type="button"
                        className="static-zoom-reset"
                        onClick={resetZoomPan}
                        title="Resetar zoom para 1x"
                      >
                        {zoom.toFixed(zoom % 1 === 0 ? 0 : 1)}×
                      </button>
                      <button
                        type="button"
                        className="icon-mini-btn"
                        onClick={() => adjustZoom(0.5)}
                        disabled={zoom >= 3}
                        aria-label="Aumentar zoom"
                        title="Aumentar zoom"
                      >
                        <ZoomIn size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Viewport Stage */}
                  <div
                    ref={stageRef}
                    className={`static-stage ${zoom > 1 ? 'is-pannable' : ''}`}
                    onPointerDown={handleStagePointerDown}
                    onPointerMove={handleStagePointerMove}
                    onPointerUp={handleStagePointerUp}
                    onPointerCancel={handleStagePointerUp}
                  >
                    <div
                      className="static-stage-transform"
                      style={{
                        transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                      }}
                    >
                      {/* Base image (After when in split/after, Before when in before or no after yet) */}
                      <img
                        src={
                          canCompare && viewMode !== 'before' && afterDataUrl
                            ? afterDataUrl
                            : beforeDataUrl
                        }
                        alt={
                          viewMode === 'before'
                            ? 'Foto original da mão (Antes)'
                            : `Unhas 3D aplicadas (${activeDesign?.name ?? 'Depois'})`
                        }
                        className="static-stage-img"
                        draggable={false}
                      />

                      {/* Clipped Before overlay in Split Mode */}
                      {canCompare && viewMode === 'split' && (
                        <div
                          className="static-split-before"
                          style={{
                            clipPath: `inset(0 ${100 - splitPercent}% 0 0)`,
                          }}
                        >
                          <img
                            src={beforeDataUrl}
                            alt="Antes (mão natural)"
                            className="static-stage-img"
                            draggable={false}
                          />
                        </div>
                      )}
                    </div>

                    {/* Corner labels */}
                    {canCompare && viewMode === 'split' && (
                      <>
                        <span className="static-corner-badge is-left">Antes</span>
                        <span className="static-corner-badge is-right">Depois</span>
                      </>
                    )}
                    {canCompare && viewMode === 'before' && (
                      <span className="static-corner-badge is-left">Antes</span>
                    )}
                    {canCompare && viewMode === 'after' && (
                      <span className="static-corner-badge is-right">
                        <Sparkles size={10} /> Depois 3D
                      </span>
                    )}

                    {/* Draggable Horizontal Split Handle */}
                    {canCompare && viewMode === 'split' && (
                      <div
                        className="static-split-handle"
                        style={{ left: `${splitPercent}%` }}
                        onPointerDown={handleSplitPointerDown}
                        onPointerMove={handleSplitPointerMove}
                        onPointerUp={handleSplitPointerUp}
                        onPointerCancel={handleSplitPointerUp}
                        role="slider"
                        aria-label="Comparador Antes e Depois"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(splitPercent)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowLeft') setSplitPercent((p) => clamp(p - 5, 0, 100));
                          if (e.key === 'ArrowRight') setSplitPercent((p) => clamp(p + 5, 0, 100));
                        }}
                      >
                        <div className="static-split-line" />
                        <div className="static-split-knob">
                          <MoveHorizontal size={14} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Accessible range fallback / precision slider */}
                  {canCompare && viewMode === 'split' && (
                    <div className="static-split-slider-row">
                      <span>Antes</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(splitPercent)}
                        onChange={(e) => setSplitPercent(Number(e.target.value))}
                        className="luxury-range"
                        aria-label="Posição da divisória Antes e Depois"
                      />
                      <span>Depois</span>
                    </div>
                  )}
                </div>
              )}

              {/* Integrated Collapsible Technical Sheet */}
              {technicalSheet && (
                <TechnicalSheetCard
                  sheet={technicalSheet}
                  studioWhatsapp={config.whatsappNumber}
                  title="Ficha Técnica do Modelo Aplicado"
                  collapsible
                  defaultOpen={false}
                  compact
                />
              )}

              {/* Export & WhatsApp Footer Actions */}
              {beforeDataUrl && (
                <div className="modal-actions static-export-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={exporting || detecting}
                    onClick={handleSaveImage}
                  >
                    <Download size={15} />
                    <span>{exporting ? 'Gerando...' : 'Salvar Imagem'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={exporting || detecting}
                    onClick={handleWhatsAppShare}
                  >
                    <MessageCircle size={15} />
                    <span>Enviar Antes/Depois + Ficha</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
