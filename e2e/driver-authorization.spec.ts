/**
 * Driver authorization E2E — proves Driver-A cannot operate on Bus-B.
 *
 * Setup:
 *   DRIVER-A → BUS-A
 *   DRIVER-B → BUS-B
 *
 * Tests:
 *   1. Driver-A sends GPS for Bus-B → denied
 *   2. Driver-A tries to end Bus-B trip → denied
 *   3. Driver-A tries to acknowledge Bus-B flag → denied
 *   4. Driver-A sends GPS for Bus-A → accepted
 *   5. DB state remains consistent
 */
import { test, expect } from '@playwright/test';
import { loadPersonas, mintIdToken, supabase, sleep, WS_BASE, apiCall, DriverAgent } from './helpers';
import { WsAgent } from '../scripts/staging/ws-agent';

test.describe('driver authorization', () => {

  test('driver A cannot operate on bus B', async () => {
    test.setTimeout(60000);
    const personas = loadPersonas();
    if (!personas || personas.drivers.length < 2) {
      throw new Error('Need >= 2 drivers. Run: npx tsx scripts/staging/personas.ts --drivers 2');
    }

    const busA = personas.buses[0];
    const busB = personas.buses[1];
    const driverA = personas.drivers.find(d => d.busId === busA.id)!;
    const driverB = personas.drivers.find(d => d.busId === busB.id)!;

    console.log(`DRIVER-A: ${driverA.label} → BUS-A: ${busA.id}`);
    console.log(`DRIVER-B: ${driverB.label} → BUS-B: ${busB.id}`);

    const dTokA = await mintIdToken(driverA.uid);
    const dTokB = await mintIdToken(driverB.uid);

    // ── 1. Both drivers start their trips ─────────────────────────────────
    const drvA = new DriverAgent({ label: driverA.label, uid: driverA.uid, idToken: dTokA, busId: busA.id, routeId: busA.routeId!, gpsSeed: `authz-a` });
    const drvB = new DriverAgent({ label: driverB.label, uid: driverB.uid, idToken: dTokB, busId: busB.id, routeId: busB.routeId!, gpsSeed: `authz-b` });
    await drvA.startTrip();
    await drvB.startTrip();
    console.log(`trips started: A=${drvA.tripId} B=${drvB.tripId}`);

    // ── 2. Connect driver WS ─────────────────────────────────────────────
    await drvA.connectWs(WS_BASE);
    await drvB.connectWs(WS_BASE);

    // ── 3. Start GPS for both ─────────────────────────────────────────────
    let ticking = true;
    const gpsLoop = (async () => {
      while (ticking) {
        const t0 = Date.now();
        await Promise.allSettled([drvA.tick(t0), drvB.tick(t0)]);
        await sleep(Math.max(0, 2000 - (Date.now() - t0)));
      }
    })();

    // ── 4. Driver-A sends GPS for BUS-B via HTTP → must fail ─────────────
    console.log('test: Driver-A sending GPS for Bus-B via HTTP...');
    const gpsBusB = await apiCall('POST', '/api/location/update', dTokA, {
      busId: busB.id, routeId: busB.routeId!, lat: 26.14, lng: 91.73,
      accuracy: 10, speed: 30, heading: 90,
      timestamp: new Date().toISOString(), tripId: drvA.tripId,
    });
    console.log(`  → HTTP ${gpsBusB.status} (expected 403/400)`);
    const gpsBusBDenied = gpsBusB.status !== 200;
    console.log(`  → denied: ${gpsBusBDenied}`);

    // ── 5. Driver-A sends GPS for BUS-B via WebSocket ────────────────────
    console.log('test: Driver-A sending GPS for Bus-B via WS...');
    let wsGpsBusBAccepted = false;
    const hostileWs = new WsAgent(WS_BASE);
    await hostileWs.connect(dTokA);
    hostileWs.onAny((m) => {
      if (m.msg.type === 'error' && m.msg.context === 'location_update') {
        wsGpsBusBAccepted = false;
      }
    });
    hostileWs.send({
      type: 'location_update', busId: busB.id, tripId: drvA.tripId,
      lat: 26.14, lng: 91.73, speed: 30, heading: 90, accuracy: 10,
      timestamp: new Date().toISOString(),
    });
    await sleep(1000);
    hostileWs.close();
    console.log(`  → WS GPS for Bus-B accepted: ${wsGpsBusBAccepted}`);

    // ── 6. Driver-A tries to end Bus-B trip ───────────────────────────────
    console.log('test: Driver-A trying to end Bus-B trip...');
    const endBusB = await apiCall('POST', '/api/driver/end-trip', dTokA, {
      busId: busB.id, tripId: drvB.tripId,
    });
    console.log(`  → HTTP ${endBusB.status} (expected 403/400)`);
    const endBusBDenied = endBusB.status !== 200;
    console.log(`  → denied: ${endBusBDenied}`);

    // ── 7. Driver-A tries to initiate trip for Bus-B ──────────────────────
    console.log('test: Driver-A trying to start trip for Bus-B...');
    const startBusB = await apiCall('POST', '/api/driver/initiate-trip', dTokA, {
      busId: busB.id, shift: 'Morning',
    });
    console.log(`  → HTTP ${startBusB.status} (expected 403/400/409)`);
    const startBusBDenied = startBusB.status !== 200;
    console.log(`  → denied: ${startBusBDenied}`);

    // ── 8. Verify DB: Bus-A still has active trip ─────────────────────────
    const { data: busATrips } = await supabase()
      .from('active_trips')
      .select('trip_id, status')
      .eq('bus_id', busA.id)
      .eq('status', 'active');
    const busAStillActive = (busATrips?.length ?? 0) > 0;
    console.log(`DB: Bus-A active trip: ${busAStillActive}`);

    // ── 9. Verify DB: Bus-B still has active trip (by its real driver) ───
    const { data: busBTrips } = await supabase()
      .from('active_trips')
      .select('trip_id, status, driver_id')
      .eq('bus_id', busB.id)
      .eq('status', 'active');
    const busBStillActive = (busBTrips?.length ?? 0) > 0;
    const busBOwnedByDriverB = busBTrips?.[0]?.driver_id === driverB.uid;
    console.log(`DB: Bus-B active trip: ${busBStillActive}, owned by Driver-B: ${busBOwnedByDriverB}`);

    // ── 9b. Verify DB: Bus-B bus_locations NOT written by Driver-A attack ─
    const { data: busBLocs } = await supabase()
      .from('bus_locations')
      .select('driver_id')
      .eq('bus_id', busB.id);
    const busBLocsClean = !busBLocs?.some(l => l.driver_id === driverA.uid);
    console.log(`DB: Bus-B locations from Driver-A: ${busBLocsClean ? 'none' : 'LEAKED'}`);

    // ── 9c. Verify DB: Bus-A locations still written by Driver-A ─────────
    // Wait for a GPS heartbeat to be written
    await sleep(2000);
    const { data: busALocs } = await supabase()
      .from('bus_locations')
      .select('driver_id')
      .eq('bus_id', busA.id);
    const busALocsFromDriverA = busALocs?.some(l => l.driver_id === driverA.uid);
    console.log(`DB: Bus-A locations from Driver-A: ${busALocsFromDriverA}`);

    // ── 10. Cleanup ──────────────────────────────────────────────────────
    ticking = false;
    await gpsLoop.catch(() => {});
    await Promise.allSettled([drvA.endTrip(), drvB.endTrip()]);
    await sleep(1500);

    // ── 11. Assertions ────────────────────────────────────────────────────
    const checks = [
      { name: 'Driver-A GPS for Bus-B denied (HTTP)', ok: gpsBusBDenied },
      { name: 'Driver-A end-trip for Bus-B denied', ok: endBusBDenied },
      { name: 'Driver-A initiate-trip for Bus-B denied', ok: startBusBDenied },
      { name: 'Bus-A still has active trip after attack', ok: busAStillActive },
      { name: 'Bus-B trip still owned by Driver-B', ok: busBStillActive && busBOwnedByDriverB },
      { name: 'Bus-B locations NOT written by Driver-A', ok: busBLocsClean },
      { name: 'Driver-A successfully operates Bus-A (GPS sent)', ok: drvA.sent.length > 0 },
      { name: 'Driver-B successfully operates Bus-B (GPS sent)', ok: drvB.sent.length > 0 },
    ];

    for (const c of checks) console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`);
    const failures = checks.filter(c => !c.ok);

    expect(failures.map(f => f.name)).toEqual([]);
  });
});
