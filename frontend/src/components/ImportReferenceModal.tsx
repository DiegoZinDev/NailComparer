import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Check,
  Crosshair,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  FINGER_LABELS_PT,
  ORDERED_FINGERS,
  PATTERN_LABELS_PT,
  type PerFingerAnalysisResult,
  analyzeReferencePhotoPerFinger,
  extractTrueUVNailTexture,
} from '../lib/perFingerVisionAnalyzer';
import { generateNailSwatchDataUrl } from '../lib/swatchPreview';
import type {
  ArtisticPattern,
  FingerId,
  NailDesign,
  NailFingerDesignSpec,
  NailPatternType,
  NailShape,
  NailUvPinTarget,
} from '../types/nail';

const SHAPE_LABELS: Record<NailShape, string> = {
  natural: 'Natural',
  oval: 'Oval',
  almond: 'Amendoada',
  square: 'Quadrada',
  coffin: 'Bailarina',
  stiletto: 'Stiletto',
};

function mapArtisticToDesignPattern(pattern: ArtisticPattern): NailPatternType {
  switch (pattern) {
    case 'french_tip':
      return 'french';
    case 'chrome_mirror':
      return 'chrome';
    case 'gold_3d_waves':
      return 'gold-foil';
    case 'aura_gradient':
      return 'ombre';
    case 'floral_accent':
      return 'marble';
    case 'solid_gloss':
    default:
      return 'solid';
  }
}

function getSilhouetteBorderRadius(shape: NailShape): string {
  switch (shape) {
    case 'square':
      return '6px 6px 14px 14px';
    case 'coffin':
      return '10px 10px 16px 16px';
    case 'stiletto':
      return '50% 50% 24px 24px / 70% 70% 18px 18px';
    case 'natural':
      return '16px 16px 14px 14px';
    case 'oval':
    case 'almond':
    default:
      return '20px 20px 14px 14px';
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem'));
    img.src = src;
  });
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

const DEFAULT_PIN_TARGET: NailUvPinTarget = {
  cxNorm: 0.5,
  cyNorm: 0.5,
  widthNorm: 0.14,
  heightNorm: 0.22,
  angleRad: -Math.PI / 2,
  detectedFromPhoto: false,
};

const LOUPE_SIZE = 220;
const LOUPE_ZOOM = 4.0;

interface ImportReferenceModalProps {
  open: boolean;
  targetMode?: 'client' | 'studio';
  onClose: () => void;
  onCreateDesign: (design: Omit<NailDesign, 'id' | 'createdAt'>) => Promise<void>;
  onOpenSettings?: () => void;
}

export const ImportReferenceModal: React.FC<ImportReferenceModalProps> = ({
  open,
  targetMode = 'client',
  onClose,
  onCreateDesign,
}) => {
  const [name, setName] = useState('');
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [analysis, setAnalysis] = useState<PerFingerAnalysisResult | null>(null);
  const [fingerSpecs, setFingerSpecs] = useState<Record<FingerId, NailFingerDesignSpec> | null>(
    null
  );
  const [selectedFinger, setSelectedFinger] = useState<FingerId>('ring');
  const [angleOffsetDeg, setAngleOffsetDeg] = useState<number>(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number;
    lastX: number;
    lastY: number;
  }>({ active: false, pointerId: -1, lastX: 0, lastY: 0 });
  const pendingExtractRafRef = useRef<number | null>(null);
  const lastExtractTimeRef = useRef<number>(0);
  const baseAngleRef = useRef<Record<FingerId, number>>({
    thumb: -Math.PI / 2,
    index: -Math.PI / 2,
    middle: -Math.PI / 2,
    ring: -Math.PI / 2,
    pinky: -Math.PI / 2,
  });

  const isStudioMode = targetMode === 'studio';

  useEffect(() => {
    if (!open) {
      if (pendingExtractRafRef.current !== null) {
        cancelAnimationFrame(pendingExtractRafRef.current);
        pendingExtractRafRef.current = null;
      }
      setError(null);
      setAnalyzing(false);
    }
  }, [open]);

  const activeSpec = fingerSpecs ? fingerSpecs[selectedFinger] : null;
  const activeTarget: NailUvPinTarget = activeSpec?.uvExtractionTarget ?? DEFAULT_PIN_TARGET;

  const fingerPreviews = useMemo(() => {
    if (!fingerSpecs) return null;
    const previews = {} as Record<FingerId, string>;
    for (const id of ORDERED_FINGERS) {
      previews[id] = generateNailSwatchDataUrl(fingerSpecs[id], 180, 260);
    }
    return previews;
  }, [fingerSpecs]);

  const activePreviewUrl = fingerPreviews ? fingerPreviews[selectedFinger] : null;

  // Draw the 4x Zoom Interactive UV Pincher Loupe canvas
  const drawLoupeCanvas = useCallback(
    (img: HTMLImageElement | null, target: NailUvPinTarget) => {
      const canvas = loupeCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pxSize = Math.round(LOUPE_SIZE * dpr);
      if (canvas.width !== pxSize || canvas.height !== pxSize) {
        canvas.width = pxSize;
        canvas.height = pxSize;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#141116';
      ctx.fillRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

      if (!img) {
        ctx.restore();
        return;
      }

      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      const cxPx = target.cxNorm * srcW;
      const cyPx = target.cyNorm * srcH;
      const baseScale = LOUPE_SIZE / Math.max(1, Math.min(srcW, srcH));
      const zoomScale = baseScale * LOUPE_ZOOM;

      // Rotate view so the nail DIP->TIP axis points straight UP in the loupe
      const rotToUp = -Math.PI / 2 - target.angleRad;

      ctx.save();
      ctx.translate(LOUPE_SIZE * 0.5, LOUPE_SIZE * 0.5);
      ctx.scale(zoomScale, zoomScale);
      ctx.rotate(rotToUp);
      ctx.translate(-cxPx, -cyPx);
      ctx.drawImage(img, 0, 0, srcW, srcH);
      ctx.restore();

      // Overlay the exact 88% inner safe extraction nail silhouette
      const boxW = clamp(target.widthNorm * srcW * zoomScale * 0.88, 22, LOUPE_SIZE * 0.82);
      const boxH = clamp(target.heightNorm * srcH * zoomScale * 0.88, 30, LOUPE_SIZE * 0.86);
      const x0 = (LOUPE_SIZE - boxW) * 0.5;
      const y0 = (LOUPE_SIZE - boxH) * 0.5;
      const rTop = boxW * 0.46;
      const rBot = boxW * 0.34;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0 + rTop, y0);
      ctx.quadraticCurveTo(x0 + boxW * 0.5, y0 - boxH * 0.04, x0 + boxW - rTop, y0);
      ctx.quadraticCurveTo(x0 + boxW, y0, x0 + boxW, y0 + rTop);
      ctx.lineTo(x0 + boxW, y0 + boxH - rBot);
      ctx.quadraticCurveTo(x0 + boxW, y0 + boxH, x0 + boxW - rBot, y0 + boxH);
      ctx.lineTo(x0 + rBot, y0 + boxH);
      ctx.quadraticCurveTo(x0, y0 + boxH, x0, y0 + boxH - rBot);
      ctx.lineTo(x0, y0 + rTop);
      ctx.quadraticCurveTo(x0, y0, x0 + rTop, y0);
      ctx.closePath();

      ctx.fillStyle = 'rgba(255, 224, 178, 0.08)';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(255, 232, 185, 0.94)';
      ctx.stroke();
      ctx.setLineDash([]);

      // Center crosshair
      const mid = LOUPE_SIZE * 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mid - 7, mid);
      ctx.lineTo(mid + 7, mid);
      ctx.moveTo(mid, mid - 7);
      ctx.lineTo(mid, mid + 7);
      ctx.stroke();
      ctx.restore();

      ctx.restore();
    },
    []
  );

  useEffect(() => {
    if (sourceImage && activeTarget) {
      drawLoupeCanvas(sourceImage, activeTarget);
    }
  }, [sourceImage, activeTarget, drawLoupeCanvas]);

  // Throttled real-time UV re-extraction (~40ms via requestAnimationFrame)
  const scheduleUvReExtraction = useCallback(
    (fid: FingerId, nextTarget: NailUvPinTarget) => {
      if (!sourceImage) return;

      const runExtract = () => {
        pendingExtractRafRef.current = null;
        lastExtractTimeRef.current = performance.now();
        const trueUvDataUrl = extractTrueUVNailTexture(sourceImage, nextTarget, 512);
        if (!trueUvDataUrl) return;
        setFingerSpecs((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            [fid]: {
              ...prev[fid],
              uvExtractionTarget: nextTarget,
              trueUvDataUrl,
            },
          };
        });
      };

      const elapsed = performance.now() - lastExtractTimeRef.current;
      if (elapsed >= 40) {
        if (pendingExtractRafRef.current !== null) {
          cancelAnimationFrame(pendingExtractRafRef.current);
        }
        pendingExtractRafRef.current = requestAnimationFrame(runExtract);
      } else if (pendingExtractRafRef.current === null) {
        pendingExtractRafRef.current = requestAnimationFrame(() => {
          window.setTimeout(runExtract, Math.max(0, 40 - elapsed));
        });
      }
    },
    [sourceImage]
  );

  const updateActivePinTarget = useCallback(
    (patch: Partial<NailUvPinTarget>) => {
      if (!fingerSpecs) return;
      const current = fingerSpecs[selectedFinger]?.uvExtractionTarget ?? DEFAULT_PIN_TARGET;
      const nextTarget: NailUvPinTarget = {
        ...current,
        ...patch,
        cxNorm: clamp(patch.cxNorm ?? current.cxNorm, 0.04, 0.96),
        cyNorm: clamp(patch.cyNorm ?? current.cyNorm, 0.04, 0.96),
        widthNorm: clamp(patch.widthNorm ?? current.widthNorm, 0.025, 0.45),
        heightNorm: clamp(patch.heightNorm ?? current.heightNorm, 0.035, 0.55),
      };

      setFingerSpecs((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [selectedFinger]: {
            ...prev[selectedFinger],
            uvExtractionTarget: nextTarget,
          },
        };
      });
      if (sourceImage) {
        drawLoupeCanvas(sourceImage, nextTarget);
      }
      scheduleUvReExtraction(selectedFinger, nextTarget);
    },
    [fingerSpecs, selectedFinger, sourceImage, drawLoupeCanvas, scheduleUvReExtraction]
  );

  const handleLoupePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceImage) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
    };
  };

  const handleLoupePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStateRef.current.active || !sourceImage) return;
    const dxScreen = e.clientX - dragStateRef.current.lastX;
    const dyScreen = e.clientY - dragStateRef.current.lastY;
    dragStateRef.current.lastX = e.clientX;
    dragStateRef.current.lastY = e.clientY;

    const srcW = sourceImage.naturalWidth || sourceImage.width;
    const srcH = sourceImage.naturalHeight || sourceImage.height;
    const baseScale = LOUPE_SIZE / Math.max(1, Math.min(srcW, srcH));
    const zoomScale = baseScale * LOUPE_ZOOM;

    // Dragging the image inside the loupe moves the extraction target in the opposite direction
    const rotToUp = -Math.PI / 2 - activeTarget.angleRad;
    const cosR = Math.cos(-rotToUp);
    const sinR = Math.sin(-rotToUp);
    const dImgX = (-dxScreen * cosR - -dyScreen * sinR) / zoomScale;
    const dImgY = (-dxScreen * sinR + -dyScreen * cosR) / zoomScale;

    updateActivePinTarget({
      cxNorm: activeTarget.cxNorm + dImgX / Math.max(1, srcW),
      cyNorm: activeTarget.cyNorm + dImgY / Math.max(1, srcH),
    });
  };

  const handleLoupePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current.pointerId === e.pointerId) {
      dragStateRef.current.active = false;
      dragStateRef.current.pointerId = -1;
    }
  };

  const handleSelectFinger = (fid: FingerId) => {
    setSelectedFinger(fid);
    const target = fingerSpecs?.[fid]?.uvExtractionTarget;
    if (target) {
      const diffRad = target.angleRad - baseAngleRef.current[fid];
      setAngleOffsetDeg(Math.round(clamp((diffRad * 180) / Math.PI, -30, 30)));
    } else {
      setAngleOffsetDeg(0);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setAnalyzing(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const [img, result] = await Promise.all([
        loadHtmlImage(dataUrl),
        analyzeReferencePhotoPerFinger(dataUrl),
      ]);

      setSourceImage(img);
      setAnalysis(result);
      setFingerSpecs(result.fingerSpecs);

      for (const id of ORDERED_FINGERS) {
        baseAngleRef.current[id] =
          result.fingerSpecs[id].uvExtractionTarget?.angleRad ?? -Math.PI / 2;
      }

      const preferred =
        result.detectedFingerIds.includes('middle')
          ? 'middle'
          : result.detectedFingerIds.includes('ring')
            ? 'ring'
            : result.detectedFingerIds[0] ?? 'middle';
      setSelectedFinger(preferred);
      setAngleOffsetDeg(0);

      if (!name.trim()) {
        const cleanFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(
          cleanFile.length > 2
            ? cleanFile.slice(0, 26)
            : `${SHAPE_LABELS[result.primaryShape]} UV 3D`
        );
      }
    } catch {
      setError('Não foi possível extrair a textura desta foto. Tente outra imagem nítida.');
    } finally {
      setAnalyzing(false);
      e.target.value = '';
    }
  };

  const applySelectedTextureToAll5 = () => {
    if (!fingerSpecs) return;
    const source = fingerSpecs[selectedFinger];
    const next = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const id of ORDERED_FINGERS) {
      next[id] = {
        ...fingerSpecs[id],
        shape: source.shape,
        baseColor: source.baseColor,
        secondaryColor: source.secondaryColor,
        accentColor: source.accentColor,
        pattern: source.pattern,
        trueUvDataUrl: source.trueUvDataUrl,
        uvExtractionTarget: source.uvExtractionTarget
          ? { ...source.uvExtractionTarget }
          : fingerSpecs[id].uvExtractionTarget,
      };
    }
    setFingerSpecs(next);
  };

  const adjustPincherSize = (factor: number) => {
    updateActivePinTarget({
      widthNorm: activeTarget.widthNorm * factor,
      heightNorm: activeTarget.heightNorm * factor,
    });
  };

  const handleAngleChange = (deg: number) => {
    setAngleOffsetDeg(deg);
    updateActivePinTarget({
      angleRad: baseAngleRef.current[selectedFinger] + (deg * Math.PI) / 180,
    });
  };

  const resetAndClose = () => {
    if (pendingExtractRafRef.current !== null) {
      cancelAnimationFrame(pendingExtractRafRef.current);
      pendingExtractRafRef.current = null;
    }
    setName('');
    setSourceImage(null);
    setAnalysis(null);
    setFingerSpecs(null);
    setSelectedFinger('ring');
    setAngleOffsetDeg(0);
    setAnalyzing(false);
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fingerSpecs || !activeSpec) {
      setError('Envie ou fotografe uma referência primeiro para extrair a textura UV.');
      return;
    }
    setSaving(true);
    try {
      const middleSpec = fingerSpecs.middle ?? activeSpec;
      const swatchDataUrl = generateNailSwatchDataUrl(activeSpec, 180, 260);
      const finalizedSpecs = {} as Record<FingerId, NailFingerDesignSpec>;
      for (const id of ORDERED_FINGERS) {
        finalizedSpecs[id] = {
          ...fingerSpecs[id],
          glossIntensity: 0.98,
        };
      }

      await onCreateDesign({
        name: name.trim() || `${PATTERN_LABELS_PT[middleSpec.pattern]} 3D`,
        category: isStudioMode ? 'Estudio' : 'Cliente',
        patternType: mapArtisticToDesignPattern(middleSpec.pattern),
        baseColor: middleSpec.baseColor,
        secondaryColor: middleSpec.secondaryColor,
        accentColor: middleSpec.accentColor,
        finish: middleSpec.pattern === 'chrome_mirror' ? 'chrome' : 'glossy',
        imageDataUrl: swatchDataUrl,
        isCustom: !isStudioMode,
        isStudioCatalog: isStudioMode,
        detectedShape: middleSpec.shape,
        detectedLength: middleSpec.relativeLength,
        fingerSpecs: finalizedSpecs,
      });
      resetAndClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="import-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-backdrop"
          onClick={resetAndClose}
        >
          <motion.div
            key="import-sheet"
            initial={{ opacity: 0, y: 36, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 28, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className="modal-sheet glass-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">
                  {isStudioMode
                    ? 'Catálogo do Estúdio • Transferência UV 512px'
                    : 'Referência da Cliente • Lupa UV Fotorrealista'}
                </span>
                <h2 id="import-title" className="modal-title">
                  {isStudioMode
                    ? 'Cadastrar Modelo no Catálogo'
                    : 'Extrair Textura Real da Unha'}
                </h2>
              </div>
              <button
                type="button"
                className="icon-mini-btn"
                onClick={resetAndClose}
                aria-label="Fechar importação"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              {/* Upload / Camera Buttons */}
              <div className="import-upload-buttons">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="upload-action-btn">
                    <Upload size={16} />
                    <span>{analyzing ? 'Extraindo UV...' : 'Foto da Galeria'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={analyzing}
                      onChange={handleFile}
                      className="sr-only"
                    />
                  </label>

                  <label className="upload-action-btn is-secondary">
                    <Camera size={16} />
                    <span>
                      {isStudioMode ? 'Fotografar Trabalho' : 'Fotografar Referência'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={analyzing}
                      onChange={handleFile}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              {analyzing && (
                <div className="extractor-status-note" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Loader2 size={15} className="spin-icon" />
                  <span>Detectando unhas e extraindo textura UV 512×512 em tempo real...</span>
                </div>
              )}

              {/* V12 4x Interactive UV Pincher Loupe + Real-Time Extracted Nail Preview */}
              {sourceImage && activeSpec && (
                <div className="v5-five-finger-section">
                  <div className="v5-section-head">
                    <span className="field-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Crosshair size={12} /> Lupa de Pinça UV 4× — Arraste para ajustar
                    </span>
                    <span className="v5-source-pill">
                      {FINGER_LABELS_PT[selectedFinger]} • 88% interno
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 118px',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        borderRadius: 16,
                        overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,0.22)',
                        background: '#141116',
                        aspectRatio: '1 / 1',
                        maxHeight: 210,
                        margin: '0 auto',
                        width: '100%',
                        maxWidth: 210,
                      }}
                    >
                      <canvas
                        ref={loupeCanvasRef}
                        onPointerDown={handleLoupePointerDown}
                        onPointerMove={handleLoupePointerMove}
                        onPointerUp={handleLoupePointerUp}
                        onPointerCancel={handleLoupePointerUp}
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'block',
                          touchAction: 'none',
                          userSelect: 'none',
                          cursor: 'grab',
                        }}
                      />
                    </div>

                    {/* Live Extracted Photorealistic Nail Preview */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          width: 108,
                          height: 156,
                          borderRadius: 16,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'radial-gradient(circle at 40% 30%, rgba(255,255,255,0.08), #131015)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          padding: 6,
                        }}
                      >
                        {activePreviewUrl ? (
                          <img
                            src={activePreviewUrl}
                            alt={`Textura UV ${FINGER_LABELS_PT[selectedFinger]}`}
                            draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          />
                        ) : (
                          <Sparkles size={18} />
                        )}
                      </div>
                      <span style={{ fontSize: '0.66rem', color: 'var(--glass-muted)', textAlign: 'center' }}>
                        Textura UV 3D Real
                      </span>
                    </div>
                  </div>

                  {/* Compact Pincher Size & Angle Controls */}
                  <div
                    className="extractor-refine-box"
                    style={{ gap: 8, padding: '9px 11px' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: '0.68rem', color: 'var(--glass-muted)', fontWeight: 600 }}>
                        Tamanho da Pinça
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="icon-mini-btn"
                          onClick={() => adjustPincherSize(0.9)}
                          aria-label="Diminuir área da pinça"
                          title="Diminuir pinça"
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-mini-btn"
                          onClick={() => adjustPincherSize(1.1)}
                          aria-label="Aumentar área da pinça"
                          title="Aumentar pinça"
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-mini-btn"
                          onClick={() => handleAngleChange(0)}
                          aria-label="Resetar ângulo"
                          title="Resetar ângulo"
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    </div>

                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: '0.68rem',
                        color: 'var(--glass-muted)',
                      }}
                    >
                      <span style={{ minWidth: 66 }}>Ângulo ({angleOffsetDeg}°)</span>
                      <input
                        type="range"
                        min={-30}
                        max={30}
                        step={1}
                        value={angleOffsetDeg}
                        onChange={(e) => handleAngleChange(Number(e.target.value))}
                        style={{ flex: 1 }}
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* 5-Finger Clickable Strip + Uniformize CTA */}
              {fingerSpecs && (
                <div
                  className="v5-five-finger-section"
                  role="group"
                  aria-label="Unhas extraídas"
                >
                  <div className="v5-section-head">
                    <span className="field-label">
                      {analysis?.detectedFingerIds.length
                        ? `${analysis.detectedFingerIds.length} dedo(s) detectados • Toque para pinçar`
                        : '5 Dedos • Toque para ajustar'}
                    </span>
                    <button
                      type="button"
                      className="text-link-btn"
                      onClick={applySelectedTextureToAll5}
                    >
                      Aplicar esta textura nos 5 dedos
                    </button>
                  </div>

                  <div className="v5-five-finger-grid">
                    {ORDERED_FINGERS.map((fid) => {
                      const spec = fingerSpecs[fid];
                      const isActive = fid === selectedFinger;
                      const thumbRadius = getSilhouetteBorderRadius(spec.shape);
                      const swatchSrc = fingerPreviews ? fingerPreviews[fid] : null;
                      return (
                        <button
                          key={fid}
                          type="button"
                          onClick={() => handleSelectFinger(fid)}
                          className={`v5-finger-card ${isActive ? 'is-active' : ''}`}
                        >
                          <div
                            className="v5-finger-thumb"
                            style={{
                              position: 'relative',
                              backgroundColor: spec.baseColor,
                              borderRadius: thumbRadius,
                              border: '1px solid rgba(255,255,255,0.22)',
                            }}
                          >
                            {swatchSrc && (
                              <img
                                src={swatchSrc}
                                alt={FINGER_LABELS_PT[fid]}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'contain',
                                  borderRadius: thumbRadius,
                                }}
                              />
                            )}
                          </div>
                          <span className="v5-finger-name">{FINGER_LABELS_PT[fid]}</span>
                          <span className="v5-finger-badge">
                            {spec.detectedFromPhoto ? 'UV Real' : 'Harmonia'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className="field-group">
                <span className="field-label">
                  {isStudioMode ? 'Nome do Modelo no Catálogo' : 'Nome do Set 3D'}
                </span>
                <input
                  type="text"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    isStudioMode
                      ? 'Ex: Cromado Ouro Champagne Studs'
                      : 'Ex: Referência Dourada Cromada'
                  }
                  className="glass-input"
                />
              </label>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={resetAndClose}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!fingerSpecs || analyzing || saving}
                >
                  <Check size={16} />
                  <span>
                    {saving
                      ? isStudioMode
                        ? 'Salvando no Catálogo...'
                        : 'Aplicando Set 3D...'
                      : isStudioMode
                        ? 'Cadastrar Modelo no Catálogo'
                        : 'Aplicar Set 3D na Mão'}
                  </span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
