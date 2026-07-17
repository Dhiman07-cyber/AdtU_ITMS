/**
 * D7 Route — PostgreSQL Repository
 *
 * Canonical persistence layer for Route master-data.
 * Reads and writes the `routes` table in Supabase PostgreSQL.
 *
 * PERSISTENCE ONLY — no business logic lives here.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * PostgreSQL column              → Route field
 * id                             → id (PRIMARY KEY; route_id alias dropped — was always identical)
 * route_name                     → routeName
 * stops                          → stops (JSONB array)
 * total_stops                    → totalStops
 * estimated_time                 → estimatedTime
 * status                         → status ('active' | 'inactive')
 * created_at                     → createdAt (ISO string)
 * updated_at                     → updatedAt (ISO string)
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { Route } from '@/lib/types';

// Helper to convert timestamp values
function toISOOrNull(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

// Convert domain Route to PostgreSQL row mapping
function routeDomainToRow(data: Partial<Route>): Record<string, any> {
  const row: Record<string, any> = {};

  // route_id column dropped — was always identical to id. routeId domain field is preserved
  // for backward compatibility but maps to id at the persistence level.
  // Do NOT write route_id to the database.
  if (data.routeName !== undefined) row.route_name = data.routeName;
  if (data.stops !== undefined) row.stops = data.stops;
  if (data.totalStops !== undefined) row.total_stops = data.totalStops;
  else if (data.stops !== undefined) row.total_stops = data.stops.length;
  
  if (data.estimatedTime !== undefined) row.estimated_time = data.estimatedTime;
  
  if (data.status !== undefined) {
    row.status = String(data.status).toLowerCase();
  } else if (data.active !== undefined) {
    row.status = data.active ? 'active' : 'inactive';
  }

  if (data.createdAt !== undefined) row.created_at = toISOOrNull(data.createdAt);
  if (data.updatedAt !== undefined) row.updated_at = toISOOrNull(data.updatedAt);

  return row;
}

// Convert PostgreSQL row to domain Route mapping
function pgRowToRoute(row: Record<string, any>): Route {
  return {
    id: row.id,
    routeId: row.id,  // route_id column dropped; routeId domain field reads from id
    routeName: row.route_name,
    stops: row.stops || [],
    totalStops: row.total_stops || 0,
    estimatedTime: row.estimated_time || '',
    status: row.status === 'inactive' ? 'inactive' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function pgFindAll(): Promise<Route[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('routes').select('*');
  if (error) throw new Error(`RouteRepository (PG) findAll failed: ${error.message}`);
  return (data || []).map(pgRowToRoute);
}

export async function pgFindById(id: string): Promise<Route | null> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('routes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`RouteRepository (PG) findById failed: ${error.message}`);
  if (!data) return null;
  return pgRowToRoute(data);
}

export async function pgUpdate(id: string, data: Partial<Route>): Promise<boolean> {
  const db = getSupabaseServer();
  const row = routeDomainToRow(data);
  row.updated_at = new Date().toISOString();

  const { error } = await db.from('routes').update(row).eq('id', id);
  if (error) throw new Error(`RouteRepository (PG) update failed: ${error.message}`);
  return true;
}

export async function pgRemove(id: string): Promise<boolean> {
  const db = getSupabaseServer();
  const { error } = await db.from('routes').delete().eq('id', id);
  if (error) throw new Error(`RouteRepository (PG) remove failed: ${error.message}`);
  return true;
}

export async function pgInsert(data: Omit<Route, 'id'> & { id?: string }): Promise<string | null> {
  const db = getSupabaseServer();
  const row = routeDomainToRow(data);
  const docId = data.id || data.routeId;
  row.id = docId;
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db.from('routes').insert(row);
  if (error) throw new Error(`RouteRepository (PG) insert failed: ${error.message}`);
  return docId || null;
}

export async function pgUpsert(data: Route): Promise<void> {
  const db = getSupabaseServer();
  const row = routeDomainToRow(data);
  if (!data.id) throw new Error('RouteRepository (PG) upsert requires id');
  row.id = data.id;
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db.from('routes').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`RouteRepository (PG) upsert failed: ${error.message}`);
}

export async function pgCount(): Promise<number> {
  const db = getSupabaseServer();
  const { count, error } = await db.from('routes').select('*', { count: 'exact', head: true });
  if (error) throw new Error(`RouteRepository (PG) count failed: ${error.message}`);
  return count || 0;
}
