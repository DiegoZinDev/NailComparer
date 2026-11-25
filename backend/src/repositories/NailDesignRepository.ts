import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { getDatabase } from '../db/database.js';
import {
  mapNailDesignRowToEntity,
  type NailCategory,
  type NailDesign,
  type NailDesignRow,
} from '../entities/NailDesign.js';

export class NailDesignRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  findAll(category?: NailCategory): NailDesign[] {
    if (category) {
      const stmt = this.db.prepare(`
        SELECT
          id,
          name,
          category,
          style_type,
          base_color,
          accent_color,
          pattern_type,
          image_data_url,
          default_scale,
          default_rotation,
          default_opacity,
          is_custom_reference,
          created_at
        FROM nail_designs
        WHERE category = ?
        ORDER BY is_custom_reference DESC, created_at ASC
      `);
      const rows = stmt.all(category) as unknown as NailDesignRow[];
      return rows.map(mapNailDesignRowToEntity);
    }

    const stmt = this.db.prepare(`
      SELECT
        id,
        name,
        category,
        style_type,
        base_color,
        accent_color,
        pattern_type,
        image_data_url,
        default_scale,
        default_rotation,
        default_opacity,
        is_custom_reference,
        created_at
      FROM nail_designs
      ORDER BY is_custom_reference DESC, created_at ASC
    `);
    const rows = stmt.all() as unknown as NailDesignRow[];
    return rows.map(mapNailDesignRowToEntity);
  }

  findById(id: string): NailDesign | null {
    const stmt = this.db.prepare(`
      SELECT
        id,
        name,
        category,
        style_type,
        base_color,
        accent_color,
        pattern_type,
        image_data_url,
        default_scale,
        default_rotation,
        default_opacity,
        is_custom_reference,
        created_at
      FROM nail_designs
      WHERE id = ?
      LIMIT 1
    `);

    const row = stmt.get(id) as NailDesignRow | undefined;
    return row ? mapNailDesignRowToEntity(row) : null;
  }

  create(entity: NailDesign): NailDesign {
    const stmt = this.db.prepare(`
      INSERT INTO nail_designs (
        id,
        name,
        category,
        style_type,
        base_color,
        accent_color,
        pattern_type,
        image_data_url,
        default_scale,
        default_rotation,
        default_opacity,
        is_custom_reference,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entity.id,
      entity.name,
      entity.category,
      entity.styleType,
      entity.baseColor,
      entity.accentColor,
      entity.patternType,
      entity.imageDataUrl,
      entity.defaultScale,
      entity.defaultRotation,
      entity.defaultOpacity,
      entity.isCustomReference ? 1 : 0,
      entity.createdAt
    );

    const created = this.findById(entity.id);
    if (!created) {
      throw new Error(`Falha ao recuperar nail_design recém-criado (${entity.id}).`);
    }
    return created;
  }

  update(
    id: string,
    partial: Partial<Omit<NailDesign, 'id' | 'createdAt'>>
  ): NailDesign | null {
    const existing = this.findById(id);
    if (!existing) {
      return null;
    }

    const setClauses: string[] = [];
    const values: SQLInputValue[] = [];

    if (partial.name !== undefined) {
      setClauses.push('name = ?');
      values.push(partial.name);
    }
    if (partial.category !== undefined) {
      setClauses.push('category = ?');
      values.push(partial.category);
    }
    if (partial.styleType !== undefined) {
      setClauses.push('style_type = ?');
      values.push(partial.styleType);
    }
    if (partial.baseColor !== undefined) {
      setClauses.push('base_color = ?');
      values.push(partial.baseColor);
    }
    if (partial.accentColor !== undefined) {
      setClauses.push('accent_color = ?');
      values.push(partial.accentColor);
    }
    if (partial.patternType !== undefined) {
      setClauses.push('pattern_type = ?');
      values.push(partial.patternType);
    }
    if (partial.imageDataUrl !== undefined) {
      setClauses.push('image_data_url = ?');
      values.push(partial.imageDataUrl);
    }
    if (partial.defaultScale !== undefined) {
      setClauses.push('default_scale = ?');
      values.push(partial.defaultScale);
    }
    if (partial.defaultRotation !== undefined) {
      setClauses.push('default_rotation = ?');
      values.push(partial.defaultRotation);
    }
    if (partial.defaultOpacity !== undefined) {
      setClauses.push('default_opacity = ?');
      values.push(partial.defaultOpacity);
    }
    if (partial.isCustomReference !== undefined) {
      setClauses.push('is_custom_reference = ?');
      values.push(partial.isCustomReference ? 1 : 0);
    }

    if (setClauses.length === 0) {
      return existing;
    }

    values.push(id);
    const stmt = this.db.prepare(`
      UPDATE nail_designs
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...values);

    return this.findById(id);
  }

  deleteById(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM nail_designs
      WHERE id = ?
    `);
    const result = stmt.run(id);
    return Number(result.changes) > 0;
  }

  count(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) AS total
      FROM nail_designs
    `);
    const row = stmt.get() as { total: number } | undefined;
    return row ? Number(row.total) : 0;
  }
}
