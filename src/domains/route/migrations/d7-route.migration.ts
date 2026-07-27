/**
 * D7 Route — Data Migration
 *
 * Reads all route documents from Firestore (routes collection)
 * and inserts them into PostgreSQL using D7 Route domain's repository.
 *
 * IDEMPOTENT: safe to run multiple times.
 *
 * Migration mapping:
 *   Firestore routes/{id}   → PostgreSQL routes(id)
 */
import type { MigrationDefinition, MigrationResult, ValidationResult } from '@/infrastructure/migration/contracts';
import { adminDb } from '@/lib/firebase-admin';
import {
  pgUpsert,
  pgFindById,
  pgCount,
} from '@/domains/route/repositories/route.repository.pg';

const ROUTES_COLLECTION = 'routes';

// Helper to convert timestamp values
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

async function up(): Promise<MigrationResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  let routeDocs: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(ROUTES_COLLECTION).get();
    snapshot.forEach(doc => {
      routeDocs.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Failed to read Firestore ${ROUTES_COLLECTION}: ${err.message}`],
    };
  }

  for (const doc of routeDocs) {
    try {
      const fsData = doc.data;
      const id = fsData.id || fsData.routeId || doc.id;

      // Normalize status and check consistency
      let mappedStatus: 'active' | 'inactive' = 'active';
      if (fsData.status !== undefined) {
        const normStatus = String(fsData.status).toLowerCase();
        mappedStatus = normStatus === 'inactive' ? 'inactive' : 'active';
      } else if (fsData.active !== undefined) {
        mappedStatus = fsData.active ? 'active' : 'inactive';
      }

      const route: any = {
        id,
        routeId: fsData.routeId || id,
        routeName: fsData.routeName || fsData.name || '',
        stops: Array.isArray(fsData.stops) ? fsData.stops : [],
        totalStops: typeof fsData.totalStops === 'number' ? fsData.totalStops : (Array.isArray(fsData.stops) ? fsData.stops.length : 0),
        estimatedTime: fsData.estimatedTime || null,
        status: mappedStatus,
        createdAt: toISOString(fsData.createdAt),
        updatedAt: toISOString(fsData.updatedAt),
      };

      await pgUpsert(route);
      recordsProcessed++;
    } catch (err: any) {
      errors.push(`Failed to migrate route ${doc.id}: ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    recordsProcessed,
    errors,
  };
}

async function validate(): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. Fetch Firestore routes
  let firestoreRouteCount = 0;
  let firestoreRoutes: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(ROUTES_COLLECTION).get();
    firestoreRouteCount = snapshot.size;
    snapshot.forEach(doc => {
      firestoreRoutes.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    errors.push(`Cannot read Firestore routes for validation: ${err.message}`);
  }

  // 2. Fetch PG counts
  let pgRouteCount = 0;
  try {
    pgRouteCount = await pgCount();
  } catch (err: any) {
    errors.push(`PostgreSQL routes count failed: ${err.message}`);
  }

  if (firestoreRouteCount > 0 && pgRouteCount !== firestoreRouteCount) {
    errors.push(`Route count mismatch — Firestore: ${firestoreRouteCount}, PostgreSQL: ${pgRouteCount}`);
  }

  // 3. Spot check and consistency checks
  for (const doc of firestoreRoutes) {
    const fsData = doc.data;
    const id = fsData.id || fsData.routeId || doc.id;

    // Consistency check on active vs status in Firestore
    if (fsData.active !== undefined && fsData.status !== undefined) {
      const activeVal = !!fsData.active;
      const statusVal = String(fsData.status).toLowerCase();
      if ((activeVal && statusVal !== 'active') || (!activeVal && statusVal !== 'inactive')) {
        errors.push(`Consistency mismatch in Firestore route ${id}: active is ${fsData.active} but status is "${fsData.status}"`);
      }
    }

    try {
      const pgRoute = await pgFindById(id);
      if (!pgRoute) {
        errors.push(`Route ${id} exists in Firestore but NOT in PostgreSQL`);
      } else {
        // Verify mapped values
        const expectedStatus = fsData.status !== undefined
          ? (String(fsData.status).toLowerCase() === 'inactive' ? 'inactive' : 'active')
          : (fsData.active === false ? 'inactive' : 'active');

        if (pgRoute.status !== expectedStatus) {
          errors.push(`Route ${id} status mismatch — PG: "${pgRoute.status}", expected: "${expectedStatus}"`);
        }
      }
    } catch (err: any) {
      errors.push(`Spot-check failed for route ${id}: ${err.message}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

async function down(): Promise<MigrationResult> {
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();

    const { error: routeError } = await db.from('routes').delete().neq('id', '');
    if (routeError) {
      return {
        success: false,
        recordsProcessed: 0,
        errors: [`Route rollback failed: ${routeError.message}`],
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

export const routeMigration: MigrationDefinition = {
  id: 'd7-route-v1.0.0',
  version: '1.0.0',
  domainId: 'D7',
  description: 'Migrate D7 Route data from Firestore (routes collection) to PostgreSQL (routes table)',
  up,
  down,
  validate,
};
