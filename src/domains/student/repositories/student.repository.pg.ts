/**
 * D3 Student — PostgreSQL Repository
 *
 * Canonical persistence layer for all Student data.
 * Reads and writes the `student_profiles` table in Supabase PostgreSQL.
 *
 * PERSISTENCE ONLY — no business logic lives here.
 * Business logic (entitlement, lifecycle, profile) remains in StudentService.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * PostgreSQL column              → Student field
 * uid                            → uid (also mapped to id for compatibility)
 * email                          → email
 * full_name                      → fullName
 * phone                          → phone
 * alt_phone                      → altPhone
 * parent_name                    → parentName
 * parent_phone                   → parentPhone
 * faculty                        → faculty
 * department                     → department
 * gender                         → gender
 * dob                            → dob
 * enrollment_id                  → enrollmentId
 * blood_group                    → bloodGroup
 * address                        → address
 * profile_photo_url              → profilePhotoUrl
 * bus_id                         → busId
 * route_id                       → routeId
 * assigned_route_id              → assignedRouteId
 * assigned_bus_id                → assignedBusId
 * stop_id                        → stopId
 * stop_name                      → stopName
 * shift                          → shift
 * status                         → status
 * session_duration               → sessionDuration
 * session_start_year             → sessionStartYear
 * session_end_year               → sessionEndYear
 * semester                       → semester
 * valid_until                    → validUntil (ISO string)
 * soft_block                     → softBlock (ISO string)
 * hard_block                     → hardBlock (ISO string)
 * approved_by                    → approvedBy
 * approved_at                    → approvedAt (ISO string)
 * created_at                     → createdAt (ISO string)
 * updated_at                     → updatedAt (ISO string)
 *
 * Derived fields and business logic are NOT stored here.
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { Student } from '@/lib/types';

// ─── Field Map ───────────────────────────────────────────────────────────────

/** Firestore/camelCase field → PostgreSQL snake_case column */
const STUDENT_FIELD_MAP: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  fullName: 'full_name',
  phone: 'phone',
  altPhone: 'alt_phone',
  parentName: 'parent_name',
  parentPhone: 'parent_phone',
  faculty: 'faculty',
  department: 'department',
  gender: 'gender',
  dob: 'dob',
  enrollmentId: 'enrollment_id',
  bloodGroup: 'blood_group',
  address: 'address',
  profilePhotoUrl: 'profile_photo_url',
  busId: 'bus_id',
  routeId: 'route_id',
  assignedRouteId: 'assigned_route_id',
  assignedBusId: 'assigned_bus_id',
  stopId: 'stop_id',
  stopName: 'stop_name',
  shift: 'shift',
  status: 'status',
  sessionDuration: 'session_duration',
  sessionStartYear: 'session_start_year',
  sessionEndYear: 'session_end_year',
  semester: 'semester',
  validUntil: 'valid_until',
  softBlock: 'soft_block',
  hardBlock: 'hard_block',
  approvedBy: 'approved_by',
  approvedAt: 'approved_at',
  lastProcessedApplicationId: 'last_processed_application_id',
  seatReleasedAt: 'seat_released_at',
  pendingProfileUpdate: 'pending_profile_update',
  expiryReminderCount: 'expiry_reminder_count',
  lastExpiryReminderSentAt: 'last_expiry_reminder_sent_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

// ─── Mappers ─────────────────────────────────────────────────────────────────

/** Convert domain student data to PostgreSQL row */
function pgStudentToRow(data: Partial<Student>): Record<string, any> {
  const row: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue; // 'id' maps to uid
    const pgCol = STUDENT_FIELD_MAP[key];
    if (pgCol) {
      row[pgCol] = value;
    }
  }

  return row;
}

/** Convert PostgreSQL row to Student domain object */
function pgRowToStudent(row: Record<string, any>): Student {
  const student: Student = {
    id: row.uid,
    uid: row.uid,
    name: row.full_name || '',
    fullName: row.full_name || '',
    email: row.email || '',
    phone: row.phone || '',
    altPhone: row.alt_phone,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    faculty: row.faculty,
    department: row.department,
    gender: row.gender,
    dob: row.dob,
    enrollmentId: row.enrollment_id,
    bloodGroup: row.blood_group,
    address: row.address,
    profilePhotoUrl: row.profile_photo_url,
    busId: row.bus_id,
    routeId: row.route_id,
    assignedRouteId: row.assigned_route_id,
    assignedBusId: row.assigned_bus_id,
    stopId: row.stop_id,
    stopName: row.stop_name,
    shift: row.shift,
    status: row.status,
    sessionDuration: row.session_duration,
    sessionStartYear: row.session_start_year,
    sessionEndYear: row.session_end_year,
    semester: row.semester,
    validUntil: row.valid_until,
    softBlock: row.soft_block,
    hardBlock: row.hard_block,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    seatReleasedAt: row.seat_released_at,
    pendingProfileUpdate: row.pending_profile_update,
    expiryReminderCount: row.expiry_reminder_count ?? 0,
    lastExpiryReminderSentAt: row.last_expiry_reminder_sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  return student;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Find a student by UID. Returns null if not found.
 */
export async function pgFindByUid(uid: string): Promise<Student | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();

  if (error) {
    throw new Error(`StudentRepository (PG) read failed: ${error.message}`);
  }

  if (!data) return null;

  return pgRowToStudent(data);
}

/**
 * Find a student by document ID (alias for findByUid).
 */
export async function pgFindById(id: string): Promise<Student | null> {
  return pgFindByUid(id);
}

/**
 * Find all students.
 */
export async function pgFindAll(): Promise<Student[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*');

  if (error) {
    throw new Error(`StudentRepository (PG) findAll failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToStudent(row));
}

/**
 * Find students by bus ID (delegates to plural query helper)
 */
export async function pgFindByBusId(busId: string): Promise<Student[]> {
  return pgFindByBusIds([busId]);
}

/**
 * Find students by route ID (delegates to plural query helper)
 */
export async function pgFindByRouteId(routeId: string): Promise<Student[]> {
  return pgFindByRouteIds([routeId]);
}

/**
 * Find students by status (delegates to plural query helper)
 */
export async function pgFindByStatus(status: string): Promise<Student[]> {
  return pgFindByStatuses([status]);
}

/**
 * Find a student by enrollment ID.
 */
export async function pgFindByEnrollmentId(enrollmentId: string): Promise<Student | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .eq('enrollment_id', enrollmentId)
    .maybeSingle();

  if (error) {
    throw new Error(`StudentRepository (PG) findByEnrollmentId failed: ${error.message}`);
  }

  if (!data) return null;

  return pgRowToStudent(data);
}

/**
 * Find students by shift.
 */
export async function pgFindByShift(shift: string): Promise<Student[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .eq('shift', shift);

  if (error) {
    throw new Error(`StudentRepository (PG) findByShift failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToStudent(row));
}

/**
 * Insert a new student profile.
 */
export async function pgInsert(student: Partial<Student>): Promise<void> {
  const db = getSupabaseServer();
  const row = pgStudentToRow(student);

  if (!row.uid) throw new Error('StudentRepository (PG) insert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('student_profiles')
    .insert(row);

  if (error) {
    throw new Error(`StudentRepository (PG) insert failed: ${error.message}`);
  }
}

/**
 * Update a student profile (partial update).
 */
export async function pgUpdate(uid: string, data: Partial<Student>): Promise<void> {
  const db = getSupabaseServer();
  const row = pgStudentToRow(data);

  // Remove uid from update data (can't change PK)
  delete row.uid;
  row.updated_at = new Date().toISOString();

  // Update core fields
  const { error } = await db
    .from('student_profiles')
    .update(row)
    .eq('uid', uid);

  if (error) {
    throw new Error(`StudentRepository (PG) update failed: ${error.message}`);
  }
}

/**
 * Delete a student profile.
 */
export async function pgRemove(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('student_profiles')
    .delete()
    .eq('uid', uid);

  if (error) {
    throw new Error(`StudentRepository (PG) delete failed: ${error.message}`);
  }
}

/**
 * Count students by status.
 */
export async function pgCountByStatus(status: string): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('student_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('status', status);

  if (error) {
    throw new Error(`StudentRepository (PG) countByStatus failed: ${error.message}`);
  }

  return count || 0;
}

/**
 * Count all students.
 */
export async function pgCount(): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('student_profiles')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`StudentRepository (PG) count failed: ${error.message}`);
  }

  return count || 0;
}

/**
 * Upsert a student profile (insert or update on conflict).
 */
export async function pgUpsert(student: Partial<Student>): Promise<void> {
  const db = getSupabaseServer();
  const row = pgStudentToRow(student);

  if (!row.uid) throw new Error('StudentRepository (PG) upsert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('student_profiles')
    .upsert(row, { onConflict: 'uid' });

  if (error) {
    throw new Error(`StudentRepository (PG) upsert failed: ${error.message}`);
  }
}

/**
 * Bulk unassign route references from student profiles.
 */
export async function pgUnassignRoute(routeId: string): Promise<void> {
  const db = getSupabaseServer();
  const { error } = await db
    .from('student_profiles')
    .update({
      route_id: null,
      assigned_route_id: null,
      stop_id: null,
      stop_name: null,
      updated_at: new Date().toISOString(),
    })
    .or(`route_id.eq.${routeId},assigned_route_id.eq.${routeId}`);
  if (error) throw new Error(`StudentRepository (PG) pgUnassignRoute failed: ${error.message}`);
}

/**
 * Find students by multiple bus IDs.
 * ponytail: moved from identity.repository.pg.ts to eliminate duplicate student_profiles queries.
 */
export async function pgFindByBusIds(busIds: string[]): Promise<Student[]> {
  if (busIds.length === 0) return [];
  const db = getSupabaseServer();
  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .or(busIds.map(id => `(bus_id.eq.${id},assigned_bus_id.eq.${id})`).join(','));
  if (error) throw new Error(`StudentRepository (PG) findByBusIds failed: ${error.message}`);
  return (data || []).map(pgRowToStudent);
}

/**
 * Find students by multiple route IDs.
 */
export async function pgFindByRouteIds(routeIds: string[]): Promise<Student[]> {
  if (routeIds.length === 0) return [];
  const db = getSupabaseServer();
  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .or(routeIds.map(id => `(route_id.eq.${id},assigned_route_id.eq.${id})`).join(','));
  if (error) throw new Error(`StudentRepository (PG) findByRouteIds failed: ${error.message}`);
  return (data || []).map(pgRowToStudent);
}

/**
 * Find students matching any of the given statuses.
 */
export async function pgFindByStatuses(statuses: string[]): Promise<Student[]> {
  if (statuses.length === 0) return [];
  const db = getSupabaseServer();
  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .in('status', statuses);
  if (error) throw new Error(`StudentRepository (PG) findByStatuses failed: ${error.message}`);
  return (data || []).map(pgRowToStudent);
}

/**
 * Find students who currently occupy a seat (for capacity sync).
 * Returns a lightweight projection — not a full Student object.
 */
export async function pgFindSeatOccupying(): Promise<Array<{
  uid: string; busId: string; shift: string; status: string;
  seatReleasedAt: string | null; stopId: string | null;
}>> {
  const db = getSupabaseServer();
  const { data, error } = await db
    .from('student_profiles')
    .select('uid, assigned_bus_id, bus_id, shift, status, seat_released_at, stop_id')
    .or('status.eq.active,status.eq.soft_blocked,status.eq.pending_deletion')
    .not('assigned_bus_id', 'is', null);
  if (error) throw new Error(`StudentRepository (PG) findSeatOccupying failed: ${error.message}`);
  return (data || []).map(row => ({
    uid: row.uid,
    busId: row.assigned_bus_id || row.bus_id,
    shift: row.shift,
    status: row.status,
    seatReleasedAt: row.seat_released_at,
    stopId: row.stop_id,
  }));
}

/**
 * Get bus occupancy stats via the two PostgreSQL views.
 * Views: bus_occupancy_counts_view, bus_stop_counts_view.
 */
export async function pgGetBusOccupancyStats(): Promise<{
  occupancy: Record<string, { total: number; morning: number; evening: number }>;
  stops: Record<string, Record<string, number>>;
}> {
  const db = getSupabaseServer();
  const [occRes, stopRes] = await Promise.all([
    db.from('bus_occupancy_counts_view').select('*'),
    db.from('bus_stop_counts_view').select('*'),
  ]);
  if (occRes.error) throw new Error(`StudentRepository (PG) occupancyStats occupancy: ${occRes.error.message}`);
  if (stopRes.error) throw new Error(`StudentRepository (PG) occupancyStats stops: ${stopRes.error.message}`);

  const occupancy: Record<string, { total: number; morning: number; evening: number }> = {};
  const stops: Record<string, Record<string, number>> = {};

  for (const row of occRes.data || []) {
    if (row.bus_id) occupancy[row.bus_id] = {
      total: Number(row.total_count || 0),
      morning: Number(row.morning_count || 0),
      evening: Number(row.evening_count || 0),
    };
  }
  for (const row of stopRes.data || []) {
    if (row.bus_id && row.stop_id) {
      if (!stops[row.bus_id]) stops[row.bus_id] = {};
      stops[row.bus_id][row.stop_id] = Number(row.stop_count || 0);
    }
  }
  return { occupancy, stops };
}

