-- =============================================================================
-- Fix: acquire_fcm_lock RPC idempotency bug
--
-- The original function returned acquired=true in BOTH the IF and ELSE
-- branches, making the idempotency lock a no-op (notifications were always
-- "acquired" regardless of whether they had already been sent).
--
-- This fix:
--   1. Returns acquired=false in the ELSE branch (already sent)
--   2. Wraps the UPDATE in an EXCEPTION block so missing columns
--      (fcm_start_sent / fcm_end_sent) never crash the function
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acquire_fcm_lock(p_trip_id TEXT, p_bus_id TEXT, p_lock_type TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_column    TEXT;
    v_updated   INTEGER := 0;
    v_trip_uuid UUID;
BEGIN
    IF p_lock_type = 'start' THEN
        v_column := 'fcm_start_sent';
    ELSIF p_lock_type = 'end' THEN
        v_column := 'fcm_end_sent';
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Invalid lock_type');
    END IF;

    BEGIN
        v_trip_uuid := p_trip_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        -- Non-UUID trip IDs bypass idempotency (allow notification)
        RETURN jsonb_build_object('success', true, 'acquired', true);
    END;

    BEGIN
        IF v_column = 'fcm_start_sent' THEN
            UPDATE active_trips
            SET fcm_start_sent = true
            WHERE trip_id = v_trip_uuid
              AND bus_id   = p_bus_id
              AND fcm_start_sent = false;
        ELSE
            UPDATE active_trips
            SET fcm_end_sent = true
            WHERE trip_id = v_trip_uuid
              AND bus_id   = p_bus_id
              AND fcm_end_sent = false;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Column missing in older schema; allow the notification through
        RETURN jsonb_build_object('success', true, 'acquired', true);
    END;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated >= 1 THEN
        -- Lock acquired: this is the first send
        RETURN jsonb_build_object('success', true, 'acquired', true);
    ELSE
        -- BUG FIX: was also returning acquired=true here; now returns false
        -- to correctly signal the notification was already dispatched
        RETURN jsonb_build_object('success', true, 'acquired', false);
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_fcm_lock(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_fcm_lock(TEXT, TEXT, TEXT) TO service_role;
