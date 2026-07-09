-- =============================================================================
-- D6 Fleet — Buses Migration
-- Version  : 1.0.0
-- Domain   : D6 Fleet (Slice: buses)
-- Migration: Firestore buses collection → PostgreSQL buses table
--
-- DESIGN NOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- Firestore stored ONE document per bus at buses/{busId} with 15+ fields.
--
-- PostgreSQL schema captures the most query-critical fields as typed columns.
-- extras JSONB captures unmapped Firestore fields for migration compatibility.
-- extras is NOT a permanent dumping ground — fields get promoted to typed columns.
--
-- driver_profiles table (from D1 Identity migration 20260707_d1c) already owns
-- Driver master-data records. This migration adds only the buses table.
--
-- SINGLE SOURCE OF TRUTH — after migration, this table is the ONLY runtime owner
-- for bus master-data. driver_profiles is the ONLY runtime owner for driver
-- master-data (already frozen in D1 Identity).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER TRIGGER (idempotent — safe if already defined by D1/D2/D3)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: buses
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buses (
    id                      TEXT PRIMARY KEY,              -- Firestore doc ID (busId)
    bus_id                  TEXT NOT NULL,                 -- Explicit busId field
    bus_number              TEXT NOT NULL,
    model                   TEXT,
    year                    TEXT,
    capacity                INTEGER NOT NULL DEFAULT 0,
    driver_uid              TEXT,                          -- FK to driver_profiles.uid
    driver_name             TEXT,
    route_id                TEXT,                          -- FK reference (string, not FK constraint — Route domain owns routes)
    route_name              TEXT,
    status                  TEXT NOT NULL DEFAULT 'inactive'
                                CHECK (status IN ('active', 'inactive', 'maintenance', 'enroute', 'idle',
                                                  'Active', 'Inactive', 'Maintenance')),
    current_students        JSONB DEFAULT '[]'::jsonb,     -- array of student UIDs
    current_passenger_count INTEGER DEFAULT 0,
    last_started_at         TIMESTAMPTZ,
    last_ended_at           TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    extras                  JSONB DEFAULT '{}'::jsonb       -- migration compatibility
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_buses_bus_id ON buses(bus_id);
CREATE INDEX IF NOT EXISTS idx_buses_bus_number ON buses(bus_number);
CREATE INDEX IF NOT EXISTS idx_buses_route_id ON buses(route_id);
CREATE INDEX IF NOT EXISTS idx_buses_driver_uid ON buses(driver_uid);
CREATE INDEX IF NOT EXISTS idx_buses_status ON buses(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at on every UPDATE
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_buses_updated_at ON buses;
CREATE TRIGGER set_buses_updated_at
    BEFORE UPDATE ON buses
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
