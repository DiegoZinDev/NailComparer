import { DEFAULT_STUDIO_CONFIG, SEED_NAIL_DESIGNS } from '../data/presets';
import type { NailDesign, StudioConfig } from '../types/nail';

const DB_NAME = 'nail-ar-studio-db';
const DB_VERSION = 1;
const STORE_CONFIG = 'studioConfig';
const STORE_DESIGNS = 'nailDesigns';

const LS_CONFIG_KEY = 'nail_ar_studio_config_v1';
const LS_DESIGNS_KEY = 'nail_ar_studio_designs_v1';

export type SyncStatus = 'synced' | 'offline';

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

async function idbGetDesigns(): Promise<NailDesign[] | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DESIGNS, 'readonly');
      const req = tx.objectStore(STORE_DESIGNS).getAll();
      req.onsuccess = () => {
        const rows = (req.result as NailDesign[] | undefined) ?? [];
        resolve(rows.length > 0 ? rows : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSaveAllDesigns(designs: NailDesign[]): Promise<void> {
  writeLocalStorage(LS_DESIGNS_KEY, designs);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DESIGNS, 'readwrite');
      const store = tx.objectStore(STORE_DESIGNS);
      store.clear();
      for (const item of designs) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback already written to localStorage
  }
}

async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = 1800): Promise<Response> {
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
  const existingDesigns = await idbGetDesigns();
  if (!existingDesigns) {
    const lsDesigns = readLocalStorage<NailDesign[] | null>(LS_DESIGNS_KEY, null);
    await idbSaveAllDesigns(lsDesigns && lsDesigns.length > 0 ? lsDesigns : SEED_NAIL_DESIGNS);
  }
}

const CATEGORY_FROM_API: Record<string, NailDesign['category']> = {
  francesinha: 'Francesinha',
  gel: 'Gel',
  cromado: 'Cromado',
  'nail-art': 'Nail Art',
  cliente: 'Cliente',
};

const CATEGORY_TO_API: Record<NailDesign['category'], string> = {
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
    whatsappNumber: String(data.whatsapp ?? data.whatsappNumber ?? DEFAULT_STUDIO_CONFIG.whatsappNumber),
    logoDataUrl: (data.logoDataUrl as string | null) ?? null,
    themePreset: (data.themePreset as StudioConfig['themePreset']) ?? DEFAULT_STUDIO_CONFIG.themePreset,
    primaryColor: String(data.primaryColor ?? DEFAULT_STUDIO_CONFIG.primaryColor),
    accentColor: String(data.accentColor ?? DEFAULT_STUDIO_CONFIG.accentColor),
    surfaceColor: String(data.surfaceColor ?? DEFAULT_STUDIO_CONFIG.surfaceColor),
    onSurfaceColor:
      data.themePreset === 'minimalist-pearl' ? '#1A1718' : DEFAULT_STUDIO_CONFIG.onSurfaceColor,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

function mapDesignFromApi(raw: Record<string, unknown>): NailDesign {
  const rawCat = String(raw.category ?? 'gel');
  const category = CATEGORY_FROM_API[rawCat.toLowerCase()] ?? (rawCat as NailDesign['category']);
  const rawPattern = String(raw.patternType ?? 'solid');
  const patternType = (rawPattern === 'custom-photo' ? 'solid' : rawPattern) as NailDesign['patternType'];
  const finish: NailDesign['finish'] =
    patternType === 'chrome' || patternType === 'aurora'
      ? 'chrome'
      : patternType === 'cat-eye'
        ? 'velvet'
        : patternType === 'gold-foil'
          ? 'glitter'
          : 'glossy';

  return {
    id: String(raw.id),
    name: String(raw.name ?? 'Design'),
    category,
    patternType,
    baseColor: String(raw.baseColor ?? '#EBD8CE'),
    secondaryColor: typeof raw.accentColor === 'string' ? raw.accentColor : undefined,
    accentColor: typeof raw.accentColor === 'string' ? raw.accentColor : '#FFFFFF',
    finish,
    imageDataUrl: (raw.imageDataUrl as string | null) ?? null,
    isCustom: Boolean(raw.isCustomReference ?? raw.isCustom),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
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
      const merged = { ...normalized, ...mapConfigFromApi(serverData), onSurfaceColor: normalized.onSurfaceColor };
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
      if (Array.isArray(remoteRaw) && remoteRaw.length > 0) {
        const remote = remoteRaw.map(mapDesignFromApi);
        const local = (await idbGetDesigns()) ?? [];
        const remoteIds = new Set(remote.map((d) => String(d.id)));
        const localUnsynced = local.filter((d) => d.isCustom && !remoteIds.has(String(d.id)));
        const merged = [...localUnsynced, ...remote];
        await idbSaveAllDesigns(merged);
        return { designs: merged, status: 'synced' };
      }
    }
  } catch {
    // Offline fallback
  }

  const localDesigns =
    (await idbGetDesigns()) ?? readLocalStorage<NailDesign[]>(LS_DESIGNS_KEY, SEED_NAIL_DESIGNS);
  return { designs: localDesigns, status: 'offline' };
}

export async function createNailDesign(
  design: Omit<NailDesign, 'id' | 'createdAt'>
): Promise<{ design: NailDesign; status: SyncStatus }> {
  const localItem: NailDesign = {
    ...design,
    id: `custom-${Date.now()}`,
    isCustom: true,
    createdAt: new Date().toISOString(),
  };

  const current = (await idbGetDesigns()) ?? SEED_NAIL_DESIGNS;
  await idbSaveAllDesigns([localItem, ...current]);

  try {
    const apiPayload = {
      name: localItem.name,
      category: CATEGORY_TO_API[localItem.category] ?? 'cliente',
      styleType: localItem.imageDataUrl ? 'image' : 'procedural',
      baseColor: localItem.baseColor || '#EBD8CE',
      accentColor: localItem.accentColor || localItem.secondaryColor || '#FFFFFF',
      patternType: localItem.imageDataUrl ? 'custom-photo' : localItem.patternType,
      imageDataUrl: localItem.imageDataUrl ?? null,
      defaultScale: 1.0,
      defaultRotation: 0,
      defaultOpacity: 0.92,
      isCustomReference: true,
    };
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
      const syncedItem: NailDesign = {
        ...localItem,
        ...mapDesignFromApi(saved),
        finish: localItem.finish,
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

export async function deleteCustomDesign(id: string): Promise<SyncStatus> {
  const current = (await idbGetDesigns()) ?? SEED_NAIL_DESIGNS;
  const filtered = current.filter((d) => d.id !== id);
  await idbSaveAllDesigns(filtered);

  try {
    const res = await fetchWithTimeout(`/api/designs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) return 'synced';
  } catch {
    // Offline delete persisted
  }
  return 'offline';
}

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
