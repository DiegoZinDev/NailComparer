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

export type FingerId = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export type ArtisticPattern =
  | 'solid_gloss'
  | 'chrome_mirror'
  | 'gold_3d_waves'
  | 'aura_gradient'
  | 'french_tip'
  | 'floral_accent';

export interface StrokeAnchor {
  u: number;
  v: number;
  radius: number;
  angle: number;
}

export interface NailFingerDesignSpec {
  fingerId: FingerId;
  detectedFromPhoto: boolean;
  shape: NailShape; // 'natural' | 'square' | 'coffin' | 'almond' | 'stiletto'
  relativeLength: number; // 0.85 .. 1.65
  relativeWidth: number; // 0.90 .. 1.25
  baseColor: string; // dominant gel/polish base hex
  secondaryColor: string; // gradient / aura / french tip hex
  accentColor: string; // metallic gold / pearl / chrome 3D relief hex
  pattern: ArtisticPattern;
  strokeAnchors: StrokeAnchor[]; // normalized positions of detected strokes/reliefs on the nail
  metallicIntensity: number; // 0 .. 1
  glossIntensity: number; // 0.5 .. 1
}

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
  detectedShape?: NailShape;
  detectedLength?: number;
  fingerSpecs?: Record<FingerId, NailFingerDesignSpec>;
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
  z?: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FingerPose {
  id: FingerId;
  tip: NormalizedPoint;
  dip: NormalizedPoint;
  pip?: NormalizedPoint;
  mcp?: NormalizedPoint;
  wrist?: NormalizedPoint;
  palmNormal?: Vec3;
  handedness?: 'Left' | 'Right';
  widthScale: number;
  lengthScale: number;
}
