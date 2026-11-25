import type {
  FingerId,
  MicroGemElement,
  NailBaseLayer,
  NailBorderKind,
  NailBorderLayer,
  NailCategory,
  NailDesign,
  NailDesignBlueprint,
  NailFingerDesignSpec,
  NailFingerSpecsMap,
  NailFinish,
  NailFinishV10,
  NailGeometryProfile,
  NailGradientMode,
  NailPatternType,
  NailShape,
  NailStyleType,
  OrganicMotifElement,
  RibbonStrokeElement,
  VectorArtElement,
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
  fingerSpecs: NailFingerSpecsMap | null;
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
  fingerSpecs?: NailFingerSpecsMap | null;
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
  fingerSpecs?: NailFingerSpecsMap | null;
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

function parseAndValidateFingerSpecsInput(
  rawFingerSpecs: unknown,
  rawFingerSpecsJson: unknown,
  errors: string[]
): { provided: boolean; value: NailFingerSpecsMap | null } {
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
  const keys = Object.keys(record);
  if (keys.length === 0) {
    errors.push('fingerSpecs não pode ser um objeto vazio.');
    return { provided: true, value: null };
  }

  const sanitizedMap: Partial<Record<FingerId, NailFingerDesignSpec>> = {};
  for (const key of keys) {
    if (!(VALID_FINGER_IDS as readonly string[]).includes(key)) {
      errors.push(
        `Chave inválida "${key}" em fingerSpecs. Dedos aceitos: ${VALID_FINGER_IDS.join(', ')}.`
      );
      continue;
    }
    const spec = record[key];
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      errors.push(`fingerSpecs.${key} deve ser um objeto válido.`);
      continue;
    }
    const specObj = spec as Record<string, unknown>;
    if (specObj.shape !== undefined && !isValidNailShape(specObj.shape)) {
      errors.push(
        `fingerSpecs.${key}.shape inválido. Valores aceitos: ${VALID_NAIL_SHAPES.join(', ')}.`
      );
      continue;
    }

    if (
      specObj.freeEdgeRatio !== undefined &&
      !isFiniteNumberInRange(specObj.freeEdgeRatio, 0.0, 2.0)
    ) {
      errors.push(`fingerSpecs.${key}.freeEdgeRatio deve ser um número entre 0 e 2.`);
      continue;
    }

    if (
      specObj.finishStyle !== undefined &&
      (typeof specObj.finishStyle !== 'string' ||
        !(VALID_NAIL_FINISHES_V10 as readonly string[]).includes(specObj.finishStyle))
    ) {
      errors.push(
        `fingerSpecs.${key}.finishStyle inválido. Valores aceitos: ${VALID_NAIL_FINISHES_V10.join(', ')}.`
      );
      continue;
    }

    const validatedBlueprint = validateAndSanitizeBlueprint(specObj.blueprint, key, errors);

    // Strip legacy raster map DataURLs so finger_specs_json stays compact (~2-6 KB)
    const {
      uvPatchDataUrl: _uv,
      normalMapDataUrl: _norm,
      displacementMapDataUrl: _disp,
      metalnessMapDataUrl: _met,
      roughnessMapDataUrl: _rough,
      ...cleanSpecFields
    } = specObj;

    const sanitizedSpec: NailFingerDesignSpec = {
      ...(cleanSpecFields as unknown as NailFingerDesignSpec),
      fingerId: key as FingerId,
      ...(specObj.freeEdgeRatio !== undefined
        ? { freeEdgeRatio: clampNumber(specObj.freeEdgeRatio as number, 0.12, 1.15) }
        : {}),
      ...(validatedBlueprint !== undefined ? { blueprint: validatedBlueprint } : {}),
    };

    sanitizedMap[key as FingerId] = sanitizedSpec;
  }

  return {
    provided: true,
    value: sanitizedMap as NailFingerSpecsMap,
  };
}

export function toNailDesignDTO(entity: NailDesign): NailDesignDTO {
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
    fingerSpecs: entity.fingerSpecs,
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

  const parsedFingerSpecs = parseAndValidateFingerSpecsInput(
    input.fingerSpecs,
    input.fingerSpecsJson,
    errors
  );

  if (errors.length > 0) {
    return { valid: false, errors };
  }

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
    fingerSpecs: parsedFingerSpecs.provided ? parsedFingerSpecs.value : null,
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

  const parsedFingerSpecs = parseAndValidateFingerSpecsInput(
    input.fingerSpecs,
    input.fingerSpecsJson,
    errors
  );
  if (parsedFingerSpecs.provided) {
    sanitized.fingerSpecs = parsedFingerSpecs.value;
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: sanitized };
}
