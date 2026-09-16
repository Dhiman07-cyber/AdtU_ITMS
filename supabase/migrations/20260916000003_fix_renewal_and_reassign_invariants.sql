-- ============================================================================
-- Migration: 20260916000003_fix_renewal_and_reassign_invariants.sql
-- Description:
--   1. Fix approve_renewal_with_seat rollback compensation to restore exact
--      prior student profile status and validity rather than unconditionally
--      forcing 'soft_blocked'.
--   2. Enforce atomic capacity error check in reassign_students_atomically
--      to abort the transaction if destination bus capacity is exceeded.
-- ============================================================================

-- ── 1. approve_renewal_with_seat with full original-state rollback ──────────
CREATE OR REPLACE FUNCTION public.approve_renewal_with_seat(
    p_application_id  TEXT,
    p_approver_uid    TEXT,
    p_student_uid     TEXT,
    p_bus_id          TEXT,
    p_shift           TEXT,
    p_valid_until     TIMESTAMPTZ,
    p_session_end_year INTEGER,
    p_session_duration TEXT,
    p_soft_block      TIMESTAMPTZ DEFAULT NULL,
    p_hard_block      TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
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
    IF v_normalized_shift NOT IN ('morning', 'evening') THEN
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
    ELSE
        IF v_bus.evening_load >= v_bus.capacity THEN
            RETURN jsonb_build_object('success', false, 'error', 'CAPACITY_FULL', 'busId', p_bus_id, 'shift', p_shift);
        END IF;
        v_new_morning := v_bus.morning_load;
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
        -- Compensate bus capacity
        UPDATE buses
        SET morning_load = v_bus.morning_load, evening_load = v_bus.evening_load, current_members = v_bus.morning_load + v_bus.evening_load, updated_at = NOW()
        WHERE id = p_bus_id;
        RETURN jsonb_build_object('success', false, 'error', 'Student profile not found or not updated: ' || p_student_uid);
    END IF;

    -- 7. Finalize application → approved (preserve for audit trail)
    UPDATE applications SET
        state                       = 'approved',
        approved_at                 = NOW(),
        approved_by                 = p_approver_uid,
        approved_by_id              = p_approver_uid,
        processing_lock             = NULL,
        processing_started_at       = NULL,
        processing_lease_expires_at = NULL,
        processing_result           = 'success',
        processing_completed_at     = NOW(),
        updated_at                  = NOW()
    WHERE application_id = p_application_id
      AND processing_lock = p_approver_uid;
    GET DIAGNOSTICS v_app_updated = ROW_COUNT;

    IF v_app_updated <> 1 THEN
        -- Compensate both student and bus restoring exact original values
        UPDATE student_profiles SET
            status                        = v_student.status,
            valid_until                   = v_student.valid_until,
            session_end_year              = v_student.session_end_year,
            session_duration              = v_student.session_duration,
            soft_block                    = v_student.soft_block,
            hard_block                    = v_student.hard_block,
            seat_released_at              = v_student.seat_released_at,
            last_processed_application_id = v_student.last_processed_application_id,
            updated_at                    = NOW()
        WHERE uid = p_student_uid;
        UPDATE buses
        SET morning_load = v_bus.morning_load, evening_load = v_bus.evening_load, current_members = v_bus.morning_load + v_bus.evening_load, updated_at = NOW()
        WHERE id = p_bus_id;
        RETURN jsonb_build_object('success', false, 'error', 'Application lock expired or not found: ' || p_application_id);
    END IF;

    RETURN jsonb_build_object(
        'success',     true,
        'studentUid',  p_student_uid,
        'busId',       p_bus_id,
        'shift',       p_shift,
        'newMorningLoad', v_new_morning,
        'newEveningLoad', v_new_evening,
        'capacity',    v_bus.capacity
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$;

REVOKE EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM public;
REVOKE EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM anon;
GRANT  EXECUTE ON FUNCTION public.approve_renewal_with_seat(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;


-- ── 2. reassign_students_atomically with capacity check enforcement ─────────
CREATE OR REPLACE FUNCTION public.reassign_students_atomically(p_plans JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $
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
    FOR v_plan IN SELECT * FROM jsonb_array_elements(p_plans) LOOP
        v_student_id  := COALESCE(v_plan->>'studentId', v_plan->>'student_id');
        v_from_bus_id := COALESCE(v_plan->>'fromBusId', v_plan->>'from_bus_id');
        v_to_bus_id   := COALESCE(v_plan->>'toBusId', v_plan->>'to_bus_id');

        IF v_student_id IS NULL OR v_student_id = '' THEN CONTINUE; END IF;

        IF v_from_bus_id IS NOT NULL AND v_from_bus_id <> '' THEN
            v_affected_buses := array_append(v_affected_buses, v_from_bus_id);
        END IF;
        IF v_to_bus_id IS NOT NULL AND v_to_bus_id <> '' THEN
            v_affected_buses := array_append(v_affected_buses, v_to_bus_id);
        END IF;

        -- Read student (lock row to prevent concurrent modification)
        SELECT uid, shift, bus_id, stop_name
        INTO v_student
        FROM student_profiles
        WHERE uid = v_student_id
        FOR UPDATE;

        IF NOT FOUND THEN CONTINUE; END IF;

        -- Resolve old shift for decrement (student's current shift)
        v_old_shift := LOWER(TRIM(COALESCE(v_student.shift, 'Morning')));
        IF v_old_shift NOT IN ('morning', 'evening') THEN v_old_shift := 'morning'; END IF;

        -- Resolve new shift for increment (plan override > student record)
        v_new_shift := LOWER(TRIM(COALESCE(v_plan->>'studentShift', v_plan->>'shift', v_student.shift, 'Morning')));
        IF v_new_shift NOT IN ('morning', 'evening') THEN v_new_shift := 'morning'; END IF;

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
            updated_at      = NOW()
        WHERE uid = v_student_id;

        v_processed := v_processed + 1;
    END LOOP;

    -- Recalculate bus load counts for all affected buses to ensure 100% precision
    FOR v_to_bus_id IN SELECT DISTINCT unnest(v_affected_buses) LOOP
        UPDATE buses b SET
            morning_load = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND LOWER(sp.shift) = 'morning' AND sp.status = 'active'),
            evening_load = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND LOWER(sp.shift) = 'evening' AND sp.status = 'active'),
            current_members = (SELECT COUNT(*) FROM student_profiles sp WHERE (sp.bus_id = b.id OR sp.bus_id = b.bus_number) AND sp.status = 'active'),
            updated_at = NOW()
        WHERE b.id = v_to_bus_id OR b.bus_number = v_to_bus_id;
    END LOOP;

    RETURN jsonb_build_object(
        'success',   true,
        'processed', v_processed
    );
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$;

REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM public;
REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reassign_students_atomically(JSONB) TO service_role;

-- ── 3. Partial unique index to enforce exactly-one active application per student session
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_active_student_session 
ON applications (applicant_uid, session_id) 
WHERE state NOT IN ('rejected', 'cancelled');
