-- ============================================================================
-- Migration: 20260916000002_reconcile_schema_drift.sql
-- Description: Reconcile schema drift across buses, reassignment_logs,
--              processed_payments, notifications, and application activation.
-- ============================================================================

-- ── 1. Fleet Domain: buses table reconciliation ──────────────────────────────
-- Add columns used by fleet.repository.pg.ts, d6-fleet.migration.ts, and trip-orchestrator.ts
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS route_id TEXT;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS route_name TEXT;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMPTZ;
ALTER TABLE public.buses ADD COLUMN IF NOT EXISTS last_ended_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_buses_route_id ON public.buses(route_id);

-- ── 2. Reassignment Logs: add snapshot and rollback columns ──────────────────
-- Used by execute_reassignment_rollback RPC, reassignment-logs routes, and services
ALTER TABLE public.reassignment_logs ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.reassignment_logs ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.reassignment_logs ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.reassignment_logs ADD COLUMN IF NOT EXISTS rollback_of TEXT;

CREATE INDEX IF NOT EXISTS idx_reassignment_logs_rollback_of ON public.reassignment_logs(rollback_of);
CREATE INDEX IF NOT EXISTS idx_reassignment_logs_status ON public.reassignment_logs(status);

-- ── 3. Processed Payments Ledger: formal table definition ────────────────────
-- Required by processed_payments_acquire(), processed_payments_release(), processed_payments_cleanup()
CREATE TABLE IF NOT EXISTS public.processed_payments (
    payment_id TEXT PRIMARY KEY,
    order_id TEXT,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    amount NUMERIC,
    enrollment_id TEXT,
    user_id TEXT,
    source TEXT DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_payments_expires_at ON public.processed_payments(expires_at);
CREATE INDEX IF NOT EXISTS idx_processed_payments_order_id ON public.processed_payments(order_id);

-- ── 4. Notifications: sender index for fast filtering and deduplication ─────
CREATE INDEX IF NOT EXISTS idx_notifications_sender_user_id ON public.notifications(sender_user_id);

-- ── 5. Session Activation: Atomic Lease Claim RPC ────────────────────────────
-- Atomically acquires a processing lease for session activation of verified_upcoming
-- or pending_seat_allocation applications, preventing race conditions between cron and admin.
CREATE OR REPLACE FUNCTION public.claim_application_for_activation(
    p_application_id TEXT,
    p_lock_id TEXT,
    p_lease_minutes INTEGER DEFAULT 5
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_app JSONB;
BEGIN
    UPDATE public.applications
    SET processing_lock = p_lock_id,
        processing_started_at = NOW(),
        processing_lease_expires_at = NOW() + (p_lease_minutes || ' minutes')::INTERVAL
    WHERE application_id = p_application_id
      AND state IN ('verified_upcoming', 'pending_seat_allocation')
      AND (processing_lock IS NULL OR processing_lease_expires_at < NOW())
    RETURNING to_jsonb(public.applications.*) INTO v_app;

    RETURN v_app;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_application_for_activation(TEXT, TEXT, INTEGER) FROM public;
REVOKE EXECUTE ON FUNCTION public.claim_application_for_activation(TEXT, TEXT, INTEGER) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_application_for_activation(TEXT, TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_application_for_activation(TEXT, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.release_application_activation_claim(
    p_application_id TEXT,
    p_lock_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.applications
    SET processing_lock = NULL,
        processing_started_at = NULL,
        processing_lease_expires_at = NULL
    WHERE application_id = p_application_id
      AND processing_lock = p_lock_id;

    RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_application_activation_claim(TEXT, TEXT) FROM public;
REVOKE EXECUTE ON FUNCTION public.release_application_activation_claim(TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.release_application_activation_claim(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.release_application_activation_claim(TEXT, TEXT) TO service_role;
