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

export type DockTab = 'client' | 'studio';

export type NailPatternType =
  | 'solid'
  | 'french'
  | 'ombre'
  | 'chrome'
  | 'marble'
  | 'gold-foil'
  | 'cat-eye'
  | 'aurora';

export type NailShape = 'natural' | 'almond' | 'square' | 'coffin' | 'stiletto';

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
  shape: NailShape;
  extensionLength: number; // 0.75 (curto/natural) to 1.75 (longo)
  scale: number; // width/fit multiplier 0.75 to 1.35
  rotationDeg: number; // -30 to +30
  opacity: number; // 0.65 to 1.0
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
  pip?: NormalizedPoint;
  widthScale: number;
  lengthScale: number;
}
