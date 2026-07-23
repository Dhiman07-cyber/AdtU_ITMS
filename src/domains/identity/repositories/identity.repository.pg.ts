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
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type { UserRole } from '@/lib/user-service';
import * as studentRepo from '../../student/repositories/student.repository.pg';

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
 */
function pgRowToUser(row: PgUser): IdentityUser {
  const user: IdentityUser = {
    uid: row.uid,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
  };
  return user;
}

// ─── Generic Profile Helpers ──────────────────────────────────────────────────
// ponytail: driver/moderator/admin/unauth profiles share identical CRUD patterns.
// Extracted to eliminate ~200 lines of copy-paste.

/** Convert Firestore camelCase data to PostgreSQL snake_case row using a field map */
function firestoreToRow(data: Record<string, any>, fieldMap: Record<string, string>): Record<string, any> {
  const row: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'id') continue;
    const pgCol = fieldMap[key];
    if (pgCol) {
      if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        row[pgCol] = value.toDate().toISOString();
      } else {
        row[pgCol] = value;
      }
    }
  }
  return row;
}

/** Convert PostgreSQL snake_case row back to Firestore camelCase using a field map */
function rowToFirestore(row: Record<string, any>, fieldMap: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [firestoreField, pgCol] of Object.entries(fieldMap)) {
    if (row[pgCol] !== undefined && row[pgCol] !== null) {
      result[firestoreField] = row[pgCol];
    }
  }
  return result;
}

/** Find a profile by UID from any *_profiles table */
async function pgFindByUid(table: string, uid: string): Promise<Record<string, any> | null> {
  const db = getSupabaseServer();
  const cleanId = decodeURIComponent(uid || '').trim();
  const { data, error } = await db.from(table).select('*').eq('uid', cleanId).maybeSingle();
  if (error) {
    throw new Error(`IdentityRepository (PG) ${table} find failed: ${error.message}`);
  }
  return data;
}

/** Find profiles by status from any *_profiles table */
async function pgFindByStatus(table: string, status: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from(table).select('*').eq('status', status);
  if (error) throw new Error(`IdentityRepository (PG) ${table} by status failed: ${error.message}`);
  return data || [];
}

/** Insert a profile into any *_profiles table */
async function pgInsertProfile(table: string, data: Record<string, any>, fieldMap: Record<string, string>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreToRow(data, fieldMap);
  if (!row.uid) throw new Error(`IdentityRepository (PG) ${table} insert requires uid`);
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();
  const { error } = await db.from(table).insert(row);
  if (error) throw new Error(`IdentityRepository (PG) ${table} insert failed: ${error.message}`);
}

/** Update a profile in any *_profiles table */
async function pgUpdateProfile(table: string, uid: string, data: Record<string, any>, fieldMap: Record<string, string>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreToRow(data, fieldMap);
  delete row.uid;
  row.updated_at = new Date().toISOString();
  const { error } = await db.from(table).update(row).eq('uid', uid);
  if (error) throw new Error(`IdentityRepository (PG) ${table} update failed: ${error.message}`);
}

/** Delete a profile from any *_profiles table */
async function pgRemoveProfile(table: string, uid: string): Promise<void> {
  const db = getSupabaseServer();
  const { error } = await db.from(table).delete().eq('uid', uid);
  if (error) throw new Error(`IdentityRepository (PG) ${table} delete failed: ${error.message}`);
}

/** Count rows in any table */
async function pgCountTable(table: string, statusFilter?: string): Promise<number> {
  const db = getSupabaseServer();
  let query = db.from(table).select('*', { count: 'exact', head: true });
  if (statusFilter) query = query.eq('status', statusFilter);
  const { count, error } = await query;
  if (error) throw new Error(`IdentityRepository (PG) ${table} count failed: ${error.message}`);
  return count || 0;
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
 * Find all users (no filter).
 */
export async function pgFindAllUsers(): Promise<IdentityUser[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('users')
    .select('*');

  if (error) {
    throw new Error(`IdentityRepository (PG) all users query failed: ${error.message}`);
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

  const payload = {
    uid: user.uid,
    email: user.email,
    name: user.name,
    role: user.role,
    created_at: user.createdAt || new Date().toISOString(),
    last_login_at: user.lastLoginAt || null,
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
 */
export async function pgUpdateUser(uid: string, data: Partial<IdentityUser>): Promise<void> {
  const db = getSupabaseServer();

  const payload: Record<string, any> = {};

  if (data.email !== undefined) payload.email = data.email;
  if (data.name !== undefined) payload.name = data.name;
  if (data.role !== undefined) payload.role = data.role;
  if (data.lastLoginAt !== undefined) payload.last_login_at = data.lastLoginAt;

  if (Object.keys(payload).length > 0) {
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
// STUDENT PROFILES (Delegated to student.repository.pg)
// ═══════════════════════════════════════════════════════════════════════════════

/** Find a student profile by UID */
export async function pgFindStudentById(uid: string): Promise<Record<string, any> | null> {
  return studentRepo.pgFindByUid(uid);
}

/** Find students by bus ID */
export async function pgFindStudentsByBusId(busId: string): Promise<Record<string, any>[]> {
  return studentRepo.pgFindByBusId(busId);
}

/** Find students by multiple bus IDs */
export async function pgFindStudentsByBusIds(busIds: string[]): Promise<Record<string, any>[]> {
  return studentRepo.pgFindByBusIds(busIds);
}

export async function pgFindStudentsByRouteId(routeId: string): Promise<Record<string, any>[]> {
  return studentRepo.pgFindByRouteId(routeId);
}

/** Find students by multiple route IDs */
export async function pgFindStudentsByRouteIds(routeIds: string[]): Promise<Record<string, any>[]> {
  return studentRepo.pgFindByRouteIds(routeIds);
}

/** Find students by status */
export async function pgFindStudentsByStatus(status: string): Promise<Record<string, any>[]> {
  return studentRepo.pgFindByStatus(status);
}

/** Find students by multiple statuses */
export async function pgFindStudentsByStatuses(statuses: string[]): Promise<Record<string, any>[]> {
  return studentRepo.pgFindByStatuses(statuses);
}

/** Find all students occupying a seat (for capacity synchronization) */
export async function pgFindSeatOccupyingStudents(): Promise<Record<string, any>[]> {
  return studentRepo.pgFindSeatOccupying();
}

/** Get bus occupancy statistics aggregated natively in PostgreSQL */
export async function pgGetBusOccupancyStats(): Promise<{
  occupancy: Record<string, { total: number; morning: number; evening: number }>;
  stops: Record<string, Record<string, number>>;
}> {
  return studentRepo.pgGetBusOccupancyStats();
}

/** Insert a student profile */
export async function pgInsertStudent(student: Record<string, any>): Promise<void> {
  return studentRepo.pgInsert(student);
}

/** Update a student profile (partial update) */
export async function pgUpdateStudent(uid: string, data: Record<string, any>): Promise<void> {
  return studentRepo.pgUpdate(uid, data);
}

/** Delete a student profile */
export async function pgRemoveStudent(uid: string): Promise<void> {
  return studentRepo.pgRemove(uid);
}

/** Find students by shift */
export async function pgFindStudentsByShift(shift: string): Promise<Record<string, any>[]> {
  return studentRepo.pgFindByShift(shift);
}

/** Find all students (no filter) */
export async function pgFindAllStudents(): Promise<Record<string, any>[]> {
  return studentRepo.pgFindAll();
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
  busId: 'bus_id',
  routeId: 'route_id',
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
const firestoreDriverToRow = (data: Record<string, any>) => firestoreToRow(data, DRIVER_FIELD_MAP);

/** Convert PostgreSQL row to Firestore-compatible driver object */
const rowToFirestoreDriver = (row: Record<string, any>) => rowToFirestore(row, DRIVER_FIELD_MAP);

/** Find a driver profile by UID */
export async function pgFindDriverById(uid: string): Promise<Record<string, any> | null> {
  const data = await pgFindByUid('driver_profiles', uid);
  return data ? rowToFirestoreDriver(data) : null;
}

/** Find drivers by bus ID */
export async function pgFindDriversByBusId(busId: string): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();
  const { data, error } = await db
    .from('driver_profiles')
    .select('*')
    .eq('bus_id', busId);
  if (error) throw new Error(`IdentityRepository (PG) drivers by bus find failed: ${error.message}`);
  return (data || []).map(rowToFirestoreDriver);
}

/** Find drivers by status */
export async function pgFindDriversByStatus(status: string): Promise<Record<string, any>[]> {
  const rows = await pgFindByStatus('driver_profiles', status);
  return rows.map(rowToFirestoreDriver);
}

/** Find all drivers (no filter) */
export async function pgFindAllDrivers(): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('driver_profiles').select('*');
  if (error) throw new Error(`IdentityRepository (PG) all drivers query failed: ${error.message}`);
  return (data || []).map(rowToFirestoreDriver);
}

/** Find drivers with database-level pagination */
export async function pgFindAllDriversPaginated(limit: number, offset: number): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('driver_profiles').select('*').range(offset, offset + limit - 1);
  if (error) throw new Error(`IdentityRepository (PG) paginated drivers query failed: ${error.message}`);
  return (data || []).map(rowToFirestoreDriver);
}

/** Insert a driver profile */
export async function pgInsertDriver(driver: Record<string, any>): Promise<void> {
  return pgInsertProfile('driver_profiles', driver, DRIVER_FIELD_MAP);
}

/** Upsert a driver profile */
export async function pgUpsertDriver(driver: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreDriverToRow(driver);
  if (!row.uid) throw new Error('IdentityRepository (PG) driver upsert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.updated_at = new Date().toISOString();
  const { error } = await db.from('driver_profiles').upsert(row, { onConflict: 'uid' });
  if (error) throw new Error(`IdentityRepository (PG) driver upsert failed: ${error.message}`);
}

/** Update a driver profile (partial update) */
export async function pgUpdateDriver(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateProfile('driver_profiles', uid, data, DRIVER_FIELD_MAP);
}

/** Delete a driver profile */
export async function pgRemoveDriver(uid: string): Promise<void> {
  return pgRemoveProfile('driver_profiles', uid);
}

/** Count all drivers */
export async function pgCountDrivers(): Promise<number> {
  return pgCountTable('driver_profiles');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODERATOR PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/** Firestore field → PostgreSQL column mapping for moderator_profiles */
const MODERATOR_FIELD_MAP: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  fullName: 'full_name',
  phone: 'phone',
  employeeId: 'employee_id',
  teamName: 'team_name',
  status: 'status',
  profilePhotoUrl: 'profile_photo_url',
  role: 'role',
  createdBy: 'created_by',
  faculty: 'faculty',
  permissions: 'permissions',
  permissionsUpdatedAt: 'permissions_updated_at',
  permissionsUpdatedBy: 'permissions_updated_by',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const KNOWN_MODERATOR_FIELDS = new Set(Object.keys(MODERATOR_FIELD_MAP));

const firestoreModeratorToRow = (data: Record<string, any>) => firestoreToRow(data, MODERATOR_FIELD_MAP);
const rowToFirestoreModerator = (row: Record<string, any>) => rowToFirestore(row, MODERATOR_FIELD_MAP);

/** Find a moderator profile by UID */
export async function pgFindModeratorById(uid: string): Promise<Record<string, any> | null> {
  const data = await pgFindByUid('moderator_profiles', uid);
  return data ? rowToFirestoreModerator(data) : null;
}

/** Find moderators by status */
export async function pgFindModeratorsByStatus(status: string): Promise<Record<string, any>[]> {
  const rows = await pgFindByStatus('moderator_profiles', status);
  return rows.map(rowToFirestoreModerator);
}

/** Find all active moderators */
export async function pgFindActiveModerators(): Promise<Record<string, any>[]> {
  return pgFindModeratorsByStatus('active');
}

/** Insert a moderator profile */
export async function pgInsertModerator(moderator: Record<string, any>): Promise<void> {
  return pgInsertProfile('moderator_profiles', moderator, MODERATOR_FIELD_MAP);
}

/** Update a moderator profile (partial update) */
export async function pgUpdateModerator(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateProfile('moderator_profiles', uid, data, MODERATOR_FIELD_MAP);
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
  if (error) throw new Error(`IdentityRepository (PG) moderator permissions update failed: ${error.message}`);
}

/** Delete a moderator profile */
export async function pgRemoveModerator(uid: string): Promise<void> {
  return pgRemoveProfile('moderator_profiles', uid);
}

/** Count all moderators */
export async function pgCountModerators(): Promise<number> {
  return pgCountTable('moderator_profiles');
}

/** Count moderators by status */
export async function pgCountModeratorsByStatus(status: string): Promise<number> {
  return pgCountTable('moderator_profiles', status);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/** Firestore field → PostgreSQL column mapping for admin_profiles */
const ADMIN_FIELD_MAP: Record<string, string> = {
  uid: 'uid',
  email: 'email',
  fullName: 'full_name',
  phone: 'phone',
  employeeId: 'employee_id',
  role: 'role',
  yearsOfService: 'years_of_service',
  altPhone: 'alt_phone',
  dob: 'dob',
  profilePhotoUrl: 'profile_photo_url',
  username: 'username',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const KNOWN_ADMIN_FIELDS = new Set(Object.keys(ADMIN_FIELD_MAP));

const firestoreAdminToRow = (data: Record<string, any>) => firestoreToRow(data, ADMIN_FIELD_MAP);
const rowToFirestoreAdmin = (row: Record<string, any>) => rowToFirestore(row, ADMIN_FIELD_MAP);

/** Find an admin profile by UID */
export async function pgFindAdminById(uid: string): Promise<Record<string, any> | null> {
  const data = await pgFindByUid('admin_profiles', uid);
  return data ? rowToFirestoreAdmin(data) : null;
}

/** Insert an admin profile */
export async function pgInsertAdmin(admin: Record<string, any>): Promise<void> {
  return pgInsertProfile('admin_profiles', admin, ADMIN_FIELD_MAP);
}

/** Update an admin profile (partial update) */
export async function pgUpdateAdmin(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateProfile('admin_profiles', uid, data, ADMIN_FIELD_MAP);
}

/** Delete an admin profile */
export async function pgRemoveAdmin(uid: string): Promise<void> {
  return pgRemoveProfile('admin_profiles', uid);
}

/** Count all admins */
export async function pgCountAdmins(): Promise<number> {
  return pgCountTable('admin_profiles');
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

const KNOWN_UNAUTH_FIELDS = new Set(Object.keys(UNAUTH_FIELD_MAP));

const firestoreUnauthToRow = (data: Record<string, any>) => firestoreToRow(data, UNAUTH_FIELD_MAP);
const rowToFirestoreUnauth = (row: Record<string, any>) => rowToFirestore(row, UNAUTH_FIELD_MAP);

/** Find an unauth user by UID */
export async function pgFindUnauthUserById(uid: string): Promise<Record<string, any> | null> {
  const data = await pgFindByUid('unauth_users', uid);
  return data ? rowToFirestoreUnauth(data) : null;
}

/** Insert or upsert an unauth user */
export async function pgInsertUnauthUser(user: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreUnauthToRow(user);

  if (!row.uid) throw new Error('IdentityRepository (PG) unauth user insert requires uid');
  if (!row.created_at) row.created_at = new Date().toISOString();
  row.last_login_at = row.last_login_at || new Date().toISOString();

  const { error } = await db.from('unauth_users').upsert(row, { onConflict: 'uid' });
  if (error) throw new Error(`IdentityRepository (PG) unauth user upsert failed: ${error.message}`);
}

/** Update an unauth user (partial update) */
export async function pgUpdateUnauthUser(uid: string, data: Record<string, any>): Promise<void> {
  const db = getSupabaseServer();
  const row = firestoreUnauthToRow(data);

  delete row.uid;
  row.last_login_at = new Date().toISOString();

  const { error } = await db.from('unauth_users').update(row).eq('uid', uid);
  if (error) throw new Error(`IdentityRepository (PG) unauth user update failed: ${error.message}`);
}

/** Delete an unauth user */
export async function pgRemoveUnauthUser(uid: string): Promise<void> {
  return pgRemoveProfile('unauth_users', uid);
}

/** Count all unauth users */
export async function pgCountUnauthUsers(): Promise<number> {
  return pgCountTable('unauth_users');
}

/** Find all unauth users */
export async function pgFindAllUnauthUsers(): Promise<Record<string, any>[]> {
  const db = getSupabaseServer();
  const { data, error } = await db.from('unauth_users').select('*');
  if (error) throw new Error(`IdentityRepository (PG) all unauth users query failed: ${error.message}`);
  return (data || []).map(rowToFirestoreUnauth);
}
