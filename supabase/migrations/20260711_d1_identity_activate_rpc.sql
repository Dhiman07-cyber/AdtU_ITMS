-- =============================================================================
-- D1 Identity — identity_activate_student RPC
-- Version  : 1.0.0
-- Domain   : D1 Identity
--
-- PURPOSE
-- ─────────────────────────────────────────────────────────────────────────────
-- Called by D4 Application during fresh application approval.
-- Creates (or updates) both the users row and student_profiles row
-- for a newly-approved student.
--
-- DESIGN RULES
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. IDEMPOTENT: UPSERTs both tables — retrying is safe and produces
--    exactly the same final state.
-- 2. OWNS IDENTITY: Only this RPC creates users and student_profiles.
--    Application domain calls this via the public API; it never writes
--    to identity tables directly.
-- 3. ATOMIC: Both UPSERTs execute in a single transaction. If either
--    fails, the entire operation is rolled back.
-- 4. Returns JSONB: { success, already_activated, uid }
-- =============================================================================

CREATE OR REPLACE FUNCTION public.identity_activate_student(
  p_uid TEXT,
  p_email TEXT,
  p_full_name TEXT,
  p_student_data JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_already_existed BOOLEAN;
  v_existing_user RECORD;
BEGIN
  -- ── Guard: p_uid required ──────────────────────────────────────────────
  IF p_uid IS NULL OR p_uid = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'p_uid is required'
    );
  END IF;

  -- ── Check if user already exists ───────────────────────────────────────
  SELECT EXISTS(SELECT 1 FROM users WHERE uid = p_uid) INTO v_already_existed;

  -- ── UPSERT: users table ────────────────────────────────────────────────
  INSERT INTO users (uid, email, name, role, created_at, updated_at)
  VALUES (
    p_uid,
    COALESCE(p_email, ''),
    COALESCE(p_full_name, ''),
    'student',
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    -- Never downgrade role — only set if missing or non-student
    role = CASE
      WHEN users.role IS NULL OR users.role = '' THEN 'student'
      ELSE users.role
    END,
    updated_at = NOW();

  -- ── UPSERT: student_profiles table ─────────────────────────────────────
  INSERT INTO student_profiles (
    uid,
    email,
    full_name,
    phone,
    alt_phone,
    parent_name,
    parent_phone,
    faculty,
    department,
    gender,
    dob,
    enrollment_id,
    blood_group,
    address,
    profile_photo_url,
    bus_id,
    route_id,
    assigned_route_id,
    assigned_bus_id,
    stop_id,
    shift,
    status,
    session_start_year,
    session_end_year,
    semester,
    valid_until,
    approved_by,
    approved_at,
    created_at,
    updated_at
  )
  VALUES (
    p_uid,
    COALESCE(p_email, p_student_data->>'email'),
    COALESCE(p_full_name, p_student_data->>'fullName'),
    p_student_data->>'phone',
    p_student_data->>'altPhone',
    p_student_data->>'parentName',
    p_student_data->>'parentPhone',
    p_student_data->>'faculty',
    p_student_data->>'department',
    p_student_data->>'gender',
    p_student_data->>'dob',
    p_student_data->>'enrollmentId',
    p_student_data->>'bloodGroup',
    p_student_data->>'address',
    p_student_data->>'profilePhotoUrl',
    p_student_data->>'busId',
    p_student_data->>'routeId',
    p_student_data->>'routeId',      -- assigned_route_id = route_id at approval
    p_student_data->>'busId',        -- assigned_bus_id = bus_id at approval
    p_student_data->>'stopId',
    p_student_data->>'shift',
    'active',
    (p_student_data->>'sessionStartYear')::INTEGER,
    (p_student_data->>'sessionEndYear')::INTEGER,
    p_student_data->>'semester',
    CASE
      WHEN p_student_data->>'validUntil' IS NOT NULL
        THEN (p_student_data->>'validUntil')::TIMESTAMPTZ
      ELSE NULL
    END,
    p_student_data->>'approvedBy',
    NOW(),
    NOW(),
    NOW()
  )
  ON CONFLICT (uid) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, student_profiles.email),
    full_name = COALESCE(EXCLUDED.full_name, student_profiles.full_name),
    phone = COALESCE(EXCLUDED.phone, student_profiles.phone),
    alt_phone = COALESCE(EXCLUDED.alt_phone, student_profiles.alt_phone),
    parent_name = COALESCE(EXCLUDED.parent_name, student_profiles.parent_name),
    parent_phone = COALESCE(EXCLUDED.parent_phone, student_profiles.parent_phone),
    faculty = COALESCE(EXCLUDED.faculty, student_profiles.faculty),
    department = COALESCE(EXCLUDED.department, student_profiles.department),
    gender = COALESCE(EXCLUDED.gender, student_profiles.gender),
    dob = COALESCE(EXCLUDED.dob, student_profiles.dob),
    enrollment_id = COALESCE(EXCLUDED.enrollment_id, student_profiles.enrollment_id),
    blood_group = COALESCE(EXCLUDED.blood_group, student_profiles.blood_group),
    address = COALESCE(EXCLUDED.address, student_profiles.address),
    profile_photo_url = COALESCE(EXCLUDED.profile_photo_url, student_profiles.profile_photo_url),
    bus_id = COALESCE(EXCLUDED.bus_id, student_profiles.bus_id),
    route_id = COALESCE(EXCLUDED.route_id, student_profiles.route_id),
    assigned_route_id = COALESCE(EXCLUDED.assigned_route_id, student_profiles.assigned_route_id),
    assigned_bus_id = COALESCE(EXCLUDED.assigned_bus_id, student_profiles.assigned_bus_id),
    stop_id = COALESCE(EXCLUDED.stop_id, student_profiles.stop_id),
    shift = COALESCE(EXCLUDED.shift, student_profiles.shift),
    status = 'active',
    session_start_year = COALESCE(EXCLUDED.session_start_year, student_profiles.session_start_year),
    session_end_year = COALESCE(EXCLUDED.session_end_year, student_profiles.session_end_year),
    semester = COALESCE(EXCLUDED.semester, student_profiles.semester),
    valid_until = COALESCE(EXCLUDED.valid_until, student_profiles.valid_until),
    approved_by = COALESCE(EXCLUDED.approved_by, student_profiles.approved_by),
    approved_at = COALESCE(EXCLUDED.approved_at, student_profiles.approved_at),
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'already_activated', v_already_existed,
    'uid', p_uid
  );
END;
$$;
