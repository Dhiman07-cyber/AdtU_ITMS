/**
 * D11 Config Repository — persistence only.
 *
 * system_config: flexible JSONB documents keyed by config_key.
 * system_markers: operational gates keyed by marker_key, support upsert.
 *
 * Persistence is schema-agnostic — the repository does not know business models.
 * updated_by_uid is metadata only — no foreign key constraint.
 * Repositories NEVER contain business logic.
 */
import { getSupabaseServer } from '@/lib/supabase-server';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConfigRow {
  config_key: string;
  config_data: Record<string, unknown>;
  updated_at: string;
  updated_by_uid: string | null;
}

export interface MarkerRow {
  marker_key: string;
  marker_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── System Config ───────────────────────────────────────────────────────────

export async function pgFindConfig(key: string): Promise<ConfigRow | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('system_config')
    .select('*')
    .eq('config_key', key)
    .maybeSingle();

  if (error) {
    throw new Error(`ConfigRepository (PG) find config failed: ${error.message}`);
  }

  return data as ConfigRow | null;
}

export async function pgUpsertConfig(
  key: string,
  data: Record<string, unknown>,
  updatedByUid?: string,
): Promise<void> {
  const db = getSupabaseServer();

  const row = {
    config_key: key,
    config_data: data,
    updated_by_uid: updatedByUid || null,
  };

  const { error } = await db
    .from('system_config')
    .upsert(row, { onConflict: 'config_key' });

  if (error) {
    throw new Error(`ConfigRepository (PG) upsert config failed: ${error.message}`);
  }
}

// ─── System Markers ──────────────────────────────────────────────────────────

export async function pgFindMarker(key: string): Promise<MarkerRow | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('system_markers')
    .select('*')
    .eq('marker_key', key)
    .maybeSingle();

  if (error) {
    throw new Error(`ConfigRepository (PG) find marker failed: ${error.message}`);
  }

  return data as MarkerRow | null;
}

export async function pgUpsertMarker(
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getSupabaseServer();

  const row = {
    marker_key: key,
    marker_data: data,
  };

  const { error } = await db
    .from('system_markers')
    .upsert(row, { onConflict: 'marker_key' });

  if (error) {
    throw new Error(`ConfigRepository (PG) upsert marker failed: ${error.message}`);
  }
}
