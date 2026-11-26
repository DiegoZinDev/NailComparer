import {
  attachV11SerializationEnvelope,
  type FingerId,
  type HandSide,
  type MicroGemElement,
  type Nail3DAccessoryKind,
  type Nail3DAccessorySpec,
  type Nail3DBorderType,
  type Nail3DFinishType,
  type Nail3DGradientType,
  type Nail3DManufacturingSpec,
  type Nail3DMotifKind,
  type Nail3DMotifSpec,
  type Nail3DStrokeSpec,
  type Nail3DSubstrateType,
  type NailBaseLayer,
  type NailBorderKind,
  type NailBorderLayer,
  type NailCategory,
  type NailDesign,
  type NailDesignBlueprint,
  type NailFingerDesignSpec,
  type NailFingerSpecsMap,
  type NailFinish,
  type NailFinishV10,
  type NailGeometryProfile,
  type NailGradientMode,
  type NailHandSpecsBySide,
  type NailPatternType,
  type NailRenderStrategy,
  type NailShape,
  type NailStyleType,
  type NailTechnicalSheet,
  type NailTechnicalSheetFinger,
  type NailUvPinTarget,
  type OrganicMotifElement,
  type RibbonStrokeElement,
  type VectorArtElement,
} from '../entities/NailDesign.js';

export const VALID_NAIL_CATEGORIES: readonly NailCategory[] = [
  'estudio',
  'francesinha',
  'gel',
  'cromado',
  'nail-art',
  'cliente',
] as const;

export const VALID_NAIL_STYLE_TYPES: readonly NailStyleType[] = [
  'procedural',
  'image',
] as const;

export const VALID_NAIL_PATTERN_TYPES: readonly NailPatternType[] = [
  'solid',
  'french',
  'ombre',
  'chrome',
  'marble',
  'gold-foil',
  'cat-eye',
  'aurora',
  'custom-photo',
] as const;

export const VALID_NAIL_FINISHES: readonly NailFinish[] = [
  'glossy',
  'chrome',
  'velvet',
  'glitter',
] as const;

export const VALID_NAIL_SHAPES: readonly NailShape[] = [
  'natural',
  'oval',
  'almond',
  'square',
  'coffin',
  'stiletto',
] as const;

export const VALID_FINGER_IDS: readonly FingerId[] = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
] as const;

export const VALID_HAND_SIDES: readonly HandSide[] = ['Left', 'Right'] as const;

export const VALID_NAIL_FINISHES_V10: readonly NailFinishV10[] = [
  'glossy_gel',
  'jelly_translucent',
  'chrome_mirror',
  'pearl_glazed',
  'cat_eye',
  'velvet_matte',
] as const;

export const VALID_NAIL_GRADIENT_MODES: readonly NailGradientMode[] = [
  'solid',
  'vertical_ombre',
  'radial_aura',
  'cat_eye_band',
  'pearl_chrome',
] as const;

export const VALID_NAIL_BORDER_KINDS: readonly NailBorderKind[] = [
  'none',
  'full_metallic_outline',
  'cuticle_cuff',
  'classic_french',
  'micro_french',
  'v_french',
] as const;

export const VALID_MICRO_GEM_KINDS: readonly MicroGemElement['kind'][] = [
  'gold_bead',
  'pearl',
  'crystal',
] as const;

export const VALID_V11_ACCESSORY_KINDS: readonly Nail3DAccessoryKind[] = [
  'metal_stud_sphere',
  'metal_stud_flat',
  'pearl_dome',
  'rhinestone',
  'caviar_bead',
  '3d_drop_clear',
] as const;

export const VALID_V11_MOTIF_KINDS: readonly Nail3DMotifKind[] = [
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
] as const;

export const VALID_V11_SUBSTRATE_TYPES: readonly Nail3DSubstrateType[] = [
  'natural_sheer',
  'builder_gel_nude',
  'milky_jelly',
  'opaque_gel_polish',
] as const;

export const VALID_V11_FINISH_TYPES: readonly Nail3DFinishType[] = [
  'mirror_chrome',
  'glazed_pearl',
  'solid_gloss_gel',
  'jelly_translucent',
  'cat_eye_magnetic',
  'velvet_matte',
  'glitter_suspension',
] as const;

export const VALID_V11_GRADIENT_TYPES: readonly Nail3DGradientType[] = [
  'none',
  'vertical_ombre',
  'radial_aura',
  'cat_eye_diagonal',
  'chrome_sheen',
] as const;

export const VALID_V11_BORDER_TYPES: readonly Nail3DBorderType[] = [
  'none',
  'full_perimeter_outline',
  'cuticle_cuff',
  'classic_french',
  'micro_french',
  'deep_v_french',
] as const;

export const VALID_V13_RENDER_STRATEGIES: readonly NailRenderStrategy[] = [
  'procedural_pbr_3d',
  'canonical_uv_delighted',
  'hybrid_uv_plus_pbr_3d',
] as const;

export interface NailDesignDTO {
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
  createdAt: string;
}

export interface CreateNailDesignDTO {
  id?: string;
  name: string;
  category: NailCategory;
  styleType?: NailStyleType;
  baseColor?: string;
  secondaryColor?: string | null;
  accentColor?: string;
  finish?: NailFinish;
  patternType?: NailPatternType;
  imageDataUrl?: string | null;
  defaultScale?: number;
  defaultRotation?: number;
  defaultOpacity?: number;
  isCustomReference?: boolean;
  isStudioCatalog?: boolean;
  detectedShape?: NailShape | null;
  detectedLength?: number | null;
  fidelityScore?: number | null;
  v13Engine?: boolean;
  fingerSpecs?: NailFingerSpecsMap | null;
  handSpecsBySide?: NailHandSpecsBySide | null;
  technicalSheet?: NailTechnicalSheet | null;
}

export interface UpdateNailDesignDTO {
  name?: string;
  category?: NailCategory;
  styleType?: NailStyleType;
  baseColor?: string;
  secondaryColor?: string | null;
  accentColor?: string;
  finish?: NailFinish;
  patternType?: NailPatternType;
  imageDataUrl?: string | null;
  defaultScale?: number;
  defaultRotation?: number;
  defaultOpacity?: number;
  isCustomReference?: boolean;
  isStudioCatalog?: boolean;
  detectedShape?: NailShape | null;
  detectedLength?: number | null;
  fidelityScore?: number | null;
  v13Engine?: boolean;
  fingerSpecs?: NailFingerSpecsMap | null;
  handSpecsBySide?: NailHandSpecsBySide | null;
  technicalSheet?: NailTechnicalSheet | null;
}

export type NailDesignValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; errors: string[] };

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const SLUG_ID_REGEX = /^[a-zA-Z0-9_-]{2,80}$/;

export function isValidNailCategory(value: unknown): value is NailCategory {
  return (
    typeof value === 'string' &&
    (VALID_NAIL_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isValidNailStyleType(value: unknown): value is NailStyleType {
  return (
    typeof value === 'string' &&
    (VALID_NAIL_STYLE_TYPES as readonly string[]).includes(value)
  );
}

export function isValidNailPatternType(value: unknown): value is NailPatternType {
  return (
    typeof value === 'string' &&
    (VALID_NAIL_PATTERN_TYPES as readonly string[]).includes(value)
  );
}

export function isValidNailFinish(value: unknown): value is NailFinish {
  return (
    typeof value === 'string' &&
    (VALID_NAIL_FINISHES as readonly string[]).includes(value)
  );
}

export function isValidNailShape(value: unknown): value is NailShape {
  return (
    typeof value === 'string' &&
    (VALID_NAIL_SHAPES as readonly string[]).includes(value)
  );
}

function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value.trim());
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function clampNumber(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function validateAndSanitizeBlueprint(
  rawBlueprint: unknown,
  fingerKey: string,
  errors: string[]
): NailDesignBlueprint | undefined {
  if (rawBlueprint === undefined) {
    return undefined;
  }
  if (!rawBlueprint || typeof rawBlueprint !== 'object' || Array.isArray(rawBlueprint)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint deve ser um objeto JSON válido.`);
    return undefined;
  }

  const bp = rawBlueprint as Record<string, unknown>;
  if (bp.version !== 10) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.version deve ser 10.`);
    return undefined;
  }

  // 1. Validate geometry
  if (!bp.geometry || typeof bp.geometry !== 'object' || Array.isArray(bp.geometry)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.geometry é obrigatório.`);
    return undefined;
  }
  const geoRaw = bp.geometry as Record<string, unknown>;
  if (!Array.isArray(geoRaw.profileHalfWidths) || geoRaw.profileHalfWidths.length !== 8) {
    errors.push(
      `fingerSpecs.${fingerKey}.blueprint.geometry.profileHalfWidths deve conter exatamente 8 números.`
    );
    return undefined;
  }
  const profileHalfWidths: number[] = [];
  for (let i = 0; i < 8; i++) {
    const w = geoRaw.profileHalfWidths[i];
    if (!isFiniteNumberInRange(w, 0.01, 0.55)) {
      errors.push(
        `fingerSpecs.${fingerKey}.blueprint.geometry.profileHalfWidths[${i}] inválido (esperado 0.01..0.55).`
      );
      return undefined;
    }
    profileHalfWidths.push(clampNumber(w, 0.02, 0.5));
  }

  if (!isFiniteNumberInRange(geoRaw.aspectRatio, 0.5, 4.0)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.geometry.aspectRatio inválido.`);
    return undefined;
  }
  if (!isFiniteNumberInRange(geoRaw.freeEdgeRatio, 0.0, 2.0)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.geometry.freeEdgeRatio inválido.`);
    return undefined;
  }
  if (!isFiniteNumberInRange(geoRaw.tipRoundness, 0.0, 1.0)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.geometry.tipRoundness inválido.`);
    return undefined;
  }
  if (!isValidNailShape(geoRaw.shape)) {
    errors.push(
      `fingerSpecs.${fingerKey}.blueprint.geometry.shape inválido. Valores aceitos: ${VALID_NAIL_SHAPES.join(', ')}.`
    );
    return undefined;
  }

  const geometry: NailGeometryProfile = {
    profileHalfWidths: profileHalfWidths as NailGeometryProfile['profileHalfWidths'],
    aspectRatio: geoRaw.aspectRatio,
    freeEdgeRatio: clampNumber(geoRaw.freeEdgeRatio, 0.12, 1.15),
    tipRoundness: clampNumber(geoRaw.tipRoundness, 0, 1),
    shape: geoRaw.shape,
  };

  // 2. Validate baseLayer
  if (!bp.baseLayer || typeof bp.baseLayer !== 'object' || Array.isArray(bp.baseLayer)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.baseLayer é obrigatório.`);
    return undefined;
  }
  const baseRaw = bp.baseLayer as Record<string, unknown>;
  if (
    !isValidHexColor(baseRaw.baseColorHex) ||
    !isValidHexColor(baseRaw.cuticleColorHex) ||
    !isValidHexColor(baseRaw.midColorHex) ||
    !isValidHexColor(baseRaw.tipColorHex)
  ) {
    errors.push(
      `fingerSpecs.${fingerKey}.blueprint.baseLayer deve conter cores hexadecimais válidas.`
    );
    return undefined;
  }
  if (
    typeof baseRaw.gradientMode !== 'string' ||
    !(VALID_NAIL_GRADIENT_MODES as readonly string[]).includes(baseRaw.gradientMode)
  ) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.baseLayer.gradientMode inválido.`);
    return undefined;
  }
  if (
    typeof baseRaw.finishStyle !== 'string' ||
    !(VALID_NAIL_FINISHES_V10 as readonly string[]).includes(baseRaw.finishStyle)
  ) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.baseLayer.finishStyle inválido.`);
    return undefined;
  }
  if (
    !isFiniteNumberInRange(baseRaw.translucency, 0, 1) ||
    !isFiniteNumberInRange(baseRaw.metallicBase, 0, 1) ||
    !isFiniteNumberInRange(baseRaw.glossiness, 0, 1)
  ) {
    errors.push(
      `fingerSpecs.${fingerKey}.blueprint.baseLayer translucency/metallicBase/glossiness devem estar entre 0 e 1.`
    );
    return undefined;
  }

  const baseLayer: NailBaseLayer = {
    baseColorHex: baseRaw.baseColorHex.trim().toUpperCase(),
    gradientMode: baseRaw.gradientMode as NailGradientMode,
    cuticleColorHex: baseRaw.cuticleColorHex.trim().toUpperCase(),
    midColorHex: baseRaw.midColorHex.trim().toUpperCase(),
    tipColorHex: baseRaw.tipColorHex.trim().toUpperCase(),
    finishStyle: baseRaw.finishStyle as NailFinishV10,
    translucency: baseRaw.translucency,
    metallicBase: baseRaw.metallicBase,
    glossiness: baseRaw.glossiness,
  };

  // 3. Validate borderLayer
  if (!bp.borderLayer || typeof bp.borderLayer !== 'object' || Array.isArray(bp.borderLayer)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.borderLayer é obrigatório.`);
    return undefined;
  }
  const borderRaw = bp.borderLayer as Record<string, unknown>;
  if (
    typeof borderRaw.kind !== 'string' ||
    !(VALID_NAIL_BORDER_KINDS as readonly string[]).includes(borderRaw.kind)
  ) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.borderLayer.kind inválido.`);
    return undefined;
  }
  if (!isValidHexColor(borderRaw.colorHex)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.borderLayer.colorHex inválido.`);
    return undefined;
  }
  if (
    !isFiniteNumberInRange(borderRaw.thicknessNorm, 0, 0.5) ||
    typeof borderRaw.isMetallic !== 'boolean' ||
    typeof borderRaw.is3DRaised !== 'boolean' ||
    !isFiniteNumberInRange(borderRaw.smileCurveDepth, 0, 0.6)
  ) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.borderLayer contém parâmetros inválidos.`);
    return undefined;
  }

  const borderLayer: NailBorderLayer = {
    kind: borderRaw.kind as NailBorderKind,
    colorHex: borderRaw.colorHex.trim().toUpperCase(),
    thicknessNorm: clampNumber(borderRaw.thicknessNorm, 0.02, 0.28),
    isMetallic: borderRaw.isMetallic,
    is3DRaised: borderRaw.is3DRaised,
    smileCurveDepth: clampNumber(borderRaw.smileCurveDepth, 0, 0.35),
  };

  // 4. Validate artElements (compact vector primitives only — max 48 elements per finger)
  if (!Array.isArray(bp.artElements)) {
    errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements deve ser um array.`);
    return undefined;
  }
  if (bp.artElements.length > 48) {
    errors.push(
      `fingerSpecs.${fingerKey}.blueprint.artElements excede o limite de 48 primitivas vetoriais.`
    );
    return undefined;
  }

  const artElements: VectorArtElement[] = [];
  for (let idx = 0; idx < bp.artElements.length; idx++) {
    const elRaw = bp.artElements[idx];
    if (!elRaw || typeof elRaw !== 'object' || Array.isArray(elRaw)) {
      errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}] inválido.`);
      return undefined;
    }
    const el = elRaw as Record<string, unknown>;

    if (el.type === 'ribbon_stroke') {
      if (!Array.isArray(el.points) || el.points.length < 2 || el.points.length > 32) {
        errors.push(
          `fingerSpecs.${fingerKey}.blueprint.artElements[${idx}].points deve conter entre 2 e 32 pontos.`
        );
        return undefined;
      }
      const pts: RibbonStrokeElement['points'] = [];
      for (const pRaw of el.points) {
        if (!pRaw || typeof pRaw !== 'object') {
          errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}].points inválido.`);
          return undefined;
        }
        const p = pRaw as Record<string, unknown>;
        if (
          !isFiniteNumberInRange(p.u, 0, 1) ||
          !isFiniteNumberInRange(p.v, 0, 1) ||
          !isFiniteNumberInRange(p.width, 0.005, 0.3)
        ) {
          errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}] ponto fora de faixa.`);
          return undefined;
        }
        pts.push({ u: p.u, v: p.v, width: clampNumber(p.width, 0.015, 0.14) });
      }
      if (
        !isValidHexColor(el.colorHex) ||
        !isValidHexColor(el.highlightHex) ||
        typeof el.isMetallic !== 'boolean' ||
        !isFiniteNumberInRange(el.reliefHeight, 0, 1.5)
      ) {
        errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}] ribbon_stroke inválido.`);
        return undefined;
      }
      artElements.push({
        type: 'ribbon_stroke',
        points: pts,
        colorHex: el.colorHex.trim().toUpperCase(),
        highlightHex: el.highlightHex.trim().toUpperCase(),
        isMetallic: el.isMetallic,
        reliefHeight: clampNumber(el.reliefHeight, 0.2, 1.0),
      });
    } else if (el.type === 'organic_motif') {
      if (!Array.isArray(el.contour) || el.contour.length < 3 || el.contour.length > 48) {
        errors.push(
          `fingerSpecs.${fingerKey}.blueprint.artElements[${idx}].contour deve conter entre 3 e 48 vértices.`
        );
        return undefined;
      }
      const contour: OrganicMotifElement['contour'] = [];
      for (const cRaw of el.contour) {
        if (!cRaw || typeof cRaw !== 'object') {
          errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}].contour inválido.`);
          return undefined;
        }
        const c = cRaw as Record<string, unknown>;
        if (!isFiniteNumberInRange(c.u, 0, 1) || !isFiniteNumberInRange(c.v, 0, 1)) {
          errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}] vértice fora de [0,1].`);
          return undefined;
        }
        contour.push({ u: c.u, v: c.v });
      }
      if (
        !isValidHexColor(el.fillColorHex) ||
        !isValidHexColor(el.shadeColorHex) ||
        typeof el.isMetallic !== 'boolean' ||
        !isFiniteNumberInRange(el.reliefHeight, 0, 1.5)
      ) {
        errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}] organic_motif inválido.`);
        return undefined;
      }
      artElements.push({
        type: 'organic_motif',
        contour,
        fillColorHex: el.fillColorHex.trim().toUpperCase(),
        shadeColorHex: el.shadeColorHex.trim().toUpperCase(),
        isMetallic: el.isMetallic,
        reliefHeight: clampNumber(el.reliefHeight, 0.15, 1.0),
      });
    } else if (el.type === 'micro_gem') {
      if (
        !isFiniteNumberInRange(el.u, 0, 1) ||
        !isFiniteNumberInRange(el.v, 0, 1) ||
        !isFiniteNumberInRange(el.radius, 0.005, 0.15) ||
        !isValidHexColor(el.colorHex) ||
        typeof el.kind !== 'string' ||
        !(VALID_MICRO_GEM_KINDS as readonly string[]).includes(el.kind)
      ) {
        errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}] micro_gem inválido.`);
        return undefined;
      }
      artElements.push({
        type: 'micro_gem',
        u: el.u,
        v: el.v,
        radius: clampNumber(el.radius, 0.015, 0.065),
        colorHex: el.colorHex.trim().toUpperCase(),
        kind: el.kind as MicroGemElement['kind'],
      });
    } else {
      errors.push(`fingerSpecs.${fingerKey}.blueprint.artElements[${idx}].type desconhecido.`);
      return undefined;
    }
  }

  return {
    version: 10,
    geometry,
    baseLayer,
    borderLayer,
    artElements,
  };
}

function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.slice(0, 7).toUpperCase();
}

function validateAndSanitizeManufacturingSpec(
  rawSpec: unknown,
  fingerKey: string,
  errors: string[]
): Nail3DManufacturingSpec | undefined {
  if (rawSpec === undefined) {
    return undefined;
  }
  if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
    errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec deve ser um objeto JSON válido.`);
    return undefined;
  }

  const s = rawSpec as Record<string, unknown>;

  let renderStrategy: NailRenderStrategy | undefined;
  if (s.renderStrategy !== undefined) {
    if (
      typeof s.renderStrategy !== 'string' ||
      !(VALID_V13_RENDER_STRATEGIES as readonly string[]).includes(s.renderStrategy)
    ) {
      errors.push(
        `fingerSpecs.${fingerKey}.manufacturingSpec.renderStrategy inválido. Valores aceitos: ${VALID_V13_RENDER_STRATEGIES.join(', ')}.`
      );
      return undefined;
    }
    renderStrategy = s.renderStrategy as NailRenderStrategy;
  }

  let nailBoundingBox: [number, number, number, number] | undefined;
  if (s.nailBoundingBox !== undefined && s.nailBoundingBox !== null) {
    if (
      !Array.isArray(s.nailBoundingBox) ||
      s.nailBoundingBox.length !== 4 ||
      s.nailBoundingBox.some((v) => typeof v !== 'number' || !Number.isFinite(v))
    ) {
      errors.push(
        `fingerSpecs.${fingerKey}.manufacturingSpec.nailBoundingBox deve conter 4 números [xMin, yMin, xMax, yMax] entre 0 e 1.`
      );
      return undefined;
    }
    const x0 = clampNumber(s.nailBoundingBox[0] as number, 0, 1);
    const y0 = clampNumber(s.nailBoundingBox[1] as number, 0, 1);
    const x1 = clampNumber(s.nailBoundingBox[2] as number, 0, 1);
    const y1 = clampNumber(s.nailBoundingBox[3] as number, 0, 1);
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (maxX - minX >= 0.04 && maxY - minY >= 0.04) {
      nailBoundingBox = [minX, minY, maxX, maxY];
    }
  }

  const shape: NailShape = isValidNailShape(s.shape) ? s.shape : 'almond';
  if (s.shape !== undefined && !isValidNailShape(s.shape)) {
    errors.push(
      `fingerSpecs.${fingerKey}.manufacturingSpec.shape inválido. Valores aceitos: ${VALID_NAIL_SHAPES.join(', ')}.`
    );
    return undefined;
  }

  const finishType: Nail3DFinishType =
    typeof s.finishType === 'string' &&
    (VALID_V11_FINISH_TYPES as readonly string[]).includes(s.finishType)
      ? (s.finishType as Nail3DFinishType)
      : 'solid_gloss_gel';
  if (
    s.finishType !== undefined &&
    (typeof s.finishType !== 'string' ||
      !(VALID_V11_FINISH_TYPES as readonly string[]).includes(s.finishType))
  ) {
    errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.finishType inválido.`);
    return undefined;
  }

  const substrateType: Nail3DSubstrateType =
    typeof s.substrateType === 'string' &&
    (VALID_V11_SUBSTRATE_TYPES as readonly string[]).includes(s.substrateType)
      ? (s.substrateType as Nail3DSubstrateType)
      : 'opaque_gel_polish';
  if (
    s.substrateType !== undefined &&
    (typeof s.substrateType !== 'string' ||
      !(VALID_V11_SUBSTRATE_TYPES as readonly string[]).includes(s.substrateType))
  ) {
    errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.substrateType inválido.`);
    return undefined;
  }

  const gradientType: Nail3DGradientType =
    typeof s.gradientType === 'string' &&
    (VALID_V11_GRADIENT_TYPES as readonly string[]).includes(s.gradientType)
      ? (s.gradientType as Nail3DGradientType)
      : 'none';
  if (
    s.gradientType !== undefined &&
    (typeof s.gradientType !== 'string' ||
      !(VALID_V11_GRADIENT_TYPES as readonly string[]).includes(s.gradientType))
  ) {
    errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.gradientType inválido.`);
    return undefined;
  }

  const borderType: Nail3DBorderType =
    typeof s.borderType === 'string' &&
    (VALID_V11_BORDER_TYPES as readonly string[]).includes(s.borderType)
      ? (s.borderType as Nail3DBorderType)
      : 'none';
  if (
    s.borderType !== undefined &&
    (typeof s.borderType !== 'string' ||
      !(VALID_V11_BORDER_TYPES as readonly string[]).includes(s.borderType))
  ) {
    errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.borderType inválido.`);
    return undefined;
  }

  const trueBaseColorHex = isValidHexColor(s.trueBaseColorHex)
    ? normalizeHexColor(s.trueBaseColorHex)
    : '#D4B483';
  if (s.trueBaseColorHex !== undefined && !isValidHexColor(s.trueBaseColorHex)) {
    errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.trueBaseColorHex inválido.`);
    return undefined;
  }

  const secondaryColorHex = isValidHexColor(s.secondaryColorHex)
    ? normalizeHexColor(s.secondaryColorHex)
    : trueBaseColorHex;
  const cuticleColorHex = isValidHexColor(s.cuticleColorHex)
    ? normalizeHexColor(s.cuticleColorHex)
    : trueBaseColorHex;
  const tipColorHex = isValidHexColor(s.tipColorHex)
    ? normalizeHexColor(s.tipColorHex)
    : secondaryColorHex;
  const borderColorHex = isValidHexColor(s.borderColorHex)
    ? normalizeHexColor(s.borderColorHex)
    : '#FFFFFF';

  const accessories3D: Nail3DAccessorySpec[] = [];
  if (Array.isArray(s.accessories3D)) {
    if (s.accessories3D.length > 24) {
      errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.accessories3D excede limite de 24.`);
      return undefined;
    }
    for (let i = 0; i < s.accessories3D.length; i++) {
      const a = s.accessories3D[i] as Record<string, unknown> | null;
      if (!a || typeof a !== 'object' || Array.isArray(a)) {
        errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.accessories3D[${i}] inválido.`);
        return undefined;
      }
      if (
        typeof a.kind !== 'string' ||
        !(VALID_V11_ACCESSORY_KINDS as readonly string[]).includes(a.kind)
      ) {
        errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.accessories3D[${i}].kind inválido.`);
        return undefined;
      }
      if (
        typeof a.u !== 'number' ||
        !Number.isFinite(a.u) ||
        typeof a.v !== 'number' ||
        !Number.isFinite(a.v) ||
        typeof a.radiusNorm !== 'number' ||
        !Number.isFinite(a.radiusNorm) ||
        !isValidHexColor(a.colorHex)
      ) {
        errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.accessories3D[${i}] inválido.`);
        return undefined;
      }
      accessories3D.push({
        kind: a.kind as Nail3DAccessoryKind,
        u: clampNumber(a.u, 0.08, 0.92),
        v: clampNumber(a.v, 0.08, 0.94),
        radiusNorm: clampNumber(a.radiusNorm, 0.025, 0.28),
        heightRatio: clampNumber(
          typeof a.heightRatio === 'number' && Number.isFinite(a.heightRatio)
            ? a.heightRatio
            : 0.6,
          0.35,
          0.85
        ),
        colorHex: normalizeHexColor(a.colorHex),
        hasBezelRing: typeof a.hasBezelRing === 'boolean' ? a.hasBezelRing : true,
      });
    }
  }

  const strokes3D: Nail3DStrokeSpec[] = [];
  if (Array.isArray(s.strokes3D)) {
    if (s.strokes3D.length > 16) {
      errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.strokes3D excede limite de 16.`);
      return undefined;
    }
    for (let i = 0; i < s.strokes3D.length; i++) {
      const st = s.strokes3D[i] as Record<string, unknown> | null;
      if (!st || typeof st !== 'object' || Array.isArray(st)) {
        errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.strokes3D[${i}] inválido.`);
        return undefined;
      }
      const parseTuple = (val: unknown): [number, number] | null => {
        if (
          !Array.isArray(val) ||
          val.length !== 2 ||
          typeof val[0] !== 'number' ||
          !Number.isFinite(val[0]) ||
          typeof val[1] !== 'number' ||
          !Number.isFinite(val[1])
        ) {
          return null;
        }
        return [clampNumber(val[0], 0.02, 0.98), clampNumber(val[1], 0.02, 0.98)];
      };
      const p0 = parseTuple(st.p0);
      const c1 = parseTuple(st.c1);
      const c2 = parseTuple(st.c2);
      const p1 = parseTuple(st.p1);
      if (!p0 || !c1 || !c2 || !p1 || !isValidHexColor(st.colorHex)) {
        errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.strokes3D[${i}] inválido.`);
        return undefined;
      }
      strokes3D.push({
        p0,
        c1,
        c2,
        p1,
        widthNorm: clampNumber(
          typeof st.widthNorm === 'number' && Number.isFinite(st.widthNorm) ? st.widthNorm : 0.04,
          0.015,
          0.14
        ),
        colorHex: normalizeHexColor(st.colorHex),
        isMetallic: typeof st.isMetallic === 'boolean' ? st.isMetallic : false,
        metalness: clampNumber(
          typeof st.metalness === 'number' && Number.isFinite(st.metalness) ? st.metalness : 0.1,
          0,
          1
        ),
        reliefHeight: clampNumber(
          typeof st.reliefHeight === 'number' && Number.isFinite(st.reliefHeight)
            ? st.reliefHeight
            : 0.3,
          0,
          1
        ),
      });
    }
  }

  const motifs: Nail3DMotifSpec[] = [];
  if (Array.isArray(s.motifs)) {
    if (s.motifs.length > 12) {
      errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.motifs excede limite de 12.`);
      return undefined;
    }
    for (let i = 0; i < s.motifs.length; i++) {
      const m = s.motifs[i] as Record<string, unknown> | null;
      if (!m || typeof m !== 'object' || Array.isArray(m)) {
        errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.motifs[${i}] inválido.`);
        return undefined;
      }
      if (
        typeof m.kind !== 'string' ||
        !(VALID_V11_MOTIF_KINDS as readonly string[]).includes(m.kind) ||
        !Array.isArray(m.center) ||
        m.center.length !== 2 ||
        typeof m.center[0] !== 'number' ||
        !Number.isFinite(m.center[0]) ||
        typeof m.center[1] !== 'number' ||
        !Number.isFinite(m.center[1]) ||
        !isValidHexColor(m.primaryColorHex) ||
        !isValidHexColor(m.secondaryColorHex)
      ) {
        errors.push(`fingerSpecs.${fingerKey}.manufacturingSpec.motifs[${i}] inválido.`);
        return undefined;
      }
      motifs.push({
        kind: m.kind as Nail3DMotifKind,
        center: [
          clampNumber(m.center[0], 0.1, 0.9),
          clampNumber(m.center[1], 0.1, 0.92),
        ],
        scale: clampNumber(
          typeof m.scale === 'number' && Number.isFinite(m.scale) ? m.scale : 0.22,
          0.08,
          0.55
        ),
        rotationDeg: clampNumber(
          typeof m.rotationDeg === 'number' && Number.isFinite(m.rotationDeg)
            ? m.rotationDeg
            : 0,
          -180,
          180
        ),
        primaryColorHex: normalizeHexColor(m.primaryColorHex),
        secondaryColorHex: normalizeHexColor(m.secondaryColorHex),
        ...(isValidHexColor(m.centerDotColorHex)
          ? { centerDotColorHex: normalizeHexColor(m.centerDotColorHex) }
          : {}),
        is3DRaised: typeof m.is3DRaised === 'boolean' ? m.is3DRaised : false,
        opacity: clampNumber(
          typeof m.opacity === 'number' && Number.isFinite(m.opacity) ? m.opacity : 0.95,
          0.05,
          1
        ),
      });
    }
  }

  const isChrome = finishType === 'mirror_chrome';
  const rawMetalness =
    typeof s.metalness === 'number' && Number.isFinite(s.metalness)
      ? s.metalness
      : isChrome
        ? 0.95
        : 0.05;
  const rawRoughness =
    typeof s.roughness === 'number' && Number.isFinite(s.roughness)
      ? s.roughness
      : isChrome
        ? 0.06
        : 0.12;

  const handSide =
    typeof s.handSide === 'string' &&
    (VALID_HAND_SIDES as readonly string[]).includes(s.handSide)
      ? (s.handSide as HandSide)
      : undefined;

  const result: Nail3DManufacturingSpec = {
    fingerId: (typeof s.fingerId === 'string' &&
    (VALID_FINGER_IDS as readonly string[]).includes(s.fingerId)
      ? s.fingerId
      : fingerKey.split('.').pop() ?? 'middle') as FingerId,
    ...(handSide ? { handSide } : {}),
    ...(renderStrategy ? { renderStrategy } : {}),
    ...(nailBoundingBox ? { nailBoundingBox } : {}),
    shape,
    freeEdgeRatio: clampNumber(
      typeof s.freeEdgeRatio === 'number' && Number.isFinite(s.freeEdgeRatio)
        ? s.freeEdgeRatio
        : 0.45,
      0.12,
      1.15
    ),
    tipRoundness: clampNumber(
      typeof s.tipRoundness === 'number' && Number.isFinite(s.tipRoundness)
        ? s.tipRoundness
        : 0.65,
      0,
      1
    ),
    cCurveDepth: clampNumber(
      typeof s.cCurveDepth === 'number' && Number.isFinite(s.cCurveDepth)
        ? s.cCurveDepth
        : 0.145,
      0.11,
      0.18
    ),
    apexHeight: clampNumber(
      typeof s.apexHeight === 'number' && Number.isFinite(s.apexHeight) ? s.apexHeight : 0.058,
      0.042,
      0.075
    ),
    substrateType,
    finishType,
    trueBaseColorHex,
    secondaryColorHex,
    cuticleColorHex,
    tipColorHex,
    gradientType,
    metalness: isChrome ? clampNumber(Math.max(0.92, rawMetalness), 0.92, 1) : clampNumber(rawMetalness, 0, 1),
    roughness: isChrome
      ? clampNumber(Math.min(0.08, rawRoughness), 0.04, 0.08)
      : clampNumber(rawRoughness, 0.04, 0.55),
    clearcoat: clampNumber(
      typeof s.clearcoat === 'number' && Number.isFinite(s.clearcoat) ? s.clearcoat : 0.95,
      0,
      1
    ),
    translucency: clampNumber(
      typeof s.translucency === 'number' && Number.isFinite(s.translucency)
        ? s.translucency
        : 0.08,
      0,
      1
    ),
    borderType,
    borderColorHex,
    borderWidthNorm: clampNumber(
      typeof s.borderWidthNorm === 'number' && Number.isFinite(s.borderWidthNorm)
        ? s.borderWidthNorm
        : 0,
      0,
      0.35
    ),
    borderIsMetallic: typeof s.borderIsMetallic === 'boolean' ? s.borderIsMetallic : false,
    borderIs3DRaised: typeof s.borderIs3DRaised === 'boolean' ? s.borderIs3DRaised : false,
    strokes3D,
    motifs,
    accessories3D,
    designNotesPt:
      typeof s.designNotesPt === 'string' && s.designNotesPt.trim().length > 0
        ? s.designNotesPt.trim().slice(0, 320)
        : 'Especificação 3D validada.',
  };

  if (typeof s.fidelityScore === 'number' && Number.isFinite(s.fidelityScore)) {
    result.fidelityScore = Math.round(clampNumber(s.fidelityScore, 0, 100));
  }
  if (typeof s.refinementRounds === 'number' && Number.isFinite(s.refinementRounds)) {
    result.refinementRounds = Math.round(clampNumber(s.refinementRounds, 0, 10));
  }

  return result;
}

function sanitizePreview3DDataUrl(
  value: unknown,
  fingerPath: string,
  errors: string[]
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push(`${fingerPath}.preview3DDataUrl deve ser uma string data:image/* válida.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (
    !trimmed.startsWith('data:image/') &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('/')
  ) {
    errors.push(`${fingerPath}.preview3DDataUrl deve começar com data:image/ ou URL válida.`);
    return undefined;
  }
  if (trimmed.length > 350000) {
    errors.push(`${fingerPath}.preview3DDataUrl excede tamanho máximo permitido.`);
    return undefined;
  }
  return trimmed;
}

function sanitizeTrueUvDataUrl(
  value: unknown,
  fingerPath: string,
  errors: string[]
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push(`${fingerPath}.trueUvDataUrl deve ser uma string data:image/* válida.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (
    !trimmed.startsWith('data:image/') &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('/')
  ) {
    errors.push(`${fingerPath}.trueUvDataUrl deve começar com data:image/ ou URL válida.`);
    return undefined;
  }
  if (trimmed.length > 750000) {
    errors.push(`${fingerPath}.trueUvDataUrl excede tamanho máximo permitido.`);
    return undefined;
  }
  return trimmed;
}

function sanitizeUvExtractionTarget(
  value: unknown,
  fingerPath: string,
  errors: string[]
): NailUvPinTarget | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${fingerPath}.uvExtractionTarget deve ser um objeto válido.`);
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.cxNorm !== 'number' ||
    !Number.isFinite(obj.cxNorm) ||
    typeof obj.cyNorm !== 'number' ||
    !Number.isFinite(obj.cyNorm) ||
    typeof obj.widthNorm !== 'number' ||
    !Number.isFinite(obj.widthNorm) ||
    typeof obj.heightNorm !== 'number' ||
    !Number.isFinite(obj.heightNorm) ||
    typeof obj.angleRad !== 'number' ||
    !Number.isFinite(obj.angleRad)
  ) {
    errors.push(
      `${fingerPath}.uvExtractionTarget deve conter cxNorm, cyNorm, widthNorm, heightNorm e angleRad numéricos finitos.`
    );
    return undefined;
  }

  return {
    cxNorm: clampNumber(obj.cxNorm, 0, 1),
    cyNorm: clampNumber(obj.cyNorm, 0, 1),
    widthNorm: clampNumber(obj.widthNorm, 0.01, 1),
    heightNorm: clampNumber(obj.heightNorm, 0.01, 1),
    angleRad: clampNumber(obj.angleRad, -Math.PI * 2, Math.PI * 2),
    detectedFromPhoto:
      typeof obj.detectedFromPhoto === 'boolean' ? obj.detectedFromPhoto : true,
  };
}

function validateAndSanitizeFingerMapRecord(
  record: Record<string, unknown>,
  pathPrefix: string,
  errors: string[]
): NailFingerSpecsMap | null {
  const keys = Object.keys(record);
  if (keys.length === 0) {
    errors.push(`${pathPrefix} não pode ser um objeto vazio.`);
    return null;
  }

  const sanitizedMap: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
  for (const key of keys) {
    if (!(VALID_FINGER_IDS as readonly string[]).includes(key)) {
      errors.push(
        `Chave inválida "${key}" em ${pathPrefix}. Dedos aceitos: ${VALID_FINGER_IDS.join(', ')}.`
      );
      continue;
    }
    const spec = record[key];
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      errors.push(`${pathPrefix}.${key} deve ser um objeto válido.`);
      continue;
    }
    const specObj = spec as Record<string, unknown>;
    if (specObj.shape !== undefined && !isValidNailShape(specObj.shape)) {
      errors.push(
        `${pathPrefix}.${key}.shape inválido. Valores aceitos: ${VALID_NAIL_SHAPES.join(', ')}.`
      );
      continue;
    }

    if (
      specObj.freeEdgeRatio !== undefined &&
      !isFiniteNumberInRange(specObj.freeEdgeRatio, 0.0, 2.0)
    ) {
      errors.push(`${pathPrefix}.${key}.freeEdgeRatio deve ser um número entre 0 e 2.`);
      continue;
    }

    if (
      specObj.finishStyle !== undefined &&
      (typeof specObj.finishStyle !== 'string' ||
        !(VALID_NAIL_FINISHES_V10 as readonly string[]).includes(specObj.finishStyle))
    ) {
      errors.push(
        `${pathPrefix}.${key}.finishStyle inválido. Valores aceitos: ${VALID_NAIL_FINISHES_V10.join(', ')}.`
      );
      continue;
    }

    if (
      specObj.handSide !== undefined &&
      (typeof specObj.handSide !== 'string' ||
        !(VALID_HAND_SIDES as readonly string[]).includes(specObj.handSide))
    ) {
      errors.push(`${pathPrefix}.${key}.handSide inválido. Valores aceitos: Left, Right.`);
      continue;
    }

    if (
      specObj.renderStrategy !== undefined &&
      (typeof specObj.renderStrategy !== 'string' ||
        !(VALID_V13_RENDER_STRATEGIES as readonly string[]).includes(specObj.renderStrategy))
    ) {
      errors.push(
        `${pathPrefix}.${key}.renderStrategy inválido. Valores aceitos: ${VALID_V13_RENDER_STRATEGIES.join(', ')}.`
      );
      continue;
    }

    if (
      specObj.fidelityScore !== undefined &&
      !isFiniteNumberInRange(specObj.fidelityScore, 0, 100)
    ) {
      errors.push(`${pathPrefix}.${key}.fidelityScore deve estar entre 0 e 100.`);
      continue;
    }

    const validatedBlueprint = validateAndSanitizeBlueprint(
      specObj.blueprint,
      `${pathPrefix}.${key}`,
      errors
    );
    const validatedManufacturingSpec = validateAndSanitizeManufacturingSpec(
      specObj.manufacturingSpec,
      `${pathPrefix}.${key}`,
      errors
    );
    const sanitizedPreview3DDataUrl = sanitizePreview3DDataUrl(
      specObj.preview3DDataUrl,
      `${pathPrefix}.${key}`,
      errors
    );
    const sanitizedTrueUvDataUrl = sanitizeTrueUvDataUrl(
      specObj.trueUvDataUrl,
      `${pathPrefix}.${key}`,
      errors
    );
    const sanitizedUvExtractionTarget = sanitizeUvExtractionTarget(
      specObj.uvExtractionTarget,
      `${pathPrefix}.${key}`,
      errors
    );

    // Strip legacy raster map DataURLs and transient raw inspection crops so finger_specs_json stays compact
    const {
      uvPatchDataUrl: _uv,
      normalMapDataUrl: _norm,
      displacementMapDataUrl: _disp,
      metalnessMapDataUrl: _met,
      roughnessMapDataUrl: _rough,
      referenceZoomDataUrl: _refZoom,
      preview3DDataUrl: _rawPreview,
      trueUvDataUrl: _rawTrueUv,
      uvExtractionTarget: _rawUvTarget,
      ...cleanSpecFields
    } = specObj;

    const resolvedFidelity =
      specObj.fidelityScore !== undefined
        ? Math.round(clampNumber(specObj.fidelityScore as number, 0, 100))
        : validatedManufacturingSpec?.fidelityScore;

    const resolvedRenderStrategy =
      typeof specObj.renderStrategy === 'string'
        ? (specObj.renderStrategy as NailRenderStrategy)
        : validatedManufacturingSpec?.renderStrategy;

    const sanitizedSpec: NailFingerDesignSpec = {
      ...(cleanSpecFields as unknown as NailFingerDesignSpec),
      fingerId: key as FingerId,
      ...(specObj.freeEdgeRatio !== undefined
        ? { freeEdgeRatio: clampNumber(specObj.freeEdgeRatio as number, 0.12, 1.15) }
        : {}),
      ...(resolvedRenderStrategy !== undefined ? { renderStrategy: resolvedRenderStrategy } : {}),
      ...(sanitizedTrueUvDataUrl !== undefined ? { trueUvDataUrl: sanitizedTrueUvDataUrl } : {}),
      ...(sanitizedUvExtractionTarget !== undefined
        ? { uvExtractionTarget: sanitizedUvExtractionTarget }
        : {}),
      ...(validatedBlueprint !== undefined ? { blueprint: validatedBlueprint } : {}),
      ...(validatedManufacturingSpec !== undefined
        ? { manufacturingSpec: validatedManufacturingSpec }
        : {}),
      ...(sanitizedPreview3DDataUrl !== undefined
        ? { preview3DDataUrl: sanitizedPreview3DDataUrl }
        : {}),
      ...(resolvedFidelity !== undefined ? { fidelityScore: resolvedFidelity } : {}),
    };

    sanitizedMap[key as FingerId] = sanitizedSpec;
  }

  return sanitizedMap as NailFingerSpecsMap;
}

function parseAndValidateFingerSpecsInput(
  rawFingerSpecs: unknown,
  rawFingerSpecsJson: unknown,
  errors: string[]
): {
  provided: boolean;
  value: NailFingerSpecsMap | null;
  envelopeHandSpecsBySide?: NailHandSpecsBySide | null;
  envelopeFidelityScore?: number | null;
  envelopeV13Engine?: boolean;
} {
  if (rawFingerSpecs === undefined && rawFingerSpecsJson === undefined) {
    return { provided: false, value: null };
  }

  let candidate: unknown = rawFingerSpecs;

  if (candidate === undefined && rawFingerSpecsJson !== undefined) {
    if (rawFingerSpecsJson === null) {
      return { provided: true, value: null };
    }
    if (typeof rawFingerSpecsJson !== 'string') {
      errors.push('fingerSpecsJson deve ser uma string JSON válida ou null.');
      return { provided: true, value: null };
    }
    const trimmed = rawFingerSpecsJson.trim();
    if (!trimmed) {
      return { provided: true, value: null };
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      errors.push('fingerSpecsJson contém JSON inválido.');
      return { provided: true, value: null };
    }
  } else if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return { provided: true, value: null };
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      errors.push('fingerSpecs contém JSON inválido.');
      return { provided: true, value: null };
    }
  }

  if (candidate === null) {
    return { provided: true, value: null };
  }

  if (typeof candidate !== 'object' || Array.isArray(candidate)) {
    errors.push(
      'fingerSpecs deve ser um objeto indexado pelos dedos (thumb, index, middle, ring, pinky).'
    );
    return { provided: true, value: null };
  }

  const record = candidate as Record<string, unknown>;

  // Support V11/V13 envelope directly in fingerSpecsJson if sent by a client
  if (
    record.__v11Envelope === true ||
    'fingerSpecs' in record ||
    'handSpecsBySide' in record ||
    'v13Engine' in record
  ) {
    const innerFingerSpecs =
      record.fingerSpecs && typeof record.fingerSpecs === 'object' && !Array.isArray(record.fingerSpecs)
        ? validateAndSanitizeFingerMapRecord(
            record.fingerSpecs as Record<string, unknown>,
            'fingerSpecs',
            errors
          )
        : null;

    const envelopeHandSpecs =
      record.handSpecsBySide !== undefined
        ? parseAndValidateHandSpecsBySideInput(record.handSpecsBySide, errors).value
        : undefined;

    const envelopeScore =
      typeof record.fidelityScore === 'number' && Number.isFinite(record.fidelityScore)
        ? Math.round(clampNumber(record.fidelityScore, 0, 100))
        : undefined;

    const envelopeV13Engine =
      typeof record.v13Engine === 'boolean' ? record.v13Engine : undefined;

    return {
      provided: true,
      value: innerFingerSpecs,
      ...(envelopeHandSpecs !== undefined ? { envelopeHandSpecsBySide: envelopeHandSpecs } : {}),
      ...(envelopeScore !== undefined ? { envelopeFidelityScore: envelopeScore } : {}),
      ...(envelopeV13Engine !== undefined ? { envelopeV13Engine } : {}),
    };
  }

  const validated = validateAndSanitizeFingerMapRecord(record, 'fingerSpecs', errors);
  return {
    provided: true,
    value: validated,
  };
}

function parseAndValidateHandSpecsBySideInput(
  rawHandSpecsBySide: unknown,
  errors: string[]
): { provided: boolean; value: NailHandSpecsBySide | null } {
  if (rawHandSpecsBySide === undefined) {
    return { provided: false, value: null };
  }
  if (rawHandSpecsBySide === null) {
    return { provided: true, value: null };
  }
  if (typeof rawHandSpecsBySide !== 'object' || Array.isArray(rawHandSpecsBySide)) {
    errors.push('handSpecsBySide deve ser um objeto com chaves opcionais Left e Right.');
    return { provided: true, value: null };
  }

  const obj = rawHandSpecsBySide as Record<string, unknown>;
  const out: NailHandSpecsBySide = {};

  for (const key of Object.keys(obj)) {
    if (key !== 'Left' && key !== 'Right') {
      errors.push(`Chave inválida "${key}" em handSpecsBySide. Chaves aceitas: Left, Right.`);
      continue;
    }
    const sideRaw = obj[key];
    if (sideRaw === undefined || sideRaw === null) {
      continue;
    }
    if (typeof sideRaw !== 'object' || Array.isArray(sideRaw)) {
      errors.push(`handSpecsBySide.${key} deve ser um objeto indexado pelos dedos.`);
      continue;
    }
    const sanitizedSide = validateAndSanitizeFingerMapRecord(
      sideRaw as Record<string, unknown>,
      `handSpecsBySide.${key}`,
      errors
    );
    if (sanitizedSide) {
      out[key] = sanitizedSide;
    }
  }

  if (!out.Left && !out.Right) {
    return { provided: true, value: null };
  }

  return { provided: true, value: out };
}

function parseAndValidateTechnicalSheetInput(
  rawTechnicalSheet: unknown,
  rawTechnicalSheetJson: unknown,
  errors: string[]
): { provided: boolean; value: NailTechnicalSheet | null } {
  const source =
    rawTechnicalSheet !== undefined ? rawTechnicalSheet : rawTechnicalSheetJson;

  if (source === undefined) {
    return { provided: false, value: null };
  }
  if (source === null) {
    return { provided: true, value: null };
  }

  let obj: unknown = source;
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (!trimmed) {
      return { provided: true, value: null };
    }
    try {
      obj = JSON.parse(trimmed);
    } catch {
      errors.push('technicalSheetJson deve conter um JSON válido.');
      return { provided: true, value: null };
    }
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push('technicalSheet deve ser um objeto JSON válido ou null.');
    return { provided: true, value: null };
  }

  const raw = obj as Record<string, unknown>;
  if (
    typeof raw.generatedAt !== 'string' ||
    typeof raw.summaryPt !== 'string' ||
    typeof raw.predominantShapePt !== 'string' ||
    typeof raw.predominantExtensionPt !== 'string' ||
    typeof raw.hasAccentFingers !== 'boolean' ||
    typeof raw.whatsappText !== 'string' ||
    !Array.isArray(raw.fingers)
  ) {
    errors.push(
      'technicalSheet inválido: campos obrigatórios (generatedAt, summaryPt, predominantShapePt, predominantExtensionPt, hasAccentFingers, fingers, whatsappText) ausentes ou malformados.'
    );
    return { provided: true, value: null };
  }

  if (raw.fingers.length > 10) {
    errors.push('technicalSheet.fingers deve conter no máximo 10 dedos.');
    return { provided: true, value: null };
  }

  const fingers: NailTechnicalSheetFinger[] = [];
  for (let i = 0; i < raw.fingers.length; i++) {
    const fRaw = raw.fingers[i];
    if (!fRaw || typeof fRaw !== 'object' || Array.isArray(fRaw)) {
      errors.push(`technicalSheet.fingers[${i}] deve ser um objeto válido.`);
      return { provided: true, value: null };
    }
    const f = fRaw as Record<string, unknown>;
    if (
      typeof f.fingerId !== 'string' ||
      !(VALID_FINGER_IDS as readonly string[]).includes(f.fingerId)
    ) {
      errors.push(`technicalSheet.fingers[${i}].fingerId inválido.`);
      return { provided: true, value: null };
    }
    if (!isValidNailShape(f.shape)) {
      errors.push(`technicalSheet.fingers[${i}].shape inválido.`);
      return { provided: true, value: null };
    }
    if (
      typeof f.labelPt !== 'string' ||
      typeof f.shapeLabelPt !== 'string' ||
      typeof f.extensionLevelPt !== 'string' ||
      !isValidHexColor(f.primaryColorHex) ||
      typeof f.finishLabelPt !== 'string' ||
      !Array.isArray(f.artDetailsPt) ||
      !Array.isArray(f.accessoriesPt) ||
      typeof f.isAccentFinger !== 'boolean'
    ) {
      errors.push(`technicalSheet.fingers[${i}] possui campos inválidos.`);
      return { provided: true, value: null };
    }

    let secondaryColorHex: string | undefined;
    if (f.secondaryColorHex !== undefined && f.secondaryColorHex !== null && f.secondaryColorHex !== '') {
      if (!isValidHexColor(f.secondaryColorHex)) {
        errors.push(`technicalSheet.fingers[${i}].secondaryColorHex inválido.`);
        return { provided: true, value: null };
      }
      secondaryColorHex = normalizeHexColor(f.secondaryColorHex);
    }

    fingers.push({
      fingerId: f.fingerId as FingerId,
      labelPt: f.labelPt.trim().slice(0, 80),
      shape: f.shape,
      shapeLabelPt: f.shapeLabelPt.trim().slice(0, 80),
      extensionLevelPt: f.extensionLevelPt.trim().slice(0, 80),
      primaryColorHex: normalizeHexColor(f.primaryColorHex),
      ...(secondaryColorHex ? { secondaryColorHex } : {}),
      finishLabelPt: f.finishLabelPt.trim().slice(0, 120),
      artDetailsPt: f.artDetailsPt
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 200))
        .slice(0, 16),
      accessoriesPt: f.accessoriesPt
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 200))
        .slice(0, 16),
      isAccentFinger: f.isAccentFinger,
    });
  }

  return {
    provided: true,
    value: {
      generatedAt: raw.generatedAt.trim().slice(0, 64),
      summaryPt: raw.summaryPt.trim().slice(0, 600),
      predominantShapePt: raw.predominantShapePt.trim().slice(0, 80),
      predominantExtensionPt: raw.predominantExtensionPt.trim().slice(0, 80),
      hasAccentFingers: raw.hasAccentFingers,
      fingers,
      whatsappText: raw.whatsappText.trim().slice(0, 4000),
    },
  };
}

export function toNailDesignDTO(entity: NailDesign): NailDesignDTO {
  const cleanFingerSpecs =
    entity.fingerSpecs && Object.prototype.hasOwnProperty.call(entity.fingerSpecs, 'toJSON')
      ? ({ ...entity.fingerSpecs } as NailFingerSpecsMap)
      : entity.fingerSpecs;

  return {
    id: entity.id,
    name: entity.name,
    category: entity.category,
    styleType: entity.styleType,
    baseColor: entity.baseColor,
    secondaryColor: entity.secondaryColor,
    accentColor: entity.accentColor,
    finish: entity.finish,
    patternType: entity.patternType,
    imageDataUrl: entity.imageDataUrl,
    defaultScale: entity.defaultScale,
    defaultRotation: entity.defaultRotation,
    defaultOpacity: entity.defaultOpacity,
    isCustomReference: entity.isCustomReference,
    isStudioCatalog: entity.isStudioCatalog,
    detectedShape: entity.detectedShape,
    detectedLength: entity.detectedLength,
    ...(entity.fidelityScore !== undefined && entity.fidelityScore !== null
      ? { fidelityScore: entity.fidelityScore }
      : {}),
    ...(entity.v13Engine !== undefined ? { v13Engine: entity.v13Engine } : {}),
    fingerSpecs: cleanFingerSpecs,
    ...(entity.handSpecsBySide ? { handSpecsBySide: entity.handSpecsBySide } : {}),
    ...(entity.technicalSheet ? { technicalSheet: entity.technicalSheet } : {}),
    createdAt: entity.createdAt,
  };
}

export function validateCreateNailDesignDTO(
  payload: unknown
): NailDesignValidationResult<CreateNailDesignDTO> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload deve ser um objeto JSON válido.'] };
  }

  const input = payload as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof input.name !== 'string' || input.name.trim().length < 2) {
    errors.push('name é obrigatório e deve ter pelo menos 2 caracteres.');
  } else if (input.name.trim().length > 100) {
    errors.push('name deve ter no máximo 100 caracteres.');
  }

  if (!isValidNailCategory(input.category)) {
    errors.push(
      `category inválida. Valores aceitos: ${VALID_NAIL_CATEGORIES.join(', ')}.`
    );
  }

  if (input.id !== undefined) {
    if (typeof input.id !== 'string' || !SLUG_ID_REGEX.test(input.id.trim())) {
      errors.push('id deve conter apenas letras, números, hífen ou underscore (2 a 80 caracteres).');
    }
  }

  const styleType: NailStyleType =
    input.styleType === undefined
      ? input.imageDataUrl
        ? 'image'
        : 'procedural'
      : isValidNailStyleType(input.styleType)
      ? input.styleType
      : 'procedural';

  if (input.styleType !== undefined && !isValidNailStyleType(input.styleType)) {
    errors.push(
      `styleType inválido. Valores aceitos: ${VALID_NAIL_STYLE_TYPES.join(', ')}.`
    );
  }

  const patternType: NailPatternType =
    input.patternType === undefined
      ? styleType === 'image'
        ? 'custom-photo'
        : 'solid'
      : isValidNailPatternType(input.patternType)
      ? input.patternType
      : 'solid';

  if (input.patternType !== undefined && !isValidNailPatternType(input.patternType)) {
    errors.push(
      `patternType inválido. Valores aceitos: ${VALID_NAIL_PATTERN_TYPES.join(', ')}.`
    );
  }

  const baseColor =
    input.baseColor === undefined ? '#F3D5C0' : input.baseColor;
  if (!isValidHexColor(baseColor)) {
    errors.push('baseColor deve ser uma cor hexadecimal válida (ex: #F3D5C0).');
  }

  const accentColor =
    input.accentColor === undefined ? '#FFFFFF' : input.accentColor;
  if (!isValidHexColor(accentColor)) {
    errors.push('accentColor deve ser uma cor hexadecimal válida (ex: #FFFFFF).');
  }

  let secondaryColor: string | null = null;
  if (input.secondaryColor !== undefined && input.secondaryColor !== null) {
    if (typeof input.secondaryColor === 'string' && input.secondaryColor.trim() === '') {
      secondaryColor = null;
    } else if (!isValidHexColor(input.secondaryColor)) {
      errors.push('secondaryColor deve ser uma cor hexadecimal válida ou null.');
    } else {
      secondaryColor = input.secondaryColor.trim().toUpperCase();
    }
  }

  let finish: NailFinish = 'glossy';
  if (input.finish !== undefined) {
    if (!isValidNailFinish(input.finish)) {
      errors.push(
        `finish inválido. Valores aceitos: ${VALID_NAIL_FINISHES.join(', ')}.`
      );
    } else {
      finish = input.finish;
    }
  }

  let imageDataUrl: string | null = null;
  if (input.imageDataUrl !== undefined && input.imageDataUrl !== null) {
    if (typeof input.imageDataUrl !== 'string') {
      errors.push('imageDataUrl deve ser uma string válida ou null.');
    } else {
      const trimmed = input.imageDataUrl.trim();
      if (trimmed.length > 0) {
        if (
          !trimmed.startsWith('data:image/') &&
          !trimmed.startsWith('http://') &&
          !trimmed.startsWith('https://') &&
          !trimmed.startsWith('/')
        ) {
          errors.push('imageDataUrl deve ser uma data:image/*, URL HTTP(S) ou caminho relativo.');
        } else {
          imageDataUrl = trimmed;
        }
      }
    }
  }

  if (styleType === 'image' && !imageDataUrl) {
    errors.push('imageDataUrl é obrigatório quando styleType é "image".');
  }

  const defaultScale = input.defaultScale === undefined ? 1.0 : input.defaultScale;
  if (!isFiniteNumberInRange(defaultScale, 0.2, 4.0)) {
    errors.push('defaultScale deve ser um número entre 0.2 e 4.0.');
  }

  const defaultRotation = input.defaultRotation === undefined ? 0 : input.defaultRotation;
  if (!isFiniteNumberInRange(defaultRotation, -180, 180)) {
    errors.push('defaultRotation deve ser um número entre -180 e 180.');
  }

  const defaultOpacity = input.defaultOpacity === undefined ? 0.92 : input.defaultOpacity;
  if (!isFiniteNumberInRange(defaultOpacity, 0.05, 1.0)) {
    errors.push('defaultOpacity deve ser um número entre 0.05 e 1.0.');
  }

  let isCustomReference = false;
  if (input.isCustomReference !== undefined) {
    if (typeof input.isCustomReference !== 'boolean') {
      errors.push('isCustomReference deve ser boolean.');
    } else {
      isCustomReference = input.isCustomReference;
    }
  }

  let isStudioCatalog = false;
  if (input.isStudioCatalog !== undefined) {
    if (typeof input.isStudioCatalog !== 'boolean') {
      errors.push('isStudioCatalog deve ser boolean.');
    } else {
      isStudioCatalog = input.isStudioCatalog;
    }
  }

  let detectedShape: NailShape | null = null;
  if (input.detectedShape !== undefined && input.detectedShape !== null) {
    if (!isValidNailShape(input.detectedShape)) {
      errors.push(
        `detectedShape inválido. Valores aceitos: ${VALID_NAIL_SHAPES.join(', ')}.`
      );
    } else {
      detectedShape = input.detectedShape;
    }
  }

  let detectedLength: number | null = null;
  if (input.detectedLength !== undefined && input.detectedLength !== null) {
    if (!isFiniteNumberInRange(input.detectedLength, 0.4, 3.0)) {
      errors.push('detectedLength deve ser um número finito entre 0.4 e 3.0.');
    } else {
      detectedLength = input.detectedLength;
    }
  }

  let fidelityScore: number | null = null;
  if (input.fidelityScore !== undefined && input.fidelityScore !== null) {
    if (!isFiniteNumberInRange(input.fidelityScore, 0, 100)) {
      errors.push('fidelityScore deve ser um número finito entre 0 e 100.');
    } else {
      fidelityScore = Math.round(input.fidelityScore);
    }
  }

  let v13Engine: boolean | undefined;
  if (input.v13Engine !== undefined && input.v13Engine !== null) {
    if (typeof input.v13Engine !== 'boolean') {
      errors.push('v13Engine deve ser boolean.');
    } else {
      v13Engine = input.v13Engine;
    }
  }

  const parsedFingerSpecs = parseAndValidateFingerSpecsInput(
    input.fingerSpecs,
    input.fingerSpecsJson,
    errors
  );

  const parsedHandSpecsBySide = parseAndValidateHandSpecsBySideInput(
    input.handSpecsBySide,
    errors
  );

  const parsedTechnicalSheet = parseAndValidateTechnicalSheetInput(
    input.technicalSheet,
    input.technicalSheetJson ?? input.technical_sheet_json,
    errors
  );

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const resolvedHandSpecsBySide = parsedHandSpecsBySide.provided
    ? parsedHandSpecsBySide.value
    : parsedFingerSpecs.envelopeHandSpecsBySide ?? null;

  const resolvedFidelityScore =
    fidelityScore ?? parsedFingerSpecs.envelopeFidelityScore ?? null;

  const resolvedV13Engine =
    v13Engine ?? parsedFingerSpecs.envelopeV13Engine;

  const resolvedFingerSpecs = attachV11SerializationEnvelope(
    parsedFingerSpecs.provided ? parsedFingerSpecs.value : null,
    resolvedHandSpecsBySide,
    resolvedFidelityScore,
    resolvedV13Engine
  );

  const resolvedIsCustom =
    input.isCustomReference !== undefined
      ? isCustomReference
      : input.category === 'cliente' || styleType === 'image';

  const resolvedIsStudioCatalog =
    input.isStudioCatalog !== undefined
      ? isStudioCatalog
      : input.category === 'estudio';

  const result: CreateNailDesignDTO = {
    ...(input.id !== undefined ? { id: (input.id as string).trim() } : {}),
    name: (input.name as string).trim(),
    category: input.category as NailCategory,
    styleType,
    baseColor: (baseColor as string).trim().toUpperCase(),
    secondaryColor,
    accentColor: (accentColor as string).trim().toUpperCase(),
    finish,
    patternType,
    imageDataUrl,
    defaultScale: defaultScale as number,
    defaultRotation: defaultRotation as number,
    defaultOpacity: defaultOpacity as number,
    isCustomReference: resolvedIsCustom,
    isStudioCatalog: resolvedIsStudioCatalog,
    detectedShape,
    detectedLength,
    ...(resolvedFidelityScore !== null ? { fidelityScore: resolvedFidelityScore } : {}),
    ...(resolvedV13Engine !== undefined ? { v13Engine: resolvedV13Engine } : {}),
    fingerSpecs: resolvedFingerSpecs,
    ...(resolvedHandSpecsBySide ? { handSpecsBySide: resolvedHandSpecsBySide } : {}),
    ...(parsedTechnicalSheet.provided ? { technicalSheet: parsedTechnicalSheet.value } : {}),
  };

  return { valid: true, data: result };
}

export function validateUpdateNailDesignDTO(
  payload: unknown
): NailDesignValidationResult<UpdateNailDesignDTO> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload deve ser um objeto JSON válido.'] };
  }

  const input = payload as Record<string, unknown>;
  const errors: string[] = [];
  const sanitized: UpdateNailDesignDTO = {};

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2) {
      errors.push('name deve ter pelo menos 2 caracteres.');
    } else if (input.name.trim().length > 100) {
      errors.push('name deve ter no máximo 100 caracteres.');
    } else {
      sanitized.name = input.name.trim();
    }
  }

  if (input.category !== undefined) {
    if (!isValidNailCategory(input.category)) {
      errors.push(
        `category inválida. Valores aceitos: ${VALID_NAIL_CATEGORIES.join(', ')}.`
      );
    } else {
      sanitized.category = input.category;
    }
  }

  if (input.styleType !== undefined) {
    if (!isValidNailStyleType(input.styleType)) {
      errors.push(
        `styleType inválido. Valores aceitos: ${VALID_NAIL_STYLE_TYPES.join(', ')}.`
      );
    } else {
      sanitized.styleType = input.styleType;
    }
  }

  if (input.baseColor !== undefined) {
    if (!isValidHexColor(input.baseColor)) {
      errors.push('baseColor deve ser uma cor hexadecimal válida.');
    } else {
      sanitized.baseColor = input.baseColor.trim().toUpperCase();
    }
  }

  if (input.secondaryColor !== undefined) {
    if (input.secondaryColor === null) {
      sanitized.secondaryColor = null;
    } else if (typeof input.secondaryColor === 'string' && input.secondaryColor.trim() === '') {
      sanitized.secondaryColor = null;
    } else if (!isValidHexColor(input.secondaryColor)) {
      errors.push('secondaryColor deve ser uma cor hexadecimal válida ou null.');
    } else {
      sanitized.secondaryColor = input.secondaryColor.trim().toUpperCase();
    }
  }

  if (input.accentColor !== undefined) {
    if (!isValidHexColor(input.accentColor)) {
      errors.push('accentColor deve ser uma cor hexadecimal válida.');
    } else {
      sanitized.accentColor = input.accentColor.trim().toUpperCase();
    }
  }

  if (input.finish !== undefined) {
    if (!isValidNailFinish(input.finish)) {
      errors.push(
        `finish inválido. Valores aceitos: ${VALID_NAIL_FINISHES.join(', ')}.`
      );
    } else {
      sanitized.finish = input.finish;
    }
  }

  if (input.patternType !== undefined) {
    if (!isValidNailPatternType(input.patternType)) {
      errors.push(
        `patternType inválido. Valores aceitos: ${VALID_NAIL_PATTERN_TYPES.join(', ')}.`
      );
    } else {
      sanitized.patternType = input.patternType;
    }
  }

  if (input.imageDataUrl !== undefined) {
    if (input.imageDataUrl === null) {
      sanitized.imageDataUrl = null;
    } else if (typeof input.imageDataUrl !== 'string') {
      errors.push('imageDataUrl deve ser uma string válida ou null.');
    } else {
      const trimmed = input.imageDataUrl.trim();
      if (trimmed.length === 0) {
        sanitized.imageDataUrl = null;
      } else if (
        !trimmed.startsWith('data:image/') &&
        !trimmed.startsWith('http://') &&
        !trimmed.startsWith('https://') &&
        !trimmed.startsWith('/')
      ) {
        errors.push('imageDataUrl deve ser uma data:image/*, URL HTTP(S) ou caminho relativo.');
      } else {
        sanitized.imageDataUrl = trimmed;
      }
    }
  }

  if (input.defaultScale !== undefined) {
    if (!isFiniteNumberInRange(input.defaultScale, 0.2, 4.0)) {
      errors.push('defaultScale deve ser um número entre 0.2 e 4.0.');
    } else {
      sanitized.defaultScale = input.defaultScale;
    }
  }

  if (input.defaultRotation !== undefined) {
    if (!isFiniteNumberInRange(input.defaultRotation, -180, 180)) {
      errors.push('defaultRotation deve ser um número entre -180 e 180.');
    } else {
      sanitized.defaultRotation = input.defaultRotation;
    }
  }

  if (input.defaultOpacity !== undefined) {
    if (!isFiniteNumberInRange(input.defaultOpacity, 0.05, 1.0)) {
      errors.push('defaultOpacity deve ser um número entre 0.05 e 1.0.');
    } else {
      sanitized.defaultOpacity = input.defaultOpacity;
    }
  }

  if (input.isCustomReference !== undefined) {
    if (typeof input.isCustomReference !== 'boolean') {
      errors.push('isCustomReference deve ser boolean.');
    } else {
      sanitized.isCustomReference = input.isCustomReference;
    }
  }

  if (input.isStudioCatalog !== undefined) {
    if (typeof input.isStudioCatalog !== 'boolean') {
      errors.push('isStudioCatalog deve ser boolean.');
    } else {
      sanitized.isStudioCatalog = input.isStudioCatalog;
    }
  }

  if (input.detectedShape !== undefined) {
    if (input.detectedShape === null) {
      sanitized.detectedShape = null;
    } else if (!isValidNailShape(input.detectedShape)) {
      errors.push(
        `detectedShape inválido. Valores aceitos: ${VALID_NAIL_SHAPES.join(', ')}.`
      );
    } else {
      sanitized.detectedShape = input.detectedShape;
    }
  }

  if (input.detectedLength !== undefined) {
    if (input.detectedLength === null) {
      sanitized.detectedLength = null;
    } else if (!isFiniteNumberInRange(input.detectedLength, 0.4, 3.0)) {
      errors.push('detectedLength deve ser um número finito entre 0.4 e 3.0.');
    } else {
      sanitized.detectedLength = input.detectedLength;
    }
  }

  if (input.fidelityScore !== undefined) {
    if (input.fidelityScore === null) {
      sanitized.fidelityScore = null;
    } else if (!isFiniteNumberInRange(input.fidelityScore, 0, 100)) {
      errors.push('fidelityScore deve ser um número finito entre 0 e 100.');
    } else {
      sanitized.fidelityScore = Math.round(input.fidelityScore);
    }
  }

  if (input.v13Engine !== undefined && input.v13Engine !== null) {
    if (typeof input.v13Engine !== 'boolean') {
      errors.push('v13Engine deve ser boolean.');
    } else {
      sanitized.v13Engine = input.v13Engine;
    }
  }

  const parsedFingerSpecs = parseAndValidateFingerSpecsInput(
    input.fingerSpecs,
    input.fingerSpecsJson,
    errors
  );

  const parsedHandSpecsBySide = parseAndValidateHandSpecsBySideInput(
    input.handSpecsBySide,
    errors
  );

  const parsedTechnicalSheet = parseAndValidateTechnicalSheetInput(
    input.technicalSheet,
    input.technicalSheetJson ?? input.technical_sheet_json,
    errors
  );

  const resolvedHandSpecsBySide = parsedHandSpecsBySide.provided
    ? parsedHandSpecsBySide.value
    : parsedFingerSpecs.envelopeHandSpecsBySide;

  const resolvedFidelityScore =
    sanitized.fidelityScore !== undefined
      ? sanitized.fidelityScore
      : parsedFingerSpecs.envelopeFidelityScore;

  const resolvedV13Engine =
    sanitized.v13Engine !== undefined
      ? sanitized.v13Engine
      : parsedFingerSpecs.envelopeV13Engine;

  if (
    parsedFingerSpecs.provided ||
    parsedHandSpecsBySide.provided ||
    resolvedV13Engine !== undefined
  ) {
    const baseFingerSpecs = parsedFingerSpecs.provided ? parsedFingerSpecs.value : null;
    sanitized.fingerSpecs = attachV11SerializationEnvelope(
      baseFingerSpecs,
      resolvedHandSpecsBySide,
      resolvedFidelityScore,
      resolvedV13Engine
    );
  }
  if (resolvedHandSpecsBySide !== undefined) {
    sanitized.handSpecsBySide = resolvedHandSpecsBySide;
  }
  if (parsedTechnicalSheet.provided) {
    sanitized.technicalSheet = parsedTechnicalSheet.value;
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: sanitized };
}
