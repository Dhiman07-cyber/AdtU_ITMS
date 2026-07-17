-- =====================================================
-- ADTU Bus XQ System - COMPLETE DATABASE SCHEMA
-- This file consolidates ALL database setup into ONE file:
-- - Core tables (bus_locations, driver_status, waiting_flags, etc.)
-- - Reassignment logs & payments tables
-- - All indexes for performance
-- - Secure RLS policies (hardened for production)
-- - Helper functions and triggers
-- - Realtime configuration
--
-- RUN THIS ONCE IN SUPABASE SQL EDITOR
-- =====================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- SECTION 1: CORE TABLES
-- =====================================================

-- bus_locations table (real-time GPS tracking)
CREATE TABLE IF NOT EXISTS bus_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  driver_uid TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  accuracy DOUBLE PRECISION, -- GPS accuracy in meters
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_snapshot BOOLEAN DEFAULT FALSE,
  trip_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bus_locations_bus_id ON bus_locations(bus_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_route_id ON bus_locations(route_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_timestamp ON bus_locations(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bus_locations_trip ON bus_locations(trip_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_cleanup ON bus_locations(bus_id, route_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_timestamp_desc ON bus_locations(bus_id, timestamp DESC);

-- driver_status table
CREATE TABLE IF NOT EXISTS driver_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_uid TEXT NOT NULL UNIQUE,
  bus_id TEXT,
  route_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('idle', 'enroute', 'on_trip', 'offline')),
  started_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  trip_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_driver_status_driver_uid ON driver_status(driver_uid);
CREATE INDEX IF NOT EXISTS idx_driver_status_trip_id ON driver_status(trip_id);

-- waiting_flags table
CREATE TABLE IF NOT EXISTS waiting_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_uid TEXT NOT NULL,
  student_name TEXT NOT NULL,
  bus_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  stop_id TEXT,
  stop_name TEXT,
  stop_lat DOUBLE PRECISION,
  stop_lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'raised' CHECK (status IN ('raised', 'acknowledged', 'boarded', 'expired', 'cancelled', 'removed')),
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

-- driver_location_updates table (historical breadcrumbs)
CREATE TABLE IF NOT EXISTS driver_location_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_uid TEXT NOT NULL,
  bus_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  accuracy DOUBLE PRECISION,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_location_updates_driver_uid ON driver_location_updates(driver_uid);
CREATE INDEX IF NOT EXISTS idx_driver_location_updates_timestamp ON driver_location_updates(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_driver_location_updates_cleanup ON driver_location_updates(driver_uid, bus_id);

-- route_cache table (ORS geometry caching)
CREATE TABLE IF NOT EXISTS route_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id TEXT NOT NULL UNIQUE,
  geometry JSONB NOT NULL,
  distance DOUBLE PRECISION,
  duration DOUBLE PRECISION,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  fallback_used BOOLEAN DEFAULT FALSE,
  fallback_type TEXT DEFAULT 'none',
  fallback_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_route_cache_route_id ON route_cache(route_id);
CREATE INDEX IF NOT EXISTS idx_route_cache_expires_at ON route_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_route_cache_fallback ON route_cache(fallback_used) WHERE fallback_used = TRUE;

-- =====================================================
-- SECTION 2: DRIVER SWAP SYSTEM TABLES
-- =====================================================

-- driver_swap_requests table
CREATE TABLE IF NOT EXISTS driver_swap_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Requester (fromDriver) info
  requester_driver_uid TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  -- Target (toDriver) info  
  candidate_driver_uid TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  -- Primary bus/route being swapped
  bus_id TEXT NOT NULL,
  bus_number TEXT,
  route_id TEXT,
  route_name TEXT,
  -- Secondary bus/route for true swaps (both drivers have buses)
  secondary_bus_id TEXT,
  secondary_bus_number TEXT,
  secondary_route_id TEXT,
  secondary_route_name TEXT,
  -- Swap timing
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ, -- When acceptance window expires
  -- Swap details
  swap_type TEXT DEFAULT 'assignment' CHECK (swap_type IN ('assignment', 'swap')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'expired')),
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Action tracking
  accepted_by TEXT,
  accepted_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejected_at TIMESTAMPTZ,
  cancelled_by TEXT,
  cancelled_at TIMESTAMPTZ,
  -- Additional metadata
  meta JSONB DEFAULT '{}'::jsonb
);

-- Add missing columns if table already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'bus_number') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN bus_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'route_name') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN route_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'secondary_bus_id') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN secondary_bus_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'secondary_bus_number') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN secondary_bus_number TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'secondary_route_id') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN secondary_route_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'secondary_route_name') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN secondary_route_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'swap_type') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN swap_type TEXT DEFAULT 'assignment';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'driver_swap_requests' AND column_name = 'expires_at') THEN
        ALTER TABLE driver_swap_requests ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_swap_requests_requester ON driver_swap_requests(requester_driver_uid);
CREATE INDEX IF NOT EXISTS idx_swap_requests_candidate ON driver_swap_requests(candidate_driver_uid);
CREATE INDEX IF NOT EXISTS idx_swap_requests_bus ON driver_swap_requests(bus_id);
CREATE INDEX IF NOT EXISTS idx_swap_requests_status ON driver_swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_swap_requests_created ON driver_swap_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swap_requests_active ON driver_swap_requests(status) WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS idx_swap_requests_pending_expires ON driver_swap_requests(status, expires_at) WHERE status = 'pending';

-- temporary_assignments table
CREATE TABLE IF NOT EXISTS temporary_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bus_id TEXT NOT NULL UNIQUE,
  original_driver_uid TEXT NOT NULL,
  current_driver_uid TEXT NOT NULL,
  route_id TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_request_id UUID REFERENCES driver_swap_requests(id),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_temp_assignments_bus ON temporary_assignments(bus_id);
CREATE INDEX IF NOT EXISTS idx_temp_assignments_current_driver ON temporary_assignments(current_driver_uid);
CREATE INDEX IF NOT EXISTS idx_temp_assignments_active ON temporary_assignments(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_temp_assignments_expires ON temporary_assignments(ends_at) WHERE active = true;

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

-- Trigger for driver_status timestamp
CREATE OR REPLACE FUNCTION update_driver_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS driver_status_update_timestamp ON driver_status;
CREATE TRIGGER driver_status_update_timestamp
  BEFORE UPDATE ON driver_status
  FOR EACH ROW
  EXECUTE FUNCTION update_driver_status_timestamp();

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

DROP TRIGGER IF EXISTS update_swap_requests_updated_at ON driver_swap_requests;
CREATE TRIGGER update_swap_requests_updated_at
  BEFORE UPDATE ON driver_swap_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

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

-- Function to delete old bus location breadcrumbs (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_old_bus_locations(p_retention_hours INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  DELETE FROM bus_locations
  WHERE timestamp < NOW() - (p_retention_hours || ' hours')::INTERVAL
    AND id NOT IN (
      SELECT DISTINCT ON (bus_id) id
      FROM bus_locations
      ORDER BY bus_id, timestamp DESC
    );
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to delete old driver location updates (older than 48 hours)
CREATE OR REPLACE FUNCTION cleanup_old_driver_location_updates(p_retention_hours INTEGER DEFAULT 48)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  DELETE FROM driver_location_updates
  WHERE timestamp < NOW() - (p_retention_hours || ' hours')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- SECTION 6: ROW LEVEL SECURITY (HARDENED)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE bus_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE waiting_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_location_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reassignment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- ========== bus_locations policies ==========
DROP POLICY IF EXISTS "bus_locations_select_all" ON bus_locations;
DROP POLICY IF EXISTS "bus_locations_select_authenticated" ON bus_locations;
DROP POLICY IF EXISTS "bus_locations_select_anon" ON bus_locations;
CREATE POLICY "bus_locations_select_anon" ON bus_locations
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "bus_locations_insert_service" ON bus_locations;
CREATE POLICY "bus_locations_insert_service" ON bus_locations
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "drivers_can_insert_own_location" ON bus_locations;
CREATE POLICY "drivers_can_insert_own_location" ON bus_locations
  FOR INSERT TO authenticated
  WITH CHECK (driver_uid = auth.uid()::text);

DROP POLICY IF EXISTS "bus_locations_update_service" ON bus_locations;
CREATE POLICY "bus_locations_update_service" ON bus_locations
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "bus_locations_delete_service" ON bus_locations;
CREATE POLICY "bus_locations_delete_service" ON bus_locations
  FOR DELETE USING (auth.role() = 'service_role');

-- ========== driver_status policies ==========
DROP POLICY IF EXISTS "driver_status_select_all" ON driver_status;
DROP POLICY IF EXISTS "driver_status_select_authenticated" ON driver_status;
DROP POLICY IF EXISTS "driver_status_select_anon" ON driver_status;
CREATE POLICY "driver_status_select_anon" ON driver_status
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "driver_status_insert_service" ON driver_status;
CREATE POLICY "driver_status_insert_service" ON driver_status
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "drivers_can_upsert_own_status" ON driver_status;
CREATE POLICY "drivers_can_upsert_own_status" ON driver_status
  FOR INSERT TO authenticated
  WITH CHECK (driver_uid = auth.uid()::text);

DROP POLICY IF EXISTS "driver_status_update_service" ON driver_status;
CREATE POLICY "driver_status_update_service" ON driver_status
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "drivers_can_update_own_status" ON driver_status;
CREATE POLICY "drivers_can_update_own_status" ON driver_status
  FOR UPDATE TO authenticated
  USING (driver_uid = auth.uid()::text);

DROP POLICY IF EXISTS "driver_status_delete_service" ON driver_status;
CREATE POLICY "driver_status_delete_service" ON driver_status
  FOR DELETE USING (auth.role() = 'service_role');

-- Add index on bus_id and driver_uid for faster lookups
CREATE INDEX IF NOT EXISTS idx_driver_status_bus_id ON driver_status(bus_id);
CREATE INDEX IF NOT EXISTS idx_driver_status_bus_driver ON driver_status(bus_id, driver_uid);

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
CREATE POLICY "Students can update their own waiting flags" 
ON waiting_flags FOR UPDATE TO authenticated 
USING (student_uid = auth.uid()::text);

DROP POLICY IF EXISTS "waiting_flags_delete_service" ON waiting_flags;
DROP POLICY IF EXISTS "Students can delete their own waiting flags" ON waiting_flags;
CREATE POLICY "Students can delete their own waiting flags" 
ON waiting_flags FOR DELETE TO authenticated 
USING (student_uid = auth.uid()::text);

DROP POLICY IF EXISTS "Drivers can update waiting flags for their bus" ON waiting_flags;
CREATE POLICY "Drivers can update waiting flags for their bus" 
ON waiting_flags FOR UPDATE TO authenticated 
USING (EXISTS (
  SELECT 1 FROM driver_status 
  WHERE driver_status.driver_uid = auth.uid()::text
  AND driver_status.bus_id = waiting_flags.bus_id
));

DROP POLICY IF EXISTS "Drivers can delete waiting flags for their bus" ON waiting_flags;
CREATE POLICY "Drivers can delete waiting flags for their bus" 
ON waiting_flags FOR DELETE TO authenticated 
USING (EXISTS (
  SELECT 1 FROM driver_status 
  WHERE driver_status.driver_uid = auth.uid()::text
  AND driver_status.bus_id = waiting_flags.bus_id
));

-- ========== driver_location_updates policies (SECURED) ==========
DROP POLICY IF EXISTS "driver_location_updates_select_all" ON driver_location_updates;
DROP POLICY IF EXISTS "driver_location_updates_select_restricted" ON driver_location_updates;
CREATE POLICY "driver_location_updates_select_restricted" ON driver_location_updates
  FOR SELECT TO authenticated
  USING (driver_uid = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "driver_location_updates_insert_service" ON driver_location_updates;
CREATE POLICY "driver_location_updates_insert_service" ON driver_location_updates
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "drivers_can_insert_own_updates" ON driver_location_updates;
CREATE POLICY "drivers_can_insert_own_updates" ON driver_location_updates
  FOR INSERT TO authenticated
  WITH CHECK (driver_uid = auth.uid()::text);

DROP POLICY IF EXISTS "driver_location_updates_delete_service" ON driver_location_updates;
CREATE POLICY "driver_location_updates_delete_service" ON driver_location_updates
  FOR DELETE USING (auth.role() = 'service_role');


-- ========== route_cache policies ==========
DROP POLICY IF EXISTS "route_cache_select_all" ON route_cache;
DROP POLICY IF EXISTS "route_cache_select_anon" ON route_cache;
CREATE POLICY "route_cache_select_anon" ON route_cache
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "route_cache_insert_service" ON route_cache;
CREATE POLICY "route_cache_insert_service" ON route_cache
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "route_cache_update_service" ON route_cache;
CREATE POLICY "route_cache_update_service" ON route_cache
  FOR UPDATE USING (auth.role() = 'service_role');

-- ========== driver_swap_requests policies (SECURED) ==========
DROP POLICY IF EXISTS "Drivers can read their swap requests" ON driver_swap_requests;
DROP POLICY IF EXISTS "driver_swap_requests_select_involved" ON driver_swap_requests;
CREATE POLICY "driver_swap_requests_select_involved" ON driver_swap_requests
  FOR SELECT TO authenticated
  USING (
    auth.uid()::text = requester_driver_uid 
    OR auth.uid()::text = candidate_driver_uid
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "Drivers can create swap requests" ON driver_swap_requests;
CREATE POLICY "Drivers can create swap requests" ON driver_swap_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = requester_driver_uid);

DROP POLICY IF EXISTS "Requester can cancel pending requests" ON driver_swap_requests;
CREATE POLICY "Requester can cancel pending requests" ON driver_swap_requests
  FOR UPDATE TO authenticated
  USING (auth.uid()::text = requester_driver_uid AND status = 'pending');

-- ========== temporary_assignments policies (SECURED) ==========
DROP POLICY IF EXISTS "Only service role can manage assignments" ON temporary_assignments;
DROP POLICY IF EXISTS "Drivers can read their assignments" ON temporary_assignments;
DROP POLICY IF EXISTS "temporary_assignments_select_involved" ON temporary_assignments;
CREATE POLICY "temporary_assignments_select_involved" ON temporary_assignments
  FOR SELECT TO authenticated
  USING (
    auth.uid()::text = original_driver_uid 
    OR auth.uid()::text = current_driver_uid
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "temporary_assignments_insert_service" ON temporary_assignments;
CREATE POLICY "temporary_assignments_insert_service" ON temporary_assignments
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "temporary_assignments_update_service" ON temporary_assignments;
CREATE POLICY "temporary_assignments_update_service" ON temporary_assignments
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "temporary_assignments_delete_service" ON temporary_assignments;
CREATE POLICY "temporary_assignments_delete_service" ON temporary_assignments
  FOR DELETE USING (auth.role() = 'service_role');

-- ========== reassignment_logs policies (SECURED) ==========
DROP POLICY IF EXISTS "reassignment_logs_select_all" ON public.reassignment_logs;
DROP POLICY IF EXISTS "reassignment_logs_select_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_select_service" ON public.reassignment_logs
  FOR SELECT USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "reassignment_logs_insert_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_insert_service" ON public.reassignment_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "reassignment_logs_update_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_update_service" ON public.reassignment_logs
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "reassignment_logs_delete_service" ON public.reassignment_logs;
CREATE POLICY "reassignment_logs_delete_service" ON public.reassignment_logs
  FOR DELETE USING (auth.role() = 'service_role');

-- ========== payments policies (SECURED) ==========
DROP POLICY IF EXISTS "payments_select_all" ON public.payments;
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments
  FOR SELECT TO authenticated
  USING (student_uid = auth.uid()::text OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "payments_insert_service" ON public.payments;
CREATE POLICY "payments_insert_service" ON public.payments
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "payments_update_service" ON public.payments;
CREATE POLICY "payments_update_service" ON public.payments
  FOR UPDATE USING (auth.role() = 'service_role');

-- ⚠️ PAYMENTS ARE IMMUTABLE - NO DELETIONS ALLOWED (not even service_role)
DROP POLICY IF EXISTS "payments_delete_service" ON public.payments;
DROP POLICY IF EXISTS "payments_delete_blocked" ON public.payments;
DROP POLICY IF EXISTS "payments_no_delete" ON public.payments;
CREATE POLICY "payments_no_delete" ON public.payments
  FOR DELETE USING (false); -- BLOCKED: Payments are permanent financial records



-- =====================================================
-- SECTION 7: GRANTS & REVOKES
-- =====================================================

-- 1. Tighten default access
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 2. Explicitly allow anon/authenticated read access to tracking tables
GRANT SELECT ON public.waiting_flags TO anon, authenticated;
GRANT SELECT ON public.active_trips TO anon, authenticated;
GRANT SELECT ON public.bus_locations TO anon, authenticated;
GRANT SELECT ON public.driver_status TO anon, authenticated;
GRANT SELECT ON public.route_cache TO anon, authenticated;
GRANT SELECT ON public.missed_bus_requests TO anon, authenticated;

-- 3. Core application grants
GRANT SELECT ON driver_swap_requests TO authenticated;
GRANT INSERT ON driver_swap_requests TO authenticated;
GRANT UPDATE ON driver_swap_requests TO authenticated;
GRANT SELECT ON temporary_assignments TO authenticated;
GRANT SELECT ON public.payments TO authenticated;

-- =====================================================
-- SECTION 8: ENABLE REALTIME
-- =====================================================

DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'bus_locations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bus_locations;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'driver_status') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE driver_status;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'waiting_flags') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE waiting_flags;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'reassignment_logs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE reassignment_logs;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'payments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE payments;
  END IF;
  
  -- Driver Swap Requests: Enable realtime for instant swap updates
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'driver_swap_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE driver_swap_requests;
  END IF;
  
  -- Temporary Assignments: Enable realtime for active assignment updates  
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'temporary_assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE temporary_assignments;
  END IF;
  
  -- Active Trips: Enable realtime for multi-driver lock system
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'active_trips') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE active_trips;
  END IF;
END $$;

-- =====================================================
-- SECTION 9: MULTI-DRIVER LOCK SYSTEM
-- Exclusive bus operation with automatic heartbeat recovery
-- =====================================================

-- active_trips table (live trip records for lock management)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT active_trips_status_check CHECK (status IN ('active', 'ended'))
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
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "active_trips_update_service" ON public.active_trips;
CREATE POLICY "active_trips_update_service" ON public.active_trips
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "active_trips_delete_service" ON public.active_trips;
CREATE POLICY "active_trips_delete_service" ON public.active_trips
  FOR DELETE USING (auth.role() = 'service_role');

GRANT SELECT ON public.active_trips TO authenticated;

-- Function to check if a bus is locked
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
    SELECT at.trip_id, at.bus_id, at.driver_id
    FROM public.active_trips at
    WHERE at.status = 'active'
      AND at.last_heartbeat < NOW() - (p_heartbeat_timeout_seconds || ' seconds')::INTERVAL
  LOOP
    UPDATE public.active_trips
    SET status = 'ended', end_time = NOW()
    WHERE active_trips.trip_id = v_trip.trip_id;
    
    RETURN QUERY SELECT v_trip.trip_id, v_trip.bus_id, v_trip.driver_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =====================================================
-- SECTION 10: MISSED BUS REQUESTS (Student Pickup Requests)
-- =====================================================

-- missed_bus_requests table (student pickup requests for alternate buses)
CREATE TABLE IF NOT EXISTS public.missed_bus_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  op_id TEXT,                      -- client-provided idempotency key
  student_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  student_sequence INT NULL,       -- cached resolve of stop sequence
  candidate_trip_id UUID NULL,     -- when driver accepts, set the trip id
  trip_candidates JSONB NULL,      -- list of candidate trip IDs & raw ETA
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  responded_by TEXT NULL,
  responded_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_missed_bus_requests_student_id ON public.missed_bus_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_missed_bus_requests_op_id ON public.missed_bus_requests(op_id);
CREATE INDEX IF NOT EXISTS idx_missed_bus_requests_candidate_trip_id ON public.missed_bus_requests(candidate_trip_id);
CREATE INDEX IF NOT EXISTS idx_missed_bus_requests_status ON public.missed_bus_requests(status);
CREATE INDEX IF NOT EXISTS idx_missed_bus_requests_expires_at ON public.missed_bus_requests(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_missed_bus_requests_route_stop ON public.missed_bus_requests(route_id, stop_id);
CREATE INDEX IF NOT EXISTS idx_missed_bus_requests_trip_candidates ON public.missed_bus_requests USING GIN (trip_candidates);

-- Enable RLS for missed_bus_requests
ALTER TABLE public.missed_bus_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "missed_bus_requests_select_own" ON public.missed_bus_requests;
DROP POLICY IF EXISTS "missed_bus_requests_select_anon" ON public.missed_bus_requests;
CREATE POLICY "missed_bus_requests_select_anon" ON public.missed_bus_requests
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "missed_bus_requests_insert_service" ON public.missed_bus_requests;
CREATE POLICY "missed_bus_requests_insert_service" ON public.missed_bus_requests
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "missed_bus_requests_update_service" ON public.missed_bus_requests;
CREATE POLICY "missed_bus_requests_update_service" ON public.missed_bus_requests
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "missed_bus_requests_delete_service" ON public.missed_bus_requests;
CREATE POLICY "missed_bus_requests_delete_service" ON public.missed_bus_requests
  FOR DELETE USING (auth.role() = 'service_role');

GRANT SELECT ON public.missed_bus_requests TO authenticated;

-- Enable realtime for missed_bus_requests
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'missed_bus_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE missed_bus_requests;
  END IF;
END $$;

-- Function to expire stale missed bus requests
CREATE OR REPLACE FUNCTION expire_missed_bus_requests()
RETURNS INTEGER AS $$
DECLARE
  expired_count INTEGER := 0;
BEGIN
  UPDATE public.missed_bus_requests
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to get pending missed bus requests for a trip
CREATE OR REPLACE FUNCTION get_pending_missed_bus_requests_for_trip(p_trip_id UUID)
RETURNS TABLE(
  request_id UUID,
  student_id TEXT,
  route_id TEXT,
  stop_id TEXT,
  student_sequence INT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mbr.id AS request_id,
    mbr.student_id,
    mbr.route_id,
    mbr.stop_id,
    mbr.student_sequence,
    mbr.created_at,
    mbr.expires_at
  FROM public.missed_bus_requests mbr
  WHERE mbr.status = 'pending'
    AND mbr.trip_candidates ? p_trip_id::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
-- SECTION 11: DOCUMENTATION
-- =====================================================

COMMENT ON TABLE bus_locations IS 'Real-time GPS coordinates of buses during active trips';
COMMENT ON TABLE driver_status IS 'Current operational status of drivers';
COMMENT ON TABLE waiting_flags IS 'Student waiting signals at bus stops';
COMMENT ON TABLE driver_location_updates IS 'Historical location breadcrumbs for audit/replay';
COMMENT ON TABLE route_cache IS 'Cached route geometries from OpenRouteService';
COMMENT ON TABLE public.reassignment_logs IS 'Audit logs for driver/student/route reassignment operations';
COMMENT ON TABLE public.payments IS 'IMMUTABLE FINANCIAL LEDGER - Payment records are permanent and cannot be deleted. Single source of truth for all payments.';
COMMENT ON TABLE public.active_trips IS 'Multi-driver lock system - Live trip records with heartbeat for exclusive bus operation';
COMMENT ON TABLE public.missed_bus_requests IS 'Student missed-bus pickup requests - allows students to request alternate bus pickup when they miss their assigned bus.';

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ ADTU Bus XQ System - Complete Database Setup Done!';
  RAISE NOTICE '📋 All 12 tables created (including active_trips for multi-driver lock, missed_bus_requests for pickup requests)';
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

