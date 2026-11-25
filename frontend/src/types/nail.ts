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

export type NailFinishV10 =
  | 'glossy_gel'
  | 'jelly_translucent'
  | 'chrome_mirror'
  | 'pearl_glazed'
  | 'cat_eye'
  | 'velvet_matte';

export type NailFinishV9 = NailFinishV10;

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

// -----------------------------------------------------------------------------
// V10 Mathematical Nail Design Blueprint (100% Vector + Parametric Geometry, ZERO raw photo pixels)
// -----------------------------------------------------------------------------

export type NailGradientMode =
  | 'solid'
  | 'vertical_ombre'
  | 'radial_aura'
  | 'cat_eye_band'
  | 'pearl_chrome';

export type NailBorderKind =
  | 'none'
  | 'full_metallic_outline'
  | 'cuticle_cuff'
  | 'classic_french'
  | 'micro_french'
  | 'v_french';

export interface NailGeometryProfile {
  /** 8 normalized half-width stations at v = [0, 0.15, 0.35, 0.55, 0.72, 0.85, 0.94, 1.0] (max 0.5) */
  profileHalfWidths: [number, number, number, number, number, number, number, number];
  aspectRatio: number;
  /** Free-edge extension relative to client's natural bed length (0.12 .. 1.15) */
  freeEdgeRatio: number;
  tipRoundness: number; // 0 .. 1
  shape: NailShape;
}

export interface NailBaseLayer {
  baseColorHex: string;
  gradientMode: NailGradientMode;
  cuticleColorHex: string;
  midColorHex: string;
  tipColorHex: string;
  finishStyle: NailFinishV10;
  translucency: number; // 0 .. 1
  metallicBase: number; // 0 .. 1
  glossiness: number; // 0 .. 1
}

export interface NailBorderLayer {
  kind: NailBorderKind;
  colorHex: string;
  thicknessNorm: number; // 0.02 .. 0.28
  isMetallic: boolean;
  is3DRaised: boolean;
  smileCurveDepth: number; // 0 .. 0.35
}

export interface RibbonStrokePoint {
  u: number;
  v: number;
  width: number; // normalized width (0.015 .. 0.14)
}

export interface RibbonStrokeElement {
  type: 'ribbon_stroke';
  points: RibbonStrokePoint[]; // 4..10 simplified smooth control points
  colorHex: string;
  highlightHex: string;
  isMetallic: boolean;
  reliefHeight: number; // 0.2 .. 1.0
}

export interface OrganicMotifPoint {
  u: number;
  v: number;
}

export interface OrganicMotifElement {
  type: 'organic_motif';
  contour: OrganicMotifPoint[]; // 16..24 smoothed closed polygon vertices in (u, v)
  fillColorHex: string;
  shadeColorHex: string;
  isMetallic: boolean;
  reliefHeight: number; // 0.15 .. 1.0
}

export interface MicroGemElement {
  type: 'micro_gem';
  u: number;
  v: number;
  radius: number; // 0.015 .. 0.065
  colorHex: string;
  kind: 'gold_bead' | 'pearl' | 'crystal';
}

export type VectorArtElement =
  | RibbonStrokeElement
  | OrganicMotifElement
  | MicroGemElement;

export interface NailDesignBlueprint {
  version: 10;
  geometry: NailGeometryProfile;
  baseLayer: NailBaseLayer;
  borderLayer: NailBorderLayer;
  artElements: VectorArtElement[];
}

export interface NailFingerDesignSpec {
  fingerId: FingerId;
  detectedFromPhoto: boolean;
  shape: NailShape; // 'natural' | 'oval' | 'square' | 'coffin' | 'almond' | 'stiletto'
  relativeLength: number; // 1.12 .. 2.15 (1 + freeEdgeRatio)
  relativeWidth: number; // retained for legacy DTO compatibility ONLY (NEVER overrides client live finger width!)
  baseColor: string; // dominant gel/polish base hex
  secondaryColor: string; // gradient / aura / french tip / floral petal hex
  accentColor: string; // metallic gold / pearl / chrome 3D relief hex
  pattern: ArtisticPattern;
  strokeAnchors: StrokeAnchor[];
  metallicIntensity: number; // 0 .. 1
  glossIntensity: number; // 0.5 .. 1
  // V10 Clean Mathematical Blueprint & Anatomical Spec fields
  blueprint?: NailDesignBlueprint;
  extensionLevel?: NailExtensionLevel;
  freeEdgeRatio?: number; // 0.12 .. 1.15 relative to client natural bed
  extensionMm?: number; // estimated free-edge extension in mm (1.5 .. 12.0)
  tipRoundness?: number; // 0 .. 1
  aspectRatio?: number;
  lengthMultiplier?: number; // 1.12 .. 2.15
  hasMetallicOutline?: boolean;
  outlineColor?: string;
  has3DRelief?: boolean;
  reliefDescription?: string;
  artDescription?: string;
  finishStyle?: NailFinishV10;
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
  extensionLength: number; // Fine-tune multiplier 0.85 .. 1.15 (±15%) around reference freeEdgeRatio
  scale: number; // Width/fit multiplier 0.85 .. 1.20
  rotationDeg: number; // 0 default
  opacity: number; // 0.70 .. 1.0 (default 1.0 -> opaque fast path!)
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

/**
 * Live per-finger width calibration measured directly on the client's hand in the camera frame.
 */
export interface LiveFingerCalibration {
  /** Smoothed measured finger width divided by projected 2D DIP->TIP length, per finger */
  widthToDistalRatio: Record<FingerId, number>;
  /** Measured screen-space width in CSS pixels (when available in current frame) */
  widthPx: Partial<Record<FingerId, number>>;
  /** Confidence 0..1 per finger */
  confidence: Record<FingerId, number>;
}
