import type { NailDesign, StudioConfig, ThemePresetDefinition } from '../types/nail';

export const THEME_PRESETS: ThemePresetDefinition[] = [
  {
    id: 'rose-gold',
    name: 'Rose Gold & Nude',
    subtitle: 'Editorial Quente',
    primaryColor: '#D4A383',
    accentColor: '#F3D5C0',
    surfaceColor: '#171214',
    onSurfaceColor: '#FAF5F2',
  },
  {
    id: 'obsidian-gold',
    name: 'Obsidian & Gold',
    subtitle: 'Alta Joalheria',
    primaryColor: '#D4AF37',
    accentColor: '#F5E1A4',
    surfaceColor: '#0B0B0D',
    onSurfaceColor: '#FBF8EF',
  },
  {
    id: 'minimalist-pearl',
    name: 'Minimalist Pearl',
    subtitle: 'Branco Boutique',
    primaryColor: '#231F20',
    accentColor: '#B89F8D',
    surfaceColor: '#F7F5F2',
    onSurfaceColor: '#1C191A',
  },
  {
    id: 'soft-lilac',
    name: 'Soft Lilac',
    subtitle: 'Lavanda Sutil',
    primaryColor: '#B997D6',
    accentColor: '#E5D4F2',
    surfaceColor: '#15111B',
    onSurfaceColor: '#F8F4FC',
  },
];

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  id: 1,
  studioName: 'Atelier Lumière Nails',
  logoDataUrl: null,
  themePreset: 'rose-gold',
  primaryColor: '#D4A383',
  accentColor: '#F3D5C0',
  surfaceColor: '#171214',
  onSurfaceColor: '#FAF5F2',
  whatsappNumber: '5511999999999',
};

export const SEED_NAIL_DESIGNS: NailDesign[] = [];

