/**
 * D1 Identity — Data Migration (Unauth Users)
 *
 * Reads all unauth user documents from Firestore (unauthUsers collection)
 * and inserts them into PostgreSQL (unauth_users table).
 *
 * IDEMPOTENT: safe to run multiple times — uses upsert with onConflict.
 *
 * Migration mapping:
 *   Firestore unauthUsers/{uid} → PostgreSQL unauth_users(uid)
 *
 * Core fields → typed columns:
 *   uid, email, displayName, photoURL, status, needsApplication, createdAt, lastLoginAt
 *
 * Infrastructure only. No business logic. No service calls.
 */
import { pgFindUnauthUserById,pgInsertUnauthUser } from '@/domains/identity/repositories/identity.repository.pg';
import type { MigrationDefinition,MigrationResult,ValidationResult } from '@/infrastructure/migration/contracts';
import { adminDb } from '@/lib/firebase-admin';

// ─── Firestore collection constants ──────────────────────────────────────────
const UNAUTH_USERS_COLLECTION = 'unauthUsers';

// ─── Core fields (go to typed columns) ───────────────────────────────────────
const CORE_FIELDS = new Set([
  'uid', 'email', 'displayName', 'photoURL', 'status',
  'needsApplication', 'createdAt', 'lastLoginAt',
]);

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

  // 1. Read all documents from Firestore unauthUsers collection
  let firestoreDocs: Array<{ id: string; data: Record<string, any> }> = [];
  try {
    const snapshot = await adminDb.collection(UNAUTH_USERS_COLLECTION).get();
    snapshot.forEach(doc => {
      firestoreDocs.push({ id: doc.id, data: doc.data() as Record<string, any> });
    });
  } catch (err: any) {
    return {
      success: false,
      recordsProcessed: 0,
      errors: [`Failed to read Firestore ${UNAUTH_USERS_COLLECTION}: ${err.message}`],
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

      // Build unauth user record — core fields
      const user: Record<string, any> = {
        uid,
        email: fsData.email || '',
        displayName: fsData.displayName || fsData.name || '',
        photoURL: fsData.photoURL || fsData.profilePhotoUrl || '',
        status: fsData.status || 'pending_application',
        needsApplication: fsData.needsApplication !== false,
        createdAt: toISOString(fsData.createdAt),
        lastLoginAt: toISOString(fsData.lastLoginAt),
      };

      // Ensure no unexpected fields
      for (const [key, value] of Object.entries(fsData)) {
        if (key === 'id') continue;
        if (!CORE_FIELDS.has(key) && key !== 'uid') {
          throw new Error(`Unexpected Firestore unauth user field: "${key}" with value ${JSON.stringify(value)}`);
        }
      }

      await pgInsertUnauthUser(user);
      recordsProcessed++;
    } catch (err: any) {
      errors.push(`Failed to migrate unauth user ${doc.id}: ${err.message}`);
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
    const snapshot = await adminDb.collection(UNAUTH_USERS_COLLECTION).get();
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
      .from('unauth_users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      errors.push(`Cannot count PostgreSQL unauth_users: ${error.message}`);
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

  // 4. Spot-check: verify a sample of unauth users exist in PostgreSQL
  if (firestoreUids.size > 0) {
    const sampleUids = Array.from(firestoreUids).slice(0, Math.min(5, firestoreUids.size));
    for (const uid of sampleUids) {
      try {
        const pgUser = await pgFindUnauthUserById(uid);
        if (!pgUser) {
          errors.push(`Unauth user ${uid} exists in Firestore but NOT in PostgreSQL`);
        }
      } catch (err: any) {
        errors.push(`Spot-check failed for uid ${uid}: ${err.message}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step DOWN: remove PostgreSQL unauth_users (rollback)
// Firestore data is never deleted — rollback only removes PG data.
// ─────────────────────────────────────────────────────────────────────────────
async function down(): Promise<MigrationResult> {
  try {
    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const db = getSupabaseServer();

    const { error } = await db.from('unauth_users').delete().neq('uid', '');

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
export const unauthUsersMigration: MigrationDefinition = {
  id:          'd1f-identity-unauth-users-v1.0.0',
  version:     '1.0.0',
  domainId:    'D1',
  description: 'Migrate D1 Identity unauth users from Firestore (unauthUsers collection) to PostgreSQL (unauth_users table)',
  up,
  down,
  validate,
};
