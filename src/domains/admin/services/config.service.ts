/**
 * D11 Config Service — business logic for system configuration and markers.
 *
 * All persistence delegated to config.repository.pg.
 * Validation and cleaning logic migrated from system-config-service.ts.
 *
 * Config keys: 'config', 'landing', 'ui', 'privacy', 'terms'
 * Marker keys: 'activation_{year}', 'soft_block_completed_{year}'
 */
import { stripUnsafeObjectKeys } from '@/lib/security/object-safety';
import {
  pgFindConfig,
  pgUpsertConfig,
  pgFindMarker,
  pgUpsertMarker,
} from '../repositories/config.repository.pg';

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

// ─── Config Cleaning (migrated from system-config-service.ts) ────────────────

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
  const row = await pgFindConfig('config');
  if (!row) {
    throw new Error('System configuration missing in database');
  }
  return {
    data: row.config_data as SystemConfig,
    updatedAt: row.updated_at,
    updatedByUid: row.updated_by_uid,
  };
}

export async function updateSystemConfig(
  data: Partial<SystemConfig>,
  updatedByUid: string,
): Promise<SystemConfig> {
  const existing = await pgFindConfig('config');
  const previous = existing ? (existing.config_data as SystemConfig) : {} as SystemConfig;

  const merged = { ...previous, ...data };
  const cleaned = cleanConfigForStorage(merged as Record<string, unknown>);

  await pgUpsertConfig('config', cleaned, updatedByUid);
  return cleaned as SystemConfig;
}

// ─── Landing Config ──────────────────────────────────────────────────────────

export async function getLandingConfig(): Promise<ConfigResult<LandingConfig>> {
  const row = await pgFindConfig('landing');
  if (!row) {
    return {
      data: { ...DEFAULT_LANDING },
      updatedAt: null,
      updatedByUid: null,
    };
  }
  return {
    data: { ...DEFAULT_LANDING, ...row.config_data } as LandingConfig,
    updatedAt: row.updated_at,
    updatedByUid: row.updated_by_uid,
  };
}

export async function updateLandingConfig(
  data: Partial<LandingConfig>,
  updatedByUid: string,
): Promise<void> {
  const existing = await pgFindConfig('landing');
  const previous = existing
    ? { ...DEFAULT_LANDING, ...(existing.config_data as LandingConfig) }
    : { ...DEFAULT_LANDING };

  const merged = { ...previous, ...data };
  await pgUpsertConfig('landing', merged as Record<string, unknown>, updatedByUid);
}

// ─── UI Config ───────────────────────────────────────────────────────────────

export async function getUiConfig(): Promise<ConfigResult<UiConfig> | null> {
  const row = await pgFindConfig('ui');
  if (!row) {
    return null;
  }
  return {
    data: row.config_data as UiConfig,
    updatedAt: row.updated_at,
    updatedByUid: row.updated_by_uid,
  };
}

export async function updateUiConfig(
  data: Partial<UiConfig>,
  updatedByUid: string,
): Promise<void> {
  const existing = await pgFindConfig('ui');
  const previous = existing ? (existing.config_data as UiConfig) : {} as UiConfig;

  const merged = { ...previous, ...data };
  await pgUpsertConfig('ui', merged as Record<string, unknown>, updatedByUid);
}

// ─── Legal Config (Privacy / Terms) ──────────────────────────────────────────

export async function getLegalConfig(type: 'privacy' | 'terms'): Promise<ConfigResult<LegalConfig>> {
  const row = await pgFindConfig(type);
  if (!row) {
    const fallbackTitle = type === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions';
    return {
      data: { title: fallbackTitle, sections: [] },
      updatedAt: null,
      updatedByUid: null,
    };
  }
  return {
    data: row.config_data as unknown as LegalConfig,
    updatedAt: row.updated_at,
    updatedByUid: row.updated_by_uid,
  };
}

export async function updateLegalConfig(
  type: 'privacy' | 'terms',
  data: Partial<LegalConfig>,
  updatedByUid: string,
): Promise<void> {
  const existing = await pgFindConfig(type);
  const fallbackTitle = type === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions';
  const previous: LegalConfig = existing
    ? (existing.config_data as unknown as LegalConfig)
    : { title: fallbackTitle, sections: [] };

  const merged = { ...previous, ...data };
  await pgUpsertConfig(type, merged as Record<string, unknown>, updatedByUid);
}

// ─── System Markers ──────────────────────────────────────────────────────────

export async function findMarker(key: string): Promise<Record<string, unknown> | null> {
  const row = await pgFindMarker(key);
  if (!row) {
    return null;
  }
  return row.marker_data;
}

export async function upsertMarker(
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  await pgUpsertMarker(key, data);
}
