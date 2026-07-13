/**
 * D1 Identity — PostgreSQL Repository (Users)
 *
 * Canonical persistence layer for the users entity.
 * Reads and writes the `users` table in Supabase PostgreSQL.
 *
 * PERSISTENCE ONLY — no business logic lives here.
 * Business logic (sign-in flow, user creation) remains in services.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * PostgreSQL column    → User field
 * uid                  → uid (PK)
 * email                → email
 * name                 → name (canonical display name)
 * role                 → role
 * created_at           → createdAt (ISO string)
 * last_login_at        → lastLoginAt
 * extras               → spread into result for backward compatibility
 *
 * The extras JSONB captures unmapped Firestore fields (firstAdmin, busFee,
 * profilePhotoUrl, etc.) for migration compatibility. Any field that becomes
 * business-critical must be promoted to a typed column and removed from extras.
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { UserRole } from '@/lib/user-service';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Canonical user record from PostgreSQL */
interface PgUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  extras: Record<string, any>;
}

/** User type compatible with existing codebase ([key: string]: any) */
export interface IdentityUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
  [key: string]: any;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/**
 * Maps a PostgreSQL row to the IdentityUser type.
 * Spreads extras for backward compatibility with code that accesses
 * arbitrary fields (e.g., profilePhotoUrl, fullName, firstAdmin).
 */
function pgRowToUser(row: PgUser): IdentityUser {
  const user: IdentityUser = {
    uid: row.uid,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
    ...row.extras,
  };
  return user;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Find a user by UID. Returns null if not found.
 */
export async function pgFindUserById(uid: string): Promise<IdentityUser | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();

  if (error) {
    throw new Error(`IdentityRepository (PG) read failed: ${error.message}`);
  }

  if (!data) return null;

  return pgRowToUser(data as PgUser);
}

/**
 * Find all users with a specific role.
 */
export async function pgFindUsersByRole(role: UserRole): Promise<IdentityUser[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('role', role);

  if (error) {
    throw new Error(`IdentityRepository (PG) role query failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToUser(row as PgUser));
}

/**
 * Find a user by email. Returns null if not found.
 */
export async function pgFindUserByEmail(email: string): Promise<IdentityUser | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    throw new Error(`IdentityRepository (PG) email lookup failed: ${error.message}`);
  }

  if (!data) return null;

  return pgRowToUser(data as PgUser);
}

/**
 * Insert a new user.
 * Throws if the user already exists (uid conflict).
 */
export async function pgInsertUser(user: IdentityUser): Promise<void> {
  const db = getSupabaseServer();

  const extras: Record<string, any> = {};
  const coreKeys = new Set(['uid', 'email', 'name', 'role', 'createdAt', 'lastLoginAt']);

  for (const [key, value] of Object.entries(user)) {
    if (!coreKeys.has(key)) {
      extras[key] = value;
    }
  }

  const payload = {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    created_at: user.createdAt || new Date().toISOString(),
    last_login_at: user.lastLoginAt || null,
    extras,
  };

  const { error } = await db
    .from('users')
    .insert(payload);

  if (error) {
    throw new Error(`IdentityRepository (PG) insert failed: ${error.message}`);
  }
}

/**
 * Update user data. Merges into existing record.
 * Non-core fields are merged into extras JSONB.
 */
export async function pgUpdateUser(uid: string, data: Partial<IdentityUser>): Promise<void> {
  const db = getSupabaseServer();

  const payload: Record<string, any> = {};

  if (data.email !== undefined) payload.email = data.email;
  if (data.name !== undefined) payload.name = data.name;
  if (data.role !== undefined) payload.role = data.role;
  if (data.lastLoginAt !== undefined) payload.last_login_at = data.lastLoginAt;

  // Merge non-core fields into extras
  const coreKeys = new Set(['uid', 'email', 'name', 'role', 'createdAt', 'lastLoginAt']);
  const extrasMerge: Record<string, any> = {};
  let hasExtras = false;

  for (const [key, value] of Object.entries(data)) {
    if (!coreKeys.has(key)) {
      extrasMerge[key] = value;
      hasExtras = true;
    }
  }

  if (hasExtras) {
    // Use PostgreSQL jsonb || operator to merge extras
    const { error: rpcError } = await db.rpc('merge_user_extras', {
      p_uid: uid,
      p_extras: extrasMerge,
    });

    if (rpcError) {
      // Fallback: read current extras, merge, write back
      const { data: current } = await db
        .from('users')
        .select('extras')
        .eq('uid', uid)
        .maybeSingle();

      if (current) {
        payload.extras = { ...(current.extras || {}), ...extrasMerge };
      }
    }
  }

  // Update core fields (if any)
  const coreFields = Object.keys(payload).filter(k => k !== '_extras_merge' && k !== 'extras');
  if (coreFields.length > 0 || payload.extras) {
    const { error } = await db
      .from('users')
      .update(payload)
      .eq('uid', uid);

    if (error) {
      throw new Error(`IdentityRepository (PG) update failed: ${error.message}`);
    }
  }
}

/**
 * Delete a user by UID.
 */
export async function pgRemoveUser(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('users')
    .delete()
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) delete failed: ${error.message}`);
  }
}

/**
 * Update lastLoginAt timestamp for a user.
 */
export async function pgUpdateLastLogin(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) lastLogin update failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDENT PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/** Firestore field → PostgreSQL column mapping for student_profiles */
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
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

/** Known Firestore fields that map to typed PostgreSQL columns */
const KNOWN_STUDENT_FIELDS = new Set(Object.keys(STUDENT_FIELD_MAP));

/** Convert Firestore student data to PostgreSQL row */
function firestoreStudentToRow(data: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = {};
  const extras: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue; // Firestore document ID — not a column
    const pgCol = STUDENT_FIELD_MAP[key];
    if (pgCol) {
      // Handle Timestamp objects
      if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        row[pgCol] = value.toDate().toISOString();
      } else {
        row[pgCol] = value;
      }
    } else if (!KNOWN_STUDENT_FIELDS.has(key)) {
      extras[key] = value;
    }
  }

  if (Object.keys(extras).length > 0) {
    row.extras = extras;
  }
  return row;
}

/** Convert PostgreSQL row to Firestore-compatible student object */
function rowToFirestoreStudent(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [firestoreField, pgCol] of Object.entries(STUDENT_FIELD_MAP)) {
    if (row[pgCol] !== undefined && row[pgCol] !== null) {
      result[firestoreField] = row[pgCol];
    }
  }
  // Spread extras for backward compatibility
  if (row.extras && typeof row.extras === 'object') {
    Object.assign(result, row.extras);
  }
  return result;
}

/** Find a student profile by UID */
export async function pgFindStudentById(uid: string): Promise<Record<string, any> | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .eq('uid', uid)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`IdentityRepository (PG) student find failed: ${error.message}`);
  }

  return rowToFirestoreStudent(data);
}

/** Find students by bus ID */
export async function pgFindStudentsByBusId(busId: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .or(`bus_id.eq.${busId},assigned_bus_id.eq.${busId}`);

  if (error) {
    throw new Error(`IdentityRepository (PG) students by bus find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreStudent);
}

/** Find students by route ID */
export async function pgFindStudentsByRouteId(routeId: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .or(`route_id.eq.${routeId},assigned_route_id.eq.${routeId}`);

  if (error) {
    throw new Error(`IdentityRepository (PG) students by route find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreStudent);
}

/** Find students by status */
export async function pgFindStudentsByStatus(status: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .eq('status', status);

  if (error) {
    throw new Error(`IdentityRepository (PG) students by status find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreStudent);
}

/** Insert a student profile */
export async function pgInsertStudent(student: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreStudentToRow(student);

  // Ensure required fields
  if (!row.uid) throw new Error('IdentityRepository (PG) student insert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('student_profiles')
    .insert(row);

  if (error) {
    throw new Error(`IdentityRepository (PG) student insert failed: ${error.message}`);
  }
}

/** Update a student profile (partial update) */
export async function pgUpdateStudent(uid: string, data: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreStudentToRow(data);

  // Remove uid from update data (can't change PK)
  delete row.uid;
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('student_profiles')
    .update(row)
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) student update failed: ${error.message}`);
  }
}

/** Delete a student profile */
export async function pgRemoveStudent(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('student_profiles')
    .delete()
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) student delete failed: ${error.message}`);
  }
}

/** Count students by status */
export async function pgCountStudentsByStatus(status: string): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('student_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('status', status);

  if (error) {
    throw new Error(`IdentityRepository (PG) student count failed: ${error.message}`);
  }

  return count || 0;
}

/** Count all students */
export async function pgCountStudents(): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('student_profiles')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`IdentityRepository (PG) student count failed: ${error.message}`);
  }

  return count || 0;
}

/** Find students by shift */
export async function pgFindStudentsByShift(shift: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('student_profiles')
    .select('*')
    .eq('shift', shift);

  if (error) {
    throw new Error(`IdentityRepository (PG) students by shift find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreStudent);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVER PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/** Firestore field → PostgreSQL column mapping for driver_profiles */
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

/** Known Firestore fields that map to typed PostgreSQL columns */
const KNOWN_DRIVER_FIELDS = new Set(Object.keys(DRIVER_FIELD_MAP));

/** Convert Firestore driver data to PostgreSQL row */
function firestoreDriverToRow(data: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = {};
  const extras: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue;
    const pgCol = DRIVER_FIELD_MAP[key];
    if (pgCol) {
      if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        row[pgCol] = value.toDate().toISOString();
      } else {
        row[pgCol] = value;
      }
    } else if (!KNOWN_DRIVER_FIELDS.has(key)) {
      extras[key] = value;
    }
  }

  if (Object.keys(extras).length > 0) {
    row.extras = extras;
  }
  return row;
}

/** Convert PostgreSQL row to Firestore-compatible driver object */
function rowToFirestoreDriver(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [firestoreField, pgCol] of Object.entries(DRIVER_FIELD_MAP)) {
    if (row[pgCol] !== undefined && row[pgCol] !== null) {
      result[firestoreField] = row[pgCol];
    }
  }
  if (row.extras && typeof row.extras === 'object') {
    Object.assign(result, row.extras);
  }
  return result;
}

/** Find a driver profile by UID */
export async function pgFindDriverById(uid: string): Promise<Record<string, any> | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('driver_profiles')
    .select('*')
    .eq('uid', uid)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`IdentityRepository (PG) driver find failed: ${error.message}`);
  }

  return rowToFirestoreDriver(data);
}

/** Find drivers by bus ID */
export async function pgFindDriversByBusId(busId: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('driver_profiles')
    .select('*')
    .or(`assigned_bus_id.eq.${busId},bus_id.eq.${busId}`);

  if (error) {
    throw new Error(`IdentityRepository (PG) drivers by bus find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreDriver);
}

/** Find drivers by route ID */
export async function pgFindDriversByRouteId(routeId: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('driver_profiles')
    .select('*')
    .or(`assigned_route_id.eq.${routeId},route_id.eq.${routeId}`);

  if (error) {
    throw new Error(`IdentityRepository (PG) drivers by route find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreDriver);
}

/** Find drivers by status */
export async function pgFindDriversByStatus(status: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('driver_profiles')
    .select('*')
    .eq('status', status);

  if (error) {
    throw new Error(`IdentityRepository (PG) drivers by status find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreDriver);
}

/** Find non-reserved drivers (available for assignment) */
export async function pgFindAvailableDrivers(): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('driver_profiles')
    .select('*')
    .eq('is_reserved', false)
    .eq('status', 'active');

  if (error) {
    throw new Error(`IdentityRepository (PG) available drivers find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreDriver);
}

/** Insert a driver profile */
export async function pgInsertDriver(driver: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreDriverToRow(driver);

  if (!row.uid) throw new Error('IdentityRepository (PG) driver insert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('driver_profiles')
    .insert(row);

  if (error) {
    throw new Error(`IdentityRepository (PG) driver insert failed: ${error.message}`);
  }
}

/** Update a driver profile (partial update) */
export async function pgUpdateDriver(uid: string, data: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreDriverToRow(data);

  delete row.uid;
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('driver_profiles')
    .update(row)
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) driver update failed: ${error.message}`);
  }
}

/** Delete a driver profile */
export async function pgRemoveDriver(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('driver_profiles')
    .delete()
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) driver delete failed: ${error.message}`);
  }
}

/** Count all drivers */
export async function pgCountDrivers(): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('driver_profiles')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`IdentityRepository (PG) driver count failed: ${error.message}`);
  }

  return count || 0;
}

/** Count drivers by status */
export async function pgCountDriversByStatus(status: string): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('driver_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('status', status);

  if (error) {
    throw new Error(`IdentityRepository (PG) driver count by status failed: ${error.message}`);
  }

  return count || 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODERATOR PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/** Firestore field → PostgreSQL column mapping for moderator_profiles */
const MODERATOR_FIELD_MAP: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  fullName: 'full_name',
  name: 'name',
  phone: 'phone',
  employeeId: 'employee_id',
  staffId: 'staff_id',
  managingTeam: 'managing_team',
  teamName: 'team_name',
  status: 'status',
  profilePhotoUrl: 'profile_photo_url',
  role: 'role',
  createdBy: 'created_by',
  faculty: 'faculty',
  assignedFaculty: 'assigned_faculty',
  permissions: 'permissions',
  permissionsUpdatedAt: 'permissions_updated_at',
  permissionsUpdatedBy: 'permissions_updated_by',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

/** Known Firestore fields that map to typed PostgreSQL columns */
const KNOWN_MODERATOR_FIELDS = new Set(Object.keys(MODERATOR_FIELD_MAP));

/** Convert Firestore moderator data to PostgreSQL row */
function firestoreModeratorToRow(data: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = {};
  const extras: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue;
    const pgCol = MODERATOR_FIELD_MAP[key];
    if (pgCol) {
      if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        row[pgCol] = value.toDate().toISOString();
      } else {
        row[pgCol] = value;
      }
    } else if (!KNOWN_MODERATOR_FIELDS.has(key)) {
      extras[key] = value;
    }
  }

  if (Object.keys(extras).length > 0) {
    row.extras = extras;
  }
  return row;
}

/** Convert PostgreSQL row to Firestore-compatible moderator object */
function rowToFirestoreModerator(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [firestoreField, pgCol] of Object.entries(MODERATOR_FIELD_MAP)) {
    if (row[pgCol] !== undefined && row[pgCol] !== null) {
      result[firestoreField] = row[pgCol];
    }
  }
  if (row.extras && typeof row.extras === 'object') {
    Object.assign(result, row.extras);
  }
  return result;
}

/** Find a moderator profile by UID */
export async function pgFindModeratorById(uid: string): Promise<Record<string, any> | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('moderator_profiles')
    .select('*')
    .eq('uid', uid)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`IdentityRepository (PG) moderator find failed: ${error.message}`);
  }

  return rowToFirestoreModerator(data);
}

/** Find moderators by status */
export async function pgFindModeratorsByStatus(status: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('moderator_profiles')
    .select('*')
    .eq('status', status);

  if (error) {
    throw new Error(`IdentityRepository (PG) moderators by status find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreModerator);
}

/** Find all active moderators */
export async function pgFindActiveModerators(): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('moderator_profiles')
    .select('*')
    .eq('status', 'active');

  if (error) {
    throw new Error(`IdentityRepository (PG) active moderators find failed: ${error.message}`);
  }

  return (data || []).map(rowToFirestoreModerator);
}

/** Insert a moderator profile */
export async function pgInsertModerator(moderator: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreModeratorToRow(moderator);

  if (!row.uid) throw new Error('IdentityRepository (PG) moderator insert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('moderator_profiles')
    .insert(row);

  if (error) {
    throw new Error(`IdentityRepository (PG) moderator insert failed: ${error.message}`);
  }
}

/** Update a moderator profile (partial update) */
export async function pgUpdateModerator(uid: string, data: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreModeratorToRow(data);

  delete row.uid;
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('moderator_profiles')
    .update(row)
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) moderator update failed: ${error.message}`);
  }
}

/** Update moderator permissions */
export async function pgUpdateModeratorPermissions(
  uid: string,
  permissions: Record<string, any>,
  updatedBy: string
): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('moderator_profiles')
    .update({
      permissions,
      permissions_updated_at: new Date().toISOString(),
      permissions_updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) moderator permissions update failed: ${error.message}`);
  }
}

/** Delete a moderator profile */
export async function pgRemoveModerator(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('moderator_profiles')
    .delete()
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) moderator delete failed: ${error.message}`);
  }
}

/** Count all moderators */
export async function pgCountModerators(): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('moderator_profiles')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`IdentityRepository (PG) moderator count failed: ${error.message}`);
  }

  return count || 0;
}

/** Count moderators by status */
export async function pgCountModeratorsByStatus(status: string): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('moderator_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('status', status);

  if (error) {
    throw new Error(`IdentityRepository (PG) moderator count by status failed: ${error.message}`);
  }

  return count || 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/** Firestore field → PostgreSQL column mapping for admin_profiles */
const ADMIN_FIELD_MAP: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  fullName: 'full_name',
  name: 'name',
  phone: 'phone',
  employeeId: 'employee_id',
  role: 'role',
  assignedFaculty: 'assigned_faculty',
  yearsOfService: 'years_of_service',
  altPhone: 'alt_phone',
  dob: 'dob',
  profilePhotoUrl: 'profile_photo_url',
  username: 'username',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

/** Known Firestore fields that map to typed PostgreSQL columns */
const KNOWN_ADMIN_FIELDS = new Set(Object.keys(ADMIN_FIELD_MAP));

/** Convert Firestore admin data to PostgreSQL row */
function firestoreAdminToRow(data: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = {};
  const extras: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue;
    const pgCol = ADMIN_FIELD_MAP[key];
    if (pgCol) {
      if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        row[pgCol] = value.toDate().toISOString();
      } else {
        row[pgCol] = value;
      }
    } else if (!KNOWN_ADMIN_FIELDS.has(key)) {
      extras[key] = value;
    }
  }

  if (Object.keys(extras).length > 0) {
    row.extras = extras;
  }
  return row;
}

/** Convert PostgreSQL row to Firestore-compatible admin object */
function rowToFirestoreAdmin(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [firestoreField, pgCol] of Object.entries(ADMIN_FIELD_MAP)) {
    if (row[pgCol] !== undefined && row[pgCol] !== null) {
      result[firestoreField] = row[pgCol];
    }
  }
  if (row.extras && typeof row.extras === 'object') {
    Object.assign(result, row.extras);
  }
  return result;
}

/** Find an admin profile by UID */
export async function pgFindAdminById(uid: string): Promise<Record<string, any> | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('admin_profiles')
    .select('*')
    .eq('uid', uid)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`IdentityRepository (PG) admin find failed: ${error.message}`);
  }

  return rowToFirestoreAdmin(data);
}

/** Insert an admin profile */
export async function pgInsertAdmin(admin: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreAdminToRow(admin);

  if (!row.uid) throw new Error('IdentityRepository (PG) admin insert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('admin_profiles')
    .insert(row);

  if (error) {
    throw new Error(`IdentityRepository (PG) admin insert failed: ${error.message}`);
  }
}

/** Update an admin profile (partial update) */
export async function pgUpdateAdmin(uid: string, data: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreAdminToRow(data);

  delete row.uid;
  row.updated_at = new Date().toISOString();

  const { error } = await db
    .from('admin_profiles')
    .update(row)
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) admin update failed: ${error.message}`);
  }
}

/** Delete an admin profile */
export async function pgRemoveAdmin(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('admin_profiles')
    .delete()
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) admin delete failed: ${error.message}`);
  }
}

/** Count all admins */
export async function pgCountAdmins(): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('admin_profiles')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`IdentityRepository (PG) admin count failed: ${error.message}`);
  }

  return count || 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNAUTH USERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Firestore field → PostgreSQL column mapping for unauth_users */
const UNAUTH_FIELD_MAP: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  displayName: 'display_name',
  photoURL: 'photo_url',
  status: 'status',
  needsApplication: 'needs_application',
  createdAt: 'created_at',
  lastLoginAt: 'last_login_at',
};

/** Known Firestore fields that map to typed PostgreSQL columns */
const KNOWN_UNAUTH_FIELDS = new Set(Object.keys(UNAUTH_FIELD_MAP));

/** Convert Firestore unauth user data to PostgreSQL row */
function firestoreUnauthToRow(data: Record<string, any>): Record<string, any> {
  const row: Record<string, any> = {};
  const extras: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue;
    const pgCol = UNAUTH_FIELD_MAP[key];
    if (pgCol) {
      if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        row[pgCol] = value.toDate().toISOString();
      } else {
        row[pgCol] = value;
      }
    } else if (!KNOWN_UNAUTH_FIELDS.has(key)) {
      extras[key] = value;
    }
  }

  if (Object.keys(extras).length > 0) {
    row.extras = extras;
  }
  return row;
}

/** Convert PostgreSQL row to Firestore-compatible unauth user object */
function rowToFirestoreUnauth(row: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [firestoreField, pgCol] of Object.entries(UNAUTH_FIELD_MAP)) {
    if (row[pgCol] !== undefined && row[pgCol] !== null) {
      result[firestoreField] = row[pgCol];
    }
  }
  if (row.extras && typeof row.extras === 'object') {
    Object.assign(result, row.extras);
  }
  return result;
}

/** Find an unauth user by UID */
export async function pgFindUnauthUserById(uid: string): Promise<Record<string, any> | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('unauth_users')
    .select('*')
    .eq('uid', uid)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`IdentityRepository (PG) unauth user find failed: ${error.message}`);
  }

  return rowToFirestoreUnauth(data);
}

/** Insert an unauth user */
export async function pgInsertUnauthUser(user: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreUnauthToRow(user);

  if (!row.uid) throw new Error('IdentityRepository (PG) unauth user insert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.last_login_at = row.last_login_at || new Date().toISOString();

  const { error } = await db
    .from('unauth_users')
    .insert(row);

  if (error) {
    throw new Error(`IdentityRepository (PG) unauth user insert failed: ${error.message}`);
  }
}

/** Update an unauth user (partial update) */
export async function pgUpdateUnauthUser(uid: string, data: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreUnauthToRow(data);

  delete row.uid;
  row.last_login_at = new Date().toISOString();

  const { error } = await db
    .from('unauth_users')
    .update(row)
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) unauth user update failed: ${error.message}`);
  }
}

/** Delete an unauth user */
export async function pgRemoveUnauthUser(uid: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('unauth_users')
    .delete()
    .eq('uid', uid);

  if (error) {
    throw new Error(`IdentityRepository (PG) unauth user delete failed: ${error.message}`);
  }
}

/** Count all unauth users */
export async function pgCountUnauthUsers(): Promise<number> {
  const db = getSupabaseServer();

  const { count, error } = await db
    .from('unauth_users')
    .select('*', { count: 'exact', head: true });

  if (error) {
    throw new Error(`IdentityRepository (PG) unauth user count failed: ${error.message}`);
  }

  return count || 0;
}
