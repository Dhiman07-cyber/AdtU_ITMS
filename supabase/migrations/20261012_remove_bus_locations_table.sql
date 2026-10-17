-- =============================================================================
-- MIGRATION: 20261012_remove_bus_locations_table.sql
-- DESCRIPTION: Permanent Removal of Ephemeral bus_locations Table & end_trip_atomically Hardening
--
-- RATIONALE:
-- In ADTU ITMS, real-time vehicle telemetry is ephemeral state processed
-- strictly through the atomic Redis guard and broadcast sub-second via the WS1
-- WebSocket cluster. The historical `bus_locations` PostgreSQL table has zero
-- active writers and is no longer part of the telemetry architecture.
-- =============================================================================

-- 1. Remove bus_locations table from realtime publication if registered
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'bus_locations'
    ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.bus_locations;
    END IF;
END $$;

-- 2. Drop RLS policies on bus_locations
DROP POLICY IF EXISTS "bus_locations_select_anon" ON public.bus_locations;
DROP POLICY IF EXISTS "bus_locations_insert_service" ON public.bus_locations;
DROP POLICY IF EXISTS "bus_locations_update_service" ON public.bus_locations;
DROP POLICY IF EXISTS "bus_locations_delete_service" ON public.bus_locations;

-- 3. Drop indexes on bus_locations
DROP INDEX IF EXISTS public.idx_bus_locations_bus_id;
DROP INDEX IF EXISTS public.idx_bus_locations_trip_id;
DROP INDEX IF EXISTS public.idx_bus_locations_updated_at;

-- 4. Update end_trip_atomically RPC to remove reference to bus_locations
CREATE OR REPLACE FUNCTION public.end_trip_atomically(
  p_trip_id TEXT,
  p_bus_id  TEXT,
  p_driver_id TEXT,
  p_min_duration_seconds INTEGER DEFAULT 0
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_dur_sec INTEGER;
  v_status  TEXT := 'completed';
  v_reason  TEXT := 'completed';
BEGIN
  SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
    INTO v_trip
    FROM active_trips
   WHERE trip_id    = p_trip_id::uuid
     AND bus_id     = p_bus_id
     AND driver_id  = p_driver_id
     AND status     = 'active'
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'alreadyEnded', true);
  END IF;

  v_dur_sec := EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER;

  -- Remove the active lock atomically within the single transaction
  DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;

  -- Represent short trips as terminated_early / short_trip rather than deleting historical fact
  IF p_min_duration_seconds > 0 AND v_dur_sec < p_min_duration_seconds THEN
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
  ON CONFLICT (trip_id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'tripId', p_trip_id,
    'alreadyEnded', false,
    'status', v_status,
    'ended_reason', v_reason
  );
END;
$$;

-- 5. Drop the table permanently
DROP TABLE IF EXISTS public.bus_locations CASCADE;
