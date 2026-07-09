/**
 * D5 Payment Repository
 *
 * Persistence only — no business logic. Re-exports the existing
 * Postgres-backed payment persistence singleton.
 *
 * ponytail: src/lib/services/payments-supabase.ts (PaymentsSupabaseService)
 * is already the canonical persistence layer — already Postgres-native,
 * already owns idempotency (unique constraints on the `payments` table per
 * PHASE2.2 §3). Re-exported as-is, not reimplemented.
 */
export { paymentsSupabaseService as paymentRepository } from '@/lib/services/payments-supabase';
export type { PaymentRecord, CreatePaymentInput } from '@/lib/services/payments-supabase';
