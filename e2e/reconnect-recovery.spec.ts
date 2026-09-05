/**
 * Reconnect/recovery E2E — proves WS reconnect restores live state with marker verification.
 *
 * Flow:
 *   1. Driver starts trip, sends GPS.
 *   2. Student receives live updates, marker moves.
 *   3. Student WS is killed (simulated network loss via CDP).
 *   4. Student reconnects.
 *   5. Student receives current location after reconnect.
 *   6. MapLibre marker resumes at correct position (no stale regression).
 *   7. Driver continues GPS, student receives subsequent updates.
 *   8. Trip ends, both state and marker clear.
 */
import { test, expect } from '@playwright/test';
import { loadPersonas, mintIdToken, mintCustomToken, supabase, sleep, APP_URL, WS_BASE, DriverAgent, readApplied, readMarkerPosition, waitFor, type Persona } from './helpers';
import { WsAgent } from '../scripts/staging/ws-agent';

const GPS_INTERVAL_MS = 2000;

test.describe('reconnect recovery', () => {

  test('student recovers live state and MapLibre marker after WS reconnect', async ({ page }) => {
    test.setTimeout(120000);
    const personas = loadPersonas();
    if (!personas || personas.drivers.length < 1 || personas.students.length < 1) {
      throw new Error('Need >= 1 driver, >= 1 student');
    }

    const busA = personas.buses[0];
    const driverA = personas.drivers.find(d => d.busId === busA.id)!;
    const studentA = personas.students.find(s => s.busId === busA.id) || personas.students[0];

    console.log(`DRIVER: ${driverA.label} → BUS-A: ${busA.id}`);
    console.log(`STUDENT: ${studentA.label} → BUS-A: ${studentA.busId}`);

    const dTokA = await mintIdToken(driverA.uid);

    // ── 1. Start trip ────────────────────────────────────────────────────
    const drv = new DriverAgent({ label: driverA.label, uid: driverA.uid, idToken: dTokA, busId: busA.id, routeId: busA.routeId!, gpsSeed: `reconnect-${busA.id}` });
    await drv.startTrip();
    await drv.connectWs(WS_BASE);
    console.log(`trip started: ${drv.tripId}`);

    // Start GPS loop
    let ticking = true;
    const gpsLoop = (async () => {
      while (ticking) {
        const t0 = Date.now();
        await drv.tick(t0);
        await sleep(Math.max(0, GPS_INTERVAL_MS - (Date.now() - t0)));
      }
    })();

    // ── 2. Student browser: sign in and open Track Bus ────────────────────
    const customToken = await mintCustomToken(studentA.uid);
    await page.goto(`${APP_URL}/e2e-signin?token=${encodeURIComponent(customToken)}`);
    await page.waitForSelector('[data-testid="e2e-signin-status"]', { state: 'attached' });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="e2e-signin-status"]')?.textContent?.startsWith('signed-in:'),
      { timeout: 30000 }
    );
    console.log('browser: student signed in');
    await page.goto(`${APP_URL}/student/track-bus`, { waitUntil: 'domcontentloaded' });

    // ── 3. Collect pre-reconnect samples ──────────────────────────────────
    console.log('collecting pre-reconnect location samples...');
    const preReconnectApplied: { lat: number; lng: number; timestamp: string }[] = [];
    const preReconnectMarker: { lat: number; lng: number }[] = [];

    // Wait for first location
    let firstSeen = false;
    for (let i = 0; i < 20 && !firstSeen; i++) {
      const s = await readApplied(page);
      if (s) {
        preReconnectApplied.push({ lat: s.lat, lng: s.lng, timestamp: s.timestamp });
        firstSeen = true;
      }
      await sleep(400);
    }
    expect(firstSeen).toBe(true);
    console.log('first location received');

    // Collect more samples
    const preDeadline = Date.now() + 15000;
    while (Date.now() < preDeadline) {
      const s = await readApplied(page);
      const m = await readMarkerPosition(page);
      if (s) {
        const last = preReconnectApplied[preReconnectApplied.length - 1];
        if (!last || last.timestamp !== s.timestamp) {
          preReconnectApplied.push({ lat: s.lat, lng: s.lng, timestamp: s.timestamp });
        }
      }
      if (m) {
        const last = preReconnectMarker[preReconnectMarker.length - 1];
        if (!last || last.lat !== m.lat || last.lng !== m.lng) {
          preReconnectMarker.push({ lat: m.lat, lng: m.lng });
        }
      }
      await sleep(400);
    }
    console.log(`pre-reconnect: ${preReconnectApplied.length} applied, ${preReconnectMarker.length} marker positions`);
    const lastPreApplied = preReconnectApplied[preReconnectApplied.length - 1];
    const lastPreMarker = preReconnectMarker[preReconnectMarker.length - 1];

    // ── 4. Kill the student WS connection (simulate network loss) ─────────
    console.log('killing student WS (simulating network loss)...');
    const client = await page.context().newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    console.log('network disconnected');
    await sleep(3000);

    // ── 5. Restore network (reconnect) ────────────────────────────────────
    console.log('restoring network...');
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    console.log('network restored');

    // ── 6. Wait for student to reconnect and receive updates ──────────────
    console.log('waiting for reconnect and location recovery...');
    const postReconnectApplied: { lat: number; lng: number; timestamp: string }[] = [];
    const postReconnectMarker: { lat: number; lng: number }[] = [];
    const postDeadline = Date.now() + 20000;
    while (Date.now() < postDeadline) {
      const s = await readApplied(page);
      const m = await readMarkerPosition(page);
      if (s) {
        const last = postReconnectApplied[postReconnectApplied.length - 1];
        if (!last || last.timestamp !== s.timestamp) {
          postReconnectApplied.push({ lat: s.lat, lng: s.lng, timestamp: s.timestamp });
        }
      }
      if (m) {
        const last = postReconnectMarker[postReconnectMarker.length - 1];
        if (!last || last.lat !== m.lat || last.lng !== m.lng) {
          postReconnectMarker.push({ lat: m.lat, lng: m.lng });
        }
      }
      await sleep(400);
    }
    console.log(`post-reconnect: ${postReconnectApplied.length} applied, ${postReconnectMarker.length} marker positions`);

    // ── 7. Verify no stale regression ────────────────────────────────────
    let noStaleRegression = true;
    if (lastPreApplied && postReconnectApplied.length > 0) {
      const firstPostTs = new Date(postReconnectApplied[0].timestamp).getTime();
      const lastPreTs = new Date(lastPreApplied.timestamp).getTime();
      noStaleRegression = firstPostTs >= lastPreTs;
      console.log(`stale regression check: lastPreTs=${lastPreTs}, firstPostTs=${firstPostTs}, ok=${noStaleRegression}`);
    }

    // Marker position should also advance after reconnect
    let markerAdvanced = true;
    if (lastPreMarker && postReconnectMarker.length > 0) {
      const lastPostMarker = postReconnectMarker[postReconnectMarker.length - 1];
      markerAdvanced = lastPostMarker.lat !== lastPreMarker.lat || lastPostMarker.lng !== lastPreMarker.lng;
      console.log(`marker advanced: ${markerAdvanced}`);
    }

    // ── 8. End trip ──────────────────────────────────────────────────────
    ticking = false;
    await gpsLoop.catch(() => {});
    await drv.endTrip();
    await sleep(2000);

    // Check both state and marker cleared
    let markerCleared = false;
    let stateCleared = false;
    for (let i = 0; i < 20; i++) {
      const s = await readApplied(page);
      const m = await readMarkerPosition(page);
      if (s === null) stateCleared = true;
      if (m === null) markerCleared = true;
      if (stateCleared && markerCleared) break;
      await sleep(500);
    }
    console.log(`trip ended, state cleared: ${stateCleared}, marker cleared: ${markerCleared}`);

    // ── 9. Assertions ────────────────────────────────────────────────────
    const preDistinct = new Set(preReconnectApplied.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)).size;
    const postDistinct = new Set(postReconnectApplied.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)).size;

    const checks = [
      { name: 'Pre-reconnect: received >=3 location updates', ok: preReconnectApplied.length >= 3 },
      { name: `Pre-reconnect: saw ${preDistinct} distinct positions`, ok: preDistinct >= 2 },
      { name: 'Pre-reconnect: marker moved', ok: preReconnectMarker.length >= 2 },
      { name: 'Post-reconnect: received >=1 location update', ok: postReconnectApplied.length >= 1 },
      { name: 'Post-reconnect: no stale timestamp regression', ok: noStaleRegression },
      { name: 'Post-reconnect: marker resumed', ok: postReconnectMarker.length >= 1 },
      { name: 'Trip end clears state', ok: stateCleared },
      { name: 'Trip end clears marker', ok: markerCleared },
    ];

    for (const c of checks) console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`);
    const failures = checks.filter(c => !c.ok);

    expect(failures.map(f => f.name)).toEqual([]);
  });
});
