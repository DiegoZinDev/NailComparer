import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'nail-studio.sqlite');

let dbInstance: DatabaseSync | null = null;

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      studio_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      logo_data_url TEXT,
      theme_preset TEXT NOT NULL,
      primary_color TEXT NOT NULL,
      accent_color TEXT NOT NULL,
      surface_color TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nail_designs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      style_type TEXT NOT NULL,
      base_color TEXT NOT NULL,
      accent_color TEXT NOT NULL,
      pattern_type TEXT NOT NULL,
      image_data_url TEXT,
      default_scale REAL NOT NULL DEFAULT 1.0,
      default_rotation REAL NOT NULL DEFAULT 0,
      default_opacity REAL NOT NULL DEFAULT 0.92,
      is_custom_reference INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nail_designs_category
      ON nail_designs (category);
  `);
}

export function getDatabasePath(): string {
  return DB_PATH;
}

export function getDatabase(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  runMigrations(db);

  dbInstance = db;
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
