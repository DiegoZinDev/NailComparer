export type NailCategory =
  | 'estudio'
  | 'francesinha'
  | 'gel'
  | 'cromado'
  | 'nail-art'
  | 'cliente';

export type NailStyleType = 'procedural' | 'image';

export type NailPatternType =
  | 'solid'
  | 'french'
  | 'ombre'
  | 'chrome'
  | 'marble'
  | 'gold-foil'
  | 'cat-eye'
  | 'aurora'
  | 'custom-photo';

export type NailFinish = 'glossy' | 'chrome' | 'velvet' | 'glitter';

export type NailShape =
  | 'natural'
  | 'oval'
  | 'almond'
  | 'square'
  | 'coffin'
  | 'stiletto';

export type FingerId = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type HandSide = 'Left' | 'Right';

export type ArtisticPattern =
  | 'solid_gloss'
  | 'chrome_mirror'
  | 'gold_3d_waves'
  | 'aura_gradient'
  | 'french_tip'
  | 'floral_accent';

export type NailFinishV10 =
  | 'glossy_gel'
  | 'jelly_translucent'
  | 'chrome_mirror'
  | 'pearl_glazed'
  | 'cat_eye'
  | 'velvet_matte';

export type NailFinishV9 = NailFinishV10;

export type NailExtensionLevel =
  | 'Curta/Natural'
  | 'Pouco Alongada'
  | 'Alongada'
  | 'Muito Alongada (Extrema)';

export interface StrokeAnchor {
  u: number;
  v: number;
  radius: number;
  angle: number;
}

// -----------------------------------------------------------------------------
// V11 Deep 3D Manufacturing Spec (Per-Finger / 5 or 10 Fingers + Real 3D Accessories)
// -----------------------------------------------------------------------------

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

export type NailRenderStrategy =
  | 'procedural_pbr_3d'
  | 'canonical_uv_delighted'
  | 'hybrid_uv_plus_pbr_3d';

export interface NailUvPinTarget {
  cxNorm: number;
  cyNorm: number;
  widthNorm: number;
  heightNorm: number;
  angleRad: number;
  detectedFromPhoto: boolean;
}

export interface Nail3DManufacturingSpec {
  fingerId: FingerId;
  handSide?: HandSide;
  /** V13 OmniFabric-Nail Dual-Path Strategy */
  renderStrategy?: NailRenderStrategy;
  /** Optional VLM-guided bounding box [xMin, yMin, xMax, yMax] inside finger zoom crop */
  nailBoundingBox?: [number, number, number, number];
  shape: NailShape;
  freeEdgeRatio: number;
  tipRoundness: number;
  cCurveDepth: number; // 0.11..0.18 (V13 thin salon gel shell)
  apexHeight: number; // 0.042..0.075 (V13 refined gel apex)
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

// -----------------------------------------------------------------------------
// V10 Mathematical Nail Design Blueprint (Compact ~2-6 KB Vector + Parametric JSON)
// -----------------------------------------------------------------------------

export type NailGradientMode =
  | 'solid'
  | 'vertical_ombre'
  | 'radial_aura'
  | 'cat_eye_band'
  | 'pearl_chrome';

export type NailBorderKind =
  | 'none'
  | 'full_metallic_outline'
  | 'cuticle_cuff'
  | 'classic_french'
  | 'micro_french'
  | 'v_french';

export interface NailGeometryProfile {
  profileHalfWidths: [number, number, number, number, number, number, number, number];
  aspectRatio: number;
  freeEdgeRatio: number;
  tipRoundness: number;
  shape: NailShape;
}

export interface NailBaseLayer {
  baseColorHex: string;
  gradientMode: NailGradientMode;
  cuticleColorHex: string;
  midColorHex: string;
  tipColorHex: string;
  finishStyle: NailFinishV10;
  translucency: number;
  metallicBase: number;
  glossiness: number;
}

export interface NailBorderLayer {
  kind: NailBorderKind;
  colorHex: string;
  thicknessNorm: number;
  isMetallic: boolean;
  is3DRaised: boolean;
  smileCurveDepth: number;
}

export interface RibbonStrokePoint {
  u: number;
  v: number;
  width: number;
}

export interface RibbonStrokeElement {
  type: 'ribbon_stroke';
  points: RibbonStrokePoint[];
  colorHex: string;
  highlightHex: string;
  isMetallic: boolean;
  reliefHeight: number;
}

export interface OrganicMotifPoint {
  u: number;
  v: number;
}

export interface OrganicMotifElement {
  type: 'organic_motif';
  contour: OrganicMotifPoint[];
  fillColorHex: string;
  shadeColorHex: string;
  isMetallic: boolean;
  reliefHeight: number;
}

export interface MicroGemElement {
  type: 'micro_gem';
  u: number;
  v: number;
  radius: number;
  colorHex: string;
  kind: 'gold_bead' | 'pearl' | 'crystal';
}

export type VectorArtElement =
  | RibbonStrokeElement
  | OrganicMotifElement
  | MicroGemElement;

export interface NailDesignBlueprint {
  version: 10;
  geometry: NailGeometryProfile;
  baseLayer: NailBaseLayer;
  borderLayer: NailBorderLayer;
  artElements: VectorArtElement[];
}

export interface NailFingerDesignSpec {
  fingerId: FingerId;
  handSide?: HandSide;
  detectedFromPhoto: boolean;
  shape: NailShape;
  relativeLength: number;
  relativeWidth: number;
  baseColor: string;
  secondaryColor: string;
  accentColor: string;
  pattern: ArtisticPattern;
  strokeAnchors: StrokeAnchor[];
  metallicIntensity: number;
  glossIntensity: number;
  // V12/V13 Photorealistic True UV Texture Transfer + Dual-Path Routing
  renderStrategy?: NailRenderStrategy;
  trueUvDataUrl?: string;
  uvExtractionTarget?: NailUvPinTarget;
  // V11 Primary 3D Manufacturing Spec + Real 3D Offscreen Render Preview
  manufacturingSpec?: Nail3DManufacturingSpec;
  preview3DDataUrl?: string;
  fidelityScore?: number;
  // V10 Clean Mathematical Blueprint (kept for local fallback compatibility)
  blueprint?: NailDesignBlueprint;
  extensionLevel?: NailExtensionLevel;
  freeEdgeRatio?: number;
  extensionMm?: number;
  tipRoundness?: number;
  aspectRatio?: number;
  lengthMultiplier?: number;
  hasMetallicOutline?: boolean;
  outlineColor?: string;
  has3DRelief?: boolean;
  reliefDescription?: string;
  artDescription?: string;
  finishStyle?: NailFinishV10;
  isImportedReference?: boolean;
}

export type NailFingerSpecsMap = Record<FingerId, NailFingerDesignSpec>;

export interface NailHandSpecsBySide {
  Left?: NailFingerSpecsMap;
  Right?: NailFingerSpecsMap;
}

export interface NailFingerSpecsEnvelopeV11 {
  __v11Envelope: true;
  fingerSpecs: NailFingerSpecsMap | null;
  handSpecsBySide?: NailHandSpecsBySide | null;
  fidelityScore?: number | null;
  v13Engine?: boolean;
}

// -----------------------------------------------------------------------------
// V14 Automatic Nail Technical Sheet (Ficha Técnica Automática Dedo-a-Dedo)
// -----------------------------------------------------------------------------

export interface NailTechnicalSheetFinger {
  fingerId: FingerId;
  labelPt: string;
  shape: NailShape;
  shapeLabelPt: string;
  extensionLevelPt: string;
  primaryColorHex: string;
  secondaryColorHex?: string;
  finishLabelPt: string;
  artDetailsPt: string[];
  accessoriesPt: string[];
  isAccentFinger: boolean;
}

export interface NailTechnicalSheet {
  generatedAt: string;
  summaryPt: string;
  predominantShapePt: string;
  predominantExtensionPt: string;
  hasAccentFingers: boolean;
  fingers: NailTechnicalSheetFinger[];
  whatsappText: string;
}

export interface NailDesignRow {
  id: string;
  name: string;
  category: string;
  style_type: string;
  base_color: string;
  accent_color: string;
  secondary_color: string | null;
  finish: string | null;
  pattern_type: string;
  image_data_url: string | null;
  default_scale: number;
  default_rotation: number;
  default_opacity: number;
  is_custom_reference: number;
  is_studio_catalog: number;
  detected_shape: string | null;
  detected_length: number | null;
  finger_specs_json: string | null;
  technical_sheet_json?: string | null;
  created_at: string;
}

export interface NailDesign {
  id: string;
  name: string;
  category: NailCategory;
  styleType: NailStyleType;
  baseColor: string;
  secondaryColor: string | null;
  accentColor: string;
  finish: NailFinish;
  patternType: NailPatternType;
  imageDataUrl: string | null;
  defaultScale: number;
  defaultRotation: number;
  defaultOpacity: number;
  isCustomReference: boolean;
  isStudioCatalog: boolean;
  detectedShape: NailShape | null;
  detectedLength: number | null;
  fidelityScore?: number | null;
  v13Engine?: boolean;
  fingerSpecs: NailFingerSpecsMap | null;
  handSpecsBySide?: NailHandSpecsBySide | null;
  technicalSheet?: NailTechnicalSheet | null;
  technicalSheetJson?: string | null;
  createdAt: string;
}

const VALID_FINISH_SET = new Set<string>(['glossy', 'chrome', 'velvet', 'glitter']);
const VALID_SHAPE_SET = new Set<string>([
  'natural',
  'oval',
  'almond',
  'square',
  'coffin',
  'stiletto',
]);
const FINGER_KEY_SET = new Set<string>(['thumb', 'index', 'middle', 'ring', 'pinky']);

function computeFidelityScoreFromSpecs(
  fingerSpecs: NailFingerSpecsMap | null,
  handSpecsBySide?: NailHandSpecsBySide | null
): number | null {
  const scores: number[] = [];
  const collectFromMap = (map: NailFingerSpecsMap | null | undefined) => {
    if (!map) return;
    for (const key of Object.keys(map) as FingerId[]) {
      const spec = map[key];
      const s = spec?.fidelityScore ?? spec?.manufacturingSpec?.fidelityScore;
      if (typeof s === 'number' && Number.isFinite(s)) {
        scores.push(s);
      }
    }
  };
  collectFromMap(fingerSpecs);
  collectFromMap(handSpecsBySide?.Left);
  collectFromMap(handSpecsBySide?.Right);
  if (scores.length === 0) return null;
  const avg = scores.reduce((acc, v) => acc + v, 0) / scores.length;
  return Math.round(Math.max(0, Math.min(100, avg)));
}

function hasV13IndicatorsInMap(map: NailFingerSpecsMap | null | undefined): boolean {
  if (!map) return false;
  for (const key of Object.keys(map) as FingerId[]) {
    const spec = map[key];
    if (!spec) continue;
    if (
      spec.renderStrategy !== undefined ||
      spec.trueUvDataUrl !== undefined ||
      spec.uvExtractionTarget !== undefined ||
      spec.manufacturingSpec?.renderStrategy !== undefined ||
      spec.manufacturingSpec?.nailBoundingBox !== undefined
    ) {
      return true;
    }
  }
  return false;
}

export function attachV11SerializationEnvelope(
  fingerSpecs: NailFingerSpecsMap | null,
  handSpecsBySide?: NailHandSpecsBySide | null,
  fidelityScore?: number | null,
  v13Engine?: boolean
): NailFingerSpecsMap | null {
  const hasSideData = Boolean(
    handSpecsBySide && (handSpecsBySide.Left || handSpecsBySide.Right)
  );
  const hasFidelity =
    typeof fidelityScore === 'number' && Number.isFinite(fidelityScore);
  const hasV13Flag = typeof v13Engine === 'boolean';

  if (!hasSideData && !hasFidelity && !hasV13Flag) {
    return fingerSpecs;
  }

  if (fingerSpecs && typeof fingerSpecs === 'object') {
    const plainSnapshot = { ...fingerSpecs } as NailFingerSpecsMap;
    const envelope: NailFingerSpecsEnvelopeV11 = {
      __v11Envelope: true,
      fingerSpecs: plainSnapshot,
      ...(hasSideData ? { handSpecsBySide } : {}),
      ...(hasFidelity ? { fidelityScore } : {}),
      ...(hasV13Flag ? { v13Engine } : {}),
    };
    Object.defineProperty(fingerSpecs, 'toJSON', {
      value: () => envelope,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return fingerSpecs;
  }

  const baseFromSide = handSpecsBySide?.Right ?? handSpecsBySide?.Left ?? null;
  if (baseFromSide) {
    const plainSnapshot = { ...baseFromSide } as NailFingerSpecsMap;
    const wrapperSpecs = { ...baseFromSide } as NailFingerSpecsMap;
    const envelope: NailFingerSpecsEnvelopeV11 = {
      __v11Envelope: true,
      fingerSpecs: plainSnapshot,
      ...(hasSideData ? { handSpecsBySide } : {}),
      ...(hasFidelity ? { fidelityScore } : {}),
      ...(hasV13Flag ? { v13Engine } : {}),
    };
    Object.defineProperty(wrapperSpecs, 'toJSON', {
      value: () => envelope,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return wrapperSpecs;
  }

  if (hasV13Flag || hasFidelity) {
    const emptyWrapper = {} as NailFingerSpecsMap;
    const envelope: NailFingerSpecsEnvelopeV11 = {
      __v11Envelope: true,
      fingerSpecs: null,
      ...(hasFidelity ? { fidelityScore } : {}),
      ...(hasV13Flag ? { v13Engine } : {}),
    };
    Object.defineProperty(emptyWrapper, 'toJSON', {
      value: () => envelope,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    return emptyWrapper;
  }

  return null;
}

interface ParsedFingerSpecsBlob {
  fingerSpecs: NailFingerSpecsMap | null;
  handSpecsBySide: NailHandSpecsBySide | null;
  fidelityScore: number | null;
  v13Engine?: boolean;
}

function parseFingerSpecsJson(rawJson: string | null): ParsedFingerSpecsBlob {
  if (!rawJson || typeof rawJson !== 'string') {
    return { fingerSpecs: null, handSpecsBySide: null, fidelityScore: null };
  }
  const trimmed = rawJson.trim();
  if (!trimmed) {
    return { fingerSpecs: null, handSpecsBySide: null, fidelityScore: null };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { fingerSpecs: null, handSpecsBySide: null, fidelityScore: null };
    }

    const record = parsed as Record<string, unknown>;

    // V11/V13 Envelope format
    if (
      record.__v11Envelope === true ||
      'fingerSpecs' in record ||
      'handSpecsBySide' in record ||
      'v13Engine' in record
    ) {
      const innerSpecs =
        record.fingerSpecs &&
        typeof record.fingerSpecs === 'object' &&
        !Array.isArray(record.fingerSpecs)
          ? (record.fingerSpecs as NailFingerSpecsMap)
          : null;

      const rawBySide =
        record.handSpecsBySide &&
        typeof record.handSpecsBySide === 'object' &&
        !Array.isArray(record.handSpecsBySide)
          ? (record.handSpecsBySide as NailHandSpecsBySide)
          : null;

      const handSpecsBySide =
        rawBySide && (rawBySide.Left || rawBySide.Right)
          ? {
              ...(rawBySide.Left ? { Left: rawBySide.Left } : {}),
              ...(rawBySide.Right ? { Right: rawBySide.Right } : {}),
            }
          : null;

      const explicitScore =
        typeof record.fidelityScore === 'number' && Number.isFinite(record.fidelityScore)
          ? Math.round(Math.max(0, Math.min(100, record.fidelityScore)))
          : null;

      const derivedScore =
        explicitScore ?? computeFidelityScoreFromSpecs(innerSpecs, handSpecsBySide);

      const resolvedFingerSpecs =
        innerSpecs ?? handSpecsBySide?.Right ?? handSpecsBySide?.Left ?? null;

      const v13Engine =
        typeof record.v13Engine === 'boolean'
          ? record.v13Engine
          : hasV13IndicatorsInMap(resolvedFingerSpecs) ||
              hasV13IndicatorsInMap(handSpecsBySide?.Left) ||
              hasV13IndicatorsInMap(handSpecsBySide?.Right)
            ? true
            : undefined;

      return {
        fingerSpecs: resolvedFingerSpecs,
        handSpecsBySide,
        fidelityScore: derivedScore,
        ...(v13Engine !== undefined ? { v13Engine } : {}),
      };
    }

    // Legacy / clean Record<FingerId, NailFingerDesignSpec> format
    const cleanSpecs: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
    for (const [k, v] of Object.entries(record)) {
      if (FINGER_KEY_SET.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        cleanSpecs[k as FingerId] = v as NailFingerDesignSpec;
      }
    }

    const fingerSpecs =
      Object.keys(cleanSpecs).length > 0 ? (cleanSpecs as NailFingerSpecsMap) : null;
    const derivedScore = computeFidelityScoreFromSpecs(fingerSpecs, null);
    const v13Engine = hasV13IndicatorsInMap(fingerSpecs) ? true : undefined;

    return {
      fingerSpecs,
      handSpecsBySide: null,
      fidelityScore: derivedScore,
      ...(v13Engine !== undefined ? { v13Engine } : {}),
    };
  } catch {
    return { fingerSpecs: null, handSpecsBySide: null, fidelityScore: null };
  }
}

function parseTechnicalSheetJson(rawJson: string | null | undefined): NailTechnicalSheet | null {
  if (!rawJson || typeof rawJson !== 'string') {
    return null;
  }
  const trimmed = rawJson.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const sheet = parsed as Partial<NailTechnicalSheet>;
    if (
      typeof sheet.generatedAt !== 'string' ||
      typeof sheet.summaryPt !== 'string' ||
      typeof sheet.predominantShapePt !== 'string' ||
      typeof sheet.predominantExtensionPt !== 'string' ||
      typeof sheet.hasAccentFingers !== 'boolean' ||
      !Array.isArray(sheet.fingers) ||
      typeof sheet.whatsappText !== 'string'
    ) {
      return null;
    }
    return sheet as NailTechnicalSheet;
  } catch {
    return null;
  }
}

export function mapNailDesignRowToEntity(row: NailDesignRow): NailDesign {
  const finish: NailFinish =
    row.finish && VALID_FINISH_SET.has(row.finish)
      ? (row.finish as NailFinish)
      : 'glossy';

  const detectedShape: NailShape | null =
    row.detected_shape && VALID_SHAPE_SET.has(row.detected_shape)
      ? (row.detected_shape as NailShape)
      : null;

  const detectedLength: number | null =
    row.detected_length !== null &&
    row.detected_length !== undefined &&
    Number.isFinite(Number(row.detected_length))
      ? Number(row.detected_length)
      : null;

  const parsedBlob = parseFingerSpecsJson(row.finger_specs_json ?? null);
  const parsedTechnicalSheet = parseTechnicalSheetJson(row.technical_sheet_json ?? null);

  return {
    id: row.id,
    name: row.name,
    category: row.category as NailCategory,
    styleType: row.style_type as NailStyleType,
    baseColor: row.base_color,
    secondaryColor: row.secondary_color ?? null,
    accentColor: row.accent_color,
    finish,
    patternType: row.pattern_type as NailPatternType,
    imageDataUrl: row.image_data_url ?? null,
    defaultScale: Number(row.default_scale),
    defaultRotation: Number(row.default_rotation),
    defaultOpacity: Number(row.default_opacity),
    isCustomReference: Boolean(row.is_custom_reference),
    isStudioCatalog: Boolean(row.is_studio_catalog),
    detectedShape,
    detectedLength,
    ...(parsedBlob.fidelityScore !== null ? { fidelityScore: parsedBlob.fidelityScore } : {}),
    ...(parsedBlob.v13Engine !== undefined ? { v13Engine: parsedBlob.v13Engine } : {}),
    fingerSpecs: parsedBlob.fingerSpecs,
    ...(parsedBlob.handSpecsBySide ? { handSpecsBySide: parsedBlob.handSpecsBySide } : {}),
    ...(parsedTechnicalSheet ? { technicalSheet: parsedTechnicalSheet } : {}),
    createdAt: row.created_at,
  };
}
