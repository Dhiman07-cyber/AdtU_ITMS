-- =============================================================================
-- D6 Fleet — Add Capacity Columns + Atomic RPCs to Buses Table
-- Version  : 1.0.0
-- Domain   : D6 Fleet (Slice: bus capacity)
-- Migration: Add per-shift load counters and atomic capacity RPCs
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored per-shift load counters in nested fields:
--   load.morningCount  → morning_load
--   load.eveningCount  → evening_load
--   currentMembers     → current_members (derived: morning + evening)
--
-- The original D6 migration (20260708) stored these in `extras` JSONB.
-- This migration promotes them to typed columns for direct query/mutation.
--
-- current_passenger_count is preserved for backward compatibility but
-- current_members is the new canonical field for total occupancy.
--
-- Atomic RPCs (bus_increment_capacity, bus_decrement_capacity) replace
-- Firestore runTransaction with single-statement SQL — no lost updates.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- ADD COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE buses
  ADD COLUMN IF NOT EXISTS morning_load    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evening_load    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_members INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL from current_passenger_count (best-effort, production will sync)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE buses
SET current_members = current_passenger_count
WHERE current_members = 0 AND current_passenger_count > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL from extras JSONB (if load object was migrated there)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE buses
SET
  morning_load = COALESCE((extras->'load'->>'morningCount')::int, 0),
  evening_load = COALESCE((extras->'load'->>'eveningCount')::int, 0)
WHERE extras ? 'load';

-- Recompute current_members from shift counters where available
UPDATE buses
SET current_members = morning_load + evening_load
WHERE morning_load > 0 OR evening_load > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES for capacity queries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_buses_morning_load ON buses(morning_load);
CREATE INDEX IF NOT EXISTS idx_buses_evening_load ON buses(evening_load);
CREATE INDEX IF NOT EXISTS idx_buses_current_members ON buses(current_members);

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: bus_check_capacity
-- Read-only capacity check for a bus + shift. Returns JSONB.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bus_check_capacity(
  p_bus_id TEXT,
  p_shift  TEXT DEFAULT 'Morning'
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'busId',         b.id,
    'capacity',      b.capacity,
    'morningLoad',   b.morning_load,
    'eveningLoad',   b.evening_load,
    'currentMembers', b.current_members,
    'shiftLoad',     CASE
                       WHEN LOWER(p_shift) = 'evening' THEN b.evening_load
                       WHEN LOWER(p_shift) = 'both'    THEN GREATEST(b.morning_load, b.evening_load)
                       ELSE b.morning_load
                     END,
    'available',     CASE
                       WHEN LOWER(p_shift) = 'evening' THEN b.evening_load < b.capacity
                       WHEN LOWER(p_shift) = 'both'    THEN GREATEST(b.morning_load, b.evening_load) < b.capacity
                       ELSE b.morning_load < b.capacity
                     END
  )
  FROM buses b
  WHERE b.id = p_bus_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: bus_increment_capacity
-- Atomic increment of per-shift load + current_members.
-- Returns JSONB with updated capacity state. Idempotent-safe.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bus_increment_capacity(
  p_bus_id TEXT,
  p_shift  TEXT DEFAULT 'Morning'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
  v_bus        RECORD;
  v_new_morning INTEGER;
  v_new_evening INTEGER;
  v_new_members INTEGER;
  v_result     JSONB;
BEGIN
  -- Lock the bus row to prevent concurrent mutations
  SELECT id, capacity, morning_load, evening_load, current_members
  INTO v_bus
  FROM buses
  WHERE id = p_bus_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found');
  END IF;

  v_new_morning := v_bus.morning_load;
  v_new_evening := v_bus.evening_load;

  IF v_normalized = 'evening' THEN
    v_new_evening := v_bus.evening_load + 1;
  ELSIF v_normalized = 'both' THEN
    v_new_morning := v_bus.morning_load + 1;
  ELSE
    -- Default: Morning
    v_new_morning := v_bus.morning_load + 1;
  END IF;

  v_new_members := v_new_morning + v_new_evening;

  UPDATE buses
  SET morning_load    = v_new_morning,
      evening_load    = v_new_evening,
      current_members = v_new_members,
      current_passenger_count = v_new_members,
      updated_at      = NOW()
  WHERE id = p_bus_id;

  v_result := jsonb_build_object(
    'busId',          p_bus_id,
    'capacity',       v_bus.capacity,
    'morningLoad',    v_new_morning,
    'eveningLoad',    v_new_evening,
    'currentMembers', v_new_members,
    'oldShiftLoad',   CASE
                        WHEN v_normalized = 'evening' THEN v_bus.evening_load
                        WHEN v_normalized = 'both'    THEN GREATEST(v_bus.morning_load, v_bus.evening_load)
                        ELSE v_bus.morning_load
                      END,
    'newShiftLoad',   CASE
                        WHEN v_normalized = 'evening' THEN v_new_evening
                        WHEN v_normalized = 'both'    THEN GREATEST(v_new_morning, v_new_evening)
                        ELSE v_new_morning
                      END,
    'shift',          p_shift,
    'success',        true
  );

  RETURN v_result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: bus_decrement_capacity
-- Atomic decrement of per-shift load + current_members.
-- Returns JSONB with updated capacity state. Floor is 0.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bus_decrement_capacity(
  p_bus_id TEXT,
  p_shift  TEXT DEFAULT 'Morning'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_normalized TEXT := LOWER(TRIM(COALESCE(p_shift, 'Morning')));
  v_bus        RECORD;
  v_new_morning INTEGER;
  v_new_evening INTEGER;
  v_new_members INTEGER;
  v_result     JSONB;
BEGIN
  SELECT id, capacity, morning_load, evening_load, current_members
  INTO v_bus
  FROM buses
  WHERE id = p_bus_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Bus ' || p_bus_id || ' not found');
  END IF;

  v_new_morning := v_bus.morning_load;
  v_new_evening := v_bus.evening_load;

  IF v_normalized = 'evening' THEN
    v_new_evening := GREATEST(0, v_bus.evening_load - 1);
  ELSIF v_normalized = 'both' THEN
    v_new_morning := GREATEST(0, v_bus.morning_load - 1);
  ELSE
    v_new_morning := GREATEST(0, v_bus.morning_load - 1);
  END IF;

  v_new_members := v_new_morning + v_new_evening;

  UPDATE buses
  SET morning_load    = v_new_morning,
      evening_load    = v_new_evening,
      current_members = v_new_members,
      current_passenger_count = v_new_members,
      updated_at      = NOW()
  WHERE id = p_bus_id;

  v_result := jsonb_build_object(
    'busId',          p_bus_id,
    'capacity',       v_bus.capacity,
    'morningLoad',    v_new_morning,
    'eveningLoad',    v_new_evening,
    'currentMembers', v_new_members,
    'oldShiftLoad',   CASE
                        WHEN v_normalized = 'evening' THEN v_bus.evening_load
                        WHEN v_normalized = 'both'    THEN GREATEST(v_bus.morning_load, v_bus.evening_load)
                        ELSE v_bus.morning_load
                      END,
    'newShiftLoad',   CASE
                        WHEN v_normalized = 'evening' THEN v_new_evening
                        WHEN v_normalized = 'both'    THEN GREATEST(v_new_morning, v_new_evening)
                        ELSE v_new_morning
                      END,
    'shift',          p_shift,
    'success',        true
  );

  RETURN v_result;
END;
$$;
