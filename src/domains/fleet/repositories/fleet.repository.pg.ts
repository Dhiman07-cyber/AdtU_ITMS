/**
 * D6 Fleet — PostgreSQL Repository
 *
 * Canonical persistence layer for all Fleet (Bus + Driver) master-data.
 *
 * Buses  → PostgreSQL `buses` table (Supabase)
 * Drivers → PostgreSQL `driver_profiles` table (Supabase, owned by D1 Identity
 *            but referenced here as the authoritative source per D6 Fleet's
 *            read-only mandate on driver master-data).
 *
 * PERSISTENCE ONLY — no business logic lives here.
 * Business logic (capacity, assignment) lives in FleetService.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * Bus (Firestore)            → buses (PostgreSQL)
 * id                          → id (PRIMARY KEY; bus_id alias dropped — was always identical)
 * busNumber                  → bus_number
 * model                      → model
 * year                       → year
 * capacity                   → capacity
 * driverUID                  → driver_uid
 * driverName                 → driver_name
 * routeId                    → route_id
 * routeName                  → route_name
 * status                     → status
 * currentStudents            → current_students (JSONB array)
 * morning/eveningLoad        → morning_load / evening_load
 * currentMembers             → GENERATED AS (morning_load + evening_load) — READ ONLY, never written
 * lastStartedAt              → last_started_at
 * lastEndedAt                → last_ended_at
 * createdAt / updatedAt      → created_at / updated_at
 *
 * Driver (Firestore)         → driver_profiles (PostgreSQL)
 * uid / id                   → uid (PK)
 * email                      → email
 * fullName / name            → full_name
 * phone                      → phone
 * alternatePhone             → alternate_phone
 * licenseNumber              → license_number
 * assignedBusId              → assigned_bus_id
 * assignedRouteId            → assigned_route_id
 * busId                      → bus_id
 * routeId                    → route_id
 * busAssigned                → bus_assigned
 * driverId                   → driver_id
 * joiningDate                → joining_date
 * shift                      → shift
 * status                     → status
 * tripActive                 → trip_active
 * activeTripId               → active_trip_id
 * createdAt / updatedAt      → created_at / updated_at
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { Bus, Driver } from '@/lib/types';


// ─── Bus Field Map ────────────────────────────────────────────────────────────

const BUS_FIELD_MAP: Record<string, string> = {
  id: 'id',
  // busId removed — bus_id column dropped; was always identical to id
  busNumber: 'bus_number',
  model: 'model',
  year: 'year',
  capacity: 'capacity',
  driverUID: 'driver_uid',
  driverName: 'driver_name',
  routeId: 'route_id',
  routeName: 'route_name',
  status: 'status',
  // currentPassengerCount removed — current_passenger_count column dropped; was always identical to current_members
  // currentMembers removed — current_members is now GENERATED ALWAYS AS (morning_load + evening_load) STORED;
  //   writing it explicitly causes a PostgreSQL error. It is READ ONLY.
  morningLoad: 'morning_load',
  eveningLoad: 'evening_load',
  lastStartedAt: 'last_started_at',
  lastEndedAt: 'last_ended_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const VIRTUAL_BUS_FIELDS = new Set(['busId', 'currentPassengerCount', 'currentMembers', 'routeRef']);

// ─── Timestamp helper ─────────────────────────────────────────────────────────

function toISOOrNull(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

// ─── Bus Mappers ──────────────────────────────────────────────────────────────

function busDomainToRow(data: Partial<Bus>): Record<string, any> {
  const row: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (VIRTUAL_BUS_FIELDS.has(key)) continue;

    const pgCol = BUS_FIELD_MAP[key];
    if (pgCol) {
      if (pgCol === 'status' && value) {
        row[pgCol] = String(value).toLowerCase();
      } else {
        row[pgCol] = value;
      }
    }
  }

  return row;
}

function pgRowToBus(row: Record<string, any>): Bus {
  const bus: Bus = {
    id: row.id,
    busId: row.id,  // bus_id column dropped; busId domain field now reads from id
    busNumber: row.bus_number || '',
    model: row.model,
    year: row.year,
    capacity: row.capacity ?? 0,
    driverUID: row.driver_uid,
    driverName: row.driver_name,
    routeId: row.route_id,
    routeName: row.route_name,
    status: row.status || 'inactive',
    // current_passenger_count column dropped; currentPassengerCount now reads from current_members
    currentPassengerCount: row.current_members ?? 0,
    currentMembers: row.current_members ?? 0,
    morningLoad: row.morning_load ?? 0,
    eveningLoad: row.evening_load ?? 0,
    lastStartedAt: row.last_started_at,
    lastEndedAt: row.last_ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  return bus;
}

// ─── Bus Public API ───────────────────────────────────────────────────────────

export async function pgFindAllBuses(): Promise<Bus[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('buses').select('*');
  if (error) throw new Error(`FleetRepository (PG) findAllBuses failed: ${error.message}`);
  return (data || []).map(pgRowToBus);
}

export async function pgFindBusById(id: string): Promise<Bus | null> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('buses').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`FleetRepository (PG) findBusById failed: ${error.message}`);
  if (!data) return null;
  return pgRowToBus(data);
}

export async function pgFindBusesByRouteId(routeId: string): Promise<Bus[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('buses').select('*').eq('route_id', routeId);
  if (error) throw new Error(`FleetRepository (PG) findBusesByRouteId failed: ${error.message}`);
  return (data || []).map(pgRowToBus);
}

export async function pgUnassignRoute(routeId: string): Promise<void> {
  const db = getSupabaseServer();
  const { error } = await db
    .from('buses')
    .update({ route_id: null, route_name: null, updated_at: new Date().toISOString() })
    .eq('route_id', routeId);
  if (error) throw new Error(`FleetRepository (PG) pgUnassignRoute failed: ${error.message}`);
}


export async function pgUpdateBus(id: string, data: Partial<Bus>): Promise<void> {
  const db = getSupabaseServer();
  const row = busDomainToRow(data);
  delete row.id;
  row.updated_at = new Date().toISOString();

  if (row.last_started_at) row.last_started_at = toISOOrNull(row.last_started_at);
  if (row.last_ended_at) row.last_ended_at = toISOOrNull(row.last_ended_at);

  const { error } = await db.from('buses').update(row).eq('id', id);
  if (error) throw new Error(`FleetRepository (PG) updateBus failed: ${error.message}`);
}

export async function pgRemoveBus(id: string): Promise<void> {
  const db = getSupabaseServer();
  const { error } = await db.from('buses').delete().eq('id', id);
  if (error) throw new Error(`FleetRepository (PG) removeBus failed: ${error.message}`);
}

export async function pgUpsertBus(bus: Partial<Bus> & { id: string }): Promise<void> {
  const db = getSupabaseServer();
  const row = busDomainToRow(bus);
  if (!row.id) throw new Error('FleetRepository (PG) upsertBus requires id');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();
  if (row.last_started_at) row.last_started_at = toISOOrNull(row.last_started_at);
  if (row.last_ended_at) row.last_ended_at = toISOOrNull(row.last_ended_at);

  const { error } = await db.from('buses').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`FleetRepository (PG) upsertBus failed: ${error.message}`);
}

export async function pgCountBuses(): Promise<number> {
  const db = getSupabaseServer();
  const { count, error } = await db.from('buses').select('*', { count: 'exact', head: true });
  if (error) throw new Error(`FleetRepository (PG) countBuses failed: ${error.message}`);
  return count || 0;
}

// ─── Capacity Operations ────────────────────────────────────────────────────

export interface CapacityCheckResult {
  busId: string;
  capacity: number;
  morningLoad: number;
  eveningLoad: number;
  currentMembers: number;
  shiftLoad: number;
  available: boolean;
}

export interface CapacityMutationResult {
  busId: string;
  capacity: number;
  morningLoad: number;
  eveningLoad: number;
  currentMembers: number;
  oldShiftLoad: number;
  newShiftLoad: number;
  shift: string;
  success: boolean;
  error?: string;
}

export async function pgCheckBusCapacity(busId: string, shift?: string): Promise<CapacityCheckResult> {
  const db = getSupabaseServer();
  const { data, error } = await db.rpc('bus_check_capacity', {
    p_bus_id: busId,
    p_shift: shift || 'Morning',
  });
  if (error) throw new Error(`FleetRepository (PG) checkBusCapacity failed: ${error.message}`);
  if (!data) throw new Error(`Bus ${busId} not found`);
  if (data.error) throw new Error(data.error);
  return data as CapacityCheckResult;
}

export async function pgIncrementBusCapacity(busId: string, shift?: string): Promise<CapacityMutationResult> {
  const db = getSupabaseServer();
  const { data, error } = await db.rpc('bus_increment_capacity', {
    p_bus_id: busId,
    p_shift: shift || 'Morning',
  });
  if (error) throw new Error(`FleetRepository (PG) incrementBusCapacity failed: ${error.message}`);
  if (!data) throw new Error(`Bus ${busId} not found`);
  if (data.error) throw new Error(data.error);
  return data as CapacityMutationResult;
}

export async function pgDecrementBusCapacity(busId: string, shift?: string): Promise<CapacityMutationResult> {
  const db = getSupabaseServer();
  const { data, error } = await db.rpc('bus_decrement_capacity', {
    p_bus_id: busId,
    p_shift: shift || 'Morning',
  });
  if (error) throw new Error(`FleetRepository (PG) decrementBusCapacity failed: ${error.message}`);
  if (!data) throw new Error(`Bus ${busId} not found`);
  if (data.error) throw new Error(data.error);
  return data as CapacityMutationResult;
}

/**
 * Find buses with available capacity for a given shift.
 *
 * NOTE: JavaScript filtering is used here because Supabase/PostgREST doesn't
 * support column-to-column comparisons in the query builder (e.g., WHERE morning_load < capacity).
 *
 * OPTIMIZATION OPPORTUNITY (Bucket 5):
 * For large fleets (>1000 buses), create a materialized view or RPC:
 *   CREATE VIEW buses_with_capacity AS
 *   SELECT *,
 *     CASE WHEN morning_load < capacity THEN true ELSE false END AS has_morning_capacity,
 *     CASE WHEN evening_load < capacity THEN true ELSE false END AS has_evening_capacity
 *   FROM buses;
 *
 * Current implementation is acceptable for small-to-medium fleets (<1000 buses).
 */
export async function pgFindBusesWithAvailableCapacity(shift?: string): Promise<Bus[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('buses').select('*');
  if (error) throw new Error(`FleetRepository (PG) findBusesWithAvailableCapacity failed: ${error.message}`);
  const buses = (data || []).map(pgRowToBus);
  if (!shift) return buses;
  const normalized = shift.toLowerCase().trim();
  return buses.filter(bus => {
    const load = normalized === 'evening'
      ? (bus.eveningLoad ?? 0)
      : (bus.morningLoad ?? 0);
    return load < bus.capacity;
  });
}


