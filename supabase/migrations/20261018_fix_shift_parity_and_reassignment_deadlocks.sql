-- =============================================================================
-- Migration: 20261018_fix_shift_parity_and_reassignment_deadlocks.sql
-- ADTU ITMS Production Hardening: Shift Parity & Deadlock-Free Reassignment
-- =============================================================================
-- 1. Updates bus_increment_capacity & bus_decrement_capacity to support 'both' shift
-- 2. Updates approve_renewal_with_seat to support 'both' shift and validate capacity
-- 3. Updates reassign_students_atomically to pre-lock all affected buses with
--    ORDER BY id ASC FOR UPDATE (eliminates 40P01 deadlocks) and count 'both' shift
-- =============================================================================

-- ── 1. bus_increment_capacity ────────────────────────────────────────────────
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

-- ── 2. bus_decrement_capacity ────────────────────────────────────────────────
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

-- ── 3. approve_renewal_with_seat ─────────────────────────────────────────────
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

-- ── 4. reassign_students_atomically ──────────────────────────────────────────
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
