-- 008_driver_assignments_init.sql
--
-- Create and populate the canonical driver↔bus ownership table.
-- Run once. Do NOT edit COMPLETE_SCHEMA.sql — this is the source of truth
-- for the driver_assignments schema. COMPLETE_SCHEMA.sql is documentation.
--
-- Replaces both:
--   buses.driver_uid          → driver_assignments.bus_id + WHERE is_active
--   driver_profiles.bus_id    → driver_assignments.driver_uid + WHERE is_active
--
-- After Milestone D both old columns will be dropped.

CREATE TABLE IF NOT EXISTS driver_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_uid TEXT NOT NULL,
  bus_id TEXT NOT NULL,
  route_id TEXT,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  assigned_by TEXT DEFAULT 'system',
  is_active BOOLEAN DEFAULT TRUE,
  reason TEXT DEFAULT 'assignment',
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_da_active_bus ON driver_assignments(bus_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_da_active_driver ON driver_assignments(driver_uid) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_da_history_bus ON driver_assignments(bus_id, assigned_at DESC);

COMMENT ON TABLE driver_assignments IS
  'Canonical driver↔bus ownership. Active row = current assignment. Historical rows preserved for audit.';

-- ────────────────────────────────────────────────────────────────────────────────
-- DATA MIGRATION
-- ────────────────────────────────────────────────────────────────────────────────

-- 1. Create assignments from driver_profiles that have a bus_id
INSERT INTO driver_assignments (driver_uid, bus_id, route_id, assigned_at, assigned_by, is_active, reason)
SELECT
  dp.uid,
  dp.bus_id,
  dp.route_id,
  COALESCE(b.updated_at, NOW()),
  'system',
  TRUE,
  'migration'
FROM driver_profiles dp
JOIN buses b ON dp.bus_id = b.id
WHERE dp.bus_id IS NOT NULL
  AND dp.uid IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM driver_assignments da
    WHERE da.driver_uid = dp.uid AND da.is_active = TRUE
  )
ON CONFLICT DO NOTHING;

-- 2. Catch any buses that have a driver_uid but no matching driver_profile bus_id
INSERT INTO driver_assignments (driver_uid, bus_id, assigned_at, assigned_by, is_active, reason)
SELECT
  b.driver_uid,
  b.id,
  b.updated_at,
  'system',
  TRUE,
  'migration_bus_side'
FROM buses b
WHERE b.driver_uid IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM driver_assignments da
    WHERE (da.driver_uid = b.driver_uid OR da.bus_id = b.id) AND da.is_active = TRUE
  )
ON CONFLICT DO NOTHING;

RAISE NOTICE '✅ driver_assignments created and populated from existing data';
