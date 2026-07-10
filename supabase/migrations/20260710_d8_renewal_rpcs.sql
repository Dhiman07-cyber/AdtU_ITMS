-- =============================================================================
-- D8 Renewal — Extend existing RPCs for renewal support
-- Version  : 1.0.0
-- Domain   : D8 Renewal (migrating renewal_requests from Firestore to PostgreSQL)
--
-- DESIGN RULES
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXTEND existing RPCs — do NOT create new RPCs unless absolutely necessary.
-- 2. Renewal applications are PRESERVED after approval (approved state).
--    Fresh onboarding applications are DELETED after approval (D4 pattern).
-- 3. The `application_type` column determines which finalization path to use.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- DROP & RECREATE: finalize_application_approval
-- Extended to handle renewal vs fresh application types.
--
-- FRESH applications: DELETE (existing D4 behavior)
-- RENEWAL applications: UPDATE state to 'approved', clear processing lock
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS finalize_application_approval(TEXT, TEXT);

CREATE OR REPLACE FUNCTION finalize_application_approval(
  p_application_id TEXT,
  p_approver_uid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_app RECORD;
  v_updated INTEGER;
  v_deleted INTEGER;
BEGIN
  -- First, try to find the application (enforce lease ownership)
  SELECT application_id, application_type, processing_lock, processing_lease_expires_at
  INTO v_app
  FROM applications
  WHERE application_id = p_application_id
    AND processing_lock = p_approver_uid
    AND processing_lease_expires_at > NOW();

  -- Lease check failed — application not found or lease expired
  IF v_app IS NULL THEN
    -- Check if application exists at all (already finalized vs never existed)
    IF EXISTS(SELECT 1 FROM applications WHERE application_id = p_application_id) THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 409,
        'error', 'Invalid or expired processing lease'
      );
    ELSE
      -- Already deleted — idempotent success
      RETURN jsonb_build_object(
        'success', true,
        'finalized', false,
        'already_finalized', true,
        'application_id', p_application_id
      );
    END IF;
  END IF;

  -- Branch based on application type
  IF v_app.application_type IN ('renewal', 'renewal_after_soft_block') THEN
    -- ── RENEWAL: preserve record, update state to 'approved' ──────────
    UPDATE applications
    SET state = 'approved',
        approved_at = NOW(),
        approved_by = p_approver_uid,
        processing_lock = NULL,
        processing_started_at = NULL,
        processing_lease_expires_at = NULL,
        processing_result = 'success',
        processing_completed_at = NOW()
    WHERE application_id = p_application_id
      AND processing_lock = p_approver_uid;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 1 THEN
      RETURN jsonb_build_object(
        'success', true,
        'finalized', true,
        'already_finalized', false,
        'application_id', p_application_id,
        'action', 'state_updated_to_approved'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'status', 409,
        'error', 'Failed to update renewal application state'
      );
    END IF;
  ELSE
    -- ── FRESH: delete record (existing D4 behavior) ───────────────────
    DELETE FROM applications
    WHERE application_id = p_application_id
      AND processing_lock = p_approver_uid;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted = 1 THEN
      RETURN jsonb_build_object(
        'success', true,
        'finalized', true,
        'already_finalized', false,
        'application_id', p_application_id,
        'action', 'deleted'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'status', 409,
        'error', 'Failed to delete application'
      );
    END IF;
  END IF;
END;
$$;