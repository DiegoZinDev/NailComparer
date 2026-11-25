import {
  toStudioConfigDTO,
  validateUpdateStudioConfigDTO,
  type StudioConfigDTO,
} from '../dtos/StudioConfigDto.js';
import type { StudioConfig, ThemePreset } from '../entities/StudioConfig.js';
import { StudioConfigRepository } from '../repositories/StudioConfigRepository.js';
import { BadRequestError } from './AppError.js';

const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  id: 1,
  studioName: 'Atelier Lumière Nails',
  whatsapp: '5561998421030',
  logoDataUrl: null,
  themePreset: 'rose-gold',
  primaryColor: '#D4A383',
  accentColor: '#F3D5C0',
  surfaceColor: '#171214',
  updatedAt: new Date().toISOString(),
};

interface ThemePaletteDefaults {
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  onSurfaceColor: string;
}

const THEME_PALETTES: Record<Exclude<ThemePreset, 'custom'>, ThemePaletteDefaults> = {
  'rose-gold': {
    primaryColor: '#D4A383',
    accentColor: '#F3D5C0',
    surfaceColor: '#171214',
    onSurfaceColor: '#FAF5F2',
  },
  'obsidian-gold': {
    primaryColor: '#D4AF37',
    accentColor: '#F5E1A4',
    surfaceColor: '#0B0B0D',
    onSurfaceColor: '#FBF8EF',
  },
  'minimalist-pearl': {
    primaryColor: '#231F20',
    accentColor: '#B89F8D',
    surfaceColor: '#F7F5F2',
    onSurfaceColor: '#1C191A',
  },
  'soft-lilac': {
    primaryColor: '#B997D6',
    accentColor: '#E5D4F2',
    surfaceColor: '#15111B',
    onSurfaceColor: '#F8F4FC',
  },
};

export type StudioConfigResponseDTO = StudioConfigDTO & {
  whatsappNumber: string;
  onSurfaceColor: string;
};

export class StudioConfigService {
  private readonly studioConfigRepository: StudioConfigRepository;

  constructor(studioConfigRepository = new StudioConfigRepository()) {
    this.studioConfigRepository = studioConfigRepository;
  }

  getConfig(): StudioConfigResponseDTO {
    const existing = this.studioConfigRepository.getConfig();
    if (existing) {
      return this.enrichResponseDto(toStudioConfigDTO(existing));
    }

    const seeded = this.studioConfigRepository.upsertConfig({
      ...DEFAULT_STUDIO_CONFIG,
      updatedAt: new Date().toISOString(),
    });
    return this.enrichResponseDto(toStudioConfigDTO(seeded));
  }

  updateConfig(payload: unknown): StudioConfigResponseDTO {
    const normalizedPayload = this.normalizeIncomingPayload(payload);
    const validation = validateUpdateStudioConfigDTO(normalizedPayload);

    if (!validation.valid) {
      throw new BadRequestError(validation.errors.join(' '), validation.errors);
    }

    const current = this.studioConfigRepository.getConfig() ?? {
      ...DEFAULT_STUDIO_CONFIG,
      updatedAt: new Date().toISOString(),
    };

    const incoming = validation.data;
    const nextThemePreset = incoming.themePreset ?? current.themePreset;
    const presetColors =
      incoming.themePreset && incoming.themePreset !== 'custom'
        ? THEME_PALETTES[incoming.themePreset]
        : undefined;

    const merged: StudioConfig = {
      id: 1,
      studioName: incoming.studioName ?? current.studioName,
      whatsapp: incoming.whatsapp ?? current.whatsapp,
      logoDataUrl:
        incoming.logoDataUrl !== undefined ? incoming.logoDataUrl : current.logoDataUrl,
      themePreset: nextThemePreset,
      primaryColor:
        incoming.primaryColor ?? presetColors?.primaryColor ?? current.primaryColor,
      accentColor:
        incoming.accentColor ?? presetColors?.accentColor ?? current.accentColor,
      surfaceColor:
        incoming.surfaceColor ?? presetColors?.surfaceColor ?? current.surfaceColor,
      updatedAt: new Date().toISOString(),
    };

    const saved = this.studioConfigRepository.upsertConfig(merged);
    return this.enrichResponseDto(toStudioConfigDTO(saved));
  }

  private normalizeIncomingPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    const raw = payload as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...raw };

    if (normalized.whatsapp === undefined && raw.whatsappNumber !== undefined) {
      normalized.whatsapp = raw.whatsappNumber;
    }

    if (typeof normalized.whatsapp === 'string' && normalized.whatsapp.trim() === '') {
      delete normalized.whatsapp;
    }

    return normalized;
  }

  private enrichResponseDto(dto: StudioConfigDTO): StudioConfigResponseDTO {
    const onSurfaceColor =
      dto.themePreset !== 'custom'
        ? THEME_PALETTES[dto.themePreset].onSurfaceColor
        : this.isLightHexColor(dto.surfaceColor)
        ? '#1C191A'
        : '#FAF5F2';

    return {
      ...dto,
      whatsappNumber: dto.whatsapp,
      onSurfaceColor,
    };
  }

  private isLightHexColor(hex: string): boolean {
    const clean = hex.replace('#', '');
    const full =
      clean.length === 3
        ? clean
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : clean.slice(0, 6);
    if (full.length !== 6) return false;
    const r = Number.parseInt(full.slice(0, 2), 16);
    const g = Number.parseInt(full.slice(2, 4), 16);
    const b = Number.parseInt(full.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.62;
  }
}
