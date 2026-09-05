/**
 * D11 Config Service — business logic for system configuration and markers.
 *
 * All persistence handled directly in Firestore (`settings` and `system_markers` collections).
 * Config keys: 'config', 'landing', 'ui', 'privacy', 'terms'
 * Marker keys: 'activation_{year}', 'soft_block_completed_{year}'
 */
import { adminDb } from '@/lib/firebase-admin';
import { stripUnsafeObjectKeys } from '@/lib/security/object-safety';

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

// ─── System Config ───────────────────────────────────────────────────────────

export async function getSystemConfig(): Promise<ConfigResult<SystemConfig>> {
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized. Please try again later.');
  }

  const doc = await adminDb.collection('settings').doc('config').get();
  if (!doc.exists) {
    return {
      data: { appName: 'AdtU Bus Services', busFee: { amount: 5000, version: 1 } } as any,
      updatedAt: null,
      updatedByUid: null,
    };
  }

  const data = doc.data() as SystemConfig;
  return {
    data: data,
    updatedAt: data.lastUpdated || data.updatedAt || null,
    updatedByUid: data.updatedBy || null,
  };
}

export async function updateSystemConfig(
  data: Partial<SystemConfig>,
  updatedByUid: string,
): Promise<SystemConfig> {
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized.');
  }

  const doc = await adminDb.collection('settings').doc('config').get();
  const previous = doc.exists ? (doc.data() as SystemConfig) : {} as SystemConfig;

  const merged = { ...previous, ...data };
  const cleaned = cleanConfigForStorage(merged as Record<string, unknown>);
  cleaned.lastUpdated = new Date().toISOString();
  cleaned.updatedBy = updatedByUid;

  await adminDb.collection('settings').doc('config').set(cleaned, { merge: true });
  return cleaned as SystemConfig;
}

// ─── Landing Config ──────────────────────────────────────────────────────────

export async function getLandingConfig(): Promise<ConfigResult<LandingConfig>> {
  const defaultConfig: LandingConfig = {
    heroTitle: 'AdtU Bus Services',
    heroSubtitle: 'Smart Campus Transit Portal',
    features: [],
    updatedAt: new Date().toISOString(),
  } as any;

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
      return {
        data: defaultConfig,
        updatedAt: null,
        updatedByUid: null,
      };
    }

    const data = doc.data() as LandingConfig;
    return {
      data: data,
      updatedAt: data.updatedAt || data.lastUpdated || null,
      updatedByUid: data.updatedBy || null,
    };
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
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized.');
  }

  const doc = await adminDb.collection('settings').doc('landing').get();
  const previous = doc.exists ? (doc.data() as LandingConfig) : {} as LandingConfig;

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await adminDb.collection('settings').doc('landing').set(merged, { merge: true });
}

// ─── UI Config ───────────────────────────────────────────────────────────────

export async function getUiConfig(): Promise<ConfigResult<UiConfig> | null> {
  if (!adminDb) return null;

  const doc = await adminDb.collection('settings').doc('ui').get();
  if (!doc.exists) return null;

  const data = doc.data() as UiConfig;
  return {
    data,
    updatedAt: data.updatedAt || data.lastUpdated || null,
    updatedByUid: data.updatedBy || null,
  };
}

export async function updateUiConfig(
  data: Partial<UiConfig>,
  updatedByUid: string,
): Promise<void> {
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized.');
  }

  const doc = await adminDb.collection('settings').doc('ui').get();
  const previous = doc.exists ? (doc.data() as UiConfig) : {};

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await adminDb.collection('settings').doc('ui').set(merged, { merge: true });
}

// ─── Legal Config (Privacy / Terms) ──────────────────────────────────────────

export async function getLegalConfig(type: 'privacy' | 'terms'): Promise<ConfigResult<LegalConfig>> {
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized. Please try again later.');
  }

  const doc = await adminDb.collection('settings').doc(type).get();
  if (!doc.exists) {
    return {
      data: { title: type === 'privacy' ? 'Privacy Policy' : 'Terms of Service', sections: [] },
      updatedAt: null,
      updatedByUid: null,
    };
  }

  const data = doc.data() as LegalConfig;
  return {
    data: data,
    updatedAt: (data as any).updatedAt || (data as any).lastUpdated || null,
    updatedByUid: (data as any).updatedBy || null,
  };
}

export async function updateLegalConfig(
  type: 'privacy' | 'terms',
  data: Partial<LegalConfig>,
  updatedByUid: string,
): Promise<void> {
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized.');
  }

  const doc = await adminDb.collection('settings').doc(type).get();
  const previous = doc.exists ? (doc.data() as LegalConfig) : {} as LegalConfig;

  const merged = { ...previous, ...data, updatedAt: new Date().toISOString(), updatedBy: updatedByUid };
  await adminDb.collection('settings').doc(type).set(merged, { merge: true });
}

// ─── System Markers ──────────────────────────────────────────────────────────

export async function findMarker(key: string): Promise<Record<string, unknown> | null> {
  if (!adminDb) return null;
  const doc = await adminDb.collection('system_markers').doc(key).get();
  if (!doc.exists) return null;
  return doc.data() || null;
}

export async function upsertMarker(
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized.');
  }
  await adminDb.collection('system_markers').doc(key).set({
    ...data,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}


