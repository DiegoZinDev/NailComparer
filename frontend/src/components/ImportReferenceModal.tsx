import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  Check,
  CopyCheck,
  ExternalLink,
  KeyRound,
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
  type ServerAiStatus,
  blueprintToManufacturingSpec,
  checkServerAiStatus,
  getSavedGeminiApiKey,
  manufacturingSpecToFingerDesignSpec,
  runDeepPerFingerReconstruction,
  sanitizeManufacturingSpecClient,
} from '../lib/deepNailReconstructor';
import { generateNailTechnicalSheet } from '../lib/nailTechnicalSheet';
import {
  FINGER_LABELS_PT,
  ORDERED_FINGERS,
  PATTERN_LABELS_PT,
} from '../lib/perFingerVisionAnalyzer';
import { generateNailSwatchDataUrl } from '../lib/swatchPreview';
import { TechnicalSheetCard } from './TechnicalSheetCard';
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

const SHAPE_OPTIONS: Array<{ id: NailShape; label: string }> = [
  { id: 'almond', label: 'Amendoada' },
  { id: 'coffin', label: 'Bailarina' },
  { id: 'stiletto', label: 'Stiletto' },
  { id: 'oval', label: 'Oval' },
  { id: 'square', label: 'Quadrada' },
  { id: 'natural', label: 'Natural' },
];

const SHAPE_LABELS: Record<NailShape, string> = {
  natural: 'Natural',
  oval: 'Oval',
  almond: 'Amendoada',
  square: 'Quadrada',
  coffin: 'Bailarina',
  stiletto: 'Stiletto',
};

const PARAMETRIC_FINISH_OPTIONS: Array<{
  id: 'chrome' | 'glossy' | 'pearl' | 'velvet';
  label: string;
  finishType: Nail3DFinishType;
  designFinish: NailDesign['finish'];
}> = [
  { id: 'chrome', label: 'Cromado', finishType: 'mirror_chrome', designFinish: 'chrome' },
  { id: 'glossy', label: 'Gel Brilhante', finishType: 'solid_gloss_gel', designFinish: 'glossy' },
  { id: 'pearl', label: 'Perolado', finishType: 'glazed_pearl', designFinish: 'chrome' },
  { id: 'velvet', label: 'Fosco', finishType: 'velvet_matte', designFinish: 'velvet' },
];

const QUICK_COLOR_SWATCHES: Array<{ hex: string; label: string }> = [
  { hex: '#E3C3B5', label: 'Nude Rosé' },
  { hex: '#F4EAE3', label: 'Leite Pérola' },
  { hex: '#A91D34', label: 'Cereja' },
  { hex: '#5D1729', label: 'Vinho Marsala' },
  { hex: '#D8DDE6', label: 'Prata Cromo' },
  { hex: '#D9B668', label: 'Ouro Champagne' },
  { hex: '#C6A9DC', label: 'Lilás Soft' },
  { hex: '#1F1B20', label: 'Preto Ônix' },
];

const FINISH_LABELS: Record<Nail3DFinishType, string> = {
  mirror_chrome: 'Cromado Espelho',
  glazed_pearl: 'Perolado Glaze',
  solid_gloss_gel: 'Gel Brilhante',
  jelly_translucent: 'Jelly Translúcido',
  cat_eye_magnetic: 'Cat-Eye Magnético',
  velvet_matte: 'Veludo Fosco',
  glitter_suspension: 'Glitter Gel',
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

function stripTransientZoom(
  specs: Record<FingerId, NailFingerDesignSpec>
): Record<FingerId, NailFingerDesignSpec> {
  const out = {} as Record<FingerId, NailFingerDesignSpec>;
  for (const id of ORDERED_FINGERS) {
    const clean: NailFingerDesignSpec = { ...specs[id] };
    delete clean.referenceZoomDataUrl;
    out[id] = clean;
  }
  return out;
}

/**
 * Ensures a finger spec uses clean procedural 3D PBR parameters (never raw UV pixel crop)
 * while preserving any parametric shape, color, and finish edits.
 */
function buildCleanParametricFingerSpec(
  baseSpec: NailFingerDesignSpec,
  patch: {
    shape?: NailShape;
    baseColorHex?: string;
    finishType?: Nail3DFinishType;
  } = {}
): NailFingerDesignSpec {
  const existingMfg = blueprintToManufacturingSpec(baseSpec, baseSpec.handSide);
  const nextFinish = patch.finishType ?? existingMfg.finishType;
  const nextShape = patch.shape ?? existingMfg.shape;
  const nextColor = patch.baseColorHex ?? existingMfg.trueBaseColorHex;

  const isChrome = nextFinish === 'mirror_chrome';
  const isPearl = nextFinish === 'glazed_pearl';
  const isMatte = nextFinish === 'velvet_matte';

  const sanitizedMfg = sanitizeManufacturingSpecClient(
    {
      ...existingMfg,
      renderStrategy: 'procedural_pbr_3d',
      shape: nextShape,
      finishType: nextFinish,
      trueBaseColorHex: nextColor,
      secondaryColorHex: nextColor,
      cuticleColorHex: nextColor,
      tipColorHex: nextColor,
      gradientType: isChrome ? 'chrome_sheen' : 'none',
      metalness: isChrome ? 0.96 : isPearl ? 0.38 : 0.04,
      roughness: isChrome ? 0.06 : isMatte ? 0.44 : 0.08,
      clearcoat: isMatte ? 0.14 : 1.0,
      designNotesPt: `Paramétrico 3D (${SHAPE_LABELS[nextShape]}, ${FINISH_LABELS[nextFinish]}).`,
    },
    baseSpec.fingerId,
    baseSpec.handSide
  );

  const rebuilt = manufacturingSpecToFingerDesignSpec(sanitizedMfg, {
    detectedFromPhoto: baseSpec.detectedFromPhoto,
    referenceZoomDataUrl: baseSpec.referenceZoomDataUrl,
    trueUvDataUrl: undefined,
  });

  return {
    ...rebuilt,
    renderStrategy: 'procedural_pbr_3d',
    trueUvDataUrl: undefined,
    preview3DDataUrl: undefined,
  };
}

function resolveParametricFinishId(
  spec: NailFingerDesignSpec | null
): 'chrome' | 'glossy' | 'pearl' | 'velvet' {
  const ft = spec?.manufacturingSpec?.finishType;
  if (ft === 'mirror_chrome' || spec?.finishStyle === 'chrome_mirror') return 'chrome';
  if (ft === 'glazed_pearl' || spec?.finishStyle === 'pearl_glazed') return 'pearl';
  if (ft === 'velvet_matte' || spec?.finishStyle === 'velvet_matte') return 'velvet';
  return 'glossy';
}

interface ImportReferenceModalProps {
  open: boolean;
  targetMode?: 'client' | 'studio';
  studioName?: string;
  studioWhatsapp?: string;
  onClose: () => void;
  onCreateDesign: (design: Omit<NailDesign, 'id' | 'createdAt'>) => Promise<void>;
  onOpenSettings?: () => void;
}

export const ImportReferenceModal: React.FC<ImportReferenceModalProps> = ({
  open,
  targetMode = 'client',
  studioName,
  studioWhatsapp,
  onClose,
  onCreateDesign,
  onOpenSettings,
}) => {
  const [name, setName] = useState('');
  const [engineMode, setEngineMode] = useState<'unknown' | 'ai_vlm' | 'offline_parametric'>(
    'unknown'
  );
  const [serverAiStatus, setServerAiStatus] = useState<ServerAiStatus | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [isMissingApiKey, setIsMissingApiKey] = useState<boolean>(false);
  const [referenceDataUrl, setReferenceDataUrl] = useState<string | null>(null);
  const [deepResult, setDeepResult] = useState<DeepReconstructionResult | null>(null);
  const [fingerSpecs, setFingerSpecs] = useState<Record<FingerId, NailFingerDesignSpec> | null>(
    null
  );
  const [handSpecsBySide, setHandSpecsBySide] = useState<NailHandSpecsBySide | undefined>(
    undefined
  );
  const [activeHandSide, setActiveHandSide] = useState<'Right' | 'Left'>('Right');
  const [selectedFinger, setSelectedFinger] = useState<FingerId>('ring');
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
      setServerAiStatus(null);
      setFallbackReason(null);
      setIsMissingApiKey(false);
      return;
    }

    const hasLocalKey = Boolean(getSavedGeminiApiKey());
    setEngineMode(hasLocalKey ? 'ai_vlm' : 'unknown');

    const statusController = new AbortController();
    void checkServerAiStatus(fetch, { signal: statusController.signal })
      .then((status) => {
        if (statusController.signal.aborted) return;
        setServerAiStatus(status);
        if (status.configured) {
          setEngineMode((prev) => (prev === 'offline_parametric' ? prev : 'ai_vlm'));
          setIsMissingApiKey(false);
        } else if (status.reachable) {
          setIsMissingApiKey(true);
        } else {
          setIsMissingApiKey(false);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!statusController.signal.aborted) {
          setServerAiStatus({ reachable: false, configured: false, source: 'none' });
        }
      });

    return () => {
      statusController.abort();
    };
  }, [open]);

  const currentHandSpecs = useMemo(() => {
    if (handSpecsBySide?.[activeHandSide]) {
      return handSpecsBySide[activeHandSide]!;
    }
    return fingerSpecs;
  }, [handSpecsBySide, activeHandSide, fingerSpecs]);

  const activeSpec = currentHandSpecs ? currentHandSpecs[selectedFinger] : null;

  const fingerPreviews = useMemo(() => {
    if (!currentHandSpecs) return null;
    const previews = {} as Record<FingerId, string>;
    for (const id of ORDERED_FINGERS) {
      previews[id] = generateNailSwatchDataUrl(currentHandSpecs[id], 180, 260);
    }
    return previews;
  }, [currentHandSpecs]);

  const activePreviewUrl = fingerPreviews ? fingerPreviews[selectedFinger] : null;

  // Live V14 Technical Sheet recalculated in real time from current fingerSpecs
  const liveTechnicalSheet = useMemo(() => {
    if (!currentHandSpecs) return null;
    return generateNailTechnicalSheet({
      designName: name.trim() || undefined,
      studioName,
      fingerSpecs: currentHandSpecs,
      summaryPt: engineMode === 'ai_vlm' ? deepResult?.summaryPt : undefined,
    });
  }, [currentHandSpecs, name, studioName, engineMode, deepResult?.summaryPt]);

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
    setFallbackReason(null);
    setIsMissingApiKey(false);
    setAnalyzing(true);
    setProgress({
      stage: 'detecting_hands',
      message: 'Analisando foto de referência...',
      currentFingerIndex: 0,
      totalFingers: 5,
      percent: 8,
    });

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setReferenceDataUrl(dataUrl);

      const res = await runDeepPerFingerReconstruction(dataUrl, {
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      if (res.mode === 'deep_vlm') {
        setEngineMode('ai_vlm');
        setFallbackReason(null);
        setIsMissingApiKey(false);
        setDeepResult(res);
        setFingerSpecs(res.fingerSpecs);
        setHandSpecsBySide(res.handSpecsBySide);
        setActiveHandSide(res.handSpecsBySide?.Right ? 'Right' : 'Left');

        const richFinger =
          ORDERED_FINGERS.find(
            (id) =>
              (res.fingerSpecs[id].manufacturingSpec?.accessories3D.length ?? 0) > 0 ||
              res.fingerSpecs[id].manufacturingSpec?.finishType === 'mirror_chrome'
          ) ?? 'ring';
        setSelectedFinger(richFinger);
      } else {
        // Offline / local mode: clean 3D procedural PBR per-finger specs (ZERO raw UV pixel crop!)
        setEngineMode('offline_parametric');
        setFallbackReason(res.fallbackReason ?? null);
        setIsMissingApiKey(res.missingApiKey === true);
        setDeepResult(res);
        setHandSpecsBySide(undefined);

        const cleanParametricSpecs = {} as Record<FingerId, NailFingerDesignSpec>;
        for (const id of ORDERED_FINGERS) {
          cleanParametricSpecs[id] = buildCleanParametricFingerSpec(res.fingerSpecs[id]);
        }
        setFingerSpecs(cleanParametricSpecs);
        setSelectedFinger('ring');
      }

      if (!name.trim()) {
        const cleanFile = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
        setName(
          cleanFile.length > 2
            ? cleanFile.slice(0, 26)
            : `${SHAPE_LABELS[res.primaryShape]} 3D`
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Análise cancelada.');
      } else {
        setError('Não foi possível processar esta foto. Tente outra imagem nítida.');
      }
    } finally {
      abortControllerRef.current = null;
      setAnalyzing(false);
      e.target.value = '';
    }
  };

  // Per-finger parametric update (Offline / Local Mode)
  const updateSelectedFingerParametric = (patch: {
    shape?: NailShape;
    baseColorHex?: string;
    finishType?: Nail3DFinishType;
  }) => {
    setFingerSpecs((prev) => {
      if (!prev) return prev;
      const current = prev[selectedFinger];
      return {
        ...prev,
        [selectedFinger]: buildCleanParametricFingerSpec(current, patch),
      };
    });
  };

  const applySelectedFingerToAll5 = () => {
    if (!fingerSpecs) return;
    const source = fingerSpecs[selectedFinger];
    const next = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const id of ORDERED_FINGERS) {
      if (engineMode === 'offline_parametric') {
        const srcMfg = blueprintToManufacturingSpec(source, source.handSide);
        next[id] = buildCleanParametricFingerSpec(fingerSpecs[id], {
          shape: srcMfg.shape,
          baseColorHex: srcMfg.trueBaseColorHex,
          finishType: srcMfg.finishType,
        });
      } else {
        next[id] = {
          ...fingerSpecs[id],
          shape: source.shape,
          baseColor: source.baseColor,
          secondaryColor: source.secondaryColor,
          accentColor: source.accentColor,
          pattern: source.pattern,
          renderStrategy: source.renderStrategy,
          trueUvDataUrl: source.trueUvDataUrl,
          preview3DDataUrl: source.preview3DDataUrl,
          manufacturingSpec: source.manufacturingSpec
            ? { ...source.manufacturingSpec, fingerId: id }
            : undefined,
        };
      }
    }
    setFingerSpecs(next);
  };

  const resetAndClose = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setName('');
    setReferenceDataUrl(null);
    setDeepResult(null);
    setFingerSpecs(null);
    setHandSpecsBySide(undefined);
    setSelectedFinger('ring');
    setProgress(null);
    setAnalyzing(false);
    setFallbackReason(null);
    setIsMissingApiKey(false);
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fingerSpecs || !activeSpec) {
      setError('Envie ou fotografe uma referência primeiro.');
      return;
    }
    setSaving(true);
    try {
      const middleSpec = fingerSpecs.middle ?? activeSpec;
      const finalizedSpecs = stripTransientZoom(fingerSpecs);
      const finalizedBySide: NailHandSpecsBySide | undefined = handSpecsBySide
        ? {
            Left: handSpecsBySide.Left ? stripTransientZoom(handSpecsBySide.Left) : undefined,
            Right: handSpecsBySide.Right ? stripTransientZoom(handSpecsBySide.Right) : undefined,
          }
        : undefined;

      const swatchDataUrl = generateNailSwatchDataUrl(activeSpec, 180, 260);
      const finishType = middleSpec.manufacturingSpec?.finishType;
      const finalFinish: NailDesign['finish'] =
        finishType === 'mirror_chrome' || finishType === 'glazed_pearl'
          ? 'chrome'
          : finishType === 'velvet_matte'
            ? 'velvet'
            : finishType === 'glitter_suspension'
              ? 'glitter'
              : 'glossy';

      const finalName = name.trim() || `${PATTERN_LABELS_PT[middleSpec.pattern]} 3D`;
      const finalTechnicalSheet = generateNailTechnicalSheet({
        designName: finalName,
        studioName,
        fingerSpecs: finalizedSpecs,
        predominantShape: middleSpec.shape,
        summaryPt: engineMode === 'ai_vlm' ? deepResult?.summaryPt : undefined,
      });

      await onCreateDesign({
        name: finalName,
        category: isStudioMode ? 'Estudio' : 'Cliente',
        patternType: mapArtisticToDesignPattern(middleSpec.pattern),
        baseColor: middleSpec.baseColor,
        secondaryColor: middleSpec.secondaryColor,
        accentColor: middleSpec.accentColor,
        finish: finalFinish,
        imageDataUrl: swatchDataUrl,
        isCustom: !isStudioMode,
        isStudioCatalog: isStudioMode,
        detectedShape: middleSpec.shape,
        detectedLength: middleSpec.relativeLength,
        fidelityScore: engineMode === 'ai_vlm' ? deepResult?.averageFidelityScore : undefined,
        v13Engine: true,
        fingerSpecs: finalizedSpecs,
        handSpecsBySide: finalizedBySide,
        technicalSheet: finalTechnicalSheet,
      });
      resetAndClose();
    } finally {
      setSaving(false);
    }
  };

  const activeMSpec = activeSpec?.manufacturingSpec;
  const activeFinishId = resolveParametricFinishId(activeSpec);

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
                    ? 'Catálogo do Estúdio • Motor Semântico V14'
                    : 'Referência da Cliente • Motor Semântico V14'}
                </span>
                <h2 id="import-title" className="modal-title">
                  {isStudioMode
                    ? 'Cadastrar Modelo no Catálogo'
                    : 'Reconstruir Unhas em 3D'}
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
              {/* Transparent Engine Status Badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                {engineMode === 'ai_vlm' ? (
                  <span className="fidelity-badge">
                    <ShieldCheck size={12} />
                    <span>
                      {serverAiStatus?.source === 'header' ||
                      (!serverAiStatus && Boolean(getSavedGeminiApiKey()))
                        ? 'Motor IA 3D Ativo (Gemini Vision — Chave Local)'
                        : 'Motor IA 3D Ativo (Gemini Vision — Servidor)'}
                    </span>
                  </span>
                ) : serverAiStatus && !serverAiStatus.reachable && !isMissingApiKey ? (
                  <span className="fidelity-badge is-local">
                    <AlertTriangle size={12} />
                    <span>
                      {serverAiStatus.status
                        ? `Modo Local Paramétrico 3D (Servidor HTTP ${serverAiStatus.status})`
                        : 'Modo Local Paramétrico 3D (Offline)'}
                    </span>
                  </span>
                ) : fallbackReason && !isMissingApiKey ? (
                  <span className="fidelity-badge is-local">
                    <AlertTriangle size={12} />
                    <span>Modo Local Paramétrico 3D — Servidor IA indisponível</span>
                  </span>
                ) : (
                  <span className="fidelity-badge is-local">
                    <KeyRound size={12} />
                    <span>
                      {engineMode === 'offline_parametric' || isMissingApiKey
                        ? 'Modo Local Paramétrico 3D — Configure Chave IA Gratuita'
                        : 'Verificando Motor IA 3D no servidor...'}
                    </span>
                  </span>
                )}

                {engineMode !== 'ai_vlm' &&
                  onOpenSettings &&
                  (isMissingApiKey ||
                    (serverAiStatus?.reachable === true && !serverAiStatus.configured)) && (
                    <button
                      type="button"
                      className="missing-key-link"
                      onClick={() => {
                        onClose();
                        onOpenSettings();
                      }}
                    >
                      Configurar Chave Gratuita (30s)
                    </button>
                  )}
              </div>

              {/* Upload / Camera Buttons */}
              <div className="import-upload-buttons">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="upload-action-btn">
                    <Upload size={16} />
                    <span>{analyzing ? 'Processando...' : 'Foto da Galeria'}</span>
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

              {/* Live Deep Reconstruction Progress */}
              {analyzing && progress && (
                <div className="deep-progress-panel" role="status" aria-live="polite">
                  <div className="deep-progress-head">
                    <span className="deep-progress-title">
                      <Loader2 size={15} className="spin-icon" />
                      <span>Reconstrução 3D Semântica</span>
                    </span>
                    <span className="deep-progress-pct">{progress.percent}%</span>
                  </div>
                  <div className="deep-progress-bar">
                    <div
                      className="deep-progress-bar-fill"
                      style={{ width: `${Math.max(5, progress.percent)}%` }}
                    />
                  </div>
                  <p className="deep-progress-msg">{progress.message}</p>
                  <div className="deep-progress-footer">
                    <span className="deep-progress-hint">
                      Análise óptica por dedo e geração da Ficha Técnica.
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

              {/* Offline / Parametric Mode Transparent Banner */}
              {engineMode === 'offline_parametric' && (
                <div className="missing-key-banner">
                  {fallbackReason && !isMissingApiKey ? (
                    <span>
                      <strong>Modo Paramétrico 3D Local.</strong> {fallbackReason} Personalize cor,
                      formato e acabamento de cada dedo abaixo com renderização 3D limpa.
                    </span>
                  ) : (
                    <>
                      <span>
                        <strong>Modo Paramétrico 3D Local.</strong> Personalize cada dedo abaixo ou
                        ative a reconstrução IA automática (100% gratuita no Google AI Studio) em
                        30 segundos.
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
                            Configurar Chave Gratuita (30s)
                          </button>
                        )}
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="missing-key-link"
                        >
                          <span>Gerar chave grátis</span>
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* MODE A: AI VLM Side-by-Side Real Comparison */}
              {engineMode === 'ai_vlm' && activeSpec && activePreviewUrl && (
                <div className="v5-five-finger-section">
                  <div className="v5-section-head">
                    <span className="field-label">
                      Comparativo Real: {FINGER_LABELS_PT[selectedFinger]}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {deepResult?.handsCount === 2 && handSpecsBySide && (
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
                      {typeof (activeSpec.fidelityScore ?? deepResult?.averageFidelityScore) ===
                        'number' && (
                        <span className="fidelity-badge">
                          <ShieldCheck size={12} />
                          <span>
                            {activeSpec.fidelityScore ?? deepResult?.averageFidelityScore}% fiel
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
                          <span>Harmonia automática</span>
                        </div>
                      )}
                      <span className="compare-pane-label">Referência Real</span>
                    </div>

                    <div className="compare-pane">
                      <img
                        src={activePreviewUrl}
                        alt={`Render 3D ${FINGER_LABELS_PT[selectedFinger]}`}
                        draggable={false}
                      />
                      <span className="compare-pane-label">Render 3D WebGL</span>
                    </div>
                  </div>

                  {activeMSpec && (
                    <div className="blueprint-meta-pills">
                      <span className="blueprint-meta-pill">
                        <span
                          className="blueprint-color-dot"
                          style={{ background: activeMSpec.trueBaseColorHex }}
                        />
                        {FINISH_LABELS[activeMSpec.finishType]}
                      </span>
                      <span className="blueprint-meta-pill">
                        {SHAPE_LABELS[activeMSpec.shape]}
                      </span>
                      {activeMSpec.accessories3D.length > 0 && (
                        <span className="blueprint-meta-pill">
                          {activeMSpec.accessories3D.length} acessório(s) 3D
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* MODE B: Offline Clean Parametric Per-Finger 3D Editor (ZERO Raw Pixel Crop) */}
              {engineMode === 'offline_parametric' && activeSpec && activePreviewUrl && (
                <div className="v5-five-finger-section">
                  <div className="v5-section-head">
                    <span
                      className="field-label"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <Palette size={12} /> Ajuste Paramétrico 3D — {FINGER_LABELS_PT[selectedFinger]}
                    </span>
                    <span className="v5-source-pill">
                      PBR 3D Limpo • {SHAPE_LABELS[activeSpec.shape]}
                    </span>
                  </div>

                  <div className="side-by-side-compare">
                    <div className="compare-pane">
                      {referenceDataUrl ? (
                        <img
                          src={referenceDataUrl}
                          alt="Foto de referência"
                          draggable={false}
                        />
                      ) : (
                        <div className="nail-crop-placeholder">
                          <Sparkles size={18} />
                          <span>Referência</span>
                        </div>
                      )}
                      <span className="compare-pane-label">Referência</span>
                    </div>

                    <div className="compare-pane">
                      <img
                        src={activePreviewUrl}
                        alt={`Prévia 3D ${FINGER_LABELS_PT[selectedFinger]}`}
                        draggable={false}
                        style={{ objectFit: 'contain', padding: 10 }}
                      />
                      <span className="compare-pane-label">
                        {FINGER_LABELS_PT[selectedFinger]} 3D
                      </span>
                    </div>
                  </div>

                  <div className="parametric-editor-card">
                    {/* Color Picker + Quick Luxury Swatches */}
                    <div className="parametric-control-group">
                      <div className="parametric-control-head">
                        <span className="parametric-label">Cor Base ({FINGER_LABELS_PT[selectedFinger]})</span>
                        <label className="parametric-color-picker">
                          <input
                            type="color"
                            value={activeSpec.baseColor}
                            onChange={(e) =>
                              updateSelectedFingerParametric({
                                baseColorHex: e.target.value.toUpperCase(),
                              })
                            }
                            aria-label={`Cor base do dedo ${FINGER_LABELS_PT[selectedFinger]}`}
                          />
                          <span>{activeSpec.baseColor.toUpperCase()}</span>
                        </label>
                      </div>

                      <div className="parametric-swatch-row" role="group" aria-label="Cores rápidas">
                        {QUICK_COLOR_SWATCHES.map((sw) => {
                          const isCurrent =
                            activeSpec.baseColor.toUpperCase() === sw.hex.toUpperCase();
                          return (
                            <button
                              key={sw.hex}
                              type="button"
                              onClick={() =>
                                updateSelectedFingerParametric({ baseColorHex: sw.hex })
                              }
                              className={`parametric-swatch-btn ${isCurrent ? 'is-active' : ''}`}
                              style={{ backgroundColor: sw.hex }}
                              title={sw.label}
                              aria-label={`Cor ${sw.label}`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Shape selector for selected finger */}
                    <div className="parametric-control-group">
                      <span className="parametric-label">Formato</span>
                      <div className="shape-selector">
                        {SHAPE_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateSelectedFingerParametric({ shape: opt.id })}
                            className={`shape-chip ${activeSpec.shape === opt.id ? 'is-active' : ''}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Finish selector for selected finger */}
                    <div className="parametric-control-group">
                      <span className="parametric-label">Acabamento</span>
                      <div className="parametric-finish-grid">
                        {PARAMETRIC_FINISH_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() =>
                              updateSelectedFingerParametric({ finishType: opt.finishType })
                            }
                            className={`shape-chip ${activeFinishId === opt.id ? 'is-active' : ''}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="parametric-apply-all-btn"
                      onClick={applySelectedFingerToAll5}
                    >
                      <CopyCheck size={14} />
                      <span>Aplicar em todos os dedos</span>
                    </button>
                  </div>
                </div>
              )}

              {/* 5-Finger Strip */}
              {currentHandSpecs && (
                <div className="v5-five-finger-section" role="group" aria-label="Unhas reconstruídas">
                  <div className="v5-section-head">
                    <span className="field-label">
                      {deepResult?.handsCount === 2 && engineMode === 'ai_vlm'
                        ? `10 Dedos (${activeHandSide === 'Right' ? 'Mão Direita' : 'Mão Esquerda'})`
                        : '5 Dedos (toque para editar ou inspecionar)'}
                    </span>
                    {engineMode === 'ai_vlm' && (
                      <button
                        type="button"
                        className="text-link-btn"
                        onClick={applySelectedFingerToAll5}
                      >
                        Aplicar em todos os dedos
                      </button>
                    )}
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
                                  objectFit: 'contain',
                                  borderRadius: thumbRadius,
                                }}
                              />
                            )}
                          </div>
                          <span className="v5-finger-name">{FINGER_LABELS_PT[fid]}</span>
                          <span className="v5-finger-badge">
                            {typeof spec.fidelityScore === 'number' && engineMode === 'ai_vlm'
                              ? `${spec.fidelityScore}%`
                              : '3D PBR'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Live V14 Technical Sheet Card (AI or Local Mode) */}
              {liveTechnicalSheet && (
                <TechnicalSheetCard
                  sheet={liveTechnicalSheet}
                  studioWhatsapp={studioWhatsapp}
                  title="Ficha Técnica Unha-por-Unha"
                  collapsible
                  defaultOpen
                  compact
                />
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
                      : 'Ex: Referência Dourada 3D'
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
