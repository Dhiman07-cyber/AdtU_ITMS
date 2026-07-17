-- =============================================================================
-- C3 Critical Fix — Driver Status Constraint + assign_drivers_atomically RPC
-- Version  : 1.0.0
-- Category : Constraint Correctness + RPC Fix (Bucket 3)
-- Priority : CRITICAL (P0)
--
-- PROBLEM
-- ─────────────────────────────────────────────────────────────────────────────
-- driver_profiles.status CHECK (status IN ('active', 'inactive', 'suspended'))
-- does not include 'reserved'.
--
-- assign_drivers_atomically RPC (20260716_d7_assignment_rpcs.sql, line 88-91):
--   status = CASE
--              WHEN (v_driver_rec->>'is_reserved')::boolean THEN 'reserved'
--              ELSE 'active'
--            END
--
-- This writes 'reserved' to status, which violates the CHECK constraint and
-- throws a runtime error on every driver assignment where is_reserved = true.
--
-- EVIDENCE
-- ─────────────────────────────────────────────────────────────────────────────
-- supabase/migrations/20260716_d7_assignment_rpcs.sql:88-91
--   — writes 'reserved' into driver_profiles.status
-- supabase/migrations/20260707_d1c_identity_driver_profiles.sql:40
--   — CHECK (status IN ('active', 'inactive', 'suspended'))  (no 'reserved')
-- src/lib/services/assignment-types.ts:80
--   — reads driver.status === "reserved" → constraint confirms the intent
-- src/app/api/admin/set-driver-reserved/route.ts:80
--   — newStatus: 'Reserved' (UI label)
--
-- SOLUTION
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Expand the status CHECK to include 'reserved'.
-- 2. Replace the RPC (CREATE OR REPLACE) so it writes the now-valid value.
--
-- The is_reserved BOOLEAN column is retained as the authoritative flag.
-- status = 'reserved' is now kept in sync by the RPC.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Drop old CHECK constraint and replace with expanded one
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.driver_profiles
  DROP CONSTRAINT IF EXISTS driver_profiles_status_check;

ALTER TABLE public.driver_profiles
  ADD CONSTRAINT driver_profiles_status_check
    CHECK (status IN ('active', 'inactive', 'suspended', 'reserved'));

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Backfill existing rows where is_reserved = TRUE but status is wrong
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.driver_profiles
SET status = 'reserved'
WHERE is_reserved = TRUE
  AND status NOT IN ('reserved', 'inactive', 'suspended');

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Replace assign_drivers_atomically with corrected status logic
--         (status = 'reserved' is now a valid enum value)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_drivers_atomically(
  p_bus_updates    JSONB,  -- [{bus_id TEXT, bus_label TEXT, prev_driver_uid TEXT, new_driver_uid TEXT}]
  p_driver_updates JSONB   -- [{driver_uid TEXT, new_bus_id TEXT, new_route_id TEXT, is_reserved BOOLEAN}]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_bus_rec        JSONB;
  v_driver_rec     JSONB;
  v_current        TEXT;
  v_is_reserved    BOOLEAN;
  v_updated_buses  TEXT[] := '{}';
  v_updated_drivers TEXT[] := '{}';
BEGIN
  -- Phase 1: Lock all buses and validate optimistic concurrency
  FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates)
  LOOP
    SELECT driver_uid INTO v_current
    FROM buses
    WHERE id = v_bus_rec->>'bus_id'
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Bus ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id') || ' has been deleted',
        'status', 409
      );
    END IF;

    IF v_current IS DISTINCT FROM v_bus_rec->>'prev_driver_uid' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Conflict: ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id')
                 || ' is now assigned to ' || COALESCE(v_current, 'no driver')
                 || ' (expected: ' || COALESCE(v_bus_rec->>'prev_driver_uid', 'no driver') || ')',
        'status', 409
      );
    END IF;
  END LOOP;

  -- Phase 2: Apply all bus updates
  FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates)
  LOOP
    UPDATE buses
    SET driver_uid = v_bus_rec->>'new_driver_uid',
        updated_at = NOW()
    WHERE id = v_bus_rec->>'bus_id';

    v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
  END LOOP;

  -- Phase 3: Apply all driver profile updates
  FOR v_driver_rec IN SELECT * FROM jsonb_array_elements(p_driver_updates)
  LOOP
    v_is_reserved := (v_driver_rec->>'is_reserved')::boolean;

    UPDATE driver_profiles
    SET
      assigned_bus_id   = v_driver_rec->>'new_bus_id',
      bus_id            = v_driver_rec->>'new_bus_id',
      assigned_route_id = v_driver_rec->>'new_route_id',
      route_id          = v_driver_rec->>'new_route_id',
      is_reserved       = v_is_reserved,
      -- ponytail: 'reserved' is now a valid CHECK value (see Step 1 above)
      status            = CASE WHEN v_is_reserved THEN 'reserved' ELSE 'active' END,
      updated_at        = NOW()
    WHERE uid = v_driver_rec->>'driver_uid';

    v_updated_drivers := array_append(v_updated_drivers, v_driver_rec->>'driver_uid');
  END LOOP;

  RETURN jsonb_build_object(
    'success',        true,
    'updatedBuses',   to_jsonb(v_updated_buses),
    'updatedDrivers', to_jsonb(v_updated_drivers)
  );
END;
$$;
