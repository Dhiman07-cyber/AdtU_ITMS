/**
 * D1 Identity — Data Migration (Student Profiles)
 *
 * Reads all student documents from Firestore (students collection)
 * and inserts them into PostgreSQL (student_profiles table).
 *
 * IDEMPOTENT: safe to run multiple times — uses upsert with onConflict.
 *
 * Migration mapping:
 *   Firestore students/{uid} → PostgreSQL student_profiles(uid)
 *
 * Core fields → typed columns:
 *   uid, email, fullName, phone, parentPhone, faculty, department, gender,
 *   dob, enrollmentId, bloodGroup, address, profilePhotoUrl, busId, routeId,
 *   assignedRouteId, stopId, shift, status, sessionDuration, sessionStartYear,
 *   sessionEndYear, validUntil, softBlock, hardBlock, approvedBy, approvedAt,
 *   createdAt, updatedAt, pendingProfileUpdate, expiryReminderCount, lastExpiryReminderSentAt
 *
 * Infrastructure only. No business logic. No service calls.
 */
import type { MigrationDefinition, MigrationResult, ValidationResult } from '@/infrastructure/migration/contracts';
import { adminDb } from '@/lib/firebase-admin';
import { pgInsertStudent, pgFindStudentById } from '@/domains/identity/repositories/identity.repository.pg';

// ─── Firestore collection constants ──────────────────────────────────────────
const STUDENTS_COLLECTION = 'students';

// ─── Core fields (go to typed columns) ───────────────────────────────────────
const CORE_FIELDS = new Set([
  'uid', 'email', 'fullName', 'phone', 'altPhone', 'parentName', 'parentPhone',
  'faculty', 'department', 'gender', 'dob', 'enrollmentId', 'bloodGroup',
  'address', 'profilePhotoUrl', 'busId', 'bus_id', 'routeId', 'assignedRouteId',
  'assignedBusId', 'stopId', 'stopName', 'shift', 'status', 'sessionDuration',
  'sessionStartYear', 'sessionEndYear', 'semester', 'validUntil', 'softBlock',
  'hardBlock', 'approvedBy', 'approvedAt', 'createdAt', 'updatedAt',
  'pendingProfileUpdate', 'expiryReminderCount', 'lastExpiryReminderSentAt',
]);

// ─── Firestore field → PostgreSQL column mapping ─────────────────────────────
const FIELD_MAP: Record<string, string> = {
  fullName: 'full_name',
  altPhone: 'alt_phone',
  parentName: 'parent_name',
  parentPhone: 'parent_phone',
  enrollmentId: 'enrollment_id',
  bloodGroup: 'blood_group',
  profilePhotoUrl: 'profile_photo_url',
  busId: 'bus_id',
  routeId: 'route_id',
  assignedRouteId: 'assigned_route_id',
  assignedBusId: 'assigned_bus_id',
  stopId: 'stop_id',
  stopName: 'stop_name',
  sessionDuration: 'session_duration',
  sessionStartYear: 'session_start_year',
  sessionEndYear: 'session_end_year',
  validUntil: 'valid_until',
  softBlock: 'soft_block',
  hardBlock: 'hard_block',
  approvedBy: 'approved_by',
  approvedAt: 'approved_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  pendingProfileUpdate: 'pending_profile_update',
  expiryReminderCount: 'expiry_reminder_count',
  lastExpiryReminderSentAt: 'last_expiry_reminder_sent_at',
};

// ─── Timestamp handling ──────────────────────────────────────────────────────
function toISOString(value: any): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Step UP: Firestore → PostgreSQL
// ─────────────────────────────────────────────────────────────────────────────
async function up(): Promise<MigrationResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  // 1. Read all documents from Firestore students collection
  let firestoreDocs: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(STUDENTS_COLLECTION).get();
    snapshot.forEach(doc => {
      firestoreDocs.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Failed to read Firestore ${STUDENTS_COLLECTION}: ${err.message}`],
    };
  }

  if (firestoreDocs.length === 0) {
    return {
      success: true,
      recordsProcessed: 0,
      errors: [],
    };
  }

  // 2. Transform and write each document to PostgreSQL
  for (const doc of firestoreDocs) {
    try {
      const fsData = doc.data;
      const uid = fsData.uid || doc.id;

      // Build student record with mapped fields
      const student: Record<string, any> = { uid };

      // Map Firestore fields to PostgreSQL columns
      for (const [key, value] of Object.entries(fsData)) {
        if (key === 'id') continue;
        const pgCol = FIELD_MAP[key];
        if (pgCol) {
          // Handle timestamp fields
          if (['valid_until', 'soft_block', 'hard_block', 'approved_at', 'created_at', 'updated_at', 'last_expiry_reminder_sent_at'].includes(pgCol)) {
            student[pgCol] = value ? toISOString(value) : null;
          } else {
            student[pgCol] = value;
          }
        } else if (!CORE_FIELDS.has(key)) {
          throw new Error(`Unexpected Firestore student field: "${key}" with value ${JSON.stringify(value)}`);
        }
      }

      // Ensure required timestamps
      if (!student.created_at) student.created_at = new Date().toISOString();
      if (!student.updated_at) student.updated_at = new Date().toISOString();

      await pgInsertStudent(student);
      recordsProcessed++;
    } catch (err: any) {
      errors.push(`Failed to migrate student ${doc.id}: ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    recordsProcessed,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate: compare Firestore source vs PostgreSQL target
// ─────────────────────────────────────────────────────────────────────────────
async function validate(): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. Count Firestore documents
  let firestoreCount = 0;
  let firestoreUids: Set<string> = new Set();
  try {
    const snapshot = await adminDb.collection(STUDENTS_COLLECTION).get();
    firestoreCount = snapshot.size;
    snapshot.forEach(doc => {
      const data = doc.data();
      firestoreUids.add(data.uid || doc.id);
    });
  } catch (err: any) {
    errors.push(`Cannot read Firestore for validation: ${err.message}`);
  }

  // 2. Count PostgreSQL rows
  let pgCount = 0;
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();
    const { count, error } = await db
      .from('student_profiles')
      .select('*', { count: 'exact', head: true });

    if (error) {
      errors.push(`Cannot count PostgreSQL student_profiles: ${error.message}`);
    } else {
      pgCount = count || 0;
    }
  } catch (err: any) {
    errors.push(`PostgreSQL count failed: ${err.message}`);
  }

  // 3. Row count comparison
  if (firestoreCount > 0 && pgCount !== firestoreCount) {
    errors.push(
      `Row count mismatch — Firestore: ${firestoreCount}, PostgreSQL: ${pgCount}`
    );
  }

  // 4. Spot-check: verify a sample of students exist in PostgreSQL
  if (firestoreUids.size > 0) {
    const sampleUids = Array.from(firestoreUids).slice(0, Math.min(5, firestoreUids.size));
    for (const uid of sampleUids) {
      try {
        const pgStudent = await pgFindStudentById(uid);
        if (!pgStudent) {
          errors.push(`Student ${uid} exists in Firestore but NOT in PostgreSQL`);
        }
      } catch (err: any) {
        errors.push(`Spot-check failed for uid ${uid}: ${err.message}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step DOWN: remove PostgreSQL student_profiles (rollback)
// Firestore data is never deleted — rollback only removes PG data.
// ─────────────────────────────────────────────────────────────────────────────
async function down(): Promise<MigrationResult> {
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();

    const { error } = await db.from('student_profiles').delete().neq('uid', '');

    if (error) {
      return {
        success: false,
        recordsProcessed: 0,
        errors: [`Rollback failed: ${error.message}`],
      };
    }

    return { success: true, recordsProcessed: 0, errors: [] };
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Rollback failed: ${err.message}`],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MigrationDefinition export
// ─────────────────────────────────────────────────────────────────────────────
export const studentProfilesMigration: MigrationDefinition = {
  id:          'd1-identity-student-profiles-v1.0.0',
  version:     '1.0.0',
  domainId:    'D1',
  description: 'Migrate D1 Identity student profiles from Firestore (students collection) to PostgreSQL (student_profiles table)',
  up,
  down,
  validate,
};
