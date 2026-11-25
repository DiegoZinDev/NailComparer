import type {
  NailCategory,
  NailDesign,
  NailPatternType,
  NailStyleType,
} from '../entities/NailDesign.js';

export const VALID_NAIL_CATEGORIES: readonly NailCategory[] = [
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

export interface NailDesignDTO {
  id: string;
  name: string;
  category: NailCategory;
  styleType: NailStyleType;
  baseColor: string;
  accentColor: string;
  patternType: NailPatternType;
  imageDataUrl: string | null;
  defaultScale: number;
  defaultRotation: number;
  defaultOpacity: number;
  isCustomReference: boolean;
  createdAt: string;
}

export interface CreateNailDesignDTO {
  id?: string;
  name: string;
  category: NailCategory;
  styleType?: NailStyleType;
  baseColor?: string;
  accentColor?: string;
  patternType?: NailPatternType;
  imageDataUrl?: string | null;
  defaultScale?: number;
  defaultRotation?: number;
  defaultOpacity?: number;
  isCustomReference?: boolean;
}

export interface UpdateNailDesignDTO {
  name?: string;
  category?: NailCategory;
  styleType?: NailStyleType;
  baseColor?: string;
  accentColor?: string;
  patternType?: NailPatternType;
  imageDataUrl?: string | null;
  defaultScale?: number;
  defaultRotation?: number;
  defaultOpacity?: number;
  isCustomReference?: boolean;
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

function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value.trim());
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function toNailDesignDTO(entity: NailDesign): NailDesignDTO {
  return {
    id: entity.id,
    name: entity.name,
    category: entity.category,
    styleType: entity.styleType,
    baseColor: entity.baseColor,
    accentColor: entity.accentColor,
    patternType: entity.patternType,
    imageDataUrl: entity.imageDataUrl,
    defaultScale: entity.defaultScale,
    defaultRotation: entity.defaultRotation,
    defaultOpacity: entity.defaultOpacity,
    isCustomReference: entity.isCustomReference,
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

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const result: CreateNailDesignDTO = {
    ...(input.id !== undefined ? { id: (input.id as string).trim() } : {}),
    name: (input.name as string).trim(),
    category: input.category as NailCategory,
    styleType,
    baseColor: (baseColor as string).trim().toUpperCase(),
    accentColor: (accentColor as string).trim().toUpperCase(),
    patternType,
    imageDataUrl,
    defaultScale: defaultScale as number,
    defaultRotation: defaultRotation as number,
    defaultOpacity: defaultOpacity as number,
    isCustomReference:
      input.isCustomReference !== undefined
        ? isCustomReference
        : input.category === 'cliente' || styleType === 'image',
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

  if (input.accentColor !== undefined) {
    if (!isValidHexColor(input.accentColor)) {
      errors.push('accentColor deve ser uma cor hexadecimal válida.');
    } else {
      sanitized.accentColor = input.accentColor.trim().toUpperCase();
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

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: sanitized };
}
