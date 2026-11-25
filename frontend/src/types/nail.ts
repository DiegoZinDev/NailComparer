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
// V11 Deep 3D Manufacturing Spec (Per-Finger / 5 or 10 Fingers + Real 3D Accessories)
// -----------------------------------------------------------------------------

export type Nail3DAccessoryKind =
  | 'metal_stud_sphere'
  | 'metal_stud_flat'
  | 'pearl_dome'
  | 'rhinestone'
  | 'caviar_bead'
  | '3d_drop_clear';

export interface Nail3DAccessorySpec {
  kind: Nail3DAccessoryKind;
  u: number; // 0.08..0.92 (left -> right across nail plate)
  v: number; // 0.08..0.94 (cuticle -> free edge)
  radiusNorm: number; // fraction of nail width (e.g. 0.04 caviar, 0.11 medium stud, 0.16 large)
  heightRatio: number; // 0.35..0.85 (3D projection along surface normal)
  colorHex: string; // e.g. '#E6E9EF' silver, '#D9B668' gold, '#F9F4EE' pearl
  hasBezelRing: boolean; // subtle metallic/shadow seating bezel at base
}

export interface Nail3DStrokeSpec {
  p0: [number, number];
  c1: [number, number];
  c2: [number, number];
  p1: [number, number];
  widthNorm: number; // 0.015..0.14
  colorHex: string;
  isMetallic: boolean;
  metalness: number;
  reliefHeight: number; // 0..1 (normalMap relief intensity)
}

export type Nail3DMotifKind =
  | 'flower_5petal'
  | 'flower_4petal'
  | 'cherry'
  | 'heart'
  | 'star_4pt'
  | 'bow_3d'
  | 'marble_veins'
  | 'tortoiseshell_spots'
  | 'aura_bloom'
  | 'abstract_organic';

export interface Nail3DMotifSpec {
  kind: Nail3DMotifKind;
  center: [number, number]; // [u, v]
  scale: number; // 0.08..0.55
  rotationDeg: number;
  primaryColorHex: string;
  secondaryColorHex: string;
  centerDotColorHex?: string;
  is3DRaised: boolean;
  opacity: number;
}

export type Nail3DSubstrateType =
  | 'natural_sheer'
  | 'builder_gel_nude'
  | 'milky_jelly'
  | 'opaque_gel_polish';

export type Nail3DFinishType =
  | 'mirror_chrome'
  | 'glazed_pearl'
  | 'solid_gloss_gel'
  | 'jelly_translucent'
  | 'cat_eye_magnetic'
  | 'velvet_matte'
  | 'glitter_suspension';

export type Nail3DGradientType =
  | 'none'
  | 'vertical_ombre'
  | 'radial_aura'
  | 'cat_eye_diagonal'
  | 'chrome_sheen';

export type Nail3DBorderType =
  | 'none'
  | 'full_perimeter_outline'
  | 'cuticle_cuff'
  | 'classic_french'
  | 'micro_french'
  | 'deep_v_french';

export interface Nail3DManufacturingSpec {
  fingerId: FingerId;
  handSide?: 'Left' | 'Right';
  // 1. Clean parametric salon geometry (NO noisy pixel width profiles!)
  shape: NailShape;
  freeEdgeRatio: number; // 0.12 (short) .. 1.15 (extra long)
  tipRoundness: number; // 0..1
  cCurveDepth: number; // 0.16..0.28
  apexHeight: number; // 0.06..0.11
  // 2. Real optical physics (environmental reflections discounted from true base color)
  substrateType: Nail3DSubstrateType;
  finishType: Nail3DFinishType;
  trueBaseColorHex: string;
  secondaryColorHex: string;
  cuticleColorHex: string;
  tipColorHex: string;
  gradientType: Nail3DGradientType;
  metalness: number; // 0..1
  roughness: number; // 0.04..0.55
  clearcoat: number; // 0..1
  translucency: number; // 0..1
  // 3. Borders & French tips
  borderType: Nail3DBorderType;
  borderColorHex: string;
  borderWidthNorm: number;
  borderIsMetallic: boolean;
  borderIs3DRaised: boolean;
  // 4. Sculpted 3D strokes, motifs & true geometric 3D accessories
  strokes3D: Nail3DStrokeSpec[];
  motifs: Nail3DMotifSpec[];
  accessories3D: Nail3DAccessorySpec[];
  // 5. Closed-loop visual verification audit
  designNotesPt: string;
  fidelityScore?: number; // 0..100 after side-by-side visual check
  refinementRounds?: number;
}

// -----------------------------------------------------------------------------
// V10 Mathematical Nail Design Blueprint (Preserved for offline local fallback)
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
  /** Retained for metadata/legacy compatibility — NEVER fed raw into 3D mesh silhouette! */
  profileHalfWidths: [number, number, number, number, number, number, number, number];
  aspectRatio: number;
  freeEdgeRatio: number;
  tipRoundness: number;
  shape: NailShape;
}

export interface NailBaseLayer {
  baseColorHex: string;
  gradientMode: NailGradientMode;
  cuticleColorHex: string;
  midColorHex: string;
  tipColorHex: string;
  finishStyle: NailFinishV10;
  translucency: number;
  metallicBase: number;
  glossiness: number;
}

export interface NailBorderLayer {
  kind: NailBorderKind;
  colorHex: string;
  thicknessNorm: number;
  isMetallic: boolean;
  is3DRaised: boolean;
  smileCurveDepth: number;
}

export interface RibbonStrokePoint {
  u: number;
  v: number;
  width: number;
}

export interface RibbonStrokeElement {
  type: 'ribbon_stroke';
  points: RibbonStrokePoint[];
  colorHex: string;
  highlightHex: string;
  isMetallic: boolean;
  reliefHeight: number;
}

export interface OrganicMotifPoint {
  u: number;
  v: number;
}

export interface OrganicMotifElement {
  type: 'organic_motif';
  contour: OrganicMotifPoint[];
  fillColorHex: string;
  shadeColorHex: string;
  isMetallic: boolean;
  reliefHeight: number;
}

export interface MicroGemElement {
  type: 'micro_gem';
  u: number;
  v: number;
  radius: number;
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

export interface NailUvPinTarget {
  cxNorm: number; // 0..1 normalized X center on reference image
  cyNorm: number; // 0..1 normalized Y center on reference image
  widthNorm: number; // normalized plate width relative to image width
  heightNorm: number; // normalized plate height relative to image height
  angleRad: number; // orientation angle of DIP->TIP in image space
  detectedFromPhoto: boolean;
}

export interface NailFingerDesignSpec {
  fingerId: FingerId;
  handSide?: 'Left' | 'Right';
  detectedFromPhoto: boolean;
  shape: NailShape;
  relativeLength: number;
  relativeWidth: number;
  baseColor: string;
  secondaryColor: string;
  accentColor: string;
  pattern: ArtisticPattern;
  strokeAnchors: StrokeAnchor[];
  metallicIntensity: number;
  glossIntensity: number;
  // V12 Photorealistic True UV Texture Transfer (512x512 WebP/PNG + interactive 4x loupe target)
  trueUvDataUrl?: string;
  uvExtractionTarget?: NailUvPinTarget;
  // V11 Primary 3D Manufacturing Spec + Real 3D Offscreen Render Preview
  manufacturingSpec?: Nail3DManufacturingSpec;
  preview3DDataUrl?: string; // Snapshot rendered by Three.js offscreenNailRenderer (NOT a raw photo crop!)
  referenceZoomDataUrl?: string; // Temporary inspection crop for side-by-side modal comparison only
  fidelityScore?: number; // 0..100 verified visual fidelity score
  // V10 Clean Mathematical Blueprint (kept for local fallback compatibility)
  blueprint?: NailDesignBlueprint;
  extensionLevel?: NailExtensionLevel;
  freeEdgeRatio?: number;
  extensionMm?: number;
  tipRoundness?: number;
  aspectRatio?: number;
  lengthMultiplier?: number;
  hasMetallicOutline?: boolean;
  outlineColor?: string;
  has3DRelief?: boolean;
  reliefDescription?: string;
  artDescription?: string;
  finishStyle?: NailFinishV10;
  isImportedReference?: boolean;
}

export interface NailHandSpecsBySide {
  Left?: Record<FingerId, NailFingerDesignSpec>;
  Right?: Record<FingerId, NailFingerDesignSpec>;
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
  fidelityScore?: number;
  fingerSpecs?: Record<FingerId, NailFingerDesignSpec>;
  /** Optional 10-finger set supporting distinct Left and Right hand designs in AR */
  handSpecsBySide?: NailHandSpecsBySide;
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

export interface HandSkeletonFrame {
  landmarks: NormalizedPoint[]; // 21 normalized screen landmarks (x, y, z)
  worldLandmarks: Vec3[]; // 21 metric 3D world landmarks (meters)
  handedness: 'Left' | 'Right';
  timestampMs: number;
}

export interface LiveFingerCalibration {
  widthToDistalRatio: Record<FingerId, number>;
  widthPx: Partial<Record<FingerId, number>>;
  confidence: Record<FingerId, number>;
}
