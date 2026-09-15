/**
 * Cross-node Redis E2E — proves driver on WS1 reaches student on WS2 via Redis Pub/Sub.
 *
 * Setup:
 *   DRIVER → WS1 (port 3001)
 *   STUDENT → WS2 (port 3003)
 *   Redis runs as the message broker between nodes.
 *
 * Flow:
 *   1. Driver starts trip via HTTP (uses WS1 for realtime)
 *   2. Driver sends GPS via WS1
 *   3. Student connects to WS2, subscribes to bus_location
 *   4. Student receives the GPS update (via Redis fan-out from WS1 → WS2)
 *   5. Student receives subsequent GPS updates while driver continues moving
 *   6. Trip ends, marker clears on student
 *
 * Pre-requisites:
 *   - docker-compose up -d (ws1, ws2, redis, nextjs)
 *   - Personas seeded (npx tsx scripts/staging/personas.ts --drivers 2 --students 2)
 */
import { test, expect } from '@playwright/test';
import {
  loadPersonas,
  mintIdToken,
  mintCustomToken,
  supabase,
  sleep,
  APP_URL,
  WS_BASE,
  DriverAgent,
  readApplied,
  apiCall,
  type Persona,
} from './helpers';

// Hardcoded WS nodes for cross-node test
const WS_NODE1: string = 'ws://127.0.0.1:3001';
const WS_NODE2: string = 'ws://127.0.0.1:3003';

// Ensure nodes are different
if (WS_NODE1 === WS_NODE2) {
  throw new Error('WS_NODE1 and WS_NODE2 must be different');
}

const GPS_INTERVAL_MS = 2000;
const WATCH_SECONDS = 15;

test.describe('cross-node Redis fan-out', () => {
  test('driver on WS1 reaches student on WS2 via Redis', async ({ page }) => {
    test.setTimeout(180000);
    const personas = loadPersonas();
    if (!personas || personas.drivers.length < 1 || personas.students.length < 1) {
      throw new Error('Need >= 1 driver, >= 1 student. Run: npx tsx scripts/staging/personas.ts --drivers 2 --students 2');
    }

    // Use a dedicated bus for this test to avoid interference
    const busA = personas.buses[0];
    const driverA = personas.drivers.find((d) => d.busId === busA.id)!;
    const studentA = personas.students.find((s) => s.busId === busA.id) || personas.students[0];

    console.log(`DRIVER: ${driverA.label} → BUS-A: ${busA.id}`);
    console.log(`STUDENT: ${studentA.label} → BUS-A: ${studentA.busId}`);
    console.log(`WS1 (driver): ${WS_NODE1}`);
    console.log(`WS2 (student): ${WS_NODE2}`);

    // ── 1. Mint tokens ──────────────────────────────────────────────────────────
    const dTokA = await mintIdToken(driverA.uid);
    const sTokA = await mintCustomToken(studentA.uid);

    // ── 2. Driver: start trip via HTTP ────────────────────────────────────────
    const drv = new DriverAgent({
      label: driverA.label,
      uid: driverA.uid,
      idToken: dTokA,
      busId: busA.id,
      routeId: busA.routeId!,
      gpsSeed: `cross-${busA.id}`,
    });
    // Ensure bus moves along the route immediately rather than dwelling at terminal stop
    (drv.liveGps as any).posMeters = 50;
    (drv.liveGps as any).dwellUntilMs = 0;
    await drv.startTrip();
    console.log(`trip started: ${drv.tripId}`);

    // ── 3. Driver: connect to WS1 ─────────────────────────────────────────────
    await drv.connectWs(WS_NODE1);
    console.log(`driver connected to WS1`);

    // ── 4. Start driver GPS loop ──────────────────────────────────────────────
    let ticking = true;
    const gpsLoop = (async () => {
      while (ticking) {
        const t0 = Date.now();
        await drv.tick(t0, 1);
        await sleep(Math.max(0, GPS_INTERVAL_MS - (Date.now() - t0)));
      }
    })();

    // ── 5. Student: browser sign-in ───────────────────────────────────────────
    await page.goto(`${APP_URL}/e2e-signin?token=${encodeURIComponent(sTokA)}`);
    await page.waitForSelector('[data-testid="e2e-signin-status"]', { state: 'attached' });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="e2e-signin-status"]')?.textContent?.startsWith('signed-in:'),
      { timeout: 30000 }
    );
    console.log('browser: student signed in');

    // ── 6. Student: open track-bus (this connects to the default WS node) ────
    // We need the student to connect to WS2. The page uses NEXT_PUBLIC_WS_URL.
    // For this test, we override via environment or use a helper.
    // The track-bus page connects to the default WS URL from env.
    // To force WS2, we need to pass it as a query param or use a test hook.
    // We'll use the test hook: ?ws=ws2
    await page.goto(`${APP_URL}/student/track-bus?ws=${encodeURIComponent(WS_NODE2)}`, {
      waitUntil: 'domcontentloaded',
    });
    console.log(`student page loaded, connecting to WS2`);

    // ── 7. Wait for initial location (first GPS from driver) ─────────────────
    const samples: { lat: number; lng: number; timestamp: string }[] = [];
    console.log(`watching for location updates on student (WS2)...`);
    const watchEnd = Date.now() + 35000;
    while (Date.now() < watchEnd) {
      const s = await readApplied(page);
      if (s) {
        const last = samples[samples.length - 1];
        if (!last || last.timestamp !== s.timestamp) {
          samples.push({ lat: s.lat, lng: s.lng, timestamp: s.timestamp });
          console.log(`  sample #${samples.length}: ${s.lat.toFixed(5)},${s.lng.toFixed(5)} @ ${s.timestamp}`);
          const distinct = new Set(samples.map((x) => `${x.lat},${x.lng}`)).size;
          if (distinct >= 2 && samples.length >= 3) break;
        }
      }
      await sleep(400);
    }

    // ── 8. Stop GPS and end trip ──────────────────────────────────────────────
    ticking = false;
    await gpsLoop.catch(() => {});
    const endRes = await drv.endTrip();
    console.log(`endTrip response: status=${endRes.status}, json=`, JSON.stringify(endRes.json));
    await sleep(2000);

    // Check marker cleared
    let markerCleared = false;
    for (let i = 0; i < 25 && !markerCleared; i++) {
      const cur = await readApplied(page);
      markerCleared = cur === null;
      if (!markerCleared) {
        console.log(`  wait marker clear #${i + 1}: still has loc ts=${cur?.timestamp}`);
        await sleep(500);
      }
    }
    console.log(`trip ended, marker cleared: ${markerCleared}`);

    // ── 9. DB verification: active trip cleaned up ────────────────────────────
    const { data: activeTrips } = await supabase()
      .from('active_trips')
      .select('trip_id')
      .eq('bus_id', busA.id)
      .eq('status', 'active');
    const dbClean = (activeTrips?.length ?? 0) === 0;
    console.log(`DB: active trips for bus ${busA.id}: ${activeTrips?.length ?? 0}`);

    // ── 10. Student reconnects to WS2: verify NO stale snapshot ──────────────
    console.log('reconnecting student to WS2 to verify no stale snapshot...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const staleSnapshot = await readApplied(page);
    const noStaleSnapshot = staleSnapshot === null;
    console.log(`reconnect check: stale snapshot present = ${!noStaleSnapshot}`);

    // ── 11. Send late GPS: verify rejected by active_trips check ─────────────
    console.log('sending late GPS for ended trip to verify authoritative rejection...');
    const lateGpsRes = await apiCall('POST', '/api/location/update', dTokA, {
      busId: busA.id,
      tripId: drv.tripId,
      routeId: busA.routeId,
      lat: 26.1445,
      lng: 91.7362,
      timestamp: new Date().toISOString(),
    });
    const lateGpsRejected = lateGpsRes.status === 400 || lateGpsRes.status === 409 || lateGpsRes.json?.error === 'NO_ACTIVE_TRIP';
    console.log(`late GPS HTTP status: ${lateGpsRes.status}, error: ${JSON.stringify(lateGpsRes.json?.error)}`);

    // ── 12. Direct stale bus_locations DB verification ───────────────────────
    const { data: busLocs } = await supabase()
      .from('bus_locations')
      .select('bus_id, trip_id')
      .eq('bus_id', busA.id);
    const busLocsClean = (busLocs?.length ?? 0) === 0;
    console.log(`DB: bus_locations count for bus ${busA.id}: ${busLocs?.length ?? 0}`);

    // ── 13. Assertions ──────────────────────────────────────────────────────────
    const distinct = new Set(samples.map((s) => `${s.lat},${s.lng}`)).size;
    const driverSent = drv.sent.length;

    const checks = [
      {
        name: `Student on WS2 received >=1 location from driver on WS1`,
        ok: samples.length >= 1,
      },
      {
        name: `Student saw ${distinct} distinct positions (bus moving)`,
        ok: distinct >= 2,
      },
      {
        name: `Driver sent ${driverSent} GPS packets`,
        ok: driverSent >= 3,
      },
      {
        name: 'Trip end clears marker on student',
        ok: markerCleared,
      },
      {
        name: 'DB: active_trips cleaned up',
        ok: dbClean,
      },
      {
        name: 'Student reconnect to WS2 has NO stale snapshot',
        ok: noStaleSnapshot,
      },
      {
        name: 'Late GPS rejected authoritatively by active_trips check',
        ok: lateGpsRejected,
      },
      {
        name: 'DB: bus_locations cleared on trip end',
        ok: busLocsClean,
      },
    ];

    for (const c of checks) console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`);
    const failures = checks.filter((c) => !c.ok);

    expect(failures.map((f) => f.name)).toEqual([]);
  });
});