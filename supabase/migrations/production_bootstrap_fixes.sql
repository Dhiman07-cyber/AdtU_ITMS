-- =====================================================
-- PRODUCTION BOOTSTRAP FIXES
-- =====================================================
-- Purpose:
--   The base migration (Firestore_to_supabase_migration.sql) creates users,
--   student_profiles, driver_profiles, buses, routes, applications,
--   notifications, fcm_tokens, active_trips, processed_operations and the
--   trip/capacity RPCs. Several runtime tables + RPCs referenced by the app
--   only ever existed in COMPLETE_SCHEMA.sql (or nowhere) and were therefore
--   MISSING from a clean production deploy:
--
--     * waiting_flags          -> read/written by waiting-flag routes, trip
--                                  orchestration (raised flags deleted on trip
--                                  end) and cleanup-stale-locks cron
--     * payments               -> payment ledger (student payments API)
--     * driver_trip_history    -> written by end_trip_atomically
--     * device_sessions        -> driver device-session route + cleanup-stale-locks
--     * bus_locations          -> NOT CREATED ANYWHERE; GPS persistence +
--                                  student trip-status fallback read it
--     * realtime_driver_locations -> intentionally NOT created (WS bridge is
--                                  the live source; trip-status uses bus_locations)
--     * end_trip_atomically    -> called by trip-orchestrator endTrip
--     * cleanup_old_trip_history -> called by Vercel cron
--
--   Also overrides bus_increment_capacity with a capacity guard so the
--   admission RPC can never overbook a bus (previous version incremented
--   unconditionally).
--
--   Safe to run on both a clean DB (after Firestore_to_supabase_migration.sql)
--   and the existing production DB: every statement is IF NOT EXISTS /
--   DROP IF EXISTS / CREATE OR REPLACE. Append-only; never delete from
--   payments.
-- =====================================================

-- Common updated_at helper (already defined by base migration; idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 1. WAITING FLAGS (was only in COMPLETE_SCHEMA.sql)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.waiting_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_uid TEXT NOT NULL,
  student_name TEXT NOT NULL,
  bus_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  stop_name TEXT,
  stop_lat DOUBLE PRECISION,
  stop_lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'raised' CHECK (status IN ('raised', 'acknowledged', 'waiting', 'boarded', 'expired', 'cancelled', 'removed')),
  message TEXT,
  trip_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  ack_by_driver_uid TEXT
);

CREATE INDEX IF NOT EXISTS idx_waiting_flags_student_uid ON public.waiting_flags(student_uid);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_bus_id ON public.waiting_flags(bus_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_route_id ON public.waiting_flags(route_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_status ON public.waiting_flags(status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_trip ON public.waiting_flags(trip_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_active ON public.waiting_flags(bus_id, status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_student_active ON public.waiting_flags(student_uid, status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_bus_student ON public.waiting_flags(bus_id, student_uid);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_active_raised ON public.waiting_flags(bus_id, student_uid) WHERE status = 'raised';
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_flags_one_active ON public.waiting_flags(student_uid, bus_id) WHERE status IN ('raised', 'acknowledged', 'waiting');

ALTER TABLE public.waiting_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waiting_flags_select_all" ON public.waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_select_restricted" ON public.waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_select_anon" ON public.waiting_flags;
CREATE POLICY "waiting_flags_select_anon" ON public.waiting_flags
  FOR SELECT TO anon, authenticated
  USING (
    status = 'raised'
    OR status = 'acknowledged'
    OR student_uid = auth.uid()::text
  );

DROP POLICY IF EXISTS "waiting_flags_insert_service" ON public.waiting_flags;
DROP POLICY IF EXISTS "Students can create their own waiting flags" ON public.waiting_flags;
CREATE POLICY "Students can create their own waiting flags"
ON public.waiting_flags FOR INSERT TO authenticated
WITH CHECK (student_uid = auth.uid()::text);

DROP POLICY IF EXISTS "waiting_flags_update_service" ON public.waiting_flags;
DROP POLICY IF EXISTS "Students can update their own waiting flags" ON public.waiting_flags;
DROP POLICY IF EXISTS "Drivers can update waiting flags for their bus" ON public.waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_update_authenticated" ON public.waiting_flags;
CREATE POLICY "waiting_flags_update_authenticated"
ON public.waiting_flags FOR UPDATE TO authenticated
USING (
  student_uid = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM active_trips
    WHERE active_trips.driver_id = auth.uid()::text
    AND active_trips.bus_id = waiting_flags.bus_id
    AND active_trips.status = 'active'
  )
);

DROP POLICY IF EXISTS "waiting_flags_delete_service" ON public.waiting_flags;
DROP POLICY IF EXISTS "Students can delete their own waiting flags" ON public.waiting_flags;
DROP POLICY IF EXISTS "Drivers can delete waiting flags for their bus" ON public.waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_delete_authenticated" ON public.waiting_flags;
CREATE POLICY "waiting_flags_delete_authenticated"
ON public.waiting_flags FOR DELETE TO authenticated
USING (
  student_uid = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM active_trips
    WHERE active_trips.driver_id = auth.uid()::text
    AND active_trips.bus_id = waiting_flags.bus_id
    AND active_trips.status = 'active'
  )
);

GRANT SELECT ON public.waiting_flags TO anon, authenticated;

-- =====================================================
-- 2. PAYMENTS (IMMUTABLE FINANCIAL LEDGER) (was only in COMPLETE_SCHEMA.sql)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Payment Identity
  payment_id TEXT NOT NULL UNIQUE,

  -- Student Information
  -- student_id and student_name store ENCRYPTED data (AES-256-GCM base64url)
  -- The decryptData() function handles both encrypted and plain-text (legacy) values
  student_id TEXT,      -- Enrollment ID (encrypted for new records, plain for legacy)
  student_uid TEXT,     -- Firebase UID (NOT encrypted - needed for RLS filtering)
  student_name TEXT,    -- Student name (encrypted for new records, plain for legacy)

  -- Payment Details
  amount NUMERIC(12,2),
  currency TEXT DEFAULT 'INR',
  method TEXT,
  status TEXT DEFAULT 'Pending',

  -- Session Information
  session_start_year INTEGER,
  session_end_year INTEGER,
  duration_years INTEGER,
  valid_until TIMESTAMPTZ,

  -- Transaction Details
  transaction_date TIMESTAMPTZ,
  offline_transaction_id TEXT,  -- Can store encrypted or plain text
  razorpay_payment_id TEXT,     -- NOT encrypted - needed for Razorpay reconciliation
  razorpay_order_id TEXT,       -- NOT encrypted - needed for API lookups

  -- Approval Info (status updates only, no destructive changes)
  approved_by JSONB,
  approved_at TIMESTAMPTZ,

  -- Security Metadata
  document_signature TEXT,      -- RSA-2048 digital signature for tamper-proof receipts

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT chk_payment_method CHECK (method IN ('Online', 'Offline') OR method IS NULL),
  CONSTRAINT payments_status_check CHECK (status IN ('Pending', 'Completed', 'Rejected') OR status IS NULL),
  CONSTRAINT chk_payment_amount_positive CHECK (amount IS NULL OR amount > 0),
  CONSTRAINT chk_payment_session_year CHECK (session_start_year IS NULL OR (session_start_year >= 2020 AND session_start_year <= 2050))
);

DROP INDEX IF EXISTS public.idx_payments_signature;
CREATE INDEX IF NOT EXISTS idx_payments_student_uid ON public.payments (student_uid);
CREATE INDEX IF NOT EXISTS idx_payments_student_id ON public.payments (student_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments (transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);
CREATE INDEX IF NOT EXISTS idx_payments_method ON public.payments (method);
CREATE INDEX IF NOT EXISTS idx_payments_year ON public.payments (session_start_year, session_end_year);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_id ON public.payments(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_id_unique ON public.payments(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_date_status ON public.payments(transaction_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_payments_student_uid_status ON public.payments (student_uid, status);
CREATE INDEX IF NOT EXISTS idx_payments_status_method ON public.payments (status, method);
CREATE INDEX IF NOT EXISTS idx_payments_pending_offline ON public.payments (status, method, created_at)
  WHERE status = 'Pending' AND method = 'Offline';
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_completed_per_student_session
  ON public.payments (student_uid, session_start_year, session_end_year)
  WHERE status = 'Completed'
    AND student_uid IS NOT NULL
    AND session_start_year IS NOT NULL
    AND session_end_year IS NOT NULL;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_select_all" ON public.payments;
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments
  FOR SELECT TO authenticated
  USING (student_uid = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "payments_insert_service" ON public.payments;
CREATE POLICY "payments_insert_service" ON public.payments
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "payments_update_service" ON public.payments;
CREATE POLICY "payments_update_service" ON public.payments
  FOR UPDATE TO service_role USING (true);

-- PAYMENTS ARE IMMUTABLE - NO DELETIONS ALLOWED (not even service_role)
DROP POLICY IF EXISTS "payments_delete_service" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_blocked" ON public.payments;
DROP POLICY IF EXISTS "payments_no_delete" ON public.payments;
CREATE POLICY "payments_no_delete" ON public.payments
  FOR DELETE TO PUBLIC USING (false);

GRANT SELECT ON public.payments TO authenticated;

-- =====================================================
-- 3. DRIVER TRIP HISTORY (was only in COMPLETE_SCHEMA.sql)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.driver_trip_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL,
  bus_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  shift TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  ended_reason TEXT NOT NULL DEFAULT 'completed' CHECK (ended_reason IN ('completed', 'completed_stale', 'cancelled', 'force_ended')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_trip_history_driver ON public.driver_trip_history(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_trip_history_bus ON public.driver_trip_history(bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_trip_history_end_time ON public.driver_trip_history(end_time DESC);
CREATE INDEX IF NOT EXISTS idx_driver_trip_history_created ON public.driver_trip_history(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_trip_history_trip_id ON public.driver_trip_history(trip_id);

ALTER TABLE public.driver_trip_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "driver_trip_history_select_authenticated" ON public.driver_trip_history;
CREATE POLICY "driver_trip_history_select_authenticated" ON public.driver_trip_history
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "driver_trip_history_insert_service" ON public.driver_trip_history;
CREATE POLICY "driver_trip_history_insert_service" ON public.driver_trip_history
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "driver_trip_history_delete_service" ON public.driver_trip_history;
CREATE POLICY "driver_trip_history_delete_service" ON public.driver_trip_history
  FOR DELETE TO service_role USING (true);

GRANT SELECT ON public.driver_trip_history TO authenticated;

-- =====================================================
-- 4. DEVICE SESSIONS (was only in COMPLETE_SCHEMA.sql)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.device_sessions (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_id ON public.device_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_device_sessions_last_active ON public.device_sessions(last_active_at);

-- Function to cleanup stale device sessions
CREATE OR REPLACE FUNCTION public.cleanup_stale_device_sessions(p_timeout_seconds INTEGER DEFAULT 60)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  DELETE FROM public.device_sessions
  WHERE last_active_at < NOW() - (p_timeout_seconds || ' seconds')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

-- Systematic cleanup: Drop ALL existing policies on device_sessions
-- regardless of name to remove lingering "always true" policies.
DO $$
DECLARE
    policy_record RECORD;
BEGIN
    FOR policy_record IN
        SELECT policyname
        FROM pg_policies
        WHERE tablename = 'device_sessions' AND schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.device_sessions', policy_record.policyname);
    END LOOP;
END $$;

-- Users can only manage their own device sessions
CREATE POLICY "device_sessions_select_own" ON public.device_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text OR auth.role() = 'service_role');

CREATE POLICY "device_sessions_insert_own" ON public.device_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text OR auth.role() = 'service_role');

CREATE POLICY "device_sessions_update_own" ON public.device_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text OR auth.role() = 'service_role');

CREATE POLICY "device_sessions_delete_own" ON public.device_sessions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text OR auth.role() = 'service_role');

-- =====================================================
-- 5. BUS LOCATIONS (NEW - never created by any previous migration)
-- =====================================================
-- Real-time GPS position of buses. Written by /api/location/update (throttled
-- to one write per bus per 30s) and read by the student trip-status route as
-- a DB fallback when the WebSocket bridge has no cached position (e.g. right
-- after a WS server restart). Cleared when the trip ends so a stale position
-- is never shown for the next trip.

CREATE TABLE IF NOT EXISTS public.bus_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id TEXT NOT NULL UNIQUE,
  trip_id UUID,
  driver_id TEXT,
  route_id TEXT,
  shift TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'gps',
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bus_locations_trip_id ON public.bus_locations(trip_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_updated_at ON public.bus_locations(updated_at DESC);

DROP TRIGGER IF EXISTS bus_locations_updated_at ON public.bus_locations;
CREATE TRIGGER bus_locations_updated_at
  BEFORE UPDATE ON public.bus_locations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.bus_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bus_locations_select_anon" ON public.bus_locations;
CREATE POLICY "bus_locations_select_anon" ON public.bus_locations
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "bus_locations_insert_service" ON public.bus_locations;
CREATE POLICY "bus_locations_insert_service" ON public.bus_locations
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "bus_locations_update_service" ON public.bus_locations;
CREATE POLICY "bus_locations_update_service" ON public.bus_locations
  FOR UPDATE TO service_role USING (true);

DROP POLICY IF EXISTS "bus_locations_delete_service" ON public.bus_locations;
CREATE POLICY "bus_locations_delete_service" ON public.bus_locations
  FOR DELETE TO service_role USING (true);

GRANT SELECT ON public.bus_locations TO anon, authenticated;

-- =====================================================
-- 6. END TRIP ATOMICALLY (was only in COMPLETE_SCHEMA.sql)
-- =====================================================

CREATE OR REPLACE FUNCTION public.end_trip_atomically(
  p_trip_id TEXT,
  p_bus_id  TEXT,
  p_driver_id TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_dur_sec INTEGER;
BEGIN
  -- Lock the row to prevent concurrent end-trip races
  SELECT trip_id, bus_id, driver_id, route_id, shift, start_time
    INTO v_trip
    FROM active_trips
   WHERE trip_id    = p_trip_id::uuid
     AND bus_id     = p_bus_id
     AND driver_id  = p_driver_id
     AND status     = 'active'
     FOR UPDATE;

  IF NOT FOUND THEN
    -- Trip already ended or never existed - idempotent success
    RETURN jsonb_build_object('success', true, 'alreadyEnded', true);
  END IF;

  v_dur_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_trip.start_time))::INTEGER);

  -- Insert history (ON CONFLICT (trip_id) DO NOTHING makes this safe on duplicate calls)
  INSERT INTO driver_trip_history (
    trip_id, bus_id, driver_id, route_id, shift,
    status, ended_reason, start_time, end_time, duration_seconds
  ) VALUES (
    v_trip.trip_id, v_trip.bus_id, v_trip.driver_id, v_trip.route_id, v_trip.shift,
    'completed', 'completed', v_trip.start_time, v_now, v_dur_sec
  )
  ON CONFLICT (trip_id) DO NOTHING;

  -- Remove the active lock
  DELETE FROM active_trips WHERE trip_id = v_trip.trip_id;

  RETURN jsonb_build_object('success', true, 'tripId', p_trip_id, 'alreadyEnded', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_trip_atomically(TEXT, TEXT, TEXT) TO service_role;

-- =====================================================
-- 7. CLEANUP OLD TRIP HISTORY (was only in COMPLETE_SCHEMA.sql)
-- =====================================================

CREATE OR REPLACE FUNCTION public.cleanup_old_trip_history()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  DELETE FROM public.driver_trip_history
  WHERE end_time < NOW() - INTERVAL '1 year';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.cleanup_old_trip_history() TO service_role;

-- =====================================================
-- 8. CAPACITY-GUARDED bus_increment_capacity (override)
-- =====================================================
-- The version in Firestore_to_supabase_migration.sql increments loads without
-- checking capacity, so admission through this RPC could overbook a bus.
-- This override re-checks capacity under the same FOR UPDATE lock held by the
-- row select and refuses (returns {error}) when the target shift is full.

CREATE OR REPLACE FUNCTION public.bus_increment_capacity(p_bus_id TEXT, p_shift TEXT DEFAULT 'Morning')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
    v_bus RECORD; v_new_morning INTEGER; v_new_evening INTEGER;
    v_capacity INTEGER; v_target_load INTEGER;
BEGIN
    IF v_normalized NOT IN ('morning', 'evening') THEN
        RETURN jsonb_build_object('error', 'Invalid student shift: ' || COALESCE(p_shift, 'NULL') || ' (must be Morning or Evening)');
    END IF;
    SELECT id, capacity, morning_load, evening_load INTO v_bus FROM buses WHERE id = p_bus_id OR bus_number = p_bus_id FOR UPDATE LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found'); END IF;

    v_target_load := CASE WHEN v_normalized = 'morning' THEN v_bus.morning_load ELSE v_bus.evening_load END;
    v_capacity := COALESCE(v_bus.capacity, 0);
    IF v_target_load >= v_capacity THEN
        RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' is at full capacity for ' || v_normalized || ' shift (' || v_target_load || '/' || v_capacity || ')');
    END IF;

    v_new_morning := v_bus.morning_load + CASE WHEN v_normalized = 'morning' THEN 1 ELSE 0 END;
    v_new_evening := v_bus.evening_load + CASE WHEN v_normalized = 'evening' THEN 1 ELSE 0 END;
    UPDATE buses SET morning_load = v_new_morning, evening_load = v_new_evening, current_members = v_new_morning + v_new_evening, updated_at = NOW()
    WHERE id = v_bus.id;
    RETURN jsonb_build_object('busId', v_bus.id, 'capacity', v_bus.capacity,
        'morningLoad', v_new_morning, 'eveningLoad', v_new_evening, 'currentMembers', v_new_morning + v_new_evening,
        'oldShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_bus.evening_load ELSE v_bus.morning_load END,
        'newShiftLoad', CASE WHEN v_normalized = 'evening' THEN v_new_evening ELSE v_new_morning END,
        'shift', p_shift, 'success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bus_increment_capacity(TEXT, TEXT) TO service_role;
