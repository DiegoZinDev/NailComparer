export type ThemePresetId =
  | 'rose-gold'
  | 'obsidian-gold'
  | 'minimalist-pearl'
  | 'soft-lilac'
  | 'custom';

export interface StudioConfig {
  id?: number;
  studioName: string;
  logoDataUrl: string | null;
  themePreset: ThemePresetId;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  onSurfaceColor: string;
  whatsappNumber: string;
  updatedAt?: string;
}

export interface ThemePresetDefinition {
  id: Exclude<ThemePresetId, 'custom'>;
  name: string;
  subtitle: string;
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  onSurfaceColor: string;
}

export type NailCategory =
  | 'Todas'
  | 'Francesinha'
  | 'Gel'
  | 'Cromado'
  | 'Nail Art'
  | 'Cliente';

export type NailPatternType =
  | 'solid'
  | 'french'
  | 'ombre'
  | 'chrome'
  | 'marble'
  | 'gold-foil'
  | 'cat-eye'
  | 'aurora';

export interface NailDesign {
  id: string;
  name: string;
  category: Exclude<NailCategory, 'Todas'>;
  patternType: NailPatternType;
  baseColor: string;
  secondaryColor?: string;
  accentColor?: string;
  finish: 'glossy' | 'chrome' | 'velvet' | 'glitter';
  imageDataUrl?: string | null;
  isCustom?: boolean;
  createdAt?: string;
}

export interface NailAdjustment {
  scale: number; // 0.6 to 1.6
  rotationDeg: number; // -45 to +45
  opacity: number; // 0.35 to 1.0
  shape: 'almond' | 'oval' | 'coffin';
}

export type ARViewMode = 'camera' | 'studio-demo';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface FingerPose {
  id: 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
  tip: NormalizedPoint;
  dip: NormalizedPoint;
  widthScale: number;
  lengthScale: number;
}
