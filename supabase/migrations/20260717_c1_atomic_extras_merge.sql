-- =============================================================================
-- C1 Critical Fix — Atomic JSONB Extras Merge
-- Version  : 1.0.0
-- Category : Transaction Safety (Bucket 6)
-- Priority : CRITICAL
--
-- PROBLEM
-- ─────────────────────────────────────────────────────────────────────────────
-- Multiple repositories use a read-before-write pattern to merge JSONB extras:
--   1. Read current extras
--   2. Merge in JavaScript
--   3. Write back
--
-- This creates a TOCTOU (Time-of-Check-Time-of-Use) race condition.
-- Between steps 1 and 3, another process can modify extras → lost updates.
--
-- AFFECTED TABLES
-- ─────────────────────────────────────────────────────────────────────────────
-- - users              (merge_user_extras RPC exists but not used everywhere)
-- - student_profiles   (no RPC, unsafe read-before-write)
-- - driver_profiles    (no RPC, unsafe read-before-write)
-- - moderator_profiles (no RPC, unsafe read-before-write)
-- - admin_profiles     (no RPC, unsafe read-before-write)
-- - buses              (no RPC, unsafe read-before-write)
--
-- SOLUTION
-- ─────────────────────────────────────────────────────────────────────────────
-- Create atomic merge RPCs for all affected tables using PostgreSQL's JSONB
-- merge operator (||). This ensures the read, merge, and write happen atomically
-- within a single SQL statement.
--
-- VERIFICATION
-- ─────────────────────────────────────────────────────────────────────────────
-- After migration, repository code will be updated to use these RPCs instead of
-- the unsafe read-before-write pattern.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: merge_student_extras
-- Atomically merges JSONB data into student_profiles.extras column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_student_extras(
  p_uid TEXT,
  p_extras JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE student_profiles
  SET extras = COALESCE(extras, '{}'::jsonb) || p_extras,
      updated_at = NOW()
  WHERE uid = p_uid;
END;
$$;

COMMENT ON FUNCTION merge_student_extras IS
  'Atomically merges JSONB data into student_profiles.extras. Replaces unsafe read-before-write pattern.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: merge_driver_extras
-- Atomically merges JSONB data into driver_profiles.extras column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_driver_extras(
  p_uid TEXT,
  p_extras JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE driver_profiles
  SET extras = COALESCE(extras, '{}'::jsonb) || p_extras,
      updated_at = NOW()
  WHERE uid = p_uid;
END;
$$;

COMMENT ON FUNCTION merge_driver_extras IS
  'Atomically merges JSONB data into driver_profiles.extras. Replaces unsafe read-before-write pattern.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: merge_moderator_extras
-- Atomically merges JSONB data into moderator_profiles.extras column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_moderator_extras(
  p_uid TEXT,
  p_extras JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE moderator_profiles
  SET extras = COALESCE(extras, '{}'::jsonb) || p_extras,
      updated_at = NOW()
  WHERE uid = p_uid;
END;
$$;

COMMENT ON FUNCTION merge_moderator_extras IS
  'Atomically merges JSONB data into moderator_profiles.extras. Replaces unsafe read-before-write pattern.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: merge_admin_extras
-- Atomically merges JSONB data into admin_profiles.extras column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_admin_extras(
  p_uid TEXT,
  p_extras JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE admin_profiles
  SET extras = COALESCE(extras, '{}'::jsonb) || p_extras,
      updated_at = NOW()
  WHERE uid = p_uid;
END;
$$;

COMMENT ON FUNCTION merge_admin_extras IS
  'Atomically merges JSONB data into admin_profiles.extras. Replaces unsafe read-before-write pattern.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: merge_bus_extras
-- Atomically merges JSONB data into buses.extras column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_bus_extras(
  p_bus_id TEXT,
  p_extras JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE buses
  SET extras = COALESCE(extras, '{}'::jsonb) || p_extras,
      updated_at = NOW()
  WHERE id = p_bus_id;
END;
$$;

COMMENT ON FUNCTION merge_bus_extras IS
  'Atomically merges JSONB data into buses.extras. Replaces unsafe read-before-write pattern.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: merge_unauth_user_extras
-- Atomically merges JSONB data into unauth_users.extras column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_unauth_user_extras(
  p_uid TEXT,
  p_extras JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE unauth_users
  SET extras = COALESCE(extras, '{}'::jsonb) || p_extras,
      updated_at = NOW()
  WHERE uid = p_uid;
END;
$$;

COMMENT ON FUNCTION merge_unauth_user_extras IS
  'Atomically merges JSONB data into unauth_users.extras. Replaces unsafe read-before-write pattern.';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERY
-- ─────────────────────────────────────────────────────────────────────────────
-- Run after migration to verify all RPCs exist:
--
-- SELECT proname, prosrc
-- FROM pg_proc
-- WHERE proname LIKE 'merge_%_extras'
-- ORDER BY proname;
