export type NailCategory =
  | 'francesinha'
  | 'gel'
  | 'cromado'
  | 'nail-art'
  | 'cliente';

export type NailStyleType = 'procedural' | 'image';

export type NailPatternType =
  | 'solid'
  | 'french'
  | 'ombre'
  | 'chrome'
  | 'marble'
  | 'gold-foil'
  | 'cat-eye'
  | 'aurora'
  | 'custom-photo';

export interface NailDesignRow {
  id: string;
  name: string;
  category: string;
  style_type: string;
  base_color: string;
  accent_color: string;
  pattern_type: string;
  image_data_url: string | null;
  default_scale: number;
  default_rotation: number;
  default_opacity: number;
  is_custom_reference: number;
  created_at: string;
}

export interface NailDesign {
  id: string;
  name: string;
  category: NailCategory;
  styleType: NailStyleType;
  baseColor: string;
  accentColor: string;
  patternType: NailPatternType;
  imageDataUrl: string | null;
  defaultScale: number;
  defaultRotation: number;
  defaultOpacity: number;
  isCustomReference: boolean;
  createdAt: string;
}

export function mapNailDesignRowToEntity(row: NailDesignRow): NailDesign {
  return {
    id: row.id,
    name: row.name,
    category: row.category as NailCategory,
    styleType: row.style_type as NailStyleType,
    baseColor: row.base_color,
    accentColor: row.accent_color,
    patternType: row.pattern_type as NailPatternType,
    imageDataUrl: row.image_data_url ?? null,
    defaultScale: Number(row.default_scale),
    defaultRotation: Number(row.default_rotation),
    defaultOpacity: Number(row.default_opacity),
    isCustomReference: Boolean(row.is_custom_reference),
    createdAt: row.created_at,
  };
}
