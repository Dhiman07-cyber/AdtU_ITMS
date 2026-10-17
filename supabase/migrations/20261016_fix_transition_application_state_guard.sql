-- Migration: 20261016_fix_transition_application_state_guard.sql
-- Fixes RPC-001: transition_application_state comparing target state instead of source state.

CREATE OR REPLACE FUNCTION transition_application_state(
    p_application_id TEXT,
    p_new_state      TEXT,
    p_actor_uid      TEXT,
    p_reason         TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_app RECORD;
    v_valid_from TEXT[];
BEGIN
    SELECT state, applicant_uid, form_data INTO v_app FROM applications WHERE application_id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Application not found', 'status', 404);
    END IF;

    -- Define valid transition matrix
    v_valid_from := CASE p_new_state
        WHEN 'awaiting_verification' THEN ARRAY['draft']
        WHEN 'verified'             THEN ARRAY['awaiting_verification']
        WHEN 'submitted'            THEN ARRAY['verified']
        WHEN 'approved'             THEN ARRAY['submitted', 'pending_seat_allocation']
        WHEN 'rejected'             THEN ARRAY['awaiting_verification', 'verified', 'submitted', 'pending_seat_allocation']
        WHEN 'verified_upcoming'    THEN ARRAY['verified']
        WHEN 'pending_seat_allocation' THEN ARRAY['submitted', 'verified_upcoming']
        WHEN 'expired'              THEN ARRAY['verified_upcoming', 'pending_seat_allocation', 'submitted']
        ELSE ARRAY[]::TEXT[]
    END;

    -- Authoritative transition guard: verify that current state (v_app.state) is in valid source states
    IF NOT (v_app.state = ANY(v_valid_from)) THEN
        RETURN jsonb_build_object('success', false, 'error', format('Invalid transition: %s to %s', v_app.state, p_new_state), 'status', 400);
    END IF;

    -- IDOR prevention: submitting a verified application requires the actor to be the applicant
    IF p_new_state = 'submitted' AND v_app.applicant_uid IS NOT NULL AND v_app.applicant_uid <> p_actor_uid THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: applicant UID does not match actor', 'status', 403);
    END IF;

    UPDATE applications SET
        state = p_new_state, updated_at = NOW(),
        state_history = COALESCE(state_history, '[]'::jsonb) || jsonb_build_object('state', p_new_state, 'timestamp', NOW()::text, 'actor', p_actor_uid),
        submitted_at = CASE WHEN p_new_state = 'submitted' THEN NOW() ELSE submitted_at END,
        submitted_by = CASE WHEN p_new_state = 'submitted' THEN p_actor_uid ELSE submitted_by END,
        verified_at  = CASE WHEN p_new_state = 'verified' THEN NOW() ELSE verified_at END,
        verified_by  = CASE WHEN p_new_state = 'verified' THEN p_actor_uid ELSE verified_by END,
        verified_by_id = CASE WHEN p_new_state = 'verified' THEN p_actor_uid ELSE verified_by_id END,
        approved_at  = CASE WHEN p_new_state = 'approved' THEN NOW() ELSE approved_at END,
        approved_by  = CASE WHEN p_new_state = 'approved' THEN p_actor_uid ELSE approved_by END,
        approved_by_id = CASE WHEN p_new_state = 'approved' THEN p_actor_uid ELSE approved_by_id END,
        expired_at   = CASE WHEN p_new_state = 'expired' THEN NOW() ELSE expired_at END,
        expiry_reason = CASE WHEN p_new_state = 'expired' THEN COALESCE(p_reason, 'Automated expiration') ELSE expiry_reason END
    WHERE application_id = p_application_id;

    RETURN jsonb_build_object('success', true, 'application_id', p_application_id, 'new_state', p_new_state);
END;
$$;
