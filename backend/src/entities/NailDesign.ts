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

export type ArtisticPattern =
  | 'solid_gloss'
  | 'chrome_mirror'
  | 'gold_3d_waves'
  | 'aura_gradient'
  | 'french_tip'
  | 'floral_accent';

export type NailFinishV9 =
  | 'glossy_gel'
  | 'jelly_translucent'
  | 'chrome_mirror'
  | 'velvet_matte'
  | 'cat_eye';

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

export interface NailFingerDesignSpec {
  fingerId: FingerId;
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
  extensionLevel?: NailExtensionLevel;
  extensionMm?: number;
  tipRoundness?: number;
  aspectRatio?: number;
  lengthMultiplier?: number;
  hasMetallicOutline?: boolean;
  outlineColor?: string;
  has3DRelief?: boolean;
  reliefDescription?: string;
  artDescription?: string;
  finishStyle?: NailFinishV9;
  uvPatchDataUrl?: string;
  normalMapDataUrl?: string;
  displacementMapDataUrl?: string;
  metalnessMapDataUrl?: string;
  roughnessMapDataUrl?: string;
  isImportedReference?: boolean;
}

export type NailFingerSpecsMap = Record<FingerId, NailFingerDesignSpec>;

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
  fingerSpecs: NailFingerSpecsMap | null;
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

function parseFingerSpecsJson(rawJson: string | null): NailFingerSpecsMap | null {
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
    return parsed as NailFingerSpecsMap;
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
    fingerSpecs: parseFingerSpecsJson(row.finger_specs_json ?? null),
    createdAt: row.created_at,
  };
}
