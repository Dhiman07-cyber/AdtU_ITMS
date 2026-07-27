/**
 * D1 Identity — Data Migration (Driver Profiles)
 *
 * Reads all driver documents from Firestore (drivers collection)
 * and inserts them into PostgreSQL (driver_profiles table).
 *
 * IDEMPOTENT: safe to run multiple times — uses upsert with onConflict.
 *
 * Migration mapping:
 *   Firestore drivers/{uid} → PostgreSQL driver_profiles(uid)
 *
 * Core fields → typed columns:
 *   uid, email, fullName, phone, alternatePhone, licenseNumber,
 *   aadharNumber, employeeId, address, profilePhotoUrl, busId,
 *   routeId, joiningDate, shift, status, tripActive, activeTripId,
 *   isReserved, createdAt, updatedAt
 *
 * Infrastructure only. No business logic. No service calls.
 */
import type { MigrationDefinition, MigrationResult, ValidationResult } from '@/infrastructure/migration/contracts';
import { adminDb } from '@/lib/firebase-admin';
import { pgInsertDriver, pgFindDriverById } from '@/domains/identity/repositories/identity.repository.pg';

// ─── Firestore collection constants ──────────────────────────────────────────
const DRIVERS_COLLECTION = 'drivers';

// ─── Core fields (go to typed columns) ───────────────────────────────────────
const CORE_FIELDS = new Set([
  'uid', 'email', 'fullName', 'name', 'phone', 'alternatePhone',
  'licenseNumber', 'aadharNumber', 'employeeId', 'address',
  'profilePhotoUrl', 'busId', 'routeId', 'joiningDate', 'shift',
  'status', 'tripActive', 'activeTripId', 'isReserved', 'createdAt', 'updatedAt',
]);

// ─── Firestore field → PostgreSQL column mapping ─────────────────────────────
const FIELD_MAP: Record<string, string> = {
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

  let firestoreDocs: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(DRIVERS_COLLECTION).get();
    snapshot.forEach(doc => {
      firestoreDocs.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Failed to read Firestore ${DRIVERS_COLLECTION}: ${err.message}`],
    };
  }

  if (firestoreDocs.length === 0) {
    return {
      success: true,
      recordsProcessed: 0,
      errors: [],
    };
  }

  for (const doc of firestoreDocs) {
    try {
      const fsData = doc.data;
      const uid = fsData.uid || doc.id;

      const driver: Record<string, any> = { uid };

      for (const [key, value] of Object.entries(fsData)) {
        if (key === 'id') continue;
        const pgCol = FIELD_MAP[key];
        if (pgCol) {
          if (['created_at', 'updated_at'].includes(pgCol)) {
            driver[pgCol] = toISOString(value);
          } else {
            driver[pgCol] = value;
          }
        } else if (!CORE_FIELDS.has(key)) {
          throw new Error(`Unexpected Firestore driver field: "${key}" with value ${JSON.stringify(value)}`);
        }
      }

      if (!driver.created_at) driver.created_at = new Date().toISOString();
      if (!driver.updated_at) driver.updated_at = new Date().toISOString();

      await pgInsertDriver(driver);
      recordsProcessed++;
    } catch (err: any) {
      errors.push(`Failed to migrate driver ${doc.id}: ${err.message}`);
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

  let firestoreCount = 0;
  let firestoreUids: Set<string> = new Set();
  try {
    const snapshot = await adminDb.collection(DRIVERS_COLLECTION).get();
    firestoreCount = snapshot.size;
    snapshot.forEach(doc => {
      const data = doc.data();
      firestoreUids.add(data.uid || doc.id);
    });
  } catch (err: any) {
    errors.push(`Cannot read Firestore for validation: ${err.message}`);
  }

  let pgCount = 0;
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();
    const { count, error } = await db
      .from('driver_profiles')
      .select('*', { count: 'exact', head: true });

    if (error) {
      errors.push(`Cannot count PostgreSQL driver_profiles: ${error.message}`);
    } else {
      pgCount = count || 0;
    }
  } catch (err: any) {
    errors.push(`PostgreSQL count failed: ${err.message}`);
  }

  if (firestoreCount > 0 && pgCount !== firestoreCount) {
    errors.push(
      `Row count mismatch — Firestore: ${firestoreCount}, PostgreSQL: ${pgCount}`
    );
  }

  if (firestoreUids.size > 0) {
    const sampleUids = Array.from(firestoreUids).slice(0, Math.min(5, firestoreUids.size));
    for (const uid of sampleUids) {
      try {
        const pgDriver = await pgFindDriverById(uid);
        if (!pgDriver) {
          errors.push(`Driver ${uid} exists in Firestore but NOT in PostgreSQL`);
        }
      } catch (err: any) {
        errors.push(`Spot-check failed for uid ${uid}: ${err.message}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step DOWN: remove PostgreSQL driver_profiles (rollback)
// ─────────────────────────────────────────────────────────────────────────────
async function down(): Promise<MigrationResult> {
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();

    const { error } = await db.from('driver_profiles').delete().neq('uid', '');

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
export const driverProfilesMigration: MigrationDefinition = {
  id:          'd1c-identity-driver-profiles-v1.0.0',
  version:     '1.0.0',
  domainId:    'D1',
  description: 'Migrate D1 Identity driver profiles from Firestore (drivers collection) to PostgreSQL (driver_profiles table)',
  up,
  down,
  validate,
};
