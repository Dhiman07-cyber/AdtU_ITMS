-- =====================================================
-- SECTION 1: CORE TABLES
-- =====================================================

-- waiting_flags table
CREATE TABLE IF NOT EXISTS waiting_flags (
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

CREATE INDEX IF NOT EXISTS idx_waiting_flags_student_uid ON waiting_flags(student_uid);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_bus_id ON waiting_flags(bus_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_route_id ON waiting_flags(route_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_status ON waiting_flags(status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_trip ON waiting_flags(trip_id);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_active ON waiting_flags(bus_id, status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_student_active ON waiting_flags(student_uid, status);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_bus_student ON waiting_flags(bus_id, student_uid);
CREATE INDEX IF NOT EXISTS idx_waiting_flags_active_raised ON waiting_flags(bus_id, student_uid) WHERE status = 'raised';
CREATE UNIQUE INDEX IF NOT EXISTS idx_waiting_flags_one_active ON waiting_flags(student_uid, bus_id) WHERE status IN ('raised', 'acknowledged', 'waiting');


-- =====================================================
-- SECTION 2: CANONICAL DRIVER-BUS ASSIGNMENTS (DECOMMISSIONED)
-- Driver↔bus dynamic resolution is handled via physical cockpit QR code scan (/api/driver/resolve-bus-qr),
-- trip exclusivity is enforced via active_trips locks, and operational history is stored in driver_trip_history.
-- =====================================================

-- =====================================================
-- SECTION 3: REASSIGNMENT LOGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.reassignment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Operation Identity
  operation_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  
  -- Actor Information
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  
  -- Status & Timestamps
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending',
  
  -- Change Details
  summary TEXT,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB DEFAULT '{}'::jsonb,
  
  -- Rollback Reference
  rollback_of TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT chk_reassignment_type CHECK (type IN ('driver_reassignment', 'student_reassignment', 'route_reassignment', 'rollback', 'unknown')),
  CONSTRAINT chk_reassignment_status CHECK (status IN ('pending', 'committed', 'rolled_back', 'failed', 'no-op'))
);

CREATE INDEX IF NOT EXISTS idx_reassignment_logs_type_ts ON public.reassignment_logs (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reassignment_logs_actor ON public.reassignment_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_reassignment_logs_status ON public.reassignment_logs (status);
CREATE INDEX IF NOT EXISTS idx_reassignment_logs_logged_at ON public.reassignment_logs (logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_reassignment_logs_rollback ON public.reassignment_logs (rollback_of) WHERE rollback_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reassignment_logs_changes ON public.reassignment_logs USING GIN (changes);

-- =====================================================
-- SECTION 4: PAYMENTS TABLE (IMMUTABLE FINANCIAL LEDGER)
-- =====================================================
--
-- ⚠️ CRITICAL AUDIT SAFETY RULES:
-- 1. This table is the SINGLE SOURCE OF TRUTH for all payment records.
-- 2. NEVER delete rows from this table.
-- 3. NEVER truncate or reset this table.
-- 4. NEVER migrate payment data to another system (e.g., Firestore).
-- 5. Payments are PERMANENT financial records for 5-10+ years.
-- 6. This table is APPEND-ONLY. Status changes are allowed (Pending → Completed).
-- 7. For reporting, use SELECT queries only. No destructive operations.
--
-- See README for architecture documentation.
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

-- Ensure columns exist (for existing tables)
DO $$
BEGIN
    -- payments table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'document_signature') THEN
        ALTER TABLE public.payments ADD COLUMN document_signature TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'student_name') THEN
        ALTER TABLE public.payments ADD COLUMN student_name TEXT;
    END IF;

    -- active_trips table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'active_trips' AND column_name = 'end_time') THEN
        ALTER TABLE public.active_trips ADD COLUMN end_time TIMESTAMPTZ;
    END IF;

    -- driver_profiles table
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_profiles' AND column_name = 'bus_id') THEN
        ALTER TABLE public.driver_profiles DROP COLUMN bus_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_profiles' AND column_name = 'route_id') THEN
        ALTER TABLE public.driver_profiles DROP COLUMN route_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_profiles' AND column_name = 'shift') THEN
        ALTER TABLE public.driver_profiles DROP COLUMN shift;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_profiles' AND column_name = 'trip_active') THEN
        ALTER TABLE public.driver_profiles DROP COLUMN trip_active;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_profiles' AND column_name = 'active_trip_id') THEN
        ALTER TABLE public.driver_profiles DROP COLUMN active_trip_id;
    END IF;

    -- buses table
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buses' AND column_name = 'driver_uid') THEN
        ALTER TABLE public.buses DROP COLUMN driver_uid;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'buses' AND column_name = 'driver_name') THEN
        ALTER TABLE public.buses DROP COLUMN driver_name;
    END IF;

    -- bus_locations table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bus_locations' AND column_name = 'accuracy') THEN
        ALTER TABLE bus_locations ADD COLUMN accuracy DOUBLE PRECISION;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bus_locations' AND column_name = 'updated_at') THEN
        ALTER TABLE bus_locations ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

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



-- =====================================================
-- SECTION 5: HELPER FUNCTIONS & TRIGGERS
-- =====================================================

-- Function to expire waiting flags
CREATE OR REPLACE FUNCTION expire_waiting_flags()
RETURNS void AS $$
BEGIN
  UPDATE waiting_flags
  SET status = 'expired'
  WHERE status = 'raised'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get effective driver
CREATE OR REPLACE FUNCTION get_effective_driver(p_bus_id TEXT)
RETURNS TEXT AS $$
DECLARE
  v_temp_driver TEXT;
BEGIN
  SELECT current_driver_uid INTO v_temp_driver
  FROM temporary_assignments
  WHERE bus_id = p_bus_id
    AND active = true
    AND starts_at <= NOW()
    AND (ends_at IS NULL OR ends_at > NOW())
  LIMIT 1;
  
  RETURN v_temp_driver;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Trigger for updated_at (reassignment logs)
CREATE OR REPLACE FUNCTION update_reassignment_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS reassignment_logs_updated_at ON public.reassignment_logs;
CREATE TRIGGER reassignment_logs_updated_at
  BEFORE UPDATE ON public.reassignment_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_reassignment_logs_updated_at();



-- Function to expire temporary assignments
CREATE OR REPLACE FUNCTION expire_temporary_assignments()
RETURNS TABLE(expired_count INTEGER) AS $$
DECLARE
  v_count INTEGER := 0;
  v_assignment RECORD;
BEGIN
  FOR v_assignment IN
    SELECT id, bus_id, original_driver_uid, current_driver_uid
    FROM temporary_assignments
    WHERE active = true
      AND ends_at IS NOT NULL
      AND ends_at <= NOW()
  LOOP
    UPDATE temporary_assignments
    SET active = false
    WHERE id = v_assignment.id;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function for reassignment logs pagination
CREATE OR REPLACE FUNCTION get_reassignment_logs(
  p_type TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id UUID, operation_id TEXT, type TEXT, actor_id TEXT, actor_label TEXT,
  logged_at TIMESTAMPTZ, status TEXT, summary TEXT, changes JSONB,
  meta JSONB, rollback_of TEXT, created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rl.id, rl.operation_id, rl.type, rl.actor_id, rl.actor_label,
    rl.logged_at, rl.status, rl.summary, rl.changes, rl.meta,
    rl.rollback_of, rl.created_at
  FROM public.reassignment_logs rl
  WHERE 
    (p_type IS NULL OR rl.type = p_type)
    AND (p_status IS NULL OR rl.status = p_status)
  ORDER BY rl.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to cleanup old reassignment logs
CREATE OR REPLACE FUNCTION cleanup_old_reassignment_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  WITH ranked AS (
    SELECT id, operation_id, type, created_at,
           ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at DESC) AS rn
    FROM public.reassignment_logs
  )
  DELETE FROM public.reassignment_logs 
  WHERE id IN (SELECT id FROM ranked WHERE rn > 3);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to clean up old driver trip history older than 12 months (based on end_time)
CREATE OR REPLACE FUNCTION cleanup_old_trip_history()
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

-- =====================================================
-- SECTION 6: ROW LEVEL SECURITY (HARDENED)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE waiting_flags ENABLE ROW LEVEL SECURITY;

-- ========== waiting_flags policies (SECURED) ==========
DROP POLICY IF EXISTS "waiting_flags_select_all" ON waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_select_restricted" ON waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_select_anon" ON waiting_flags;
CREATE POLICY "waiting_flags_select_anon" ON waiting_flags
  FOR SELECT TO anon, authenticated
  USING (
    status = 'raised'
    OR status = 'acknowledged'
    OR student_uid = auth.uid()::text
  );

DROP POLICY IF EXISTS "waiting_flags_insert_service" ON waiting_flags;
DROP POLICY IF EXISTS "Students can create their own waiting flags" ON waiting_flags;
CREATE POLICY "Students can create their own waiting flags" 
ON waiting_flags FOR INSERT TO authenticated 
WITH CHECK (student_uid = auth.uid()::text);

DROP POLICY IF EXISTS "waiting_flags_update_service" ON waiting_flags;
DROP POLICY IF EXISTS "Students can update their own waiting flags" ON waiting_flags;
DROP POLICY IF EXISTS "Drivers can update waiting flags for their bus" ON waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_update_authenticated" ON waiting_flags;
CREATE POLICY "waiting_flags_update_authenticated" 
ON waiting_flags FOR UPDATE TO authenticated 
USING (
  student_uid = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM active_trips 
    WHERE active_trips.driver_id = auth.uid()::text
    AND active_trips.bus_id = waiting_flags.bus_id
    AND active_trips.status = 'active'
  )
);

DROP POLICY IF EXISTS "waiting_flags_delete_service" ON waiting_flags;
DROP POLICY IF EXISTS "Students can delete their own waiting flags" ON waiting_flags;
DROP POLICY IF EXISTS "Drivers can delete waiting flags for their bus" ON waiting_flags;
DROP POLICY IF EXISTS "waiting_flags_delete_authenticated" ON waiting_flags;
CREATE POLICY "waiting_flags_delete_authenticated" 
ON waiting_flags FOR DELETE TO authenticated 
USING (
  student_uid = auth.uid()::text
  OR EXISTS (
    SELECT 1 FROM active_trips 
    WHERE active_trips.driver_id = auth.uid()::text
    AND active_trips.bus_id = waiting_flags.bus_id
    AND active_trips.status = 'active'
  )
);






-- ========== reassignment_logs policies (SECURED) ==========
DROP POLICY IF EXISTS "reassignment_logs_select_all" ON public.reassignment_logs;
DROP POLICY IF EXISTS "reassignment_logs_select_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_select_service" ON public.reassignment_logs
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "reassignment_logs_insert_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_insert_service" ON public.reassignment_logs
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "reassignment_logs_update_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_update_service" ON public.reassignment_logs
  FOR UPDATE TO service_role USING (true);

DROP POLICY IF EXISTS "reassignment_logs_delete_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_delete_service" ON public.reassignment_logs
  FOR DELETE TO service_role USING (true);

-- ========== payments policies (SECURED) ==========
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

-- ⚠️ PAYMENTS ARE IMMUTABLE - NO DELETIONS ALLOWED (not even service_role)
DROP POLICY IF EXISTS "payments_delete_service" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_blocked" ON public.payments;
DROP POLICY IF EXISTS "payments_no_delete" ON public.payments;
CREATE POLICY "payments_no_delete" ON public.payments
  FOR DELETE TO PUBLIC USING (false); -- BLOCKED: Payments are permanent financial records



-- =====================================================
-- SECTION 7: GRANTS & REVOKES
-- =====================================================

-- 1. Tighten default access
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT SELECT ON public.payments TO authenticated;

-- =====================================================
-- SECTION 8: REALTIME ARCHITECTURE NOTE
-- =====================================================
-- Real-time transport for trips, bus locations, driver status, and waiting flags
-- is decoupled from PostgreSQL WAL streaming and served by the dedicated Node.js
-- WebSocket server runtime (server/index.ts) on port 3001.
-- This eliminates database WAL streaming overhead and provides sub-10ms delivery.
-- PostgreSQL is strictly used for persistent data storage and atomic RPC locks.

-- =====================================================
-- SECTION 9: MULTI-DRIVER LOCK SYSTEM
-- Exclusive bus operation with automatic heartbeat recovery
-- =====================================================

-- driver_trip_history table (historical record of completed operational trips retained for 12 months)
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

-- Enable RLS for driver_trip_history
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

-- active_trips table (live trip records for runtime lock management ONLY)
CREATE TABLE IF NOT EXISTS public.active_trips (
  trip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('morning', 'evening', 'both')),
  status TEXT NOT NULL DEFAULT 'active',
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  fcm_start_sent BOOLEAN NOT NULL DEFAULT FALSE,
  fcm_end_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT active_trips_status_check CHECK (status IN ('active'))
);

CREATE INDEX IF NOT EXISTS idx_active_trips_bus_id ON public.active_trips(bus_id);
CREATE INDEX IF NOT EXISTS idx_active_trips_driver_id ON public.active_trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_active_trips_status ON public.active_trips(status);
CREATE INDEX IF NOT EXISTS idx_active_trips_status_bus ON public.active_trips(bus_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_active_trips_heartbeat ON public.active_trips(last_heartbeat) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_active_trips_start_time ON public.active_trips(start_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_trips_bus_active ON public.active_trips(bus_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_trips_driver_active ON public.active_trips(driver_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_active_trips_route_active ON public.active_trips(route_id, status) WHERE status = 'active';

-- Trigger for active_trips updated_at
DROP TRIGGER IF EXISTS active_trips_updated_at ON public.active_trips;
CREATE TRIGGER active_trips_updated_at
  BEFORE UPDATE ON public.active_trips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS for active_trips
ALTER TABLE public.active_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "active_trips_select_authenticated" ON public.active_trips;
DROP POLICY IF EXISTS "active_trips_select_anon" ON public.active_trips;
CREATE POLICY "active_trips_select_anon" ON public.active_trips
  FOR SELECT TO anon, authenticated USING (status = 'active');

DROP POLICY IF EXISTS "active_trips_insert_service" ON public.active_trips;
CREATE POLICY "active_trips_insert_service" ON public.active_trips
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "active_trips_update_service" ON public.active_trips;
CREATE POLICY "active_trips_update_service" ON public.active_trips
  FOR UPDATE TO service_role USING (true);

DROP POLICY IF EXISTS "active_trips_delete_service" ON public.active_trips;
CREATE POLICY "active_trips_delete_service" ON public.active_trips
  FOR DELETE TO service_role USING (true);

GRANT SELECT ON public.active_trips TO authenticated;

-- Function to check if a bus is locked
DROP FUNCTION IF EXISTS public.check_bus_lock(TEXT);
CREATE OR REPLACE FUNCTION check_bus_lock(p_bus_id TEXT)
RETURNS TABLE(
  is_locked BOOLEAN,
  locked_by TEXT,
  trip_id UUID,
  locked_since TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    TRUE AS is_locked,
    at.driver_id AS locked_by,
    at.trip_id,
    at.start_time AS locked_since,
    at.last_heartbeat
  FROM public.active_trips at
  WHERE at.bus_id = p_bus_id
    AND at.status = 'active'
  LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.check_bus_lock(TEXT) TO anon, authenticated;

-- Function to get stale locks
CREATE OR REPLACE FUNCTION get_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 60)
RETURNS TABLE(
  trip_id UUID,
  bus_id TEXT,
  driver_id TEXT,
  last_heartbeat TIMESTAMPTZ,
  stale_duration INTERVAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    at.trip_id,
    at.bus_id,
    at.driver_id,
    at.last_heartbeat,
    NOW() - at.last_heartbeat AS stale_duration
  FROM public.active_trips at
  WHERE at.status = 'active'
    AND at.last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to clean up stale locks
CREATE OR REPLACE FUNCTION cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 60)
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

-- (Section 10 Missed Bus Requests purged - feature deprecated)

-- device_sessions table (single-device session management)
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
CREATE OR REPLACE FUNCTION cleanup_stale_device_sessions(p_timeout_seconds INTEGER DEFAULT 60)
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

-- Enable RLS for device_sessions
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

-- device_sessions policies (SECURED)
-- Systematic cleanup: Drop ALL existing policies on device_sessions 
-- regardless of name to remove "Always True" lingering policies.
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

-- device_sessions policies (SECURED)
-- These ensure that users can only manage their own device sessions
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
-- SECTION 10.5: TRIP ATOMICITY RPCs
-- =====================================================

-- Function: end_trip_atomically
-- Atomically archives trip history and removes the active lock in one transaction.
-- Returns: { success, tripId, alreadyEnded }
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
    -- Trip already ended or never existed — idempotent success
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

GRANT EXECUTE ON FUNCTION public.end_trip_atomically(TEXT, TEXT, TEXT) TO authenticated, service_role;


-- =====================================================
-- SECTION 11: DOCUMENTATION
-- =====================================================

COMMENT ON TABLE bus_locations IS 'Real-time GPS coordinates of buses during active trips';
COMMENT ON TABLE waiting_flags IS 'Student waiting signals at bus stops';
COMMENT ON TABLE driver_location_updates IS 'Historical location breadcrumbs for audit/replay';
COMMENT ON TABLE public.reassignment_logs IS 'Audit logs for driver/student/route reassignment operations';
COMMENT ON TABLE public.payments IS 'IMMUTABLE FINANCIAL LEDGER - Payment records are permanent and cannot be deleted. Single source of truth for all payments.';
COMMENT ON TABLE public.active_trips IS 'Multi-driver lock system - Live trip records with heartbeat for exclusive bus operation';

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ ADTU Bus XQ System - Complete Database Setup Done!';
  RAISE NOTICE '📋 All core tables created (including active_trips for multi-driver lock)';
  RAISE NOTICE '🔒 Security-hardened RLS policies applied';
  RAISE NOTICE '⚡ All indexes created for performance';
  RAISE NOTICE '🔄 Helper functions and triggers added';
  RAISE NOTICE '📡 Realtime enabled for key tables';
  RAISE NOTICE '🚌 Multi-driver lock system ready';
  RAISE NOTICE '🚀 Ready for production!';
END $$;

-- Add comment explaining the encryption and signature strategy
COMMENT ON COLUMN public.payments.student_name IS 'Student name - stores AES-256-GCM encrypted data for new records. Legacy plain-text data is handled transparently by decryptData() in the application.';
COMMENT ON COLUMN public.payments.student_id IS 'Enrollment ID - stores AES-256-GCM encrypted data for new records. Legacy plain-text data is handled transparently.';
COMMENT ON COLUMN public.payments.offline_transaction_id IS 'Offline transaction ID - stores AES-256-GCM encrypted data for new records. Legacy plain-text data is handled transparently.';
COMMENT ON COLUMN public.payments.document_signature IS 'RSA-2048 digital signature for tamper-proof receipt verification. Generated during receipt creation and verified during QR scan.';
COMMENT ON COLUMN bus_locations.accuracy IS 'GPS accuracy in meters from device sensors';

