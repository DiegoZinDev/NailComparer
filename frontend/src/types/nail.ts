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
  | 'Estudio'
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

export type NailShape = 'natural' | 'oval' | 'almond' | 'square' | 'coffin' | 'stiletto';

export type NailExtensionLevel =
  | 'Curta/Natural'
  | 'Pouco Alongada'
  | 'Alongada'
  | 'Muito Alongada (Extrema)';

export type NailFinishV9 =
  | 'glossy_gel'
  | 'jelly_translucent'
  | 'chrome_mirror'
  | 'velvet_matte'
  | 'cat_eye';

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
  shape: NailShape; // 'natural' | 'oval' | 'square' | 'coffin' | 'almond' | 'stiletto'
  relativeLength: number; // 0.85 .. 1.65 (salon scale)
  relativeWidth: number; // 0.90 .. 1.25
  baseColor: string; // dominant gel/polish base hex
  secondaryColor: string; // gradient / aura / french tip / floral petal hex
  accentColor: string; // metallic gold / pearl / chrome 3D relief hex
  pattern: ArtisticPattern;
  strokeAnchors: StrokeAnchor[]; // normalized positions of detected strokes/reliefs on the nail
  metallicIntensity: number; // 0 .. 1
  glossIntensity: number; // 0.5 .. 1
  // V9 High-Fidelity Reference & Anatomical Spec fields
  extensionLevel?: NailExtensionLevel;
  extensionMm?: number; // real free-edge extension in mm (1.5 .. 12.0)
  tipRoundness?: number; // 0 .. 1
  aspectRatio?: number;
  lengthMultiplier?: number; // 0.85 .. 1.65
  hasMetallicOutline?: boolean;
  outlineColor?: string;
  has3DRelief?: boolean;
  reliefDescription?: string;
  artDescription?: string;
  finishStyle?: NailFinishV9;
  uvPatchDataUrl?: string; // canonical delighted UV texture (512x512 or 1024x1024)
  normalMapDataUrl?: string;
  displacementMapDataUrl?: string;
  metalnessMapDataUrl?: string;
  roughnessMapDataUrl?: string;
  isImportedReference?: boolean;
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
  isStudioCatalog?: boolean;
  detectedShape?: NailShape;
  detectedLength?: number;
  fingerSpecs?: Record<FingerId, NailFingerDesignSpec>;
  createdAt?: string;
}

export interface NailAdjustment {
  shape: NailShape;
  extensionLength: number; // Fine-tune multiplier 0.85 .. 1.15 (±15%) around reference length
  scale: number; // Width/fit multiplier 0.85 .. 1.20
  rotationDeg: number; // 0 default
  opacity: number; // 0.70 .. 1.0 realism/opacity
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

/**
 * Unified 21-point MediaPipe hand frame carrying BOTH screen-normalized landmarks
 * and metric worldLandmarks (in meters) for single-phase pre-kinematic filtering.
 */
export interface HandSkeletonFrame {
  landmarks: NormalizedPoint[]; // 21 normalized screen landmarks (x, y, z)
  worldLandmarks: Vec3[]; // 21 metric 3D world landmarks (meters)
  handedness: 'Left' | 'Right';
  timestampMs: number;
}
