/**
 * D6 Fleet — Driver Assignment Repository
 *
 * Canonical persistence for driver↔bus ownership (driver_assignments table).
 * Single source of truth — replaces both buses.driver_uid and driver_profiles.bus_id.
 *
 * PERSISTENCE ONLY — no business logic.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * Property (TS)             → Column (PostgreSQL)
 * id                         → id (UUID, PK, gen_random_uuid())
 * driverUid                  → driver_uid
 * busId                      → bus_id
 * routeId                    → route_id
 * assignedAt                 → assigned_at
 * unassignedAt               → unassigned_at
 * assignedBy                 → assigned_by
 * isActive                   → is_active
 * reason                     → reason
 * metadata                   → metadata (JSONB)
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { DriverAssignment } from '@/lib/types';

// ─── Field Map ─────────────────────────────────────────────────────────────────

const FIELD_MAP: Record<string, string> = {
  id: 'id',
  driverUid: 'driver_uid',
  busId: 'bus_id',
  routeId: 'route_id',
  assignedAt: 'assigned_at',
  unassignedAt: 'unassigned_at',
  assignedBy: 'assigned_by',
  isActive: 'is_active',
  reason: 'reason',
  metadata: 'metadata',
};

const KNOWN_FIELDS = new Set(Object.keys(FIELD_MAP));

// ─── Row ↔ Domain Mappers ──────────────────────────────────────────────────────

function rowToDomain(row: Record<string, any>): DriverAssignment {
  return {
    id: row.id,
    driverUid: row.driver_uid,
    busId: row.bus_id,
    routeId: row.route_id,
    assignedAt: row.assigned_at,
    unassignedAt: row.unassigned_at,
    assignedBy: row.assigned_by,
    isActive: row.is_active,
    reason: row.reason,
    metadata: row.metadata,
  };
}

function domainToRow(data: Partial<DriverAssignment>): Record<string, any> {
  const row: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const col = FIELD_MAP[key];
    if (col && value !== undefined) {
      row[col] = value;
    }
  }
  return row;
}

// ─── Queries ────────────────────────────────────────────────────────────────────

/** Get the active assignment for a bus. */
export async function getActiveAssignmentByBusId(busId: string): Promise<DriverAssignment | null> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('driver_assignments')
    .select('*')
    .eq('bus_id', busId)
    .eq('is_active', true)
    .maybeSingle();

  if (!error && data) return rowToDomain(data);
  return null;
}

/** Get the active assignment for a driver. */
export async function getActiveAssignmentByDriverUid(driverUid: string): Promise<DriverAssignment | null> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('driver_assignments')
    .select('*')
    .eq('driver_uid', driverUid)
    .eq('is_active', true)
    .maybeSingle();

  if (!error && data) return rowToDomain(data);
  return null;
}

/** Get the driver UID assigned to a bus. Convenience wrapper. */
export async function getDriverUidByBusId(busId: string): Promise<string | null> {
  const supabase = getSupabaseServer();
  const { data: assignment } = await supabase
    .from('driver_assignments')
    .select('driver_uid')
    .eq('bus_id', busId)
    .eq('is_active', true)
    .maybeSingle();

  if (assignment?.driver_uid) return assignment.driver_uid;

  const { data: bus } = await supabase
    .from('buses')
    .select('driver_uid')
    .eq('id', busId)
    .maybeSingle();

  return bus?.driver_uid ?? null;
}

/** Get the bus ID assigned to a driver. Convenience wrapper. */
export async function getBusIdByDriverUid(driverUid: string): Promise<string | null> {
  const supabase = getSupabaseServer();
  const { data: assignment } = await supabase
    .from('driver_assignments')
    .select('bus_id')
    .eq('driver_uid', driverUid)
    .eq('is_active', true)
    .maybeSingle();

  if (assignment?.bus_id) return assignment.bus_id;

  const { data: driver } = await supabase
    .from('driver_profiles')
    .select('bus_id')
    .eq('uid', driverUid)
    .maybeSingle();

  return driver?.bus_id ?? null;
}

/** List all active assignments (for fleet dashboard, admin views). */
export async function listActiveAssignments(): Promise<DriverAssignment[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('driver_assignments')
    .select('*')
    .eq('is_active', true)
    .order('assigned_at', { ascending: false });

  if (error || !data) return [];
  return data.map(rowToDomain);
}

/** Get assignment history for a bus. */
export async function getAssignmentHistoryByBusId(busId: string, limit = 20): Promise<DriverAssignment[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('driver_assignments')
    .select('*')
    .eq('bus_id', busId)
    .order('assigned_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(rowToDomain);
}

/** Get assignment history for a driver. */
export async function getAssignmentHistoryByDriverUid(driverUid: string, limit = 20): Promise<DriverAssignment[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('driver_assignments')
    .select('*')
    .eq('driver_uid', driverUid)
    .order('assigned_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map(rowToDomain);
}

// ─── Mutations ──────────────────────────────────────────────────────────────────

/**
 * Create a new active assignment and deactivate any previous active assignment
 * for the same driver or bus. This is the canonical way to assign a driver to a bus.
 */
export async function assignDriverToBus(
  driverUid: string,
  busId: string,
  options?: {
    routeId?: string;
    assignedBy?: string;
    reason?: DriverAssignment['reason'];
    metadata?: Record<string, any>;
  },
): Promise<DriverAssignment | null> {
  const supabase = getSupabaseServer();

  // Deactivate any prior active assignment for this driver or bus atomically
  await supabase
    .from('driver_assignments')
    .update({
      unassigned_at: new Date().toISOString(),
      is_active: false,
    })
    .eq('is_active', true)
    .or(`driver_uid.eq.${driverUid},bus_id.eq.${busId}`);

  // Sync buses table: clear old assignment for this driver and set on new bus
  await supabase
    .from('buses')
    .update({ driver_uid: '' })
    .eq('driver_uid', driverUid);

  await supabase
    .from('buses')
    .update({ driver_uid: driverUid })
    .eq('id', busId);

  // Sync driver_profiles table
  await supabase
    .from('driver_profiles')
    .update({ bus_id: busId, route_id: options?.routeId || null })
    .eq('uid', driverUid);

  // Insert the new assignment
  const { data, error } = await supabase
    .from('driver_assignments')
    .insert({
      driver_uid: driverUid,
      bus_id: busId,
      route_id: options?.routeId ?? null,
      assigned_by: options?.assignedBy ?? 'system',
      reason: options?.reason ?? 'assignment',
      metadata: options?.metadata ?? {},
      is_active: true,
      assigned_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) return null;
  return rowToDomain(data);
}

/** Deactivate an active assignment (unassign a driver from a bus). */
export async function unassignDriver(driverUid: string, reason = 'admin_reassign'): Promise<boolean> {
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from('driver_assignments')
    .update({
      unassigned_at: new Date().toISOString(),
      is_active: false,
      reason,
    })
    .eq('driver_uid', driverUid)
    .eq('is_active', true);

  await supabase
    .from('buses')
    .update({ driver_uid: '' })
    .eq('driver_uid', driverUid);

  await supabase
    .from('driver_profiles')
    .update({ bus_id: null })
    .eq('uid', driverUid);

  return !error;
}
