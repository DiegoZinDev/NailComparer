import { pathToFileURL } from 'node:url';
import { getDatabase, getDatabasePath } from './database.js';
import type { NailDesign } from '../entities/NailDesign.js';
import type { StudioConfig } from '../entities/StudioConfig.js';
import { NailDesignRepository } from '../repositories/NailDesignRepository.js';
import { StudioConfigRepository } from '../repositories/StudioConfigRepository.js';

export interface SeedResult {
  databasePath: string;
  studioConfigSeeded: boolean;
  designsSeeded: number;
  totalDesigns: number;
}

const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  id: 1,
  studioName: 'Atelier Lumière Nails',
  whatsapp: '5561998421030',
  logoDataUrl: null,
  themePreset: 'rose-gold',
  primaryColor: '#D4A383',
  accentColor: '#F3D5C0',
  surfaceColor: '#171214',
  updatedAt: '2026-11-25T00:00:00.000Z',
};

const DEFAULT_NAIL_DESIGNS: Omit<NailDesign, 'createdAt'>[] = [
  {
    id: 'francesinha-perolada',
    name: 'Francesinha Clássica Perolada',
    category: 'francesinha',
    styleType: 'procedural',
    baseColor: '#F7E3DC',
    accentColor: '#FFFFFF',
    patternType: 'french',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'baby-boomer-rose',
    name: 'Baby Boomer Rosé',
    category: 'gel',
    styleType: 'procedural',
    baseColor: '#E8B8B0',
    accentColor: '#FFF8F5',
    patternType: 'ombre',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'glazed-donut-cromado',
    name: 'Glazed Donut Cromado',
    category: 'cromado',
    styleType: 'procedural',
    baseColor: '#F3E7E1',
    accentColor: '#FFFDFB',
    patternType: 'chrome',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'vermelho-valentino',
    name: 'Vermelho Valentino Gloss',
    category: 'gel',
    styleType: 'procedural',
    baseColor: '#9E1324',
    accentColor: '#D93848',
    patternType: 'solid',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'nude-leitoso',
    name: 'Nude Leitoso Minimalista',
    category: 'gel',
    styleType: 'procedural',
    baseColor: '#EBD8CE',
    accentColor: '#F9EFEA',
    patternType: 'solid',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'francesinha-dourada',
    name: 'Francesinha Dourada Luxo',
    category: 'francesinha',
    styleType: 'procedural',
    baseColor: '#F2DDD2',
    accentColor: '#D4AF37',
    patternType: 'french',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'lilas-aurora',
    name: 'Lilás Pastel Aurora',
    category: 'cromado',
    styleType: 'procedural',
    baseColor: '#C9B1E6',
    accentColor: '#F2E6FF',
    patternType: 'aurora',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'onix-folha-ouro',
    name: 'Preto Ônix + Folha de Ouro',
    category: 'nail-art',
    styleType: 'procedural',
    baseColor: '#141316',
    accentColor: '#DFB750',
    patternType: 'gold-foil',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'marmore-quartzo',
    name: 'Mármore Quartzo Rosa',
    category: 'nail-art',
    styleType: 'procedural',
    baseColor: '#F1CDD5',
    accentColor: '#FFFFFF',
    patternType: 'marble',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
  {
    id: 'cat-eye-champagne',
    name: 'Cat Eye Magnético Champagne',
    category: 'cromado',
    styleType: 'procedural',
    baseColor: '#C7A27C',
    accentColor: '#FFF1D6',
    patternType: 'cat-eye',
    imageDataUrl: null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.92,
    isCustomReference: false,
  },
];

export function runSeed(): SeedResult {
  const db = getDatabase();
  const studioConfigRepo = new StudioConfigRepository(db);
  const nailDesignRepo = new NailDesignRepository(db);

  let studioConfigSeeded = false;
  if (!studioConfigRepo.getConfig()) {
    studioConfigRepo.upsertConfig({
      ...DEFAULT_STUDIO_CONFIG,
      updatedAt: new Date().toISOString(),
    });
    studioConfigSeeded = true;
  }

  let designsSeeded = 0;
  if (nailDesignRepo.count() === 0) {
    const baseTime = Date.now();
    for (let index = 0; index < DEFAULT_NAIL_DESIGNS.length; index += 1) {
      const design = DEFAULT_NAIL_DESIGNS[index];
      nailDesignRepo.create({
        ...design,
        createdAt: new Date(baseTime + index * 1000).toISOString(),
      });
      designsSeeded += 1;
    }
  }

  return {
    databasePath: getDatabasePath(),
    studioConfigSeeded,
    designsSeeded,
    totalDesigns: nailDesignRepo.count(),
  };
}

const isDirectExecution =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const result = runSeed();
  console.log('[NailComparer Seed] Concluído:', JSON.stringify(result, null, 2));
}
