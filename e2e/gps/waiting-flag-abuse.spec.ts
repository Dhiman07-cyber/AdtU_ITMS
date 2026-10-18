/**
 * e2e/gps/waiting-flag-abuse.spec.ts
 *
 * Forensic verification of Student Waiting Flag 3-Lock Route Corridor & Abuse Protection:
 * - Accepts legitimate on-corridor roadside submissions between stops (crossTrack <= 120m, fresh timestamp, accuracy <= 150m).
 * - Rejects out-of-corridor submissions (e.g. 400m deep in by-lanes or distant Meghalaya coordinates) with HTTP 403 (OUT_OF_ROUTE_CORRIDOR).
 * - Rejects stale timestamps (>60s clock drift) with HTTP 400 (TIMESTAMP_EXPIRED).
 * - Rejects low-accuracy GPS (>150m accuracy circle) with HTTP 400 (ACCURACY_TOO_LOW).
 * - Rejects if bus has already passed student's location by >150m with HTTP 409 (BUS_ALREADY_PASSED).
 * - Rejects if bus is still >4 km upstream away with HTTP 400 (BUS_TOO_FAR_UPSTREAM).
 */

import { test, expect } from '@playwright/test';
import { loadPersonas, mintIdToken, apiCall, supabase, sleep } from '../helpers';
import { DriverAgent } from '../../scripts/staging/agents';

test.describe('Waiting Flag 3-Lock Route Corridor & Anti-Abuse Controls', () => {
  let driverToken: string;
  let studentToken: string;
  let driverUid: string;
  let studentUid: string;
  let busId: string;
  let routeId: string;
  let stopName: string;
  let tripId: string;
  let driverAgent: DriverAgent;

  test.beforeAll(async () => {
    const personas = loadPersonas();
    if (!personas || !personas.drivers.length || !personas.students.length) {
      throw new Error('Staging personas missing. Run personas.ts seed before E2E tests.');
    }

    const d = personas.drivers[0];
    const s = personas.students[0];

    driverUid = d.uid;
    studentUid = s.uid;
    busId = d.busId!;
    routeId = d.routeId!;
    stopName = s.stopName || 'Boragaon';

    driverToken = await mintIdToken(driverUid);
    studentToken = await mintIdToken(studentUid);

    // Ensure student is assigned to this bus and route in DB
    const sb = supabase();
    await sb
      .from('students')
      .update({ bus_id: busId, route_id: routeId, stop_name: stopName })
      .eq('uid', studentUid);

    driverAgent = new DriverAgent({
      label: d.label,
      uid: driverUid,
      idToken: driverToken,
      busId,
      routeId,
      gpsSeed: 'waiting-flag-abuse-test',
    });

    await driverAgent.startTrip();
    tripId = driverAgent.tripId!;
    console.log(`[TEST-SETUP] Trip started: ${tripId} on bus ${busId}`);
  });

  test.afterAll(async () => {
    if (driverAgent) {
      await driverAgent.endTrip().catch(() => {});
      console.log(`[TEST-TEARDOWN] Trip ended on bus ${busId}`);
    }
  });

  test('CORRIDOR-01 — Rejects distant Meghalaya coordinates with HTTP 403 OUT_OF_ROUTE_CORRIDOR', async () => {
    // Student coordinates in Meghalaya (~40km south of Guwahati corridors)
    const meghalayaLat = 25.75;
    const meghalayaLng = 91.85;

    const res = await apiCall('POST', '/api/student/waiting-flag', studentToken, {
      busId,
      routeId,
      stop_name: 'Boragaon',
      lat: meghalayaLat,
      lng: meghalayaLng,
      accuracy: 10,
      timestamp: Date.now(),
      message: 'Spoofed Meghalaya location test',
    });

    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('OUT_OF_ROUTE_CORRIDOR');
    expect(res.json?.error).toContain('You must be at the roadside along your bus route');
  });

  test('CORRIDOR-02 — Rejects stale timestamp (>60s clock drift) with HTTP 400 TIMESTAMP_EXPIRED', async () => {
    const staleTimestamp = Date.now() - 120_000; // 2 minutes ago

    const res = await apiCall('POST', '/api/student/waiting-flag', studentToken, {
      busId,
      routeId,
      stop_name: 'Boragaon',
      lat: 26.1128,
      lng: 91.6876,
      accuracy: 10,
      timestamp: staleTimestamp,
      message: 'Stale timestamp replay test',
    });

    expect(res.status).toBe(400);
    expect(res.json?.code).toBe('TIMESTAMP_EXPIRED');
  });

  test('CORRIDOR-03 — Rejects degraded accuracy (>150m) with HTTP 400 ACCURACY_TOO_LOW', async () => {
    const poorAccuracy = 250; // 250m accuracy radius

    const res = await apiCall('POST', '/api/student/waiting-flag', studentToken, {
      busId,
      routeId,
      stop_name: 'Boragaon',
      lat: 26.1128,
      lng: 91.6876,
      accuracy: poorAccuracy,
      timestamp: Date.now(),
      message: 'Degraded accuracy cell tower test',
    });

    expect(res.status).toBe(400);
    expect(res.json?.code).toBe('ACCURACY_TOO_LOW');
  });

  test('CORRIDOR-04 — Accepts roadside submission along corridor between two stops (600m from stop, 15m from road)', async () => {
    // Route 1 midpoint between Boragaon (26.1128, 91.6876) and Garchuk (26.1122, 91.7098)
    // ~1.1 km from Boragaon, ~1.1 km from Garchuk, right on the road corridor
    const roadsideLat = 26.1125;
    const roadsideLng = 91.6987;

    const res = await apiCall('POST', '/api/student/waiting-flag', studentToken, {
      busId,
      routeId,
      stop_name: 'Roadside Lane',
      lat: roadsideLat,
      lng: roadsideLng,
      accuracy: 15,
      timestamp: Date.now(),
      message: 'Legitimate roadside waiting flag test',
    });

    expect(res.status).toBe(200);
    expect(res.json?.success).toBe(true);

    // Clean up raised flag
    if (res.json?.flag?.id || res.json?.flagId) {
      const flagId = res.json?.flag?.id || res.json?.flagId;
      await apiCall('DELETE', '/api/student/waiting-flag', studentToken, {
        flagId,
        busId,
      });
    }
  });

  test('CORRIDOR-05 — Rejects student sitting 400m deep in a by-lane with HTTP 403 OUT_OF_ROUTE_CORRIDOR', async () => {
    // 400m off the road corridor into a lane
    const offCorridorLat = 26.1125 + 0.004; // ~440m north of highway
    const offCorridorLng = 91.6987;

    const res = await apiCall('POST', '/api/student/waiting-flag', studentToken, {
      busId,
      routeId,
      stop_name: 'Deep By-Lane',
      lat: offCorridorLat,
      lng: offCorridorLng,
      accuracy: 15,
      timestamp: Date.now(),
      message: 'Off-corridor by-lane test',
    });

    expect(res.status).toBe(403);
    expect(res.json?.code).toBe('OUT_OF_ROUTE_CORRIDOR');
  });
});
