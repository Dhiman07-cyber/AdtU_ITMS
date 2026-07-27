/**
 * D6 Fleet — Data Migration
 *
 * Reads all bus documents from Firestore (buses collection)
 * and all driver documents from Firestore (drivers collection)
 * and inserts them into PostgreSQL using D6 Fleet domain's own repository.
 *
 * IDEMPOTENT: safe to run multiple times — uses upsert with onConflict.
 *
 * Migration mapping:
 *   Firestore buses/{id}   → PostgreSQL buses(id)
 *   Firestore drivers/{id} → PostgreSQL driver_profiles(uid)
 *
 * Bus core fields → typed columns:
 *   id, busId, busNumber, model, year, capacity, driverUID, driverName,
 *   routeId, routeName, status, currentStudents, currentPassengerCount,
 *   lastStartedAt, lastEndedAt, createdAt, updatedAt
 *
 * Driver core fields → typed columns:
 *   uid, email, fullName, phone, alternatePhone, licenseNumber,
 *   busId, routeId, joiningDate, shift, status, tripActive, activeTripId,
 *   profilePhotoUrl, createdAt, updatedAt
 *
 * Infrastructure only. No business logic. No service calls.
 */
import type { MigrationDefinition, MigrationResult, ValidationResult } from '@/infrastructure/migration/contracts';
import { adminDb } from '@/lib/firebase-admin';
import {
  pgUpsertBus,
  pgFindBusById,
  pgCountBuses,
} from '@/domains/fleet/repositories/fleet.repository.pg';
import {
  pgUpsertDriver,
  pgFindDriverById,
  pgCountDrivers,
} from '@/domains/identity/repositories/identity.repository.pg';

// ─── Collection constants ─────────────────────────────────────────────────────
const BUSES_COLLECTION   = 'buses';
const DRIVERS_COLLECTION = 'drivers';

// ─── Bus core fields ─────────────────────────────────────────────────────────
const BUS_CORE_FIELDS = new Set([
  'id', 'busId', 'busNumber', 'model', 'year', 'capacity', 'driverUID', 'driverName',
  'routeId', 'routeRef', 'routeName', 'status', 'currentStudents', 'currentPassengerCount',
  'lastStartedAt', 'lastEndedAt', 'createdAt', 'updatedAt',
]);

// ─── Driver core fields ───────────────────────────────────────────────────────
const DRIVER_CORE_FIELDS = new Set([
  'uid', 'id', 'email', 'name', 'fullName', 'phone', 'alternatePhone', 'licenseNumber',
  'aadharNumber', 'employeeId', 'address', 'profilePhotoUrl', 'busId',
  'routeId', 'joiningDate', 'shift', 'status',
  'tripActive', 'activeTripId', 'isReserved', 'createdAt', 'updatedAt',
]);

// ─── Timestamp helper ─────────────────────────────────────────────────────────
function toISOString(value: any): string {
  if (!value) return new Date().toISOString();
  if (typeof value === 'string') return value;
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

function toISOOrNull(value: any): string | null {
  if (!value) return null;
  return toISOString(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step UP: Firestore → PostgreSQL
// ─────────────────────────────────────────────────────────────────────────────
async function up(): Promise<MigrationResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  // ── Migrate Buses ────────────────────────────────────────────────────────
  let busDocs: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(BUSES_COLLECTION).get();
    snapshot.forEach(doc => {
      busDocs.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Failed to read Firestore ${BUSES_COLLECTION}: ${err.message}`],
    };
  }

  for (const doc of busDocs) {
    try {
      const fsData = doc.data;
      const id = fsData.id || fsData.busId || doc.id;

      const bus: Record<string, any> = {
        id,
        // bus_id column dropped — was always identical to id
        bus_number: fsData.busNumber || '',
        model: fsData.model || null,
        year: fsData.year || null,
        capacity: typeof fsData.capacity === 'number' ? fsData.capacity : 0,
        driver_uid: fsData.driverUID || null,
        driver_name: fsData.driverName || null,
        route_id: fsData.routeId || null,
        route_name: fsData.routeName || null,
        status: fsData.status || 'inactive',
        // current_passenger_count column dropped — current_members is now GENERATED
        last_started_at: toISOOrNull(fsData.lastStartedAt),
        last_ended_at: toISOOrNull(fsData.lastEndedAt),
        created_at: toISOString(fsData.createdAt),
        updated_at: toISOString(fsData.updatedAt),
      };

      // Ensure no unexpected fields
      for (const [key, value] of Object.entries(fsData)) {
        if (!BUS_CORE_FIELDS.has(key)) {
          throw new Error(`Unexpected Firestore bus field: "${key}" with value ${JSON.stringify(value)}`);
        }
      }

      await pgUpsertBus(bus as any);
      recordsProcessed++;
    } catch (err: any) {
      errors.push(`Failed to migrate bus ${doc.id}: ${err.message}`);
    }
  }

  // ── Migrate Drivers ──────────────────────────────────────────────────────
  let driverDocs: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(DRIVERS_COLLECTION).get();
    snapshot.forEach(doc => {
      driverDocs.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    errors.push(`Failed to read Firestore ${DRIVERS_COLLECTION}: ${err.message}`);
  }

  for (const doc of driverDocs) {
    try {
      const fsData = doc.data;
      const uid = fsData.uid || doc.id;

      const driver: Record<string, any> = {
        uid,
        email: fsData.email || null,
        full_name: fsData.fullName || fsData.name || null,
        phone: fsData.phone || null,
        alternate_phone: fsData.alternatePhone || null,
        license_number: fsData.licenseNumber || null,
        aadhar_number: fsData.aadharNumber || null,
        employee_id: fsData.employeeId || fsData.driverId || null,
        address: fsData.address || null,
        profile_photo_url: fsData.profilePhotoUrl || null,
        bus_id: fsData.busId || null,
        route_id: fsData.routeId || null,
        joining_date: fsData.joiningDate || null,
        shift: fsData.shift || null,
        status: fsData.status || null,
        trip_active: fsData.tripActive ?? false,
        active_trip_id: fsData.activeTripId || null,
        is_reserved: fsData.isReserved ?? false,
        created_at: toISOString(fsData.createdAt),
        updated_at: toISOString(fsData.updatedAt),
      };

      // Ensure no unexpected fields
      for (const [key, value] of Object.entries(fsData)) {
        if (!DRIVER_CORE_FIELDS.has(key)) {
          throw new Error(`Unexpected Firestore driver field: "${key}" with value ${JSON.stringify(value)}`);
        }
      }

      await pgUpsertDriver(driver as any);
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

  // ── Validate Buses ────────────────────────────────────────────────────────
  let firestoreBusCount = 0;
  let firestoreBusIds: string[] = [];
  try {
    const snapshot = await adminDb.collection(BUSES_COLLECTION).get();
    firestoreBusCount = snapshot.size;
    snapshot.forEach(doc => {
      const data = doc.data();
      firestoreBusIds.push(data.id || data.busId || doc.id);
    });
  } catch (err: any) {
    errors.push(`Cannot read Firestore buses for validation: ${err.message}`);
  }

  let pgBusCount = 0;
  try {
    pgBusCount = await pgCountBuses();
  } catch (err: any) {
    errors.push(`PostgreSQL bus count failed: ${err.message}`);
  }

  if (firestoreBusCount > 0 && pgBusCount !== firestoreBusCount) {
    errors.push(`Bus count mismatch — Firestore: ${firestoreBusCount}, PostgreSQL: ${pgBusCount}`);
  }

  const sampleBusIds = firestoreBusIds.slice(0, Math.min(5, firestoreBusIds.length));
  for (const id of sampleBusIds) {
    try {
      const pgBus = await pgFindBusById(id);
      if (!pgBus) {
        errors.push(`Bus ${id} exists in Firestore but NOT in PostgreSQL`);
      }
    } catch (err: any) {
      errors.push(`Spot-check failed for bus ${id}: ${err.message}`);
    }
  }

  // ── Validate Drivers ──────────────────────────────────────────────────────
  let firestoreDriverCount = 0;
  let firestoreDriverIds: string[] = [];
  try {
    const snapshot = await adminDb.collection(DRIVERS_COLLECTION).get();
    firestoreDriverCount = snapshot.size;
    snapshot.forEach(doc => {
      const data = doc.data();
      firestoreDriverIds.push(data.uid || doc.id);
    });
  } catch (err: any) {
    errors.push(`Cannot read Firestore drivers for validation: ${err.message}`);
  }

  let pgDriverCount = 0;
  try {
    pgDriverCount = await pgCountDrivers();
  } catch (err: any) {
    errors.push(`PostgreSQL driver count failed: ${err.message}`);
  }

  if (firestoreDriverCount > 0 && pgDriverCount !== firestoreDriverCount) {
    errors.push(`Driver count mismatch — Firestore: ${firestoreDriverCount}, PostgreSQL: ${pgDriverCount}`);
  }

  const sampleDriverIds = firestoreDriverIds.slice(0, Math.min(5, firestoreDriverIds.length));
  for (const uid of sampleDriverIds) {
    try {
      const pgDriver = await pgFindDriverById(uid);
      if (!pgDriver) {
        errors.push(`Driver ${uid} exists in Firestore but NOT in PostgreSQL`);
      }
    } catch (err: any) {
      errors.push(`Spot-check failed for driver ${uid}: ${err.message}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step DOWN: remove PostgreSQL fleet data (rollback)
// Firestore data is never deleted — rollback only removes PG data.
// ─────────────────────────────────────────────────────────────────────────────
async function down(): Promise<MigrationResult> {
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();

    const { error: busError } = await db.from('buses').delete().neq('id', '');
    if (busError) {
      return {
        success: false,
        recordsProcessed: 0,
        errors: [`Bus rollback failed: ${busError.message}`],
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
export const fleetMigration: MigrationDefinition = {
  id:          'd6-fleet-v1.0.0',
  version:     '1.0.0',
  domainId:    'D6',
  description: 'Migrate D6 Fleet data from Firestore (buses + drivers collections) to PostgreSQL (buses + driver_profiles tables)',
  up,
  down,
  validate,
};
