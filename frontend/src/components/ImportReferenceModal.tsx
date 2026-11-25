import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Check,
  ExternalLink,
  Loader2,
  Palette,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  type DeepReconstructionProgress,
  type DeepReconstructionResult,
  runDeepPerFingerReconstruction,
} from '../lib/deepNailReconstructor';
import {
  FINGER_LABELS_PT,
  ORDERED_FINGERS,
  PATTERN_LABELS_PT,
} from '../lib/perFingerVisionAnalyzer';
import { generateNailSwatchDataUrl } from '../lib/swatchPreview';
import type {
  ArtisticPattern,
  FingerId,
  Nail3DFinishType,
  NailDesign,
  NailFingerDesignSpec,
  NailHandSpecsBySide,
  NailPatternType,
  NailShape,
} from '../types/nail';

const SHAPE_LABELS: Record<NailShape, string> = {
  natural: 'Natural',
  oval: 'Oval',
  almond: 'Amendoada',
  square: 'Quadrada',
  coffin: 'Bailarina',
  stiletto: 'Stiletto',
};

const FINISH_LABELS: Record<Nail3DFinishType, string> = {
  mirror_chrome: 'Cromado Espelho',
  glazed_pearl: 'Perolado Glaze',
  solid_gloss_gel: 'Gel Brilho',
  jelly_translucent: 'Jelly Translúcido',
  cat_eye_magnetic: 'Cat-Eye Magnético',
  velvet_matte: 'Veludo Fosco',
  glitter_suspension: 'Glitter Gel',
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

function stripTransientZoom(
  specs: Record<FingerId, NailFingerDesignSpec>,
  gloss: number
): Record<FingerId, NailFingerDesignSpec> {
  const out = {} as Record<FingerId, NailFingerDesignSpec>;
  for (const id of ORDERED_FINGERS) {
    const clean: NailFingerDesignSpec = {
      ...specs[id],
      glossIntensity: gloss,
    };
    delete clean.referenceZoomDataUrl;
    out[id] = clean;
  }
  return out;
}

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
  onOpenSettings,
}) => {
  const [name, setName] = useState('');
  const [result, setResult] = useState<DeepReconstructionResult | null>(null);
  const [fingerSpecs, setFingerSpecs] = useState<Record<FingerId, NailFingerDesignSpec> | null>(
    null
  );
  const [handSpecsBySide, setHandSpecsBySide] = useState<NailHandSpecsBySide | undefined>(
    undefined
  );
  const [activeHandSide, setActiveHandSide] = useState<'Right' | 'Left'>('Right');
  const [selectedFinger, setSelectedFinger] = useState<FingerId>('ring');
  const [finish, setFinish] = useState<NailDesign['finish']>('glossy');
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<DeepReconstructionProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isStudioMode = targetMode === 'studio';

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setError(null);
      setProgress(null);
      setAnalyzing(false);
    }
  }, [open]);

  const currentHandSpecs = useMemo(() => {
    if (handSpecsBySide?.[activeHandSide]) {
      return handSpecsBySide[activeHandSide]!;
    }
    return fingerSpecs;
  }, [handSpecsBySide, activeHandSide, fingerSpecs]);

  const fingerPreviews = useMemo(() => {
    if (!currentHandSpecs) return null;
    const previews = {} as Record<FingerId, string>;
    for (const id of ORDERED_FINGERS) {
      const spec = currentHandSpecs[id];
      previews[id] = spec.preview3DDataUrl || generateNailSwatchDataUrl(spec, 180, 260);
    }
    return previews;
  }, [currentHandSpecs]);

  const activeSpec = currentHandSpecs ? currentHandSpecs[selectedFinger] : null;
  const activePreviewUrl = fingerPreviews ? fingerPreviews[selectedFinger] : null;

  const handleCancelAnalysis = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setAnalyzing(false);
    setProgress(null);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setAnalyzing(true);
    setProgress({
      stage: 'detecting_hands',
      message: 'Preparando foto de referência em alta resolução...',
      currentFingerIndex: 0,
      totalFingers: 5,
      percent: 4,
    });

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const deepResult = await runDeepPerFingerReconstruction(dataUrl, {
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      setResult(deepResult);
      setFingerSpecs(deepResult.fingerSpecs);
      setHandSpecsBySide(deepResult.handSpecsBySide);
      setActiveHandSide(deepResult.handSpecsBySide?.Right ? 'Right' : 'Left');

      const richFinger =
        ORDERED_FINGERS.find(
          (id) =>
            (deepResult.fingerSpecs[id].manufacturingSpec?.accessories3D.length ?? 0) > 0 ||
            deepResult.fingerSpecs[id].pattern === 'gold_3d_waves' ||
            deepResult.fingerSpecs[id].pattern === 'floral_accent' ||
            deepResult.fingerSpecs[id].pattern === 'chrome_mirror'
        ) ?? 'ring';
      setSelectedFinger(richFinger);

      const mFinish = deepResult.fingerSpecs[richFinger].manufacturingSpec?.finishType;
      if (mFinish === 'mirror_chrome' || mFinish === 'glazed_pearl') {
        setFinish('chrome');
      } else if (mFinish === 'velvet_matte') {
        setFinish('velvet');
      } else if (mFinish === 'glitter_suspension') {
        setFinish('glitter');
      } else {
        setFinish('glossy');
      }

      if (!name.trim()) {
        const cleanFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(
          cleanFile.length > 2
            ? cleanFile.slice(0, 26)
            : `${SHAPE_LABELS[deepResult.primaryShape]} 3D`
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Análise cancelada.');
      } else {
        setError('Não foi possível reconstruir esta referência. Tente outra foto.');
      }
    } finally {
      abortControllerRef.current = null;
      setAnalyzing(false);
      e.target.value = '';
    }
  };

  const updateSelectedFinger = (patch: Partial<NailFingerDesignSpec>) => {
    const applyPatch = (
      prev: Record<FingerId, NailFingerDesignSpec>
    ): Record<FingerId, NailFingerDesignSpec> => {
      const current = prev[selectedFinger];
      const nextPattern = patch.pattern ?? current.pattern;
      const updatedMSpec = current.manufacturingSpec
        ? {
            ...current.manufacturingSpec,
            trueBaseColorHex: patch.baseColor ?? current.manufacturingSpec.trueBaseColorHex,
            secondaryColorHex: patch.secondaryColor ?? current.manufacturingSpec.secondaryColorHex,
          }
        : undefined;

      return {
        ...prev,
        [selectedFinger]: {
          ...current,
          ...patch,
          manufacturingSpec: updatedMSpec,
          // Clear cached 3D snapshot only if user manually overrides color/pattern
          preview3DDataUrl:
            patch.baseColor || patch.secondaryColor || patch.accentColor || patch.pattern
              ? undefined
              : current.preview3DDataUrl,
          metallicIntensity:
            nextPattern === 'chrome_mirror'
              ? 0.96
              : nextPattern === 'gold_3d_waves'
                ? 0.88
                : nextPattern === 'floral_accent'
                  ? 0.45
                  : current.metallicIntensity,
        },
      };
    };

    if (handSpecsBySide?.[activeHandSide]) {
      setHandSpecsBySide((prev) =>
        prev && prev[activeHandSide]
          ? { ...prev, [activeHandSide]: applyPatch(prev[activeHandSide]!) }
          : prev
      );
    }
    setFingerSpecs((prev) => (prev ? applyPatch(prev) : prev));
  };

  const applySelectedToAllFingers = () => {
    if (!currentHandSpecs) return;
    const source = currentHandSpecs[selectedFinger];
    const applyAll = (
      prev: Record<FingerId, NailFingerDesignSpec>
    ): Record<FingerId, NailFingerDesignSpec> => {
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
          preview3DDataUrl: source.preview3DDataUrl,
          manufacturingSpec: source.manufacturingSpec
            ? { ...source.manufacturingSpec, fingerId: id, handSide: prev[id].handSide }
            : prev[id].manufacturingSpec,
        };
      }
      return next;
    };

    if (handSpecsBySide?.[activeHandSide]) {
      setHandSpecsBySide((prev) =>
        prev && prev[activeHandSide]
          ? { ...prev, [activeHandSide]: applyAll(prev[activeHandSide]!) }
          : prev
      );
    }
    setFingerSpecs((prev) => (prev ? applyAll(prev) : prev));
  };

  const resetAndClose = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setName('');
    setResult(null);
    setFingerSpecs(null);
    setHandSpecsBySide(undefined);
    setSelectedFinger('ring');
    setProgress(null);
    setAnalyzing(false);
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fingerSpecs || !activeSpec) {
      setError('Envie ou fotografe uma referência primeiro para reconstruir em 3D.');
      return;
    }
    setSaving(true);
    try {
      const middleSpec = fingerSpecs.middle ?? activeSpec;
      const gloss = finish === 'velvet' ? 0.56 : 0.96;
      const finalizedSpecs = stripTransientZoom(fingerSpecs, gloss);
      const finalizedBySide: NailHandSpecsBySide | undefined = handSpecsBySide
        ? {
            Left: handSpecsBySide.Left
              ? stripTransientZoom(handSpecsBySide.Left, gloss)
              : undefined,
            Right: handSpecsBySide.Right
              ? stripTransientZoom(handSpecsBySide.Right, gloss)
              : undefined,
          }
        : undefined;

      const swatchDataUrl =
        activeSpec.preview3DDataUrl || generateNailSwatchDataUrl(activeSpec, 180, 260);

      await onCreateDesign({
        name: name.trim() || `${PATTERN_LABELS_PT[middleSpec.pattern]} 3D`,
        category: isStudioMode ? 'Estudio' : 'Cliente',
        patternType: mapArtisticToDesignPattern(middleSpec.pattern),
        baseColor: middleSpec.baseColor,
        secondaryColor: middleSpec.secondaryColor,
        accentColor: middleSpec.accentColor,
        finish,
        imageDataUrl: swatchDataUrl,
        isCustom: !isStudioMode,
        isStudioCatalog: isStudioMode,
        detectedShape: middleSpec.shape,
        detectedLength: middleSpec.relativeLength,
        fidelityScore: result?.averageFidelityScore,
        fingerSpecs: finalizedSpecs,
        handSpecsBySide: finalizedBySide,
      });
      resetAndClose();
    } finally {
      setSaving(false);
    }
  };

  const stageStepIndex = (() => {
    if (!progress) return -1;
    switch (progress.stage) {
      case 'detecting_hands':
        return 0;
      case 'analyzing_global':
        return 1;
      case 'analyzing_finger':
      case 'rendering_3d':
      case 'fallback_local':
        return 2;
      case 'verifying_finger':
      case 'refining_finger':
      case 'done':
        return 3;
      default:
        return 0;
    }
  })();

  const activeMSpec = activeSpec?.manufacturingSpec;

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
                    ? 'Catálogo Oficial do Estúdio • Reconstrução 3D V11'
                    : 'Referência da Cliente • Reconstrução 3D V11'}
                </span>
                <h2 id="import-title" className="modal-title">
                  {isStudioMode
                    ? 'Cadastrar Modelo no Catálogo do Estúdio'
                    : 'Reconstrução Profunda 3D'}
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
              {/* Upload buttons */}
              <div className="import-upload-buttons">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="upload-action-btn">
                    <Upload size={16} />
                    <span>{analyzing ? 'Reconstruindo...' : 'Foto da Galeria'}</span>
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

              {/* Live Deep Reconstruction Progress Stepper */}
              {analyzing && progress && (
                <div className="deep-progress-panel" role="status" aria-live="polite">
                  <div className="deep-progress-head">
                    <span className="deep-progress-title">
                      <Loader2 size={15} className="spin-icon" />
                      <span>Reconstrução 3D Unha-por-Unha</span>
                    </span>
                    <span className="deep-progress-pct">{progress.percent}%</span>
                  </div>

                  <div className="deep-progress-bar">
                    <div
                      className="deep-progress-bar-fill"
                      style={{ width: `${Math.max(5, progress.percent)}%` }}
                    />
                  </div>

                  <div className="deep-progress-steps" aria-hidden="true">
                    {['Detecção', 'Global', '3D / Dedo', 'QA Visual'].map((label, i) => (
                      <span
                        key={label}
                        className={`deep-step-chip ${
                          i < stageStepIndex
                            ? 'is-done'
                            : i === stageStepIndex
                              ? 'is-active'
                              : ''
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>

                  <p className="deep-progress-msg">{progress.message}</p>

                  <div className="deep-progress-footer">
                    <span className="deep-progress-hint">
                      Análise de alta precisão — pode levar de 30s a alguns minutos para fidelidade
                      máxima.
                    </span>
                    <button
                      type="button"
                      className="deep-cancel-btn"
                      onClick={handleCancelAnalysis}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Missing Free Gemini Key Friendly Banner */}
              {result?.missingApiKey && (
                <div className="missing-key-banner">
                  <span>
                    <strong>Modo offline rápido utilizado.</strong> Para ativar a visão 3D
                    profunda com acessórios 3D reais e 95–99% de fidelidade (R$ 0,00), configure sua
                    chave gratuita do Google AI Studio.
                  </span>
                  <div className="missing-key-actions">
                    {onOpenSettings && (
                      <button
                        type="button"
                        className="missing-key-link"
                        onClick={() => {
                          onClose();
                          onOpenSettings();
                        }}
                      >
                        Abrir Configurações
                      </button>
                    )}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="missing-key-link"
                    >
                      <span>Criar chave grátis</span>
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              )}

              {/* Side-by-Side Comparison: Original Reference Zoom vs Real 3D Render */}
              {activeSpec && activePreviewUrl && (
                <div className="v5-five-finger-section">
                  <div className="v5-section-head">
                    <span className="field-label">
                      Comparativo: {FINGER_LABELS_PT[selectedFinger]}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {result?.handsCount === 2 && handSpecsBySide && (
                        <div className="hand-side-tabs" role="tablist" aria-label="Mão">
                          {(['Right', 'Left'] as const).map((side) => (
                            <button
                              key={side}
                              type="button"
                              role="tab"
                              aria-selected={activeHandSide === side}
                              className={`hand-side-tab ${activeHandSide === side ? 'is-active' : ''}`}
                              onClick={() => setActiveHandSide(side)}
                            >
                              {side === 'Right' ? 'Mão Dir.' : 'Mão Esq.'}
                            </button>
                          ))}
                        </div>
                      )}
                      {typeof (activeSpec.fidelityScore ?? result?.averageFidelityScore) ===
                        'number' && (
                        <span
                          className={`fidelity-badge ${
                            result?.mode === 'local_fallback' ? 'is-local' : ''
                          }`}
                        >
                          <ShieldCheck size={12} />
                          <span>
                            {activeSpec.fidelityScore ?? result?.averageFidelityScore}% fiel
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="side-by-side-compare">
                    <div className="compare-pane">
                      {activeSpec.referenceZoomDataUrl ? (
                        <img
                          src={activeSpec.referenceZoomDataUrl}
                          alt={`Referência real ${FINGER_LABELS_PT[selectedFinger]}`}
                          draggable={false}
                        />
                      ) : (
                        <div className="nail-crop-placeholder">
                          <Sparkles size={18} />
                          <span>Sem recorte individual (harmonia)</span>
                        </div>
                      )}
                      <span className="compare-pane-label">Referência Real</span>
                    </div>

                    <div className="compare-pane">
                      <img
                        src={activePreviewUrl}
                        alt={`Molde 3D ${FINGER_LABELS_PT[selectedFinger]}`}
                        draggable={false}
                      />
                      <span className="compare-pane-label">Molde 3D</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 5-Finger Strip */}
              {currentHandSpecs && (
                <div
                  className="v5-five-finger-section"
                  role="group"
                  aria-label="Reconstrução dos dedos"
                >
                  <div className="v5-section-head">
                    <span className="field-label">
                      {result?.handsCount === 2
                        ? `10 Dedos (${activeHandSide === 'Right' ? 'Mão Direita' : 'Mão Esquerda'})`
                        : '5 Dedos Reconstruídos (toque para inspecionar)'}
                    </span>
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
                      const spec = currentHandSpecs[fid];
                      const isActive = fid === selectedFinger;
                      const thumbRadius = getSilhouetteBorderRadius(spec.shape);
                      const swatchSrc = fingerPreviews ? fingerPreviews[fid] : null;
                      return (
                        <button
                          key={fid}
                          type="button"
                          onClick={() => setSelectedFinger(fid)}
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
                                  objectFit: 'cover',
                                  borderRadius: thumbRadius,
                                }}
                              />
                            )}
                          </div>
                          <span className="v5-finger-name">{FINGER_LABELS_PT[fid]}</span>
                          <span className="v5-finger-badge">
                            {typeof spec.fidelityScore === 'number'
                              ? `${spec.fidelityScore}%`
                              : PATTERN_LABELS_PT[spec.pattern]}
                          </span>
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

              {/* Per-Finger Technical Details & Quick Color Tweaks */}
              {activeSpec && (
                <div className="extractor-refine-box">
                  <div className="extractor-refine-head">
                    <span>
                      <Palette size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} />
                      {FINGER_LABELS_PT[selectedFinger]} • {SHAPE_LABELS[activeSpec.shape]} (
                      {activeSpec.relativeLength.toFixed(2)}x)
                    </span>
                    <span className="v5-source-pill">
                      {activeSpec.detectedFromPhoto ? 'Analisado da Foto' : 'Harmonia Automática'}
                    </span>
                  </div>

                  {activeMSpec?.designNotesPt && (
                    <p
                      style={{
                        margin: 0,
                        fontSize: '0.7rem',
                        color: 'var(--glass-muted)',
                        lineHeight: 1.35,
                      }}
                    >
                      {activeMSpec.designNotesPt}
                    </p>
                  )}

                  <div className="blueprint-meta-pills" aria-label="Especificação 3D extraída">
                    <span className="blueprint-meta-pill">
                      <span
                        className="blueprint-color-dot"
                        style={{
                          background: activeMSpec?.trueBaseColorHex ?? activeSpec.baseColor,
                        }}
                      />
                      {activeMSpec
                        ? FINISH_LABELS[activeMSpec.finishType]
                        : PATTERN_LABELS_PT[activeSpec.pattern]}
                    </span>

                    {activeMSpec && activeMSpec.accessories3D.length > 0 && (
                      <span className="blueprint-meta-pill">
                        {activeMSpec.accessories3D.length} acessório(s) 3D
                      </span>
                    )}

                    {activeMSpec && activeMSpec.borderType !== 'none' && (
                      <span className="blueprint-meta-pill">
                        {activeMSpec.borderIsMetallic ? 'Borda Metálica' : 'Francesinha'}
                      </span>
                    )}

                    {activeMSpec && activeMSpec.strokes3D.length > 0 && (
                      <span className="blueprint-meta-pill">
                        {activeMSpec.strokes3D.length} traço(s) 3D
                      </span>
                    )}
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
                      ? 'Ex: Amendoada Ouro Champagne Studs'
                      : 'Ex: Ouro Champagne Cromado 3D'
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
                        ? 'Cadastrar Modelo no Catálogo do Estúdio'
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
