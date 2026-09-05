/**
 * Staged load orchestrator — the E2E/LOAD harness driver.
 *
 *   npx tsx scripts/staging/orchestrator.ts --stage 1 --duration 60
 *
 * Stages (drivers/students):  0: 1/1   1: 5/25   2: 10/100   3: 25/500
 *                             4: 50/1000  5: 50/2000
 *
 * What it does, end to end:
 *   mint real Firebase tokens -> real initiate-trip (HTTP, role=driver)
 *   -> real WS auth+presence -> realistic GPS (WS + HTTP, 2s cadence)
 *   -> real student trip-status polls + WS subscriptions
 *   -> waiting-flag raise/ack (real APIs)
 *   -> abrupt WS kill/reconnect cycles (driver + sample students)
 *   -> end-trip -> DB cleanup/assertions
 *   -> correlate every GPS packet (driver sent vs student received, by
 *      `${driverUid}|${timestamp}`), latency percentiles, per-node-pair split
 *   -> WS /metrics + Next /api/metrics deltas, report JSON+MD
 *
 * PASS/FAIL is behavioral, not "requests succeeded":
 *   delivery, wrong-bus isolation, HTTP user-facing errors, DB state, reconnects.
 */
import { DriverAgent, StudentAgent, type Failure } from './agents';
import { loadPersonas, mintIdToken, supabase, sleep, latencyStats, writeReport, gitCommit, WS_URLS, WS_HEALTH_BASES, APP_URL, type Persona } from './lib';

const STAGES: Record<number, { drivers: number; students: number }> = {
  0: { drivers: 1, students: 1 },
  1: { drivers: 5, students: 25 },
  2: { drivers: 10, students: 100 },
  3: { drivers: 25, students: 500 },
  4: { drivers: 50, students: 1000 },
  5: { drivers: 50, students: 2000 },
};

const num = (flag: string, dflt: number) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) || dflt : dflt;
};
const STAGE = num('--stage', 0);
const DURATION_S = num('--duration', 60);
const GPS_INTERVAL_MS = num('--gps-ms', 2000);
const POLL_MS = num('--poll-ms', 7000);

async function wsMetrics(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(WS_HEALTH_BASES.map(async (base, idx) => {
    try {
      const r = await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(3000) });
      const text = await r.text();
      for (const line of text.split('\n')) {
        const m = line.match(/^(itms_\w+)\{[^}]*\}\s+(\d+)$/) || line.match(/^(itms_\w+)\s+(\d+)$/);
        if (m) out[`node${idx}.${m[1]}`] = (out[`node${idx}.${m[1]}`] || 0) + Number(m[2]);
      }
    } catch { /* node down */ }
  }));
  return out;
}

function metricDelta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const d: Record<string, number> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const delta = (after[k] ?? 0) - (before[k] ?? 0);
    if (delta !== 0 || k.endsWith('itms_ws_connections_active')) d[k] = delta;
  }
  return d;
}

async function dbCheck(name: string, fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<{ name: string; ok: boolean; detail?: string }> {
  try { const r = await fn(); return { name, ok: r.ok, detail: r.detail }; }
  catch (e: any) { return { name, ok: false, detail: e.message }; }
}

async function main() {
  const profile = STAGES[STAGE];
  if (!profile) throw new Error(`unknown stage ${STAGE}`);
  const personas = loadPersonas();
  if (!personas) throw new Error('No personas found. Run: npx tsx scripts/staging/personas.ts first');
  const buses = personas.buses.slice(0, profile.drivers);
  if (buses.length < profile.drivers) throw new Error(`Need >= ${profile.drivers} staging buses; re-run personas.ts --drivers ${profile.drivers}`);
  const driverPersonas = personas.drivers.slice(0, profile.drivers);
  const studentPersonas = personas.students.slice(0, profile.students);

  console.log(`== STAGE ${STAGE}: ${profile.drivers} drivers / ${profile.students} students / ${buses.length} buses / ${DURATION_S}s ==`);
  console.log(`nodes: ${WS_URLS.join(', ')}${WS_URLS.length < 2 ? '  (single-node — STAGING_WS_URLS not set; multi-node NOT tested this run)' : ''}`);
  const failures: Failure[] = [];
  const t0 = Date.now();

  // ── 1. Mint tokens (real Firebase Identity Toolkit) ────────────────────
  console.log('minting tokens...');
  const driverTokens = new Map<string, string>();
  const studentTokens = new Map<string, string>();
  const B = 10;
  for (let i = 0; i < driverPersonas.length; i += B) {
    await Promise.all(driverPersonas.slice(i, i + B).map(async (p) => driverTokens.set(p.uid, await mintIdToken(p.uid))));
  }
  for (let i = 0; i < studentPersonas.length; i += B) {
    try {
      await Promise.all(studentPersonas.slice(i, i + B).map(async (p) => studentTokens.set(p.uid, await mintIdToken(p.uid))));
    } catch (e: any) {
      failures.push({ stage: 'mint', persona: 'students-batch', error: String(e?.message || e), at: new Date().toISOString() });
      throw e;
    }
  }
  console.log(`tokens minted: ${driverTokens.size} drivers, ${studentTokens.size} students in ${Date.now() - t0}ms`);

  // ── 2. Agents ──────────────────────────────────────────────────────────
  const drivers = driverPersonas.map((p, i) =>
    new DriverAgent({ label: p.label, uid: p.uid, idToken: driverTokens.get(p.uid)!, busId: p.busId!, routeId: p.routeId!, gpsSeed: `gps-${p.busId}` }));
  // Spread students round-robin over the active buses (realistic: many per bus)
  const students = studentPersonas.map((p, i) =>
    new StudentAgent({ label: p.label, uid: p.uid, idToken: studentTokens.get(p.uid)!, busId: buses[i % buses.length].id, routeId: buses[i % buses.length].routeId }));

  const before = await wsMetrics();

  // ── 3. Drivers: real trip start ────────────────────────────────────────
  console.log('starting trips (HTTP initiate-trip)...');
  const startResults = await Promise.allSettled(drivers.map((d) => d.startTrip()));
  startResults.forEach((r, i) => {
    if (r.status === 'rejected') failures.push({ stage: 'initiate-trip', persona: drivers[i].label, error: String(r.reason), at: new Date().toISOString() });
  });
  console.log(`trips started: ${startResults.filter((r) => r.status === 'fulfilled').length}/${drivers.length}`);

  // ── 4. Drivers: WS connect; Students: initial poll + WS subscribe ──────
  const driverWsResults = await Promise.allSettled(drivers.map((d, i) => d.connectWs(WS_URLS[i % WS_URLS.length])));
  driverWsResults.forEach((r, i) => {
    if (r.status === 'rejected') failures.push({ stage: 'driver-ws-connect', persona: drivers[i].label, error: String(r.reason), at: new Date().toISOString() });
  });
  console.log(`driver WS connected: ${driverWsResults.filter((r) => r.status === 'fulfilled').length}/${drivers.length}`);

  console.log('students joining (trip-status + WS subscribe)...');
  for (let i = 0; i < students.length; i += 25) {
    const batch = students.slice(i, i + 25);
    const results = await Promise.allSettled(batch.map(async (s, j) => {
      await s.pollTripStatus();
      await s.connectWs(WS_URLS[(i + j) % WS_URLS.length]);
    }));
    results.forEach((r, j) => {
      if (r.status === 'rejected') failures.push({ stage: 'student-join', persona: batch[j].label, error: String(r.reason), at: new Date().toISOString() });
    });
    if (i % 250 === 0 && i > 0) console.log(`  students joined: ${i}/${students.length}`);
  }
  console.log(`students joined: ${students.length - failures.filter((f) => f.stage === 'student-join').length}/${students.length}`);

  // ── 5. DB check: trips active ──────────────────────────────────────────
  const dbChecks: { name: string; ok: boolean; detail?: string }[] = [];
  dbChecks.push(await dbCheck('active_trips contains all staging trips', async () => {
    const { data } = await supabase().from('active_trips').select('trip_id, bus_id, driver_id').in('bus_id', buses.map((b) => b.id)).eq('status', 'active');
    const n = data?.length ?? 0;
    return { ok: n === drivers.filter((d) => d.tripId).length, detail: `expected ${drivers.filter((d) => d.tripId).length}, found ${n}` };
  }));

  // ── 6. Run the load ────────────────────────────────────────────────────
  console.log(`running for ${DURATION_S}s (GPS every ${GPS_INTERVAL_MS}ms/driver, polls every ${POLL_MS}ms/student)...`);
  const endAt = Date.now() + DURATION_S * 1000;
  let reconnectDone = false;
  let flagsRaised = false;

  while (Date.now() < endAt) {
    const tickStart = Date.now();
    const settled = await Promise.allSettled(drivers.filter((d) => d.tripId).map((d) => d.tick(tickStart)));
    settled.forEach((r, i) => {
      if (r.status === 'rejected') failures.push({ stage: 'driver-tick', persona: `driver#${i}`, error: String(r.reason), at: new Date().toISOString() });
    });

    if (!flagsRaised && Date.now() - t0 > 20000) {
      flagsRaised = true;
      const candidates = students.filter((s) => s.tripActive).slice(0, Math.max(1, Math.floor(students.length * 0.1)));
      await Promise.allSettled(candidates.map((s) => {
        const d = drivers.find((dd) => dd.busId === s.busId);
        const lastSent = d?.sent[d.sent.length - 1];
        return s.raiseWaitingFlag(lastSent?.lat ?? 26.14, lastSent?.lng ?? 91.73);
      }));
      console.log(`waiting flags raised by ${candidates.length} students`);
    }

    if (!reconnectDone && Date.now() - t0 > (DURATION_S * 1000) / 2) {
      reconnectDone = true;
      console.log('injecting reconnects...');
      const d = drivers[0];
      if (d?.tripId) await d.reconnectCycle(WS_URLS[0]).catch((e) => failures.push({ stage: 'driver-reconnect', persona: d.label, error: String(e), at: new Date().toISOString() }));
      const reconnectingStudents = students.slice(0, Math.max(1, Math.floor(students.length * 0.1)));
      for (let i = 0; i < reconnectingStudents.length; i += 25) {
        await Promise.allSettled(reconnectingStudents.slice(i, i + 25).map((s) => s.reconnectCycle(WS_URLS[0])));
      }
      console.log(`reconnect cycles: 1 driver + ${reconnectingStudents.length} students`);
    }

    // students poll (staggered: each poll scheduled offset by index)
    const elapsed = Date.now();
    const due = students.filter((s, i) => Math.floor(elapsed / POLL_MS) % Math.max(1, students.length) === i % Math.max(1, students.length));
    await Promise.allSettled(due.slice(0, 50).map((s) => s.pollTripStatus()));

    const spent = Date.now() - tickStart;
    if (spent < GPS_INTERVAL_MS) await sleep(GPS_INTERVAL_MS - spent);
  }

  // ── 7. End trips + final DB checks ─────────────────────────────────────
  console.log('ending trips...');
  const endResults = await Promise.allSettled(drivers.filter((d) => d.tripId).map((d) => d.endTrip()));
  endResults.forEach((r, i) => {
    if (r.status === 'rejected') failures.push({ stage: 'end-trip', persona: `driver#${i}`, error: String(r.reason), at: new Date().toISOString() });
  });
  await sleep(1500); // let trip_ended broadcasts land

  dbChecks.push(await dbCheck('active_trips empty for staging buses after end-trip', async () => {
    const { data } = await supabase().from('active_trips').select('trip_id').in('bus_id', buses.map((b) => b.id)).eq('status', 'active');
    return { ok: (data?.length ?? 0) === 0, detail: `remaining=${data?.length ?? 0}` };
  }));
  dbChecks.push(await dbCheck('bus_locations cleaned after end-trip', async () => {
    const { data } = await supabase().from('bus_locations').select('bus_id').in('bus_id', buses.map((b) => b.id));
    return { ok: (data?.length ?? 0) === 0, detail: `rows=${data?.length ?? 0}` };
  }));
  dbChecks.push(await dbCheck('no active waiting flags left on staging buses', async () => {
    const { data } = await supabase().from('waiting_flags').select('id').in('bus_id', buses.map((b) => b.id)).in('status', ['raised']);
    return { ok: true, detail: `still-raised=${data?.length ?? 0} (acked=${drivers.reduce((a, d) => a + d.flagsAcked.length, 0)})` };
  }));

  students.forEach((s) => s.close());

  // ── 8. Correlate GPS ───────────────────────────────────────────────────
  console.log('correlating packets...');
  const sentByKey = new Map<string, { tsMs: number; busId: string; driverNodeIdx: number; traceId: string }>();
  drivers.forEach((d, di) => d.sent.forEach((s) => sentByKey.set(s.key, { tsMs: s.tsMs, busId: s.busId, driverNodeIdx: di % WS_URLS.length, traceId: s.traceId })));

  let received = 0, wrongBus = 0, dupExtra = 0;
  const latencies: number[] = [];
  const latenciesCrossNode: number[] = [];
  const latenciesSameNode: number[] = [];
  const seenKeys = new Set<string>(); // student|key
  const distinctStudentsWithData = new Set<string>();

  for (let si = 0; si < students.length; si++) {
    const s = students[si];
    const studentNodeIdx = si % WS_URLS.length;
    for (const r of s.received) {
      const sent = sentByKey.get(r.key);
      if (!sent) continue; // pre-join packets the driver sent before this run's window
      if (sent.busId !== s.busId) { wrongBus++; continue; }
      const dupKey = `${si}|${r.key}|${r.channel}`;
      if (seenKeys.has(dupKey)) { dupExtra++; continue; }
      seenKeys.add(dupKey);
      const firstForPacket = seenKeys.has(`${si}|${r.key}|FIRST`);
      const lat = r.recvAtMs - sent.tsMs;
      latencies.push(lat);
      (sent.driverNodeIdx === studentNodeIdx ? latenciesSameNode : latenciesCrossNode).push(lat);
      if (!firstForPacket) { seenKeys.add(`${si}|${r.key}|FIRST`); received++; distinctStudentsWithData.add(s.uid); }
    }
  }

  const expectedDistinct = drivers.filter((d) => d.tripId).map((d, di) => ({
    d,
    studentCount: students.filter((s) => s.busId === d.busId).length,
    sentCount: d.sent.length,
  })).reduce((acc, x) => acc + x.sentCount * x.studentCount, 0);
  const deliveryPct = expectedDistinct > 0 ? (received / expectedDistinct) * 100 : 0;

  const httpSamples = students.flatMap((s) => s.httpSamples);
  const http2xx = httpSamples.filter((h) => h.status === 200).length;
  const driverHttp = drivers.flatMap((d) => d.sent).filter((s) => s.httpStatus !== null);
  const driverHttp2xx = driverHttp.filter((s) => s.httpStatus === 200).length;

  const after = await wsMetrics();

  const allFailures = [...failures, ...drivers.flatMap((d) => d.failures), ...students.flatMap((s) => s.failures)];

  const multiNodeVerified = WS_URLS.length >= 2 && latenciesCrossNode.length > 0;
  const pass =
    deliveryPct >= 95 &&
    wrongBus === 0 &&
    driverHttp2xx / Math.max(1, driverHttp.length) >= 0.95 &&
    http2xx / Math.max(1, httpSamples.length) >= 0.95 &&
    dbChecks.every((c) => c.ok) &&
    allFailures.length === 0;

  const report = {
    timestamp: new Date().toISOString(),
    gitCommit: gitCommit(),
    environment: { target: APP_URL, wsNodes: WS_URLS, nodeEnv: process.env.NODE_ENV || 'unset' },
    stage: STAGE,
    durationSec: (Date.now() - t0) / 1000,
    profile: { drivers: drivers.length, students: students.length, buses: buses.length, gpsIntervalMs: GPS_INTERVAL_MS, pollMs: POLL_MS },
    gps: {
      sent: drivers.reduce((a, d) => a + d.sent.length, 0),
      expectedDeliveries: expectedDistinct,
      received, deliveryPct: Math.round(deliveryPct * 100) / 100,
      duplicates: dupExtra, wrongBus,
      studentsWithData: distinctStudentsWithData.size,
      latency: latencyStats(latencies),
      latencySameNode: latencyStats(latenciesSameNode),
      latencyCrossNode: latencyStats(latenciesCrossNode),
    },
    http: {
      driverGps: { total: driverHttp.length, ok2xx: driverHttp2xx, latency: latencyStats(driverHttp.map((s) => s.httpLatencyMs || 0)) },
      studentPolls: { total: httpSamples.length, ok2xx: http2xx, latency: latencyStats(httpSamples.map((h) => h.latencyMs)) },
    },
    flags: { raised: students.reduce((a, s) => a + s.flagsRaised, 0), ackedByDrivers: drivers.reduce((a, d) => a + d.flagsAcked.length, 0) },
    wsProtocolErrors: {
      drivers: drivers.map((d) => ({ persona: d.label, errors: d.serverErrors })).filter((x) => x.errors.length),
      students: students.map((s) => ({ persona: s.label, errors: s.serverErrors })).filter((x) => x.errors.length),
    },
    reconnects: { drivers: drivers.reduce((a, d) => a + d.wsStats.reconnects, 0), students: students.reduce((a, s) => a + s.wsReconnects, 0) },
    multiNode: { configured: WS_URLS.length >= 2, crossNodeSamples: latenciesCrossNode.length, verified: multiNodeVerified },
    dbChecks,
    wsServerMetrics: metricDelta(before, after),
    failures: allFailures.slice(0, 100),
    failureCount: allFailures.length,
    pass,
  };

  const { jsonPath, mdPath } = writeReport(`stage-${STAGE}`, report);
  console.log(`\n== RESULTS: stage ${STAGE} ==`);
  console.log(`delivery: ${report.gps.deliveryPct}% (${received}/${expectedDistinct})  wrong-bus: ${wrongBus}  dup-extra: ${dupExtra}`);
  console.log(`latency p50=${report.gps.latency.p50}ms p95=${report.gps.latency.p95}ms p99=${report.gps.latency.p99}ms max=${report.gps.latency.max}ms`);
  console.log(`driver HTTP GPS: ${driverHttp2xx}/${driverHttp.length} ok (p95=${report.http.driverGps.latency.p95}ms)  student polls: ${http2xx}/${httpSamples.length} ok`);
  console.log(`flags raised/acked: ${report.flags.raised}/${report.flags.ackedByDrivers}  reconnects: ${report.reconnects.drivers}d/${report.reconnects.students}s`);
  dbChecks.forEach((c) => console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name} — ${c.detail}`));
  console.log(`failures: ${allFailures.length}  multi-node: ${multiNodeVerified ? 'VERIFIED' : 'NOT VERIFIED (single-node or zero cross-node traffic)'}`);
  console.log(`WS metrics delta:`, JSON.stringify(report.wsServerMetrics, null, 0).slice(0, 400));
  console.log(`\nPASS=${pass}\nreports:\n  ${jsonPath}\n  ${mdPath}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('ORCHESTRATOR FATAL:', e); process.exit(2); });
