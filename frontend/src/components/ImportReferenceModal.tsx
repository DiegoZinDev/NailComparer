import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Check,
  Loader2,
  Palette,
  Sparkles,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import {
  FINGER_LABELS_PT,
  ORDERED_FINGERS,
  PATTERN_LABELS_PT,
  type PerFingerAnalysisResult,
  analyzeReferencePerFinger,
} from '../lib/perFingerVisionAnalyzer';
import { renderProceduralNailSwatchDataUrl } from '../lib/proceduralPBRSynthesizer';
import type {
  ArtisticPattern,
  FingerId,
  NailDesign,
  NailFingerDesignSpec,
  NailPatternType,
  NailShape,
} from '../types/nail';

const SHAPE_LABELS: Record<NailShape, string> = {
  natural: 'Natural',
  almond: 'Amendoada',
  square: 'Quadrada',
  coffin: 'Bailarina',
  stiletto: 'Stiletto',
};

const PATTERN_OPTIONS: Array<{ id: ArtisticPattern; label: string }> = [
  { id: 'solid_gloss', label: 'Gel Brilho' },
  { id: 'french_tip', label: 'Francesinha' },
  { id: 'aura_gradient', label: 'Aura Blush' },
  { id: 'gold_3d_waves', label: 'Ondas 3D Ouro' },
  { id: 'chrome_mirror', label: 'Cromado' },
  { id: 'floral_accent', label: 'Floral 3D' },
];

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
  const [analysis, setAnalysis] = useState<PerFingerAnalysisResult | null>(null);
  const [fingerSpecs, setFingerSpecs] = useState<Record<FingerId, NailFingerDesignSpec> | null>(
    null
  );
  const [selectedFinger, setSelectedFinger] = useState<FingerId>('ring');
  const [finish, setFinish] = useState<NailDesign['finish']>('glossy');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  const fingerPreviews = useMemo(() => {
    if (!fingerSpecs) return null;
    const previews = {} as Record<FingerId, string>;
    for (const id of ORDERED_FINGERS) {
      previews[id] = renderProceduralNailSwatchDataUrl(fingerSpecs[id], 180, 260);
    }
    return previews;
  }, [fingerSpecs]);

  const activeSpec = fingerSpecs ? fingerSpecs[selectedFinger] : null;
  const activePreviewUrl = fingerPreviews ? fingerPreviews[selectedFinger] : null;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setAnalyzing(true);
    try {
      const result = await analyzeReferencePerFinger(file);
      setAnalysis(result);
      setFingerSpecs(result.fingerSpecs);

      // Focus initial inspection on the richest accent finger (usually ring or middle)
      const richFinger =
        ORDERED_FINGERS.find(
          (id) =>
            result.fingerSpecs[id].pattern === 'gold_3d_waves' ||
            result.fingerSpecs[id].pattern === 'floral_accent'
        ) ??
        result.detectedFingerIds[0] ??
        'middle';
      setSelectedFinger(richFinger);

      if (result.primaryPattern === 'chrome_mirror') {
        setFinish('chrome');
      } else if (result.primaryPattern === 'gold_3d_waves') {
        setFinish('glitter');
      } else {
        setFinish('glossy');
      }

      if (!name.trim()) {
        const cleanFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(
          cleanFile.length > 2
            ? cleanFile.slice(0, 26)
            : `${PATTERN_LABELS_PT[result.primaryPattern]} 3D`
        );
      }
    } catch {
      setError('Não foi possível reconstruir esta referência. Tente outra foto.');
    } finally {
      setAnalyzing(false);
      e.target.value = '';
    }
  };

  const updateSelectedFinger = (patch: Partial<NailFingerDesignSpec>) => {
    setFingerSpecs((prev) => {
      if (!prev) return prev;
      const current = prev[selectedFinger];
      const nextPattern = patch.pattern ?? current.pattern;
      const updatedAnchors =
        patch.pattern &&
        (patch.pattern === 'gold_3d_waves' || patch.pattern === 'floral_accent') &&
        current.strokeAnchors.length === 0
          ? [
              { u: 0.34, v: 0.36, radius: 0.16, angle: 0.35 },
              { u: 0.62, v: 0.58, radius: 0.18, angle: -0.3 },
              { u: 0.48, v: 0.78, radius: 0.14, angle: 0.2 },
            ]
          : current.strokeAnchors;

      return {
        ...prev,
        [selectedFinger]: {
          ...current,
          ...patch,
          strokeAnchors: updatedAnchors,
          metallicIntensity:
            nextPattern === 'chrome_mirror'
              ? 0.92
              : nextPattern === 'gold_3d_waves'
                ? 0.88
                : nextPattern === 'floral_accent'
                  ? 0.45
                  : 0.1,
        },
      };
    });
  };

  const applySelectedToAllFingers = () => {
    setFingerSpecs((prev) => {
      if (!prev) return prev;
      const source = prev[selectedFinger];
      const next = {} as Record<FingerId, NailFingerDesignSpec>;
      for (const id of ORDERED_FINGERS) {
        next[id] = {
          ...prev[id],
          pattern: source.pattern,
          baseColor: source.baseColor,
          secondaryColor: source.secondaryColor,
          accentColor: source.accentColor,
          shape: source.shape,
          strokeAnchors: source.strokeAnchors,
          metallicIntensity: source.metallicIntensity,
        };
      }
      return next;
    });
  };

  const resetAndClose = () => {
    setName('');
    setAnalysis(null);
    setFingerSpecs(null);
    setSelectedFinger('ring');
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fingerSpecs || !activeSpec) {
      setError('Envie ou fotografe uma referência primeiro para reconstruir os 5 dedos.');
      return;
    }
    setSaving(true);
    try {
      const middleSpec = fingerSpecs.middle ?? activeSpec;
      const swatchDataUrl = renderProceduralNailSwatchDataUrl(activeSpec, 180, 260);
      const gloss = finish === 'velvet' ? 0.56 : 0.96;

      const finalizedSpecs = {} as Record<FingerId, NailFingerDesignSpec>;
      for (const id of ORDERED_FINGERS) {
        finalizedSpecs[id] = {
          ...fingerSpecs[id],
          glossIntensity: gloss,
        };
      }

      await onCreateDesign({
        name: name.trim() || `${PATTERN_LABELS_PT[middleSpec.pattern]} 3D`,
        category: 'Cliente',
        patternType: mapArtisticToDesignPattern(middleSpec.pattern),
        baseColor: middleSpec.baseColor,
        secondaryColor: middleSpec.secondaryColor,
        accentColor: middleSpec.accentColor,
        finish,
        // Clean vector swatch preview only (NEVER raw cropped photo bitmap!)
        imageDataUrl: swatchDataUrl,
        isCustom: true,
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
                <span className="modal-eyebrow">Procedural 3D Vision • 1024×1024 PBR</span>
                <h2 id="import-title" className="modal-title">
                  Reconstruir Referência 3D
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
                <div className={`nail-crop-preview is-loupe ${activePreviewUrl ? 'has-texture' : ''}`}>
                  {analyzing ? (
                    <div className="nail-crop-placeholder">
                      <Loader2 size={22} className="spin-icon" />
                      <span>Reconstruindo 5 dedos...</span>
                    </div>
                  ) : activePreviewUrl ? (
                    <img
                      src={activePreviewUrl}
                      alt={`Prévia procedural ${FINGER_LABELS_PT[selectedFinger]}`}
                      draggable={false}
                    />
                  ) : (
                    <div className="nail-crop-placeholder">
                      <Sparkles size={22} />
                      <span>Vetor 3D Limpo</span>
                    </div>
                  )}
                  <div className="nail-crop-gloss" aria-hidden="true" />
                  {activeSpec && (
                    <div className="loupe-zoom-pill" aria-hidden="true">
                      <Wand2 size={10} />
                      <span>{PATTERN_LABELS_PT[activeSpec.pattern]}</span>
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

                  {analysis && activeSpec && (
                    <div className="extractor-status-note">
                      {analysis.method === 'mediapipe'
                        ? `${analysis.detectedFingerIds.length} dedos detectados na foto • ${SHAPE_LABELS[activeSpec.shape]} (${activeSpec.relativeLength.toFixed(2)}x) • Arte vetorial 1024px pronta.`
                        : `Close-up macro reconstruído com harmonia nos 5 dedos • ${SHAPE_LABELS[activeSpec.shape]}.`}
                    </div>
                  )}
                </div>
              </div>

              {/* 5-Finger Procedural Reconstruction Preview Strip */}
              {fingerSpecs && fingerPreviews && (
                <div className="v5-five-finger-section" role="group" aria-label="Reconstrução dos 5 dedos">
                  <div className="v5-section-head">
                    <span className="field-label">Reconstrução 5 Dedos (toque para editar)</span>
                    <button
                      type="button"
                      className="text-link-btn"
                      onClick={applySelectedToAllFingers}
                    >
                      Uniformizar nos 5
                    </button>
                  </div>

                  <div className="v5-five-finger-grid">
                    {ORDERED_FINGERS.map((fid) => {
                      const spec = fingerSpecs[fid];
                      const isActive = fid === selectedFinger;
                      return (
                        <button
                          key={fid}
                          type="button"
                          onClick={() => setSelectedFinger(fid)}
                          className={`v5-finger-card ${isActive ? 'is-active' : ''}`}
                        >
                          <div className="v5-finger-thumb">
                            <img src={fingerPreviews[fid]} alt={FINGER_LABELS_PT[fid]} />
                          </div>
                          <span className="v5-finger-name">{FINGER_LABELS_PT[fid]}</span>
                          <span className="v5-finger-badge">{PATTERN_LABELS_PT[spec.pattern]}</span>
                          <div className="v5-palette-dots" aria-hidden="true">
                            <span style={{ background: spec.baseColor }} />
                            <span style={{ background: spec.secondaryColor }} />
                            <span style={{ background: spec.accentColor }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Per-Finger Quick Customizer */}
              {activeSpec && (
                <div className="extractor-refine-box">
                  <div className="extractor-refine-head">
                    <span>
                      <Palette size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                      {FINGER_LABELS_PT[selectedFinger]} • {SHAPE_LABELS[activeSpec.shape]} ({activeSpec.relativeLength.toFixed(2)}x)
                    </span>
                    <span className="v5-source-pill">
                      {activeSpec.detectedFromPhoto ? 'Extraído da Foto' : 'Harmonia Automática'}
                    </span>
                  </div>

                  <div className="shape-selector">
                    {PATTERN_OPTIONS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => updateSelectedFinger({ pattern: p.id })}
                        className={`shape-chip ${activeSpec.pattern === p.id ? 'is-active' : ''}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="v5-color-trio">
                    <label className="v5-color-swatch-edit">
                      <input
                        type="color"
                        value={activeSpec.baseColor}
                        onChange={(e) => updateSelectedFinger({ baseColor: e.target.value })}
                      />
                      <span>Base</span>
                    </label>
                    <label className="v5-color-swatch-edit">
                      <input
                        type="color"
                        value={activeSpec.secondaryColor}
                        onChange={(e) => updateSelectedFinger({ secondaryColor: e.target.value })}
                      />
                      <span>Aura / Ponta</span>
                    </label>
                    <label className="v5-color-swatch-edit">
                      <input
                        type="color"
                        value={activeSpec.accentColor}
                        onChange={(e) => updateSelectedFinger({ accentColor: e.target.value })}
                      />
                      <span>Ouro / 3D</span>
                    </label>
                  </div>
                </div>
              )}

              <label className="field-group">
                <span className="field-label">Nome do Set 3D</span>
                <input
                  type="text"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Aura Blush com Ondas Ouro 3D"
                  className="glass-input"
                />
              </label>

              <div className="field-group">
                <span className="field-label">Acabamento PBR WebGL</span>
                <div className="shape-selector">
                  {(
                    [
                      { id: 'glossy', label: 'Gel Brilho' },
                      { id: 'chrome', label: 'Cromado Espelho' },
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
                  disabled={!fingerSpecs || analyzing || saving}
                >
                  <Check size={16} />
                  <span>{saving ? 'Aplicando Set 3D...' : 'Aplicar Set 3D na Mão'}</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
