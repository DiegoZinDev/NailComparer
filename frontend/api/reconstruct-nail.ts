export const config = {
  maxDuration: 60,
};

export interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: unknown) => VercelRes | void;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: unknown) => void;
}

export type FingerId = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type HandSide = 'Left' | 'Right';
export type NailShape = 'natural' | 'oval' | 'almond' | 'square' | 'coffin' | 'stiletto';

export type Nail3DAccessoryKind =
  | 'metal_stud_sphere'
  | 'metal_stud_flat'
  | 'pearl_dome'
  | 'rhinestone'
  | 'caviar_bead'
  | '3d_drop_clear';

export interface Nail3DAccessorySpec {
  kind: Nail3DAccessoryKind;
  u: number;
  v: number;
  radiusNorm: number;
  heightRatio: number;
  colorHex: string;
  hasBezelRing: boolean;
}

export interface Nail3DStrokeSpec {
  p0: [number, number];
  c1: [number, number];
  c2: [number, number];
  p1: [number, number];
  widthNorm: number;
  colorHex: string;
  isMetallic: boolean;
  metalness: number;
  reliefHeight: number;
}

export type Nail3DMotifKind =
  | 'flower_5petal'
  | 'flower_4petal'
  | 'cherry'
  | 'heart'
  | 'star_4pt'
  | 'bow_3d'
  | 'marble_veins'
  | 'tortoiseshell_spots'
  | 'aura_bloom'
  | 'abstract_organic';

export interface Nail3DMotifSpec {
  kind: Nail3DMotifKind;
  center: [number, number];
  scale: number;
  rotationDeg: number;
  primaryColorHex: string;
  secondaryColorHex: string;
  centerDotColorHex?: string;
  is3DRaised: boolean;
  opacity: number;
}

export type Nail3DSubstrateType =
  | 'natural_sheer'
  | 'builder_gel_nude'
  | 'milky_jelly'
  | 'opaque_gel_polish';

export type Nail3DFinishType =
  | 'mirror_chrome'
  | 'glazed_pearl'
  | 'solid_gloss_gel'
  | 'jelly_translucent'
  | 'cat_eye_magnetic'
  | 'velvet_matte'
  | 'glitter_suspension';

export type Nail3DGradientType =
  | 'none'
  | 'vertical_ombre'
  | 'radial_aura'
  | 'cat_eye_diagonal'
  | 'chrome_sheen';

export type Nail3DBorderType =
  | 'none'
  | 'full_perimeter_outline'
  | 'cuticle_cuff'
  | 'classic_french'
  | 'micro_french'
  | 'deep_v_french';

export interface Nail3DManufacturingSpec {
  fingerId: FingerId;
  handSide?: HandSide;
  shape: NailShape;
  freeEdgeRatio: number;
  tipRoundness: number;
  cCurveDepth: number;
  apexHeight: number;
  substrateType: Nail3DSubstrateType;
  finishType: Nail3DFinishType;
  trueBaseColorHex: string;
  secondaryColorHex: string;
  cuticleColorHex: string;
  tipColorHex: string;
  gradientType: Nail3DGradientType;
  metalness: number;
  roughness: number;
  clearcoat: number;
  translucency: number;
  borderType: Nail3DBorderType;
  borderColorHex: string;
  borderWidthNorm: number;
  borderIsMetallic: boolean;
  borderIs3DRaised: boolean;
  strokes3D: Nail3DStrokeSpec[];
  motifs: Nail3DMotifSpec[];
  accessories3D: Nail3DAccessorySpec[];
  designNotesPt: string;
  fidelityScore?: number;
  refinementRounds?: number;
}

export interface GlobalFingerDesignSummary {
  fingerId: FingerId;
  handSide?: HandSide;
  sameAsFingerId?: FingerId;
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
  material: number;
  art: number;
  accessories: number;
}

export type ReconstructAction = 'analyze_global' | 'analyze_finger' | 'verify_and_refine';

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
    };

export interface GeminiExecutionContext {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  envApiKey?: string;
}

const GEMINI_PRIMARY_MODEL = 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRY_DELAYS_MS = [1500, 3500, 7000] as const;
const GEMINI_REQUEST_TIMEOUT_MS = 22000;

const VALID_FINGERS: readonly FingerId[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const VALID_HAND_SIDES: readonly HandSide[] = ['Left', 'Right'];
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

const MISSING_KEY_MESSAGE =
  'Configure sua chave gratuita do Google AI Studio (GEMINI_API_KEY) na Vercel ou nas Configurações do app.';

const HEX_SHORT_REGEX = /^#?([0-9A-Fa-f]{3})$/;
const HEX_FULL_REGEX = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;

export class VisionGatewayError extends Error {
  public readonly statusCode: number;
  public readonly details?: string[];

  constructor(statusCode: number, message: string, details?: string[]) {
    super(message);
    this.name = 'VisionGatewayError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

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

  const rawStrokes = Array.isArray(obj.strokes3D)
    ? obj.strokes3D.map(sanitizeStroke).filter((x): x is Nail3DStrokeSpec => x !== null)
    : fb?.strokes3D
      ? fb.strokes3D.map(sanitizeStroke).filter((x): x is Nail3DStrokeSpec => x !== null)
      : [];

  // Optical anti-reflection safeguard: on pure mirror_chrome, discard spurious black/grey reflection streaks
  const strokes3D = (isChrome
    ? rawStrokes.filter((stroke) => {
        const c = stroke.colorHex.toUpperCase();
        const isDarkNeutralReflection =
          !stroke.isMetallic &&
          (c === '#000000' ||
            c === '#111111' ||
            c === '#222222' ||
            c === '#333333' ||
            c === '#808080');
        return !isDarkNeutralReflection;
      })
    : rawStrokes
  ).slice(0, 16);

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

  const designNotesRaw =
    typeof obj.designNotesPt === 'string' && obj.designNotesPt.trim().length > 0
      ? obj.designNotesPt.trim()
      : fb?.designNotesPt ?? 'Unha reconstruída em 3D fiel à referência.';

  const sanitized: Nail3DManufacturingSpec = {
    fingerId,
    ...(handSide ? { handSide } : {}),
    shape: sanitizeShape(obj.shape, fb?.shape ?? 'almond'),
    freeEdgeRatio: clamp(toFiniteNumber(obj.freeEdgeRatio, fb?.freeEdgeRatio ?? 0.45), 0.12, 1.15),
    tipRoundness: clamp(toFiniteNumber(obj.tipRoundness, fb?.tipRoundness ?? 0.65), 0, 1),
    cCurveDepth: clamp(toFiniteNumber(obj.cCurveDepth, fb?.cCurveDepth ?? 0.22), 0.16, 0.28),
    apexHeight: clamp(toFiniteNumber(obj.apexHeight, fb?.apexHeight ?? 0.08), 0.06, 0.11),
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
          return {
            fingerId: sanitizeFingerId(s.fingerId, 'middle'),
            ...(handSide ? { handSide } : {}),
            ...(sameAs ? { sameAsFingerId: sameAs } : {}),
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
    predominantFinish: sanitizeEnum(
      obj.predominantFinish,
      VALID_FINISH_TYPES,
      'solid_gloss_gel'
    ),
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
    throw new VisionGatewayError(502, 'Resposta vazia ou inválida do modelo Gemini.');
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
    throw new VisionGatewayError(502, 'O modelo Gemini não retornou conteúdo estruturado.');
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
    throw new VisionGatewayError(502, 'Falha ao interpretar JSON retornado pelo Gemini.');
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
    throw new VisionGatewayError(500, 'Fetch nativo indisponível neste runtime Node.');
  }

  const modelsToTry = [GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL] as const;
  let lastError: VisionGatewayError | null = null;

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
          throw new VisionGatewayError(
            401,
            'Chave Gemini inválida ou sem permissão no Google AI Studio.'
          );
        }

        if (status === 429 || status === 503) {
          const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after') ?? null);
          const delayMs =
            retryAfterMs ?? RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];

          lastError = new VisionGatewayError(
            status,
            `Limite temporário do Gemini Free Tier (${status}) no modelo ${model}.`
          );

          // On primary model, switch immediately to lite fallback after 1 brief backoff or directly on 429/503
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
          throw new VisionGatewayError(
            400,
            `Requisição rejeitada pelo serviço Gemini (HTTP ${status}).`
          );
        }

        lastError = new VisionGatewayError(
          502,
          `Falha transitória do serviço Gemini (HTTP ${status}).`
        );
        if (attempt < maxAttempts - 1) {
          await sleepFn(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
          continue;
        }
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (err instanceof VisionGatewayError) {
          if (err.statusCode === 401 || err.statusCode === 400) {
            throw err;
          }
          lastError = err;
          break;
        }

        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.toLowerCase().includes('abort'));
        lastError = new VisionGatewayError(
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
    new VisionGatewayError(503, 'Serviço Gemini temporariamente indisponível. Tente novamente.')
  );
}

function buildGlobalAnalysisPrompt(): string {
  return `Você é um Engenheiro Óptico e Master Nail Artist especialista em reconstrução 3D PBR de unhas a partir de fotografias.
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
      "isAccentFinger": boolean,
      "has3DAccessories": boolean,
      "summaryPt": string
    }
  ],
  "predominantShape": "natural" | "oval" | "almond" | "square" | "coffin" | "stiletto",
  "averageFreeEdgeRatio": number (0.12 a 1.15),
  "predominantFinish": "mirror_chrome" | "glazed_pearl" | "solid_gloss_gel" | "jelly_translucent" | "cat_eye_magnetic" | "velvet_matte" | "glitter_suspension",
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

REGRAS ÓPTICAS CRÍTICAS:
1. Desconte reflexos da sala/janelas/flash sobre unhas espelhadas (cromo ouro champagne, prata, rose gold, glaze). Reflexos pretos/cinzas/brancos NÃO são cores de esmalte nem nail art!
2. Identifique quantas mãos e quantos dedos estão visíveis (5 ou 10), se existe filha única ou variação entre mão esquerda e direita.
3. Liste em realHexPalette as cores REAIS do pigmento/cromo da unha, não da iluminação ambiente.
4. Identifique todos acessórios físicos 3D reais (esferas metálicas, tachas planas, pérolas, strass, micro caviar, gotas 3D transparentes).`;
}

function buildFingerAnalysisPrompt(
  fingerId: FingerId,
  handSide: HandSide | undefined,
  globalContext?: unknown
): string {
  const contextSnippet =
    globalContext !== undefined
      ? `\nContexto óptico global da foto:\n${JSON.stringify(globalContext).slice(0, 2000)}\n`
      : '';

  return `Você recebeu DUAS imagens:
- Imagem 1: Foto completa da mão (referência de iluminação do ambiente).
- Imagem 2: Crop verticalizado 384x512 da unha específica do dedo "${fingerId}"${handSide ? ` (mão ${handSide})` : ''}.
${contextSnippet}
REGRA CRÍTICA DE DESAMBIGUAÇÃO ÓPTICA:
Analise EXCLUSIVAMENTE a unha em zoom (Imagem 2), ignorando anéis nos dedos, joias na mão, roupas e fundo.
Se a unha for cromada/espelhada (como ouro champagne espelhado, prata, rose gold ou glaze), os tons pretos, cinzas ou brancos sobre a superfície são REFLEXOS DO AMBIENTE e NÃO listras ou manchas pintadas!
Extraia finishType: "mirror_chrome", metalness >= 0.92, roughness <= 0.08, informe em trueBaseColorHex a cor metálica real do cromo (ex.: "#D4B483" para ouro champagne) e NÃO crie strokes3D nem motifs para reflexos!

Mapeie rigorosamente TODOS os acessórios físicos 3D em "accessories3D" com coordenadas normalizadas:
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
  "shape": "natural" | "oval" | "almond" | "square" | "coffin" | "stiletto",
  "freeEdgeRatio": number (0.12 .. 1.15),
  "tipRoundness": number (0 .. 1),
  "cCurveDepth": number (0.16 .. 0.28),
  "apexHeight": number (0.06 .. 0.11),
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
  return `Você é um Auditor Visual Implacável de QA 99% Fidelidade para renderização 3D de unhas.
A imagem anexada (768x512) mostra uma comparação lado a lado do dedo "${fingerId}"${handSide ? ` (mão ${handSide})` : ''}:
- METADE ESQUERDA = Unha real da foto de referência.
- METADE DIREITA = Render 3D atual gerado pelo nosso motor a partir do JSON currentSpec abaixo.

currentSpec atual:
${JSON.stringify(currentSpec)}

Compare rigorosamente os 5 pilares:
1. shape: Formato e comprimento da ponta livre (freeEdgeRatio, tipRoundness).
2. material: Cor real (trueBaseColorHex) e acabamento óptico (mirror_chrome vs glazed_pearl vs solid_gloss_gel vs jelly_translucent vs velvet_matte) — descontando reflexos da sala na foto real.
3. art: Bordas/francesinhas (borderType, borderColorHex, borderWidthNorm) e traços/motivos reais (strokes3D, motifs), sem confundir reflexos ambientais com listras!
4. accessories: Contagem EXATA, posição (u, v), tamanho (radiusNorm), tipo (kind) e cor (colorHex) de TODOS os acessórios 3D físicos (studs metálicos, pérolas, strass, caviar, gotas 3D).

Se houver qualquer divergência visual entre a ESQUERDA (real) e a DIREITA (3D), corrija em "refinedSpec" mantendo exatamente o schema Nail3DManufacturingSpec.

Responda EXCLUSIVAMENTE em JSON válido:
{
  "fidelityScore": number (0 .. 100),
  "breakdown": {
    "shape": number (0 .. 100),
    "material": number (0 .. 100),
    "art": number (0 .. 100),
    "accessories": number (0 .. 100)
  },
  "discrepancies": [string],
  "refinedSpec": { ...Nail3DManufacturingSpec completo corrigido... }
}`;
}

function readEnvGeminiApiKey(): string | undefined {
  const proc = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process;
  return proc?.env?.GEMINI_API_KEY;
}

export function resolveGeminiApiKey(
  headers: Record<string, string | string[] | undefined>,
  envApiKey = readEnvGeminiApiKey()
): string | null {
  const headerRaw = headers['x-gemini-key'] ?? headers['X-Gemini-Key'];
  const headerKey = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
  if (typeof headerKey === 'string' && headerKey.trim().length > 0) {
    return headerKey.trim();
  }
  if (typeof envApiKey === 'string' && envApiKey.trim().length > 0) {
    return envApiKey.trim();
  }
  return null;
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

export async function executeReconstructNail(
  body: unknown,
  headers: Record<string, string | string[] | undefined> = {},
  ctx?: GeminiExecutionContext
): Promise<ReconstructNailResponse> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VisionGatewayError(400, 'Corpo da requisição deve ser um objeto JSON válido.');
  }

  const input = body as Record<string, unknown>;
  const action = input.action;

  if (
    action !== 'analyze_global' &&
    action !== 'analyze_finger' &&
    action !== 'verify_and_refine'
  ) {
    throw new VisionGatewayError(
      400,
      'action inválido. Valores aceitos: analyze_global, analyze_finger, verify_and_refine.'
    );
  }

  const normalizedHeaders = normalizeHeadersMap(headers);
  const apiKey = resolveGeminiApiKey(
    normalizedHeaders,
    ctx?.envApiKey !== undefined ? ctx.envApiKey : readEnvGeminiApiKey()
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

  if (action === 'analyze_global') {
    if (typeof input.fullImageBase64 !== 'string' || input.fullImageBase64.trim().length < 16) {
      throw new VisionGatewayError(
        400,
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
    if (typeof input.fingerId !== 'string' || !(VALID_FINGERS as readonly string[]).includes(input.fingerId)) {
      throw new VisionGatewayError(
        400,
        `fingerId inválido. Valores aceitos: ${VALID_FINGERS.join(', ')}.`
      );
    }
    if (typeof input.fullImageBase64 !== 'string' || input.fullImageBase64.trim().length < 16) {
      throw new VisionGatewayError(
        400,
        'fullImageBase64 é obrigatório para action "analyze_finger".'
      );
    }
    if (typeof input.fingerZoomBase64 !== 'string' || input.fingerZoomBase64.trim().length < 16) {
      throw new VisionGatewayError(
        400,
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

  // action === 'verify_and_refine'
  if (typeof input.fingerId !== 'string' || !(VALID_FINGERS as readonly string[]).includes(input.fingerId)) {
    throw new VisionGatewayError(
      400,
      `fingerId inválido. Valores aceitos: ${VALID_FINGERS.join(', ')}.`
    );
  }
  if (
    typeof input.comparisonImageBase64 !== 'string' ||
    input.comparisonImageBase64.trim().length < 16
  ) {
    throw new VisionGatewayError(
      400,
      'comparisonImageBase64 é obrigatório para action "verify_and_refine".'
    );
  }
  if (!input.currentSpec || typeof input.currentSpec !== 'object' || Array.isArray(input.currentSpec)) {
    throw new VisionGatewayError(
      400,
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
    material: Math.round(clamp(toFiniteNumber(breakdownRaw.material, 85), 0, 100)),
    art: Math.round(clamp(toFiniteNumber(breakdownRaw.art, 85), 0, 100)),
    accessories: Math.round(clamp(toFiniteNumber(breakdownRaw.accessories, 85), 0, 100)),
  };

  const avgBreakdown = Math.round(
    (breakdown.shape + breakdown.material + breakdown.art + breakdown.accessories) / 4
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

function setCorsHeaders(res: VercelRes): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gemini-key');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
    return;
  }

  try {
    const parsedBody =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as unknown)
        : req.body;
    const result = await executeReconstructNail(parsedBody, req.headers);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
      return;
    }
    if (err instanceof VisionGatewayError) {
      res.status(err.statusCode).json({
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }
    res.status(500).json({
      error: 'Erro interno ao processar reconstrução de unha.',
    });
  }
}
