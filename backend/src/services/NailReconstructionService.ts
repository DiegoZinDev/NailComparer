import { BadRequestError, AppError } from './AppError.js';
import type {
  FingerId,
  HandSide,
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
  NailRenderStrategy,
  NailShape,
} from '../entities/NailDesign.js';

export interface GlobalFingerDesignSummary {
  fingerId: FingerId;
  handSide?: HandSide;
  sameAsFingerId?: FingerId;
  renderStrategy?: NailRenderStrategy;
  isAccentFinger: boolean;
  has3DAccessories: boolean;
  summaryPt: string;
}

export interface GlobalHandAnalysis {
  lightingEnvironment: {
    roomTemperature: 'warm' | 'neutral' | 'cool';
    specularReflectionsPresent: boolean;
    discountedReflectionNotesPt: string;
  };
  visibleHandsCount: 1 | 2;
  visibleFingersCount: number;
  handCountScope: 5 | 10;
  hasAccentFingers: boolean;
  hasLeftRightDifferences: boolean;
  identicalFingerGroups: FingerId[][];
  accentFingers: FingerId[];
  fingerSummaries: GlobalFingerDesignSummary[];
  predominantShape: NailShape;
  averageFreeEdgeRatio: number;
  predominantFinish: Nail3DFinishType;
  predominantRenderStrategy?: NailRenderStrategy;
  realHexPalette: string[];
  physicalAccessoriesPresent: Array<{
    kind: Nail3DAccessoryKind;
    approxCount: number;
    colorHex: string;
    fingers: FingerId[];
  }>;
  overallNotesPt: string;
}

export interface VerificationBreakdown {
  shape: number;
  material_color: number;
  art_details: number;
  accessories_3d: number;
}

export type ReconstructAction =
  | 'analyze_global'
  | 'analyze_finger'
  | 'verify_and_refine'
  | 'generate_canonical_uv';

export type ReconstructNailResponse =
  | {
      configured: false;
      mode: 'missing_key';
      message: string;
    }
  | {
      configured: true;
      action: 'analyze_global';
      modelUsed: string;
      globalAnalysis: GlobalHandAnalysis;
    }
  | {
      configured: true;
      action: 'analyze_finger';
      modelUsed: string;
      spec: Nail3DManufacturingSpec;
    }
  | {
      configured: true;
      action: 'verify_and_refine';
      modelUsed: string;
      fidelityScore: number;
      breakdown: VerificationBreakdown;
      discrepancies: string[];
      refinedSpec: Nail3DManufacturingSpec;
    }
  | {
      configured: true;
      enabled: false;
      mode: 'local_silhouette_uv';
      message: string;
    }
  | {
      configured: true;
      enabled: true;
      action: 'generate_canonical_uv';
      modelUsed: string;
      canonicalUvDataUrl: string;
    };

export interface GeminiExecutionContext {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  envApiKey?: string;
  enableGenerativeUvAtlas?: boolean;
}

const GEMINI_PRIMARY_MODEL = 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRY_DELAYS_MS = [1500, 3500, 7000] as const;
const GEMINI_REQUEST_TIMEOUT_MS = 22000;

const VALID_FINGERS: readonly FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const VALID_SHAPES: readonly NailShape[] = [
  'natural',
  'oval',
  'almond',
  'square',
  'coffin',
  'stiletto',
];
const VALID_ACCESSORY_KINDS: readonly Nail3DAccessoryKind[] = [
  'metal_stud_sphere',
  'metal_stud_flat',
  'pearl_dome',
  'rhinestone',
  'caviar_bead',
  '3d_drop_clear',
];
const VALID_MOTIF_KINDS: readonly Nail3DMotifKind[] = [
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
];
const VALID_SUBSTRATE_TYPES: readonly Nail3DSubstrateType[] = [
  'natural_sheer',
  'builder_gel_nude',
  'milky_jelly',
  'opaque_gel_polish',
];
const VALID_FINISH_TYPES: readonly Nail3DFinishType[] = [
  'mirror_chrome',
  'glazed_pearl',
  'solid_gloss_gel',
  'jelly_translucent',
  'cat_eye_magnetic',
  'velvet_matte',
  'glitter_suspension',
];
const VALID_GRADIENT_TYPES: readonly Nail3DGradientType[] = [
  'none',
  'vertical_ombre',
  'radial_aura',
  'cat_eye_diagonal',
  'chrome_sheen',
];
const VALID_BORDER_TYPES: readonly Nail3DBorderType[] = [
  'none',
  'full_perimeter_outline',
  'cuticle_cuff',
  'classic_french',
  'micro_french',
  'deep_v_french',
];
const VALID_RENDER_STRATEGIES: readonly NailRenderStrategy[] = [
  'procedural_pbr_3d',
  'canonical_uv_delighted',
  'hybrid_uv_plus_pbr_3d',
];

const MISSING_KEY_MESSAGE =
  'Configure sua chave gratuita do Google AI Studio (GEMINI_API_KEY) na Vercel ou nas Configurações do app.';

const HEX_SHORT_REGEX = /^#?([0-9A-Fa-f]{3})$/;
const HEX_FULL_REGEX = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return fallback;
}

export function normalizeHexColor(value: unknown, fallback = '#D4B483'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const shortMatch = HEX_SHORT_REGEX.exec(trimmed);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const fullMatch = HEX_FULL_REGEX.exec(trimmed);
  if (fullMatch) {
    return `#${fullMatch[1]}`.toUpperCase();
  }
  return fallback;
}

function sanitizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    const matched = allowed.find((item) => item.toLowerCase() === normalized);
    if (matched) return matched;
  }
  return fallback;
}

function sanitizeFingerId(value: unknown, fallback: FingerId = 'middle'): FingerId {
  return sanitizeEnum(value, VALID_FINGERS, fallback);
}

function sanitizeHandSide(value: unknown): HandSide | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'left' || trimmed === 'esquerda') return 'Left';
  if (trimmed === 'right' || trimmed === 'direita') return 'Right';
  return undefined;
}

function sanitizeShape(value: unknown, fallback: NailShape = 'almond'): NailShape {
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'ballerina' || lowered === 'bailarina') return 'coffin';
    if (lowered === 'amendoada') return 'almond';
    if (lowered === 'quadrada') return 'square';
    if (lowered === 'round' || lowered === 'redonda') return 'oval';
  }
  return sanitizeEnum(value, VALID_SHAPES, fallback);
}

function sanitizePointTuple(
  raw: unknown,
  fallback: [number, number]
): [number, number] {
  if (Array.isArray(raw) && raw.length >= 2) {
    return [
      clamp(toFiniteNumber(raw[0], fallback[0]), 0.02, 0.98),
      clamp(toFiniteNumber(raw[1], fallback[1]), 0.02, 0.98),
    ];
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    return [
      clamp(toFiniteNumber(obj.u ?? obj.x, fallback[0]), 0.02, 0.98),
      clamp(toFiniteNumber(obj.v ?? obj.y, fallback[1]), 0.02, 0.98),
    ];
  }
  return fallback;
}

function sanitizeAccessory(raw: unknown): Nail3DAccessorySpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const kind = sanitizeEnum(item.kind, VALID_ACCESSORY_KINDS, 'metal_stud_sphere');
  const defaultColor =
    kind === 'pearl_dome'
      ? '#F7F2EA'
      : kind === 'rhinestone' || kind === '3d_drop_clear'
        ? '#F4F8FF'
        : '#E6E9EF';

  return {
    kind,
    u: clamp(toFiniteNumber(item.u, 0.5), 0.08, 0.92),
    v: clamp(toFiniteNumber(item.v, 0.5), 0.08, 0.94),
    radiusNorm: clamp(toFiniteNumber(item.radiusNorm, 0.1), 0.025, 0.28),
    heightRatio: clamp(toFiniteNumber(item.heightRatio, 0.62), 0.35, 0.85),
    colorHex: normalizeHexColor(item.colorHex, defaultColor),
    hasBezelRing: toBoolean(item.hasBezelRing, kind !== '3d_drop_clear'),
  };
}

function sanitizeStroke(raw: unknown): Nail3DStrokeSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const isMetallic = toBoolean(item.isMetallic, false);
  return {
    p0: sanitizePointTuple(item.p0, [0.25, 0.35]),
    c1: sanitizePointTuple(item.c1, [0.4, 0.45]),
    c2: sanitizePointTuple(item.c2, [0.6, 0.55]),
    p1: sanitizePointTuple(item.p1, [0.75, 0.65]),
    widthNorm: clamp(toFiniteNumber(item.widthNorm, 0.04), 0.015, 0.14),
    colorHex: normalizeHexColor(item.colorHex, isMetallic ? '#D9B668' : '#FFFFFF'),
    isMetallic,
    metalness: clamp(toFiniteNumber(item.metalness, isMetallic ? 0.92 : 0.05), 0, 1),
    reliefHeight: clamp(toFiniteNumber(item.reliefHeight, isMetallic ? 0.65 : 0.25), 0, 1),
  };
}

function sanitizeMotif(raw: unknown): Nail3DMotifSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const center = sanitizePointTuple(item.center, [0.5, 0.5]);
  const kind = sanitizeEnum(item.kind, VALID_MOTIF_KINDS, 'abstract_organic');
  const centerDot =
    item.centerDotColorHex !== undefined && item.centerDotColorHex !== null
      ? normalizeHexColor(item.centerDotColorHex, '#F4D06F')
      : undefined;

  return {
    kind,
    center: [clamp(center[0], 0.1, 0.9), clamp(center[1], 0.1, 0.92)],
    scale: clamp(toFiniteNumber(item.scale, 0.22), 0.08, 0.55),
    rotationDeg: clamp(toFiniteNumber(item.rotationDeg, 0), -180, 180),
    primaryColorHex: normalizeHexColor(item.primaryColorHex, '#FFFFFF'),
    secondaryColorHex: normalizeHexColor(item.secondaryColorHex, '#E8C5B8'),
    ...(centerDot ? { centerDotColorHex: centerDot } : {}),
    is3DRaised: toBoolean(item.is3DRaised, false),
    opacity: clamp(toFiniteNumber(item.opacity, 0.95), 0.05, 1),
  };
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, '#D4B483').slice(1);
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToLabTuple(r: number, g: number, b: number): [number, number, number] {
  const srgbToLin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const rl = srgbToLin(r);
  const gl = srgbToLin(g);
  const bl = srgbToLin(b);

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaECieLab(hexA: string, hexB: string): number {
  const [r1, g1, b1] = hexToRgbTuple(hexA);
  const [r2, g2, b2] = hexToRgbTuple(hexB);
  const [l1, a1, b1Lab] = rgbToLabTuple(r1, g1, b1);
  const [l2, a2, b2Lab] = rgbToLabTuple(r2, g2, b2);
  return Math.hypot(l1 - l2, a1 - a2, b1Lab - b2Lab);
}

function sanitizeBoundingBox(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length < 4) return undefined;
  const x0 = clamp(toFiniteNumber(raw[0], NaN), 0, 1);
  const y0 = clamp(toFiniteNumber(raw[1], NaN), 0, 1);
  const x1 = clamp(toFiniteNumber(raw[2], NaN), 0, 1);
  const y1 = clamp(toFiniteNumber(raw[3], NaN), 0, 1);
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return undefined;
  }
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  if (maxX - minX < 0.04 || maxY - minY < 0.04) {
    return undefined;
  }
  return [
    Number(minX.toFixed(4)),
    Number(minY.toFixed(4)),
    Number(maxX.toFixed(4)),
    Number(maxY.toFixed(4)),
  ];
}

function isSpuriousReflectionStroke(
  stroke: Nail3DStrokeSpec,
  finishType: Nail3DFinishType,
  renderStrategy: NailRenderStrategy,
  trueBaseColorHex: string
): boolean {
  if (
    renderStrategy !== 'procedural_pbr_3d' ||
    (finishType !== 'mirror_chrome' && finishType !== 'solid_gloss_gel')
  ) {
    return false;
  }

  const [r, g, b] = hexToRgbTuple(stroke.colorHex);
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const chromaSpread = maxC - minC;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const contrastDeltaE = deltaECieLab(stroke.colorHex, trueBaseColorHex);

  const isDarkNonMetallic = !stroke.isMetallic && (luma < 0.30 || maxC < 78);
  const isNeutralGlare = !stroke.isMetallic && chromaSpread < 20 && luma > 0.84;
  const isLowContrastNonMetallic = !stroke.isMetallic && contrastDeltaE < 14;

  if (finishType === 'mirror_chrome') {
    if (!stroke.isMetallic && (isDarkNonMetallic || isNeutralGlare || isLowContrastNonMetallic)) {
      return true;
    }
    if (!stroke.isMetallic && stroke.metalness < 0.5 && contrastDeltaE < 22) {
      return true;
    }
    return false;
  }

  return isDarkNonMetallic || isLowContrastNonMetallic || (isNeutralGlare && contrastDeltaE < 18);
}

export function sanitizeManufacturingSpec(
  raw: unknown,
  fallbackContext?: {
    fingerId?: FingerId;
    handSide?: HandSide;
    fallbackSpec?: Partial<Nail3DManufacturingSpec>;
  }
): Nail3DManufacturingSpec {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const fb = fallbackContext?.fallbackSpec;

  const fingerId = sanitizeFingerId(
    obj.fingerId,
    fallbackContext?.fingerId ?? fb?.fingerId ?? 'middle'
  );
  const handSide =
    sanitizeHandSide(obj.handSide) ?? fallbackContext?.handSide ?? fb?.handSide;

  const finishType = sanitizeEnum(
    obj.finishType,
    VALID_FINISH_TYPES,
    fb?.finishType ?? 'solid_gloss_gel'
  );
  const isChrome = finishType === 'mirror_chrome';
  const isGlazed = finishType === 'glazed_pearl';
  const isVelvet = finishType === 'velvet_matte';
  const isJelly = finishType === 'jelly_translucent';

  const substrateType = sanitizeEnum(
    obj.substrateType,
    VALID_SUBSTRATE_TYPES,
    fb?.substrateType ?? (isJelly ? 'milky_jelly' : 'opaque_gel_polish')
  );

  const trueBaseColorHex = normalizeHexColor(
    obj.trueBaseColorHex,
    fb?.trueBaseColorHex ?? '#D4B483'
  );
  const secondaryColorHex = normalizeHexColor(
    obj.secondaryColorHex,
    fb?.secondaryColorHex ?? trueBaseColorHex
  );
  const cuticleColorHex = normalizeHexColor(
    obj.cuticleColorHex,
    fb?.cuticleColorHex ?? trueBaseColorHex
  );
  const tipColorHex = normalizeHexColor(
    obj.tipColorHex,
    fb?.tipColorHex ?? secondaryColorHex
  );

  const gradientType = sanitizeEnum(
    obj.gradientType,
    VALID_GRADIENT_TYPES,
    fb?.gradientType ?? (isChrome ? 'chrome_sheen' : 'none')
  );

  const borderType = sanitizeEnum(
    obj.borderType,
    VALID_BORDER_TYPES,
    fb?.borderType ?? 'none'
  );
  const borderColorHex = normalizeHexColor(
    obj.borderColorHex,
    fb?.borderColorHex ?? '#FFFFFF'
  );

  const rawMetalness = toFiniteNumber(
    obj.metalness,
    fb?.metalness ?? (isChrome ? 0.95 : isGlazed ? 0.35 : 0.04)
  );
  const rawRoughness = toFiniteNumber(
    obj.roughness,
    fb?.roughness ?? (isChrome ? 0.06 : isVelvet ? 0.44 : 0.12)
  );
  const rawClearcoat = toFiniteNumber(
    obj.clearcoat,
    fb?.clearcoat ?? (isVelvet ? 0.12 : 0.96)
  );
  const rawTranslucency = toFiniteNumber(
    obj.translucency,
    fb?.translucency ?? (isJelly ? 0.55 : isChrome ? 0.0 : 0.08)
  );

  const metalness = isChrome
    ? clamp(Math.max(0.92, rawMetalness), 0.92, 1)
    : clamp(rawMetalness, 0, 1);
  const roughness = isChrome
    ? clamp(Math.min(0.08, rawRoughness), 0.04, 0.08)
    : clamp(rawRoughness, 0.04, 0.55);

  const motifs = (
    Array.isArray(obj.motifs)
      ? obj.motifs.map(sanitizeMotif).filter((x): x is Nail3DMotifSpec => x !== null)
      : fb?.motifs
        ? fb.motifs.map(sanitizeMotif).filter((x): x is Nail3DMotifSpec => x !== null)
        : []
  ).slice(0, 12);

  const accessories3D = (
    Array.isArray(obj.accessories3D)
      ? obj.accessories3D
          .map(sanitizeAccessory)
          .filter((x): x is Nail3DAccessorySpec => x !== null)
      : fb?.accessories3D
        ? fb.accessories3D
            .map(sanitizeAccessory)
            .filter((x): x is Nail3DAccessorySpec => x !== null)
        : []
  ).slice(0, 24);

  const defaultStrategy: NailRenderStrategy =
    isChrome || isGlazed
      ? 'procedural_pbr_3d'
      : motifs.some(
            (m) =>
              m.kind === 'flower_5petal' ||
              m.kind === 'flower_4petal' ||
              m.kind === 'marble_veins' ||
              m.kind === 'tortoiseshell_spots' ||
              m.kind === 'abstract_organic'
          )
        ? accessories3D.length > 0
          ? 'hybrid_uv_plus_pbr_3d'
          : 'canonical_uv_delighted'
        : 'procedural_pbr_3d';

  const renderStrategy = sanitizeEnum(
    obj.renderStrategy,
    VALID_RENDER_STRATEGIES,
    fb?.renderStrategy ?? defaultStrategy
  );

  const nailBoundingBox =
    sanitizeBoundingBox(obj.nailBoundingBox) ??
    sanitizeBoundingBox(fb?.nailBoundingBox);

  const rawStrokes = Array.isArray(obj.strokes3D)
    ? obj.strokes3D.map(sanitizeStroke).filter((x): x is Nail3DStrokeSpec => x !== null)
    : fb?.strokes3D
      ? fb.strokes3D.map(sanitizeStroke).filter((x): x is Nail3DStrokeSpec => x !== null)
      : [];

  const strokes3D = rawStrokes
    .filter((stroke) => !isSpuriousReflectionStroke(stroke, finishType, renderStrategy, trueBaseColorHex))
    .slice(0, 16);

  const designNotesRaw =
    typeof obj.designNotesPt === 'string' && obj.designNotesPt.trim().length > 0
      ? obj.designNotesPt.trim()
      : fb?.designNotesPt ?? 'Unha reconstruída em 3D fiel à referência.';

  const sanitized: Nail3DManufacturingSpec = {
    fingerId,
    ...(handSide ? { handSide } : {}),
    renderStrategy,
    ...(nailBoundingBox ? { nailBoundingBox } : {}),
    shape: sanitizeShape(obj.shape, fb?.shape ?? 'almond'),
    freeEdgeRatio: clamp(toFiniteNumber(obj.freeEdgeRatio, fb?.freeEdgeRatio ?? 0.45), 0.12, 1.15),
    tipRoundness: clamp(toFiniteNumber(obj.tipRoundness, fb?.tipRoundness ?? 0.65), 0, 1),
    cCurveDepth: clamp(toFiniteNumber(obj.cCurveDepth, fb?.cCurveDepth ?? 0.145), 0.11, 0.18),
    apexHeight: clamp(toFiniteNumber(obj.apexHeight, fb?.apexHeight ?? 0.058), 0.042, 0.075),
    substrateType,
    finishType,
    trueBaseColorHex,
    secondaryColorHex,
    cuticleColorHex,
    tipColorHex,
    gradientType,
    metalness,
    roughness,
    clearcoat: clamp(rawClearcoat, 0, 1),
    translucency: clamp(rawTranslucency, 0, 1),
    borderType,
    borderColorHex,
    borderWidthNorm: clamp(
      toFiniteNumber(obj.borderWidthNorm, fb?.borderWidthNorm ?? (borderType === 'none' ? 0 : 0.08)),
      0,
      0.35
    ),
    borderIsMetallic: toBoolean(obj.borderIsMetallic, fb?.borderIsMetallic ?? false),
    borderIs3DRaised: toBoolean(obj.borderIs3DRaised, fb?.borderIs3DRaised ?? false),
    strokes3D,
    motifs,
    accessories3D,
    designNotesPt: designNotesRaw.slice(0, 320),
  };

  if (obj.fidelityScore !== undefined || fb?.fidelityScore !== undefined) {
    sanitized.fidelityScore = Math.round(
      clamp(toFiniteNumber(obj.fidelityScore, fb?.fidelityScore ?? 90), 0, 100)
    );
  }
  if (obj.refinementRounds !== undefined || fb?.refinementRounds !== undefined) {
    sanitized.refinementRounds = Math.round(
      clamp(toFiniteNumber(obj.refinementRounds, fb?.refinementRounds ?? 0), 0, 10)
    );
  }

  return sanitized;
}

export function sanitizeGlobalAnalysis(raw: unknown): GlobalHandAnalysis {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const lightRaw =
    obj.lightingEnvironment && typeof obj.lightingEnvironment === 'object'
      ? (obj.lightingEnvironment as Record<string, unknown>)
      : {};

  const roomTemperature = sanitizeEnum(
    lightRaw.roomTemperature,
    ['warm', 'neutral', 'cool'] as const,
    'neutral'
  );

  const visibleFingersCount = Math.round(
    clamp(toFiniteNumber(obj.visibleFingersCount, 5), 1, 10)
  );
  const rawHandsCount = toFiniteNumber(
    obj.visibleHandsCount,
    visibleFingersCount > 5 ? 2 : 1
  );
  const visibleHandsCount: 1 | 2 = rawHandsCount >= 2 ? 2 : 1;
  const handCountScope: 5 | 10 =
    toFiniteNumber(obj.handCountScope, visibleHandsCount === 2 || visibleFingersCount > 5 ? 10 : 5) >= 10
      ? 10
      : 5;

  const identicalFingerGroups: FingerId[][] = Array.isArray(obj.identicalFingerGroups)
    ? obj.identicalFingerGroups
        .filter((grp): grp is unknown[] => Array.isArray(grp) && grp.length > 0)
        .map((grp) =>
          Array.from(new Set(grp.map((f) => sanitizeFingerId(f, 'middle'))))
        )
        .slice(0, 5)
    : [['thumb', 'index', 'middle', 'ring', 'pinky']];

  const accentFingers: FingerId[] = Array.isArray(obj.accentFingers)
    ? Array.from(new Set(obj.accentFingers.map((f) => sanitizeFingerId(f, 'ring'))))
    : [];

  const fingerSummaries: GlobalFingerDesignSummary[] = Array.isArray(obj.fingerSummaries)
    ? obj.fingerSummaries
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
        .slice(0, 10)
        .map((s) => {
          const handSide = sanitizeHandSide(s.handSide);
          const sameAs =
            s.sameAsFingerId !== undefined && s.sameAsFingerId !== null
              ? sanitizeFingerId(s.sameAsFingerId, 'middle')
              : undefined;
          const fingerStrategy =
            typeof s.renderStrategy === 'string'
              ? sanitizeEnum(s.renderStrategy, VALID_RENDER_STRATEGIES, 'procedural_pbr_3d')
              : undefined;
          return {
            fingerId: sanitizeFingerId(s.fingerId, 'middle'),
            ...(handSide ? { handSide } : {}),
            ...(sameAs ? { sameAsFingerId: sameAs } : {}),
            ...(fingerStrategy ? { renderStrategy: fingerStrategy } : {}),
            isAccentFinger: toBoolean(s.isAccentFinger, false),
            has3DAccessories: toBoolean(s.has3DAccessories, false),
            summaryPt:
              typeof s.summaryPt === 'string' && s.summaryPt.trim()
                ? s.summaryPt.trim().slice(0, 180)
                : 'Design consistente com a mão.',
          };
        })
    : [];

  const realHexPalette: string[] = Array.isArray(obj.realHexPalette)
    ? Array.from(
        new Set(
          obj.realHexPalette
            .map((c) => normalizeHexColor(c, ''))
            .filter((c) => c.length === 7)
        )
      ).slice(0, 8)
    : ['#D4B483'];

  if (realHexPalette.length === 0) {
    realHexPalette.push('#D4B483');
  }

  const physicalAccessoriesPresent = Array.isArray(obj.physicalAccessoriesPresent)
    ? obj.physicalAccessoriesPresent
        .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
        .slice(0, 12)
        .map((a) => ({
          kind: sanitizeEnum(a.kind, VALID_ACCESSORY_KINDS, 'metal_stud_sphere'),
          approxCount: Math.round(clamp(toFiniteNumber(a.approxCount, 1), 1, 50)),
          colorHex: normalizeHexColor(a.colorHex, '#E6E9EF'),
          fingers: Array.isArray(a.fingers)
            ? Array.from(new Set(a.fingers.map((f) => sanitizeFingerId(f, 'middle'))))
            : (['middle'] as FingerId[]),
        }))
    : [];

  const predominantFinish = sanitizeEnum(
    obj.predominantFinish,
    VALID_FINISH_TYPES,
    'solid_gloss_gel'
  );
  const predominantRenderStrategy = sanitizeEnum(
    obj.predominantRenderStrategy,
    VALID_RENDER_STRATEGIES,
    'procedural_pbr_3d'
  );

  return {
    lightingEnvironment: {
      roomTemperature,
      specularReflectionsPresent: toBoolean(lightRaw.specularReflectionsPresent, false),
      discountedReflectionNotesPt:
        typeof lightRaw.discountedReflectionNotesPt === 'string' &&
        lightRaw.discountedReflectionNotesPt.trim()
          ? lightRaw.discountedReflectionNotesPt.trim().slice(0, 260)
          : 'Iluminação analisada com desconto de reflexos especulares.',
    },
    visibleHandsCount,
    visibleFingersCount,
    handCountScope,
    hasAccentFingers: toBoolean(obj.hasAccentFingers, accentFingers.length > 0),
    hasLeftRightDifferences: toBoolean(obj.hasLeftRightDifferences, false),
    identicalFingerGroups,
    accentFingers,
    fingerSummaries,
    predominantShape: sanitizeShape(obj.predominantShape, 'almond'),
    averageFreeEdgeRatio: clamp(toFiniteNumber(obj.averageFreeEdgeRatio, 0.45), 0.12, 1.15),
    predominantFinish,
    predominantRenderStrategy,
    realHexPalette,
    physicalAccessoriesPresent,
    overallNotesPt:
      typeof obj.overallNotesPt === 'string' && obj.overallNotesPt.trim()
        ? obj.overallNotesPt.trim().slice(0, 320)
        : 'Análise óptica global concluída.',
  };
}

function stripDataUrlPrefix(
  rawBase64: string,
  explicitMimeType?: string
): { mimeType: string; data: string } {
  const trimmed = rawBase64.trim();
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(trimmed);
  if (dataUrlMatch) {
    return {
      mimeType: explicitMimeType || dataUrlMatch[1] || 'image/jpeg',
      data: dataUrlMatch[2].replace(/\s+/g, ''),
    };
  }
  return {
    mimeType: explicitMimeType || 'image/jpeg',
    data: trimmed.replace(/\s+/g, ''),
  };
}

function extractGeminiJsonText(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    throw new AppError(502, 'Resposta vazia ou inválida do modelo Gemini.');
  }
  const root = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const text = root.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new AppError(502, 'O modelo Gemini não retornou conteúdo estruturado.');
  }

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx >= 0 && endIdx > startIdx) {
      try {
        return JSON.parse(cleaned.slice(startIdx, endIdx + 1));
      } catch {
        // fall through
      }
    }
    throw new AppError(502, 'Falha ao interpretar JSON retornado pelo Gemini.');
  }
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) return null;
  const seconds = Number(retryAfterHeader.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return clamp(Math.round(seconds * 1000), 250, 20000);
  }
  const parsedDate = Date.parse(retryAfterHeader);
  if (Number.isFinite(parsedDate)) {
    const diff = parsedDate - Date.now();
    if (diff > 0) return clamp(diff, 250, 20000);
  }
  return null;
}

async function callGeminiWithFallback(
  apiKey: string,
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
  ctx?: GeminiExecutionContext
): Promise<{ parsed: unknown; modelUsed: string }> {
  const fetchFn = ctx?.fetchImpl ?? globalThis.fetch;
  const sleepFn = ctx?.sleepImpl ?? defaultSleep;

  if (typeof fetchFn !== 'function') {
    throw new AppError(500, 'Fetch nativo indisponível neste runtime Node.');
  }

  const modelsToTry = [GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL] as const;
  let lastError: AppError | null = null;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx];
    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const maxAttempts = model === GEMINI_PRIMARY_MODEL ? 2 : RETRY_DELAYS_MS.length + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetchFn(url, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.15,
            },
          }),
        });

        clearTimeout(timeoutHandle);

        if (response.ok) {
          const jsonBody = await response.json();
          const parsed = extractGeminiJsonText(jsonBody);
          return { parsed, modelUsed: model };
        }

        const status = response.status;
        if (status === 401 || status === 403) {
          throw new AppError(
            401,
            'Chave Gemini inválida ou sem permissão no Google AI Studio.'
          );
        }

        if (status === 429 || status === 503) {
          const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after') ?? null);
          const delayMs =
            retryAfterMs ?? RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];

          lastError = new AppError(
            status,
            `Limite temporário do Gemini Free Tier (${status}) no modelo ${model}.`
          );

          if (model === GEMINI_PRIMARY_MODEL && attempt >= 0) {
            if (retryAfterMs !== null && retryAfterMs <= 2000) {
              await sleepFn(retryAfterMs);
            }
            break;
          }

          if (attempt < maxAttempts - 1) {
            await sleepFn(delayMs);
            continue;
          }
          break;
        }

        if (status >= 400 && status < 500) {
          throw new BadRequestError(
            `Requisição rejeitada pelo serviço Gemini (HTTP ${status}).`
          );
        }

        lastError = new AppError(
          502,
          `Falha transitória do serviço Gemini (HTTP ${status}).`
        );
        if (attempt < maxAttempts - 1) {
          await sleepFn(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
          continue;
        }
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (err instanceof AppError) {
          if (err.statusCode === 401 || err.statusCode === 400) {
            throw err;
          }
          lastError = err;
          break;
        }

        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'));
        lastError = new AppError(
          504,
          isAbort
            ? `Tempo limite excedido ao consultar o modelo ${model}.`
            : 'Falha de rede ao consultar o modelo Gemini.'
        );

        if (model === GEMINI_PRIMARY_MODEL) {
          break;
        }
        if (attempt < maxAttempts - 1) {
          await sleepFn(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
        }
      }
    }
  }

  throw (
    lastError ??
    new AppError(503, 'Serviço Gemini temporariamente indisponível. Tente novamente.')
  );
}

function extractGeminiGeneratedImageDataUrl(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new AppError(502, 'Resposta vazia ou inválida do modelo Gemini Image.');
  }
  const root = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }>;
      };
    }>;
  };
  const parts = root.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData;
    if (inline?.data && inline.data.trim().length > 16) {
      const mime = inline.mimeType || 'image/png';
      return `data:${mime};base64,${inline.data.replace(/\s+/g, '')}`;
    }
    const snake = part.inline_data;
    if (snake?.data && snake.data.trim().length > 16) {
      const mime = snake.mime_type || 'image/png';
      return `data:${mime};base64,${snake.data.replace(/\s+/g, '')}`;
    }
  }
  throw new AppError(
    502,
    'O modelo gemini-2.5-flash-image não retornou uma imagem UV canônica válida.'
  );
}

async function callGeminiImageGenerator(
  apiKey: string,
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>,
  ctx?: GeminiExecutionContext
): Promise<{ canonicalUvDataUrl: string; modelUsed: string }> {
  const fetchFn = ctx?.fetchImpl ?? globalThis.fetch;
  const sleepFn = ctx?.sleepImpl ?? defaultSleep;

  if (typeof fetchFn !== 'function') {
    throw new AppError(500, 'Fetch nativo indisponível neste runtime Node.');
  }

  const url = `${GEMINI_BASE_URL}/${GEMINI_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  let lastError: AppError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            temperature: 0.1,
          },
        }),
      });

      clearTimeout(timeoutHandle);

      if (response.ok) {
        const jsonBody = await response.json();
        const canonicalUvDataUrl = extractGeminiGeneratedImageDataUrl(jsonBody);
        return { canonicalUvDataUrl, modelUsed: GEMINI_IMAGE_MODEL };
      }

      const status = response.status;
      if (status === 401 || status === 403) {
        throw new AppError(
          401,
          'Chave Gemini inválida ou sem permissão para gemini-2.5-flash-image.'
        );
      }
      if (status === 429 || status === 503) {
        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after') ?? null);
        const delayMs =
          retryAfterMs ?? RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        lastError = new AppError(
          status,
          `Limite temporário do Gemini Image (${status}) no modelo ${GEMINI_IMAGE_MODEL}.`
        );
        if (attempt < maxAttempts - 1) {
          await sleepFn(delayMs);
          continue;
        }
        break;
      }
      if (status >= 400 && status < 500) {
        throw new BadRequestError(
          `Requisição rejeitada pelo Gemini Image (HTTP ${status}).`
        );
      }

      lastError = new AppError(
        502,
        `Falha transitória do serviço Gemini Image (HTTP ${status}).`
      );
      if (attempt < maxAttempts - 1) {
        await sleepFn(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
      }
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err instanceof AppError) {
        if (err.statusCode === 401 || err.statusCode === 400) {
          throw err;
        }
        lastError = err;
        break;
      }
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'));
      lastError = new AppError(
        504,
        isAbort
          ? `Tempo limite excedido ao consultar ${GEMINI_IMAGE_MODEL}.`
          : 'Falha de rede ao consultar Gemini Image.'
      );
      if (attempt < maxAttempts - 1) {
        await sleepFn(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
      }
    }
  }

  throw (
    lastError ??
    new AppError(503, 'Serviço Gemini Image temporariamente indisponível.')
  );
}

function buildGlobalAnalysisPrompt(): string {
  return `Você é um Engenheiro Óptico, Especialista em Geometria de Alongamento de Unhas e Master Nail Artist para o motor OmniFabric Dual-Path V13.
Analise a foto completa da(s) mão(s) enviada e responda EXCLUSIVAMENTE com JSON válido seguindo exatamente esta estrutura:
{
  "lightingEnvironment": {
    "roomTemperature": "warm" | "neutral" | "cool",
    "specularReflectionsPresent": boolean,
    "discountedReflectionNotesPt": string
  },
  "visibleHandsCount": 1 | 2,
  "visibleFingersCount": number,
  "handCountScope": 5 | 10,
  "hasAccentFingers": boolean,
  "hasLeftRightDifferences": boolean,
  "identicalFingerGroups": [["thumb", "index", "middle", "ring", "pinky"]],
  "accentFingers": ["ring"],
  "fingerSummaries": [
    {
      "fingerId": "thumb" | "index" | "middle" | "ring" | "pinky",
      "handSide": "Left" | "Right",
      "sameAsFingerId": "middle",
      "renderStrategy": "procedural_pbr_3d" | "canonical_uv_delighted" | "hybrid_uv_plus_pbr_3d",
      "isAccentFinger": boolean,
      "has3DAccessories": boolean,
      "summaryPt": string
    }
  ],
  "predominantShape": "natural" | "oval" | "almond" | "square" | "coffin" | "stiletto",
  "averageFreeEdgeRatio": number (0.12 a 1.15),
  "predominantFinish": "mirror_chrome" | "glazed_pearl" | "solid_gloss_gel" | "jelly_translucent" | "cat_eye_magnetic" | "velvet_matte" | "glitter_suspension",
  "predominantRenderStrategy": "procedural_pbr_3d" | "canonical_uv_delighted" | "hybrid_uv_plus_pbr_3d",
  "realHexPalette": ["#HEX"],
  "physicalAccessoriesPresent": [
    {
      "kind": "metal_stud_sphere" | "metal_stud_flat" | "pearl_dome" | "rhinestone" | "caviar_bead" | "3d_drop_clear",
      "approxCount": number,
      "colorHex": "#HEX",
      "fingers": ["middle"]
    }
  ],
  "overallNotesPt": string
}

CRITÉRIOS GEOMÉTRICOS RÍGIDOS DE FORMATO ("predominantShape"):
- "almond": Laterais convergem suavemente em arco ogival até ponta arredondada estreita (sem quinas retas e sem ponta de agulha).
- "coffin": Laterais convergem retas até uma ponta RETA/CHATA cortada transversalmente (formato bailarina).
- "stiletto": Laterais convergem agressivamente para uma ponta pontiaguda fina em V agudo.
- "oval": Laterais quase paralelas com ponta em elipse larga suave e curta/média.
- "square": Laterais 100% paralelas até borda livre reta com cantos definidos em ~90°.
- "natural": Acompanha o leito natural curto (freeEdgeRatio <= 0.25) com curvatura orgânica suave.

CLASSIFICAÇÃO DUAL-PATH OMNIFABRIC ("renderStrategy" por dedo e "predominantRenderStrategy"):
1. "procedural_pbr_3d": Unhas ópticas/esculturais lisas ou paramétricas — mirror chrome, glazed pearl, solid gloss, cat-eye, french, aura/ombré, bordas metálicas e/ou pedrarias/esferas/pérolas/strass 3D.
   EXEMPLO EXPLÍCITO OBRIGATÓRIO: Unhas cromadas douradas espelhadas com esferas metálicas 3D prateadas DEVEM usar renderStrategy: "procedural_pbr_3d", finishType: "mirror_chrome", trueBaseColorHex dourado champanhe real (descontando reflexos pretos/brancos do quarto!), strokes3D: [] e listar cada esfera metálica em accessories3D com (u, v, radiusNorm, colorHex) exatos!
2. "canonical_uv_delighted": Arte pictórica complexa pintada à mão (flores realistas, mármore orgânico, animal print, quadriculado, ilustrações detalhadas, encapsuladas complexas) SEM camada cromada ou pedrarias 3D físicas.
3. "hybrid_uv_plus_pbr_3d": Arte pictórica complexa pintada à mão combinada com camada metálica/cromada ou acessórios 3D físicos (esferas, pérolas, strass, gotas 3D).

REGRAS ÓPTICAS CRÍTICAS:
- Detecte 1 mão (5 dedos) ou 2 mãos (10 dedos) e diferenças entre Left e Right.
- Identifique a temperatura e iluminação do quarto/estúdio para descontar reflexos espelhados pretos/cinzas/brancos da cor real do esmalte em realHexPalette.
- Reflexos especulares de janelas/lâmpadas/objetos escuros no cromo NÃO são nail art nem traços pintados!`;
}

function buildFingerAnalysisPrompt(
  fingerId: FingerId,
  handSide: HandSide | undefined,
  globalContext?: unknown
): string {
  const contextSnippet =
    globalContext !== undefined
      ? `\nContexto óptico global da foto:\n${JSON.stringify(globalContext).slice(0, 2200)}\n`
      : '';

  return `Você recebeu DUAS imagens:
- Imagem 1: Foto completa da mão (referência de iluminação do ambiente).
- Imagem 2: Crop verticalizado 384x512 da unha específica do dedo "${fingerId}"${handSide ? ` (mão ${handSide})` : ''}.
${contextSnippet}
REGRA CRÍTICA DE DESAMBIGUAÇÃO ÓPTICA & DUAL-PATH OMNIFABRIC:
1. Analise EXCLUSIVAMENTE a placa ungueal em zoom (Imagem 2), ignorando anéis nos dedos, joias na mão, pele e fundo.
2. Classifique a estratégia ótima em "renderStrategy":
   - "procedural_pbr_3d": mirror chrome, glazed pearl, solid gloss, cat-eye, french, aura/ombré, bordas metálicas, pedrarias/esferas/pérolas/strass 3D.
     EXEMPLO EXPLÍCITO: Unhas cromadas douradas espelhadas com esferas metálicas 3D prateadas DEVEM usar renderStrategy: "procedural_pbr_3d", finishType: "mirror_chrome", trueBaseColorHex dourado champanhe real (descontando reflexos pretos/brancos do quarto!), strokes3D: [] e listar cada esfera metálica em accessories3D com (u, v, radiusNorm, colorHex) exatos!
   - "canonical_uv_delighted": arte pictórica complexa (flores realistas, mármore orgânico, animal print, quadriculado, ilustrações, encapsuladas complexas).
   - "hybrid_uv_plus_pbr_3d": arte pictórica complexa + camada metálica/cromada + acessórios 3D físicos.
3. PROIBIÇÃO ABSOLUTA DE ALUCINAÇÃO DE TRAÇOS:
   Reflexos especulares, sombras do ambiente ou brilho metálico em unhas lisas/cromadas NÃO são strokes3D. Retorne strokes3D: [] sempre que não houver linhas/ondas fisicamente pintadas ou esculpidas.
4. Informe "nailBoundingBox": [xMin, yMin, xMax, yMax] normalizados (0..1) delimitando exatamente o contorno da placa ungueal dentro da Imagem 2 (zoom).
5. Use geometria realista de gel de salão: cCurveDepth entre 0.11 e 0.18 e apexHeight entre 0.042 e 0.075.
6. Mapeie rigorosamente TODOS os acessórios físicos 3D em "accessories3D":
   - u: esquerda -> direita (0.08 .. 0.92)
   - v: cutícula -> ponta livre (0.08 .. 0.94)
   - radiusNorm: fração da largura da unha (ex: 0.04 caviar, 0.11 stud médio, 0.16 stud grande)
   - heightRatio: 0.35 .. 0.85
   - colorHex: cor real do acessório (ex: "#E6E9EF" prata, "#D9B668" ouro, "#F9F4EE" pérola)
   - hasBezelRing: boolean

Responda EXCLUSIVAMENTE em JSON válido com exatamente esta estrutura de Nail3DManufacturingSpec:
{
  "fingerId": "${fingerId}",
  ${handSide ? `"handSide": "${handSide}",` : ''}
  "renderStrategy": "procedural_pbr_3d" | "canonical_uv_delighted" | "hybrid_uv_plus_pbr_3d",
  "nailBoundingBox": [xMin, yMin, xMax, yMax],
  "shape": "natural" | "oval" | "almond" | "square" | "coffin" | "stiletto",
  "freeEdgeRatio": number (0.12 .. 1.15),
  "tipRoundness": number (0 .. 1),
  "cCurveDepth": number (0.11 .. 0.18),
  "apexHeight": number (0.042 .. 0.075),
  "substrateType": "natural_sheer" | "builder_gel_nude" | "milky_jelly" | "opaque_gel_polish",
  "finishType": "mirror_chrome" | "glazed_pearl" | "solid_gloss_gel" | "jelly_translucent" | "cat_eye_magnetic" | "velvet_matte" | "glitter_suspension",
  "trueBaseColorHex": "#RRGGBB",
  "secondaryColorHex": "#RRGGBB",
  "cuticleColorHex": "#RRGGBB",
  "tipColorHex": "#RRGGBB",
  "gradientType": "none" | "vertical_ombre" | "radial_aura" | "cat_eye_diagonal" | "chrome_sheen",
  "metalness": number (0 .. 1),
  "roughness": number (0.04 .. 0.55),
  "clearcoat": number (0 .. 1),
  "translucency": number (0 .. 1),
  "borderType": "none" | "full_perimeter_outline" | "cuticle_cuff" | "classic_french" | "micro_french" | "deep_v_french",
  "borderColorHex": "#RRGGBB",
  "borderWidthNorm": number (0 .. 0.35),
  "borderIsMetallic": boolean,
  "borderIs3DRaised": boolean,
  "strokes3D": [
    {
      "p0": [u, v],
      "c1": [u, v],
      "c2": [u, v],
      "p1": [u, v],
      "widthNorm": number (0.015 .. 0.14),
      "colorHex": "#RRGGBB",
      "isMetallic": boolean,
      "metalness": number (0 .. 1),
      "reliefHeight": number (0 .. 1)
    }
  ],
  "motifs": [
    {
      "kind": "flower_5petal" | "flower_4petal" | "cherry" | "heart" | "star_4pt" | "bow_3d" | "marble_veins" | "tortoiseshell_spots" | "aura_bloom" | "abstract_organic",
      "center": [u, v],
      "scale": number (0.08 .. 0.55),
      "rotationDeg": number (-180 .. 180),
      "primaryColorHex": "#RRGGBB",
      "secondaryColorHex": "#RRGGBB",
      "centerDotColorHex": "#RRGGBB",
      "is3DRaised": boolean,
      "opacity": number (0.05 .. 1)
    }
  ],
  "accessories3D": [
    {
      "kind": "metal_stud_sphere" | "metal_stud_flat" | "pearl_dome" | "rhinestone" | "caviar_bead" | "3d_drop_clear",
      "u": number (0.08 .. 0.92),
      "v": number (0.08 .. 0.94),
      "radiusNorm": number (0.025 .. 0.28),
      "heightRatio": number (0.35 .. 0.85),
      "colorHex": "#RRGGBB",
      "hasBezelRing": boolean
    }
  ],
  "designNotesPt": string
}`;
}

function buildVerifyAndRefinePrompt(
  fingerId: FingerId,
  handSide: HandSide | undefined,
  currentSpec: Nail3DManufacturingSpec
): string {
  return `Você é um Auditor Visual Implacável de QA 99% Fidelidade para o motor OmniFabric Dual-Path V13.
A imagem anexada (768x512) mostra uma comparação lado a lado do dedo "${fingerId}"${handSide ? ` (mão ${handSide})` : ''}:
- METADE ESQUERDA = Unha real da foto de referência.
- METADE DIREITA = Render 3D atual gerado pelo nosso motor a partir do JSON currentSpec abaixo.

currentSpec atual:
${JSON.stringify(currentSpec)}

Avalie explicitamente os 4 eixos em "breakdown":
1. shape: Formato geométrico exato (almond vs coffin vs stiletto vs oval vs square vs natural) e comprimento da ponta livre (freeEdgeRatio, tipRoundness, cCurveDepth ∈ [0.11, 0.18], apexHeight ∈ [0.042, 0.075]).
2. material_color: Cor real descontando reflexos da sala (trueBaseColorHex) e acabamento óptico (mirror_chrome vs glazed_pearl vs solid_gloss_gel vs jelly_translucent vs cat_eye_magnetic vs velvet_matte).
3. art_details: Bordas/francesinhas, arte pictórica e traços/motivos reais (strokes3D, motifs). PROIBIDO alucinar strokes3D a partir de reflexos especulares ou sombras ambientais — se a unha real for lisa/cromada sem traços pintados, zere strokes3D: []!
4. accessories_3d: Contagem EXATA, posição (u, v), tamanho (radiusNorm), tipo (kind) e cor (colorHex) de TODOS os acessórios 3D físicos (esferas metálicas, pérolas, strass, caviar, gotas 3D).

Se a estratégia atual ("procedural_pbr_3d" vs "canonical_uv_delighted" vs "hybrid_uv_plus_pbr_3d") não estiver ideal para reproduzir a metade ESQUERDA com >= 92% de fidelidade, sugira a troca de "renderStrategy" dentro de "refinedSpec"!

Responda EXCLUSIVAMENTE em JSON válido:
{
  "fidelityScore": number (0 .. 100),
  "breakdown": {
    "shape": number (0 .. 100),
    "material_color": number (0 .. 100),
    "art_details": number (0 .. 100),
    "accessories_3d": number (0 .. 100)
  },
  "discrepancies": [string],
  "refinedSpec": { ...Nail3DManufacturingSpec completo corrigido incluindo renderStrategy e nailBoundingBox... }
}`;
}

function buildCanonicalUvDelightPrompt(
  fingerId: FingerId,
  handSide: HandSide | undefined,
  spec?: unknown
): string {
  const specObj =
    spec && typeof spec === 'object' && !Array.isArray(spec)
      ? (spec as Record<string, unknown>)
      : undefined;
  const shapeHint = typeof specObj?.shape === 'string' ? specObj.shape : 'almond';
  const notesHint =
    typeof specObj?.designNotesPt === 'string'
      ? specObj.designNotesPt.slice(0, 180)
      : '';

  return `Generate a 512x512 orthographic, perfectly front-facing canonical UV nail texture atlas for finger "${fingerId}"${handSide ? ` (${handSide} hand)` : ''}, shape "${shapeHint}".
STRICT UV NORMALIZATION & DELIGHTING RULES:
1. Fill the entire 512x512 square canvas seamlessly from edge to edge with ONLY the nail surface pigment/nail-art pattern (bottom = cuticle v=0, top = free edge tip v=1).
2. Remove 100% of skin, cuticle folds, fingers, rings, background, shadows, and harsh white specular glare while preserving true pigments, micro-glitter, marble veins, florals, and fine hand-painted art.
3. Keep flat, uniform diffuse illumination (delighted albedo texture ready for 3D PBR re-lighting).
${notesHint ? `Design reference notes: ${notesHint}` : ''}`;
}

function isGenerativeUvAtlasEnabled(ctx?: GeminiExecutionContext): boolean {
  if (ctx?.enableGenerativeUvAtlas !== undefined) {
    return ctx.enableGenerativeUvAtlas;
  }
  return process.env.ENABLE_GENERATIVE_UV_ATLAS === 'true';
}

function normalizeHeadersMap(
  headers: Record<string, string | string[] | undefined> | undefined
): Record<string, string | string[] | undefined> {
  if (!headers) return {};
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k.toLowerCase()] = v;
  }
  return normalized;
}

export class NailReconstructionService {
  resolveGeminiApiKey(
    headers: Record<string, string | string[] | undefined>,
    envApiKey = process.env.GEMINI_API_KEY
  ): string | null {
    const normalizedHeaders = normalizeHeadersMap(headers);
    const headerRaw = normalizedHeaders['x-gemini-key'];
    const headerKey = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    if (typeof headerKey === 'string' && headerKey.trim().length > 0) {
      return headerKey.trim();
    }
    if (typeof envApiKey === 'string' && envApiKey.trim().length > 0) {
      return envApiKey.trim();
    }
    return null;
  }

  async reconstructNail(
    body: unknown,
    headers: Record<string, string | string[] | undefined> = {},
    ctx?: GeminiExecutionContext
  ): Promise<ReconstructNailResponse> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestError('Corpo da requisição deve ser um objeto JSON válido.');
    }

    const input = body as Record<string, unknown>;
    const action = input.action;

    if (
      action !== 'analyze_global' &&
      action !== 'analyze_finger' &&
      action !== 'verify_and_refine' &&
      action !== 'generate_canonical_uv'
    ) {
      throw new BadRequestError(
        'action inválido. Valores aceitos: analyze_global, analyze_finger, verify_and_refine, generate_canonical_uv.'
      );
    }

    if (action === 'generate_canonical_uv' && !isGenerativeUvAtlasEnabled(ctx)) {
      return {
        configured: true,
        enabled: false,
        mode: 'local_silhouette_uv',
        message:
          'Generative UV Atlas disabled (Free Tier mode); using local silhouette-conformed UV extractor.',
      };
    }

    const apiKey = this.resolveGeminiApiKey(
      headers,
      ctx?.envApiKey !== undefined ? ctx.envApiKey : process.env.GEMINI_API_KEY
    );

    if (!apiKey) {
      return {
        configured: false,
        mode: 'missing_key',
        message: MISSING_KEY_MESSAGE,
      };
    }

    const mimeType =
      typeof input.mimeType === 'string' && input.mimeType.trim().startsWith('image/')
        ? input.mimeType.trim()
        : 'image/jpeg';

    if (action === 'generate_canonical_uv') {
      if (
        typeof input.fingerZoomBase64 !== 'string' ||
        input.fingerZoomBase64.trim().length < 16
      ) {
        throw new BadRequestError(
          'fingerZoomBase64 é obrigatório para action "generate_canonical_uv".'
        );
      }
      const fingerId = sanitizeFingerId(input.fingerId, 'middle');
      const handSide = sanitizeHandSide(input.handSide);
      const zoomImg = stripDataUrlPrefix(input.fingerZoomBase64, mimeType);
      const { canonicalUvDataUrl, modelUsed } = await callGeminiImageGenerator(
        apiKey,
        [
          { text: buildCanonicalUvDelightPrompt(fingerId, handSide, input.spec) },
          { inlineData: { mimeType: zoomImg.mimeType, data: zoomImg.data } },
        ],
        ctx
      );

      return {
        configured: true,
        enabled: true,
        action: 'generate_canonical_uv',
        modelUsed,
        canonicalUvDataUrl,
      };
    }

    if (action === 'analyze_global') {
      if (typeof input.fullImageBase64 !== 'string' || input.fullImageBase64.trim().length < 16) {
        throw new BadRequestError(
          'fullImageBase64 é obrigatório para action "analyze_global".'
        );
      }
      const fullImg = stripDataUrlPrefix(input.fullImageBase64, mimeType);
      const { parsed, modelUsed } = await callGeminiWithFallback(
        apiKey,
        [
          { text: buildGlobalAnalysisPrompt() },
          { inlineData: { mimeType: fullImg.mimeType, data: fullImg.data } },
        ],
        ctx
      );

      return {
        configured: true,
        action: 'analyze_global',
        modelUsed,
        globalAnalysis: sanitizeGlobalAnalysis(parsed),
      };
    }

    if (action === 'analyze_finger') {
      if (
        typeof input.fingerId !== 'string' ||
        !(VALID_FINGERS as readonly string[]).includes(input.fingerId)
      ) {
        throw new BadRequestError(
          `fingerId inválido. Valores aceitos: ${VALID_FINGERS.join(', ')}.`
        );
      }
      if (typeof input.fullImageBase64 !== 'string' || input.fullImageBase64.trim().length < 16) {
        throw new BadRequestError(
          'fullImageBase64 é obrigatório para action "analyze_finger".'
        );
      }
      if (
        typeof input.fingerZoomBase64 !== 'string' ||
        input.fingerZoomBase64.trim().length < 16
      ) {
        throw new BadRequestError(
          'fingerZoomBase64 é obrigatório para action "analyze_finger".'
        );
      }

      const fingerId = input.fingerId as FingerId;
      const handSide = sanitizeHandSide(input.handSide);
      const fullImg = stripDataUrlPrefix(input.fullImageBase64, mimeType);
      const zoomImg = stripDataUrlPrefix(input.fingerZoomBase64, mimeType);

      const { parsed, modelUsed } = await callGeminiWithFallback(
        apiKey,
        [
          { text: buildFingerAnalysisPrompt(fingerId, handSide, input.globalContext) },
          { inlineData: { mimeType: fullImg.mimeType, data: fullImg.data } },
          { inlineData: { mimeType: zoomImg.mimeType, data: zoomImg.data } },
        ],
        ctx
      );

      const spec = sanitizeManufacturingSpec(parsed, {
        fingerId,
        handSide,
      });

      return {
        configured: true,
        action: 'analyze_finger',
        modelUsed,
        spec,
      };
    }

    if (
      typeof input.fingerId !== 'string' ||
      !(VALID_FINGERS as readonly string[]).includes(input.fingerId)
    ) {
      throw new BadRequestError(
        `fingerId inválido. Valores aceitos: ${VALID_FINGERS.join(', ')}.`
      );
    }
    if (
      typeof input.comparisonImageBase64 !== 'string' ||
      input.comparisonImageBase64.trim().length < 16
    ) {
      throw new BadRequestError(
        'comparisonImageBase64 é obrigatório para action "verify_and_refine".'
      );
    }
    if (
      !input.currentSpec ||
      typeof input.currentSpec !== 'object' ||
      Array.isArray(input.currentSpec)
    ) {
      throw new BadRequestError(
        'currentSpec é obrigatório para action "verify_and_refine".'
      );
    }

    const fingerId = input.fingerId as FingerId;
    const handSide = sanitizeHandSide(input.handSide);
    const sanitizedCurrentSpec = sanitizeManufacturingSpec(input.currentSpec, {
      fingerId,
      handSide,
    });
    const comparisonImg = stripDataUrlPrefix(input.comparisonImageBase64, mimeType);

    const { parsed, modelUsed } = await callGeminiWithFallback(
      apiKey,
      [
        { text: buildVerifyAndRefinePrompt(fingerId, handSide, sanitizedCurrentSpec) },
        { inlineData: { mimeType: comparisonImg.mimeType, data: comparisonImg.data } },
      ],
      ctx
    );

    const obj =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const breakdownRaw =
      obj.breakdown && typeof obj.breakdown === 'object' && !Array.isArray(obj.breakdown)
        ? (obj.breakdown as Record<string, unknown>)
        : {};

    const breakdown: VerificationBreakdown = {
      shape: Math.round(clamp(toFiniteNumber(breakdownRaw.shape, 85), 0, 100)),
      material_color: Math.round(
        clamp(toFiniteNumber(breakdownRaw.material_color ?? breakdownRaw.material, 85), 0, 100)
      ),
      art_details: Math.round(
        clamp(toFiniteNumber(breakdownRaw.art_details ?? breakdownRaw.art, 85), 0, 100)
      ),
      accessories_3d: Math.round(
        clamp(toFiniteNumber(breakdownRaw.accessories_3d ?? breakdownRaw.accessories, 85), 0, 100)
      ),
    };

    const avgBreakdown = Math.round(
      (breakdown.shape +
        breakdown.material_color +
        breakdown.art_details +
        breakdown.accessories_3d) /
        4
    );
    const fidelityScore = Math.round(
      clamp(toFiniteNumber(obj.fidelityScore, avgBreakdown), 0, 100)
    );

    const discrepancies = Array.isArray(obj.discrepancies)
      ? obj.discrepancies
          .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
          .map((d) => d.trim().slice(0, 220))
          .slice(0, 16)
      : [];

    const refinedSpec = sanitizeManufacturingSpec(obj.refinedSpec ?? sanitizedCurrentSpec, {
      fingerId,
      handSide,
      fallbackSpec: sanitizedCurrentSpec,
    });
    refinedSpec.fidelityScore = fidelityScore;
    refinedSpec.refinementRounds = (sanitizedCurrentSpec.refinementRounds ?? 0) + 1;

    return {
      configured: true,
      action: 'verify_and_refine',
      modelUsed,
      fidelityScore,
      breakdown,
      discrepancies,
      refinedSpec,
    };
  }
}
