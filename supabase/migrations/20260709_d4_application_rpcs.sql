-- =============================================================================
-- D4 Application — PostgreSQL RPCs
-- Version  : 1.0.0
-- Domain   : D4 Application
--
-- DESIGN RULES
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Each RPC writes only to its own domain's tables (applications).
-- 2. Cross-domain writes happen via separate Identity/Payment/Audit RPCs
--    called by the TypeScript service layer.
-- 3. All RPCs return JSONB — no RECORD, no VOID, no BOOLEAN.
-- 4. All RPCs are idempotent — retrying a completed operation is harmless.
-- 5. Lease-based locks with 5-minute expiry prevent duplicate processing.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: validate_application_for_approval
-- Validates state = 'submitted' and acquires lease-based lock.
-- Returns JSONB application payload or NULL if not acquirable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_application_for_approval(
  p_application_id TEXT,
  p_approver_uid TEXT,
  p_lease_minutes INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_app JSONB;
BEGIN
  UPDATE applications
  SET processing_lock = p_approver_uid,
      processing_started_at = NOW(),
      processing_lease_expires_at = NOW() + (p_lease_minutes || ' minutes')::INTERVAL,
      processing_result = NULL,
      processing_completed_at = NULL
  WHERE application_id = p_application_id
    AND state = 'submitted'
    AND (processing_lock IS NULL OR processing_lease_expires_at < NOW())
  RETURNING to_jsonb(applications.*) INTO v_app;

  RETURN v_app;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: validate_application_for_rejection
-- Validates rejectable state and acquires lease-based lock.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_application_for_rejection(
  p_application_id TEXT,
  p_rejector_uid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_app JSONB;
  v_rejectable_states TEXT[] := ARRAY['submitted','verified_upcoming','pending_seat_allocation'];
BEGIN
  UPDATE applications
  SET processing_lock = p_rejector_uid,
      processing_started_at = NOW(),
      processing_lease_expires_at = NOW() + INTERVAL '5 minutes',
      processing_result = NULL,
      processing_completed_at = NULL
  WHERE application_id = p_application_id
    AND state = ANY(v_rejectable_states)
    AND (processing_lock IS NULL OR processing_lease_expires_at < NOW())
  RETURNING to_jsonb(applications.*) INTO v_app;

  RETURN v_app;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: approve_application
-- Validates state + acquires lock + returns payload.
-- Does NOT delete — deletion happens after cross-domain ops in TypeScript.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION approve_application(
  p_application_id TEXT,
  p_approver_uid TEXT,
  p_lease_minutes INTEGER DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_app JSONB;
BEGIN
  v_app := validate_application_for_approval(p_application_id, p_approver_uid, p_lease_minutes);

  IF v_app IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Application not found or already being processed',
      'status', 409
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'application', v_app
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: reject_application
-- Validates rejectable state + acquires lock + returns payload.
-- Does NOT delete — deletion happens after audit in TypeScript.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reject_application(
  p_application_id TEXT,
  p_rejector_uid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_app JSONB;
BEGIN
  v_app := validate_application_for_rejection(p_application_id, p_rejector_uid);

  IF v_app IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Application not found or not in rejectable state',
      'status', 409
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'application', v_app
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: finalize_application_approval
-- Idempotent delete — enforces lease ownership via DELETE WHERE.
-- Returns already_finalized=true if application was already deleted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finalize_application_approval(
  p_application_id TEXT,
  p_approver_uid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
  v_exists BOOLEAN;
BEGIN
  -- Atomic DELETE that enforces lease ownership
  DELETE FROM applications
  WHERE application_id = p_application_id
    AND processing_lock = p_approver_uid
    AND processing_lease_expires_at > NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Delete succeeded
  IF v_deleted = 1 THEN
    RETURN jsonb_build_object(
      'success', true,
      'finalized', true,
      'already_finalized', false,
      'application_id', p_application_id
    );
  END IF;

  -- Delete affected 0 rows — determine why
  SELECT EXISTS(
    SELECT 1 FROM applications WHERE application_id = p_application_id
  ) INTO v_exists;

  IF NOT v_exists THEN
    -- Row already deleted — idempotent success
    RETURN jsonb_build_object(
      'success', true,
      'finalized', false,
      'already_finalized', true,
      'application_id', p_application_id
    );
  END IF;

  -- Row exists but lease check failed
  RETURN jsonb_build_object(
    'success', false,
    'status', 409,
    'error', 'Invalid or expired processing lease'
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: finalize_application_rejection
-- Idempotent delete — enforces lease ownership via DELETE WHERE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION finalize_application_rejection(
  p_application_id TEXT,
  p_rejector_uid TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
  v_exists BOOLEAN;
BEGIN
  DELETE FROM applications
  WHERE application_id = p_application_id
    AND processing_lock = p_rejector_uid
    AND processing_lease_expires_at > NOW();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 1 THEN
    RETURN jsonb_build_object(
      'success', true,
      'finalized', true,
      'already_finalized', false,
      'application_id', p_application_id
    );
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM applications WHERE application_id = p_application_id
  ) INTO v_exists;

  IF NOT v_exists THEN
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
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: transition_application_state
-- State machine transitions for non-approval workflows
-- (submit, verified_upcoming, pending_seat_allocation, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION transition_application_state(
  p_application_id TEXT,
  p_new_state TEXT,
  p_actor_uid TEXT,
  p_additional_data JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_app RECORD;
  v_valid_transitions JSONB := '{
    "draft": ["awaiting_verification"],
    "awaiting_verification": ["verified"],
    "verified": ["submitted"],
    "submitted": ["verified_upcoming", "rejected"],
    "verified_upcoming": ["pending_seat_allocation", "rejected"],
    "pending_seat_allocation": ["rejected"]
  }'::jsonb;
  v_valid_from TEXT[];
BEGIN
  SELECT * INTO v_app FROM applications WHERE application_id = p_application_id;

  IF v_app IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Application not found', 'status', 404);
  END IF;

  v_valid_from := ARRAY(SELECT jsonb_array_elements_text(v_valid_transitions->v_app.state));
  IF NOT (p_new_state = ANY(v_valid_from)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Invalid transition: %s to %s', v_app.state, p_new_state),
      'status', 400
    );
  END IF;

  UPDATE applications
  SET state = p_new_state,
      updated_at = NOW(),
      state_history = COALESCE(state_history, '[]'::jsonb) ||
        jsonb_build_object('state', p_new_state, 'timestamp', NOW()::text, 'actor', p_actor_uid),
      verified_upcoming_at = CASE WHEN p_new_state = 'verified_upcoming' THEN NOW() ELSE verified_upcoming_at END,
      verified_upcoming_by = CASE WHEN p_new_state = 'verified_upcoming' THEN (p_additional_data->>'verified_upcoming_by') ELSE verified_upcoming_by END,
      verified_upcoming_by_id = CASE WHEN p_new_state = 'verified_upcoming' THEN p_actor_uid ELSE verified_upcoming_by_id END,
      pending_seat_allocation_at = CASE WHEN p_new_state = 'pending_seat_allocation' THEN NOW() ELSE pending_seat_allocation_at END,
      submitted_at = CASE WHEN p_new_state = 'submitted' THEN NOW() ELSE submitted_at END,
      submitted_by = CASE WHEN p_new_state = 'submitted' THEN p_actor_uid ELSE submitted_by END
  WHERE application_id = p_application_id;

  RETURN jsonb_build_object(
    'success', true,
    'application_id', p_application_id,
    'new_state', p_new_state
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: release_application_lock
-- Releases lock on failure, making application retryable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_application_lock(
  p_application_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE applications
  SET processing_lock = NULL,
      processing_started_at = NULL,
      processing_lease_expires_at = NULL,
      processing_result = NULL,
      processing_completed_at = NULL
  WHERE application_id = p_application_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: cleanup_abandoned_application_locks
-- Reclaims expired locks. Run via cron every 5 minutes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_abandoned_application_locks()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_cleaned INTEGER;
BEGIN
  UPDATE applications
  SET processing_lock = NULL,
      processing_started_at = NULL,
      processing_lease_expires_at = NULL,
      processing_result = 'expired',
      processing_completed_at = NOW()
  WHERE processing_lock IS NOT NULL
    AND processing_lease_expires_at < NOW()
    AND processing_completed_at IS NULL;

  GET DIAGNOSTICS v_cleaned = ROW_COUNT;
  RETURN jsonb_build_object('cleaned', v_cleaned);
END;
$$;
