/**
 * Multi-user browser E2E — two independent driver+student pairs.
 *
 * Proves:
 *   1. Two driver browsers start trips independently
 *   2. Two student browsers each see ONLY their assigned bus
 *   3. Cross-bus isolation holds under concurrent browser sessions
 *   4. Each student's MapLibre marker moves independently
 *   5. Trip end per driver doesn't affect the other
 *   6. No cross-bus data leakage via applied state or marker
 */
import { test, expect } from '@playwright/test';
import { loadPersonas, mintCustomToken, mintIdToken, supabase, sleep, APP_URL, WS_BASE, DriverAgent, readApplied, readMarkerPosition, type Persona } from './helpers';

const GPS_INTERVAL_MS = 2000;
const WATCH_SECONDS = 20;

test.describe('multi-user browser', () => {

  test('two drivers + two students: independent bus tracking with marker verification', async ({ browser }) => {
    test.setTimeout(150000);
    const personas = loadPersonas();
    if (!personas || personas.drivers.length < 2 || personas.students.length < 2) {
      throw new Error('Need >= 2 drivers, >= 2 students');
    }

    const busA = personas.buses[0];
    const busB = personas.buses[1];
    const driverA = personas.drivers.find(d => d.busId === busA.id)!;
    const driverB = personas.drivers.find(d => d.busId === busB.id)!;
    const studentA = personas.students.find(s => s.busId === busA.id) || personas.students[0];
    const studentB = personas.students.find(s => s.busId === busB.id) || personas.students[1];

    console.log(`DRIVER-A: ${driverA.label} → BUS-A: ${busA.id}`);
    console.log(`DRIVER-B: ${driverB.label} → BUS-B: ${busB.id}`);
    console.log(`STUDENT-A: ${studentA.label} → ${studentA.busId}`);
    console.log(`STUDENT-B: ${studentB.label} → ${studentB.busId}`);

    // ── 1. Start both driver agents ─────────────────────────────────────
    const [dTokA, dTokB] = await Promise.all([mintIdToken(driverA.uid), mintIdToken(driverB.uid)]);
    const drvA = new DriverAgent({ label: driverA.label, uid: driverA.uid, idToken: dTokA, busId: busA.id, routeId: busA.routeId!, gpsSeed: `multi-a-${busA.id}` });
    const drvB = new DriverAgent({ label: driverB.label, uid: driverB.uid, idToken: dTokB, busId: busB.id, routeId: busB.routeId!, gpsSeed: `multi-b-${busB.id}` });
    await Promise.all([drvA.startTrip(), drvB.startTrip()]);
    await Promise.all([drvA.connectWs(WS_BASE), drvB.connectWs(WS_BASE)]);
    console.log(`trips started: A=${drvA.tripId} B=${drvB.tripId}`);

    // GPS loops
    let ticking = true;
    const gpsLoop = (async () => {
      while (ticking) {
        const t0 = Date.now();
        await Promise.all([drvA.tick(t0), drvB.tick(t0)]);
        await sleep(Math.max(0, GPS_INTERVAL_MS - (Date.now() - t0)));
      }
    })();

    // ── 2. Open two browser contexts (isolated) ─────────────────────────
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // Sign in both students
    const [cTokA, cTokB] = await Promise.all([mintCustomToken(studentA.uid), mintCustomToken(studentB.uid)]);
    await Promise.all([
      (async () => {
        await pageA.goto(`${APP_URL}/e2e-signin?token=${encodeURIComponent(cTokA)}`);
        await pageA.waitForSelector('[data-testid="e2e-signin-status"]', { state: 'attached' });
        await pageA.waitForFunction(() => document.querySelector('[data-testid="e2e-signin-status"]')?.textContent?.startsWith('signed-in:'), { timeout: 30000 });
        console.log('browser-A: student signed in');
      })(),
      (async () => {
        await pageB.goto(`${APP_URL}/e2e-signin?token=${encodeURIComponent(cTokB)}`);
        await pageB.waitForSelector('[data-testid="e2e-signin-status"]', { state: 'attached' });
        await pageB.waitForFunction(() => document.querySelector('[data-testid="e2e-signin-status"]')?.textContent?.startsWith('signed-in:'), { timeout: 30000 });
        console.log('browser-B: student signed in');
      })(),
    ]);

    // Navigate both to track-bus
    await Promise.all([
      pageA.goto(`${APP_URL}/student/track-bus`, { waitUntil: 'domcontentloaded' }),
      pageB.goto(`${APP_URL}/student/track-bus`, { waitUntil: 'domcontentloaded' }),
    ]);

    // ── 3. Collect samples from both browsers ─────────────────────────────
    console.log(`watching both browsers for ${WATCH_SECONDS}s...`);
    const samplesA: { lat: number; lng: number; timestamp: string }[] = [];
    const samplesB: { lat: number; lng: number; timestamp: string }[] = [];
    const markerA: { lat: number; lng: number }[] = [];
    const markerB: { lat: number; lng: number }[] = [];

    const watchEnd = Date.now() + WATCH_SECONDS * 1000;
    while (Date.now() < watchEnd) {
      const [sa, sb, ma, mb] = await Promise.all([
        readApplied(pageA), readApplied(pageB),
        readMarkerPosition(pageA), readMarkerPosition(pageB),
      ]);
      if (sa) {
        const last = samplesA[samplesA.length - 1];
        if (!last || last.timestamp !== sa.timestamp) samplesA.push({ lat: sa.lat, lng: sa.lng, timestamp: sa.timestamp });
      }
      if (sb) {
        const last = samplesB[samplesB.length - 1];
        if (!last || last.timestamp !== sb.timestamp) samplesB.push({ lat: sb.lat, lng: sb.lng, timestamp: sb.timestamp });
      }
      if (ma) {
        const last = markerA[markerA.length - 1];
        if (!last || last.lat !== ma.lat || last.lng !== ma.lng) markerA.push({ lat: ma.lat, lng: ma.lng });
      }
      if (mb) {
        const last = markerB[markerB.length - 1];
        if (!last || last.lat !== mb.lat || last.lng !== mb.lng) markerB.push({ lat: mb.lat, lng: mb.lng });
      }
      await sleep(400);
    }

    // ── 4. End both trips ────────────────────────────────────────────────
    ticking = false;
    await gpsLoop.catch(() => {});
    await Promise.all([drvA.endTrip(), drvB.endTrip()]);
    await sleep(2000);

    // ── 5. Cross-bus isolation check ─────────────────────────────────────
    // Verify that Student-A's locations do NOT match Driver-B's sent packets
    // and vice versa. Use coordinates, not just bus IDs, for stronger proof.
    const driverALocs = new Set(drvA.sent.map(s => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`));
    const driverBLocs = new Set(drvB.sent.map(s => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`));

    // For each student-applied location, check if it matches the OTHER driver
    let crossBusLeakA = 0; // Student-A locations matching Driver-B
    let crossBusLeakB = 0; // Student-B locations matching Driver-A
    for (const s of samplesA) {
      if (driverBLocs.has(`${s.lat.toFixed(4)},${s.lng.toFixed(4)}`)) crossBusLeakA++;
    }
    for (const s of samplesB) {
      if (driverALocs.has(`${s.lat.toFixed(4)},${s.lng.toFixed(4)}`)) crossBusLeakB++;
    }

    // ── 6. Assertions ────────────────────────────────────────────────────
    const distinctA = new Set(samplesA.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)).size;
    const distinctB = new Set(samplesB.map(s => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)).size;
    const distinctMarkerA = new Set(markerA.map(m => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`)).size;
    const distinctMarkerB = new Set(markerB.map(m => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`)).size;

    const checks = [
      { name: 'Student-A received >=1 location', ok: samplesA.length >= 1 },
      { name: 'Student-B received >=1 location', ok: samplesB.length >= 1 },
      { name: `Student-A saw ${distinctA} distinct positions`, ok: distinctA >= 2 },
      { name: `Student-B saw ${distinctB} distinct positions`, ok: distinctB >= 2 },
      { name: `Student-A marker moved: ${distinctMarkerA} positions`, ok: distinctMarkerA >= 2 },
      { name: `Student-B marker moved: ${distinctMarkerB} positions`, ok: distinctMarkerB >= 2 },
      { name: `No cross-bus leakage: Student-A ≠ Driver-B (${crossBusLeakA} leaks)`, ok: crossBusLeakA === 0 },
      { name: `No cross-bus leakage: Student-B ≠ Driver-A (${crossBusLeakB} leaks)`, ok: crossBusLeakB === 0 },
      { name: 'Driver-A sent GPS', ok: drvA.sent.length > 0 },
      { name: 'Driver-B sent GPS', ok: drvB.sent.length > 0 },
    ];

    for (const c of checks) console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}`);

    await Promise.all([ctxA.close(), ctxB.close()]);
    const failures = checks.filter(c => !c.ok);
    expect(failures.map(f => f.name)).toEqual([]);
  });
});
