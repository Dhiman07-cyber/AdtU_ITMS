-- =============================================================================
-- MIGRATION: 20261009_payment_immutability_and_preflight.sql
-- DESCRIPTION: Safe Preflight Checks, Constraint Hardening, Financial Immutability & Analytics Aggregates
-- STATUS: LOCAL PREPARED ONLY (DO NOT APPLY TO PRODUCTION WITHOUT PREFLIGHT VERIFICATION)
-- =============================================================================

-- =============================================================================
-- SECTION 1: PREFLIGHT AUDIT & DIAGNOSTIC QUERIES (RUN MANUALLY BEFORE DDL)
-- =============================================================================

/*
-- PREFLIGHT CHECK 1: Identify existing Completed payments missing session boundaries
-- If this query returns rows, data cleanup or session backfill is required before
-- adding chk_payments_completed_session.
SELECT payment_id, student_uid, amount, status, session_start_year, session_end_year, created_at
FROM public.payments
WHERE status = 'Completed'
  AND (session_start_year IS NULL OR session_end_year IS NULL);

-- PREFLIGHT CHECK 2: Identify duplicate Completed payments for the same student & session
-- If this query returns rows, administrative reconciliation is required before
-- idx_payments_one_completed_per_session can be built.
SELECT student_uid, session_start_year, session_end_year, COUNT(*) AS completed_count,
       ARRAY_AGG(payment_id) AS conflicting_payment_ids
FROM public.payments
WHERE status = 'Completed'
  AND session_start_year IS NOT NULL
  AND session_end_year IS NOT NULL
GROUP BY student_uid, session_start_year, session_end_year
HAVING COUNT(*) > 1;

-- PREFLIGHT CHECK 3: Identify duplicate Razorpay payment IDs
-- If this query returns rows, identical capture references exist in multiple rows.
SELECT razorpay_payment_id, COUNT(*) AS occurrence_count,
       ARRAY_AGG(payment_id) AS conflicting_payment_ids
FROM public.payments
WHERE razorpay_payment_id IS NOT NULL
GROUP BY razorpay_payment_id
HAVING COUNT(*) > 1;
*/

-- =============================================================================
-- SECTION 2: SAFE & REPEATABLE DDL
-- =============================================================================

-- 1. Ensure required columns exist on payments table
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS session_start_year INTEGER;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS session_end_year INTEGER;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS duration_years INTEGER;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transaction_date TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approved_by JSONB;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 2. Guarded CHECK constraint for Completed session boundaries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payments_completed_session'
  ) THEN
    ALTER TABLE public.payments ADD CONSTRAINT chk_payments_completed_session
      CHECK (status <> 'Completed' OR (session_start_year IS NOT NULL AND session_end_year IS NOT NULL AND session_start_year < session_end_year));
  END IF;
END $$;

-- 3. Partial Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_razorpay_payment_id
ON public.payments(razorpay_payment_id)
WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_completed_per_session
ON public.payments(student_uid, session_start_year, session_end_year)
WHERE status = 'Completed';

-- 4. True Financial Immutability & Lifecycle Guard Trigger
CREATE OR REPLACE FUNCTION public.protect_completed_payments()
RETURNS TRIGGER AS $$
BEGIN
    -- 1. DELETE PROTECTION: Forbid deleting any finalized, duplicate, unresolved, refunded, refund-denied, or rejected payment record
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review', 'Refunded', 'Refund_Denied', 'Rejected') THEN
            RAISE EXCEPTION 'Cannot delete finalized or audit payment record %', OLD.payment_id;
        END IF;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- 2. IMMUTABILITY OF IDENTITY & FINANCIAL FIELDS FOR FINALIZED / AUDIT RECORDS
        -- Uses NULL-safe IS DISTINCT FROM comparison for all fields including nullable provider identifiers
        IF OLD.status IN ('Completed', 'Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied', 'Rejected') AND (
            NEW.amount IS DISTINCT FROM OLD.amount OR
            NEW.currency IS DISTINCT FROM OLD.currency OR
            NEW.method IS DISTINCT FROM OLD.method OR
            NEW.student_uid IS DISTINCT FROM OLD.student_uid OR
            NEW.student_id IS DISTINCT FROM OLD.student_id OR
            NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
            NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR
            NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id OR
            NEW.session_start_year IS DISTINCT FROM OLD.session_start_year OR
            NEW.session_end_year IS DISTINCT FROM OLD.session_end_year
        ) THEN
            RAISE EXCEPTION 'Cannot mutate financial or identity fields of finalized/audit payment record % (current status: %)', OLD.payment_id, OLD.status;
        ELSIF OLD.status = 'Captured_Pending_Review' THEN
            -- Financial, method, and transaction identifiers are strictly immutable on Captured_Pending_Review
            IF (
                NEW.amount IS DISTINCT FROM OLD.amount OR
                NEW.currency IS DISTINCT FROM OLD.currency OR
                NEW.method IS DISTINCT FROM OLD.method OR
                NEW.student_uid IS DISTINCT FROM OLD.student_uid OR
                NEW.payment_id IS DISTINCT FROM OLD.payment_id OR
                NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id OR
                NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id
            ) THEN
                RAISE EXCEPTION 'Cannot mutate financial or provider identity fields of Captured_Pending_Review payment record %', OLD.payment_id;
            END IF;

            -- If remaining in Captured_Pending_Review, session years cannot be mutated without a formal status transition
            IF NEW.status = 'Captured_Pending_Review' AND (
                NEW.session_start_year IS DISTINCT FROM OLD.session_start_year OR
                NEW.session_end_year IS DISTINCT FROM OLD.session_end_year
            ) THEN
                RAISE EXCEPTION 'Cannot alter session fields of Captured_Pending_Review record % without reconciling to Completed', OLD.payment_id;
            END IF;
        END IF;

        -- 3. LIFECYCLE TRANSITION CONSTRAINTS
        -- A. Completed transition constraints:
        -- Completed may ONLY transition to 'Refunded' when a verified full refund is recorded with complete audit evidence.
        -- Any other status change is strictly forbidden.
        IF OLD.status = 'Completed' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status = 'Refunded' THEN
                -- Explicit safe refund transition requirements:
                -- 1. Authorized actor recorded
                IF NEW.approved_by IS NULL THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without authorized actor (approved_by)', OLD.payment_id;
                END IF;
                -- 2. Timestamp recorded
                IF NEW.approved_at IS NULL THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without refund timestamp (approved_at)', OLD.payment_id;
                END IF;
                -- 3. External refund reference in metadata
                IF NEW.metadata IS NULL OR (
                    (NEW.metadata->>'refund_id' IS NULL OR TRIM(NEW.metadata->>'refund_id') = '') AND
                    (NEW.metadata->>'external_refund_ref' IS NULL OR TRIM(NEW.metadata->>'external_refund_ref') = '') AND
                    (NEW.metadata->>'razorpay_refund_id' IS NULL OR TRIM(NEW.metadata->>'razorpay_refund_id') = '')
                ) THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded without external refund reference in metadata', OLD.payment_id;
                END IF;
                -- 4. Cumulative refunded amount must equal or exceed original captured amount
                IF NEW.metadata IS NULL OR NEW.metadata->>'refunded_amount' IS NULL OR
                   (NEW.metadata->>'refunded_amount')::NUMERIC < (OLD.amount - 0.01) THEN
                    RAISE EXCEPTION 'Cannot transition Completed payment % to Refunded: cumulative refunded amount (%) must equal or exceed original captured amount (%)',
                        OLD.payment_id, COALESCE(NEW.metadata->>'refunded_amount', '0'), OLD.amount;
                END IF;
            ELSE
                RAISE EXCEPTION 'Cannot mutate status of Completed payment record %: permitted transition is only to Refunded upon verified full refund (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- B. Duplicate_Pending_Refund may only transition to 'Refunded' or 'Refund_Denied' (manual audit outcomes)
        IF OLD.status = 'Duplicate_Pending_Refund' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status NOT IN ('Refunded', 'Refund_Denied') THEN
                RAISE EXCEPTION 'Invalid status transition for Duplicate_Pending_Refund record %: permitted transitions are only Refunded or Refund_Denied (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- C. Captured_Pending_Review reconciliation transition:
        -- Permitted transitions are only: Completed, Duplicate_Pending_Refund, Refunded, or Refund_Denied
        IF OLD.status = 'Captured_Pending_Review' AND NEW.status IS DISTINCT FROM OLD.status THEN
            IF NEW.status = 'Completed' THEN
                -- Explicit safe reconciliation operation requirements:
                -- 1. Valid session bounds: start < end
                IF NEW.session_start_year IS NULL OR NEW.session_end_year IS NULL OR NEW.session_start_year >= NEW.session_end_year THEN
                    RAISE EXCEPTION 'Cannot resolve Captured_Pending_Review % to Completed without valid session boundaries (start < end)', OLD.payment_id;
                END IF;
                -- 2. Authorized actor recorded
                IF NEW.approved_by IS NULL THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without authorized actor (approved_by)', OLD.payment_id;
                END IF;
                -- 3. Timestamp recorded
                IF NEW.approved_at IS NULL THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without reconciliation timestamp (approved_at)', OLD.payment_id;
                END IF;
                -- 4. Audit evidence documented in metadata
                IF NEW.metadata IS NULL OR NEW.metadata->>'reconciliation_evidence' IS NULL OR TRIM(NEW.metadata->>'reconciliation_evidence') = '' THEN
                    RAISE EXCEPTION 'Cannot reconcile Captured_Pending_Review % to Completed without documented reconciliation_evidence in metadata', OLD.payment_id;
                END IF;
            ELSIF NEW.status NOT IN ('Duplicate_Pending_Refund', 'Refunded', 'Refund_Denied') THEN
                RAISE EXCEPTION 'Invalid status transition for Captured_Pending_Review record %: permitted transitions are Completed (with valid session and audit evidence), Duplicate_Pending_Refund, Refunded, or Refund_Denied (attempted: %)', OLD.payment_id, NEW.status;
            END IF;
        END IF;

        -- D. External refund verification requirement: transition to Refunded requires external refund reference and authorized actor
        IF NEW.status = 'Refunded' AND OLD.status <> 'Refunded' THEN
            IF NEW.approved_by IS NULL THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refunded without authorized actor (approved_by)', OLD.payment_id;
            END IF;
            IF NEW.metadata IS NULL OR (
                (NEW.metadata->>'refund_id' IS NULL OR TRIM(NEW.metadata->>'refund_id') = '') AND
                (NEW.metadata->>'external_refund_ref' IS NULL OR TRIM(NEW.metadata->>'external_refund_ref') = '') AND
                (NEW.metadata->>'razorpay_refund_id' IS NULL OR TRIM(NEW.metadata->>'razorpay_refund_id') = '')
            ) THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refunded without external refund reference in metadata (refund_id, external_refund_ref, or razorpay_refund_id)', OLD.payment_id;
            END IF;
        END IF;

        -- E. Refund denial audit requirement: transition to Refund_Denied requires denial reason and authorized actor
        IF NEW.status = 'Refund_Denied' AND OLD.status <> 'Refund_Denied' THEN
            IF NEW.approved_by IS NULL THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refund_Denied without authorized actor (approved_by)', OLD.payment_id;
            END IF;
            IF NEW.metadata IS NULL OR (NEW.metadata->>'denial_reason' IS NULL OR TRIM(NEW.metadata->>'denial_reason') = '') THEN
                RAISE EXCEPTION 'Cannot mark payment % as Refund_Denied without documented denial_reason in metadata', OLD.payment_id;
            END IF;
        END IF;

        -- F. Refunded, Refund_Denied and Rejected are terminal: once marked, status cannot change
        IF OLD.status IN ('Refunded', 'Refund_Denied', 'Rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Cannot mutate status of terminal payment record % (status: %)', OLD.payment_id, OLD.status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_completed_payments_trigger ON public.payments;
CREATE TRIGGER protect_completed_payments_trigger
    BEFORE UPDATE OR DELETE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_completed_payments();

-- 5. Scalable Payment Aggregation Function
CREATE OR REPLACE FUNCTION public.get_payment_analytics_aggregates()
RETURNS TABLE (
  total_payments BIGINT,
  completed_payments BIGINT,
  pending_payments BIGINT,
  duplicate_refund_count BIGINT,
  unresolved_review_count BIGINT,
  refund_denied_count BIGINT,
  total_revenue NUMERIC,
  online_payments BIGINT,
  offline_payments BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_payments,
    COUNT(*) FILTER (WHERE status = 'Completed' OR LOWER(status) = 'completed')::BIGINT AS completed_payments,
    COUNT(*) FILTER (WHERE status = 'Pending' OR LOWER(status) = 'pending')::BIGINT AS pending_payments,
    COUNT(*) FILTER (WHERE status = 'Duplicate_Pending_Refund' OR LOWER(status) = 'duplicate_pending_refund')::BIGINT AS duplicate_refund_count,
    COUNT(*) FILTER (WHERE status = 'Captured_Pending_Review' OR LOWER(status) = 'captured_pending_review')::BIGINT AS unresolved_review_count,
    COUNT(*) FILTER (WHERE status = 'Refund_Denied' OR LOWER(status) = 'refund_denied')::BIGINT AS refund_denied_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'Completed' OR LOWER(status) = 'completed'), 0)::NUMERIC AS total_revenue,
    COUNT(*) FILTER (WHERE (status = 'Completed' OR LOWER(status) = 'completed') AND (method = 'Online' OR LOWER(method) = 'online'))::BIGINT AS online_payments,
    COUNT(*) FILTER (WHERE (status = 'Completed' OR LOWER(status) = 'completed') AND (method = 'Offline' OR LOWER(method) = 'offline'))::BIGINT AS offline_payments
  FROM public.payments;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_payment_analytics_aggregates() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_payment_analytics_aggregates() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_payment_analytics_aggregates() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_payment_analytics_aggregates() TO service_role;

-- 6. Atomic Cumulative Refund Function
CREATE OR REPLACE FUNCTION public.process_payment_refund_atomic(
    p_payment_id TEXT,
    p_refund_id TEXT,
    p_amount_paise BIGINT,
    p_authorized_by JSONB,
    p_reason TEXT DEFAULT 'Processed refund'
)
RETURNS JSONB AS $$
DECLARE
    v_payment RECORD;
    v_original_paise BIGINT;
    v_existing_history JSONB;
    v_trimmed_ref TEXT;
    v_already_processed BOOLEAN := FALSE;
    v_other_refunded_paise BIGINT := 0;
    v_new_cumulative_paise BIGINT;
    v_is_fully_refunded BOOLEAN;
    v_elem JSONB;
    v_updated_history JSONB := '[]'::JSONB;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_now_iso TEXT := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    v_updated_metadata JSONB;
    v_actor JSONB;
BEGIN
    -- Input sanitation
    v_trimmed_ref := TRIM(COALESCE(p_refund_id, ''));
    IF v_trimmed_ref = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'External refund reference is mandatory');
    END IF;

    IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Refund amount in paise must be greater than zero');
    END IF;

    IF p_authorized_by IS NULL OR p_authorized_by->>'userId' IS NULL OR TRIM(p_authorized_by->>'userId') = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Authorized officer identifier is required');
    END IF;

    -- Concurrency control: Exclusive row-level lock on payments table
    SELECT * INTO v_payment
    FROM public.payments
    WHERE payment_id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', format('Payment record %s not found', p_payment_id));
    END IF;

    -- Status validation: refunds permitted from Completed, Duplicate_Pending_Refund, or Captured_Pending_Review
    IF v_payment.status NOT IN ('Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review') THEN
        -- If already Refunded, check for idempotent replay of this specific refund
        IF v_payment.status = 'Refunded' THEN
            v_existing_history := COALESCE(v_payment.metadata->'refund_history', '[]'::JSONB);
            FOR v_elem IN SELECT * FROM jsonb_array_elements(v_existing_history)
            LOOP
                IF v_elem->>'refund_id' = v_trimmed_ref AND v_elem->>'status' = 'processed' THEN
                    RETURN jsonb_build_object(
                        'success', true,
                        'is_partial', false,
                        'cumulative_refunded', COALESCE((v_payment.metadata->>'refunded_amount')::NUMERIC, v_payment.amount),
                        'already_processed', true
                    );
                END IF;
            END LOOP;
        END IF;

        RETURN jsonb_build_object(
            'success', false,
            'error', format('Payment %s has status ''%s''. Refunds can only be processed from Completed, Duplicate_Pending_Refund, or Captured_Pending_Review.', p_payment_id, v_payment.status)
        );
    END IF;

    v_original_paise := ROUND(COALESCE(v_payment.amount, 0) * 100)::BIGINT;
    IF v_original_paise <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', format('Payment %s has invalid or zero captured amount (%s)', p_payment_id, v_payment.amount));
    END IF;

    -- Format actor
    v_actor := jsonb_build_object(
        'type', COALESCE(p_authorized_by->>'type', CASE WHEN (p_authorized_by->>'userId') LIKE 'system:%' THEN 'system' ELSE 'admin' END),
        'userId', p_authorized_by->>'userId',
        'name', COALESCE(p_authorized_by->>'name', 'System'),
        'role', COALESCE(p_authorized_by->>'role', 'system')
    );
    IF p_authorized_by ? 'empId' THEN
        v_actor := v_actor || jsonb_build_object('empId', p_authorized_by->>'empId');
    END IF;

    -- Extract existing refund history
    v_existing_history := COALESCE(v_payment.metadata->'refund_history', '[]'::JSONB);

    -- Check for idempotent replay and accumulate other processed refunds
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_existing_history)
    LOOP
        IF v_elem->>'refund_id' = v_trimmed_ref AND v_elem->>'status' = 'processed' THEN
            v_already_processed := TRUE;
        ELSE
            -- Add to updated history preserving non-matching items
            v_updated_history := v_updated_history || jsonb_build_array(v_elem);
            IF v_elem->>'status' = 'processed' THEN
                IF v_elem ? 'amount_paise' AND (v_elem->>'amount_paise') IS NOT NULL THEN
                    v_other_refunded_paise := v_other_refunded_paise + (v_elem->>'amount_paise')::BIGINT;
                ELSE
                    v_other_refunded_paise := v_other_refunded_paise + ROUND(COALESCE((v_elem->>'amount')::NUMERIC, 0) * 100)::BIGINT;
                END IF;
            END IF;
        END IF;
    END LOOP;

    IF v_already_processed THEN
        RETURN jsonb_build_object(
            'success', true,
            'is_partial', (COALESCE((v_payment.metadata->>'refunded_amount')::NUMERIC, 0) < v_payment.amount),
            'cumulative_refunded', COALESCE((v_payment.metadata->>'refunded_amount')::NUMERIC, v_payment.amount),
            'already_processed', true
        );
    END IF;

    -- Calculate new cumulative refund in paise
    v_new_cumulative_paise := v_other_refunded_paise + p_amount_paise;

    -- Invariant: cumulative refunded amount cannot exceed original captured amount
    IF v_new_cumulative_paise > v_original_paise THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Cumulative refunded amount (%s) cannot exceed original payment amount (%s).', (v_new_cumulative_paise::NUMERIC / 100), (v_original_paise::NUMERIC / 100))
        );
    END IF;

    v_is_fully_refunded := (v_new_cumulative_paise >= v_original_paise);

    -- Append current refund record
    v_updated_history := v_updated_history || jsonb_build_array(jsonb_build_object(
        'refund_id', v_trimmed_ref,
        'amount', (p_amount_paise::NUMERIC / 100),
        'amount_paise', p_amount_paise,
        'status', 'processed',
        'authorized_by', v_actor,
        'reason', COALESCE(p_reason, 'Approved refund'),
        'processed_at', v_now_iso
    ));

    -- Construct metadata
    v_updated_metadata := COALESCE(v_payment.metadata, '{}'::JSONB) || jsonb_build_object(
        'prior_status', v_payment.status,
        'razorpay_refund_id', v_trimmed_ref,
        'external_refund_ref', v_trimmed_ref,
        'refund_id', v_trimmed_ref,
        'refund_authorized_by', v_actor,
        'refund_processed_at', v_now_iso,
        'refunded_amount', (v_new_cumulative_paise::NUMERIC / 100),
        'refunded_amount_paise', v_new_cumulative_paise,
        'remaining_amount', ((v_original_paise - v_new_cumulative_paise)::NUMERIC / 100),
        'remaining_amount_paise', (v_original_paise - v_new_cumulative_paise),
        'refund_status', CASE WHEN v_is_fully_refunded THEN 'fully_refunded' ELSE 'partial' END,
        'is_partially_refunded', NOT v_is_fully_refunded,
        'refund_history', v_updated_history,
        'refund_reason', COALESCE(p_reason, 'Approved refund')
    );

    IF v_is_fully_refunded THEN
        v_updated_metadata := v_updated_metadata || jsonb_build_object(
            'requires_refund_review', false,
            'requires_manual_review', false
        );

        UPDATE public.payments
        SET status = 'Refunded',
            approved_by = v_actor,
            approved_at = v_now,
            metadata = v_updated_metadata
        WHERE payment_id = p_payment_id;
    ELSE
        -- Partial refund: retain existing status
        UPDATE public.payments
        SET metadata = v_updated_metadata
        WHERE payment_id = p_payment_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'is_partial', NOT v_is_fully_refunded,
        'cumulative_refunded', (v_new_cumulative_paise::NUMERIC / 100),
        'cumulative_refunded_paise', v_new_cumulative_paise
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.process_payment_refund_atomic(TEXT, TEXT, BIGINT, JSONB, TEXT) FROM public;
REVOKE EXECUTE ON FUNCTION public.process_payment_refund_atomic(TEXT, TEXT, BIGINT, JSONB, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_payment_refund_atomic(TEXT, TEXT, BIGINT, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_payment_refund_atomic(TEXT, TEXT, BIGINT, JSONB, TEXT) TO service_role;

