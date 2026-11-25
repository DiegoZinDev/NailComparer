import { DEFAULT_STUDIO_CONFIG } from '../data/presets';
import type {
  FingerId,
  NailDesign,
  NailFingerDesignSpec,
  NailShape,
  StudioConfig,
} from '../types/nail';

const DB_NAME = 'nail-ar-studio-db';
const DB_VERSION = 1;
const STORE_CONFIG = 'studioConfig';
const STORE_DESIGNS = 'nailDesigns';

const LS_CONFIG_KEY = 'nail_ar_studio_config_v1';
const LS_DESIGNS_KEY = 'nail_ar_studio_designs_v1';

export type SyncStatus = 'synced' | 'offline';

const VALID_SHAPES: ReadonlySet<string> = new Set([
  'natural',
  'oval',
  'almond',
  'square',
  'coffin',
  'stiletto',
]);

const VALID_FINISHES: ReadonlySet<string> = new Set([
  'glossy',
  'chrome',
  'velvet',
  'glitter',
]);

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_DESIGNS)) {
        db.createObjectStore(STORE_DESIGNS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage quota exceeded or restricted; IndexedDB still acts as primary store
  }
}

async function idbGetConfig(): Promise<StudioConfig | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CONFIG, 'readonly');
      const store = tx.objectStore(STORE_CONFIG);
      const req = store.get(1);
      req.onsuccess = () => resolve((req.result as StudioConfig | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSaveConfig(config: StudioConfig): Promise<void> {
  const payload: StudioConfig = { ...config, id: 1, updatedAt: new Date().toISOString() };
  writeLocalStorage(LS_CONFIG_KEY, payload);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CONFIG, 'readwrite');
      tx.objectStore(STORE_CONFIG).put(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback already written to localStorage
  }
}

function stripLegacyFictionalSeeds(designs: NailDesign[]): NailDesign[] {
  return designs.filter((d) => !String(d.id).startsWith('seed-'));
}

async function idbGetDesigns(): Promise<NailDesign[] | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DESIGNS, 'readonly');
      const req = tx.objectStore(STORE_DESIGNS).getAll();
      req.onsuccess = () => {
        const rows = (req.result as NailDesign[] | undefined) ?? [];
        resolve(stripLegacyFictionalSeeds(rows));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSaveAllDesigns(designs: NailDesign[]): Promise<void> {
  const clean = stripLegacyFictionalSeeds(designs);
  writeLocalStorage(LS_DESIGNS_KEY, clean);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DESIGNS, 'readwrite');
      const store = tx.objectStore(STORE_DESIGNS);
      store.clear();
      for (const item of clean) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback already written to localStorage
  }
}

async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = 1800
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function ensureOfflineSeed(): Promise<void> {
  const existingConfig = await idbGetConfig();
  if (!existingConfig) {
    const lsConfig = readLocalStorage<StudioConfig | null>(LS_CONFIG_KEY, null);
    await idbSaveConfig(lsConfig ?? DEFAULT_STUDIO_CONFIG);
  }

  // Purge any legacy V8 fictional seeds from local caches without repopulating
  const existingDesigns = await idbGetDesigns();
  if (existingDesigns === null) {
    const lsDesigns = stripLegacyFictionalSeeds(
      readLocalStorage<NailDesign[]>(LS_DESIGNS_KEY, [])
    );
    await idbSaveAllDesigns(lsDesigns);
  }
}

export const API_TO_CATEGORY: Record<string, NailDesign['category']> = {
  estudio: 'Estudio',
  francesinha: 'Francesinha',
  gel: 'Gel',
  cromado: 'Cromado',
  'nail-art': 'Nail Art',
  cliente: 'Cliente',
};

export const CATEGORY_TO_API: Record<NailDesign['category'], string> = {
  Estudio: 'estudio',
  Francesinha: 'francesinha',
  Gel: 'gel',
  Cromado: 'cromado',
  'Nail Art': 'nail-art',
  Cliente: 'cliente',
};

function mapConfigFromApi(data: Record<string, unknown>): StudioConfig {
  return {
    ...DEFAULT_STUDIO_CONFIG,
    id: 1,
    studioName: String(data.studioName ?? DEFAULT_STUDIO_CONFIG.studioName),
    whatsappNumber: String(
      data.whatsapp ?? data.whatsappNumber ?? DEFAULT_STUDIO_CONFIG.whatsappNumber
    ),
    logoDataUrl: (data.logoDataUrl as string | null) ?? null,
    themePreset:
      (data.themePreset as StudioConfig['themePreset']) ?? DEFAULT_STUDIO_CONFIG.themePreset,
    primaryColor: String(data.primaryColor ?? DEFAULT_STUDIO_CONFIG.primaryColor),
    accentColor: String(data.accentColor ?? DEFAULT_STUDIO_CONFIG.accentColor),
    surfaceColor: String(data.surfaceColor ?? DEFAULT_STUDIO_CONFIG.surfaceColor),
    onSurfaceColor:
      data.themePreset === 'minimalist-pearl' ? '#1A1718' : DEFAULT_STUDIO_CONFIG.onSurfaceColor,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function parseFingerSpecs(
  rawValue: unknown
): Record<FingerId, NailFingerDesignSpec> | undefined {
  if (!rawValue) return undefined;
  if (typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return rawValue as Record<FingerId, NailFingerDesignSpec>;
  }
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<FingerId, NailFingerDesignSpec>;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function apiDesignToLocal(raw: Record<string, unknown>): NailDesign {
  const rawCat = String(raw.category ?? 'cliente');
  const mappedCategory = API_TO_CATEGORY[rawCat.toLowerCase()];
  const isStudioCatalog = Boolean(
    raw.isStudioCatalog ?? raw.is_studio_catalog ?? mappedCategory === 'Estudio'
  );
  const category: NailDesign['category'] =
    mappedCategory ?? (isStudioCatalog ? 'Estudio' : 'Cliente');

  const rawPattern = String(raw.patternType ?? raw.pattern_type ?? 'solid');
  const patternType = (
    rawPattern === 'custom-photo' ? 'solid' : rawPattern
  ) as NailDesign['patternType'];

  const rawFinish = raw.finish;
  const finish: NailDesign['finish'] =
    typeof rawFinish === 'string' && VALID_FINISHES.has(rawFinish)
      ? (rawFinish as NailDesign['finish'])
      : patternType === 'chrome' || patternType === 'aurora'
        ? 'chrome'
        : patternType === 'cat-eye'
          ? 'velvet'
          : patternType === 'gold-foil'
            ? 'glitter'
            : 'glossy';

  const rawShape = raw.detectedShape ?? raw.detected_shape;
  const detectedShape =
    typeof rawShape === 'string' && VALID_SHAPES.has(rawShape)
      ? (rawShape as NailShape)
      : undefined;

  const rawLength = raw.detectedLength ?? raw.detected_length;
  const parsedLength =
    typeof rawLength === 'number'
      ? rawLength
      : typeof rawLength === 'string' && rawLength !== ''
        ? Number(rawLength)
        : NaN;
  const detectedLength =
    Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : undefined;

  const fingerSpecs = parseFingerSpecs(
    raw.fingerSpecs ?? raw.finger_specs ?? raw.finger_specs_json
  );

  const rawIsCustom = raw.isCustomReference ?? raw.isCustom ?? raw.is_custom_reference;
  const isCustom = isStudioCatalog
    ? false
    : rawIsCustom !== undefined
      ? Boolean(rawIsCustom)
      : category === 'Cliente';

  const accentColor =
    typeof raw.accentColor === 'string'
      ? raw.accentColor
      : typeof raw.accent_color === 'string'
        ? raw.accent_color
        : '#FFFFFF';

  const secondaryColor =
    typeof raw.secondaryColor === 'string'
      ? raw.secondaryColor
      : typeof raw.secondary_color === 'string'
        ? raw.secondary_color
        : accentColor;

  return {
    id: String(raw.id),
    name: String(raw.name ?? 'Design'),
    category,
    patternType,
    baseColor: String(raw.baseColor ?? raw.base_color ?? '#EBD8CE'),
    secondaryColor,
    accentColor,
    finish,
    imageDataUrl:
      (raw.imageDataUrl as string | null) ?? (raw.image_data_url as string | null) ?? null,
    isCustom,
    isStudioCatalog,
    detectedShape,
    detectedLength,
    fingerSpecs,
    createdAt:
      typeof raw.createdAt === 'string'
        ? raw.createdAt
        : typeof raw.created_at === 'string'
          ? raw.created_at
          : undefined,
  };
}

export function localDesignToApi(
  design: NailDesign | Omit<NailDesign, 'id' | 'createdAt'>
): Record<string, unknown> {
  const isStudioCatalog = Boolean(design.isStudioCatalog || design.category === 'Estudio');
  const isCustomReference = isStudioCatalog
    ? false
    : Boolean(design.isCustom ?? design.category === 'Cliente');

  return {
    name: design.name,
    category: CATEGORY_TO_API[design.category] ?? (isStudioCatalog ? 'estudio' : 'cliente'),
    styleType: design.imageDataUrl ? 'image' : 'procedural',
    baseColor: design.baseColor || '#EBD8CE',
    secondaryColor: design.secondaryColor || design.accentColor || '#FFFFFF',
    accentColor: design.accentColor || design.secondaryColor || '#FFFFFF',
    finish: design.finish || 'glossy',
    patternType: design.patternType || 'solid',
    imageDataUrl: design.imageDataUrl ?? null,
    defaultScale: 1.0,
    defaultRotation: 0,
    defaultOpacity: 0.98,
    isCustomReference,
    isStudioCatalog,
    detectedShape: design.detectedShape ?? null,
    detectedLength: design.detectedLength ?? null,
    fingerSpecs: design.fingerSpecs ?? null,
  };
}

export async function loadStudioConfig(): Promise<{ config: StudioConfig; status: SyncStatus }> {
  await ensureOfflineSeed();
  try {
    const res = await fetchWithTimeout('/api/config');
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const merged = mapConfigFromApi(data);
      await idbSaveConfig(merged);
      return { config: merged, status: 'synced' };
    }
  } catch {
    // Backend unavailable; fall back silently to IndexedDB/localStorage
  }

  const local = (await idbGetConfig()) ?? readLocalStorage(LS_CONFIG_KEY, DEFAULT_STUDIO_CONFIG);
  return { config: local, status: 'offline' };
}

export async function saveStudioConfig(
  config: StudioConfig
): Promise<{ config: StudioConfig; status: SyncStatus }> {
  const normalized: StudioConfig = {
    ...DEFAULT_STUDIO_CONFIG,
    ...config,
    id: 1,
    updatedAt: new Date().toISOString(),
  };
  await idbSaveConfig(normalized);

  try {
    const apiPayload = {
      studioName: normalized.studioName,
      whatsapp: normalized.whatsappNumber,
      logoDataUrl: normalized.logoDataUrl,
      themePreset: normalized.themePreset,
      primaryColor: normalized.primaryColor,
      accentColor: normalized.accentColor,
      surfaceColor: normalized.surfaceColor,
    };
    const res = await fetchWithTimeout('/api/config', {
      method: 'PUT',
      body: JSON.stringify(apiPayload),
    });
    if (res.ok) {
      const serverData = (await res.json()) as Record<string, unknown>;
      const merged = {
        ...normalized,
        ...mapConfigFromApi(serverData),
        onSurfaceColor: normalized.onSurfaceColor,
      };
      await idbSaveConfig(merged);
      return { config: merged, status: 'synced' };
    }
  } catch {
    // Offline fallback already persisted
  }
  return { config: normalized, status: 'offline' };
}

export async function loadNailDesigns(): Promise<{ designs: NailDesign[]; status: SyncStatus }> {
  await ensureOfflineSeed();
  try {
    const res = await fetchWithTimeout('/api/designs');
    if (res.ok) {
      const remoteRaw = (await res.json()) as Record<string, unknown>[];
      if (Array.isArray(remoteRaw)) {
        const local = (await idbGetDesigns()) ?? [];
        const localById = new Map(local.map((d) => [String(d.id), d]));
        const remote = stripLegacyFictionalSeeds(
          remoteRaw.map((raw) => {
            const mapped = apiDesignToLocal(raw);
            const localMatch = localById.get(String(mapped.id));
            return localMatch
              ? {
                  ...mapped,
                  fingerSpecs: mapped.fingerSpecs ?? localMatch.fingerSpecs,
                  detectedShape: mapped.detectedShape ?? localMatch.detectedShape,
                  detectedLength: mapped.detectedLength ?? localMatch.detectedLength,
                  secondaryColor: mapped.secondaryColor ?? localMatch.secondaryColor,
                  finish: mapped.finish ?? localMatch.finish,
                  isStudioCatalog: mapped.isStudioCatalog ?? localMatch.isStudioCatalog,
                }
              : mapped;
          })
        );
        const remoteIds = new Set(remote.map((d) => String(d.id)));
        const localUnsynced = local.filter(
          (d) => (d.isCustom || d.isStudioCatalog) && !remoteIds.has(String(d.id))
        );
        const merged = [...localUnsynced, ...remote];
        await idbSaveAllDesigns(merged);
        return { designs: merged, status: 'synced' };
      }
    }
  } catch {
    // Offline fallback
  }

  const localDesigns =
    (await idbGetDesigns()) ??
    stripLegacyFictionalSeeds(readLocalStorage<NailDesign[]>(LS_DESIGNS_KEY, []));
  return { designs: localDesigns, status: 'offline' };
}

export async function createNailDesign(
  design: Omit<NailDesign, 'id' | 'createdAt'>
): Promise<{ design: NailDesign; status: SyncStatus }> {
  const isStudioCatalog = Boolean(design.isStudioCatalog || design.category === 'Estudio');
  const isCustom = isStudioCatalog ? false : Boolean(design.isCustom ?? true);

  const localItem: NailDesign = {
    ...design,
    id: `${isStudioCatalog ? 'studio' : 'custom'}-${Date.now()}`,
    isCustom,
    isStudioCatalog,
    createdAt: new Date().toISOString(),
  };

  const current = (await idbGetDesigns()) ?? [];
  await idbSaveAllDesigns([localItem, ...current]);

  try {
    const apiPayload = localDesignToApi(localItem);
    const res = await fetchWithTimeout(
      '/api/designs',
      {
        method: 'POST',
        body: JSON.stringify(apiPayload),
      },
      2600
    );
    if (res.ok) {
      const saved = (await res.json()) as Record<string, unknown>;
      const mapped = apiDesignToLocal(saved);
      const syncedItem: NailDesign = {
        ...localItem,
        ...mapped,
        finish: mapped.finish ?? localItem.finish,
        secondaryColor: mapped.secondaryColor ?? localItem.secondaryColor,
        fingerSpecs: mapped.fingerSpecs ?? localItem.fingerSpecs,
        detectedShape: mapped.detectedShape ?? localItem.detectedShape,
        detectedLength: mapped.detectedLength ?? localItem.detectedLength,
        isStudioCatalog: mapped.isStudioCatalog ?? localItem.isStudioCatalog,
        isCustom: mapped.isCustom ?? localItem.isCustom,
      };
      const updated = [syncedItem, ...current.filter((d) => d.id !== localItem.id)];
      await idbSaveAllDesigns(updated);
      return { design: syncedItem, status: 'synced' };
    }
  } catch {
    // Offline-first persistence already complete
  }

  return { design: localItem, status: 'offline' };
}

export async function deleteDesign(id: string): Promise<SyncStatus> {
  const current =
    (await idbGetDesigns()) ??
    stripLegacyFictionalSeeds(readLocalStorage<NailDesign[]>(LS_DESIGNS_KEY, []));
  const filtered = current.filter((d) => d.id !== id);
  await idbSaveAllDesigns(filtered);

  try {
    const res = await fetchWithTimeout(`/api/designs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok || res.status === 404) return 'synced';
  } catch {
    // Offline delete persisted
  }
  return 'offline';
}

export const deleteCustomDesign = deleteDesign;

export function resizeImageToDataUrl(
  file: File,
  maxDimension = 512,
  quality = 0.88
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida'));
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas indisponível'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
