-- =============================================================================
-- C3 Atomic Finalization — Extend finalize_application_approval to update
-- student_profiles atomically with application finalization.
--
-- For renewals: receives pre-computed student data, updates student_profiles
-- + writes audit trail (last_processed_application_id) + finalizes application
-- in ONE database transaction. This eliminates the distributed consistency gap
-- where Student.update() could succeed but finalize could fail, leaving
-- the application stuck in 'submitted' while the student was already renewed.
--
-- For fresh: unchanged behavior (DELETE application). Identity activation
-- already happens atomically via identity_activate_student RPC.
-- =============================================================================

DROP FUNCTION IF EXISTS finalize_application_approval(TEXT, TEXT);
DROP FUNCTION IF EXISTS finalize_application_approval(TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION finalize_application_approval(
  p_application_id TEXT,
  p_approver_uid TEXT,
  p_student_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_app RECORD;
  v_updated INTEGER;
  v_deleted INTEGER;
  v_student_uid TEXT;
  v_student_updated INTEGER;
BEGIN
  -- First, try to find the application (enforce lease ownership)
  SELECT application_id, application_type, applicant_uid,
         processing_lock, processing_lease_expires_at
  INTO v_app
  FROM applications
  WHERE application_id = p_application_id
    AND processing_lock = p_approver_uid
    AND processing_lease_expires_at > NOW();

  -- Lease check failed — application not found or lease expired
  IF v_app IS NULL THEN
    -- Check if application exists at all (already finalized vs never existed)
    IF EXISTS(SELECT 1 FROM applications WHERE application_id = p_application_id) THEN
      -- H1: For renewals already in 'approved' state, this is an idempotent retry.
      IF EXISTS(
        SELECT 1 FROM applications
        WHERE application_id = p_application_id
          AND state = 'approved'
          AND application_type IN ('renewal', 'renewal_after_soft_block')
      ) THEN
        RETURN jsonb_build_object(
          'success', true,
          'finalized', false,
          'already_finalized', true,
          'application_id', p_application_id
        );
      END IF;
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
    -- ── RENEWAL: atomic student update + application finalization ────
    -- C3: Both writes in the same transaction. RAISE EXCEPTION on failure
    -- ensures PostgreSQL rolls back BOTH writes (no partial commits).

    v_student_uid := v_app.applicant_uid;

    IF p_student_data IS NOT NULL AND v_student_uid IS NOT NULL THEN
      -- Update student_profiles with pre-computed data + audit trail
      UPDATE student_profiles
      SET valid_until = COALESCE(
            (p_student_data ->> 'valid_until')::TIMESTAMPTZ,
            valid_until
          ),
          status = COALESCE(p_student_data ->> 'status', status),
          session_end_year = COALESCE(
            (p_student_data ->> 'session_end_year')::INTEGER,
            session_end_year
          ),
          session_duration = COALESCE(p_student_data ->> 'session_duration', session_duration),
          soft_block = COALESCE(
            (p_student_data ->> 'soft_block')::TIMESTAMPTZ,
            soft_block
          ),
          hard_block = COALESCE(
            (p_student_data ->> 'hard_block')::TIMESTAMPTZ,
            hard_block
          ),
          last_processed_application_id = p_application_id
      WHERE uid = v_student_uid;

      GET DIAGNOSTICS v_student_updated = ROW_COUNT;

      IF v_student_updated != 1 THEN
        RAISE EXCEPTION 'Expected to update exactly 1 student_profiles row for uid=%, got %',
          v_student_uid, v_student_updated;
      END IF;
    END IF;

    -- Finalize application state
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

    IF v_updated != 1 THEN
      RAISE EXCEPTION 'Expected to update exactly 1 application row for id=%, got %',
        p_application_id, v_updated;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'finalized', true,
      'already_finalized', false,
      'application_id', p_application_id,
      'student_updated', p_student_data IS NOT NULL,
      'action', 'state_updated_to_approved'
    );
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
