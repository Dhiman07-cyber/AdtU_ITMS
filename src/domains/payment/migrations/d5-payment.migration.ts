import type { MigrationDefinition, MigrationResult, ValidationResult } from '@/infrastructure/migration/contracts';

/**
 * D5 Payment — Migration Validation
 *
 * Validates the processed_payments table and RPCs.
 * Unlike D4 (which migrated Firestore data to PostgreSQL), D5 added a new
 * PostgreSQL table for idempotency markers. There is no Firestore data to migrate.
 *
 * ⚠️ WRITE-BASED VALIDATION: This validator intentionally inserts test rows
 * to verify RPCs work end-to-end. It should only be run in development or
 * admin tooling — never in production. The test rows are cleaned up immediately.
 *
 * Validation checks:
 * - processed_payments table exists and is queryable
 * - processed_payments_acquire RPC works (insert + unique conflict detection)
 * - processed_payments_release RPC works (delete)
 * - processed_payments_cleanup RPC works (expire old markers)
 * - Idempotency: duplicate payment_id returns false
 * - Release: deleted marker can be re-acquired
 */

async function up(): Promise<MigrationResult> {
  // D5 is a schema-only migration — no data to migrate.
  // The SQL migration (20260709_d5_payment.sql) creates the table and RPCs.
  return { success: true, recordsProcessed: 0, errors: [] };
}

async function validate(): Promise<ValidationResult> {
  const errors: string[] = [];

  try {
    const { acquireMarker, releaseMarker, cleanupExpired } = await import(
      '@/domains/payment/repositories/processed-payments.repository'
    );

    // 1. Verify table exists by attempting a select via RPC
    //    If the table or RPC doesn't exist, this will throw.
    try {
      await cleanupExpired();
    } catch (err: any) {
      errors.push(`Table or cleanup RPC not accessible: ${err.message}`);
    }

    // 2. Verify acquireMarker RPC works (insert)
    const testId = `__d5_validation_${crypto.randomUUID()}`;
    let acquired = false;
    try {
      acquired = await acquireMarker(testId, { source: 'validation' });
      if (!acquired) {
        errors.push('acquireMarker returned false for new payment_id — unique constraint may be broken');
      }
    } catch (err: any) {
      errors.push(`acquireMarker RPC failed: ${err.message}`);
    }

    // 3. Verify idempotency — second acquire with same ID should return false
    if (acquired) {
      try {
        const duplicate = await acquireMarker(testId, { source: 'validation' });
        if (duplicate) {
          errors.push('acquireMarker returned true for duplicate payment_id — idempotency broken');
        }
      } catch (err: any) {
        errors.push(`acquireMarker idempotency check failed: ${err.message}`);
      }
    }

    // 4. Verify releaseMarker RPC works (delete)
    if (acquired) {
      try {
        await releaseMarker(testId);
      } catch (err: any) {
        errors.push(`releaseMarker RPC failed: ${err.message}`);
      }
    }

    // 5. Verify released marker can be re-acquired (confirm delete worked)
    if (acquired) {
      try {
        const reacquired = await acquireMarker(testId, { source: 'validation-reacquire' });
        if (!reacquired) {
          errors.push('Re-acquire after release failed — releaseMarker may not have deleted the row');
        }
        // Clean up
        await releaseMarker(testId);
      } catch (err: any) {
        errors.push(`Re-acquire after release failed: ${err.message}`);
      }
    }

  } catch (err: any) {
    errors.push(`Validation error: ${err.message}`);
  }

  return { valid: errors.length === 0, errors };
}

async function down(): Promise<MigrationResult> {
  // D5 is a schema migration — forward-only in practice.
  // The Supabase JS client cannot execute raw DDL (DROP FUNCTION, DROP TABLE).
  // Marker rows expire naturally via the 7-day TTL on expires_at.
  //
  // To fully rollback in development, run this SQL manually:
  //   DROP FUNCTION IF EXISTS public.processed_payments_acquire;
  //   DROP FUNCTION IF EXISTS public.processed_payments_release;
  //   DROP FUNCTION IF EXISTS public.processed_payments_cleanup;
  //   DROP INDEX IF EXISTS public.idx_processed_payments_expires_at;
  //   DROP INDEX IF EXISTS public.idx_processed_payments_user_id;
  //   DROP TABLE IF EXISTS public.processed_payments CASCADE;
  //
  // In production, the schema should be considered permanent.
  return {
    success: false,
    recordsProcessed: 0,
    errors: ['D5 is a forward-only schema migration. Manual SQL rollback required — see migration source for DDL.'],
  };
}

export const paymentMigration: MigrationDefinition = {
  id: 'd5-payment-v1.0.0',
  version: '1.0.0',
  domainId: 'D5',
  description: 'Add processed_payments table for idempotency markers (replaces Firestore processed_payments collection)',
  up,
  down,
  validate,
};
