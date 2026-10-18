-- =============================================================================
-- Migration: 20261017_unify_trip_locks_and_stop_dwell.sql
-- ADTU ITMS Production Hardening
-- =============================================================================
-- 1. Create public.system_settings table (eliminates Firestore split-brain)
-- 2. Create public.stop_dwell_logs table (incontrovertible stop dwell audit proof)
-- 3. Hardens cleanup_stale_locks RPC to 600s (10-minute) default timeout to protect
--    buses passing through cellular dead zones
-- =============================================================================

-- ── 1. System Settings Table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  TEXT
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read system_settings" ON public.system_settings;
CREATE POLICY "Public read system_settings"
    ON public.system_settings FOR SELECT
    TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Service role write system_settings" ON public.system_settings;
CREATE POLICY "Service role write system_settings"
    ON public.system_settings FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Seed default configs if missing
INSERT INTO public.system_settings (key, value, updated_at, updated_by)
VALUES 
  ('config', '{"appName": "AdtU Bus Services", "busFee": {"amount": 5000, "version": 1, "history": []}}'::jsonb, NOW(), 'system'),
  ('landing', '{"heroTitle": "AdtU Bus Services", "heroSubtitle": "Smart Campus Transit Portal", "features": []}'::jsonb, NOW(), 'system'),
  ('ui', '{"primaryColor": "#1e40af", "navigationStyle": "sidebar"}'::jsonb, NOW(), 'system'),
  ('deadline', '{"description": "Academic Calendar Configuration", "version": "1.0.0", "academicSessionStart": {"month": 6, "day": 1}}'::jsonb, NOW(), 'system')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Stop Dwell Logs Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stop_dwell_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id       TEXT NOT NULL,
    bus_id        TEXT NOT NULL,
    driver_id     TEXT NOT NULL,
    route_id      TEXT NOT NULL,
    stop_id       TEXT NOT NULL,
    stop_name     TEXT NOT NULL,
    arrived_at    TIMESTAMPTZ NOT NULL,
    departed_at   TIMESTAMPTZ,
    dwell_seconds INTEGER NOT NULL DEFAULT 0 CHECK (dwell_seconds >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_trip_id ON public.stop_dwell_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_bus_time ON public.stop_dwell_logs(bus_id, arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_stop_dwell_logs_route_stop ON public.stop_dwell_logs(route_id, stop_name);

ALTER TABLE public.stop_dwell_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read stop_dwell_logs" ON public.stop_dwell_logs;
CREATE POLICY "Public read stop_dwell_logs"
    ON public.stop_dwell_logs FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Service role manage stop_dwell_logs" ON public.stop_dwell_logs;
CREATE POLICY "Service role manage stop_dwell_logs"
    ON public.stop_dwell_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ── 3. Hardened cleanup_stale_locks (10-minute default timeout) ───────────────
CREATE OR REPLACE FUNCTION public.cleanup_stale_locks(p_heartbeat_timeout_seconds INTEGER DEFAULT 600)
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

-- ── 4. Synchronize Verified Ground-Level Guwahati Coordinates ─────────────────
INSERT INTO public.routes (id, route_name, stops, buses, created_at, updated_at)
VALUES
  (
    'route_1',
    'Route-1',
    '[
      {"stop_id": "stop_1_1", "name": "Boragaon", "stop_name": "Boragaon", "lat": 26.1128, "lng": 91.6876, "sequence": 1},
      {"stop_id": "stop_1_2", "name": "Garchuk", "stop_name": "Garchuk", "lat": 26.1122, "lng": 91.7098, "sequence": 2},
      {"stop_id": "stop_1_3", "name": "Lokhra Chariali", "stop_name": "Lokhra Chariali", "lat": 26.1117, "lng": 91.7494, "sequence": 3},
      {"stop_id": "stop_1_4", "name": "Lalmati", "stop_name": "Lalmati", "lat": 26.1132, "lng": 91.7755, "sequence": 4},
      {"stop_id": "stop_1_5", "name": "National Games Village", "stop_name": "National Games Village", "lat": 26.1145, "lng": 91.7868, "sequence": 5},
      {"stop_id": "stop_1_6", "name": "Beltola Tiniali", "stop_name": "Beltola Tiniali", "lat": 26.1241, "lng": 91.7994, "sequence": 6},
      {"stop_id": "stop_1_7", "name": "Last Gate / Dispur", "stop_name": "Last Gate / Dispur", "lat": 26.1438, "lng": 91.7896, "sequence": 7},
      {"stop_id": "stop_1_8", "name": "Ganeshguri Bus Stop", "stop_name": "Ganeshguri Bus Stop", "lat": 26.1518, "lng": 91.7836, "sequence": 8},
      {"stop_id": "stop_1_9", "name": "Zoo Road Tiniali", "stop_name": "Zoo Road Tiniali", "lat": 26.1656, "lng": 91.7812, "sequence": 9},
      {"stop_id": "stop_1_10", "name": "Gitanagar", "stop_name": "Gitanagar", "lat": 26.1738, "lng": 91.7945, "sequence": 10},
      {"stop_id": "stop_1_11", "name": "Noonmati / BG Tiniali", "stop_name": "Noonmati / BG Tiniali", "lat": 26.1825, "lng": 91.8058, "sequence": 11},
      {"stop_id": "stop_1_12", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 12},
      {"stop_id": "stop_1_13", "name": "Panikhaiti Tiniali", "stop_name": "Panikhaiti Tiniali", "lat": 26.1972, "lng": 91.8575, "sequence": 13},
      {"stop_id": "stop_1_14", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 14}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_2',
    'Route-2',
    '[
      {"stop_id": "stop_2_1", "name": "Jalukbari Bus Stop", "stop_name": "Jalukbari Bus Stop", "lat": 26.1465, "lng": 91.6625, "sequence": 1},
      {"stop_id": "stop_2_2", "name": "Maligaon Chariali", "stop_name": "Maligaon Chariali", "lat": 26.1542, "lng": 91.6972, "sequence": 2},
      {"stop_id": "stop_2_3", "name": "Bhutnath", "stop_name": "Bhutnath", "lat": 26.1654, "lng": 91.7188, "sequence": 3},
      {"stop_id": "stop_2_4", "name": "Santipur", "stop_name": "Santipur", "lat": 26.1702, "lng": 91.7248, "sequence": 4},
      {"stop_id": "stop_2_5", "name": "Bharalumukh", "stop_name": "Bharalumukh", "lat": 26.1738, "lng": 91.7322, "sequence": 5},
      {"stop_id": "stop_2_6", "name": "Fancy Bazar", "stop_name": "Fancy Bazar", "lat": 26.1828, "lng": 91.7405, "sequence": 6},
      {"stop_id": "stop_2_7", "name": "Panbazar Bus Stop", "stop_name": "Panbazar Bus Stop", "lat": 26.1850, "lng": 91.7478, "sequence": 7},
      {"stop_id": "stop_2_8", "name": "Chandmari Bus Stop", "stop_name": "Chandmari Bus Stop", "lat": 26.1882, "lng": 91.7738, "sequence": 8},
      {"stop_id": "stop_2_9", "name": "Bamunimaidan", "stop_name": "Bamunimaidan", "lat": 26.1865, "lng": 91.7892, "sequence": 9},
      {"stop_id": "stop_2_10", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 10},
      {"stop_id": "stop_2_11", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 11}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_3',
    'Route-3',
    '[
      {"stop_id": "stop_3_1", "name": "Guwahati Club", "stop_name": "Guwahati Club", "lat": 26.1858, "lng": 91.7578, "sequence": 1},
      {"stop_id": "stop_3_2", "name": "Silpukhuri", "stop_name": "Silpukhuri", "lat": 26.1872, "lng": 91.7642, "sequence": 2},
      {"stop_id": "stop_3_3", "name": "Anuradha Cinema / Chandmari", "stop_name": "Anuradha Cinema / Chandmari", "lat": 26.1874, "lng": 91.7798, "sequence": 3},
      {"stop_id": "stop_3_4", "name": "Bamunimaidan Industrial Area", "stop_name": "Bamunimaidan Industrial Area", "lat": 26.1860, "lng": 91.7945, "sequence": 4},
      {"stop_id": "stop_3_5", "name": "New Guwahati", "stop_name": "New Guwahati", "lat": 26.1848, "lng": 91.8012, "sequence": 5},
      {"stop_id": "stop_3_6", "name": "Noonmati Sector 2", "stop_name": "Noonmati Sector 2", "lat": 26.1835, "lng": 91.8122, "sequence": 6},
      {"stop_id": "stop_3_7", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 7},
      {"stop_id": "stop_3_8", "name": "Panikhaiti Tiniali", "stop_name": "Panikhaiti Tiniali", "lat": 26.1972, "lng": 91.8575, "sequence": 8},
      {"stop_id": "stop_3_9", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 9}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_4',
    'Route-4',
    '[
      {"stop_id": "stop_4_1", "name": "Paltan Bazar ASTC", "stop_name": "Paltan Bazar ASTC", "lat": 26.1818, "lng": 91.7516, "sequence": 1},
      {"stop_id": "stop_4_2", "name": "Ulubari Bus Stop", "stop_name": "Ulubari Bus Stop", "lat": 26.1732, "lng": 91.7568, "sequence": 2},
      {"stop_id": "stop_4_3", "name": "Bora Service", "stop_name": "Bora Service", "lat": 26.1704, "lng": 91.7618, "sequence": 3},
      {"stop_id": "stop_4_4", "name": "Bhangagarh / GMCH", "stop_name": "Bhangagarh / GMCH", "lat": 26.1652, "lng": 91.7684, "sequence": 4},
      {"stop_id": "stop_4_5", "name": "Christian Basti", "stop_name": "Christian Basti", "lat": 26.1592, "lng": 91.7758, "sequence": 5},
      {"stop_id": "stop_4_6", "name": "Ganeshguri", "stop_name": "Ganeshguri", "lat": 26.1518, "lng": 91.7836, "sequence": 6},
      {"stop_id": "stop_4_7", "name": "Down Town Hospital", "stop_name": "Down Town Hospital", "lat": 26.1394, "lng": 91.7992, "sequence": 7},
      {"stop_id": "stop_4_8", "name": "Six Mile Bus Stop", "stop_name": "Six Mile Bus Stop", "lat": 26.1348, "lng": 91.8062, "sequence": 8},
      {"stop_id": "stop_4_9", "name": "Barbari VIP Road", "stop_name": "Barbari VIP Road", "lat": 26.1518, "lng": 91.8152, "sequence": 9},
      {"stop_id": "stop_4_10", "name": "Magzine VIP Road", "stop_name": "Magzine VIP Road", "lat": 26.1615, "lng": 91.8214, "sequence": 10},
      {"stop_id": "stop_4_11", "name": "Patharkuwary", "stop_name": "Patharkuwary", "lat": 26.1695, "lng": 91.8268, "sequence": 11},
      {"stop_id": "stop_4_12", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 12},
      {"stop_id": "stop_4_13", "name": "Panikhaiti Tiniali", "stop_name": "Panikhaiti Tiniali", "lat": 26.1972, "lng": 91.8575, "sequence": 13},
      {"stop_id": "stop_4_14", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 14}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_7',
    'Route-7',
    '[
      {"stop_id": "stop_7_1", "name": "Down Town Hospital", "stop_name": "Down Town Hospital", "lat": 26.1394, "lng": 91.7992, "sequence": 1},
      {"stop_id": "stop_7_2", "name": "Sixmile Bus Stop", "stop_name": "Sixmile Bus Stop", "lat": 26.1348, "lng": 91.8062, "sequence": 2},
      {"stop_id": "stop_7_3", "name": "Barbari VIP Road", "stop_name": "Barbari VIP Road", "lat": 26.1518, "lng": 91.8152, "sequence": 3},
      {"stop_id": "stop_7_4", "name": "Magzine VIP Road", "stop_name": "Magzine VIP Road", "lat": 26.1615, "lng": 91.8214, "sequence": 4},
      {"stop_id": "stop_7_5", "name": "Patharkuwary", "stop_name": "Patharkuwary", "lat": 26.1695, "lng": 91.8268, "sequence": 5},
      {"stop_id": "stop_7_6", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 6},
      {"stop_id": "stop_7_7", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 7}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  ),
  (
    'route_8',
    'Route-8',
    '[
      {"stop_id": "stop_8_1", "name": "Lakhmi Mandir (Beltola)", "stop_name": "Lakhmi Mandir (Beltola)", "lat": 26.1282, "lng": 91.7958, "sequence": 1},
      {"stop_id": "stop_8_2", "name": "Beltola (Wireless)", "stop_name": "Beltola (Wireless)", "lat": 26.1368, "lng": 91.7924, "sequence": 2},
      {"stop_id": "stop_8_3", "name": "Last Gate / Dispur", "stop_name": "Last Gate / Dispur", "lat": 26.1438, "lng": 91.7896, "sequence": 3},
      {"stop_id": "stop_8_4", "name": "Six Mile Bus Stop", "stop_name": "Six Mile Bus Stop", "lat": 26.1348, "lng": 91.8062, "sequence": 4},
      {"stop_id": "stop_8_5", "name": "Narengi Tiniali", "stop_name": "Narengi Tiniali", "lat": 26.1795, "lng": 91.8325, "sequence": 5},
      {"stop_id": "stop_8_6", "name": "Assam down town University Campus", "stop_name": "Assam down town University Campus", "lat": 26.2019, "lng": 91.8615, "sequence": 6}
    ]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  )
ON CONFLICT (id) DO UPDATE SET
  route_name = EXCLUDED.route_name,
  stops = EXCLUDED.stops,
  updated_at = NOW();




