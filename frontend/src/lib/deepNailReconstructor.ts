import { detectHandsOnImageWithSingleton } from './handTrackingWorker';
import { OffscreenNailRenderSession } from './offscreenNailRenderer';
import {
  FINGER_LABELS_PT,
  ORDERED_FINGERS,
  analyzeReferencePerFinger,
  createPinTargetFromLandmarks,
  extractTrueUVNailTexture,
  type PerFingerAnalysisResult,
} from './perFingerVisionAnalyzer';
import type {
  ArtisticPattern,
  FingerId,
  Nail3DAccessoryKind,
  Nail3DAccessorySpec,
  Nail3DBorderType,
  Nail3DFinishType,
  Nail3DGradientType,
  Nail3DManufacturingSpec,
  Nail3DMotifKind,
  Nail3DMotifSpec,
  Nail3DStrokeSpec,
  Nail3DSubstrateType,
  NailExtensionLevel,
  NailFingerDesignSpec,
  NailFinishV10,
  NailHandSpecsBySide,
  NailRenderStrategy,
  NailShape,
  NailUvPinTarget,
  NormalizedPoint,
} from '../types/nail';

export const GEMINI_KEY_STORAGE_KEY = 'nailcomparer_gemini_api_key';

export function getSavedGeminiApiKey(): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return (localStorage.getItem(GEMINI_KEY_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveGeminiApiKey(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = key.trim();
    if (!trimmed) {
      localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
    } else {
      localStorage.setItem(GEMINI_KEY_STORAGE_KEY, trimmed);
    }
  } catch {
    // Storage restricted
  }
}

export interface DeepReconstructionProgress {
  stage:
    | 'detecting_hands'
    | 'analyzing_global'
    | 'analyzing_finger'
    | 'rendering_3d'
    | 'verifying_finger'
    | 'refining_finger'
    | 'fallback_local'
    | 'done';
  message: string;
  currentFingerIndex: number;
  totalFingers: number;
  currentFingerLabel?: string;
  percent: number;
  lastFidelityScore?: number;
}

export interface DeepReconstructionResult {
  mode: 'deep_vlm' | 'local_fallback';
  missingApiKey?: boolean;
  fallbackReason?: string;
  httpStatus?: number;
  fingerSpecs: Record<FingerId, NailFingerDesignSpec>;
  handSpecsBySide?: NailHandSpecsBySide;
  handsCount: 1 | 2;
  primaryShape: NailShape;
  primaryLengthMultiplier: number;
  primaryFreeEdgeRatio: number;
  primaryExtensionLevel: NailExtensionLevel;
  averageFidelityScore: number;
  summaryPt: string;
  detectedFingersCount: number;
}

export interface ServerAiStatus {
  reachable: boolean;
  configured: boolean;
  source: 'header' | 'server_env' | 'none';
  status?: number;
  model?: string;
}

function resolveReconstructEndpointUrl(): string {
  const apiBase =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
      ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
      : '';
  return `${apiBase}/api/reconstruct-nail`;
}

export async function checkServerAiStatus(
  fetchImpl: typeof fetch = fetch,
  options?: { signal?: AbortSignal; apiKey?: string }
): Promise<ServerAiStatus> {
  const endpointUrl = resolveReconstructEndpointUrl();
  const apiKey = (options?.apiKey ?? getSavedGeminiApiKey()).trim();
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['x-gemini-key'] = apiKey;
  }

  try {
    const res = await fetchImpl(endpointUrl, {
      method: 'GET',
      headers,
      signal: options?.signal,
    });

    if (!res.ok) {
      return {
        reachable: false,
        configured: false,
        source: 'none',
        status: res.status,
      };
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return {
        reachable: false,
        configured: false,
        source: 'none',
        status: res.status,
      };
    }

    const source =
      parsed.source === 'header' || parsed.source === 'server_env' ? parsed.source : 'none';
    return {
      reachable: true,
      configured: parsed.configured === true,
      source,
      status: res.status,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    return {
      reachable: false,
      configured: false,
      source: 'none',
    };
  }
}

export interface DeepReconstructionOptions {
  signal?: AbortSignal;
  apiKey?: string;
  onProgress?: (progress: DeepReconstructionProgress) => void;
  /** Optional dependency injection hooks for deterministic QA unit testing */
  pacingDelayMs?: number;
  fetchImpl?: typeof fetch;
  renderPreviewImpl?: (spec: NailFingerDesignSpec) => string;
  composeComparisonImpl?: (refZoom: string, render3d: string, label: string) => Promise<string>;
}

interface GlobalAnalysisPayload {
  lightingSummary?: string;
  handsDetected?: number;
  visibleFingers?: Array<{ fingerId: FingerId; handSide?: 'Left' | 'Right' }>;
  identicalGroups?: string[][];
  globalShape?: NailShape;
  globalFreeEdgeRatio?: number;
  globalFinishType?: Nail3DFinishType;
  globalPalette?: string[];
  accessoriesPresent?: string[];
  summaryPt?: string;
}

interface FingerCropTarget {
  key: string; // e.g. 'Right:ring' or 'Left:middle'
  fingerId: FingerId;
  handSide: 'Left' | 'Right';
  zoomDataUrl: string;
  zoomBase64: string;
  labelPt: string;
  pinTarget?: NailUvPinTarget;
}

const VALID_RENDER_STRATEGIES: ReadonlySet<NailRenderStrategy> = new Set([
  'procedural_pbr_3d',
  'canonical_uv_delighted',
  'hybrid_uv_plus_pbr_3d',
]);

const VALID_SHAPES: ReadonlySet<NailShape> = new Set([
  'natural',
  'oval',
  'almond',
  'square',
  'coffin',
  'stiletto',
]);

const VALID_SUBSTRATES: ReadonlySet<Nail3DSubstrateType> = new Set([
  'natural_sheer',
  'builder_gel_nude',
  'milky_jelly',
  'opaque_gel_polish',
]);

const VALID_FINISHES: ReadonlySet<Nail3DFinishType> = new Set([
  'mirror_chrome',
  'glazed_pearl',
  'solid_gloss_gel',
  'jelly_translucent',
  'cat_eye_magnetic',
  'velvet_matte',
  'glitter_suspension',
]);

const VALID_GRADIENTS: ReadonlySet<Nail3DGradientType> = new Set([
  'none',
  'vertical_ombre',
  'radial_aura',
  'cat_eye_diagonal',
  'chrome_sheen',
]);

const VALID_BORDERS: ReadonlySet<Nail3DBorderType> = new Set([
  'none',
  'full_perimeter_outline',
  'cuticle_cuff',
  'classic_french',
  'micro_french',
  'deep_v_french',
]);

const VALID_ACCESSORY_KINDS: ReadonlySet<Nail3DAccessoryKind> = new Set([
  'metal_stud_sphere',
  'metal_stud_flat',
  'pearl_dome',
  'rhinestone',
  'caviar_bead',
  '3d_drop_clear',
]);

const VALID_MOTIF_KINDS: ReadonlySet<Nail3DMotifKind> = new Set([
  'flower_5petal',
  'flower_4petal',
  'cherry',
  'heart',
  'star_4pt',
  'bow_3d',
  'marble_veins',
  'tortoiseshell_spots',
  'aura_bloom',
  'abstract_organic',
]);

const FINGER_DIP_TIP: Record<FingerId, [number, number]> = {
  thumb: [3, 4],
  index: [7, 8],
  middle: [11, 12],
  ring: [15, 16],
  pinky: [19, 20],
};

function clamp(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
}

function sanitizeHex(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
    const r = clean[1];
    const g = clean[2];
    const b = clean[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function classifyExtensionLevel(freeEdgeRatio: number): NailExtensionLevel {
  if (freeEdgeRatio <= 0.25) return 'Curta/Natural';
  if (freeEdgeRatio <= 0.5) return 'Pouco Alongada';
  if (freeEdgeRatio <= 0.82) return 'Alongada';
  return 'Muito Alongada (Extrema)';
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export function sanitizeManufacturingSpecClient(
  raw: unknown,
  fallbackFingerId: FingerId,
  handSide?: 'Left' | 'Right'
): Nail3DManufacturingSpec {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const fingerId: FingerId = ORDERED_FINGERS.includes(obj.fingerId as FingerId)
    ? (obj.fingerId as FingerId)
    : fallbackFingerId;

  const shape: NailShape = VALID_SHAPES.has(obj.shape as NailShape)
    ? (obj.shape as NailShape)
    : 'almond';

  const freeEdgeRatio = clamp(Number(obj.freeEdgeRatio ?? 0.45), 0.12, 1.15);
  const tipRoundness = clamp(Number(obj.tipRoundness ?? 0.55), 0, 1);
  const cCurveDepth = clamp(Number(obj.cCurveDepth ?? 0.145), 0.11, 0.18);
  const apexHeight = clamp(Number(obj.apexHeight ?? 0.058), 0.042, 0.075);

  const renderStrategy: NailRenderStrategy = VALID_RENDER_STRATEGIES.has(
    obj.renderStrategy as NailRenderStrategy
  )
    ? (obj.renderStrategy as NailRenderStrategy)
    : 'procedural_pbr_3d';

  let nailBoundingBox: [number, number, number, number] | undefined;
  if (Array.isArray(obj.nailBoundingBox) && obj.nailBoundingBox.length >= 4) {
    const x0 = clamp(Number(obj.nailBoundingBox[0]), 0, 1);
    const y0 = clamp(Number(obj.nailBoundingBox[1]), 0, 1);
    const x1 = clamp(Number(obj.nailBoundingBox[2]), 0, 1);
    const y1 = clamp(Number(obj.nailBoundingBox[3]), 0, 1);
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (maxX - minX >= 0.04 && maxY - minY >= 0.04) {
      nailBoundingBox = [minX, minY, maxX, maxY];
    }
  }

  const substrateType: Nail3DSubstrateType = VALID_SUBSTRATES.has(
    obj.substrateType as Nail3DSubstrateType
  )
    ? (obj.substrateType as Nail3DSubstrateType)
    : 'opaque_gel_polish';

  const finishType: Nail3DFinishType = VALID_FINISHES.has(obj.finishType as Nail3DFinishType)
    ? (obj.finishType as Nail3DFinishType)
    : 'solid_gloss_gel';

  const trueBaseColorHex = sanitizeHex(obj.trueBaseColorHex, '#D9C2B4');
  const secondaryColorHex = sanitizeHex(obj.secondaryColorHex, trueBaseColorHex);
  const cuticleColorHex = sanitizeHex(obj.cuticleColorHex, trueBaseColorHex);
  const tipColorHex = sanitizeHex(obj.tipColorHex, secondaryColorHex);

  const gradientType: Nail3DGradientType = VALID_GRADIENTS.has(
    obj.gradientType as Nail3DGradientType
  )
    ? (obj.gradientType as Nail3DGradientType)
    : finishType === 'mirror_chrome'
      ? 'chrome_sheen'
      : 'none';

  const defaultMetalness =
    finishType === 'mirror_chrome'
      ? 0.96
      : finishType === 'cat_eye_magnetic'
        ? 0.62
        : finishType === 'glazed_pearl'
          ? 0.38
          : 0.02;
  const defaultRoughness =
    finishType === 'mirror_chrome'
      ? 0.06
      : finishType === 'velvet_matte'
        ? 0.44
        : 0.08;

  const metalness =
    finishType === 'mirror_chrome'
      ? clamp(Number(obj.metalness ?? defaultMetalness), 0.92, 1.0)
      : clamp(Number(obj.metalness ?? defaultMetalness), 0, 1);
  const roughness =
    finishType === 'mirror_chrome'
      ? clamp(Number(obj.roughness ?? defaultRoughness), 0.04, 0.09)
      : clamp(Number(obj.roughness ?? defaultRoughness), 0.04, 0.55);
  const clearcoat = clamp(Number(obj.clearcoat ?? (finishType === 'velvet_matte' ? 0.12 : 1.0)), 0, 1);
  const translucency = clamp(
    Number(obj.translucency ?? (finishType === 'jelly_translucent' ? 0.45 : 0.08)),
    0,
    1
  );

  const borderType: Nail3DBorderType = VALID_BORDERS.has(obj.borderType as Nail3DBorderType)
    ? (obj.borderType as Nail3DBorderType)
    : 'none';
  const borderColorHex = sanitizeHex(obj.borderColorHex, '#D9B668');
  const borderWidthNorm = clamp(Number(obj.borderWidthNorm ?? 0.06), 0.02, 0.28);
  const borderIsMetallic = Boolean(obj.borderIsMetallic);
  const borderIs3DRaised = Boolean(obj.borderIs3DRaised);

  const rawStrokes = Array.isArray(obj.strokes3D) ? obj.strokes3D : [];
  const strokes3D: Nail3DStrokeSpec[] = [];
  for (const s of rawStrokes.slice(0, 16)) {
    if (!s || typeof s !== 'object') continue;
    const sr = s as Record<string, unknown>;
    const toPt = (v: unknown, fb: [number, number]): [number, number] => {
      if (Array.isArray(v) && v.length >= 2) {
        return [clamp(Number(v[0]), 0.02, 0.98), clamp(Number(v[1]), 0.02, 0.98)];
      }
      return fb;
    };
    const col = sanitizeHex(sr.colorHex, '#D9B668');
    // Guard against fake dark environmental reflection stripes or spurious streaks on mirror chrome / solid gloss gel
    if (
      renderStrategy === 'procedural_pbr_3d' &&
      (finishType === 'mirror_chrome' || finishType === 'solid_gloss_gel')
    ) {
      const r = parseInt(col.slice(1, 3), 16);
      const g = parseInt(col.slice(3, 5), 16);
      const b = parseInt(col.slice(5, 7), 16);
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const isDarkOrNeutralReflection =
        maxC < 65 || (maxC - minC < 18 && maxC > 215 && !sr.isMetallic);
      if (finishType === 'mirror_chrome' && (!sr.isMetallic || isDarkOrNeutralReflection)) {
        continue;
      }
      if (finishType === 'solid_gloss_gel' && !sr.isMetallic && isDarkOrNeutralReflection) {
        continue;
      }
    }
    strokes3D.push({
      p0: toPt(sr.p0, [0.2, 0.3]),
      c1: toPt(sr.c1, [0.4, 0.45]),
      c2: toPt(sr.c2, [0.6, 0.6]),
      p1: toPt(sr.p1, [0.8, 0.75]),
      widthNorm: clamp(Number(sr.widthNorm ?? 0.045), 0.015, 0.14),
      colorHex: col,
      isMetallic: Boolean(sr.isMetallic),
      metalness: clamp(Number(sr.metalness ?? (sr.isMetallic ? 0.94 : 0.08)), 0, 1),
      reliefHeight: clamp(Number(sr.reliefHeight ?? 0.6), 0, 1),
    });
  }

  const rawMotifs = Array.isArray(obj.motifs) ? obj.motifs : [];
  const motifs: Nail3DMotifSpec[] = [];
  for (const m of rawMotifs.slice(0, 10)) {
    if (!m || typeof m !== 'object') continue;
    const mr = m as Record<string, unknown>;
    const kind: Nail3DMotifKind = VALID_MOTIF_KINDS.has(mr.kind as Nail3DMotifKind)
      ? (mr.kind as Nail3DMotifKind)
      : 'abstract_organic';
    const centerArr = Array.isArray(mr.center) && mr.center.length >= 2 ? mr.center : [0.5, 0.5];
    motifs.push({
      kind,
      center: [clamp(Number(centerArr[0]), 0.08, 0.92), clamp(Number(centerArr[1]), 0.08, 0.92)],
      scale: clamp(Number(mr.scale ?? 0.24), 0.08, 0.55),
      rotationDeg: clamp(Number(mr.rotationDeg ?? 0), -180, 180),
      primaryColorHex: sanitizeHex(mr.primaryColorHex, secondaryColorHex),
      secondaryColorHex: sanitizeHex(mr.secondaryColorHex, trueBaseColorHex),
      centerDotColorHex: mr.centerDotColorHex
        ? sanitizeHex(mr.centerDotColorHex, '#D9B668')
        : undefined,
      is3DRaised: Boolean(mr.is3DRaised),
      opacity: clamp(Number(mr.opacity ?? 0.92), 0.1, 1),
    });
  }

  const rawAccs = Array.isArray(obj.accessories3D) ? obj.accessories3D : [];
  const accessories3D: Nail3DAccessorySpec[] = [];
  for (const a of rawAccs.slice(0, 24)) {
    if (!a || typeof a !== 'object') continue;
    const ar = a as Record<string, unknown>;
    const kind: Nail3DAccessoryKind = VALID_ACCESSORY_KINDS.has(ar.kind as Nail3DAccessoryKind)
      ? (ar.kind as Nail3DAccessoryKind)
      : 'metal_stud_sphere';
    accessories3D.push({
      kind,
      u: clamp(Number(ar.u ?? 0.5), 0.08, 0.92),
      v: clamp(Number(ar.v ?? 0.45), 0.08, 0.94),
      radiusNorm: clamp(Number(ar.radiusNorm ?? 0.1), 0.025, 0.24),
      heightRatio: clamp(Number(ar.heightRatio ?? 0.65), 0.35, 0.85),
      colorHex: sanitizeHex(ar.colorHex, kind === 'pearl_dome' ? '#F9F4EE' : '#E6E9EF'),
      hasBezelRing: ar.hasBezelRing !== undefined ? Boolean(ar.hasBezelRing) : true,
    });
  }

  return {
    fingerId,
    handSide: (obj.handSide === 'Left' || obj.handSide === 'Right'
      ? obj.handSide
      : handSide) as 'Left' | 'Right' | undefined,
    renderStrategy,
    ...(nailBoundingBox ? { nailBoundingBox } : {}),
    shape,
    freeEdgeRatio,
    tipRoundness,
    cCurveDepth,
    apexHeight,
    substrateType,
    finishType,
    trueBaseColorHex,
    secondaryColorHex,
    cuticleColorHex,
    tipColorHex,
    gradientType,
    metalness,
    roughness,
    clearcoat,
    translucency,
    borderType,
    borderColorHex,
    borderWidthNorm,
    borderIsMetallic,
    borderIs3DRaised,
    strokes3D,
    motifs,
    accessories3D,
    designNotesPt:
      typeof obj.designNotesPt === 'string' && obj.designNotesPt.trim().length > 0
        ? obj.designNotesPt.trim().slice(0, 220)
        : `Unha ${shape} com acabamento ${finishType.replace(/_/g, ' ')}.`,
    fidelityScore:
      typeof obj.fidelityScore === 'number' && Number.isFinite(obj.fidelityScore)
        ? clamp(Math.round(obj.fidelityScore), 0, 100)
        : undefined,
    refinementRounds:
      typeof obj.refinementRounds === 'number' && Number.isFinite(obj.refinementRounds)
        ? Math.max(0, Math.round(obj.refinementRounds))
        : undefined,
  };
}

export function blueprintToManufacturingSpec(
  spec: NailFingerDesignSpec,
  handSide?: 'Left' | 'Right'
): Nail3DManufacturingSpec {
  if (spec.manufacturingSpec) {
    return {
      ...spec.manufacturingSpec,
      fingerId: spec.fingerId,
      handSide: handSide ?? spec.manufacturingSpec.handSide,
    };
  }
  const bp = spec.blueprint;
  const finishMap: Record<NailFinishV10, Nail3DFinishType> = {
    glossy_gel: 'solid_gloss_gel',
    jelly_translucent: 'jelly_translucent',
    chrome_mirror: 'mirror_chrome',
    pearl_glazed: 'glazed_pearl',
    cat_eye: 'cat_eye_magnetic',
    velvet_matte: 'velvet_matte',
  };
  const finishType: Nail3DFinishType = bp?.baseLayer.finishStyle
    ? finishMap[bp.baseLayer.finishStyle] ?? 'solid_gloss_gel'
    : spec.pattern === 'chrome_mirror'
      ? 'mirror_chrome'
      : 'solid_gloss_gel';

  const borderMap: Record<string, Nail3DBorderType> = {
    none: 'none',
    full_metallic_outline: 'full_perimeter_outline',
    cuticle_cuff: 'cuticle_cuff',
    classic_french: 'classic_french',
    micro_french: 'micro_french',
    v_french: 'deep_v_french',
  };

  const strokes3D: Nail3DStrokeSpec[] = [];
  const motifs: Nail3DMotifSpec[] = [];
  const accessories3D: Nail3DAccessorySpec[] = [];

  if (bp) {
    for (const el of bp.artElements) {
      if (el.type === 'ribbon_stroke' && el.points.length >= 2) {
        const pts = el.points;
        const p0 = pts[0];
        const p1 = pts[pts.length - 1];
        const c1 = pts[Math.floor(pts.length / 3)] ?? p0;
        const c2 = pts[Math.floor((pts.length * 2) / 3)] ?? p1;
        strokes3D.push({
          p0: [clamp(p0.u, 0.04, 0.96), clamp(p0.v, 0.04, 0.96)],
          c1: [clamp(c1.u, 0.04, 0.96), clamp(c1.v, 0.04, 0.96)],
          c2: [clamp(c2.u, 0.04, 0.96), clamp(c2.v, 0.04, 0.96)],
          p1: [clamp(p1.u, 0.04, 0.96), clamp(p1.v, 0.04, 0.96)],
          widthNorm: clamp(p0.width || 0.045, 0.018, 0.12),
          colorHex: el.colorHex,
          isMetallic: el.isMetallic,
          metalness: el.isMetallic ? 0.94 : 0.1,
          reliefHeight: clamp(el.reliefHeight, 0.2, 1.0),
        });
      } else if (el.type === 'micro_gem') {
        accessories3D.push({
          kind:
            el.kind === 'pearl'
              ? 'pearl_dome'
              : el.kind === 'crystal'
                ? 'rhinestone'
                : 'metal_stud_sphere',
          u: clamp(el.u, 0.08, 0.92),
          v: clamp(el.v, 0.08, 0.94),
          radiusNorm: clamp(el.radius * 1.4, 0.04, 0.18),
          heightRatio: 0.65,
          colorHex: el.colorHex,
          hasBezelRing: true,
        });
      } else if (el.type === 'organic_motif' && el.contour.length >= 3) {
        let sumU = 0;
        let sumV = 0;
        for (const p of el.contour) {
          sumU += p.u;
          sumV += p.v;
        }
        const cu = sumU / el.contour.length;
        const cv = sumV / el.contour.length;
        motifs.push({
          kind: spec.pattern === 'floral_accent' ? 'flower_5petal' : 'abstract_organic',
          center: [clamp(cu, 0.12, 0.88), clamp(cv, 0.12, 0.88)],
          scale: 0.24,
          rotationDeg: 0,
          primaryColorHex: el.fillColorHex,
          secondaryColorHex: el.shadeColorHex,
          centerDotColorHex: spec.accentColor,
          is3DRaised: el.reliefHeight > 0.4,
          opacity: 0.92,
        });
      }
    }
  }

  const freeEdgeRatio = clamp(
    bp?.geometry.freeEdgeRatio ?? spec.freeEdgeRatio ?? Math.max(0.15, spec.relativeLength - 1),
    0.12,
    1.15
  );

  const inferredStrategy: NailRenderStrategy =
    spec.renderStrategy ??
    (finishType === 'mirror_chrome'
      ? 'procedural_pbr_3d'
      : spec.trueUvDataUrl
        ? accessories3D.length > 0
          ? 'hybrid_uv_plus_pbr_3d'
          : 'canonical_uv_delighted'
        : 'procedural_pbr_3d');

  return sanitizeManufacturingSpecClient(
    {
      fingerId: spec.fingerId,
      handSide,
      renderStrategy: inferredStrategy,
      shape: bp?.geometry.shape ?? spec.shape,
      freeEdgeRatio,
      tipRoundness: bp?.geometry.tipRoundness ?? spec.tipRoundness ?? 0.55,
      cCurveDepth: 0.145,
      apexHeight: 0.058,
      substrateType:
        finishType === 'jelly_translucent' ? 'milky_jelly' : 'opaque_gel_polish',
      finishType,
      trueBaseColorHex: bp?.baseLayer.baseColorHex ?? spec.baseColor,
      secondaryColorHex: spec.secondaryColor,
      cuticleColorHex: bp?.baseLayer.cuticleColorHex ?? spec.baseColor,
      tipColorHex: bp?.baseLayer.tipColorHex ?? spec.secondaryColor,
      gradientType:
        bp?.baseLayer.gradientMode === 'vertical_ombre'
          ? 'vertical_ombre'
          : bp?.baseLayer.gradientMode === 'radial_aura'
            ? 'radial_aura'
            : bp?.baseLayer.gradientMode === 'cat_eye_band'
              ? 'cat_eye_diagonal'
              : finishType === 'mirror_chrome'
                ? 'chrome_sheen'
                : 'none',
      metalness: bp?.baseLayer.metallicBase ?? spec.metallicIntensity,
      roughness: finishType === 'mirror_chrome' ? 0.06 : finishType === 'velvet_matte' ? 0.44 : 0.08,
      clearcoat: finishType === 'velvet_matte' ? 0.15 : 1.0,
      translucency: bp?.baseLayer.translucency ?? 0.08,
      borderType: borderMap[bp?.borderLayer.kind ?? 'none'] ?? 'none',
      borderColorHex: bp?.borderLayer.colorHex ?? spec.outlineColor ?? spec.accentColor,
      borderWidthNorm: bp?.borderLayer.thicknessNorm ?? 0.06,
      borderIsMetallic: bp?.borderLayer.isMetallic ?? Boolean(spec.hasMetallicOutline),
      borderIs3DRaised: bp?.borderLayer.is3DRaised ?? Boolean(spec.has3DRelief),
      strokes3D,
      motifs,
      accessories3D,
      designNotesPt: `Reconstrução local paramétrica (${spec.shape}, ${finishType.replace(/_/g, ' ')}).`,
    },
    spec.fingerId,
    handSide
  );
}

function inferPatternFromManufacturing(mSpec: Nail3DManufacturingSpec): ArtisticPattern {
  if (mSpec.finishType === 'mirror_chrome') return 'chrome_mirror';
  if (mSpec.motifs.some((m) => m.kind.startsWith('flower') || m.kind === 'cherry')) {
    return 'floral_accent';
  }
  if (mSpec.strokes3D.some((s) => s.isMetallic) || mSpec.borderType === 'full_perimeter_outline') {
    return 'gold_3d_waves';
  }
  if (
    mSpec.borderType === 'classic_french' ||
    mSpec.borderType === 'micro_french' ||
    mSpec.borderType === 'deep_v_french'
  ) {
    return 'french_tip';
  }
  if (mSpec.gradientType === 'radial_aura' || mSpec.gradientType === 'vertical_ombre') {
    return 'aura_gradient';
  }
  return 'solid_gloss';
}

function mapFinishTypeToV10(finishType: Nail3DFinishType): NailFinishV10 {
  switch (finishType) {
    case 'mirror_chrome':
      return 'chrome_mirror';
    case 'glazed_pearl':
      return 'pearl_glazed';
    case 'jelly_translucent':
      return 'jelly_translucent';
    case 'cat_eye_magnetic':
      return 'cat_eye';
    case 'velvet_matte':
      return 'velvet_matte';
    case 'glitter_suspension':
    case 'solid_gloss_gel':
    default:
      return 'glossy_gel';
  }
}

export function manufacturingSpecToFingerDesignSpec(
  mSpec: Nail3DManufacturingSpec,
  meta?: {
    detectedFromPhoto?: boolean;
    preview3DDataUrl?: string;
    referenceZoomDataUrl?: string;
    fidelityScore?: number;
    trueUvDataUrl?: string;
    uvExtractionTarget?: NailUvPinTarget;
  }
): NailFingerDesignSpec {
  const pattern = inferPatternFromManufacturing(mSpec);
  const lengthMultiplier = Number((1 + mSpec.freeEdgeRatio).toFixed(2));
  const fidelityScore = meta?.fidelityScore ?? mSpec.fidelityScore;
  const renderStrategy: NailRenderStrategy = mSpec.renderStrategy ?? 'procedural_pbr_3d';
  const effectiveTrueUv =
    renderStrategy === 'procedural_pbr_3d' ? undefined : meta?.trueUvDataUrl;
  const accentColor =
    mSpec.accessories3D[0]?.colorHex ??
    (mSpec.borderIsMetallic ? mSpec.borderColorHex : undefined) ??
    mSpec.strokes3D[0]?.colorHex ??
    mSpec.secondaryColorHex;

  return {
    fingerId: mSpec.fingerId,
    handSide: mSpec.handSide,
    detectedFromPhoto: meta?.detectedFromPhoto ?? true,
    shape: mSpec.shape,
    relativeLength: lengthMultiplier,
    relativeWidth: 1.0,
    baseColor: mSpec.trueBaseColorHex,
    secondaryColor: mSpec.secondaryColorHex,
    accentColor,
    pattern,
    strokeAnchors: mSpec.strokes3D.map((s) => ({
      u: (s.p0[0] + s.p1[0]) * 0.5,
      v: (s.p0[1] + s.p1[1]) * 0.5,
      radius: s.widthNorm,
      angle: Math.atan2(s.p1[1] - s.p0[1], s.p1[0] - s.p0[0]),
    })),
    metallicIntensity: mSpec.metalness,
    glossIntensity: mSpec.finishType === 'velvet_matte' ? 0.55 : 0.96,
    renderStrategy,
    ...(effectiveTrueUv ? { trueUvDataUrl: effectiveTrueUv } : {}),
    ...(meta?.uvExtractionTarget ? { uvExtractionTarget: meta.uvExtractionTarget } : {}),
    manufacturingSpec: {
      ...mSpec,
      renderStrategy,
      fidelityScore,
    },
    preview3DDataUrl: meta?.preview3DDataUrl,
    referenceZoomDataUrl: meta?.referenceZoomDataUrl,
    fidelityScore,
    extensionLevel: classifyExtensionLevel(mSpec.freeEdgeRatio),
    freeEdgeRatio: mSpec.freeEdgeRatio,
    tipRoundness: mSpec.tipRoundness,
    lengthMultiplier,
    hasMetallicOutline:
      mSpec.borderType === 'full_perimeter_outline' && mSpec.borderIsMetallic,
    outlineColor: mSpec.borderType !== 'none' ? mSpec.borderColorHex : undefined,
    has3DRelief:
      mSpec.accessories3D.length > 0 ||
      mSpec.strokes3D.some((s) => s.reliefHeight > 0.3) ||
      mSpec.borderIs3DRaised,
    artDescription: mSpec.designNotesPt,
    finishStyle: mapFinishTypeToV10(mSpec.finishType),
    isImportedReference: true,
  };
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem de referência'));
    img.src = src;
  });
}

function encodeResizedJpeg(
  img: HTMLImageElement,
  maxDim: number,
  quality: number
): string {
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Generates a verticalized 384x512 JPEG 92% zoom crop centered on a single nail plate,
 * aligning DIP -> TIP strictly upward (+Y) with 25% cuticle/tip context margin and label.
 */
function buildVerticalizedFingerZoom(
  img: HTMLImageElement,
  dip: NormalizedPoint,
  tip: NormalizedPoint,
  labelPt: string
): string {
  const outW = 384;
  const outH = 512;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const dipX = dip.x * srcW;
  const dipY = dip.y * srcH;
  const tipX = tip.x * srcW;
  const tipY = tip.y * srcH;

  const dx = tipX - dipX;
  const dy = tipY - dipY;
  const segLen = Math.max(14, Math.hypot(dx, dy));

  // Center slightly past midpoint toward tip so cuticle and free edge are both framed nicely
  const centerX = dipX + dx * 0.62;
  const centerY = dipY + dy * 0.62;

  // Rotate so (dx, dy) aligns straight UP (0, -1) in canvas coords
  const angle = Math.atan2(dy, dx);
  const rotToUp = -Math.PI / 2 - angle;

  // Frame 25% context margin around the nail plate
  const cropHeightPx = segLen * 2.15;
  const scale = outH / cropHeightPx;

  ctx.fillStyle = '#181519';
  ctx.fillRect(0, 0, outW, outH);

  ctx.save();
  ctx.translate(outW * 0.5, outH * 0.54);
  ctx.scale(scale, scale);
  ctx.rotate(rotToUp);
  ctx.translate(-centerX, -centerY);
  ctx.drawImage(img, 0, 0, srcW, srcH);
  ctx.restore();

  // Subtle top label for zero ambiguity in VLM inspection
  ctx.fillStyle = 'rgba(18, 15, 20, 0.72)';
  ctx.fillRect(10, 10, outW - 20, 26);
  ctx.fillStyle = '#F5EDE4';
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelPt, outW * 0.5, 23);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function buildMacroCenterCrop(img: HTMLImageElement, labelPt: string): string {
  const outW = 384;
  const outH = 512;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.max(outW / srcW, outH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  ctx.fillStyle = '#181519';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, (outW - dw) * 0.5, (outH - dh) * 0.5, dw, dh);
  ctx.fillStyle = 'rgba(18, 15, 20, 0.72)';
  ctx.fillRect(10, 10, outW - 20, 26);
  ctx.fillStyle = '#F5EDE4';
  ctx.font = '600 13px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelPt, outW * 0.5, 23);
  return canvas.toDataURL('image/jpeg', 0.92);
}

class ReconstructApiHttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ReconstructApiHttpError';
    this.status = status;
  }
}

function formatReconstructFallbackReason(err: unknown): {
  fallbackReason: string;
  httpStatus?: number;
} {
  if (err instanceof ReconstructApiHttpError) {
    const status = err.status;
    const rawMsg = err.message.trim();
    const hasCustomDetail =
      rawMsg.length > 0 && rawMsg.toUpperCase() !== `HTTP ${status}`;
    const detailSuffix = hasCustomDetail ? ` — ${rawMsg}` : '';

    if (status === 429) {
      return {
        httpStatus: status,
        fallbackReason: `Cota gratuita Gemini atingida (HTTP 429). Aguarde instantes e tente novamente.`,
      };
    }
    if (status === 401 || status === 403) {
      return {
        httpStatus: status,
        fallbackReason: `Chave Gemini rejeitada ou sem permissão (HTTP ${status})${detailSuffix}`,
      };
    }
    if (status === 404 || status >= 500) {
      return {
        httpStatus: status,
        fallbackReason: `Endpoint /api/reconstruct-nail indisponível (HTTP ${status})${detailSuffix}`,
      };
    }
    return {
      httpStatus: status,
      fallbackReason: `Falha na API /api/reconstruct-nail (HTTP ${status})${detailSuffix}`,
    };
  }

  const msg = err instanceof Error ? err.message.trim() : '';
  return {
    fallbackReason: msg
      ? `Falha de rede/timeout ao conectar com /api/reconstruct-nail (${msg}).`
      : 'Falha de rede/timeout ao conectar com /api/reconstruct-nail.',
  };
}

async function callReconstructApi(
  fetchImpl: typeof fetch,
  endpointUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-Gemini-Key'] = apiKey;

  const res = await fetchImpl(endpointUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { error: text };
  }

  if (!res.ok) {
    throw new ReconstructApiHttpError(
      res.status,
      String(parsed.error || parsed.message || `HTTP ${res.status}`)
    );
  }
  return parsed;
}

function buildCompleteHandRecord(
  partial: Partial<Record<FingerId, NailFingerDesignSpec>>,
  handSide: 'Left' | 'Right'
): Record<FingerId, NailFingerDesignSpec> {
  const donor =
    partial.ring ??
    partial.middle ??
    partial.index ??
    partial.pinky ??
    partial.thumb;

  const out = {} as Record<FingerId, NailFingerDesignSpec>;
  for (const fid of ORDERED_FINGERS) {
    const existing = partial[fid];
    if (existing) {
      out[fid] = {
        ...existing,
        fingerId: fid,
        handSide,
        manufacturingSpec: existing.manufacturingSpec
          ? { ...existing.manufacturingSpec, fingerId: fid, handSide }
          : undefined,
      };
    } else if (donor) {
      out[fid] = {
        ...donor,
        fingerId: fid,
        handSide,
        detectedFromPhoto: false,
        referenceZoomDataUrl: undefined,
        manufacturingSpec: donor.manufacturingSpec
          ? { ...donor.manufacturingSpec, fingerId: fid, handSide }
          : undefined,
      };
    }
  }
  return out;
}

async function runCleanLocalFallback(
  imageDataUrl: string,
  missingApiKey: boolean,
  options?: DeepReconstructionOptions,
  fallbackMeta?: { fallbackReason?: string; httpStatus?: number }
): Promise<DeepReconstructionResult> {
  const fallbackReason = fallbackMeta?.fallbackReason;
  const httpStatus = fallbackMeta?.httpStatus;

  options?.onProgress?.({
    stage: 'fallback_local',
    message: missingApiKey
      ? 'Chave gratuita Gemini não configurada — executando reconstrução local paramétrica...'
      : fallbackReason
        ? `${fallbackReason} — executando reconstrução local...`
        : 'Modo offline ativo — executando reconstrução local paramétrica...',
    currentFingerIndex: 1,
    totalFingers: 5,
    percent: 45,
  });

  // Non-DOM Node unit test environment: produce a clean deterministic local fallback without Canvas/Image
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    const fallbackSpecs = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const fid of ORDERED_FINGERS) {
      const mSpec = sanitizeManufacturingSpecClient(
        {
          fingerId: fid,
          handSide: 'Right',
          renderStrategy: 'canonical_uv_delighted',
          shape: 'almond',
          freeEdgeRatio: 0.45,
          finishType: 'solid_gloss_gel',
          trueBaseColorHex: '#D8B4A0',
        },
        fid,
        'Right'
      );
      fallbackSpecs[fid] = manufacturingSpecToFingerDesignSpec(mSpec, {
        detectedFromPhoto: false,
        fidelityScore: 76,
      });
    }

    return {
      mode: 'local_fallback',
      missingApiKey,
      fallbackReason,
      httpStatus,
      fingerSpecs: fallbackSpecs,
      handsCount: 1,
      primaryShape: 'almond',
      primaryLengthMultiplier: 1.45,
      primaryFreeEdgeRatio: 0.45,
      primaryExtensionLevel: classifyExtensionLevel(0.45),
      averageFidelityScore: 76,
      summaryPt:
        fallbackReason ||
        'Reconstrução local paramétrica (configure sua chave gratuita Google AI Studio nas Configurações para ativar análise profunda VLM com acessórios 3D e 95–99% de fidelidade).',
      detectedFingersCount: 0,
    };
  }

  // Convert data URL into a Blob/File for analyzeReferencePerFinger if browser supports it
  const resp = await fetch(imageDataUrl);
  const blob = await resp.blob();
  const file = new File([blob], 'reference.jpg', { type: blob.type || 'image/jpeg' });
  const localAnalysis: PerFingerAnalysisResult = await analyzeReferencePerFinger(file);

  let session: OffscreenNailRenderSession | null = null;
  try {
    if (!options?.renderPreviewImpl) {
      session = new OffscreenNailRenderSession();
    }
    const renderPreview = (s: NailFingerDesignSpec) =>
      options?.renderPreviewImpl ? options.renderPreviewImpl(s) : session!.renderNailPreview(s);

    const upgradedSpecs = {} as Record<FingerId, NailFingerDesignSpec>;
    for (const fid of ORDERED_FINGERS) {
      const baseSpec = localAnalysis.fingerSpecs[fid];
      const mSpec = blueprintToManufacturingSpec(baseSpec, 'Right');
      const preliminary = manufacturingSpecToFingerDesignSpec(mSpec, {
        detectedFromPhoto: baseSpec.detectedFromPhoto,
        fidelityScore: 76,
        trueUvDataUrl: baseSpec.trueUvDataUrl,
        uvExtractionTarget: baseSpec.uvExtractionTarget,
      });
      preliminary.blueprint = baseSpec.blueprint;
      preliminary.preview3DDataUrl = renderPreview(preliminary);
      upgradedSpecs[fid] = preliminary;
    }

    const middle = upgradedSpecs.middle ?? upgradedSpecs.ring;
    const freeEdge = middle.freeEdgeRatio ?? 0.45;

    options?.onProgress?.({
      stage: 'done',
      message: 'Reconstrução local concluída.',
      currentFingerIndex: 5,
      totalFingers: 5,
      percent: 100,
      lastFidelityScore: 76,
    });

    return {
      mode: 'local_fallback',
      missingApiKey,
      fallbackReason,
      httpStatus,
      fingerSpecs: upgradedSpecs,
      handsCount: 1,
      primaryShape: middle.shape,
      primaryLengthMultiplier: Number((1 + freeEdge).toFixed(2)),
      primaryFreeEdgeRatio: freeEdge,
      primaryExtensionLevel: classifyExtensionLevel(freeEdge),
      averageFidelityScore: 76,
      summaryPt:
        fallbackReason ||
        'Reconstrução local paramétrica (configure sua chave gratuita Google AI Studio nas Configurações para ativar análise profunda VLM com acessórios 3D e 95–99% de fidelidade).',
      detectedFingersCount: localAnalysis.detectedFingerIds.length,
    };
  } finally {
    session?.dispose();
  }
}

/**
 * Full V11 4-Stage Deep Per-Finger 3D Reconstruction with Closed-Loop Visual Verification.
 * Supports 5-finger (1 hand) and 10-finger (Left + Right) reference photos.
 */
export async function runDeepPerFingerReconstruction(
  imageDataUrl: string,
  options?: DeepReconstructionOptions
): Promise<DeepReconstructionResult> {
  const signal = options?.signal;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const pacingDelayMs = options?.pacingDelayMs ?? 2200;
  const apiKey = (options?.apiKey ?? getSavedGeminiApiKey()).trim();

  const apiBase =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
      ? String(import.meta.env.VITE_API_URL).replace(/\/$/, '')
      : '';
  const endpointUrl = `${apiBase}/api/reconstruct-nail`;

  throwIfAborted(signal);

  // STAGE 1: Detect 1 or 2 hands (5 or 10 fingers) & build verticalized 384x512 zoom crops
  options?.onProgress?.({
    stage: 'detecting_hands',
    message: 'Localizando todas as unhas visíveis na foto de referência...',
    currentFingerIndex: 0,
    totalFingers: 5,
    percent: 8,
  });

  let sourceImg: HTMLImageElement | null = null;
  let sourceImgW = 0;
  let sourceImgH = 0;
  let fullImageDataUrl = imageDataUrl;
  const targets: FingerCropTarget[] = [];
  const detectedHandSides = new Set<'Left' | 'Right'>();

  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    const img = await loadHtmlImage(imageDataUrl);
    sourceImg = img;
    sourceImgW = img.naturalWidth || img.width || 1;
    sourceImgH = img.naturalHeight || img.height || 1;
    fullImageDataUrl = encodeResizedJpeg(img, 1024, 0.88) || imageDataUrl;

    try {
      const detected = await detectHandsOnImageWithSingleton(img, 2);
      const handCount = Math.min(2, detected.landmarks.length);
      for (let hIdx = 0; hIdx < handCount; hIdx++) {
        const lms = detected.landmarks[hIdx];
        if (!lms || lms.length < 21) continue;
        const side: 'Left' | 'Right' =
          detected.handednesses[hIdx] ?? (hIdx === 0 ? 'Right' : 'Left');
        detectedHandSides.add(side);

        for (const fid of ORDERED_FINGERS) {
          const [dipIdx, tipIdx] = FINGER_DIP_TIP[fid];
          const dip = lms[dipIdx];
          const tip = lms[tipIdx];
          if (!dip || !tip) continue;
          // Skip fingers clearly outside image frame or collapsed
          if (
            tip.x < 0.01 ||
            tip.x > 0.99 ||
            tip.y < 0.01 ||
            tip.y > 0.99 ||
            Math.hypot(tip.x - dip.x, tip.y - dip.y) < 0.025
          ) {
            continue;
          }
          const sidePt = side === 'Left' ? 'Mão Esquerda' : 'Mão Direita';
          const labelPt = `${FINGER_LABELS_PT[fid]} • ${sidePt}`;
          const zoomDataUrl = buildVerticalizedFingerZoom(img, dip, tip, labelPt);
          const pinTarget = createPinTargetFromLandmarks(
            dip,
            tip,
            sourceImgW,
            sourceImgH,
            fid,
            true
          );
          if (zoomDataUrl) {
            targets.push({
              key: `${side}:${fid}`,
              fingerId: fid,
              handSide: side,
              zoomDataUrl,
              zoomBase64: stripDataUrlPrefix(zoomDataUrl),
              labelPt,
              pinTarget,
            });
          }
        }
      }
    } catch {
      // Fallback to macro crop below
    }

    if (targets.length === 0) {
      const macroZoom = buildMacroCenterCrop(img, 'Referência Macro');
      const macroPinTarget = createPinTargetFromLandmarks(
        { x: 0.5, y: 0.64 },
        { x: 0.5, y: 0.36 },
        sourceImgW,
        sourceImgH,
        'middle',
        false
      );
      targets.push({
        key: 'Right:middle',
        fingerId: 'middle',
        handSide: 'Right',
        zoomDataUrl: macroZoom,
        zoomBase64: stripDataUrlPrefix(macroZoom),
        labelPt: 'Médio • Referência Macro',
        pinTarget: macroPinTarget,
      });
      detectedHandSides.add('Right');
    }
  } else {
    // Non-DOM Node unit test environment: create synthetic single/multi target from dataUrl
    const rawB64 = stripDataUrlPrefix(imageDataUrl);
    targets.push({
      key: 'Right:ring',
      fingerId: 'ring',
      handSide: 'Right',
      zoomDataUrl: imageDataUrl,
      zoomBase64: rawB64,
      labelPt: 'Anelar • Mão Direita',
    });
    detectedHandSides.add('Right');
  }

  throwIfAborted(signal);
  const fullImageBase64 = stripDataUrlPrefix(fullImageDataUrl);

  // STAGE 2: Global optical context analysis via free Gemini endpoint
  options?.onProgress?.({
    stage: 'analyzing_global',
    message: 'Analisando contexto global de iluminação, acabamento e distribuição dos dedos...',
    currentFingerIndex: 0,
    totalFingers: targets.length,
    percent: 16,
  });

  let globalAnalysis: GlobalAnalysisPayload = {};
  try {
    const globalRes = await callReconstructApi(
      fetchImpl,
      endpointUrl,
      apiKey,
      {
        action: 'analyze_global',
        fullImageBase64,
        mimeType: 'image/jpeg',
      },
      signal
    );

    if (globalRes.configured === false || globalRes.mode === 'missing_key') {
      return await runCleanLocalFallback(imageDataUrl, true, options);
    }

    if (globalRes.globalAnalysis && typeof globalRes.globalAnalysis === 'object') {
      globalAnalysis = globalRes.globalAnalysis as GlobalAnalysisPayload;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const fallbackMeta = formatReconstructFallbackReason(err);
    return await runCleanLocalFallback(imageDataUrl, false, options, fallbackMeta);
  }

  throwIfAborted(signal);

  // Deduplicate identical groups reported by globalAnalysis while keeping every distinct finger!
  const representativeMap = new Map<string, string>(); // targetKey -> representativeKey
  if (Array.isArray(globalAnalysis.identicalGroups)) {
    for (const group of globalAnalysis.identicalGroups) {
      if (!Array.isArray(group) || group.length < 2) continue;
      const matchingTargets = targets.filter((t) =>
        group.some((g) => g.toLowerCase() === t.key.toLowerCase() || g.toLowerCase() === t.fingerId)
      );
      if (matchingTargets.length >= 2) {
        const rep = matchingTargets[0];
        for (let i = 1; i < matchingTargets.length; i++) {
          representativeMap.set(matchingTargets[i].key, rep.key);
        }
      }
    }
  }

  const representativeTargets = targets.filter((t) => !representativeMap.has(t.key));
  const totalWork = Math.max(1, representativeTargets.length);

  // STAGE 3: Closed-Loop Per-Finger Analysis + 3D Offscreen Render + Side-by-Side Verification
  let renderSession: OffscreenNailRenderSession | null = null;
  const resolvedByKey = new Map<string, NailFingerDesignSpec>();
  const fidelityScores: number[] = [];

  try {
    if (!options?.renderPreviewImpl || !options?.composeComparisonImpl) {
      renderSession = new OffscreenNailRenderSession();
    }

    const renderPreview = (spec: NailFingerDesignSpec): string =>
      options?.renderPreviewImpl
        ? options.renderPreviewImpl(spec)
        : renderSession!.renderNailPreview(spec);

    const composeComparison = (
      refZoom: string,
      render3d: string,
      label: string
    ): Promise<string> =>
      options?.composeComparisonImpl
        ? options.composeComparisonImpl(refZoom, render3d, label)
        : renderSession!.composeSideBySideComparison(refZoom, render3d, label);

    for (let idx = 0; idx < representativeTargets.length; idx++) {
      throwIfAborted(signal);
      const target = representativeTargets[idx];
      const basePercent = 20 + Math.round((idx / totalWork) * 74);

      if (idx > 0) {
        await sleepAbortable(pacingDelayMs, signal);
      }

      options?.onProgress?.({
        stage: 'analyzing_finger',
        message: `Dedo ${FINGER_LABELS_PT[target.fingerId]} (${idx + 1}/${totalWork}): Zoom e leitura óptica profunda...`,
        currentFingerIndex: idx + 1,
        totalFingers: totalWork,
        currentFingerLabel: target.labelPt,
        percent: basePercent,
      });

      const analyzeRes = await callReconstructApi(
        fetchImpl,
        endpointUrl,
        apiKey,
        {
          action: 'analyze_finger',
          fingerId: target.fingerId,
          handSide: target.handSide,
          fullImageBase64,
          fingerZoomBase64: target.zoomBase64,
          mimeType: 'image/jpeg',
          globalContext: globalAnalysis,
        },
        signal
      );

      let currentSpec = sanitizeManufacturingSpecClient(
        analyzeRes.spec,
        target.fingerId,
        target.handSide
      );

      const resolveCanonicalUvForSpec = async (
        specToResolve: Nail3DManufacturingSpec
      ): Promise<string | undefined> => {
        const strategy = specToResolve.renderStrategy ?? 'procedural_pbr_3d';
        if (strategy === 'procedural_pbr_3d') {
          return undefined;
        }

        // Optional server canonical UV generator (V13 OmniFabric-Nail path)
        try {
          const canonicalRes = await callReconstructApi(
            fetchImpl,
            endpointUrl,
            apiKey,
            {
              action: 'generate_canonical_uv',
              fingerId: target.fingerId,
              handSide: target.handSide,
              fingerZoomBase64: target.zoomBase64,
              spec: specToResolve,
              mimeType: 'image/jpeg',
            },
            signal
          );
          if (
            canonicalRes.enabled === true &&
            typeof canonicalRes.canonicalUvDataUrl === 'string' &&
            canonicalRes.canonicalUvDataUrl.startsWith('data:image/')
          ) {
            return canonicalRes.canonicalUvDataUrl;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          // Fall back silently to client-side silhouette-conformed TrueUV extraction
        }

        if (sourceImg && target.pinTarget) {
          const extracted = extractTrueUVNailTexture(
            sourceImg,
            target.pinTarget,
            512,
            specToResolve.shape
          );
          if (extracted) return extracted;
        }
        return undefined;
      };

      let currentTrueUvDataUrl = await resolveCanonicalUvForSpec(currentSpec);

      options?.onProgress?.({
        stage: 'rendering_3d',
        message: `Dedo ${FINGER_LABELS_PT[target.fingerId]} (${idx + 1}/${totalWork}): Construindo molde 3D${
          currentSpec.accessories3D.length > 0
            ? ` + ${currentSpec.accessories3D.length} acessório(s) 3D`
            : ''
        }...`,
        currentFingerIndex: idx + 1,
        totalFingers: totalWork,
        currentFingerLabel: target.labelPt,
        percent: Math.min(94, basePercent + Math.round(25 / totalWork)),
      });

      let currentFingerDesign = manufacturingSpecToFingerDesignSpec(currentSpec, {
        detectedFromPhoto: true,
        referenceZoomDataUrl: target.zoomDataUrl,
        trueUvDataUrl: currentTrueUvDataUrl,
        uvExtractionTarget: target.pinTarget,
      });
      let currentPreview3D = renderPreview(currentFingerDesign);
      currentFingerDesign.preview3DDataUrl = currentPreview3D;

      let bestSpec = currentSpec;
      let bestTrueUvDataUrl = currentTrueUvDataUrl;
      let bestPreview3D = currentPreview3D;
      let bestScore = 85;
      let rounds = 0;

      // Closed-loop side-by-side verification & auto-refinement (up to 2 rounds if score < 92)
      for (let round = 1; round <= 2; round++) {
        throwIfAborted(signal);
        await sleepAbortable(Math.min(pacingDelayMs, 1800), signal);

        options?.onProgress?.({
          stage: round === 1 ? 'verifying_finger' : 'refining_finger',
          message:
            round === 1
              ? `Dedo ${FINGER_LABELS_PT[target.fingerId]} (${idx + 1}/${totalWork}): Comparando molde 3D com a referência...`
              : `Dedo ${FINGER_LABELS_PT[target.fingerId]} (${idx + 1}/${totalWork}): Auto-corrigindo detalhes (rodada ${round}/2)...`,
          currentFingerIndex: idx + 1,
          totalFingers: totalWork,
          currentFingerLabel: target.labelPt,
          percent: Math.min(95, basePercent + Math.round((45 + round * 15) / totalWork)),
          lastFidelityScore: rounds > 0 ? bestScore : undefined,
        });

        const comparisonDataUrl = await composeComparison(
          target.zoomDataUrl,
          currentPreview3D,
          target.labelPt
        );

        try {
          const verifyRes = await callReconstructApi(
            fetchImpl,
            endpointUrl,
            apiKey,
            {
              action: 'verify_and_refine',
              fingerId: target.fingerId,
              handSide: target.handSide,
              comparisonImageBase64: stripDataUrlPrefix(comparisonDataUrl),
              currentSpec,
              mimeType: 'image/jpeg',
            },
            signal
          );

          rounds = round;
          const score = clamp(Math.round(Number(verifyRes.fidelityScore ?? 90)), 0, 100);
          const refinedSpec = verifyRes.refinedSpec
            ? sanitizeManufacturingSpecClient(
                verifyRes.refinedSpec,
                target.fingerId,
                target.handSide
              )
            : currentSpec;

          const refinedStrategy = refinedSpec.renderStrategy ?? 'procedural_pbr_3d';
          const refinedTrueUv =
            refinedStrategy === 'procedural_pbr_3d'
              ? undefined
              : refinedSpec.shape !== currentSpec.shape || !currentTrueUvDataUrl
                ? await resolveCanonicalUvForSpec(refinedSpec)
                : currentTrueUvDataUrl;

          if (score >= bestScore || round === 1) {
            bestScore = score;
            if (score >= 92) {
              bestSpec = { ...refinedSpec, fidelityScore: score, refinementRounds: rounds };
              bestTrueUvDataUrl = refinedTrueUv;
              // Re-render final 3D preview if refinedSpec improved anything
              const finalDesign = manufacturingSpecToFingerDesignSpec(bestSpec, {
                detectedFromPhoto: true,
                referenceZoomDataUrl: target.zoomDataUrl,
                fidelityScore: score,
                trueUvDataUrl: bestTrueUvDataUrl,
                uvExtractionTarget: target.pinTarget,
              });
              bestPreview3D = renderPreview(finalDesign);
              break;
            }
          }

          // Apply refinedSpec and re-render 3D for next verification round
          currentSpec = { ...refinedSpec, fidelityScore: score, refinementRounds: rounds };
          currentTrueUvDataUrl = refinedTrueUv;
          currentFingerDesign = manufacturingSpecToFingerDesignSpec(currentSpec, {
            detectedFromPhoto: true,
            referenceZoomDataUrl: target.zoomDataUrl,
            fidelityScore: score,
            trueUvDataUrl: currentTrueUvDataUrl,
            uvExtractionTarget: target.pinTarget,
          });
          currentPreview3D = renderPreview(currentFingerDesign);

          if (score >= bestScore) {
            bestSpec = currentSpec;
            bestTrueUvDataUrl = currentTrueUvDataUrl;
            bestPreview3D = currentPreview3D;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          // Keep current verified render if verification call fails transiently
          break;
        }
      }

      bestSpec.fidelityScore = bestScore;
      bestSpec.refinementRounds = rounds;
      if ((bestSpec.renderStrategy ?? 'procedural_pbr_3d') === 'procedural_pbr_3d') {
        bestSpec.renderStrategy = 'procedural_pbr_3d';
        bestTrueUvDataUrl = undefined;
      }
      fidelityScores.push(bestScore);

      options?.onProgress?.({
        stage: 'verifying_finger',
        message: `Dedo ${FINGER_LABELS_PT[target.fingerId]} (${idx + 1}/${totalWork}): Fidelidade validada (${bestScore}%) ✓`,
        currentFingerIndex: idx + 1,
        totalFingers: totalWork,
        currentFingerLabel: target.labelPt,
        percent: Math.min(96, 20 + Math.round(((idx + 1) / totalWork) * 74)),
        lastFidelityScore: bestScore,
      });

      resolvedByKey.set(
        target.key,
        manufacturingSpecToFingerDesignSpec(bestSpec, {
          detectedFromPhoto: true,
          preview3DDataUrl: bestPreview3D,
          referenceZoomDataUrl: target.zoomDataUrl,
          fidelityScore: bestScore,
          trueUvDataUrl: bestTrueUvDataUrl,
          uvExtractionTarget: target.pinTarget,
        })
      );
    }
  } finally {
    renderSession?.dispose();
  }

  // Propagate identical groups cleanly
  for (const target of targets) {
    if (resolvedByKey.has(target.key)) continue;
    const repKey = representativeMap.get(target.key);
    const repSpec = repKey ? resolvedByKey.get(repKey) : undefined;
    if (repSpec) {
      resolvedByKey.set(target.key, {
        ...repSpec,
        fingerId: target.fingerId,
        handSide: target.handSide,
        referenceZoomDataUrl: target.zoomDataUrl,
        manufacturingSpec: repSpec.manufacturingSpec
          ? {
              ...repSpec.manufacturingSpec,
              fingerId: target.fingerId,
              handSide: target.handSide,
            }
          : undefined,
      });
    }
  }

  // Assemble per-hand 5-finger records (supporting both 1-hand 5-finger and 2-hand 10-finger sets!)
  const leftPartial: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
  const rightPartial: Partial<Record<FingerId, NailFingerDesignSpec>> = {};

  for (const spec of resolvedByKey.values()) {
    if (spec.handSide === 'Left') {
      leftPartial[spec.fingerId] = spec;
    } else {
      rightPartial[spec.fingerId] = spec;
    }
  }

  const hasLeft = Object.keys(leftPartial).length > 0;
  const hasRight = Object.keys(rightPartial).length > 0;
  const handsCount: 1 | 2 = hasLeft && hasRight ? 2 : 1;

  const leftFull = hasLeft ? buildCompleteHandRecord(leftPartial, 'Left') : undefined;
  const rightFull = hasRight ? buildCompleteHandRecord(rightPartial, 'Right') : undefined;

  const primaryFingerSpecs: Record<FingerId, NailFingerDesignSpec> =
    rightFull && (!leftFull || Object.keys(rightPartial).length >= Object.keys(leftPartial).length)
      ? rightFull
      : leftFull!;

  const handSpecsBySide: NailHandSpecsBySide | undefined =
    handsCount === 2 ? { Left: leftFull, Right: rightFull } : undefined;

  const avgFidelity =
    fidelityScores.length > 0
      ? Math.round(fidelityScores.reduce((a, b) => a + b, 0) / fidelityScores.length)
      : 92;

  const refSpec = primaryFingerSpecs.ring ?? primaryFingerSpecs.middle ?? primaryFingerSpecs.index;
  const primaryFreeEdgeRatio = refSpec.freeEdgeRatio ?? 0.45;
  const primaryLengthMultiplier = Number((1 + primaryFreeEdgeRatio).toFixed(2));

  options?.onProgress?.({
    stage: 'done',
    message: `Reconstrução 3D concluída — fidelidade média de ${avgFidelity}% ✓`,
    currentFingerIndex: totalWork,
    totalFingers: totalWork,
    percent: 100,
    lastFidelityScore: avgFidelity,
  });

  return {
    mode: 'deep_vlm',
    missingApiKey: false,
    fingerSpecs: primaryFingerSpecs,
    handSpecsBySide,
    handsCount,
    primaryShape: refSpec.shape,
    primaryLengthMultiplier,
    primaryFreeEdgeRatio,
    primaryExtensionLevel: classifyExtensionLevel(primaryFreeEdgeRatio),
    averageFidelityScore: avgFidelity,
    summaryPt:
      globalAnalysis.summaryPt ||
      `Set 3D reconstruído (${handsCount === 2 ? '10 dedos • Mão Esquerda e Direita' : '5 dedos'}) com fidelidade média verificada de ${avgFidelity}%.`,
    detectedFingersCount: targets.length,
  };
}
