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
} from 'lucide-react';
import {
  type CropAdjustment,
  type NailExtractionResult,
  analyzeReferencePhoto,
  renderExtractedNailTexture,
} from '../lib/nailExtractor';
import type { NailDesign } from '../types/nail';

interface ImportReferenceModalProps {
  open: boolean;
  onClose: () => void;
  onCreateDesign: (design: Omit<NailDesign, 'id' | 'createdAt'>) => Promise<void>;
}

const DEFAULT_CROP: CropAdjustment = {
  offsetX: 0,
  offsetY: 0,
  zoom: 1,
  rotationDeg: 0,
};

export const ImportReferenceModal: React.FC<ImportReferenceModalProps> = ({
  open,
  onClose,
  onCreateDesign,
}) => {
  const [name, setName] = useState('');
  const [extraction, setExtraction] = useState<NailExtractionResult | null>(null);
  const [cropAdjust, setCropAdjust] = useState<CropAdjustment>(DEFAULT_CROP);
  const [finish, setFinish] = useState<NailDesign['finish']>('glossy');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Interactive pointer / pinch framing refs
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  }>({ active: false, startX: 0, startY: 0, origOffsetX: 0, origOffsetY: 0 });
  const pinchRef = useRef<{ dist: number; origZoom: number } | null>(null);

  const previewDataUrl = useMemo(() => {
    if (!extraction) return null;
    return renderExtractedNailTexture(
      extraction.sourceImage,
      extraction.initialFrame,
      cropAdjust,
      240,
      360
    );
  }, [extraction, cropAdjust]);

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
      setCropAdjust(DEFAULT_CROP);
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

  const resetAndClose = () => {
    setName('');
    setExtraction(null);
    setCropAdjust(DEFAULT_CROP);
    setError(null);
    onClose();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!extraction) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origOffsetX: cropAdjust.offsetX,
      origOffsetY: cropAdjust.offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || pinchRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setCropAdjust((prev) => ({
      ...prev,
      offsetX: Math.max(-0.9, Math.min(0.9, dragRef.current.origOffsetX + dx / 130)),
      offsetY: Math.max(-0.9, Math.min(0.9, dragRef.current.origOffsetY + dy / 180)),
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
      pinchRef.current = { dist, origZoom: cropAdjust.zoom };
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
      const nextZoom = Math.max(0.65, Math.min(2.6, pinchRef.current.origZoom * ratio));
      setCropAdjust((prev) => ({ ...prev, zoom: Number(nextZoom.toFixed(2)) }));
    }
  };

  const handleTouchEnd = () => {
    pinchRef.current = null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extraction) {
      setError('Selecione ou fotografe uma referência da cliente primeiro.');
      return;
    }
    setSaving(true);
    try {
      const finalTexture = renderExtractedNailTexture(
        extraction.sourceImage,
        extraction.initialFrame,
        cropAdjust,
        300,
        450
      );
      await onCreateDesign({
        name: name.trim() || 'Referência da Cliente',
        category: 'Cliente',
        patternType: 'solid',
        baseColor: extraction.dominantColor || '#D4A383',
        secondaryColor: '#FFFFFF',
        accentColor: '#F3D5C0',
        finish,
        imageDataUrl: finalTexture,
        isCustom: true,
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
                <span className="modal-eyebrow">Extrator Inteligente de Textura</span>
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
                  className={`nail-crop-preview is-interactive ${extraction ? 'has-texture' : ''}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  title={extraction ? 'Arraste ou faça pinça para ajustar o recorte' : undefined}
                >
                  {analyzing ? (
                    <div className="nail-crop-placeholder">
                      <Loader2 size={22} className="spin-icon" />
                      <span>Extraindo unha...</span>
                    </div>
                  ) : previewDataUrl ? (
                    <img src={previewDataUrl} alt="Textura extraída da unha" draggable={false} />
                  ) : (
                    <div className="nail-crop-placeholder">
                      <Sparkles size={22} />
                      <span>Amostra da Unha</span>
                    </div>
                  )}
                  <div className="nail-crop-gloss" aria-hidden="true" />
                  {extraction && (
                    <div className="nail-crop-drag-badge" aria-hidden="true">
                      <Move size={11} />
                    </div>
                  )}
                </div>

                <div className="import-upload-buttons">
                  <label className="upload-action-btn">
                    <Upload size={16} />
                    <span>{analyzing ? 'Analisando mão...' : 'Foto da Galeria'}</span>
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

                  {extraction && (
                    <div className="extractor-status-note">
                      {extraction.method === 'mediapipe'
                        ? `Unha isolada via IA (${extraction.detectedFingerLabel}). Arraste para refinar.`
                        : 'Close detectado • Arraste ou dê zoom na textura da unha.'}
                    </div>
                  )}
                </div>
              </div>

              {extraction && (
                <div className="extractor-refine-box">
                  <div className="extractor-refine-head">
                    <span>Ajuste Fino do Recorte</span>
                    <button
                      type="button"
                      className="icon-text-btn"
                      onClick={() => setCropAdjust(DEFAULT_CROP)}
                    >
                      <RotateCcw size={12} />
                      <span>Recentralizar</span>
                    </button>
                  </div>
                  <div className="extractor-refine-sliders">
                    <label className="slider-row">
                      <div className="slider-meta">
                        <span>Zoom na Arte</span>
                        <span className="slider-val">{cropAdjust.zoom.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range"
                        min={0.65}
                        max={2.6}
                        step={0.05}
                        value={cropAdjust.zoom}
                        onChange={(e) =>
                          setCropAdjust((prev) => ({
                            ...prev,
                            zoom: parseFloat(e.target.value),
                          }))
                        }
                        className="luxury-range"
                      />
                    </label>
                    <label className="slider-row">
                      <div className="slider-meta">
                        <span>Alinhamento</span>
                        <span className="slider-val">
                          {cropAdjust.rotationDeg > 0
                            ? `+${cropAdjust.rotationDeg}°`
                            : `${cropAdjust.rotationDeg}°`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-45}
                        max={45}
                        step={1}
                        value={cropAdjust.rotationDeg}
                        onChange={(e) =>
                          setCropAdjust((prev) => ({
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
                  placeholder="Ex: Pinterest Pérola Dourada"
                  className="glass-input"
                />
              </label>

              <div className="field-group">
                <span className="field-label">Brilho do Topcoat Gel</span>
                <div className="shape-selector">
                  {(
                    [
                      { id: 'glossy', label: 'Gel Brilho' },
                      { id: 'chrome', label: 'Cromado' },
                      { id: 'velvet', label: 'Veludo' },
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
                  disabled={!extraction || analyzing || saving}
                >
                  <Check size={16} />
                  <span>{saving ? 'Aplicando...' : 'Aplicar na Mão'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
