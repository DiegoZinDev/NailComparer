import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '../db/database.js';
import {
  mapStudioConfigRowToEntity,
  type StudioConfig,
  type StudioConfigRow,
} from '../entities/StudioConfig.js';

export class StudioConfigRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  getConfig(): StudioConfig | null {
    const stmt = this.db.prepare(`
      SELECT
        id,
        studio_name,
        whatsapp,
        logo_data_url,
        theme_preset,
        primary_color,
        accent_color,
        surface_color,
        updated_at
      FROM studio_config
      WHERE id = 1
      LIMIT 1
    `);

    const row = stmt.get() as StudioConfigRow | undefined;
    return row ? mapStudioConfigRowToEntity(row) : null;
  }

  upsertConfig(entity: StudioConfig): StudioConfig {
    const stmt = this.db.prepare(`
      INSERT INTO studio_config (
        id,
        studio_name,
        whatsapp,
        logo_data_url,
        theme_preset,
        primary_color,
        accent_color,
        surface_color,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        studio_name = excluded.studio_name,
        whatsapp = excluded.whatsapp,
        logo_data_url = excluded.logo_data_url,
        theme_preset = excluded.theme_preset,
        primary_color = excluded.primary_color,
        accent_color = excluded.accent_color,
        surface_color = excluded.surface_color,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      1,
      entity.studioName,
      entity.whatsapp,
      entity.logoDataUrl,
      entity.themePreset,
      entity.primaryColor,
      entity.accentColor,
      entity.surfaceColor,
      entity.updatedAt
    );

    const saved = this.getConfig();
    if (!saved) {
      throw new Error('Falha ao recuperar studio_config após upsert.');
    }
    return saved;
  }
}
