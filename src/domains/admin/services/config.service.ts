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

// ─── Default Configs ─────────────────────────────────────────────────────────

const DEFAULT_LANDING: LandingConfig = {
  videoPath: 'landing_video/Welcome_Final.mp4',
  supportPhones: [
    '+91 93657 71454',
    '+91 91270 70577',
    '+91 60039 03319',
  ],
  email: 'support@adtu.in',
};

const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  appName: 'AdtU ITMS',
  busFee: {
    amount: 10000,
    version: 1,
    history: [{ amount: 10000, updatedAt: new Date().toISOString(), updatedBy: 'system' }]
  }
};

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
    const historyLen = busFee.history.length;
    if (historyLen > 2) {
      busFee.history = busFee.history.slice(historyLen - 2);
    }
  }

  return cleaned;
}

// ─── System Config ───────────────────────────────────────────────────────────

export async function getSystemConfig(): Promise<ConfigResult<SystemConfig>> {
  if (!adminDb) {
    return { data: DEFAULT_SYSTEM_CONFIG, updatedAt: null, updatedByUid: null };
  }

  const doc = await adminDb.collection('settings').doc('config').get();
  if (!doc.exists) {
    return { data: DEFAULT_SYSTEM_CONFIG, updatedAt: null, updatedByUid: null };
  }

  const data = doc.data() as SystemConfig;
  return {
    data: { ...DEFAULT_SYSTEM_CONFIG, ...data },
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
  const previous = doc.exists ? (doc.data() as SystemConfig) : DEFAULT_SYSTEM_CONFIG;

  const merged = { ...previous, ...data };
  const cleaned = cleanConfigForStorage(merged as Record<string, unknown>);
  cleaned.lastUpdated = new Date().toISOString();
  cleaned.updatedBy = updatedByUid;

  await adminDb.collection('settings').doc('config').set(cleaned, { merge: true });
  return cleaned as SystemConfig;
}

// ─── Landing Config ──────────────────────────────────────────────────────────

export async function getLandingConfig(): Promise<ConfigResult<LandingConfig>> {
  if (!adminDb) {
    return { data: { ...DEFAULT_LANDING }, updatedAt: null, updatedByUid: null };
  }

  const doc = await adminDb.collection('settings').doc('landing').get();
  if (!doc.exists) {
    return {
      data: { ...DEFAULT_LANDING },
      updatedAt: null,
      updatedByUid: null,
    };
  }

  const data = doc.data() as LandingConfig;
  return {
    data: { ...DEFAULT_LANDING, ...data },
    updatedAt: data.updatedAt || data.lastUpdated || null,
    updatedByUid: data.updatedBy || null,
  };
}

export async function updateLandingConfig(
  data: Partial<LandingConfig>,
  updatedByUid: string,
): Promise<void> {
  if (!adminDb) {
    throw new Error('Firebase Admin SDK is not initialized.');
  }

  const doc = await adminDb.collection('settings').doc('landing').get();
  const previous = doc.exists ? (doc.data() as LandingConfig) : DEFAULT_LANDING;

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
  const fallbackTitle = type === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions';
  if (!adminDb) {
    return { data: { title: fallbackTitle, sections: [] }, updatedAt: null, updatedByUid: null };
  }

  const doc = await adminDb.collection('settings').doc(type).get();
  if (!doc.exists) {
    return {
      data: { title: fallbackTitle, sections: [] },
      updatedAt: null,
      updatedByUid: null,
    };
  }

  const data = doc.data() as LegalConfig;
  return {
    data: { title: data.title || fallbackTitle, sections: data.sections || [] },
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
  const fallbackTitle = type === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions';
  const previous = doc.exists ? (doc.data() as LegalConfig) : { title: fallbackTitle, sections: [] };

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
