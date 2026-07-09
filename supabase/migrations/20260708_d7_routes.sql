-- =============================================================================
-- D7 Route — Routes Migration
-- Version  : 1.0.0
-- Domain   : D7 Route (Slice: routes)
-- Migration: Firestore routes collection → PostgreSQL routes table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per route at routes/{routeId} with:
--   routeId, routeName, stops (array), totalStops, estimatedTime, active, status, etc.
--
-- PostgreSQL schema captures these fields as typed columns.
-- No assigned_buses, updated_by, or extras columns per frozen architecture.
-- The duplicate 'active' field is removed; status is the single source of truth:
-- status IN ('active', 'inactive').
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER TRIGGER (idempotent — safe if already defined by D1/D2/D3/D6)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: routes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS routes (
    id             TEXT PRIMARY KEY,              -- Firestore doc ID
    route_id       TEXT UNIQUE NOT NULL,          -- Unique route ID
    route_name     TEXT NOT NULL,
    stops          JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_stops    INTEGER NOT NULL DEFAULT 0,
    estimated_time TEXT,
    status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'inactive')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_routes_route_id ON routes(route_id);
CREATE INDEX IF NOT EXISTS idx_routes_status ON routes(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_routes_updated_at ON routes;
CREATE TRIGGER set_routes_updated_at
    BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
