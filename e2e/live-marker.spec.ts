/**
 * Live marker E2E — proves actual MapLibre marker follows live GPS.
 *
 * This test proves:
 *   1. Driver sends GPS → student receives and applies updates
 *   2. Actual MapLibre marker position advances (not just React state)
 *   3. Timestamps are monotonic (no stale regression)
 *   4. Driver-sent packets correlate with student-applied state
 *   5. Trip end clears both state and marker
 */
import { test, expect } from '@playwright/test';
import { loadPersonas, mintCustomToken, mintIdToken, writeReport, gitCommit, sleep, APP_URL, WS_BASE } from '../scripts/staging/lib';
import { DriverAgent } from '../scripts/staging/agents';
import { readApplied, readMarkerPosition } from './helpers';

const WATCH_SECONDS = 30;
const MIN_DISTINCT_POSITIONS = 6;

test('live bus marker keeps moving with MapLibre verification', async ({ page }) => {
  test.setTimeout(90000);
  const personas = loadPersonas();
  if (!personas) throw new Error('seed personas first');
  const dp = personas.drivers[0];
  const sp = personas.students.find((s) => s.busId === dp.busId) || personas.students[0];

  console.log(`driver=${dp.label} (${dp.busId})  student=${sp.label} (browser)`);

  // Driver (headless, real APIs)
  const dTok = await mintIdToken(dp.uid);
  const driver = new DriverAgent({ label: dp.label, uid: dp.uid, idToken: dTok, busId: dp.busId!, routeId: dp.routeId!, gpsSeed: `e2e-${dp.busId}` });
  await driver.startTrip();
  await driver.connectWs(WS_BASE);
  console.log(`driver trip started: ${driver.tripId}`);
  let ticking = true;
  const tickLoop = (async () => {
    while (ticking) {
      const t0 = Date.now();
      await driver.tick(t0).catch(() => {});
      const spent = Date.now() - t0;
      await sleep(Math.max(0, 2000 - spent));
    }
  })();

  // Student (real browser)
  const customToken = await mintCustomToken(sp.uid);
  await page.goto(`${APP_URL}/e2e-signin?token=${encodeURIComponent(customToken)}`);
  await page.waitForSelector('[data-testid="e2e-signin-status"]', { state: 'attached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="e2e-signin-status"]')?.textContent?.startsWith('signed-in:'),
    { timeout: 30000 }
  );
  const status = await page.locator('[data-testid="e2e-signin-status"]').textContent();
  console.log(`browser auth: ${status}`);

  console.log('browser: opening /student/track-bus ...');
  await page.goto(`${APP_URL}/student/track-bus`, { waitUntil: 'domcontentloaded' });

  const appliedSamples: { lat: number; lng: number; timestamp: string }[] = [];
  const markerSamples: { lat: number; lng: number; atMs: number }[] = [];

  console.log(`watching marker state for ${WATCH_SECONDS}s while driver moves...`);
  const watchEnd = Date.now() + WATCH_SECONDS * 1000;
  while (Date.now() < watchEnd) {
    const s = await readApplied(page);
    const m = await readMarkerPosition(page);
    if (s) {
      const last = appliedSamples[appliedSamples.length - 1];
      if (!last || last.timestamp !== s.timestamp) {
        appliedSamples.push({ lat: s.lat, lng: s.lng, timestamp: s.timestamp });
        if (appliedSamples.length <= 3 || appliedSamples.length % 5 === 0) {
          console.log(`  applied #${appliedSamples.length}: ${s.lat.toFixed(5)},${s.lng.toFixed(5)} @ ${s.timestamp}`);
        }
      }
    }
    if (m) {
      const last = markerSamples[markerSamples.length - 1];
      if (!last || last.lat !== m.lat || last.lng !== m.lng) {
        markerSamples.push({ lat: m.lat, lng: m.lng, atMs: m.atMs });
      }
    }
    await sleep(400);
  }

  // Trip end → marker must clear
  console.log('ending trip; watching for marker clear...');
  ticking = false;
  await driver.endTrip();
  let sawTripEnded = false;
  let sawMarkerCleared = false;
  const clearDeadline = Date.now() + 10000;
  while (Date.now() < clearDeadline) {
    const s = await readApplied(page);
    const m = await readMarkerPosition(page);
    if (s === null && !sawTripEnded) sawTripEnded = true;
    if (m === null && !sawMarkerCleared) sawMarkerCleared = true;
    if (sawTripEnded && sawMarkerCleared) break;
    await sleep(500);
  }

  await tickLoop.catch(() => {});

  // Assertions
  const distinctApplied = new Set(appliedSamples.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)).size;
  const distinctMarker = new Set(markerSamples.map((m) => `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`)).size;

  // Correlate driver-sent with student-applied
  const sentKeySet = new Set(driver.sent.map((s) => s.key));
  const matchedKeys = appliedSamples.filter((s) => {
    const key = `${dp.uid}|${s.timestamp}`;
    return sentKeySet.has(key);
  });

  const monotonic = appliedSamples.every((s, i) =>
    i === 0 || new Date(s.timestamp).getTime() >= new Date(appliedSamples[i - 1].timestamp).getTime()
  );
  const markerMonotonic = markerSamples.every((m, i) =>
    i === 0 || m.atMs >= markerSamples[i - 1].atMs
  );

  const checks = [
    { name: 'Initial location applied', ok: appliedSamples.length >= 1 },
    { name: `Applied advanced through >= ${MIN_DISTINCT_POSITIONS} distinct positions`, ok: distinctApplied >= MIN_DISTINCT_POSITIONS },
    { name: `MapLibre marker moved through >= 2 distinct positions`, ok: distinctMarker >= 2, detail: `${distinctMarker} positions` },
    { name: 'Applied updates correlate to driver-sent packets', ok: matchedKeys.length === appliedSamples.length && appliedSamples.length > 0, detail: `${matchedKeys.length}/${appliedSamples.length}` },
    { name: 'Applied timestamps monotonic (no stale regression)', ok: monotonic },
    { name: 'Marker timestamps monotonic', ok: markerMonotonic },
    { name: 'Driver actually moved', ok: driver.sent.length >= 5, detail: `${driver.sent.length} sent` },
    { name: 'Trip end clears applied state', ok: sawTripEnded },
    { name: 'Trip end clears MapLibre marker', ok: sawMarkerCleared },
  ];

  for (const c of checks) console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  const failures = checks.filter(c => !c.ok).map(c => c.name);

  const pass = failures.length === 0;
  const report = {
    timestamp: new Date().toISOString(),
    gitCommit: gitCommit(),
    test: 'e2e-live-marker-playwright',
    driver: { label: dp.label, busId: dp.busId, packetsSent: driver.sent.length, httpFailures: driver.failures },
    student: { label: sp.label, browser: 'playwright/chromium' },
    watchSeconds: WATCH_SECONDS,
    appliedSamples: appliedSamples.length,
    markerSamples: markerSamples.length,
    distinctAppliedPositions: distinctApplied,
    distinctMarkerPositions: distinctMarker,
    checks,
    pass,
    failures,
  };
  const { jsonPath, mdPath } = writeReport('e2e-marker-playwright', report as any);
  console.log(`\nE2E live-marker (Playwright): ${pass ? 'PASS' : 'FAIL'}`);
  console.log(`reports:\n  ${jsonPath}\n  ${mdPath}`);

  expect(pass).toBe(true);
});
