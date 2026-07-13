-- =============================================================================
-- D9 Trip Operations — Remove Firestore dependency from trip lifecycle
-- Version  : 1.0.0
-- Domain   : D9 Trip Operations (active trips, driver swaps, waiting flags)
--
-- DESIGN RULES
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. D9 owns only its own business data (active_trips, swaps, flags).
-- 2. D9 reads other domains' data through public APIs, not Firestore.
-- 3. D9 does NOT write to other domains' Firestore collections.
-- 4. The trip lock moves from Firestore buses.activeTripLock to active_trips.
-- 5. The FCM notification lock moves from Firestore buses.activeTripLock to active_trips.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- EXTEND active_trips: add FCM notification lock columns
-- These replace the startFcmSent/endFcmSent fields previously stored on
-- the Firestore buses.activeTripLock object.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.active_trips
  ADD COLUMN IF NOT EXISTS fcm_start_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fcm_end_sent BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- Add expires_at to active_trips for lock TTL enforcement
-- The Firestore lock had an explicit expiresAt. In PostgreSQL we can compute
-- it, but storing it makes queries simpler and avoids clock drift issues.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.active_trips
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- Extend check_bus_lock to also return FCM lock state
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_bus_lock(p_bus_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_trip RECORD;
BEGIN
  SELECT trip_id, driver_id, shift, status, start_time, last_heartbeat, expires_at,
         fcm_start_sent, fcm_end_sent
  INTO v_trip
  FROM active_trips
  WHERE bus_id = p_bus_id AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  RETURN jsonb_build_object(
    'active', true,
    'tripId', v_trip.trip_id,
    'driverId', v_trip.driver_id,
    'shift', v_trip.shift,
    'startTime', v_trip.start_time,
    'lastHeartbeat', v_trip.last_heartbeat,
    'expiresAt', v_trip.expires_at,
    'fcmStartSent', v_trip.fcm_start_sent,
    'fcmEndSent', v_trip.fcm_end_sent
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: Acquire trip lock (atomic INSERT with unique constraint)
-- Replaces the Firestore transaction in trip-lock-service.startTrip()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acquire_trip_lock(
  p_trip_id TEXT,
  p_bus_id TEXT,
  p_driver_id TEXT,
  p_route_id TEXT,
  p_shift TEXT,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
  v_existing RECORD;
BEGIN
  -- Idempotent: if this driver already has an active trip on this bus, return it
  SELECT trip_id INTO v_existing
  FROM active_trips
  WHERE bus_id = p_bus_id AND driver_id = p_driver_id AND status = 'active';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'tripId', v_existing.trip_id,
      'alreadyActive', true
    );
  END IF;

  -- End any stale active trips for this bus or driver (heartbeat timeout)
  UPDATE active_trips
  SET status = 'ended', end_time = v_now
  WHERE status = 'active'
    AND (bus_id = p_bus_id OR driver_id = p_driver_id)
    AND last_heartbeat < v_now - INTERVAL '600 seconds';

  -- Attempt to insert — unique partial index enforces one active trip per bus
  BEGIN
    INSERT INTO active_trips (trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at)
    VALUES (p_trip_id, p_bus_id, p_driver_id, p_route_id, p_shift, 'active', v_now, v_now, v_expires_at);

    RETURN jsonb_build_object(
      'success', true,
      'tripId', p_trip_id,
      'alreadyActive', false
    );
  EXCEPTION WHEN unique_violation THEN
    -- Another trip is active on this bus — check who owns it
    SELECT trip_id, driver_id INTO v_existing
    FROM active_trips
    WHERE bus_id = p_bus_id AND status = 'active'
    LIMIT 1;

    IF FOUND AND v_existing.driver_id = p_driver_id THEN
      -- Same driver retrying — idempotent success
      RETURN jsonb_build_object(
        'success', true,
        'tripId', v_existing.trip_id,
        'alreadyActive', true
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'LOCKED_BY_OTHER',
      'activeDriverId', COALESCE(v_existing.driver_id, 'unknown')
    );
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: Extend trip lock (heartbeat)
-- Replaces the Firestore transaction in trip-lock-service.heartbeat()
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.extend_trip_lock(
  p_trip_id TEXT,
  p_driver_id TEXT,
  p_bus_id TEXT,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
  v_updated INTEGER;
BEGIN
  UPDATE active_trips
  SET last_heartbeat = NOW(),
      expires_at = v_expires_at
  WHERE trip_id = p_trip_id
    AND driver_id = p_driver_id
    AND bus_id = p_bus_id
    AND status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RETURN jsonb_build_object('success', true);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Active trip not found');
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: Release trip lock (end trip)
-- Replaces the Firestore releaseLock/releaseLockIfMatches in trip-lock-service
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_trip_lock(
  p_trip_id TEXT,
  p_bus_id TEXT,
  p_driver_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE active_trips
  SET status = 'ended', end_time = NOW()
  WHERE trip_id = p_trip_id
    AND bus_id = p_bus_id
    AND driver_id = p_driver_id
    AND status = 'active';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'released', v_updated > 0
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: Acquire FCM notification lock (idempotent)
-- Replaces the Firestore transaction in fcm-notification-service.ts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.acquire_fcm_lock(
  p_trip_id TEXT,
  p_bus_id TEXT,
  p_lock_type TEXT  -- 'start' or 'end'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_column TEXT;
  v_updated INTEGER;
BEGIN
  IF p_lock_type = 'start' THEN
    v_column := 'fcm_start_sent';
  ELSIF p_lock_type = 'end' THEN
    v_column := 'fcm_end_sent';
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid lock_type');
  END IF;

  -- Atomic: only set if currently false
  IF v_column = 'fcm_start_sent' THEN
    UPDATE active_trips
    SET fcm_start_sent = true
    WHERE trip_id = p_trip_id AND bus_id = p_bus_id AND status = 'active'
      AND fcm_start_sent = false;
  ELSE
    UPDATE active_trips
    SET fcm_end_sent = true
    WHERE trip_id = p_trip_id AND bus_id = p_bus_id AND status = 'active'
      AND fcm_end_sent = false;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    RETURN jsonb_build_object('success', true, 'acquired', true);
  ELSE
    -- Already sent (idempotent) or trip not found
    RETURN jsonb_build_object('success', true, 'acquired', false);
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Index: faster lookups for active trip by bus
-- (partial unique index already exists, add a covering index for canOperate)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_active_trips_bus_expires
  ON active_trips (bus_id, expires_at)
  WHERE status = 'active';
