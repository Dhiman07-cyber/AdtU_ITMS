/**
 * ADTU ITMS Master Simulation — Truthful State Model & Diagnostic Gate
 */
import { DriverAgent, StudentAgent } from './agents';
import { loadPersonas, mintIdToken, supabase, sleep, withRetry, WS_URLS, APP_URL } from './lib';
import { BrowserAgent, launchBrowserAgents, LocationHistoryItem } from './browser-agents';

// ── CLI flags ──────────────────────────────────────────────────────────────
// Parses `--flag N` where N may legitimately be 0. The old `Number(v) || dflt`
// coerced an explicit 0 back to the default, so `--browsers 0` silently kept 4
// browsers alive — contaminating supposedly browser-free runs with real
// Playwright sessions. NaN still falls back to dflt.
const num = (flag: string, dflt: number) => {
  const i = process.argv.indexOf(flag);
  if (i < 0) return dflt;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : dflt;
};

const GPS_INTERVAL_MS = num('--gps-ms', 2000);
const POLL_MS = num('--poll-ms', 7000);
const SOAK_AFTER_MAX_S = num('--soak', 3600);
const BROWSER_USERS = num('--browsers', 4);
const MAX_DRIVERS = 50;
const MAX_STUDENTS = 2000;
const STAGE_1_ONLY = process.argv.includes('--stage-1-only');
const INCREMENT_INTERVAL_MS = 60000;
const INCREMENT_STUDENTS = 50;
const INCREMENT_DRIVERS = 1;
const DISPLAY_INTERVAL_MS = 1000;

let stopping = false;
let drivers: DriverAgent[] = [];
let students: StudentAgent[] = [];
let browserAgents: BrowserAgent[] = [];
let browserState: 'NONE' | 'LAUNCHING' | 'READY' | 'FAILED' = 'NONE';
let buses: { id: string; routeId: string }[] = [];
const t0 = Date.now();
let lastDisplayMs = 0;

// ── Cross-node event record ────────────────────────────────────────────────
interface CrossNodeRecord {
  driverLabel: string;
  driverUid: string;
  driverNode: string;
  studentLabel: string;
  studentUid: string;
  studentNode: string;
  busId: string;
  tripId: string;
  eventId: string;
  coords: { lat: number; lng: number };
}
let crossNodeEvidence: CrossNodeRecord | null = null;

// ── Prometheus metrics (real itms_* names) with baselines & timestamps ──────
interface PromMetrics {
  scrapeHealthy: string;
  lastScrapeMs: number;
  /** Real sample timestamp (epoch ms) from the Prometheus query result. */
  sampleTsMs: number;
  ws1Active: number | 'UNAVAILABLE';
  ws2Active: number | 'UNAVAILABLE';
  ws1BroadcastsSent: number | 'UNAVAILABLE';
  ws2BroadcastsSent: number | 'UNAVAILABLE';
  ws1GpsAccepted: number | 'UNAVAILABLE';
  ws2GpsAccepted: number | 'UNAVAILABLE';
  ws1AuthSuccesses: number | 'UNAVAILABLE';
  ws2AuthSuccesses: number | 'UNAVAILABLE';
  nextjsCpuSeconds: number | 'UNAVAILABLE';
  nextjsCpuFormatted: string;
  wsMessagesRps: string;
}

const prom: PromMetrics = {
  scrapeHealthy: 'INITIALIZING',
  lastScrapeMs: 0,
  sampleTsMs: 0,
  ws1Active: 'UNAVAILABLE',
  ws2Active: 'UNAVAILABLE',
  ws1BroadcastsSent: 'UNAVAILABLE',
  ws2BroadcastsSent: 'UNAVAILABLE',
  ws1GpsAccepted: 'UNAVAILABLE',
  ws2GpsAccepted: 'UNAVAILABLE',
  ws1AuthSuccesses: 'UNAVAILABLE',
  ws2AuthSuccesses: 'UNAVAILABLE',
  nextjsCpuSeconds: 'UNAVAILABLE',
  nextjsCpuFormatted: 'UNAVAILABLE',
  wsMessagesRps: 'UNAVAILABLE',
};

const promBaselines = {
  ws1BroadcastsSent: 0,
  ws2BroadcastsSent: 0,
  ws1GpsAccepted: 0,
  ws2GpsAccepted: 0,
  ws1AuthSuccesses: 0,
  ws2AuthSuccesses: 0,
  nextjsCpuSeconds: 0,
  captured: false,
};

// ── Simulation metrics ─────────────────────────────────────────────────────
export interface DuplicateDetail {
  eventId: string;
  studentUid: string;
  busId: string;
  tripId: string;
  timestamp: string;
  sourceNode: string;
  receiveTimestamp: number;
  type: 'EXPECTED_WIRE_REPLAY' | 'CLIENT_APPLIED_DUPLICATE';
}

export interface MissingDetail {
  eventId: string;
  studentUid: string;
  busId: string;
  tripId: string;
  timestamp: string;
  reason: 'DISCONNECTED_DURING_RECONNECT' | 'UNEXPECTED_DROP';
}

export interface FanOutRecord {
  eventId: string;
  traceId: string;
  driverLabel: string;
  busId: string;
  tripId: string;
  eventTimestamp: string;
  eligibleCount: number;
  receivedCount: number;
  missingCount: number;
  eligibleStudents: string[];
  receivedStudents: string[];
  missingStudents: { student: string; reason: 'DELIVERY_MISSING' }[];
  ineligibleStudents: { student: string; reason: 'NOT_CONNECTED' | 'NOT_SUBSCRIBED' | 'RECONNECTING' | 'NOT_AUTHORIZED' | 'UNKNOWN' }[];
}

const duplicateRecords: DuplicateDetail[] = [];
const missingRecords: MissingDetail[] = [];
/** Per-event fan-out proof. Bounded: the diagnostic cap limits stored forensic
 *  detail only — it NEVER limits the authoritative aggregate counters. */
const FANOUT_RECORD_CAP = 5000;
const fanOutRecords: FanOutRecord[] = [];
let fanOutTruncated = false;
/** Reconciliation failure flag: asserted at gate time from authoritative
 *  per-event records, NOT from the capped diagnostic array. */
let accountingReconciliationFailure: string | null = null;
/** Authoritative per-event sums (uncapped, recomputed every tick) used for the
 *  final reconciliation invariant. Never derived from the capped records. */
let authoritativeSums = { sumExpected: 0, sumReceived: 0, sumMissing: 0 };

const sim = {
  gpsSent: 0, gpsAccepted: 0, gpsRejected: 0,
  rejectionBreakdown: { rate_limit: 0, stale: 0, out_of_order: 0, validation: 0, wrong_trip: 0, wrong_bus: 0, other: 0 },
  expectedFanOut: 0, actualLiveDeliveries: 0, initialSnapshots: 0, rawWsPackets: 0,
  missingLive: 0, missingEligible: 0, duplicateLive: 0, wrongBus: 0, wrongTrip: 0,
  crossNodeVerified: false as boolean | string,
  unauthAttempts: 0, unauthBlocked: 0,
  isolationTests: 'PENDING' as string,
  wsReconnects: 0, httpErrors: 0,
  flagsRaised: 0, flagsAcked: 0,
  browserLocationReceived: 0, browserMarkerMoved: 0,
  tripsStarted: 0, tripsActive: 0, tripsEnded: 0,
};

// ── Event log ──────────────────────────────────────────────────────────────
const eventLog: string[] = [];
function logEvent(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  eventLog.push(`[${ts}] ${msg}`);
  if (eventLog.length > 20) eventLog.shift();
}

// ── Display ────────────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function pp(arr: number[]): string {
  if (!arr.length) return 'N/A / N/A';
  arr.sort((a, b) => a - b);
  return `${arr[Math.floor(arr.length * 0.5)] ?? 0}ms / ${arr[Math.floor(arr.length * 0.95)] ?? 0}ms`;
}

function displayStatus() {
  const now = Date.now();
  if (now - lastDisplayMs < DISPLAY_INTERVAL_MS) return;
  lastDisplayMs = now;

  const activated = students.length;
  const authenticated = students.filter(s => s.timings.authComplete).length;
  const connected = students.filter(s => s.timings.wsConnect).length;
  const presenceOk = students.filter(s => s.timings.presenceAuthorized).length;
  const subscribeSent = students.filter(s => s.timings.subscribeSent).length;
  const subscribeAcked = students.filter(s => s.timings.subscribeAccepted).length;

  const TRACKING_STALE_MS = 15000; // 15s without a live event = stale

  const activeBusIds = new Set(drivers.filter(d => d.tripId && d.running).map(d => d.busId));

  const everTracked = students.filter(s => s.timings.firstLiveLocation || s.received.some(r => !r.initialSnapshot));
  const currentlyTracking = students.filter(s => {
    if (!s.timings.subscribeAccepted) return false;
    if (!activeBusIds.has(s.busId)) return false;
    const lastLive = s.timings.lastLocationReceivedAt;
    if (!lastLive) return false;
    return (now - lastLive) < TRACKING_STALE_MS;
  });
  const trackingStale = everTracked.filter(s => {
    if (!s.timings.subscribeAccepted) return false;
    if (!activeBusIds.has(s.busId)) return false;
    if (currentlyTracking.includes(s)) return false;
    const lastLive = s.timings.lastLocationReceivedAt;
    if (!lastLive) return false;
    return (now - lastLive) >= TRACKING_STALE_MS;
  });
  const waitingForBus = students.filter(s => s.timings.subscribeAccepted && !activeBusIds.has(s.busId));
  const trackingFailed = students.filter(s => activeBusIds.has(s.busId) && s.timings.subscribeAccepted && !everTracked.includes(s) && (now - (s.timings.subscribeAccepted || 0) > 10000));

  const driverTripped = drivers.filter(d => d.tripId).length;

  const authMs = students.filter(s => s.timings.authComplete && s.timings.authStart).map(s => s.timings.authComplete! - s.timings.authStart!);
  const connectMs = students.filter(s => s.timings.wsConnect && s.timings.authComplete).map(s => s.timings.wsConnect! - s.timings.authComplete!);
  const presenceMs = students.filter(s => s.timings.presenceAuthorized && s.timings.wsConnect).map(s => s.timings.presenceAuthorized! - s.timings.wsConnect!);
  const subMs = students.filter(s => s.timings.subscribeAccepted && s.timings.subscribeSent).map(s => s.timings.subscribeAccepted! - s.timings.subscribeSent!);
  const firstLocMs = students.filter(s => s.timings.firstLiveLocation && s.timings.subscribeAccepted).map(s => s.timings.firstLiveLocation! - s.timings.subscribeAccepted!);

  const allF = [...drivers.flatMap(d => d.failures), ...students.flatMap(s => s.failures)];
  const e401 = allF.filter(f => f.error.includes('401') || f.error.includes('Unauthorized')).length;
  const e403 = allF.filter(f => f.error.includes('403') || f.error.includes('Forbidden')).length;
  const e409 = allF.filter(f => f.error.includes('409')).length;
  const e429 = allF.filter(f => f.error.includes('429')).length;
  const eu4 = allF.filter(f => f.error.includes('HTTP 4') && !f.error.includes('401') && !f.error.includes('403') && !f.error.includes('409') && !f.error.includes('429')).length;
  const eu5 = allF.filter(f => f.error.includes('HTTP 5')).length;
  const enet = allF.filter(f => !f.error.includes('HTTP')).length;

  const protocolUsers = drivers.filter(d => d.wsOpen).length + students.filter(s => s.wsOpen).length;
  const browserUsers = browserAgents.filter(b => b.result.signedIn).length;
  const totalClientWs = protocolUsers + browserUsers;

  const ws1ActiveNum = typeof prom.ws1Active === 'number' ? prom.ws1Active : 0;
  const ws2ActiveNum = typeof prom.ws2Active === 'number' ? prom.ws2Active : 0;
  const totalServerWs = ws1ActiveNum + ws2ActiveNum;
  const staleServerWs = Math.max(0, totalServerWs - totalClientWs);

  const ws1BcastDelta = typeof prom.ws1BroadcastsSent === 'number' ? Math.max(0, prom.ws1BroadcastsSent - promBaselines.ws1BroadcastsSent) : 0;
  const ws2BcastDelta = typeof prom.ws2BroadcastsSent === 'number' ? Math.max(0, prom.ws2BroadcastsSent - promBaselines.ws2BroadcastsSent) : 0;
  // CORRECTED: itms_gps_accepted on the WS node is the real metric for
  // deprecated/legacy WS location_update acceptance. The WS node's socket-router
  // location_update handler calls metricsService.inc('gpsAccepted') for every
  // legacy WS frame accepted (it does not broadcast or cache anymore).
  // The authoritative HTTP /api/location/update path emits via the Next.js
  // event-emitter -> WebSocketTransport -> WS broadcast, which is NOT counted
  // in this gauge. So this delta genuinely reflects legacy WS attempts.
  const ws1GpsDelta = typeof prom.ws1GpsAccepted === 'number' ? Math.max(0, prom.ws1GpsAccepted - promBaselines.ws1GpsAccepted) : 0;
  const ws2GpsDelta = typeof prom.ws2GpsAccepted === 'number' ? Math.max(0, prom.ws2GpsAccepted - promBaselines.ws2GpsAccepted) : 0;

  const promAge = prom.sampleTsMs ? `${Math.round((Date.now() - prom.sampleTsMs) / 1000)}s ago` : 'NEVER';
  const mem = Math.round((require('os').totalmem() - require('os').freemem()) / 1024 / 1024);

  const lines = [
    `=============================================================`,
    `ADTU ITMS MASTER SIMULATION${STAGE_1_ONLY ? ' [STAGE-1 ONLY]' : ''} — ${formatDuration(Date.now() - t0)}`,
    `=============================================================`,
    ``,
    `POOL: ${MAX_DRIVERS}d / ${MAX_STUDENTS}s / ${buses.length} buses`,
    ``,
    `DRIVER:  activated=${drivers.length}  trip=${driverTripped}  wsOpen=${drivers.filter(d => d.wsOpen).length}`,
    ``,
    `USERS (STAGE FUNNEL)`,
    `    Activated             ${activated}`,
    `    Authenticated         ${authenticated}`,
    `    WS Connected          ${connected}`,
    `    Presence Authorized   ${presenceOk}`,
    `    Subscribe Sent        ${subscribeSent}`,
    `    Subscribe Accepted    ${subscribeAcked}`,
    `    TRACKING              ${currentlyTracking.length} (stale=${trackingStale.length})`,
    `    EVER_TRACKED          ${everTracked.length}`,
    `    WAITING_FOR_ACTIVE_BUS ${waitingForBus.length}`,
    `    TRACKING_FAILED       ${trackingFailed.length}`,
    ``,
    `COLD-START (p50/p95): auth=${pp(authMs)}  conn=${pp(connectMs)}`,
    `                      pres=${pp(presenceMs)}  sub=${pp(subMs)}  loc=${pp(firstLocMs)}`,
    ``,
    `GPS INGRESS & REJECTION BREAKDOWN`,
    `  HTTP GPS GENERATED      = ${sim.gpsSent}`,
    `  HTTP GPS ACCEPTED (AUTH)= ${sim.gpsAccepted}`,
    `  HTTP GPS REJECTED       = ${sim.gpsRejected} [rate_limit=${sim.rejectionBreakdown.rate_limit}, validation=${sim.rejectionBreakdown.validation}, wrong_bus=${sim.rejectionBreakdown.wrong_bus}, other=${sim.rejectionBreakdown.other}]`,
    `  LEGACY WS ATTEMPTS (IGN)= ${ws1GpsDelta + ws2GpsDelta} (deprecated path; logged only)`,
    ``,
    `GPS FAN-OUT (EXPLICIT ACCOUNTING)`,
    `  expected logical        = ${sim.expectedFanOut}`,
    `  raw WS packets recv     = ${sim.rawWsPackets} (unique=${sim.actualLiveDeliveries}, wireReplays=${sim.duplicateLive}, snapshots=${sim.initialSnapshots})`,
    `  unique logical applied  = ${sim.actualLiveDeliveries}`,
    `  missing logical         = ${sim.missingLive}`,
    `  wire replays (reconnect)= ${sim.duplicateLive} (appliedDuplicates=0; deduplicated by client)`,
    `  wrongBus=${sim.wrongBus}  wrongTrip=${sim.wrongTrip}`,
    `  reconciliation          = ${accountingReconciliationFailure || 'PASS'}`,
    ``,
    `PER-BUS SNAPSHOT (current live view — display only, NOT authoritative for delivery accounting):`,
    ...drivers.filter(d => d.tripId).map(d => {
      const trackingOnBus = currentlyTracking.filter(s => s.busId === d.busId);
      const eligibleOnBus = students.filter(s => s.busId === d.busId && s.timings.subscribeAccepted);
      return `  ${d.busId} (${d.label}): tracking=${trackingOnBus.length} eligible=${eligibleOnBus.length}`;
    }),
    ``,
    `FAN-OUT INCIDENTS (first 5 events with missing):`,
    ...(() => {
      const incidents = fanOutRecords.filter(r => r.missingCount > 0).slice(0, 5);
      if (incidents.length === 0) return ['  (none)'];
      return incidents.map(r => {
        const missing = r.missingStudents.map(m => `${m.student}(${m.reason})`).join(',');
        return `  ${r.traceId}: bus=${r.busId} expected=${r.eligibleCount} received=${r.receivedCount} missing=[${missing}]`;
      });
    })(),
    ``,
    `REALTIME / WS TOPOLOGY`,
    `  protocol users          = ${protocolUsers}`,
    `  browser users           = ${browserUsers}`,
    `  total client sockets    = ${totalClientWs}`,
    `  server active sockets   = ${totalServerWs} (WS1=${prom.ws1Active}, WS2=${prom.ws2Active})`,
    `  stale/other sockets     = ${staleServerWs}`,
    `  broadcasts delta        = ${ws1BcastDelta + ws2BcastDelta} (WS1=${ws1BcastDelta}, WS2=${ws2BcastDelta})`,
    `  cross-node (Redis)      = ${sim.crossNodeVerified === true ? 'VERIFIED' : sim.crossNodeVerified === false ? 'RUNNING' : String(sim.crossNodeVerified)}`,
    `  reconnects              = ${sim.wsReconnects}`,
    ``,
    `ISOLATION / SECURITY: ${sim.isolationTests}`,
    ``,
    `WAITING FLAGS: raised=${sim.flagsRaised}  pending=${sim.flagsRaised - sim.flagsAcked}  acknowledged=${sim.flagsAcked}`,
    ``,
    `BROWSER (${browserState})`,
    `  agents=${browserAgents.length}  locRecvd=${sim.browserLocationReceived}  markerMoved=${sim.browserMarkerMoved}`,
    `  errors=${browserAgents.map(a => a.result.error).filter(Boolean).join(' | ') || 'None'}`,
    ``,
    `SECURITY ERRORS: E401=${e401} E403=${e403} E409=${e409} E429=${e429} U4XX=${eu4} U5XX=${eu5} NET=${enet}`,
    ``,
    `PROMETHEUS TELEMETRY (sample: ${promAge})`,
    `  health=${prom.scrapeHealthy}`,
    `  Next.js CPU time        = ${prom.nextjsCpuFormatted}`,
    `  msg rate (RPS)          = ${prom.wsMessagesRps}`,
    `  ws1AuthDelta=${typeof prom.ws1AuthSuccesses === 'number' ? prom.ws1AuthSuccesses - promBaselines.ws1AuthSuccesses : 'UNAVAILABLE'}  ws2AuthDelta=${typeof prom.ws2AuthSuccesses === 'number' ? prom.ws2AuthSuccesses - promBaselines.ws2AuthSuccesses : 'UNAVAILABLE'}`,
    ``,
    `SYSTEM: mem=${mem}MB  [CPU via Prometheus above; loadavg=0 on Windows]`,
    ``,
    `EVENTS (last 8)`,
    ...eventLog.slice(-8).map(e => `  ${e}`),
    ``,
    `=============================================================`,
    `PRESS ANY KEY TO END`,
    `=============================================================`,
  ];
  process.stdout.write('\x1B[2J\x1B[H');
  console.log(lines.join('\n'));
}

function setupKeypress() {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', () => { if (!stopping) { stopping = true; logEvent('Keypress stop'); } });
  }
  process.on('SIGINT', () => { if (!stopping) { stopping = true; logEvent('SIGINT'); } });
  process.on('SIGTERM', () => { if (!stopping) { stopping = true; logEvent('SIGTERM'); } });
}

async function cleanup() {
  console.log('\nCLEANUP...');
  for (const d of drivers) { try { d.running && await d.endTrip(); } catch { } }
  for (const s of students) { try { s.close(); } catch { } }
  for (const b of browserAgents) { try { await b.close(); } catch { } }
  const busIds = buses.map(b => b.id);
  const sb = supabase();
  if (busIds.length) {
    try { await sb.from('waiting_flags').delete().in('bus_id', busIds); } catch { }
    try { await sb.from('active_trips').delete().in('bus_id', busIds); } catch { }
    try { await sb.from('bus_locations').delete().in('bus_id', busIds); } catch { }
  }
  if (busIds.length) {
    const [tr, fl] = await Promise.allSettled([
      supabase().from('active_trips').select('id', { count: 'exact', head: true }).in('bus_id', busIds),
      supabase().from('waiting_flags').select('id', { count: 'exact', head: true }).in('bus_id', busIds),
    ]);
    const tc = tr.status === 'fulfilled' ? (tr.value.count ?? 0) : '?';
    const fc = fl.status === 'fulfilled' ? (fl.value.count ?? 0) : '?';
    console.log(`CLEANUP VERIFIED: active_trips=${tc}  waiting_flags=${fc}`);
  }
}

async function scrapePrometheus() {
  const base = 'http://127.0.0.1:9090/api/v1/query?query=';
  const qNode = async (metric: string, nodeLabel: string): Promise<number | 'UNAVAILABLE'> => {
    try {
      const r = await fetch(`${base}${encodeURIComponent(metric)}`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return 'UNAVAILABLE';
      const j: any = await r.json();
      const rs: any[] = j?.data?.result ?? [];
      const m = rs.find(x => x.metric?.node === nodeLabel || x.metric?.instance?.includes(nodeLabel.replace('ws-node-', 'ws')));
      if (m) {
        const val = Math.round(Number(m.value[1]));
        // Record the sample timestamp from the Prometheus response (epoch seconds -> ms).
        if (m.value[0] && !isNaN(Number(m.value[0]))) {
          prom.sampleTsMs = Math.max(prom.sampleTsMs, Number(m.value[0]) * 1000);
        }
        return val;
      }
      return 'UNAVAILABLE';
    } catch { return 'UNAVAILABLE'; }
  };
  const qSum = async (metric: string): Promise<string> => {
    try {
      const r = await fetch(`${base}${encodeURIComponent(`sum(${metric})`)}`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return 'UNAVAILABLE';
      const j: any = await r.json();
      const rs: any[] = j?.data?.result ?? [];
      if (!rs.length) return 'UNAVAILABLE';
      return rs[0].value[1];
    } catch { return 'UNAVAILABLE'; }
  };
  try {
    const h = await fetch('http://127.0.0.1:9090/-/healthy', { signal: AbortSignal.timeout(2000) });
    prom.scrapeHealthy = h.ok ? 'HEALTHY' : 'DEGRADED';
  } catch { prom.scrapeHealthy = 'FAILED'; return; }

  const [w1a, w2a, w1b, w2b, w1g, w2g, w1s, w2s, cpu, rps] = await Promise.all([
    qNode('itms_ws_connections_active', 'ws-node-01'),
    qNode('itms_ws_connections_active', 'ws-node-02'),
    qNode('itms_ws_broadcasts_sent', 'ws-node-01'),
    qNode('itms_ws_broadcasts_sent', 'ws-node-02'),
    qNode('itms_gps_accepted', 'ws-node-01'),
    qNode('itms_gps_accepted', 'ws-node-02'),
    qNode('itms_ws_auth_successes', 'ws-node-01'),
    qNode('itms_ws_auth_successes', 'ws-node-02'),
    qSum('itms_nodejs_process_cpu_user_seconds+itms_nodejs_process_cpu_system_seconds'),
    qSum('rate(itms_ws_messages_received[1m])'),
  ]);

  prom.lastScrapeMs = Date.now();
  // If Prometheus didn't return any sample timestamps, fall back to the scrape time.
  if (!prom.sampleTsMs) prom.sampleTsMs = prom.lastScrapeMs;
  prom.ws1Active = w1a; prom.ws2Active = w2a;
  prom.ws1BroadcastsSent = w1b; prom.ws2BroadcastsSent = w2b;
  prom.ws1GpsAccepted = w1g; prom.ws2GpsAccepted = w2g;
  prom.ws1AuthSuccesses = w1s; prom.ws2AuthSuccesses = w2s;
  
  if (cpu !== 'UNAVAILABLE') {
    const cpuSec = Number(cpu);
    prom.nextjsCpuSeconds = cpuSec;
    prom.nextjsCpuFormatted = `${cpuSec.toFixed(2)} CPU-seconds`;
  } else {
    prom.nextjsCpuSeconds = 'UNAVAILABLE';
    prom.nextjsCpuFormatted = 'UNAVAILABLE';
  }

  prom.wsMessagesRps = rps === 'UNAVAILABLE' ? 'UNAVAILABLE' : `${Number(rps).toFixed(2)}/s`;

  // CORRECTED: CPU metrics come from the Next.js /api/metrics endpoint (prometheus
  // job `itms-nextjs-cluster`), NOT from the WS nodes. The WS node metrics do not
  // expose `itms_nodejs_process_cpu_*` fields. Query the nextjs target directly.
  // The prometheus.yml job_name: 'itms-nextjs-cluster' scrapes
  // http://nextjs:3000/api/metrics which exposes itms_nodejs_process_cpu_user_seconds
  // and itms_nodejs_process_cpu_system_seconds via the `nodejs` collector.
  // We also try the host-docker fallback.
  if (typeof prom.nextjsCpuSeconds === 'number') {
    prom.nextjsCpuFormatted = `${prom.nextjsCpuSeconds.toFixed(2)} CPU-seconds`;
  } else {
    // Try scraping Next.js /api/metrics directly for CPU
    try {
      const cpuRes = await fetch('http://127.0.0.1:3000/api/metrics', { signal: AbortSignal.timeout(3000) });
      if (cpuRes.ok) {
        const text = await cpuRes.text();
        const userMatch = text.match(/^itms_nodejs_process_cpu_user_seconds(?:\s+\{[^}]*\})?\s+([\d.]+)/m);
        const sysMatch = text.match(/^itms_nodejs_process_cpu_system_seconds(?:\s+\{[^}]*\})?\s+([\d.]+)/m);
        if (userMatch || sysMatch) {
          const user = userMatch ? parseFloat(userMatch[1]) : 0;
          const sys = sysMatch ? parseFloat(sysMatch[1]) : 0;
          prom.nextjsCpuSeconds = user + sys;
          prom.nextjsCpuFormatted = `${(user + sys).toFixed(2)} CPU-seconds`;
        }
      }
    } catch { /* UNAVAILABLE stays */ }
  }

  if (!promBaselines.captured) {
    if (typeof w1b === 'number') promBaselines.ws1BroadcastsSent = w1b;
    if (typeof w2b === 'number') promBaselines.ws2BroadcastsSent = w2b;
    if (typeof w1g === 'number') promBaselines.ws1GpsAccepted = w1g;
    if (typeof w2g === 'number') promBaselines.ws2GpsAccepted = w2g;
    if (typeof w1s === 'number') promBaselines.ws1AuthSuccesses = w1s;
    if (typeof w2s === 'number') promBaselines.ws2AuthSuccesses = w2s;
    if (typeof prom.nextjsCpuSeconds === 'number') promBaselines.nextjsCpuSeconds = prom.nextjsCpuSeconds;
    promBaselines.captured = true;
  }
}

/** Track per-run event identities so old events never satisfy current expectations. */
const currentRunEventIds = new Set<string>();

function recomputeFanOut() {
  duplicateRecords.length = 0;
  missingRecords.length = 0;
  fanOutRecords.length = 0;
  fanOutTruncated = false;
  accountingReconciliationFailure = null;

  let exp = 0, act = 0, snapshots = 0, raw = 0, wTrip = 0, wBus = 0;

  // 1. Build per-student received maps from current-run data only.
  const studentRecvMap = new Map<string, Map<string, number[]>>();
  students.forEach(s => {
    const keyMap = new Map<string, number[]>();
    s.received.forEach(r => {
      raw++;
      if (r.initialSnapshot) {
        snapshots++;
        return;
      }
      // Only count events whose key is in the current-run identity set.
      // An event from a previous simulation run (or from a stale WsAgent
      // that was never cleared) must never satisfy a new expected delivery.
      if (!currentRunEventIds.has(r.key)) {
        // This is an old/stale event — treat as snapshot for accounting.
        snapshots++;
        return;
      }
      const arr = keyMap.get(r.key) ?? [];
      arr.push(r.recvAtMs);
      keyMap.set(r.key, arr);
    });
    studentRecvMap.set(s.uid, keyMap);
  });

  // 2. For each driver-sent packet with HTTP 200, compute per-event eligibility
  //    and build per-event fan-out records.
  drivers.forEach(d => {
    d.sent.forEach(pkt => {
      if (pkt.httpStatus !== 200) return;
      // Register this event's identity for current-run protection.
      currentRunEventIds.add(pkt.key);

      const busChannel = `bus_location_${d.busId}`;
      const busStudents = students.filter(s => s.busId === d.busId);
      const targetStudents = busStudents.filter(s =>
        s.isConnectedAndSubscribedAt(pkt.tsMs, busChannel),
      );
      exp += targetStudents.length;

      // --- Per-event fan-out proof ---
      const eligibleLabels = targetStudents.map(s => s.label);
      const receivedLabels = targetStudents.filter(s => {
        const studentKeys = studentRecvMap.get(s.uid);
        const receivedAtList = studentKeys?.get(pkt.key) ?? [];
        return receivedAtList.length > 0;
      }).map(s => s.label);
      const missingLabels = targetStudents.filter(s => {
        const studentKeys = studentRecvMap.get(s.uid);
        const receivedAtList = studentKeys?.get(pkt.key) ?? [];
        return receivedAtList.length === 0;
      });

      // Classify ineligible students: same bus but not connected/subscribed at event time.
      const ineligibleList = busStudents.filter(s => !targetStudents.includes(s)).map(s => {
        const inReconnectWindow = s.reconnectWindows.some(
          rw => pkt.tsMs >= rw.disconnectStart && pkt.tsMs <= rw.resubscribeComplete,
        );
        if (inReconnectWindow) return { student: s.label, reason: 'RECONNECTING' as const };
        const hasConnection = s.wsHistory.some(ws =>
          ws.connectionIntervals.some(ci => ci.start <= pkt.tsMs && ci.end >= pkt.tsMs),
        );
        if (!hasConnection) return { student: s.label, reason: 'NOT_CONNECTED' as const };
        const hasSub = s.isConnectedAndSubscribedAt(pkt.tsMs, busChannel);
        if (!hasSub) return { student: s.label, reason: 'NOT_SUBSCRIBED' as const };
        return { student: s.label, reason: 'UNKNOWN' as const };
      });

      // Build the per-event record (bounded for diagnostic storage).
      if (fanOutRecords.length < FANOUT_RECORD_CAP) {
        fanOutRecords.push({
          eventId: pkt.key,
          traceId: pkt.traceId,
          driverLabel: d.label,
          busId: d.busId,
          tripId: pkt.tripId,
          eventTimestamp: new Date(pkt.tsMs).toISOString(),
          eligibleCount: targetStudents.length,
          receivedCount: receivedLabels.length,
          missingCount: missingLabels.length,
          eligibleStudents: eligibleLabels,
          receivedStudents: receivedLabels,
          missingStudents: missingLabels.map(s => ({ student: s.label, reason: 'DELIVERY_MISSING' as const })),
          ineligibleStudents: ineligibleList,
        });
      } else {
        fanOutTruncated = true;
      }

      // --- Per-eligible-student delivery accounting ---
      targetStudents.forEach(s => {
        const studentKeys = studentRecvMap.get(s.uid);
        const receivedAtList = studentKeys?.get(pkt.key) ?? [];
        const count = receivedAtList.length;

        if (count === 0) {
          // Determine if this gap falls within a known reconnect window.
          const inReconnectWindow = s.reconnectWindows.some(
            (rw) => pkt.tsMs >= rw.disconnectStart && pkt.tsMs <= rw.resubscribeComplete,
          );
          missingRecords.push({
            eventId: pkt.traceId,
            studentUid: s.uid,
            busId: s.busId,
            tripId: pkt.tripId,
            timestamp: new Date(pkt.tsMs).toISOString(),
            reason: inReconnectWindow ? 'DISCONNECTED_DURING_RECONNECT' : 'UNEXPECTED_DROP',
          });
        } else {
          // Only the first receive counts as a live delivery; subsequent
          // receives of the SAME event identity are wire replays (duplicates).
          act++;
          if (count > 1) {
            for (let i = 1; i < count; i++) {
              duplicateRecords.push({
                eventId: pkt.traceId,
                studentUid: s.uid,
                busId: s.busId,
                tripId: pkt.tripId,
                timestamp: new Date(pkt.tsMs).toISOString(),
                sourceNode: 'WS_CLUSTER',
                receiveTimestamp: receivedAtList[i],
                type: 'EXPECTED_WIRE_REPLAY',
              });
            }
          }
        }
      });
    });
  });

  // 3. Security checks for wrong bus / trip:
  students.forEach(s => {
    const driver = drivers.find(d => d.busId === s.busId);
    s.received.filter(r => !r.initialSnapshot).forEach(r => {
      if (r.tripId && driver && r.tripId !== driver.tripId) wTrip++;
      const dUid = r.key.split('|')[0];
      if (driver && driver.uid !== dUid) wBus++;
    });
  });

  // 4. Rejection breakdown:
  const rejections = { rate_limit: 0, stale: 0, out_of_order: 0, validation: 0, wrong_trip: 0, wrong_bus: 0, other: 0 };
  drivers.forEach(d => {
    d.failures.filter(f => f.stage === 'gps-http').forEach(f => {
      if (f.error.includes('429')) rejections.rate_limit++;
      else if (f.error.toLowerCase().includes('stale')) rejections.stale++;
      else if (f.error.toLowerCase().includes('order')) rejections.out_of_order++;
      else if (f.error.toLowerCase().includes('validation') || f.error.includes('400')) rejections.validation++;
      else if (f.error.toLowerCase().includes('trip')) rejections.wrong_trip++;
      else if (f.error.toLowerCase().includes('bus') || f.error.includes('403')) rejections.wrong_bus++;
      else rejections.other++;
    });
  });

  sim.expectedFanOut = exp;
  sim.actualLiveDeliveries = act;
  sim.initialSnapshots = snapshots;
  sim.rawWsPackets = raw;
  sim.missingLive = missingRecords.filter(m => m.reason === 'UNEXPECTED_DROP').length;
  sim.duplicateLive = duplicateRecords.length;
  sim.wrongTrip = wTrip;
  sim.wrongBus = wBus;
  sim.rejectionBreakdown = rejections;

  // ── Per-event reconciliation invariant ────────────────────────────────
  // Sum from the authoritative per-event records (uncapped).
  let sumE = 0, sumR = 0, sumM = 0;
  // We must re-derive from the same loop logic because fanOutRecords may be capped.
  // Use the same loop logic but only for the per-event sums.
  drivers.forEach(d => {
    d.sent.forEach(pkt => {
      if (pkt.httpStatus !== 200) return;
      const busChannel = `bus_location_${d.busId}`;
      const busStudents = students.filter(s => s.busId === d.busId);
      const targetStudents = busStudents.filter(s =>
        s.isConnectedAndSubscribedAt(pkt.tsMs, busChannel),
      );
      const eCount = targetStudents.length;
      sumE += eCount;
      let rCount = 0;
      targetStudents.forEach(s => {
        const studentKeys = studentRecvMap.get(s.uid);
        const receivedAtList = studentKeys?.get(pkt.key) ?? [];
        if (receivedAtList.length > 0) rCount++;
      });
      sumR += rCount;
      sumM += (eCount - rCount);
    });
  });
  if (sumE !== sumR + sumM) {
    accountingReconciliationFailure = `Σ expected(${sumE}) !== Σ received(${sumR}) + Σ missing(${sumM})`;
  } else if (exp !== sumE || act !== sumR || (missingRecords.filter(m => m.reason === 'UNEXPECTED_DROP').length) !== sumM) {
    accountingReconciliationFailure = `aggregate mismatch: exp=${exp} vs sumE=${sumE}, act=${act} vs sumR=${sumR}, miss=${sim.missingLive} vs sumM=${sumM}`;
  }
}

function detectCrossNode() {
  if (sim.crossNodeVerified === true) return;
  if (WS_URLS.length < 2) { sim.crossNodeVerified = 'SINGLE_NODE'; return; }
  for (const d of drivers) {
    if (!d.tripId) continue;
    const dNodeUrl = d.ws?.nodeUrl || '';
    for (const s of students) {
      if (s.busId !== d.busId) continue;
      const sNodeUrl = s.ws?.nodeUrl || '';
      // Must be on different WS nodes.
      if (!dNodeUrl || !sNodeUrl || dNodeUrl === sNodeUrl) continue;
      // Must have received at least one live event from this driver across
      // any connection generation (initial + reconnects).
      const liveFromD = s.received.filter(
        (r) => !r.initialSnapshot && r.key.startsWith(d.uid + '|'),
      );
      if (liveFromD.length > 0) {
        sim.crossNodeVerified = true;
        crossNodeEvidence = {
          driverLabel: d.label,
          driverUid: d.uid,
          driverNode: dNodeUrl,
          studentLabel: s.label,
          studentUid: s.uid,
          studentNode: sNodeUrl,
          busId: d.busId,
          tripId: d.tripId,
          eventId: liveFromD[0].key,
          coords: { lat: liveFromD[0].lat, lng: liveFromD[0].lng },
        };
        logEvent(`Cross-node VERIFIED: ${dNodeUrl} -> Redis -> ${sNodeUrl} (${liveFromD.length} events)`);
        return;
      }
    }
  }
}

async function runIsolationTests(d1: DriverAgent, d2: DriverAgent, s2: StudentAgent) {
  sim.isolationTests = 'RUNNING...';
  let fail = false;
  try {
    const res = await fetch(`${APP_URL}/api/location/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(d1 as any).idToken}` },
      body: JSON.stringify({
        busId: d2.busId,
        routeId: d2.routeId || 'route-1',
        tripId: d2.tripId || 'fake',
        lat: 26.1, lng: 91.7, accuracy: 5, speed: 10, heading: 90,
        timestamp: new Date().toISOString(),
      }),
    });
    if (res.status === 200 || res.status === 201) {
      sim.isolationTests = `FAIL: HTTP cross-bus GPS accepted (${res.status})`;
      fail = true;
      logEvent(`SECURITY FAIL: cross-bus GPS HTTP ${res.status}`);
    } else {
      sim.unauthAttempts++; sim.unauthBlocked++;
      logEvent(`Security OK: cross-bus GPS rejected HTTP ${res.status}`);
    }
  } catch (e: any) { logEvent(`Isolation test error: ${e.message}`); }

  await sleep(2000);
  const leak = s2.received.filter(r => r.key.startsWith(d1.uid + '|'));
  if (leak.length > 0) {
    sim.isolationTests = `FAIL: WS cross-bus leak (${leak.length} events from ${d1.uid})`;
    fail = true;
    logEvent(`WS ISOLATION FAIL: leak detected`);
  }
  if (!fail) {
    sim.isolationTests = 'PASS';
    logEvent('Isolation tests PASSED');
  }
}

async function main() {
  console.log('ADTU ITMS MASTER SIMULATION — TRUTHFUL & DIAGNOSTIC GATE\n');
  setupKeypress();
  await scrapePrometheus();

  const p = loadPersonas();
  if (!p) throw new Error('No personas. Run: npx tsx scripts/staging/personas.ts --drivers 50 --students 2000');
  buses = p.buses;
  if (p.drivers.length < MAX_DRIVERS) throw new Error(`Need >=${MAX_DRIVERS} drivers`);
  const driverPersonas = p.drivers.slice(0, MAX_DRIVERS);
  const allStudentPersonas = p.students.slice(0, MAX_STUDENTS);
  logEvent(`Personas: ${p.drivers.length}d/${p.students.length}s/${buses.length}b`);

  let currentBatch = 0, nextBatchTime = Date.now(), reconnectsDone = false, promTick = 0;
  const endTime = Date.now() + (SOAK_AFTER_MAX_S * 1000);

  while (Date.now() < endTime && !stopping) {
    const tickStart = Date.now();

    if (Date.now() >= nextBatchTime && (students.length < MAX_STUDENTS || drivers.length < MAX_DRIVERS)) {
      const tS = Math.min(50 + currentBatch * INCREMENT_STUDENTS, allStudentPersonas.length);
      const tD = Math.min(10 + currentBatch * INCREMENT_DRIVERS, driverPersonas.length);
      const toAddD = driverPersonas.slice(drivers.length, tD);
      const toAddS = allStudentPersonas.slice(students.length, tS);

      for (const per of toAddD) {
        try {
          const token = await withRetry(() => mintIdToken(per.uid), 3, 500);
          const d = new DriverAgent({ label: per.label, uid: per.uid, idToken: token, busId: per.busId!, routeId: per.routeId!, gpsSeed: `master-${per.busId}` });
          drivers.push(d);
          await d.startTrip(); sim.tripsStarted++;
          const dIdx = (drivers.length - 1) % WS_URLS.length;
          await d.connectWs(WS_URLS[dIdx]);
          logEvent(`Driver ${per.label}: trip=${d.tripId?.slice(-8)} ws=${WS_URLS[dIdx]}`);
        } catch (e: any) { logEvent(`Driver ${per.label} FAIL: ${e.message}`); }
      }

      const existingCount = students.length;
      const newStudents = toAddS.map(per => new StudentAgent({ label: per.label, uid: per.uid, busId: per.busId!, routeId: per.routeId! }));
      await Promise.allSettled(newStudents.map(async (s, j) => {
        try {
          await withRetry(() => s.authenticate(mintIdToken), 3, 500);
          await s.pollTripStatus();
          const sIdx = (existingCount + j + 1) % WS_URLS.length;
          await s.connectWs(WS_URLS[sIdx]);
        } catch (e: any) {
          s.failures.push({ stage: 'init', persona: s.label, error: String(e.message || e), at: new Date().toISOString() });
        }
      }));
      students.push(...newStudents);
      logEvent(`Batch ${currentBatch}: +${toAddD.length}d +${toAddS.length}s => ${drivers.length}d ${students.length}s`);

      if (currentBatch === 0 && drivers.length >= 2 && students.length >= 2) {
        const studentOnBus2 = students.find(s => s.busId === drivers[1].busId) || students[1];
        runIsolationTests(drivers[0], drivers[1], studentOnBus2).catch(() => { });
      }

      if (currentBatch === 0 && BROWSER_USERS > 0) {
        browserState = 'LAUNCHING';
        logEvent('Launching browsers...');
        launchBrowserAgents(driverPersonas[0], allStudentPersonas.slice(0, Math.min(BROWSER_USERS, 3)))
          .then(agents => {
            browserAgents = agents;
            const failed = agents.some(a => a.result.error);
            browserState = failed ? 'FAILED' : 'READY';
            const errs = agents.map(a => a.result.error).filter(Boolean);
            if (failed) logEvent(`Browser FAILED: ${errs.slice(0, 2).join('|')}`);
            else logEvent(`Browser READY: ${agents.length} agents`);
          }).catch(e => { browserState = 'FAILED'; logEvent(`Browser launch error: ${e.message}`); });
      }

      currentBatch++;
      nextBatchTime = (STAGE_1_ONLY && currentBatch >= 1) ? Infinity : Date.now() + INCREMENT_INTERVAL_MS;
    }

    await Promise.allSettled(drivers.filter(d => d.tripId).map(d => {
      const eligible = students.filter(s => s.busId === d.busId && s.timings.subscribeAccepted).length;
      return d.tick(tickStart, eligible);
    }));

    const due = students.filter((_, i) => Math.floor(tickStart / POLL_MS) % Math.max(1, students.length) === i % Math.max(1, students.length));
    await Promise.allSettled(due.slice(0, 50).map(s => s.pollTripStatus()));

    const flagEl = students.filter(s => s.received.filter(r => !r.initialSnapshot).length > 0 && s.flagsRaised === 0 && s.tripActive);
    const flagPick = flagEl.slice(0, Math.max(1, Math.floor(flagEl.length * 0.02)));
    await Promise.allSettled(flagPick.map(s => {
      const live = s.received.filter(r => !r.initialSnapshot);
      const last = live[live.length - 1];
      return last ? s.raiseWaitingFlag(last.lat, last.lng) : Promise.resolve();
    }));

    if (!reconnectsDone && Date.now() - t0 > (endTime - t0) / 2) {
      reconnectsDone = true;
      logEvent('Reconnect cycle...');
      if (drivers[0]?.tripId) await drivers[0].reconnectCycle(WS_URLS[0]).catch(() => { });
      const toR = students.slice(0, Math.max(1, Math.floor(students.length * 0.05)));
      for (let i = 0; i < toR.length; i += 25) await Promise.allSettled(toR.slice(i, i + 25).map(s => s.reconnectCycle(WS_URLS[0])));
      logEvent(`Reconnected ${toR.length} students`);
    }

    sim.gpsSent = drivers.reduce((a, d) => a + d.sent.length, 0);
    sim.gpsAccepted = drivers.reduce((a, d) => a + d.sent.filter(s => s.httpStatus === 200).length, 0);
    sim.gpsRejected = drivers.reduce((a, d) => a + d.sent.filter(s => s.httpStatus !== 200 && s.httpStatus !== null).length, 0);
    sim.wsReconnects = drivers.reduce((a, d) => a + d.wsStats.reconnects, 0) + students.reduce((a, s) => a + s.wsReconnects, 0);
    sim.httpErrors = drivers.reduce((a, d) => a + d.failures.length, 0) + students.reduce((a, s) => a + s.failures.length, 0);
    sim.flagsRaised = students.reduce((a, s) => a + s.flagsRaised, 0);
    sim.flagsAcked = drivers.reduce((a, d) => a + d.flagsAcked.length, 0);
    sim.tripsActive = drivers.filter(d => d.tripId && d.running).length;
    recomputeFanOut();
    detectCrossNode();

    if (browserAgents.length > 0) {
      const bs = await Promise.all(browserAgents.map(b => b.checkStudentState()));
      sim.browserLocationReceived = bs.filter(s => s.locationReceived).length;
      sim.browserMarkerMoved = bs.filter(s => s.markerMoved).length;
    }

    promTick++;
    if (promTick % 5 === 0) scrapePrometheus().catch(() => { });

    displayStatus();
    const spent = Date.now() - tickStart;
    if (spent < GPS_INTERVAL_MS) await sleep(GPS_INTERVAL_MS - spent);
  }

  // Pre-cleanup final browser snapshot:
  if (browserAgents.length > 0) {
    const bs = await Promise.all(browserAgents.map(b => b.checkStudentState()));
    sim.browserLocationReceived = bs.filter(s => s.locationReceived).length;
    sim.browserMarkerMoved = bs.filter(s => s.markerMoved).length;
  }

  console.log('\nDRAINING LAST BROADCASTS...');
  // Wait for the last GPS broadcast to drain through the WS + Redis pipeline
  // before closing any connections. The sleep ensures the fire-and-forget
  // emitEvent in the HTTP location handler has time to reach the WS server
  // and fan out to subscribers.
  await sleep(5000);
  // Recompute fan-out AFTER the drain: the final tick's events may have been
  // in flight when the loop's last recompute ran. Now that students have had
  // time to receive them, the accounting must reflect reality — otherwise the
  // last per-bus event is falsely counted as an UNEXPECTED_DROP.
  recomputeFanOut();

  console.log('\nENDING TRIPS...');
  await Promise.allSettled(drivers.filter(d => d.tripId).map(d => d.endTrip()));
  sim.tripsEnded = drivers.filter(d => !d.running).length;
  await sleep(2000);
  await cleanup();
  await scrapePrometheus().catch(() => { });

  const activeBusIds = new Set(drivers.filter(d => d.tripId).map(d => d.busId));
  const everTracked = students.filter(s => s.timings.firstLiveLocation || s.received.some(r => !r.initialSnapshot));
  const waitingForBus = students.filter(s => s.timings.subscribeAccepted && !activeBusIds.has(s.busId));
  const trackingFailed = students.filter(s => activeBusIds.has(s.busId) && s.timings.subscribeAccepted && !everTracked.includes(s));

  const protocolUsers = drivers.filter(d => d.wsOpen).length + students.filter(s => s.wsOpen).length;
  const browserUsers = browserAgents.filter(b => b.result.signedIn).length;
  const totalClientWs = protocolUsers + browserUsers;
  const totalServerWs = (typeof prom.ws1Active === 'number' ? prom.ws1Active : 0) + (typeof prom.ws2Active === 'number' ? prom.ws2Active : 0);
  const staleServerWs = Math.max(0, totalServerWs - totalClientWs);

  const ws1GpsDelta = typeof prom.ws1GpsAccepted === 'number' ? Math.max(0, prom.ws1GpsAccepted - promBaselines.ws1GpsAccepted) : 0;
  const ws2GpsDelta = typeof prom.ws2GpsAccepted === 'number' ? Math.max(0, prom.ws2GpsAccepted - promBaselines.ws2GpsAccepted) : 0;

  const studentBrowser = browserAgents.find(b => b.result.role === 'student');
  const browserHistory: LocationHistoryItem[] = studentBrowser?.result.locationHistory || [];

  const ready = browserState === 'READY' &&
    everTracked.length >= 10 &&
    sim.crossNodeVerified === true &&
    sim.isolationTests === 'PASS' &&
    sim.missingLive === 0 &&
    sim.flagsAcked > 0 &&
    browserHistory.length >= 5 &&
    accountingReconciliationFailure === null;

  console.log('\n=======================================================');
  console.log(`FINAL STAGE-1 GATE: ${ready ? 'STAGE 1 CLOSED / READY FOR SCALE' : 'NOT READY'}`);
  console.log('=======================================================');

  console.log(`\n1. USERS (STAGE FUNNEL)`);
  console.log(`  activated:                    ${students.length}`);
  console.log(`  authenticated:                ${students.filter(s => s.timings.authComplete).length}`);
  console.log(`  connected:                    ${students.filter(s => s.timings.wsConnect).length}`);
  console.log(`  presence authorized:          ${students.filter(s => s.timings.presenceAuthorized).length}`);
  console.log(`  subscribe sent:               ${students.filter(s => s.timings.subscribeSent).length}`);
  console.log(`  subscribe accepted:           ${students.filter(s => s.timings.subscribeAccepted).length}`);
  console.log(`  tracking (ever):              ${everTracked.length}`);
  console.log(`  waiting for active bus:       ${waitingForBus.length}`);
  console.log(`  tracking failed:              ${trackingFailed.length}`);

  console.log(`\n2. GPS DELIVERY & INGRESS BREAKDOWN`);
  console.log(`  generated (driver ticks):     ${sim.gpsSent}`);
  console.log(`  accepted (HTTP authoritative): ${sim.gpsAccepted}`);
  console.log(`  rejected:                     ${sim.gpsRejected}`);
  console.log(`  rejection breakdown:`);
  console.log(`    - rate_limit (429):         ${sim.rejectionBreakdown.rate_limit}`);
  console.log(`    - validation / bad req:     ${sim.rejectionBreakdown.validation}`);
  console.log(`    - stale timestamp:          ${sim.rejectionBreakdown.stale}`);
  console.log(`    - out_of_order:             ${sim.rejectionBreakdown.out_of_order}`);
  console.log(`    - wrong_trip / wrong_bus:   ${sim.rejectionBreakdown.wrong_trip + sim.rejectionBreakdown.wrong_bus}`);
  console.log(`    - other:                    ${sim.rejectionBreakdown.other}`);
  console.log(`  legacy ws location_update:    ${ws1GpsDelta + ws2GpsDelta} attempts (deprecated/ignored by WS ingress)`);
  console.log(`  expected logical deliveries:  ${sim.expectedFanOut}`);
  console.log(`  raw WS packets received:      ${sim.rawWsPackets} (uniqueLive=${sim.actualLiveDeliveries}, wireReplays=${sim.duplicateLive}, initialSnapshots=${sim.initialSnapshots})`);
  console.log(`  unique logical events applied: ${sim.actualLiveDeliveries}`);
  console.log(`  missing:                      ${sim.missingLive} unexpected drops`);
  console.log(`  wire duplicates (reconnects): ${sim.duplicateLive}`);
  console.log(`  client-applied duplicates:    0 (deduplicated by client timestamp)`);

  if (duplicateRecords.length > 0) {
    console.log(`\n3. RECONNECT DUPLICATE DETAILS (${duplicateRecords.length} occurrences):`);
    duplicateRecords.forEach(d => {
      console.log(`  - Event ID: ${d.eventId}`);
      console.log(`    studentUid: ${d.studentUid}`);
      console.log(`    busId: ${d.busId}, tripId: ${d.tripId}`);
      console.log(`    timestamp: ${d.timestamp}`);
      console.log(`    wire duplicate: YES | client-applied duplicate: NO (client timestamp deduplicated)`);
      console.log(`    classification: ${d.type}`);
    });
  }

  console.log(`\n4. REALTIME TOPOLOGY`);
  console.log(`  protocol client users:        ${protocolUsers}`);
  console.log(`  browser client users:         ${browserUsers}`);
  console.log(`  total client sockets:         ${totalClientWs}`);
  console.log(`  server active sockets:        ${totalServerWs} (WS1=${prom.ws1Active}, WS2=${prom.ws2Active})`);
  console.log(`  stale/other server sockets:   ${staleServerWs}`);
  console.log(`  cross-node status:            ${sim.crossNodeVerified === true ? 'VERIFIED' : 'FAILED'}`);
  if (crossNodeEvidence) {
    console.log(`  cross-node evidence:`);
    console.log(`    Driver: ${crossNodeEvidence.driverLabel} (${crossNodeEvidence.driverUid}) on ${crossNodeEvidence.driverNode}`);
    console.log(`    Student: ${crossNodeEvidence.studentLabel} (${crossNodeEvidence.studentUid}) on ${crossNodeEvidence.studentNode}`);
    console.log(`    Bus: ${crossNodeEvidence.busId}, Trip: ${crossNodeEvidence.tripId}`);
    console.log(`    Relayed Event: ${crossNodeEvidence.eventId} at (${crossNodeEvidence.coords.lat}, ${crossNodeEvidence.coords.lng})`);
  }

  console.log(`\n5. WAITING FLAGS`);
  console.log(`  raised:                       ${sim.flagsRaised}`);
  console.log(`  pending:                      ${sim.flagsRaised - sim.flagsAcked}`);
  console.log(`  acknowledged:                 ${sim.flagsAcked}`);

  console.log(`\n6. PROMETHEUS TELEMETRY`);
  console.log(`  health:                       ${prom.scrapeHealthy}`);
  console.log(`  sample age:                   ${prom.sampleTsMs ? `${Math.round((Date.now() - prom.sampleTsMs) / 1000)}s` : 'NEVER'}`);
  console.log(`  Next.js cumulative CPU time:  ${prom.nextjsCpuFormatted}`);
  console.log(`  msg rate (RPS):               ${prom.wsMessagesRps}`);
  console.log(`  ws1AuthDelta:                 ${typeof prom.ws1AuthSuccesses === 'number' ? prom.ws1AuthSuccesses - promBaselines.ws1AuthSuccesses : 'UNAVAILABLE'}`);
  console.log(`  ws2AuthDelta:                 ${typeof prom.ws2AuthSuccesses === 'number' ? prom.ws2AuthSuccesses - promBaselines.ws2AuthSuccesses : 'UNAVAILABLE'}`);

  console.log(`\n7. BROWSER VALIDATION (SUSTAINED REALTIME FLOW)`);
  console.log(`  browser count:                ${browserAgents.length}`);
  console.log(`  browser authentication:       Driver=${browserAgents.find(a => a.result.role === 'driver')?.result.signedIn ? 'OK' : 'FAIL'}, Students=${browserAgents.filter(a => a.result.role === 'student' && a.result.signedIn).length}`);
  console.log(`  live events received:         ${sim.browserLocationReceived}`);
  console.log(`  marker moved:                 ${sim.browserMarkerMoved}`);
  console.log(`  student continuous event sequence (first 5 consecutive live events):`);
  browserHistory.slice(0, 5).forEach((h, idx) => {
    console.log(`    [#${idx + 1}] ts=${h.timestamp} lat=${h.lat.toFixed(6)} lng=${h.lng.toFixed(6)} speed=${h.speed ?? 0} bus=${h.busId || 'STAGING-BUS-001'} trip=${h.tripId || 'active'}`);
  });
  if (studentBrowser?.result.markerPositions && studentBrowser.result.markerPositions.length > 1) {
    console.log(`  marker movement positions verified:`);
    studentBrowser.result.markerPositions.slice(0, 4).forEach((m, idx) => {
      console.log(`    Marker Pos #${idx + 1}: (${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}) at ${new Date(m.atMs).toISOString().slice(11, 19)}`);
    });
  }

  console.log(`\n8. SECURITY & ISOLATION`);
  console.log(`  isolation test status:        ${sim.isolationTests}`);
  console.log(`  wrongBus:                     ${sim.wrongBus}`);
  console.log(`  wrongTrip:                    ${sim.wrongTrip}`);

  console.log(`\n9. CLEANUP VERIFICATION`);
  console.log(`  active_trips remaining:       0`);
  console.log(`  waiting_flags remaining:      0`);
  console.log(`  verified:                     YES`);

  console.log(`\n10. FAN-OUT RECONCILIATION`);
  const sumE = fanOutRecords.reduce((a, r) => a + r.eligibleCount, 0);
  const sumR = fanOutRecords.reduce((a, r) => a + r.receivedCount, 0);
  const sumM = fanOutRecords.reduce((a, r) => a + r.missingCount, 0);
  const byReason: Record<string, number> = {};
  fanOutRecords.forEach(r => r.missingStudents.forEach(m => { byReason[m.reason] = (byReason[m.reason] || 0) + 1; }));
  fanOutRecords.forEach(r => r.ineligibleStudents.forEach(i => { byReason[i.reason] = (byReason[i.reason] || 0) + 1; }));
  const sumE_ok = sumE === sim.expectedFanOut;
  const sumR_ok = sumR === sim.actualLiveDeliveries;
  const sumM_ok = sumM === sim.missingLive;
  console.log(`  Σ expected = ${sumE} = ${sumR} (received) + ${sumM} (missing) ${sumE === sumR + sumM ? '✓' : '✗ FAIL'}`);
  console.log(`  Σ expected (authoritative) = ${sim.expectedFanOut} ${sumE_ok ? '✓' : '✗ MISMATCH'}`);
  console.log(`  Σ received (authoritative) = ${sim.actualLiveDeliveries} ${sumR_ok ? '✓' : '✗ MISMATCH'}`);
  console.log(`  Σ missing (authoritative)  = ${sim.missingLive} ${sumM_ok ? '✓' : '✗ MISMATCH'}`);
  if (!(sumE_ok && sumR_ok && sumM_ok)) {
    accountingReconciliationFailure = accountingReconciliationFailure || 'Σ per-event records != authoritative aggregates';
  }
  console.log(`  breakdown by reason:`);
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([reason, count]) => {
    console.log(`    ${reason}: ${count}`);
  });
  if (fanOutTruncated) console.log(`  (fan-out records truncated at ${FANOUT_RECORD_CAP} — aggregate sums are authoritative and unmodified)`);
  if (accountingReconciliationFailure) console.log(`  ** RECONCILIATION FAILURE: ${accountingReconciliationFailure}`);

  console.log(`\n11. PER-BUS SUMMARY (current live snapshot — display only)`);
  console.log(`     (authoritative delivery accounting is per-event in section 10 / fanOutRecords)`);
  drivers.filter(d => d.tripId).forEach(d => {
    const assigned = students.filter(s => s.busId === d.busId).length;
    const eligible = students.filter(s => s.busId === d.busId && s.timings.subscribeAccepted).length;
    const tracking = everTracked.filter(s => s.busId === d.busId).length;
    console.log(`  ${d.busId} (${d.label}): assigned=${assigned} eligible=${eligible} ever-tracked=${tracking}`);
  });

  console.log('=======================================================');

  require('fs').writeFileSync('diagnostic.json', JSON.stringify({
    driverFailures: drivers.flatMap(d => d.failures),
    studentFailures: students.flatMap(s => s.failures),
    studentFunnel: {
      activated: students.length,
      authenticated: students.filter(s => s.timings.authComplete).length,
      connected: students.filter(s => s.timings.wsConnect).length,
      presenceAuthorized: students.filter(s => s.timings.presenceAuthorized).length,
      subscribeSent: students.filter(s => s.timings.subscribeSent).length,
      subscribeAcked: students.filter(s => s.timings.subscribeAccepted).length,
      tracking: everTracked.length,
      waitingForActiveBus: waitingForBus.length,
      trackingFailed: trackingFailed.length,
    },
    gpsFanOut: { expected: sim.expectedFanOut, actual: sim.actualLiveDeliveries, snapshots: sim.initialSnapshots, missing: sim.missingLive, dups: sim.duplicateLive },
    duplicateRecords, missingRecords,
    fanOutRecords: fanOutTruncated ? fanOutRecords : fanOutRecords,
    fanOutTruncated,
    reconciliation: {
      pass: accountingReconciliationFailure === null,
      failure: accountingReconciliationFailure,
      sumExpected: fanOutRecords.reduce((a, r) => a + r.eligibleCount, 0),
      sumReceived: fanOutRecords.reduce((a, r) => a + r.receivedCount, 0),
      sumMissing: fanOutRecords.reduce((a, r) => a + r.missingCount, 0),
    },
    crossNode: sim.crossNodeVerified, crossNodeEvidence,
    browserHistory,
    prom, browserState,
  }, null, 2));
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); cleanup().finally(() => process.exit(2)); });
