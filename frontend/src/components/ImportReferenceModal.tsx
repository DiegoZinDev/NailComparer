import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Check,
  Crosshair,
  ExternalLink,
  KeyRound,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  type DeepReconstructionProgress,
  type DeepReconstructionResult,
  getSavedGeminiApiKey,
  runDeepPerFingerReconstruction,
} from '../lib/deepNailReconstructor';
import {
  FINGER_LABELS_PT,
  ORDERED_FINGERS,
  PATTERN_LABELS_PT,
  analyzeReferencePhotoPerFinger,
  extractTrueUVNailTexture,
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
  NailUvPinTarget,
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

const FINISH_OPTIONS: Array<{
  id: 'chrome' | 'glossy' | 'pearl' | 'velvet';
  label: string;
  finishType: Nail3DFinishType;
  designFinish: NailDesign['finish'];
}> = [
  { id: 'chrome', label: 'Cromo Espelhado', finishType: 'mirror_chrome', designFinish: 'chrome' },
  { id: 'glossy', label: 'Gel Brilho', finishType: 'solid_gloss_gel', designFinish: 'glossy' },
  { id: 'pearl', label: 'Pérola', finishType: 'glazed_pearl', designFinish: 'chrome' },
  { id: 'velvet', label: 'Matte', finishType: 'velvet_matte', designFinish: 'velvet' },
];

const FINISH_LABELS: Record<Nail3DFinishType, string> = {
  mirror_chrome: 'Cromado Espelho',
  glazed_pearl: 'Perolado Glaze',
  solid_gloss_gel: 'Gel Brilho',
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

const DEFAULT_PIN_TARGET: NailUvPinTarget = {
  cxNorm: 0.5,
  cyNorm: 0.5,
  widthNorm: 0.14,
  heightNorm: 0.22,
  angleRad: -Math.PI / 2,
  detectedFromPhoto: false,
};

const LOUPE_SIZE = 216;
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
  onOpenSettings,
}) => {
  const [name, setName] = useState('');
  const [engineMode, setEngineMode] = useState<'unknown' | 'ai_vlm' | 'offline_loupe'>('unknown');
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [deepResult, setDeepResult] = useState<DeepReconstructionResult | null>(null);
  const [fingerSpecs, setFingerSpecs] = useState<Record<FingerId, NailFingerDesignSpec> | null>(
    null
  );
  const [handSpecsBySide, setHandSpecsBySide] = useState<NailHandSpecsBySide | undefined>(
    undefined
  );
  const [activeHandSide, setActiveHandSide] = useState<'Right' | 'Left'>('Right');
  const [selectedFinger, setSelectedFinger] = useState<FingerId>('ring');
  const [offlineShape, setOfflineShape] = useState<NailShape>('almond');
  const [offlineFinishId, setOfflineFinishId] = useState<'chrome' | 'glossy' | 'pearl' | 'velvet'>(
    'glossy'
  );
  const [angleOffsetDeg, setAngleOffsetDeg] = useState<number>(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<DeepReconstructionProgress | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
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
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (pendingExtractRafRef.current !== null) {
        cancelAnimationFrame(pendingExtractRafRef.current);
        pendingExtractRafRef.current = null;
      }
      setError(null);
      setProgress(null);
      setAnalyzing(false);
    } else {
      // Show initial transparent engine status hint based on saved local key
      setEngineMode(getSavedGeminiApiKey() ? 'ai_vlm' : 'unknown');
    }
  }, [open]);

  const currentHandSpecs = useMemo(() => {
    if (handSpecsBySide?.[activeHandSide]) {
      return handSpecsBySide[activeHandSide]!;
    }
    return fingerSpecs;
  }, [handSpecsBySide, activeHandSide, fingerSpecs]);

  const activeSpec = currentHandSpecs ? currentHandSpecs[selectedFinger] : null;
  const activeTarget: NailUvPinTarget = activeSpec?.uvExtractionTarget ?? DEFAULT_PIN_TARGET;

  const fingerPreviews = useMemo(() => {
    if (!currentHandSpecs) return null;
    const previews = {} as Record<FingerId, string>;
    for (const id of ORDERED_FINGERS) {
      previews[id] = generateNailSwatchDataUrl(currentHandSpecs[id], 180, 260);
    }
    return previews;
  }, [currentHandSpecs]);

  const activePreviewUrl = fingerPreviews ? fingerPreviews[selectedFinger] : null;

  // Draw the 4x Zoom Interactive UV Pincher Loupe canvas (Offline / Manual UV mode)
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
      const rotToUp = -Math.PI / 2 - target.angleRad;

      ctx.save();
      ctx.translate(LOUPE_SIZE * 0.5, LOUPE_SIZE * 0.5);
      ctx.scale(zoomScale, zoomScale);
      ctx.rotate(rotToUp);
      ctx.translate(-cxPx, -cyPx);
      ctx.drawImage(img, 0, 0, srcW, srcH);
      ctx.restore();

      // Overlay the anatomical silhouette extraction guide
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
    if (engineMode === 'offline_loupe' && sourceImage && activeTarget) {
      drawLoupeCanvas(sourceImage, activeTarget);
    }
  }, [engineMode, sourceImage, activeTarget, drawLoupeCanvas]);

  const scheduleUvReExtraction = useCallback(
    (fid: FingerId, nextTarget: NailUvPinTarget, shapeOverride?: NailShape) => {
      if (!sourceImage) return;
      const targetShape = shapeOverride ?? offlineShape;

      const runExtract = () => {
        pendingExtractRafRef.current = null;
        lastExtractTimeRef.current = performance.now();
        const trueUvDataUrl = extractTrueUVNailTexture(sourceImage, nextTarget, 512, targetShape);
        if (!trueUvDataUrl) return;
        setFingerSpecs((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            [fid]: {
              ...prev[fid],
              shape: targetShape,
              renderStrategy: 'canonical_uv_delighted',
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
    [sourceImage, offlineShape]
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
      const img = await loadHtmlImage(dataUrl);
      setSourceImage(img);

      // Try V13 OmniFabric Deep VLM first (uses server GEMINI_API_KEY or saved local free key)
      const res = await runDeepPerFingerReconstruction(dataUrl, {
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      if (res.mode === 'deep_vlm') {
        // AI Vision succeeded! Use verified 3D renders + side-by-side comparison
        setEngineMode('ai_vlm');
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
        // Offline / missing API key: NEVER show hallucinated 76% vector fallback!
        // Switch transparently to the clean silhouette-conformed 4x UV Loupe + Shape/Finish controls
        setEngineMode('offline_loupe');
        setDeepResult(null);
        setHandSpecsBySide(undefined);

        const localUv = await analyzeReferencePhotoPerFinger(dataUrl);
        const cleanUvSpecs = {} as Record<FingerId, NailFingerDesignSpec>;
        for (const id of ORDERED_FINGERS) {
          const s = localUv.fingerSpecs[id];
          baseAngleRef.current[id] = s.uvExtractionTarget?.angleRad ?? -Math.PI / 2;
          cleanUvSpecs[id] = {
            ...s,
            renderStrategy: 'canonical_uv_delighted',
            manufacturingSpec: undefined,
            preview3DDataUrl: undefined,
            fidelityScore: undefined,
          };
        }
        setFingerSpecs(cleanUvSpecs);
        setOfflineShape(localUv.primaryShape);
        setOfflineFinishId(localUv.primaryPattern === 'chrome_mirror' ? 'chrome' : 'glossy');
        setSelectedFinger(
          localUv.detectedFingerIds.includes('middle')
            ? 'middle'
            : localUv.detectedFingerIds[0] ?? 'middle'
        );
        setAngleOffsetDeg(0);
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

  const handleOfflineShapeChange = (shape: NailShape) => {
    setOfflineShape(shape);
    if (!fingerSpecs || !sourceImage) return;
    const next = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const id of ORDERED_FINGERS) {
      const target = fingerSpecs[id].uvExtractionTarget ?? DEFAULT_PIN_TARGET;
      const reExtracted = extractTrueUVNailTexture(sourceImage, target, 512, shape);
      next[id] = {
        ...fingerSpecs[id],
        shape,
        trueUvDataUrl: reExtracted || fingerSpecs[id].trueUvDataUrl,
      };
    }
    setFingerSpecs(next);
  };

  const handleOfflineFinishChange = (finishId: 'chrome' | 'glossy' | 'pearl' | 'velvet') => {
    setOfflineFinishId(finishId);
    const opt = FINISH_OPTIONS.find((f) => f.id === finishId);
    if (!fingerSpecs || !opt) return;
    const next = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const id of ORDERED_FINGERS) {
      next[id] = {
        ...fingerSpecs[id],
        pattern: finishId === 'chrome' ? 'chrome_mirror' : 'solid_gloss',
        finishStyle:
          finishId === 'chrome'
            ? 'chrome_mirror'
            : finishId === 'pearl'
              ? 'pearl_glazed'
              : finishId === 'velvet'
                ? 'velvet_matte'
                : 'glossy_gel',
        metallicIntensity: finishId === 'chrome' ? 0.92 : finishId === 'pearl' ? 0.38 : 0.08,
        glossIntensity: finishId === 'velvet' ? 0.55 : 0.98,
      };
    }
    setFingerSpecs(next);
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
        renderStrategy: source.renderStrategy,
        trueUvDataUrl: source.trueUvDataUrl,
        preview3DDataUrl: source.preview3DDataUrl,
        manufacturingSpec: source.manufacturingSpec
          ? { ...source.manufacturingSpec, fingerId: id }
          : undefined,
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
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (pendingExtractRafRef.current !== null) {
      cancelAnimationFrame(pendingExtractRafRef.current);
      pendingExtractRafRef.current = null;
    }
    setName('');
    setSourceImage(null);
    setDeepResult(null);
    setFingerSpecs(null);
    setHandSpecsBySide(undefined);
    setSelectedFinger('ring');
    setAngleOffsetDeg(0);
    setProgress(null);
    setAnalyzing(false);
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
      const offlineOpt = FINISH_OPTIONS.find((f) => f.id === offlineFinishId);
      const finalFinish: NailDesign['finish'] =
        engineMode === 'offline_loupe'
          ? offlineOpt?.designFinish ?? 'glossy'
          : middleSpec.manufacturingSpec?.finishType === 'mirror_chrome' ||
              middleSpec.manufacturingSpec?.finishType === 'glazed_pearl'
            ? 'chrome'
            : middleSpec.manufacturingSpec?.finishType === 'velvet_matte'
              ? 'velvet'
              : 'glossy';

      await onCreateDesign({
        name: name.trim() || `${PATTERN_LABELS_PT[middleSpec.pattern]} 3D`,
        category: isStudioMode ? 'Estudio' : 'Cliente',
        patternType: mapArtisticToDesignPattern(middleSpec.pattern),
        baseColor: middleSpec.baseColor,
        secondaryColor: middleSpec.secondaryColor,
        accentColor: middleSpec.accentColor,
        finish: finalFinish,
        imageDataUrl: swatchDataUrl,
        isCustom: !isStudioMode,
        isStudioCatalog: isStudioMode,
        detectedShape: engineMode === 'offline_loupe' ? offlineShape : middleSpec.shape,
        detectedLength: middleSpec.relativeLength,
        fidelityScore: deepResult?.averageFidelityScore,
        v13Engine: true,
        fingerSpecs: finalizedSpecs,
        handSpecsBySide: finalizedBySide,
      });
      resetAndClose();
    } finally {
      setSaving(false);
    }
  };

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
                    ? 'Catálogo do Estúdio • OmniFabric V13'
                    : 'Referência da Cliente • OmniFabric V13'}
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
              {/* V13 Transparent Engine Status Badge */}
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
                    <span>Motor IA 3D Ativo (Gemini Vision)</span>
                  </span>
                ) : (
                  <span className="fidelity-badge is-local">
                    <KeyRound size={12} />
                    <span>
                      {engineMode === 'offline_loupe'
                        ? 'Modo Local Offline — Configure sua Chave Gratuita IA'
                        : 'Gemini Vision (R$ 0,00) ou Lupa UV Offline'}
                    </span>
                  </span>
                )}

                {engineMode !== 'ai_vlm' && onOpenSettings && (
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
                      <span>Reconstrução 3D OmniFabric</span>
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
                      Análise óptica por dedo com auto-verificação visual.
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

              {/* Offline Transparent Banner */}
              {engineMode === 'offline_loupe' && (
                <div className="missing-key-banner">
                  <span>
                    <strong>Modo Local Offline (Lupa UV 4×).</strong> Para ativar a reconstrução
                    IA 3D com acessórios 3D reais e ~95–99% de fidelidade (100% gratuito no Free
                    Tier do Google AI Studio), configure sua chave gratuita em 30s.
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
                </div>
              )}

              {/* MODE A: AI VLM Side-by-Side Real Comparison (Reference Zoom vs Real 3D WebGL Render) */}
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

              {/* MODE B: Offline Clean 4x Interactive UV Loupe + Shape & Finish Selectors */}
              {engineMode === 'offline_loupe' && sourceImage && activeSpec && (
                <div className="v5-five-finger-section">
                  <div className="v5-section-head">
                    <span
                      className="field-label"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <Crosshair size={12} /> Lupa UV 4× — Arraste para enquadrar
                    </span>
                    <span className="v5-source-pill">
                      {FINGER_LABELS_PT[selectedFinger]} • Silhueta {SHAPE_LABELS[offlineShape]}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 114px',
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
                        maxWidth: 210,
                        width: '100%',
                        margin: '0 auto',
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
                          width: 104,
                          height: 152,
                          borderRadius: 16,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: '#131015',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          overflow: 'hidden',
                          padding: 6,
                        }}
                      >
                        {activePreviewUrl && (
                          <img
                            src={activePreviewUrl}
                            alt={`Prévia UV ${FINGER_LABELS_PT[selectedFinger]}`}
                            draggable={false}
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          />
                        )}
                      </div>
                      <span style={{ fontSize: '0.64rem', color: 'var(--glass-muted)' }}>
                        UV Conformado 3D
                      </span>
                    </div>
                  </div>

                  <div className="extractor-refine-box" style={{ gap: 8, padding: '9px 11px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span style={{ fontSize: '0.68rem', color: 'var(--glass-muted)', fontWeight: 600 }}>
                        Pinça & Ângulo ({angleOffsetDeg}°)
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          type="button"
                          className="icon-mini-btn"
                          onClick={() => adjustPincherSize(0.9)}
                          aria-label="Diminuir pinça"
                        >
                          <Minus size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-mini-btn"
                          onClick={() => adjustPincherSize(1.1)}
                          aria-label="Aumentar pinça"
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-mini-btn"
                          onClick={() => handleAngleChange(0)}
                          aria-label="Resetar ângulo"
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    </div>

                    <input
                      type="range"
                      min={-30}
                      max={30}
                      step={1}
                      value={angleOffsetDeg}
                      onChange={(e) => handleAngleChange(Number(e.target.value))}
                      style={{ width: '100%' }}
                    />

                    <div className="shape-selector">
                      {SHAPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleOfflineShapeChange(opt.id)}
                          className={`shape-chip ${offlineShape === opt.id ? 'is-active' : ''}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="shape-selector">
                      {FINISH_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleOfflineFinishChange(opt.id)}
                          className={`shape-chip ${offlineFinishId === opt.id ? 'is-active' : ''}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 5-Finger Strip */}
              {currentHandSpecs && (
                <div className="v5-five-finger-section" role="group" aria-label="Unhas reconstruídas">
                  <div className="v5-section-head">
                    <span className="field-label">
                      {deepResult?.handsCount === 2
                        ? `10 Dedos (${activeHandSide === 'Right' ? 'Mão Direita' : 'Mão Esquerda'})`
                        : '5 Dedos (toque para inspecionar)'}
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
                            {typeof spec.fidelityScore === 'number'
                              ? `${spec.fidelityScore}%`
                              : spec.detectedFromPhoto
                                ? 'UV Real'
                                : 'Harmonia'}
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
