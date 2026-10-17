-- Migration: 20261016_fix_academic_lifecycle_inconsistencies.sql
-- Fixes:
-- 1. idx_applications_active_student_session: Coalesce session_start_year to 0 to prevent
--    duplicate active applications when session_start_year is NULL (SQL standard NULL != NULL trap).
-- 2. soft_block_student_with_seat_release: Handle missing/decommissioned buses as non-fatal warnings
--    so orphaned/legacy bus IDs do not prevent soft-blocking student profiles.

-- 1. Recreate partial unique index with COALESCE
DROP INDEX IF EXISTS public.idx_applications_active_student_session;

CREATE UNIQUE INDEX idx_applications_active_student_session 
ON public.applications (applicant_uid, COALESCE(session_start_year, 0)) 
WHERE state NOT IN ('rejected', 'cancelled', 'expired');

-- 2. Update soft_block_student_with_seat_release
CREATE OR REPLACE FUNCTION public.soft_block_student_with_seat_release(
    p_student_uid      TEXT,
    p_bus_id           TEXT,
    p_shift            TEXT,
    p_release_seat     BOOLEAN,
    p_soft_blocked_at  TIMESTAMPTZ,
    p_seat_released_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_student         RECORD;
    v_normalized_shift TEXT;
    v_capacity_result  JSONB;
    v_student_updated  INTEGER;
BEGIN
    -- 1. Lock and validate student (FOR UPDATE prevents concurrent soft-blocks)
    SELECT uid, status, bus_id, shift
    INTO v_student
    FROM student_profiles
    WHERE uid = p_student_uid
    FOR UPDATE;

    IF v_student IS NULL THEN
        RETURN jsonb_build_object('success', false, 'status', 404, 'error', 'Student not found');
    END IF;

    IF v_student.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false, 'status', 409,
            'error', 'Student not active, already blocked or deleted',
            'current_status', v_student.status
        );
    END IF;

    -- 2. Normalise shift
    v_normalized_shift := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    IF v_normalized_shift NOT IN ('morning', 'evening') THEN
        v_normalized_shift := 'morning';
    END IF;

    -- 3. Atomic capacity decrement (if releasing seat)
    IF p_release_seat AND p_bus_id IS NOT NULL THEN
        SELECT * FROM bus_decrement_capacity(p_bus_id, v_normalized_shift) INTO v_capacity_result;
        IF v_capacity_result->>'error' IS NOT NULL THEN
            IF v_capacity_result->>'error' LIKE '%not found%' THEN
                -- Bus was removed or renamed; proceed with soft-block without blocking student lifecycle
                v_capacity_result := jsonb_build_object('warning', v_capacity_result->>'error');
            ELSE
                RETURN jsonb_build_object('success', false, 'error', v_capacity_result->>'error');
            END IF;
        END IF;
    END IF;

    -- 4. Update student to soft_blocked
    UPDATE student_profiles SET
        status          = 'soft_blocked',
        seat_released_at = CASE WHEN p_release_seat THEN p_seat_released_at ELSE seat_released_at END,
        updated_at      = NOW()
    WHERE uid = p_student_uid;
    GET DIAGNOSTICS v_student_updated = ROW_COUNT;

    IF v_student_updated <> 1 THEN
        -- Compensating rollback of capacity if student update failed
        IF p_release_seat AND p_bus_id IS NOT NULL AND v_capacity_result->>'warning' IS NULL THEN
            PERFORM bus_increment_capacity(p_bus_id, v_normalized_shift);
        END IF;
        RAISE EXCEPTION 'Expected 1 row updated for student uid=%, got %', p_student_uid, v_student_updated;
    END IF;

    RETURN jsonb_build_object(
        'success',       true,
        'student_uid',   p_student_uid,
        'status',        'soft_blocked',
        'seat_released', p_release_seat,
        'bus_id',        p_bus_id,
        'capacity',      v_capacity_result
    );
EXCEPTION WHEN OTHERS THEN
    -- Compensating rollback on any exception
    IF p_release_seat AND p_bus_id IS NOT NULL AND v_capacity_result->>'warning' IS NULL THEN
        PERFORM bus_increment_capacity(p_bus_id, v_normalized_shift);
    END IF;
    RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) FROM public;
REVOKE EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) FROM anon;
GRANT  EXECUTE ON FUNCTION public.soft_block_student_with_seat_release(TEXT,TEXT,TEXT,BOOLEAN,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
