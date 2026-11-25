import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Check,
  Loader2,
  Move,
  RotateCcw,
  Sparkles,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  DEFAULT_LOUPE_ADJUSTMENT,
  MAX_LOUPE_ZOOM,
  MIN_LOUPE_ZOOM,
  type LoupeAdjustment,
  type NailExtractionResult,
  analyzeReferencePhoto,
  renderLoupeNailTexture,
} from '../lib/nail3DReconstructor';
import type { NailDesign, NailShape } from '../types/nail';

const SHAPE_LABELS: Record<NailShape, string> = {
  natural: 'Natural',
  almond: 'Amendoada',
  square: 'Quadrada',
  coffin: 'Bailarina',
  stiletto: 'Stiletto',
};

interface ImportReferenceModalProps {
  open: boolean;
  onClose: () => void;
  onCreateDesign: (design: Omit<NailDesign, 'id' | 'createdAt'>) => Promise<void>;
}

export const ImportReferenceModal: React.FC<ImportReferenceModalProps> = ({
  open,
  onClose,
  onCreateDesign,
}) => {
  const [name, setName] = useState('');
  const [extraction, setExtraction] = useState<NailExtractionResult | null>(null);
  const [selectedNailIdx, setSelectedNailIdx] = useState(0);
  const [loupeAdjust, setLoupeAdjust] = useState<LoupeAdjustment>(DEFAULT_LOUPE_ADJUSTMENT);
  const [finish, setFinish] = useState<NailDesign['finish']>('glossy');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  }>({ active: false, startX: 0, startY: 0, origOffsetX: 0, origOffsetY: 0 });
  const pinchRef = useRef<{ dist: number; origZoom: number } | null>(null);

  const activeTarget = useMemo(() => {
    if (!extraction || extraction.detectedNails.length === 0) return null;
    return extraction.detectedNails[selectedNailIdx] ?? extraction.detectedNails[0];
  }, [extraction, selectedNailIdx]);

  const previewDataUrl = useMemo(() => {
    if (!extraction || !activeTarget) return null;
    return renderLoupeNailTexture(
      extraction.sourceImage,
      activeTarget.frame,
      loupeAdjust,
      260,
      390
    );
  }, [extraction, activeTarget, loupeAdjust]);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setAnalyzing(true);
    try {
      const result = await analyzeReferencePhoto(file);
      setExtraction(result);
      setSelectedNailIdx(result.initialIndex);
      setLoupeAdjust(DEFAULT_LOUPE_ADJUSTMENT);
      if (!name.trim()) {
        const cleanFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(cleanFile.slice(0, 26) || 'Referência da Cliente');
      }
    } catch {
      setError('Não foi possível analisar esta foto. Tente outra imagem da galeria.');
    } finally {
      setAnalyzing(false);
      e.target.value = '';
    }
  };

  const handleSelectFinger = (index: number) => {
    setSelectedNailIdx(index);
    setLoupeAdjust(DEFAULT_LOUPE_ADJUSTMENT);
  };

  const resetAndClose = () => {
    setName('');
    setExtraction(null);
    setSelectedNailIdx(0);
    setLoupeAdjust(DEFAULT_LOUPE_ADJUSTMENT);
    setError(null);
    onClose();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeTarget) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: loupeAdjust.offsetX,
      origOffsetY: loupeAdjust.offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || pinchRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setLoupeAdjust((prev) => ({
      ...prev,
      offsetX: Math.max(-2.2, Math.min(2.2, dragRef.current.origOffsetX + dx / 130)),
      offsetY: Math.max(-2.2, Math.min(2.2, dragRef.current.origOffsetY + dy / 190)),
    }));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchRef.current = { dist, origZoom: loupeAdjust.zoom };
      dragRef.current.active = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / Math.max(10, pinchRef.current.dist);
      const nextZoom = Math.max(
        MIN_LOUPE_ZOOM,
        Math.min(MAX_LOUPE_ZOOM, pinchRef.current.origZoom * ratio)
      );
      setLoupeAdjust((prev) => ({ ...prev, zoom: Number(nextZoom.toFixed(2)) }));
    }
  };

  const handleTouchEnd = () => {
    pinchRef.current = null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extraction || !activeTarget) {
      setError('Selecione ou fotografe uma referência da cliente primeiro.');
      return;
    }
    setSaving(true);
    try {
      const finalTexture = renderLoupeNailTexture(
        extraction.sourceImage,
        activeTarget.frame,
        loupeAdjust,
        320,
        480
      );
      await onCreateDesign({
        name: name.trim() || 'Referência da Cliente',
        category: 'Cliente',
        patternType: 'solid',
        baseColor: activeTarget.dominantColor || '#D4A383',
        secondaryColor: '#FFFFFF',
        accentColor: '#F3D5C0',
        finish,
        imageDataUrl: finalTexture,
        isCustom: true,
        detectedShape: activeTarget.detectedShape,
        detectedLength: activeTarget.detectedLength,
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
                <span className="modal-eyebrow">Nail Loupe Extractor • Zoom 4.5x</span>
                <h2 id="import-title" className="modal-title">
                  Importar Referência
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
              <div className="import-preview-stage">
                <div
                  className={`nail-crop-preview is-loupe is-interactive ${activeTarget ? 'has-texture' : ''}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  title={
                    activeTarget
                      ? 'Arraste ou faça pinça (2x–8x) para isolar exatamente a arte da unha'
                      : undefined
                  }
                >
                  {analyzing ? (
                    <div className="nail-crop-placeholder">
                      <Loader2 size={22} className="spin-icon" />
                      <span>Focando unha...</span>
                    </div>
                  ) : previewDataUrl ? (
                    <img src={previewDataUrl} alt="Lupa da placa da unha" draggable={false} />
                  ) : (
                    <div className="nail-crop-placeholder">
                      <Sparkles size={22} />
                      <span>Lupa da Unha</span>
                    </div>
                  )}
                  <div className="nail-crop-gloss" aria-hidden="true" />
                  {activeTarget && (
                    <>
                      <div className="loupe-zoom-pill" aria-hidden="true">
                        <ZoomIn size={10} />
                        <span>{loupeAdjust.zoom.toFixed(1)}x</span>
                      </div>
                      <div className="nail-crop-drag-badge" aria-hidden="true">
                        <Move size={11} />
                      </div>
                    </>
                  )}
                </div>

                <div className="import-upload-buttons">
                  <label className="upload-action-btn">
                    <Upload size={16} />
                    <span>{analyzing ? 'Detectando unhas...' : 'Foto da Galeria'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFile}
                      className="sr-only"
                    />
                  </label>

                  <label className="upload-action-btn is-secondary">
                    <Camera size={16} />
                    <span>Fotografar Referência</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleFile}
                      className="sr-only"
                    />
                  </label>

                  {extraction && activeTarget && (
                    <div className="extractor-status-note">
                      {extraction.method === 'mediapipe'
                        ? `Lupa 3D focada em ${activeTarget.fingerName} (${loupeAdjust.zoom.toFixed(1)}x) • Formato detectado: ${SHAPE_LABELS[activeTarget.detectedShape]} (${activeTarget.detectedLength.toFixed(2)}x).`
                        : `Close focado (${loupeAdjust.zoom.toFixed(1)}x). Arraste ou dê zoom dentro da unha.`}
                    </div>
                  )}
                </div>
              </div>

              {/* 1-Tap Quick Finger Extraction Switcher (Unha 1, Unha 2, Unha 3...) */}
              {extraction && extraction.detectedNails.length > 1 && (
                <div className="finger-extract-strip" role="group" aria-label="Unhas detectadas na foto">
                  <span className="field-label">Extração Rápida por Dedo (1 toque)</span>
                  <div className="finger-extract-row">
                    {extraction.detectedNails.map((target, idx) => {
                      const isActive = idx === selectedNailIdx;
                      return (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => handleSelectFinger(idx)}
                          className={`finger-extract-btn ${isActive ? 'is-active' : ''}`}
                        >
                          <img src={target.thumbDataUrl} alt={target.shortLabel} />
                          <span>{target.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTarget && (
                <div className="extractor-refine-box">
                  <div className="extractor-refine-head">
                    <span>Lupa de Precisão (2x – 8x)</span>
                    <button
                      type="button"
                      className="icon-text-btn"
                      onClick={() => setLoupeAdjust(DEFAULT_LOUPE_ADJUSTMENT)}
                    >
                      <RotateCcw size={12} />
                      <span>Resetar 4.5x</span>
                    </button>
                  </div>
                  <div className="extractor-refine-sliders">
                    <label className="slider-row">
                      <div className="slider-meta">
                        <span>Zoom Lupa</span>
                        <span className="slider-val">{loupeAdjust.zoom.toFixed(1)}x</span>
                      </div>
                      <input
                        type="range"
                        min={MIN_LOUPE_ZOOM}
                        max={MAX_LOUPE_ZOOM}
                        step={0.1}
                        value={loupeAdjust.zoom}
                        onChange={(e) =>
                          setLoupeAdjust((prev) => ({
                            ...prev,
                            zoom: parseFloat(e.target.value),
                          }))
                        }
                        className="luxury-range"
                      />
                    </label>
                    <label className="slider-row">
                      <div className="slider-meta">
                        <span>Ângulo</span>
                        <span className="slider-val">
                          {loupeAdjust.rotationDeg > 0
                            ? `+${loupeAdjust.rotationDeg}°`
                            : `${loupeAdjust.rotationDeg}°`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-45}
                        max={45}
                        step={1}
                        value={loupeAdjust.rotationDeg}
                        onChange={(e) =>
                          setLoupeAdjust((prev) => ({
                            ...prev,
                            rotationDeg: parseInt(e.target.value, 10),
                          }))
                        }
                        className="luxury-range"
                      />
                    </label>
                  </div>
                </div>
              )}

              <label className="field-group">
                <span className="field-label">Nome da Referência</span>
                <input
                  type="text"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Vermelha com Fio Dourado 3D"
                  className="glass-input"
                />
              </label>

              <div className="field-group">
                <span className="field-label">Acabamento 3D no Shader WebGL</span>
                <div className="shape-selector">
                  {(
                    [
                      { id: 'glossy', label: 'Gel Brilho' },
                      { id: 'chrome', label: 'Metálico / Cromado' },
                      { id: 'velvet', label: 'Veludo Fosco' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFinish(item.id)}
                      className={`shape-chip ${finish === item.id ? 'is-active' : ''}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="form-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={resetAndClose}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!activeTarget || analyzing || saving}
                >
                  <Check size={16} />
                  <span>{saving ? 'Aplicando em 3D...' : 'Aplicar na Mão 3D'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
