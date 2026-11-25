import type { StudioConfig, ThemePreset } from '../entities/StudioConfig.js';

export const VALID_THEME_PRESETS: readonly ThemePreset[] = [
  'rose-gold',
  'obsidian-gold',
  'minimalist-pearl',
  'soft-lilac',
  'custom',
] as const;

export interface StudioConfigDTO {
  id: number;
  studioName: string;
  whatsapp: string;
  logoDataUrl: string | null;
  themePreset: ThemePreset;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  updatedAt: string;
}

export interface UpdateStudioConfigDTO {
  studioName?: string;
  whatsapp?: string;
  logoDataUrl?: string | null;
  themePreset?: ThemePreset;
  primaryColor?: string;
  accentColor?: string;
  surfaceColor?: string;
}

export type ValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; errors: string[] };

const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value.trim());
}

export function isValidThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && (VALID_THEME_PRESETS as readonly string[]).includes(value);
}

export function toStudioConfigDTO(entity: StudioConfig): StudioConfigDTO {
  return {
    id: entity.id,
    studioName: entity.studioName,
    whatsapp: entity.whatsapp,
    logoDataUrl: entity.logoDataUrl,
    themePreset: entity.themePreset,
    primaryColor: entity.primaryColor,
    accentColor: entity.accentColor,
    surfaceColor: entity.surfaceColor,
    updatedAt: entity.updatedAt,
  };
}

export function validateUpdateStudioConfigDTO(
  payload: unknown
): ValidationResult<UpdateStudioConfigDTO> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload deve ser um objeto JSON válido.'] };
  }

  const input = payload as Record<string, unknown>;
  const errors: string[] = [];
  const sanitized: UpdateStudioConfigDTO = {};

  if (input.studioName !== undefined) {
    if (typeof input.studioName !== 'string' || input.studioName.trim().length < 2) {
      errors.push('studioName deve ter pelo menos 2 caracteres.');
    } else if (input.studioName.trim().length > 100) {
      errors.push('studioName deve ter no máximo 100 caracteres.');
    } else {
      sanitized.studioName = input.studioName.trim();
    }
  }

  if (input.whatsapp !== undefined) {
    if (typeof input.whatsapp !== 'string') {
      errors.push('whatsapp deve ser uma string.');
    } else {
      const digits = input.whatsapp.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) {
        errors.push('whatsapp deve conter entre 10 e 15 dígitos numéricos.');
      } else {
        sanitized.whatsapp = digits;
      }
    }
  }

  if (input.logoDataUrl !== undefined) {
    if (input.logoDataUrl === null) {
      sanitized.logoDataUrl = null;
    } else if (typeof input.logoDataUrl !== 'string') {
      errors.push('logoDataUrl deve ser uma string data URL válida ou null.');
    } else {
      const trimmed = input.logoDataUrl.trim();
      if (trimmed.length === 0) {
        sanitized.logoDataUrl = null;
      } else if (
        !trimmed.startsWith('data:image/') &&
        !trimmed.startsWith('http://') &&
        !trimmed.startsWith('https://') &&
        !trimmed.startsWith('/')
      ) {
        errors.push('logoDataUrl deve ser uma data:image/*, URL HTTP(S) ou caminho relativo.');
      } else {
        sanitized.logoDataUrl = trimmed;
      }
    }
  }

  if (input.themePreset !== undefined) {
    if (!isValidThemePreset(input.themePreset)) {
      errors.push(
        `themePreset inválido. Valores aceitos: ${VALID_THEME_PRESETS.join(', ')}.`
      );
    } else {
      sanitized.themePreset = input.themePreset;
    }
  }

  if (input.primaryColor !== undefined) {
    if (!isValidHexColor(input.primaryColor)) {
      errors.push('primaryColor deve ser uma cor hexadecimal válida (ex: #D4A383).');
    } else {
      sanitized.primaryColor = input.primaryColor.trim().toUpperCase();
    }
  }

  if (input.accentColor !== undefined) {
    if (!isValidHexColor(input.accentColor)) {
      errors.push('accentColor deve ser uma cor hexadecimal válida (ex: #F3D5C0).');
    } else {
      sanitized.accentColor = input.accentColor.trim().toUpperCase();
    }
  }

  if (input.surfaceColor !== undefined) {
    if (!isValidHexColor(input.surfaceColor)) {
      errors.push('surfaceColor deve ser uma cor hexadecimal válida (ex: #171214).');
    } else {
      sanitized.surfaceColor = input.surfaceColor.trim().toUpperCase();
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, data: sanitized };
}
