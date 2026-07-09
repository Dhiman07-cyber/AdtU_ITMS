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
 * id / busId                 → id / bus_id
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
 * currentPassengerCount      → current_passenger_count
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
  busId: 'bus_id',
  busNumber: 'bus_number',
  model: 'model',
  year: 'year',
  capacity: 'capacity',
  driverUID: 'driver_uid',
  driverName: 'driver_name',
  routeId: 'route_id',
  routeName: 'route_name',
  status: 'status',
  currentStudents: 'current_students',
  currentPassengerCount: 'current_passenger_count',
  lastStartedAt: 'last_started_at',
  lastEndedAt: 'last_ended_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const KNOWN_BUS_FIELDS = new Set(Object.keys(BUS_FIELD_MAP));

// ─── Driver Field Map ─────────────────────────────────────────────────────────

const DRIVER_FIELD_MAP: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  fullName: 'full_name',
  name: 'full_name',
  phone: 'phone',
  alternatePhone: 'alternate_phone',
  licenseNumber: 'license_number',
  aadharNumber: 'aadhar_number',
  employeeId: 'employee_id',
  address: 'address',
  profilePhotoUrl: 'profile_photo_url',
  assignedBusId: 'assigned_bus_id',
  assignedRouteId: 'assigned_route_id',
  busId: 'bus_id',
  routeId: 'route_id',
  busAssigned: 'bus_assigned',
  driverId: 'driver_id',
  joiningDate: 'joining_date',
  shift: 'shift',
  status: 'status',
  tripActive: 'trip_active',
  activeTripId: 'active_trip_id',
  isReserved: 'is_reserved',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const KNOWN_DRIVER_FIELDS = new Set(Object.keys(DRIVER_FIELD_MAP));

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
  const extras: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    const pgCol = BUS_FIELD_MAP[key];
    if (pgCol) {
      row[pgCol] = value;
    } else if (!KNOWN_BUS_FIELDS.has(key)) {
      extras[key] = value;
    }
  }

  if (Object.keys(extras).length > 0) {
    row.extras = extras;
  }
  return row;
}

function pgRowToBus(row: Record<string, any>): Bus {
  const bus: Bus = {
    id: row.id,
    busId: row.bus_id || row.id,
    busNumber: row.bus_number || '',
    model: row.model,
    year: row.year,
    capacity: row.capacity ?? 0,
    driverUID: row.driver_uid,
    driverName: row.driver_name,
    routeId: row.route_id,
    routeName: row.route_name,
    status: row.status || 'inactive',
    currentStudents: row.current_students,
    currentPassengerCount: row.current_passenger_count,
    lastStartedAt: row.last_started_at,
    lastEndedAt: row.last_ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.extras && typeof row.extras === 'object') {
    Object.assign(bus, row.extras);
  }

  return bus;
}

// ─── Driver Mappers ───────────────────────────────────────────────────────────

function driverDomainToRow(data: Partial<Driver>): Record<string, any> {
  const row: Record<string, any> = {};
  const extras: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') {
      row['uid'] = value;
      continue;
    }
    const pgCol = DRIVER_FIELD_MAP[key];
    if (pgCol) {
      row[pgCol] = value;
    } else if (!KNOWN_DRIVER_FIELDS.has(key)) {
      extras[key] = value;
    }
  }

  if (Object.keys(extras).length > 0) {
    row.extras = extras;
  }
  return row;
}

function pgRowToDriver(row: Record<string, any>): Driver {
  const driver: Driver = {
    id: row.uid,
    uid: row.uid,
    name: row.full_name || '',
    fullName: row.full_name || '',
    email: row.email || '',
    phone: row.phone,
    alternatePhone: row.alternate_phone,
    licenseNumber: row.license_number,
    assignedBusId: row.assigned_bus_id,
    assignedRouteId: row.assigned_route_id,
    busId: row.bus_id,
    routeId: row.route_id,
    busAssigned: row.bus_assigned,
    driverId: row.driver_id,
    joiningDate: row.joining_date,
    shift: row.shift,
    status: row.status,
    profilePhotoUrl: row.profile_photo_url,
    tripActive: row.trip_active,
    activeTripId: row.active_trip_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.extras && typeof row.extras === 'object') {
    Object.assign(driver, row.extras);
  }

  return driver;
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

// ─── Driver Public API ────────────────────────────────────────────────────────

export async function pgFindAllDrivers(): Promise<Driver[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('driver_profiles').select('*');
  if (error) throw new Error(`FleetRepository (PG) findAllDrivers failed: ${error.message}`);
  return (data || []).map(pgRowToDriver);
}

export async function pgFindDriverById(id: string): Promise<Driver | null> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('driver_profiles').select('*').eq('uid', id).maybeSingle();
  if (error) throw new Error(`FleetRepository (PG) findDriverById failed: ${error.message}`);
  if (!data) return null;
  return pgRowToDriver(data);
}

export async function pgUpdateDriver(id: string, data: Partial<Driver>): Promise<void> {
  const db = getSupabaseServer();
  const row = driverDomainToRow(data);
  delete row.uid;
  row.updated_at = new Date().toISOString();

  if (row.extras) {
    const { data: current, error: readError } = await db
      .from('driver_profiles')
      .select('extras')
      .eq('uid', id)
      .maybeSingle();
    if (!readError && current) {
      row.extras = { ...(current.extras || {}), ...row.extras };
    }
  }

  const { error } = await db.from('driver_profiles').update(row).eq('uid', id);
  if (error) throw new Error(`FleetRepository (PG) updateDriver failed: ${error.message}`);
}

export async function pgRemoveDriver(id: string): Promise<void> {
  const db = getSupabaseServer();
  const { error } = await db.from('driver_profiles').delete().eq('uid', id);
  if (error) throw new Error(`FleetRepository (PG) removeDriver failed: ${error.message}`);
}

export async function pgUpsertDriver(driver: Partial<Driver> & { uid: string }): Promise<void> {
  const db = getSupabaseServer();
  const row = driverDomainToRow(driver);
  if (!row.uid) throw new Error('FleetRepository (PG) upsertDriver requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db.from('driver_profiles').upsert(row, { onConflict: 'uid' });
  if (error) throw new Error(`FleetRepository (PG) upsertDriver failed: ${error.message}`);
}

export async function pgCountDrivers(): Promise<number> {
  const db = getSupabaseServer();
  const { count, error } = await db.from('driver_profiles').select('*', { count: 'exact', head: true });
  if (error) throw new Error(`FleetRepository (PG) countDrivers failed: ${error.message}`);
  return count || 0;
}
