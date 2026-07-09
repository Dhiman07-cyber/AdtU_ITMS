/**
 * D5 Payment — Processed Payments Repository
 *
 * Persistence only for idempotency markers.
 * These replace the Firestore processed_payments collection.
 * Markers are transient (7-day TTL) and prevent duplicate payment processing.
 *
 * ⚠️ FIRESTORE FROZEN: The Firestore 'processed_payments' collection is FROZEN.
 * All reads and writes MUST go through this repository (PostgreSQL).
 * Do NOT add any new adminDb.collection('processed_payments') calls.
 *
 * Architecture: RPCs encapsulate the persistence API.
 * Hides SQL implementation, stable public contract, future business rules
 * stay inside PG, easier to audit, easier to version.
 */
import { getSupabaseServer } from '@/lib/supabase-server';

export async function acquireMarker(paymentId: string, meta?: {
  orderId?: string;
  amount?: number;
  enrollmentId?: string;
  userId?: string;
  source?: string;
}): Promise<boolean> {
  const db = getSupabaseServer();
  const { data, error } = await db.rpc('processed_payments_acquire', {
    p_payment_id: paymentId,
    p_order_id: meta?.orderId || null,
    p_amount: meta?.amount || null,
    p_enrollment_id: meta?.enrollmentId || null,
    p_user_id: meta?.userId || null,
    p_source: meta?.source || 'system',
  });

  if (error) {
    console.error('[ProcessedPayments] acquireMarker error:', error.message);
    return false;
  }

  return data === true;
}

export async function releaseMarker(paymentId: string): Promise<void> {
  const db = getSupabaseServer();
  await db.rpc('processed_payments_release', { p_payment_id: paymentId });
}

export async function cleanupExpired(): Promise<number> {
  const db = getSupabaseServer();
  const { data, error } = await db.rpc('processed_payments_cleanup');
  if (error) {
    console.error('[ProcessedPayments] cleanup error:', error.message);
    return 0;
  }
  return data || 0;
}
