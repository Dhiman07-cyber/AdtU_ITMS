-- =============================================================================
-- ASSAM DOWN TOWN UNIVERSITY INTELLIGENT TRANSPORT MANAGEMENT SYSTEM (ADTU ITMS)
-- PRODUCTION SYNCHRONIZATION SCRIPT (supabase/PRODUCTION_SYNC.sql)
-- Idempotent, Zero-Downtime Migration Script for Live Supabase PostgreSQL
-- =============================================================================

-- ── 1. DDL: Table Columns & Defaults (Fixes 10, 12, 13, 14) ─────────────────

-- Student Profiles Lifecycle Columns (Fix 14)
ALTER TABLE public.student_profiles
    ADD COLUMN IF NOT EXISTS seat_released_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_processed_application_id text,
    ADD COLUMN IF NOT EXISTS expiry_reminder_count integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_expiry_reminder_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS soft_block boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS session_start_year integer,
    ADD COLUMN IF NOT EXISTS session_end_year integer,
    ADD COLUMN IF NOT EXISTS valid_until timestamptz,
    ADD COLUMN IF NOT EXISTS stop_id text,
    ADD COLUMN IF NOT EXISTS stop_name text;

-- Driver Profiles Operational Columns (Fix 12)
ALTER TABLE public.driver_profiles
    ADD COLUMN IF NOT EXISTS bus_id text,
    ADD COLUMN IF NOT EXISTS route_id text,
    ADD COLUMN IF NOT EXISTS assigned_bus_id text,
    ADD COLUMN IF NOT EXISTS assigned_route_id text,
    ADD COLUMN IF NOT EXISTS shift text DEFAULT 'Both',
    ADD COLUMN IF NOT EXISTS trip_active boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS active_trip_id text,
    ADD COLUMN IF NOT EXISTS is_reserved boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- Buses Driver & Capacity Columns (Fix 13)
ALTER TABLE public.buses
    ADD COLUMN IF NOT EXISTS primary_driver_uid text,
    ADD COLUMN IF NOT EXISTS assigned_driver_id text,
    ADD COLUMN IF NOT EXISTS active_driver_id text,
    ADD COLUMN IF NOT EXISTS active_trip_id text,
    ADD COLUMN IF NOT EXISTS morning_load integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS evening_load integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_members integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS driver_device_session text;

-- Active Trips Device ID (Fix 101)
ALTER TABLE public.active_trips
    ADD COLUMN IF NOT EXISTS device_id text;

-- FCM Tokens UUID Default & Auto-Healing (Fix 10)
ALTER TABLE public.fcm_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
UPDATE public.fcm_tokens SET id = gen_random_uuid()::text WHERE id IS NULL;

-- Waiting Flags Structure Verification
ALTER TABLE public.waiting_flags
    ADD COLUMN IF NOT EXISTS bus_id text,
    ADD COLUMN IF NOT EXISTS trip_id text,
    ADD COLUMN IF NOT EXISTS stop_id text,
    ADD COLUMN IF NOT EXISTS student_id text,
    ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- ── 2. Unique Composite Index on public.fcm_tokens (Fix 9) ───────────────────
DELETE FROM public.fcm_tokens a USING public.fcm_tokens b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.token_hash = b.token_hash
  AND a.token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fcm_tokens_user_token_hash
    ON public.fcm_tokens(user_id, token_hash);

-- ── 3. Notifications RLS Policy Update (Fix 11) ──────────────────────────────
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications FOR SELECT USING (
    sender_user_id = auth.uid()::text
    OR recipient_ids @> ARRAY[auth.uid()::text]
    OR auto_injected_recipient_ids @> ARRAY[auth.uid()::text]
    OR target->>'type' IN ('all_users', 'all_role', 'route_based', 'shift_based')
    OR public.is_faculty()
);

-- ── 4. Trip Lock & Lifecycle Functions (Fixes 1, 2, 3, 4, 5, 8, 15) ──────────

-- Drop legacy overloaded signatures for end_trip_atomically (Fix 1)
DROP FUNCTION IF EXISTS public.end_trip_atomically(text, text, text);
DROP FUNCTION IF EXISTS public.end_trip_atomically(text, text, text, integer);
DROP FUNCTION IF EXISTS public.end_trip_atomically(text, text, text, integer, text);

-- end_trip_atomically with bus variations, 5 params with defaults, and waiting_flags purge (Fixes 1, 2, 5)
CREATE OR REPLACE FUNCTION public.end_trip_atomically(
    p_trip_id text,
    p_bus_id text,
    p_driver_id text DEFAULT NULL,
    p_min_duration_seconds integer DEFAULT 0,
    p_ended_reason text DEFAULT 'completed'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_trip         RECORD;
    v_now          TIMESTAMPTZ := NOW();
    v_dur_sec      INTEGER;
    v_status       TEXT := 'completed';
    v_reason       TEXT := COALESCE(NULLIF(p_ended_reason, ''), 'completed');
    v_is_valid_uuid BOOLEAN;
BEGIN
    v_is_valid_uuid := (p_trip_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

    -- FIX 5: Match bus_id variations in lookup
    SELECT * INTO v_trip FROM active_trips
    WHERE (trip_id::text = p_trip_id OR (v_is_valid_uuid AND trip_id = p_trip_id::uuid))
       OR bus_id IN (
           p_bus_id,
           REPLACE(p_bus_id, 'bus_', ''),
           'bus_' || REPLACE(p_bus_id, 'bus_', '')
       )
    ORDER BY (trip_id::text = p_trip_id) DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', true, 'alreadyEnded', true);
    END IF;

    v_dur_sec := EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER;

    -- Remove the active lock atomically within the single transaction
    DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;

    -- FIX 2: Purge public.waiting_flags inside public.end_trip_atomically
    DELETE FROM public.waiting_flags
    WHERE bus_id IN (
        v_trip.bus_id,
        p_bus_id,
        REPLACE(v_trip.bus_id, 'bus_', ''),
        'bus_' || REPLACE(v_trip.bus_id, 'bus_', ''),
        REPLACE(p_bus_id, 'bus_', ''),
        'bus_' || REPLACE(p_bus_id, 'bus_', '')
    )
    OR trip_id = v_trip.trip_id::text
    OR trip_id = p_trip_id;

    -- Sync driver_profiles active trip pointer
    UPDATE driver_profiles
    SET trip_active = false, active_trip_id = NULL, updated_at = v_now
    WHERE uid = v_trip.driver_id;

    -- Short trip threshold or forced termination check
    IF v_reason = 'force_ended' THEN
        v_status := 'terminated_early';
    ELSIF p_min_duration_seconds > 0 AND v_dur_sec < p_min_duration_seconds THEN
        v_status := 'terminated_early';
        v_reason := 'short_trip';
    END IF;

    INSERT INTO driver_trip_history (
        trip_id, bus_id, driver_id, route_id, shift,
        status, ended_reason, start_time, end_time, duration_seconds
    ) VALUES (
        v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
        v_status, v_reason, v_trip.start_time, v_now, v_dur_sec
    )
    ON CONFLICT (trip_id) DO UPDATE SET
        status = EXCLUDED.status,
        ended_reason = EXCLUDED.ended_reason,
        end_time = EXCLUDED.end_time,
        duration_seconds = EXCLUDED.duration_seconds;

    RETURN jsonb_build_object(
        'success', true,
        'tripId', p_trip_id,
        'alreadyEnded', false,
        'status', v_status,
        'ended_reason', v_reason
    );
END;
$$;

-- acquire_trip_lock: zero-wait driver handover, per-bus driver_device_session, device_id (Fixes 101, 102)
CREATE OR REPLACE FUNCTION public.acquire_trip_lock(
    p_trip_id TEXT,
    p_bus_id TEXT,
    p_driver_id TEXT,
    p_route_id TEXT,
    p_shift TEXT,
    p_ttl_seconds INTEGER DEFAULT 1800,
    p_device_id TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
    v_existing RECORD;
    v_bus_status TEXT;
    v_handover_occurred BOOLEAN := false;
    v_previous_driver_id TEXT := NULL;
    v_previous_trip_id TEXT := NULL;
BEGIN
    -- 1. Check if the calling driver ALREADY has an active trip on this bus (Idempotent re-entry)
    SELECT trip_id INTO v_existing FROM active_trips
    WHERE bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active';
    IF FOUND THEN
        IF p_device_id IS NOT NULL THEN
            UPDATE active_trips SET device_id = p_device_id WHERE trip_id = v_existing.trip_id;
            UPDATE buses SET driver_device_session = p_device_id WHERE id = p_bus_id;
        END IF;
        RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id::text, 'alreadyActive', true, 'handover', false);
    END IF;

    -- 2. Authority for bus validity: must exist and not be inactive or maintenance
    SELECT status INTO v_bus_status FROM buses WHERE id = p_bus_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Bus not found'); END IF;
    IF v_bus_status IN ('inactive', 'maintenance') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus is currently ' || v_bus_status || ' and cannot start a trip');
    END IF;

    -- 3. Zero-Wait Instant Driver Handover:
    -- If ANY other driver has an unended active trip on this bus, atomically archive it into driver_trip_history
    -- so Driver 2 is NEVER blocked and NEVER waits.
    FOR v_existing IN
        SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
        FROM active_trips
        WHERE bus_id = p_bus_id AND status = 'active' AND driver_id <> p_driver_id
    LOOP
        v_handover_occurred := true;
        v_previous_driver_id := v_existing.driver_id;
        v_previous_trip_id := v_existing.trip_id::text;

        INSERT INTO driver_trip_history (
            trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
        ) VALUES (
            v_existing.trip_id, v_existing.bus_id, v_existing.driver_id, v_existing.route_id, v_existing.shift,
            'completed', 'completed_stale', v_existing.start_time, v_now,
            GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_existing.start_time))::INTEGER)
        ) ON CONFLICT (trip_id) DO NOTHING;

        UPDATE driver_profiles
        SET trip_active = false, active_trip_id = NULL, updated_at = v_now
        WHERE uid = v_existing.driver_id;

        DELETE FROM active_trips WHERE trip_id = v_existing.trip_id;
    END LOOP;

    -- 4. Clean up any stale active trip by THIS driver on another bus (if expired)
    FOR v_existing IN
        SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
        FROM active_trips
        WHERE driver_id = p_driver_id AND status = 'active'
          AND last_heartbeat < v_now - INTERVAL '1800 seconds'
    LOOP
        INSERT INTO driver_trip_history (
            trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
        ) VALUES (
            v_existing.trip_id, v_existing.bus_id, v_existing.driver_id, v_existing.route_id, v_existing.shift,
            'completed', 'completed_stale', v_existing.start_time, v_now,
            GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_existing.start_time))::INTEGER)
        ) ON CONFLICT (trip_id) DO NOTHING;

        DELETE FROM active_trips WHERE trip_id = v_existing.trip_id;
    END LOOP;

    BEGIN
        INSERT INTO active_trips (trip_id, bus_id, driver_id, route_id, shift, device_id, status, start_time, last_heartbeat, expires_at)
        VALUES (p_trip_id::uuid, p_bus_id, p_driver_id, p_route_id, p_shift, p_device_id, 'active', v_now, v_now, v_expires_at);

        -- FIX 4: Purge leftover public.waiting_flags inside public.acquire_trip_lock
        DELETE FROM public.waiting_flags
        WHERE bus_id IN (
            p_bus_id,
            REPLACE(p_bus_id, 'bus_', ''),
            'bus_' || REPLACE(p_bus_id, 'bus_', '')
        )
        AND (trip_id IS NULL OR trip_id <> p_trip_id);

        -- Update driver_profiles active trip pointer
        UPDATE driver_profiles
        SET trip_active = true, active_trip_id = p_trip_id, updated_at = v_now
        WHERE uid = p_driver_id;

        -- Update buses record with active driver and device session
        UPDATE buses
        SET driver_device_session = COALESCE(p_device_id, driver_device_session),
            driver_uid = p_driver_id,
            last_started_at = v_now,
            updated_at = v_now
        WHERE id = p_bus_id;

        RETURN jsonb_build_object(
            'success', true,
            'tripId', p_trip_id,
            'alreadyActive', false,
            'handover', v_handover_occurred,
            'previousDriverId', v_previous_driver_id,
            'previousTripId', v_previous_trip_id
        );
    EXCEPTION WHEN unique_violation THEN
        SELECT trip_id, driver_id INTO v_existing FROM active_trips WHERE bus_id = p_bus_id AND status = 'active' LIMIT 1;
        IF FOUND AND v_existing.driver_id = p_driver_id THEN
            RETURN jsonb_build_object('success', true, 'tripId', v_existing.trip_id::text, 'alreadyActive', true, 'handover', false);
        END IF;
        RETURN jsonb_build_object('success', false, 'error', 'LOCKED_BY_OTHER', 'activeDriverId', COALESCE(v_existing.driver_id, 'unknown'));
    END;
END;
$$;

-- extend_trip_lock: match bus_id variations (Fix 15)
CREATE OR REPLACE FUNCTION public.extend_trip_lock(
    p_trip_id TEXT, p_driver_id TEXT, p_bus_id TEXT, p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
    v_updated INTEGER;
    v_is_valid_uuid BOOLEAN;
BEGIN
    v_is_valid_uuid := (p_trip_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

    UPDATE active_trips
    SET last_heartbeat = NOW(), expires_at = v_expires_at
    WHERE (trip_id::text = p_trip_id OR (v_is_valid_uuid AND trip_id = p_trip_id::uuid))
      AND driver_id = p_driver_id
      AND bus_id IN (
          p_bus_id,
          REPLACE(p_bus_id, 'bus_', ''),
          'bus_' || REPLACE(p_bus_id, 'bus_', '')
      )
      AND status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated >= 1 THEN RETURN jsonb_build_object('success', true);
    ELSE RETURN jsonb_build_object('success', false, 'error', 'Active trip not found'); END IF;
END;
$$;

-- cleanup_stale_locks: FOR UPDATE SKIP LOCKED and waiting_flags purge (Fixes 3, 8)
CREATE OR REPLACE FUNCTION public.cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 600)
RETURNS TABLE(
  cleaned_trip_id UUID,
  cleaned_bus_id TEXT,
  cleaned_driver_id TEXT
) AS $$
DECLARE
  v_trip RECORD;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- FIX 8: Add FOR UPDATE SKIP LOCKED
  FOR v_trip IN
    SELECT at.trip_id, at.bus_id, at.driver_id, at.route_id, at.shift, at.start_time
    FROM public.active_trips at
    WHERE at.status = 'active'
      AND at.last_heartbeat < (v_now - make_interval(secs => p_heartbeat_timeout_seconds))
    ORDER BY at.trip_id ASC
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.driver_trip_history (
      trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
    ) VALUES (
      v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
      'completed', 'completed_stale', v_trip.start_time, v_now,
      GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER)
    )
    ON CONFLICT (trip_id) DO NOTHING;

    UPDATE driver_profiles
    SET trip_active = false, active_trip_id = NULL, updated_at = v_now
    WHERE uid = v_trip.driver_id;

    DELETE FROM public.active_trips
    WHERE active_trips.trip_id = v_trip.trip_id;

    -- FIX 3: Purge public.waiting_flags inside public.cleanup_stale_locks
    DELETE FROM public.waiting_flags
    WHERE bus_id IN (
        v_trip.bus_id,
        REPLACE(v_trip.bus_id, 'bus_', ''),
        'bus_' || REPLACE(v_trip.bus_id, 'bus_', '')
    )
    OR trip_id = v_trip.trip_id::text;
    
    RETURN QUERY SELECT v_trip.trip_id, v_trip.bus_id, v_trip.driver_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 5. Deadlock-Free Fleet & Seat Allocations (Fixes 6, 7, 16) ────────────────

-- reassign_students_atomically: deterministic lock hierarchy student_profiles ASC -> buses ASC (Fix 6)
CREATE OR REPLACE FUNCTION public.reassign_students_atomically(p_plans JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_plan           JSONB;
    v_student        RECORD;
    v_old_shift      TEXT;
    v_new_shift      TEXT;
    v_target_route_id TEXT;
    v_stop_name      TEXT;
    v_student_id     TEXT;
    v_from_bus_id    TEXT;
    v_to_bus_id      TEXT;
    v_bus_id_item    TEXT;
    v_processed      INTEGER := 0;
    v_cap_result     JSONB;
    v_affected_buses TEXT[] := ARRAY[]::TEXT[];
    v_morning_load   INTEGER;
    v_evening_load   INTEGER;
    v_bus_capacity   INTEGER;
BEGIN
    -- 1. Lock all target student_profiles rows in deterministic ascending uid order first
    PERFORM 1 FROM public.student_profiles
    WHERE uid IN (
        SELECT DISTINCT COALESCE(elem->>'studentUid', elem->>'studentId', elem->>'student_id')
        FROM jsonb_array_elements(p_plans) AS elem
        WHERE COALESCE(elem->>'studentUid', elem->>'studentId', elem->>'student_id') IS NOT NULL
    )
    ORDER BY uid ASC
    FOR UPDATE;

    -- 2. Lock all affected buses in deterministic ascending id order second
    SELECT ARRAY_AGG(id ORDER BY id ASC)
    INTO v_affected_buses
    FROM buses
    WHERE id IN (
        SELECT DISTINCT COALESCE(plan->>'toBusId', plan->>'to_bus_id')
        FROM jsonb_array_elements(p_plans) AS plan
        WHERE COALESCE(plan->>'toBusId', plan->>'to_bus_id') IS NOT NULL
          AND COALESCE(plan->>'toBusId', plan->>'to_bus_id') <> ''
        UNION
        SELECT DISTINCT bus_id
        FROM public.student_profiles
        WHERE uid IN (
            SELECT DISTINCT COALESCE(elem->>'studentUid', elem->>'studentId', elem->>'student_id')
            FROM jsonb_array_elements(p_plans) AS elem
            WHERE COALESCE(elem->>'studentUid', elem->>'studentId', elem->>'student_id') IS NOT NULL
        )
        AND bus_id IS NOT NULL
    )
    FOR UPDATE;

    FOR v_plan IN SELECT * FROM jsonb_array_elements(p_plans) LOOP
        v_student_id  := COALESCE(v_plan->>'studentUid', v_plan->>'studentId', v_plan->>'student_id');
        v_from_bus_id := COALESCE(v_plan->>'fromBusId', v_plan->>'from_bus_id');
        v_to_bus_id   := COALESCE(v_plan->>'toBusId', v_plan->>'to_bus_id');

        IF v_student_id IS NULL OR v_student_id = '' THEN CONTINUE; END IF;

        SELECT uid, shift, bus_id, stop_name, seat_released_at
        INTO v_student
        FROM student_profiles
        WHERE uid = v_student_id
        FOR UPDATE;

        IF NOT FOUND THEN CONTINUE; END IF;

        v_old_shift := LOWER(TRIM(COALESCE(v_student.shift, 'Morning')));
        IF v_old_shift NOT IN ('morning', 'evening') THEN v_old_shift := 'morning'; END IF;

        v_new_shift := LOWER(TRIM(COALESCE(v_plan->>'studentShift', v_plan->>'shift', v_student.shift, 'Morning')));
        IF v_new_shift NOT IN ('morning', 'evening') THEN v_new_shift := 'morning'; END IF;

        v_stop_name := COALESCE(v_plan->>'stopName', v_plan->>'stop_name', v_student.stop_name);

        -- Lookup route_id of destination bus
        SELECT route_id INTO v_target_route_id FROM buses WHERE id = v_to_bus_id;

        -- Update student assignment
        UPDATE student_profiles SET
            bus_id           = v_to_bus_id,
            route_id         = COALESCE(v_target_route_id, route_id),
            shift            = CASE WHEN v_new_shift = 'evening' THEN 'Evening' ELSE 'Morning' END,
            stop_name        = v_stop_name,
            seat_released_at = NULL,
            updated_at       = NOW()
        WHERE uid = v_student_id;

        v_processed := v_processed + 1;
    END LOOP;

    -- Recalculate loads for all locked buses
    IF v_affected_buses IS NOT NULL AND array_length(v_affected_buses, 1) > 0 THEN
        FOREACH v_bus_id_item IN ARRAY v_affected_buses LOOP
            SELECT
                COUNT(*) FILTER (WHERE LOWER(TRIM(shift)) = 'morning' AND seat_released_at IS NULL AND status = 'active'),
                COUNT(*) FILTER (WHERE LOWER(TRIM(shift)) = 'evening' AND seat_released_at IS NULL AND status = 'active')
            INTO v_morning_load, v_evening_load
            FROM student_profiles
            WHERE bus_id = v_bus_id_item;

            SELECT capacity INTO v_bus_capacity FROM buses WHERE id = v_bus_id_item;

            IF v_bus_capacity IS NOT NULL THEN
                IF v_morning_load > v_bus_capacity OR v_evening_load > v_bus_capacity THEN
                    RAISE EXCEPTION 'CAPACITY_EXCEEDED: Bus % capacity is % but reassignment results in Morning: %, Evening: %',
                        v_bus_id_item, v_bus_capacity, v_morning_load, v_evening_load;
                END IF;
            END IF;

            UPDATE buses
            SET morning_load    = v_morning_load,
                evening_load    = v_evening_load,
                current_members = v_morning_load + v_evening_load,
                updated_at      = NOW()
            WHERE id = v_bus_id_item;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'processed', v_processed);
END;
$$;

-- execute_reassignment_rollback: deterministic lock hierarchy student_profiles ASC -> buses ASC (Fix 7)
CREATE OR REPLACE FUNCTION public.execute_reassignment_rollback(
    p_operation_id TEXT,
    p_actor_id TEXT,
    p_actor_label TEXT,
    p_changes JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_orig_status     TEXT;
    v_orig_changes    JSONB;
    v_changes_array   JSONB;
    v_change          JSONB;
    v_collection      TEXT;
    v_doc_id          TEXT;
    v_before          JSONB;
    v_after           JSONB;
    v_student_row     RECORD;
    v_target_route_id TEXT;
    v_reverted_docs   TEXT[] := ARRAY[]::TEXT[];
    v_affected_buses  TEXT[] := ARRAY[]::TEXT[];
    v_bus_id_item     TEXT;
    v_row_updated     INTEGER;
    v_morning_load    INTEGER;
    v_evening_load    INTEGER;
    v_bus_capacity    INTEGER;
    v_rolled_back_count INTEGER := 0;
BEGIN
    IF jsonb_typeof(p_changes) = 'string' THEN
        v_changes_array := (p_changes#>>'{}')::jsonb;
    ELSE
        v_changes_array := p_changes;
    END IF;

    SELECT status, changes INTO v_orig_status, v_orig_changes
    FROM public.reassignment_logs
    WHERE operation_id = p_operation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Original reassignment log not found');
    END IF;

    IF v_orig_status = 'rolled_back' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Reassignment already rolled back', 'reverted_docs', '[]'::jsonb);
    END IF;

    IF v_orig_status <> 'committed' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only committed reassignments can be rolled back');
    END IF;

    -- Collect all affected bus IDs across before and after snapshots
    FOR v_change IN SELECT jsonb_array_elements(v_changes_array) LOOP
        v_before := v_change->'before';
        v_after := v_change->'after';
        IF v_before ? 'busId' OR v_before ? 'bus_id' THEN
            v_affected_buses := array_append(v_affected_buses, COALESCE(v_before->>'busId', v_before->>'bus_id'));
        END IF;
        IF v_after ? 'busId' OR v_after ? 'bus_id' THEN
            v_affected_buses := array_append(v_affected_buses, COALESCE(v_after->>'busId', v_after->>'bus_id'));
        END IF;
    END LOOP;

    -- FIX 7: Step 3 (Lock Students First): Lock all affected student_profiles rows in ascending uid order
    PERFORM uid
    FROM public.student_profiles
    WHERE uid IN (
        SELECT DISTINCT elem->>'docId'
        FROM jsonb_array_elements(v_changes_array) AS elem
        WHERE elem->>'collection' = 'students' AND elem->>'docId' IS NOT NULL
    )
    ORDER BY uid ASC
    FOR UPDATE;

    -- FIX 7: Step 4 (Lock Buses Second): Lock all affected buses rows in ascending id order
    IF v_affected_buses IS NOT NULL AND array_length(v_affected_buses, 1) > 0 THEN
        PERFORM id
        FROM buses
        WHERE id IN (SELECT DISTINCT x FROM unnest(v_affected_buses) AS x WHERE x IS NOT NULL AND x <> '')
        ORDER BY id ASC
        FOR UPDATE;
    END IF;

    -- Verify preconditions for all target students
    FOR v_change IN SELECT jsonb_array_elements(v_changes_array) LOOP
        v_collection := v_change->>'collection';
        v_doc_id := v_change->>'docId';
        v_after := v_change->'after';

        IF v_collection = 'students' THEN
            SELECT bus_id, shift INTO v_student_row
            FROM public.student_profiles
            WHERE uid = v_doc_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RETURN jsonb_build_object('success', false, 'error', 'Precondition failed: Student ' || v_doc_id || ' no longer exists');
            END IF;

            IF (v_after ? 'busId' OR v_after ? 'bus_id') AND COALESCE(v_student_row.bus_id, '') <> COALESCE(v_after->>'busId', v_after->>'bus_id', '') THEN
                RETURN jsonb_build_object('success', false, 'error', 'Precondition failed: Student ' || v_doc_id || ' busId has changed since the reassignment');
            END IF;
        END IF;
    END LOOP;

    -- Perform rollback on student records
    FOR v_change IN SELECT jsonb_array_elements(v_changes_array) LOOP
        v_collection := v_change->>'collection';
        v_doc_id := v_change->>'docId';
        v_before := v_change->'before';

        IF v_collection = 'students' THEN
            SELECT route_id INTO v_target_route_id FROM buses WHERE id = COALESCE(v_before->>'busId', v_before->>'bus_id');

            UPDATE public.student_profiles
            SET bus_id = COALESCE(v_before->>'busId', v_before->>'bus_id'),
                route_id = COALESCE(v_target_route_id, v_before->>'routeId', v_before->>'route_id', route_id),
                shift = COALESCE(v_before->>'shift', shift),
                stop_name = COALESCE(v_before->>'stopName', v_before->>'stop_name', stop_name),
                updated_at = NOW()
            WHERE uid = v_doc_id;

            GET DIAGNOSTICS v_row_updated = ROW_COUNT;
            IF v_row_updated > 0 THEN
                v_reverted_docs := array_append(v_reverted_docs, v_doc_id);
                v_rolled_back_count := v_rolled_back_count + 1;
            END IF;
        END IF;
    END LOOP;

    -- Recalculate capacity loads for all affected buses
    IF v_affected_buses IS NOT NULL AND array_length(v_affected_buses, 1) > 0 THEN
        FOREACH v_bus_id_item IN ARRAY (SELECT ARRAY_AGG(DISTINCT x) FROM unnest(v_affected_buses) AS x WHERE x IS NOT NULL AND x <> '') LOOP
            SELECT
                COUNT(*) FILTER (WHERE LOWER(TRIM(shift)) = 'morning' AND seat_released_at IS NULL AND status = 'active'),
                COUNT(*) FILTER (WHERE LOWER(TRIM(shift)) = 'evening' AND seat_released_at IS NULL AND status = 'active')
            INTO v_morning_load, v_evening_load
            FROM public.student_profiles
            WHERE bus_id = v_bus_id_item;

            SELECT capacity INTO v_bus_capacity FROM public.buses WHERE id = v_bus_id_item;

            UPDATE public.buses
            SET morning_load = v_morning_load,
                evening_load = v_evening_load,
                current_members = v_morning_load + v_evening_load,
                updated_at = NOW()
            WHERE id = v_bus_id_item;
        END LOOP;
    END IF;

    -- Mark reassignment log as rolled_back
    UPDATE public.reassignment_logs
    SET status = 'rolled_back',
        rolled_back_at = NOW(),
        rolled_back_by = p_actor_id,
        rolled_back_by_label = p_actor_label,
        updated_at = NOW()
    WHERE operation_id = p_operation_id;

    RETURN jsonb_build_object(
        'success', true,
        'rolled_back_count', v_rolled_back_count,
        'reverted_docs', to_jsonb(v_reverted_docs)
    );
END;
$$;

-- approve_renewal_with_seat: check if student holds active unreleased seat before incrementing (Fix 16)
CREATE OR REPLACE FUNCTION public.approve_renewal_with_seat(
    p_application_id    TEXT,
    p_student_uid       TEXT,
    p_bus_id            TEXT,
    p_shift             TEXT,
    p_valid_until       TIMESTAMPTZ,
    p_session_end_year  INTEGER,
    p_session_duration  TEXT,
    p_approver_uid      TEXT DEFAULT NULL,
    p_approved_by       TEXT DEFAULT NULL,
    p_soft_block        TIMESTAMPTZ DEFAULT NULL,
    p_hard_block        TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized_shift TEXT;
    v_bus              RECORD;
    v_student          RECORD;
    v_new_morning      INTEGER;
    v_new_evening      INTEGER;
    v_student_updated  INTEGER;
    v_app_updated      INTEGER;
    v_effective_actor  TEXT;
    v_skip_increment   BOOLEAN := false;
BEGIN
    v_effective_actor := COALESCE(p_approver_uid, p_approved_by, 'system');

    v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    IF v_normalized_shift NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid shift: ' || COALESCE(p_shift, 'NULL'));
    END IF;

    -- Lock student profile row to preserve exact original state
    SELECT uid, status, valid_until, session_end_year, session_duration, soft_block, hard_block, seat_released_at, last_processed_application_id, bus_id, shift
    INTO v_student
    FROM student_profiles
    WHERE uid = p_student_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found: ' || p_student_uid);
    END IF;

    -- Lock bus row
    SELECT id, capacity, morning_load, evening_load
    INTO v_bus
    FROM buses
    WHERE id = p_bus_id OR bus_number = p_bus_id
    FOR UPDATE
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus ' || p_bus_id || ' not found');
    END IF;

    -- FIX 16: Check whether student already holds an unreleased active seat on the target bus and shift
    IF (
        v_student.status = 'active'
        AND v_student.seat_released_at IS NULL
        AND (v_student.bus_id = v_bus.id OR v_student.bus_id = p_bus_id)
        AND LOWER(COALESCE(v_student.shift, 'morning')) = v_normalized_shift
    ) THEN
        v_skip_increment := true;
    END IF;

    IF NOT v_skip_increment THEN
        IF v_normalized_shift = 'morning' THEN
            IF v_bus.morning_load >= v_bus.capacity THEN
                RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
            END IF;
            v_new_morning := v_bus.morning_load + 1;
            v_new_evening := v_bus.evening_load;
        ELSIF v_normalized_shift = 'evening' THEN
            IF v_bus.evening_load >= v_bus.capacity THEN
                RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
            END IF;
            v_new_morning := v_bus.morning_load;
            v_new_evening := v_bus.evening_load + 1;
        ELSE -- 'both'
            IF v_bus.morning_load >= v_bus.capacity OR v_bus.evening_load >= v_bus.capacity THEN
                RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
            END IF;
            v_new_morning := v_bus.morning_load + 1;
            v_new_evening := v_bus.evening_load + 1;
        END IF;

        UPDATE buses
        SET morning_load = v_new_morning,
            evening_load = v_new_evening,
            current_members = v_new_morning + v_new_evening,
            updated_at = NOW()
        WHERE id = v_bus.id;
    END IF;

    -- Update student profile
    UPDATE student_profiles SET
        status           = 'active',
        valid_until      = p_valid_until,
        session_end_year = p_session_end_year,
        session_duration = p_session_duration,
        soft_block       = p_soft_block,
        hard_block       = p_hard_block,
        seat_released_at = NULL,
        last_processed_application_id = p_application_id,
        updated_at       = NOW()
    WHERE uid = p_student_uid;
    GET DIAGNOSTICS v_student_updated = ROW_COUNT;

    IF v_student_updated <> 1 THEN
        IF NOT v_skip_increment THEN
            UPDATE buses
            SET morning_load = v_bus.morning_load,
                evening_load = v_bus.evening_load,
                current_members = v_bus.morning_load + v_bus.evening_load,
                updated_at = NOW()
            WHERE id = v_bus.id;
        END IF;
        RETURN jsonb_build_object('success', false, 'error', 'Failed to update student profile: ' || p_student_uid);
    END IF;

    -- Update application state to approved
    UPDATE applications SET
        state                      = 'approved',
        status                     = 'approved',
        approved_at                = NOW(),
        approved_by                = v_effective_actor,
        processing_lock            = NULL,
        processing_lease_expires_at = NULL,
        updated_at                 = NOW()
    WHERE application_id = p_application_id;
    GET DIAGNOSTICS v_app_updated = ROW_COUNT;

    IF v_app_updated <> 1 THEN
        -- Rollback student update
        UPDATE student_profiles SET
            status           = v_student.status,
            valid_until      = v_student.valid_until,
            session_end_year = v_student.session_end_year,
            session_duration = v_student.session_duration,
            soft_block       = v_student.soft_block,
            hard_block       = v_student.hard_block,
            seat_released_at = v_student.seat_released_at,
            last_processed_application_id = v_student.last_processed_application_id,
            updated_at       = NOW()
        WHERE uid = p_student_uid;

        IF NOT v_skip_increment THEN
            UPDATE buses
            SET morning_load = v_bus.morning_load,
                evening_load = v_bus.evening_load,
                current_members = v_bus.morning_load + v_bus.evening_load,
                updated_at = NOW()
            WHERE id = v_bus.id;
        END IF;

        RETURN jsonb_build_object('success', false, 'error', 'Failed to update application ' || p_application_id || ' to approved');
    END IF;

    RETURN jsonb_build_object(
        'success',        true,
        'application_id', p_application_id,
        'student_uid',    p_student_uid,
        'bus_id',         v_bus.id,
        'shift',          v_normalized_shift,
        'skipped_increment', v_skip_increment,
        'morning_load',   CASE WHEN v_skip_increment THEN v_bus.morning_load ELSE v_new_morning END,
        'evening_load',   CASE WHEN v_skip_increment THEN v_bus.evening_load ELSE v_new_evening END,
        'status',         'approved'
    );
END;
$$;

-- ── 6. Academic Calendar & Notifications RPC (Fixes 17) ──────────────────────

-- recalculate_academic_lifecycle_dates: guard JSONB object extraction (Fix 17)
CREATE OR REPLACE FUNCTION public.recalculate_academic_lifecycle_dates(
    p_start_month INTEGER,
    p_start_day   INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pg_month          INTEGER;
    v_student           RECORD;
    v_app               RECORD;
    v_students_updated  INTEGER := 0;
    v_apps_updated      INTEGER := 0;
    v_year              INTEGER;
    v_day               INTEGER;
    v_hard_year         INTEGER;
    v_hard_day          INTEGER;
    v_soft_block        TIMESTAMPTZ;
    v_expiry            TIMESTAMPTZ;
    v_hard_block        TIMESTAMPTZ;
    v_app_year          INTEGER;
    v_app_day           INTEGER;
    v_app_soft_block    TIMESTAMPTZ;
    v_app_eligible      TIMESTAMPTZ;
    v_is_leap           BOOLEAN;
    v_is_hard_leap      BOOLEAN;
    v_is_app_leap       BOOLEAN;
BEGIN
    IF p_start_month < 0 OR p_start_month > 11 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid start_month: must be 0-11');
    END IF;
    IF p_start_day < 1 OR p_start_day > 31 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid start_day: must be 1-31');
    END IF;

    v_pg_month := p_start_month + 1;

    -- 1. Cascade update to active and soft_blocked students
    FOR v_student IN
        SELECT uid, session_end_year
        FROM public.student_profiles
        WHERE session_end_year IS NOT NULL
          AND status IN ('active', 'soft_blocked')
        FOR UPDATE
    LOOP
        v_year := v_student.session_end_year;
        v_day := p_start_day;

        IF v_pg_month = 2 AND p_start_day = 29 THEN
            v_is_leap := ((v_year % 4 = 0 AND v_year % 100 != 0) OR (v_year % 400 = 0));
            IF NOT v_is_leap THEN
                v_day := 28;
            END IF;
        END IF;

        v_soft_block := make_timestamptz(v_year, v_pg_month, v_day, 0, 0, 0, 'UTC');
        v_expiry := v_soft_block - INTERVAL '1 day';

        v_hard_year := v_year + 1;
        v_hard_day := p_start_day;
        IF v_pg_month = 2 AND p_start_day = 29 THEN
            v_is_hard_leap := ((v_hard_year % 4 = 0 AND v_hard_year % 100 != 0) OR (v_hard_year % 400 = 0));
            IF NOT v_is_hard_leap THEN
                v_hard_day := 28;
            END IF;
        END IF;
        v_hard_block := make_timestamptz(v_hard_year, v_pg_month, v_hard_day, 0, 0, 0, 'UTC');

        UPDATE public.student_profiles
        SET valid_until = v_expiry,
            soft_block = v_soft_block,
            hard_block = v_hard_block,
            updated_at = NOW()
        WHERE uid = v_student.uid;

        v_students_updated := v_students_updated + 1;
    END LOOP;

    -- 2. Cascade update to applications
    FOR v_app IN
        SELECT application_id, session_start_year, target_session, form_data
        FROM public.applications
        WHERE state IN ('submitted', 'verified_upcoming', 'pending_seat_allocation')
          AND (
            application_type = 'future'
            OR session_start_year IS NOT NULL
            OR target_session IS NOT NULL
            OR (form_data->>'sessionStartYear') IS NOT NULL
            OR (form_data->>'startYear') IS NOT NULL
          )
        FOR UPDATE
    LOOP
        -- FIX 17: Safe JSONB Extraction
        v_app_year := COALESCE(
            v_app.session_start_year,
            CASE WHEN v_app.target_session IS NOT NULL AND jsonb_typeof(v_app.target_session) = 'object'
                 THEN COALESCE((v_app.target_session->>'startYear')::INTEGER, (v_app.target_session->>'start_year')::INTEGER)
                 ELSE NULL END,
            (v_app.form_data->>'sessionStartYear')::INTEGER,
            (v_app.form_data->>'startYear')::INTEGER,
            (v_app.form_data->'sessionInfo'->>'sessionStartYear')::INTEGER,
            (v_app.form_data->'sessionInfo'->>'startYear')::INTEGER
        );

        IF v_app_year IS NOT NULL AND v_app_year > 2000 THEN
            v_app_day := p_start_day;
            IF v_pg_month = 2 AND p_start_day = 29 THEN
                v_is_app_leap := ((v_app_year % 4 = 0 AND v_app_year % 100 != 0) OR (v_app_year % 400 = 0));
                IF NOT v_is_app_leap THEN
                    v_app_day := 28;
                END IF;
            END IF;

            v_app_soft_block := make_timestamptz(v_app_year, v_pg_month, v_app_day, 0, 0, 0, 'UTC');
            v_app_eligible := v_app_soft_block + INTERVAL '1 day';

            UPDATE public.applications
            SET eligible_approval = v_app_eligible,
                updated_at = NOW()
            WHERE application_id = v_app.application_id;

            v_apps_updated := v_apps_updated + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'students_updated', v_students_updated,
        'applications_updated', v_apps_updated
    );
END;
$$;

-- Atomic mark notification read (Fix 100)
CREATE OR REPLACE FUNCTION public.mark_notification_read(
    p_notification_id TEXT,
    p_user_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE public.notifications
    SET read_by_user_ids = CASE
            WHEN COALESCE(read_by_user_ids, '{}') @> ARRAY[p_user_id] THEN read_by_user_ids
            ELSE array_append(COALESCE(read_by_user_ids, '{}'), p_user_id)
        END,
        read_by = CASE
            WHEN COALESCE(read_by, '{}') @> ARRAY[p_user_id] THEN read_by
            ELSE array_append(COALESCE(read_by, '{}'), p_user_id)
        END,
        updated_at = NOW()
    WHERE id = p_notification_id
      AND NOT (COALESCE(read_by_user_ids, '{}') @> ARRAY[p_user_id]);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- ── 7. Live Data Self-Healing Statements (Fix 100) ────────────────────────────

-- Delete orphaned public.waiting_flags rows whose bus_id has no active trip
DELETE FROM public.waiting_flags wf
WHERE NOT EXISTS (
    SELECT 1 FROM public.active_trips at
    WHERE at.status = 'active'
      AND at.bus_id IN (
          wf.bus_id,
          REPLACE(wf.bus_id, 'bus_', ''),
          'bus_' || REPLACE(wf.bus_id, 'bus_', '')
      )
);

-- Auto-sync missing public.users rows for existing public.student_profiles rows
INSERT INTO public.users (uid, email, name, role, created_at, updated_at)
SELECT sp.uid, sp.email, sp.full_name, 'student', COALESCE(sp.created_at, now()), now()
FROM public.student_profiles sp
WHERE sp.email IS NOT NULL
ON CONFLICT (uid) DO NOTHING;

-- Auto-sync missing public.users rows for existing public.driver_profiles rows
INSERT INTO public.users (uid, email, name, role, created_at, updated_at)
SELECT dp.uid, dp.email, dp.full_name, 'driver', COALESCE(dp.created_at, now()), now()
FROM public.driver_profiles dp
WHERE dp.email IS NOT NULL
ON CONFLICT (uid) DO NOTHING;

-- Mark stale 'submitted'/'verified' fresh applications as 'approved' if already active student
UPDATE public.applications a
SET state = 'approved',
    updated_at = now()
FROM public.student_profiles sp
WHERE a.applicant_uid = sp.uid
  AND sp.status = 'active'
  AND a.state IN ('submitted', 'verified', 'awaiting_verification')
  AND COALESCE(a.application_type, 'fresh') NOT IN ('renewal');

-- ── 8. Schema Cache Invalidation (Fix 18) ────────────────────────────────────
NOTIFY pgrst, 'reload schema';
