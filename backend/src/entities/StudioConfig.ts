export type ThemePreset =
  | 'rose-gold'
  | 'obsidian-gold'
  | 'minimalist-pearl'
  | 'soft-lilac'
  | 'custom';

export interface StudioConfigRow {
  id: number;
  studio_name: string;
  whatsapp: string;
  logo_data_url: string | null;
  theme_preset: string;
  primary_color: string;
  accent_color: string;
  surface_color: string;
  updated_at: string;
}

export interface StudioConfig {
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

export function mapStudioConfigRowToEntity(row: StudioConfigRow): StudioConfig {
  return {
    id: Number(row.id),
    studioName: row.studio_name,
    whatsapp: row.whatsapp,
    logoDataUrl: row.logo_data_url ?? null,
    themePreset: row.theme_preset as ThemePreset,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    surfaceColor: row.surface_color,
    updatedAt: row.updated_at,
  };
}
