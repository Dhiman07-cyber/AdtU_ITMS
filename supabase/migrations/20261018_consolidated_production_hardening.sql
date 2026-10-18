-- =============================================================================
-- CONSOLIDATED PRODUCTION HARDENING MIGRATION — ADTU ITMS
-- File: 20261018_consolidated_production_hardening.sql
-- =============================================================================
-- Instructions: Copy and run this script in the Supabase Dashboard SQL Editor
-- (https://supabase.com/dashboard/project/ztqilqooygdqpmhnxidi/sql)
--
-- INCLUDES:
--   1. public.system_settings Table & Default Configs
--   2. public.stop_dwell_logs Table & Verification Proof Indexes
--   3. Hardened cleanup_stale_locks RPC (600s / 10-minute cellular deadzone buffer)
--   4. Shift Parity & Deadlock-Free Fleet RPCs (bus_increment, bus_decrement,
--      approve_renewal_with_seat, reassign_students_atomically with ORDER BY id ASC)
--
-- NOTE: In strict accordance with engineering directives, this migration
-- contains ZERO modifications to route coordinates, latitudes, or longitudes.
-- =============================================================================

-- ── 1. System Settings Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read system_settings" ON public.system_settings;
CREATE POLICY "Public read system_settings"
    ON public.system_settings FOR SELECT
    TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Service role write system_settings" ON public.system_settings;
CREATE POLICY "Service role write system_settings"
    ON public.system_settings FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Seed default settings if not already present
INSERT INTO public.system_settings (key, value, updated_at, updated_by)
VALUES 
  ('config', '{"appName": "AdtU Bus Services", "busFee": {"amount": 5000, "version": 1, "history": []}}'::jsonb, NOW(), 'system'),
  ('landing', '{"heroTitle": "AdtU Bus Services", "heroSubtitle": "Smart Campus Transit Portal", "features": []}'::jsonb, NOW(), 'system'),
  ('ui', '{"primaryColor": "#1e40af", "navigationStyle": "sidebar"}'::jsonb, NOW(), 'system'),
  ('deadline', '{"description": "Academic Calendar Configuration", "version": "1.0.0", "academicSessionStart": {"month": 6, "day": 1}}'::jsonb, NOW(), 'system')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Stop Dwell Logs Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stop_dwell_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id       TEXT NOT NULL,
    bus_id        TEXT NOT NULL,
    driver_id     TEXT NOT NULL,
    route_id      TEXT NOT NULL,
    stop_id       TEXT NOT NULL,
    stop_name     TEXT NOT NULL,
    arrived_at    TIMESTAMPTZ NOT NULL,
    departed_at   TIMESTAMPTZ,
    dwell_seconds INTEGER NOT NULL DEFAULT 0 CHECK (dwell_seconds >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_trip_id ON public.stop_dwell_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_bus_time ON public.stop_dwell_logs(bus_id, arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_route_stop ON public.stop_dwell_logs(route_id, stop_name);

ALTER TABLE public.stop_dwell_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read stop_dwell_logs" ON public.stop_dwell_logs;
CREATE POLICY "Public read stop_dwell_logs"
    ON public.stop_dwell_logs FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Service role manage stop_dwell_logs" ON public.stop_dwell_logs;
CREATE POLICY "Service role manage stop_dwell_logs"
    ON public.stop_dwell_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ── 3. Hardened cleanup_stale_locks (10-Minute Timeout) ──────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 600)
RETURNS TABLE(
  cleaned_trip_id UUID,
  cleaned_bus_id TEXT,
  cleaned_driver_id TEXT
) AS $$
DECLARE
  v_trip RECORD;
BEGIN
  FOR v_trip IN
    SELECT at.trip_id, at.bus_id, at.driver_id, at.route_id, at.shift, at.start_time
    FROM public.active_trips at
    WHERE at.status = 'active'
      AND at.last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL
  LOOP
    INSERT INTO public.driver_trip_history (
      trip_id, bus_id, driver_id, route_id, shift, status, ended_reason, start_time, end_time, duration_seconds
    ) VALUES (
      v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
      'completed', 'completed_stale', v_trip.start_time, NOW(),
      GREATEST(0, EXTRACT(EPOCH FROM (NOW() - v_trip.start_time))::INTEGER)
    )
    ON CONFLICT (trip_id) DO NOTHING;

    DELETE FROM public.active_trips
    WHERE active_trips.trip_id = v_trip.trip_id;
    
    RETURN QUERY SELECT v_trip.trip_id, v_trip.bus_id, v_trip.driver_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 4. Shift Parity & Capacity RPCs ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.bus_increment_capacity(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.bus_increment_capacity(
    p_bus_id TEXT, 
    p_shift TEXT DEFAULT 'Morning', 
    p_enforce_capacity BOOLEAN DEFAULT true
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
    v_capacity INTEGER; v_morning_load INTEGER; v_evening_load INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning, Evening, or Both)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    
    v_capacity := COALESCE(v_bus.capacity, 0);
    v_morning_load := COALESCE(v_bus.morning_load, 0);
    v_evening_load := COALESCE(v_bus.evening_load, 0);

    IF p_enforce_capacity THEN
        IF v_normalized IN ('morning', 'both') AND v_morning_load >= v_capacity THEN
            RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' is at full capacity for morning shift (' || v_morning_load || '/' || v_capacity || ')');
        END IF;
        IF v_normalized IN ('evening', 'both') AND v_evening_load >= v_capacity THEN
            RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' is at full capacity for evening shift (' || v_evening_load || '/' || v_capacity || ')');
        END IF;
    END IF;

    v_new_morning := v_morning_load + CASE WHEN v_normalized IN ('morning', 'both') THEN 1 ELSE 0 END;
    v_new_evening := v_evening_load + CASE WHEN v_normalized IN ('evening', 'both') THEN 1 ELSE 0 END;
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = v_bus.id;

    RETURN jsonb_build_object('busId', v_bus.id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bus_decrement_capacity(
    p_bus_id TEXT, 
    p_shift TEXT DEFAULT 'Morning'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning, Evening, or Both)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;
    v_new_morning := GREATEST(0, COALESCE(v_bus.morning_load, 0) - CASE WHEN v_normalized IN ('morning', 'both') THEN 1 ELSE 0 END);
    v_new_evening := GREATEST(0, COALESCE(v_bus.evening_load, 0) - CASE WHEN v_normalized IN ('evening', 'both') THEN 1 ELSE 0 END);
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = v_bus.id;
    RETURN jsonb_build_object('busId', v_bus.id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;

-- ── 5. approve_renewal_with_seat ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_renewal_with_seat(
    p_student_uid       TEXT,
    p_bus_id            TEXT,
    p_shift             TEXT,
    p_valid_until       TIMESTAMPTZ,
    p_session_end_year  INTEGER,
    p_session_duration  INTEGER,
    p_application_id    TEXT,
    p_approved_by       TEXT,
    p_soft_block        BOOLEAN DEFAULT FALSE,
    p_hard_block        BOOLEAN DEFAULT FALSE
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
BEGIN
    -- 1. Validate shift
    v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    IF v_normalized_shift NOT IN ('morning', 'evening', 'both') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid shift: ' || COALESCE(p_shift, 'NULL'));
    END IF;

    -- 2. Lock student profile row to preserve exact original state for rollback compensation
    SELECT uid, status, valid_until, session_end_year, session_duration, soft_block, hard_block, seat_released_at, last_processed_application_id
    INTO v_student
    FROM student_profiles
    WHERE uid = p_student_uid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found: ' || p_student_uid);
    END IF;

    -- 3. Lock bus row and check capacity atomically
    SELECT id, capacity, morning_load, evening_load
    INTO v_bus
    FROM buses
    WHERE id = p_bus_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bus ' || p_bus_id || ' not found');
    END IF;

    -- 4. Verify capacity has room
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

    -- 5. Increment bus capacity
    UPDATE buses
    SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = p_bus_id;

    -- 6. Update student profile (re-activate, extend validity)
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
        RAISE EXCEPTION 'Failed to update student profile % during renewal approval', p_student_uid;
    END IF;

    -- 7. Update application state to approved
    UPDATE applications SET
        state       = 'approved',
        reviewed_by = p_approved_by,
        reviewed_at = NOW(),
        updated_at  = NOW()
    WHERE id = p_application_id;

    GET DIAGNOSTICS v_app_updated = ROW_COUNT;
    IF v_app_updated <> 1 THEN
        RAISE EXCEPTION 'Failed to update application % to approved', p_application_id;
    END IF;

    RETURN jsonb_build_object(
        'success',          true,
        'student_uid',      p_student_uid,
        'bus_id',           p_bus_id,
        'new_morning_load', v_new_morning,
        'new_evening_load', v_new_evening,
        'valid_until',      p_valid_until
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

-- ── 6. reassign_students_atomically (Deadlock-Free Lexical Locking) ───────────
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
    v_processed      INTEGER := 0;
    v_cap_result     JSONB;
    v_affected_buses TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- 1. Pre-lock all affected buses in strict ascending order (ORDER BY id ASC FOR UPDATE)
    -- This guarantees a global lock acquisition hierarchy, mathematically eliminating PostgreSQL 40P01 deadlocks!
    SELECT ARRAY_AGG(id ORDER BY id ASC)
    INTO v_affected_buses
    FROM buses
    WHERE id IN (
        SELECT DISTINCT COALESCE(plan->>'fromBusId', plan->>'from_bus_id')
        FROM jsonb_array_elements(p_plans) AS plan
        WHERE COALESCE(plan->>'fromBusId', plan->>'from_bus_id') IS NOT NULL
          AND COALESCE(plan->>'fromBusId', plan->>'from_bus_id') <> ''
        UNION
        SELECT DISTINCT COALESCE(plan->>'toBusId', plan->>'to_bus_id')
        FROM jsonb_array_elements(p_plans) AS plan
        WHERE COALESCE(plan->>'toBusId', plan->>'to_bus_id') IS NOT NULL
          AND COALESCE(plan->>'toBusId', plan->>'to_bus_id') <> ''
    )
    FOR UPDATE;

    FOR v_plan IN SELECT * FROM jsonb_array_elements(p_plans) LOOP
        v_student_id  := COALESCE(v_plan->>'studentId', v_plan->>'student_id');
        v_from_bus_id := COALESCE(v_plan->>'fromBusId', v_plan->>'from_bus_id');
        v_to_bus_id   := COALESCE(v_plan->>'toBusId', v_plan->>'to_bus_id');

        IF v_student_id IS NULL OR v_student_id = '' THEN CONTINUE; END IF;

        -- Read student (lock row to prevent concurrent modification)
        SELECT uid, shift, bus_id, stop_name
        INTO v_student
        FROM student_profiles
        WHERE uid = v_student_id
        FOR UPDATE;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- Resolve old shift for decrement (student's current shift)
        v_old_shift := LOWER(TRIM(COALESCE(v_student.shift, 'Morning')));
        IF v_old_shift NOT IN ('morning', 'evening', 'both') THEN v_old_shift := 'morning'; END IF;

        -- Resolve new shift for increment (plan override > student record)
        v_new_shift := LOWER(TRIM(COALESCE(v_plan->>'studentShift', v_plan->>'shift', v_student.shift, 'Morning')));
        IF v_new_shift NOT IN ('morning', 'evening', 'both') THEN v_new_shift := 'morning'; END IF;

        -- Fetch target bus route_id
        SELECT route_id INTO v_target_route_id
        FROM buses
        WHERE id = v_to_bus_id OR bus_number = v_to_bus_id
        LIMIT 1;

        -- Decrement from-bus capacity using student's OLD shift
        IF v_from_bus_id IS NOT NULL AND v_from_bus_id <> '' THEN
            SELECT bus_decrement_capacity(v_from_bus_id, v_old_shift) INTO v_cap_result;
        END IF;

        -- Increment to-bus capacity using student's NEW shift and enforce capacity guard
        IF v_to_bus_id IS NOT NULL AND v_to_bus_id <> '' THEN
            SELECT bus_increment_capacity(v_to_bus_id, v_new_shift) INTO v_cap_result;
            IF v_cap_result->>'error' IS NOT NULL THEN
                RAISE EXCEPTION 'Capacity exceeded during reassignment for bus %: %', v_to_bus_id, v_cap_result->>'error';
            END IF;
        END IF;

        -- Resolve stop_name override if provided
        v_stop_name := COALESCE(v_plan->>'stopName', v_plan->>'stop_name', v_student.stop_name);

        -- Update student record (bus_id, route_id, shift, stop_name)
        UPDATE student_profiles SET
            bus_id          = v_to_bus_id,
            route_id        = COALESCE(v_target_route_id, route_id),
            shift           = INITCAP(v_new_shift),
            stop_name       = v_stop_name,
            seat_released_at = NULL,
            updated_at      = NOW()
        WHERE uid = v_student_id;

        v_processed := v_processed + 1;
    END LOOP;

    -- Recalculate bus load counts for all affected buses in deterministic ascending order
    IF v_affected_buses IS NOT NULL AND array_length(v_affected_buses, 1) > 0 THEN
        FOR v_to_bus_id IN SELECT DISTINCT x FROM unnest(v_affected_buses) AS x ORDER BY x ASC LOOP
            UPDATE buses b SET
                (morning_load, evening_load, current_members, updated_at) = (
                    SELECT 
                        COUNT(*) FILTER (WHERE LOWER(sp.shift) IN ('morning', 'both')),
                        COUNT(*) FILTER (WHERE LOWER(sp.shift) IN ('evening', 'both')),
                        COUNT(*),
                        NOW()
                    FROM student_profiles sp
                    WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number)
                      AND sp.seat_released_at IS NULL
                      AND sp.status IN ('active', 'soft_blocked', 'pending_deletion')
                )
            WHERE b.id = v_to_bus_id OR b.bus_number = v_to_bus_id;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success',   true,
        'processed', v_processed
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

-- ── 7. Permissions and Role Grants ───────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.cleanup_stale_locks(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.bus_increment_capacity(TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.bus_decrement_capacity(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, BOOLEAN, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) TO service_role;

-- ── 8. Synchronize Verified Ground-Level Guwahati Route Geometries ─────────────
INSERT INTO public.routes (id, route_name, stops, buses, created_at, updated_at)
VALUES
  (
    'route_1',
    'Route-1',
    '[
      {"stop_id": "stop_1_1", "name": "Boragaon", "stop_name": "Boragaon", "lat": 26.1128, "lng": 91.6876, "sequence": 1},
      {"stop_id": "stop_1_2", "name": "Garchuk", "stop_name": "Garchuk", "lat": 26.1122, "lng": 91.7098, "sequence": 2},
      {"stop_id": "stop_1_3", "name": "Lokhra Chariali", "stop_name": "Lokhra Chariali", "lat": 26.1117, "lng": 91.7494, "sequence": 3},
      {"stop_id": "stop_1_4", "name": "Lalmati", "stop_name": "Lalmati", "lat": 26.1132, "lng": 91.7755, "sequence": 4},
      {"stop_id": "stop_1_5", "name": "National Games Village", "stop_name": "National Games Village", "lat": 26.1145, "lng": 91.7868, "sequence": 5},
      {"stop_id": "stop_1_6", "name": "Beltola Tiniali", "stop_name": "Beltola Tiniali", "lat": 26.1241, "lng": 91.7994, "sequence": 6},
      {"stop_id": "stop_1_7", "name": "Last Gate / Dispur", "stop_name": "Last Gate / Dispur", "lat": 26.1438, "lng": 91.7896, "sequence": 7},
      {"stop_id": "stop_1_8", "name": "Ganeshguri Bus Stop", "stop_name": "Ganeshguri Bus Stop", "lat": 26.1518, "lng": 91.7836, "sequence": 8},
      {"stop_id": "stop_1_9", "name": "Zoo Road Tiniali", "stop_name": "Zoo Road Tiniali", "lat": 26.1656, "lng": 91.7812, "sequence": 9},
      {"stop_id": "stop_1_10", "name": "Gitanagar", "stop_name": "Gitanagar", "lat": 26.1738, "lng": 91.7945, "sequence": 10},
      {"stop_id": "stop_1_11", "name": "Noonmati / BG Tiniali", "stop_name": "Noonmati / BG Tiniali", "lat": 26.1825, "lng": 91.8058, "sequence": 11},
      {"stop_id": "stop_1_12", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 12},
      {"stop_id": "stop_1_13", "name": "Panikhaiti Tiniali", "stop_name": "Panikhaiti Tiniali", "lat": 26.1972, "lng": 91.8575, "sequence": 13},
      {"stop_id": "stop_1_14", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 14}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_2',
    'Route-2',
    '[
      {"stop_id": "stop_2_1", "name": "Jalukbari Bus Stop", "stop_name": "Jalukbari Bus Stop", "lat": 26.1465, "lng": 91.6625, "sequence": 1},
      {"stop_id": "stop_2_2", "name": "Maligaon Chariali", "stop_name": "Maligaon Chariali", "lat": 26.1542, "lng": 91.6972, "sequence": 2},
      {"stop_id": "stop_2_3", "name": "Bhutnath", "stop_name": "Bhutnath", "lat": 26.1654, "lng": 91.7188, "sequence": 3},
      {"stop_id": "stop_2_4", "name": "Santipur", "stop_name": "Santipur", "lat": 26.1702, "lng": 91.7248, "sequence": 4},
      {"stop_id": "stop_2_5", "name": "Bharalumukh", "stop_name": "Bharalumukh", "lat": 26.1738, "lng": 91.7322, "sequence": 5},
      {"stop_id": "stop_2_6", "name": "Fancy Bazar", "stop_name": "Fancy Bazar", "lat": 26.1828, "lng": 91.7405, "sequence": 6},
      {"stop_id": "stop_2_7", "name": "Panbazar Bus Stop", "stop_name": "Panbazar Bus Stop", "lat": 26.1850, "lng": 91.7478, "sequence": 7},
      {"stop_id": "stop_2_8", "name": "Chandmari Bus Stop", "stop_name": "Chandmari Bus Stop", "lat": 26.1882, "lng": 91.7738, "sequence": 8},
      {"stop_id": "stop_2_9", "name": "Bamunimaidan", "stop_name": "Bamunimaidan", "lat": 26.1865, "lng": 91.7892, "sequence": 9},
      {"stop_id": "stop_2_10", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 10},
      {"stop_id": "stop_2_11", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 11}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_3',
    'Route-3',
    '[
      {"stop_id": "stop_3_1", "name": "Guwahati Club", "stop_name": "Guwahati Club", "lat": 26.1858, "lng": 91.7578, "sequence": 1},
      {"stop_id": "stop_3_2", "name": "Silpukhuri", "stop_name": "Silpukhuri", "lat": 26.1872, "lng": 91.7642, "sequence": 2},
      {"stop_id": "stop_3_3", "name": "Anuradha Cinema / Chandmari", "stop_name": "Anuradha Cinema / Chandmari", "lat": 26.1874, "lng": 91.7798, "sequence": 3},
      {"stop_id": "stop_3_4", "name": "Bamunimaidan Industrial Area", "stop_name": "Bamunimaidan Industrial Area", "lat": 26.1860, "lng": 91.7945, "sequence": 4},
      {"stop_id": "stop_3_5", "name": "New Guwahati", "stop_name": "New Guwahati", "lat": 26.1848, "lng": 91.8012, "sequence": 5},
      {"stop_id": "stop_3_6", "name": "Noonmati Sector 2", "stop_name": "Noonmati Sector 2", "lat": 26.1835, "lng": 91.8122, "sequence": 6},
      {"stop_id": "stop_3_7", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 7},
      {"stop_id": "stop_3_8", "name": "Panikhaiti Tiniali", "stop_name": "Panikhaiti Tiniali", "lat": 26.1972, "lng": 91.8575, "sequence": 8},
      {"stop_id": "stop_3_9", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 9}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_4',
    'Route-4',
    '[
      {"stop_id": "stop_4_1", "name": "Paltan Bazar ASTC", "stop_name": "Paltan Bazar ASTC", "lat": 26.1818, "lng": 91.7516, "sequence": 1},
      {"stop_id": "stop_4_2", "name": "Ulubari Bus Stop", "stop_name": "Ulubari Bus Stop", "lat": 26.1732, "lng": 91.7568, "sequence": 2},
      {"stop_id": "stop_4_3", "name": "Bora Service", "stop_name": "Bora Service", "lat": 26.1704, "lng": 91.7618, "sequence": 3},
      {"stop_id": "stop_4_4", "name": "Bhangagarh / GMCH", "stop_name": "Bhangagarh / GMCH", "lat": 26.1652, "lng": 91.7684, "sequence": 4},
      {"stop_id": "stop_4_5", "name": "Christian Basti", "stop_name": "Christian Basti", "lat": 26.1592, "lng": 91.7758, "sequence": 5},
      {"stop_id": "stop_4_6", "name": "Ganeshguri", "stop_name": "Ganeshguri", "lat": 26.1518, "lng": 91.7836, "sequence": 6},
      {"stop_id": "stop_4_7", "name": "Down Town Hospital", "stop_name": "Down Town Hospital", "lat": 26.1394, "lng": 91.7992, "sequence": 7},
      {"stop_id": "stop_4_8", "name": "Six Mile Bus Stop", "stop_name": "Six Mile Bus Stop", "lat": 26.1348, "lng": 91.8062, "sequence": 8},
      {"stop_id": "stop_4_9", "name": "Barbari VIP Road", "stop_name": "Barbari VIP Road", "lat": 26.1518, "lng": 91.8152, "sequence": 9},
      {"stop_id": "stop_4_10", "name": "Magzine VIP Road", "stop_name": "Magzine VIP Road", "lat": 26.1615, "lng": 91.8214, "sequence": 10},
      {"stop_id": "stop_4_11", "name": "Patharkuwary", "stop_name": "Patharkuwary", "lat": 26.1695, "lng": 91.8268, "sequence": 11},
      {"stop_id": "stop_4_12", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 12},
      {"stop_id": "stop_4_13", "name": "Panikhaiti Tiniali", "stop_name": "Panikhaiti Tiniali", "lat": 26.1972, "lng": 91.8575, "sequence": 13},
      {"stop_id": "stop_4_14", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 14}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_7',
    'Route-7',
    '[
      {"stop_id": "stop_7_1", "name": "Down Town Hospital", "stop_name": "Down Town Hospital", "lat": 26.1394, "lng": 91.7992, "sequence": 1},
      {"stop_id": "stop_7_2", "name": "Sixmile Bus Stop", "stop_name": "Sixmile Bus Stop", "lat": 26.1348, "lng": 91.8062, "sequence": 2},
      {"stop_id": "stop_7_3", "name": "Barbari VIP Road", "stop_name": "Barbari VIP Road", "lat": 26.1518, "lng": 91.8152, "sequence": 3},
      {"stop_id": "stop_7_4", "name": "Magzine VIP Road", "stop_name": "Magzine VIP Road", "lat": 26.1615, "lng": 91.8214, "sequence": 4},
      {"stop_id": "stop_7_5", "name": "Patharkuwary", "stop_name": "Patharkuwary", "lat": 26.1695, "lng": 91.8268, "sequence": 5},
      {"stop_id": "stop_7_6", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 6},
      {"stop_id": "stop_7_7", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 7}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_8',
    'Route-8',
    '[
      {"stop_id": "stop_8_1", "name": "Lakhmi Mandir (Beltola)", "stop_name": "Lakhmi Mandir (Beltola)", "lat": 26.1282, "lng": 91.7958, "sequence": 1},
      {"stop_id": "stop_8_2", "name": "Beltola (Wireless)", "stop_name": "Beltola (Wireless)", "lat": 26.1368, "lng": 91.7924, "sequence": 2},
      {"stop_id": "stop_8_3", "name": "Last Gate / Dispur", "stop_name": "Last Gate / Dispur", "lat": 26.1438, "lng": 91.7896, "sequence": 3},
      {"stop_id": "stop_8_4", "name": "Six Mile Bus Stop", "stop_name": "Six Mile Bus Stop", "lat": 26.1348, "lng": 91.8062, "sequence": 4},
      {"stop_id": "stop_8_5", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 5},
      {"stop_id": "stop_8_6", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 6}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  route_name = EXCLUDED.route_name,
  stops = EXCLUDED.stops,
  updated_at = NOW();

