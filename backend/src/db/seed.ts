import { pathToFileURL } from 'node:url';
import { getDatabase, getDatabasePath } from './database.js';
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

export const DEFAULT_NAIL_DESIGNS: ReadonlyArray<never> = [];

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

  return {
    databasePath: getDatabasePath(),
    studioConfigSeeded,
    designsSeeded: 0,
    totalDesigns: nailDesignRepo.count(),
  };
}

export const seedDatabase = runSeed;

const isDirectExecution =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const result = runSeed();
  console.log('[NailComparer Seed] Concluído:', JSON.stringify(result, null, 2));
}
