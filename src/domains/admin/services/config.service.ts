/**
 * D11 Config Service — business logic for system configuration and markers.
 *
 * All persistence handled directly in Firestore (`settings` and `system_markers` collections).
 * Config keys: 'config', 'landing', 'ui', 'privacy', 'terms'
 * Marker keys: 'activation_{year}', 'soft_block_completed_{year}'
 */
import { adminDb } from '@/lib/firebase-admin';
import { stripUnsafeObjectKeys } from '@/lib/security/object-safety';
import { getSupabaseServer } from '@/lib/supabase-server';

function getSupabase() {
  try {
    return getSupabaseServer();
  } catch {
    return null;
  }
}

async function getFromPg<T>(key: string): Promise<ConfigResult<T> | null> {
  const supabase = getSupabase();
  if (!supabase || !process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value, updated_at, updated_by')
      .eq('key', key)
      .maybeSingle();
    if (error || !data || !data.value) return null;
    return {
      data: data.value as T,
      updatedAt: data.updated_at || null,
      updatedByUid: data.updated_by || null,
    };
  } catch {
    return null;
  }
}

async function saveToPg(key: string, value: Record<string, unknown>, updatedByUid?: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    await supabase.from('system_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: updatedByUid || null,
    });
  } catch (err) {
    console.warn(`[config.service] Failed to persist ${key} to system_settings:`, err);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConfigResult<T> = {
  data: T;
  updatedAt: string | null;
  updatedByUid: string | null;
};

export interface SystemConfig {
  appName: string;
  busFee: {
    amount: number;
    updatedAt?: string;
    updatedBy?: string;
    version?: number;
    history?: any[];
  };
  paymentExport?: {
    startYear: number;
    interval: number;
  };
  academicYearEnd?: string;
  renewalReminder?: string;
  renewalDeadline?: string;
  softBlock?: string;
  hardBlock?: string;
  version?: string;
  mapProvider?: 'guwahati';
  [key: string]: any;
}

export interface LandingConfig {
  videoPath: string;
  supportPhones: string[];
  email: string;
  [key: string]: any;
}

export interface UiConfig {
  version: string;
  [key: string]: any;
}

export interface LegalConfigSection {
  title: string;
  content: string;
}

export interface LegalConfig {
  title: string;
  sections: LegalConfigSection[];
}

// ─── Config Cleaning ─────────────────────────────────────────────────────────

const UI_FIELDS_TO_STRIP = ['icon', 'gradient', 'color', 'description', 'label'];

function cleanConfigForStorage(config: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripUnsafeObjectKeys({ ...config }) as Record<string, unknown>;

  for (const key of Object.keys(cleaned)) {
    if (UI_FIELDS_TO_STRIP.includes(key)) {
      delete cleaned[key];
    }
  }

  const busFee = cleaned.busFee as Record<string, unknown> | undefined;
  if (busFee && Array.isArray(busFee.history)) {
    if (busFee.history.length > 3) {
      busFee.history = busFee.history.slice(-3);
    }
  }

  return cleaned;
}

// ─── Cache Layer ─────────────────────────────────────────────────────────────

const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL
const configMemoryCache = new Map<string, { data: any; expiresAt: number }>();

export function invalidateConfigCache(key?: string): void {
  if (key) {
    configMemoryCache.delete(key);
  } else {
    configMemoryCache.clear();
  }
}

// ─── System Config ───────────────────────────────────────────────────────────

export async function getSystemConfig(): Promise<ConfigResult<SystemConfig>> {
  const cached = configMemoryCache.get('config');
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 1. PostgreSQL system_settings (Authoritative Source of Truth)
  const pgResult = await getFromPg<SystemConfig>('config');
  if (pgResult && pgResult.data && Object.keys(pgResult.data).length > 0) {
    configMemoryCache.set('config', { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  // 2. Fallback to Firestore / in-memory default
  const defaultFallback: ConfigResult<SystemConfig> = {
    data: { appName: 'AdtU Bus Services', busFee: { amount: 5000, version: 1 } } as any,
    updatedAt: null,
    updatedByUid: null,
  };

  if (!adminDb) {
    configMemoryCache.set('config', { data: defaultFallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return defaultFallback;
  }

  try {
    const doc = await adminDb.collection('settings').doc('config').get();
    if (!doc.exists) {
      configMemoryCache.set('config', { data: defaultFallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
      return defaultFallback;
    }

    const data = doc.data() as SystemConfig;
    const result: ConfigResult<SystemConfig> = {
      data: data,
      updatedAt: data.lastUpdated || data.updatedAt || null,
      updatedByUid: data.updatedBy || null,
    };
    configMemoryCache.set('config', { data: result, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return result;
  } catch {
    configMemoryCache.set('config', { data: defaultFallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return defaultFallback;
  }
}

export async function updateSystemConfig(
  data: Partial<SystemConfig>,
  updatedByUid: string,
): Promise<SystemConfig> {
  const current = await getSystemConfig();
  const previous = current.data || ({} as SystemConfig);

  const merged = { ...previous, ...data };
  const cleaned = cleanConfigForStorage(merged as Record<string, unknown>);
  cleaned.lastUpdated = new Date().toISOString();
  cleaned.updatedBy = updatedByUid;

  // 1. Write to PostgreSQL system_settings
  await saveToPg('config', cleaned, updatedByUid);

  // 2. Dual-write to Firestore if adminDb initialized (backward-compat)
  if (adminDb) {
    try {
      await adminDb.collection('settings').doc('config').set(cleaned, { merge: true });
    } catch (err) {
      console.warn('[config.service] Firestore dual-write failed (non-critical):', err);
    }
  }

  configMemoryCache.delete('config');
  return cleaned as SystemConfig;
}

// ─── Landing Config ──────────────────────────────────────────────────────────

export async function getLandingConfig(): Promise<ConfigResult<LandingConfig>> {
  const cached = configMemoryCache.get('landing');
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const defaultConfig: LandingConfig = {
    heroTitle: 'AdtU Bus Services',
    heroSubtitle: 'Smart Campus Transit Portal',
    features: [],
    updatedAt: new Date().toISOString(),
  } as any;

  // 1. PostgreSQL system_settings
  const pgResult = await getFromPg<LandingConfig>('landing');
  if (pgResult && pgResult.data && Object.keys(pgResult.data).length > 0) {
    configMemoryCache.set('landing', { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  if (!adminDb) {
    return {
      data: defaultConfig,
      updatedAt: null,
      updatedByUid: null,
    };
  }

  try {
    const doc = await adminDb.collection('settings').doc('landing').get();
    if (!doc.exists) {
      const fallback: ConfigResult<LandingConfig> = {
        data: defaultConfig,
        updatedAt: null,
        updatedByUid: null,
      };
      configMemoryCache.set('landing', { data: fallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
      return fallback;
    }

    const data = doc.data() as LandingConfig;
    const result: ConfigResult<LandingConfig> = {
      data: data,
      updatedAt: data.updatedAt || data.lastUpdated || null,
      updatedByUid: data.updatedBy || null,
    };
    configMemoryCache.set('landing', { data: result, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return result;
  } catch (error) {
    console.warn('[getLandingConfig] Firestore read failed, returning fallback config:', error);
    return {
      data: defaultConfig,
      updatedAt: null,
      updatedByUid: null,
    };
  }
}

export async function updateLandingConfig(
  data: Partial<LandingConfig>,
  updatedByUid: string,
): Promise<void> {
  const current = await getLandingConfig();
  const previous = current.data || ({} as LandingConfig);

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await saveToPg('landing', merged as Record<string, unknown>, updatedByUid);

  if (adminDb) {
    try {
      await adminDb.collection('settings').doc('landing').set(merged, { merge: true });
    } catch (err) {
      console.warn('[updateLandingConfig] Firestore write failed:', err);
    }
  }
  configMemoryCache.delete('landing');
}

// ─── UI Config ───────────────────────────────────────────────────────────────

export async function getUiConfig(): Promise<ConfigResult<UiConfig> | null> {
  const cached = configMemoryCache.get('ui');
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 1. PostgreSQL system_settings
  const pgResult = await getFromPg<UiConfig>('ui');
  if (pgResult && pgResult.data) {
    configMemoryCache.set('ui', { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  if (!adminDb) return null;

  try {
    const doc = await adminDb.collection('settings').doc('ui').get();
    if (!doc.exists) return null;

    const data = doc.data() as UiConfig;
    const result: ConfigResult<UiConfig> = {
      data,
      updatedAt: data.updatedAt || data.lastUpdated || null,
      updatedByUid: data.updatedBy || null,
    };
    configMemoryCache.set('ui', { data: result, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return result;
  } catch {
    return null;
  }
}

export async function updateUiConfig(
  data: Partial<UiConfig>,
  updatedByUid: string,
): Promise<void> {
  const current = await getUiConfig();
  const previous = current?.data || ({} as UiConfig);

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await saveToPg('ui', merged as Record<string, unknown>, updatedByUid);

  if (adminDb) {
    try {
      await adminDb.collection('settings').doc('ui').set(merged, { merge: true });
    } catch (err) {
      console.warn('[updateUiConfig] Firestore write failed:', err);
    }
  }
  configMemoryCache.delete('ui');
}

// ─── Legal Config (Privacy / Terms) ──────────────────────────────────────────

export async function getLegalConfig(type: 'privacy' | 'terms'): Promise<ConfigResult<LegalConfig>> {
  const cacheKey = `legal:${type}`;
  const cached = configMemoryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // 1. PostgreSQL system_settings
  const pgResult = await getFromPg<LegalConfig>(type);
  if (pgResult && pgResult.data) {
    configMemoryCache.set(cacheKey, { data: pgResult, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return pgResult;
  }

  const fallback: ConfigResult<LegalConfig> = {
    data: { title: type === 'privacy' ? 'Privacy Policy' : 'Terms of Service', sections: [] },
    updatedAt: null,
    updatedByUid: null,
  };

  if (!adminDb) {
    configMemoryCache.set(cacheKey, { data: fallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return fallback;
  }

  try {
    const doc = await adminDb.collection('settings').doc(type).get();
    if (!doc.exists) {
      configMemoryCache.set(cacheKey, { data: fallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
      return fallback;
    }

    const data = doc.data() as LegalConfig;
    const result: ConfigResult<LegalConfig> = {
      data: data,
      updatedAt: (data as any).updatedAt || (data as any).lastUpdated || null,
      updatedByUid: (data as any).updatedBy || null,
    };
    configMemoryCache.set(cacheKey, { data: result, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return result;
  } catch {
    configMemoryCache.set(cacheKey, { data: fallback, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return fallback;
  }
}

export async function updateLegalConfig(
  type: 'privacy' | 'terms',
  data: Partial<LegalConfig>,
  updatedByUid: string,
): Promise<void> {
  const current = await getLegalConfig(type);
  const previous = current.data || ({} as LegalConfig);

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await saveToPg(type, merged as Record<string, unknown>, updatedByUid);

  if (adminDb) {
    try {
      await adminDb.collection('settings').doc(type).set(merged, { merge: true });
    } catch (err) {
      console.warn(`[updateLegalConfig] Firestore write failed for ${type}:`, err);
    }
  }
  configMemoryCache.delete(`legal:${type}`);
}

// ─── System Markers ──────────────────────────────────────────────────────────

export async function findMarker(key: string): Promise<Record<string, unknown> | null> {
  const pgResult = await getFromPg<Record<string, unknown>>(`marker:${key}`);
  if (pgResult && pgResult.data) return pgResult.data;

  if (!adminDb) return null;
  try {
    const doc = await adminDb.collection('system_markers').doc(key).get();
    if (!doc.exists) return null;
    return doc.data() || null;
  } catch {
    return null;
  }
}

export async function upsertMarker(
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await saveToPg(`marker:${key}`, payload);

  if (adminDb) {
    try {
      await adminDb.collection('system_markers').doc(key).set(payload, { merge: true });
    } catch (err) {
      console.warn(`[upsertMarker] Firestore write failed for marker ${key}:`, err);
    }
  }
}


