-- D5 Payment — processed_payments idempotency markers
-- These replace the Firestore processed_payments collection.
-- Markers are transient (7-day TTL) and prevent duplicate payment processing.
--
-- ⚠️ FIRESTORE FROZEN: The Firestore 'processed_payments' collection is FROZEN.
-- All reads and writes MUST go through this PostgreSQL table.
-- Do NOT add any new adminDb.collection('processed_payments') calls.
--
-- Architecture: RPCs encapsulate the persistence API.
-- Hides SQL implementation, stable public contract, future business rules
-- stay inside PG, easier to audit, easier to version.
--
-- SECURITY: All RPCs use SECURITY DEFINER + SET search_path = public
-- to prevent search_path injection attacks.
--
-- ROLLBACK: This migration is forward-only in practice. The down() function
-- drops all objects but should only be used in development. In production,
-- marker rows expire naturally (7-day TTL) and the schema is permanent.

CREATE TABLE IF NOT EXISTS public.processed_payments (
  payment_id TEXT PRIMARY KEY,
  order_id TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(12,2),
  enrollment_id TEXT,
  user_id TEXT,
  source TEXT DEFAULT 'system'
);

-- Index for cleanup of expired markers
CREATE INDEX IF NOT EXISTS idx_processed_payments_expires_at ON public.processed_payments (expires_at);

-- Index for lookup by user_id
CREATE INDEX IF NOT EXISTS idx_processed_payments_user_id ON public.processed_payments (user_id);

-- RLS: only service role can access (no user-facing queries)
ALTER TABLE public.processed_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.processed_payments
  FOR ALL
  USING (auth.role() = 'service_role');

-- RPC: atomic acquire marker (check + insert in one operation)
-- Returns true if marker was acquired, false if payment_id already exists.
CREATE OR REPLACE FUNCTION public.processed_payments_acquire(
  p_payment_id TEXT,
  p_order_id TEXT DEFAULT NULL,
  p_amount NUMERIC DEFAULT NULL,
  p_enrollment_id TEXT DEFAULT NULL,
  p_user_id TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'system'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.processed_payments (payment_id, order_id, processed_at, expires_at, amount, enrollment_id, user_id, source)
  VALUES (p_payment_id, p_order_id, NOW(), NOW() + INTERVAL '7 days', p_amount, p_enrollment_id, p_user_id, p_source);
  RETURN TRUE;
EXCEPTION WHEN unique_violation THEN
  RETURN FALSE;
END;
$$;

-- RPC: release marker (delete)
CREATE OR REPLACE FUNCTION public.processed_payments_release(p_payment_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.processed_payments WHERE payment_id = p_payment_id;
END;
$$;

-- RPC: cleanup expired markers
CREATE OR REPLACE FUNCTION public.processed_payments_cleanup()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.processed_payments WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
