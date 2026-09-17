/**
 * e2e/gps/gps-stale-packet.spec.ts
 *
 * Real-stack forensic verification of GPS ordering, replay protection,
 * impossible jumps, speed limits, and accuracy edge cases against /api/location/update.
 */

import { test, expect } from '@playwright/test';
import { loadPersonas, mintIdToken, apiCall, supabase, sleep, APP_URL } from '../helpers';
import { DriverAgent } from '../../scripts/staging/agents';

test.describe('GPS Pipeline Integrity & Invariants', () => {
  let driverToken: string;
  let driverUid: string;
  let busId: string;
  let routeId: string;
  let tripId: string;
  let driverAgent: DriverAgent;

  test.beforeAll(async () => {
    const personas = loadPersonas();
    if (!personas || !personas.drivers.length) throw new Error('Staging personas missing');
    const p = personas.drivers[0];
    driverUid = p.uid;
    busId = p.busId!;
    routeId = p.routeId!;

    driverToken = await mintIdToken(driverUid);
    driverAgent = new DriverAgent({
      label: p.label,
      uid: driverUid,
      idToken: driverToken,
      busId,
      routeId,
      gpsSeed: 'gps-stale-packet-test',
    });

    await driverAgent.startTrip();
    tripId = driverAgent.tripId!;
    console.log(`[TEST-SETUP] Trip started: ${tripId} for bus ${busId}`);
  });

  test.afterAll(async () => {
    if (driverAgent) {
      await driverAgent.endTrip().catch(() => {});
      console.log(`[TEST-TEARDOWN] Trip ended for bus ${busId}`);
    }
  });

  test('Q5 — Accepts valid initial on-route GPS packet', async () => {
    const now = new Date().toISOString();
    const res = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 26.1445,
      lng: 91.7362,
      accuracy: 8,
      speed: 30,
      heading: 85,
      timestamp: now,
    });

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
  });

  test('Q5 — Rejects stale / out-of-order GPS packet (timestamp older than last accepted)', async () => {
    // Current accepted time is ~now. We inject a packet with timestamp 30 seconds in the past.
    const staleTime = new Date(Date.now() - 30000).toISOString();
    const res = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 26.1450,
      lng: 91.7370,
      accuracy: 10,
      speed: 30,
      heading: 85,
      timestamp: staleTime,
    });

    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/out-of-order/i);
  });

  test('Q5 — Rejects impossible spatial jump (> 5000m)', async () => {
    // Current accepted position is ~26.1445, 91.7362. Jump 15 km away to 26.3000, 91.7362.
    const futureTime = new Date(Date.now() + 2000).toISOString();
    const res = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 26.3000,
      lng: 91.7362,
      accuracy: 10,
      speed: 30,
      heading: 85,
      timestamp: futureTime,
    });

    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/jump too large/i);
  });

  test('Q5 — Rejects impossible speed (> 200 km/h implied by time and distance)', async () => {
    // Move 1000m in 1 second (1000 m/s = 3600 km/h)
    const t0 = new Date(Date.now() + 4000).toISOString();
    const r0 = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 26.1450,
      lng: 91.7370,
      accuracy: 5,
      speed: 30,
      heading: 85,
      timestamp: t0,
    });
    expect(r0.status).toBe(200);

    const t1 = new Date(Date.now() + 5000).toISOString(); // 1 second later
    const r1 = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 26.1550, // ~1.1 km away in 1 second
      lng: 91.7370,
      accuracy: 5,
      speed: 30,
      heading: 85,
      timestamp: t1,
    });

    expect(r1.status).toBe(400);
    expect(r1.json.error).toMatch(/speed.*exceeds/i);
  });

  test('Q5 & Q26 — Rejects degraded GPS accuracy (> 150m)', async () => {
    const t = new Date(Date.now() + 8000).toISOString();
    const res = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 26.1452,
      lng: 91.7373,
      accuracy: 180, // > 150m cap
      speed: 30,
      heading: 85,
      timestamp: t,
    });

    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/accuracy.*exceeds threshold/i);
  });

  test('Q5 & Q26 — Rejects negative GPS accuracy', async () => {
    const t = new Date(Date.now() + 10000).toISOString();
    const res = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 26.1452,
      lng: 91.7373,
      accuracy: -5,
      speed: 30,
      heading: 85,
      timestamp: t,
    });

    expect(res.status).toBe(400);
  });

  test('Q5 & Q26 — Rejects Null Island coordinates (0, 0)', async () => {
    const t = new Date(Date.now() + 12000).toISOString();
    const res = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 0,
      lng: 0,
      accuracy: 10,
      speed: 30,
      heading: 85,
      timestamp: t,
    });

    expect(res.status).toBe(400);
  });

  test('Q5 & Q26 — Rejects non-finite / NaN coordinates', async () => {
    const t = new Date(Date.now() + 14000).toISOString();
    const res = await apiCall('POST', '/api/location/update', driverToken, {
      busId,
      routeId,
      tripId,
      lat: 'not-a-number' as any,
      lng: 91.7373,
      accuracy: 10,
      speed: 30,
      heading: 85,
      timestamp: t,
    });

    expect(res.status).toBe(400);
  });

  test('Q50 — Direct WebSocket GPS location injection does NOT mutate authoritative state', async () => {
    // Ordinary student tries to inject GPS via WebSocket
    const personas = loadPersonas()!;
    const student = personas.students[0];
    const sTok = await mintIdToken(student.uid);

    // Direct WebSocket connection
    const { default: WebSocket } = await import('ws');
    const rawWs = (process.env.STAGING_WS_URL || 'ws://127.0.0.1:3001').replace(/\/+$/, '');
    const wsUrl = rawWs.endsWith('/ws') ? rawWs : `${rawWs}/ws`;
    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.send(JSON.stringify({ type: 'auth', token: sTok }));
    await sleep(300);

    // Student attempts to send location_update
    ws.send(JSON.stringify({
      type: 'location_update',
      busId,
      lat: 26.9999,
      lng: 91.9999,
      accuracy: 5,
      speed: 40,
      heading: 90,
      timestamp: new Date().toISOString(),
    }));

    await sleep(500);
    ws.close();

    // Verify PostgreSQL bus_locations has NOT been mutated to 26.9999, 91.9999
    const { data: dbLoc } = await supabase()
      .from('bus_locations')
      .select('lat, lng')
      .eq('bus_id', busId)
      .maybeSingle();

    if (dbLoc) {
      expect(dbLoc.lat).not.toBe(26.9999);
      expect(dbLoc.lng).not.toBe(91.9999);
    }
  });
});
