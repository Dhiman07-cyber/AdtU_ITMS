-- =============================================================================
-- D7 Fleet — Atomic Assignment RPCs
-- Version  : 1.0.0
-- Domain   : D7 Fleet (Slice: driver + route assignment)
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- The existing assign-drivers and assign-routes API routes perform sequential
-- individual Supabase client calls with a TOCTOU race window between the
-- read-time optimistic concurrency check and the write.
--
-- This migration creates two PL/pgSQL RPCs that:
-- 1. Lock all affected rows with FOR UPDATE (prevents concurrent mutations)
-- 2. Verify optimistic concurrency under the lock
-- 3. Apply all updates atomically (BEGIN/COMMIT inside the stored function)
-- 4. Return JSONB with updated IDs or conflict errors
--
-- The TypeScript API routes will call these RPCs instead of sequential updates.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: assign_drivers_atomically
-- Atomically updates bus driver assignments + driver profile final state.
-- Replaces the Firestore transaction in net-assignment-service.ts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_drivers_atomically(
  p_bus_updates    JSONB,  -- [{bus_id TEXT, bus_label TEXT, prev_driver_uid TEXT, new_driver_uid TEXT}]
  p_driver_updates JSONB   -- [{driver_uid TEXT, new_bus_id TEXT, new_route_id TEXT, is_reserved BOOLEAN}]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_bus_rec     JSONB;
  v_driver_rec  JSONB;
  v_current     TEXT;
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
    UPDATE driver_profiles
    SET
      assigned_bus_id   = v_driver_rec->>'new_bus_id',
      bus_id            = v_driver_rec->>'new_bus_id',
      assigned_route_id = v_driver_rec->>'new_route_id',
      route_id          = v_driver_rec->>'new_route_id',
      is_reserved       = (v_driver_rec->>'is_reserved')::boolean,
      status            = CASE
                            WHEN (v_driver_rec->>'is_reserved')::boolean THEN 'reserved'
                            ELSE 'active'
                          END,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: assign_routes_atomically
-- Atomically updates bus route assignments.
-- Replaces the Firestore transaction in net-route-assignment-service.ts.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION assign_routes_atomically(
  p_bus_updates JSONB  -- [{bus_id TEXT, bus_label TEXT, prev_route_id TEXT, new_route_id TEXT, new_route_name TEXT}]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_bus_rec      JSONB;
  v_current      TEXT;
  v_updated_buses TEXT[] := '{}';
BEGIN
  -- Phase 1: Lock all buses and validate optimistic concurrency
  FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates)
  LOOP
    SELECT route_id INTO v_current
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

    IF v_current IS DISTINCT FROM v_bus_rec->>'prev_route_id' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Conflict: ' || COALESCE(v_bus_rec->>'bus_label', v_bus_rec->>'bus_id')
                 || ' is now on route "' || COALESCE(v_current, 'none')
                 || '" (expected: "' || COALESCE(v_bus_rec->>'prev_route_id', 'none') || '")',
        'status', 409
      );
    END IF;
  END LOOP;

  -- Phase 2: Apply all bus updates
  FOR v_bus_rec IN SELECT * FROM jsonb_array_elements(p_bus_updates)
  LOOP
    UPDATE buses
    SET route_id   = v_bus_rec->>'new_route_id',
        route_name = v_bus_rec->>'new_route_name',
        updated_at = NOW()
    WHERE id = v_bus_rec->>'bus_id';

    v_updated_buses := array_append(v_updated_buses, v_bus_rec->>'bus_id');
  END LOOP;

  RETURN jsonb_build_object(
    'success',       true,
    'updatedBuses',  to_jsonb(v_updated_buses)
  );
END;
$$;
