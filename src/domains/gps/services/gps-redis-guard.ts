/**
 * GPS State Store — Redis-backed, multi-instance-safe
 *
 * Replaces the process-local `inMemoryLastLocations` and `inMemoryLastRawTs`
 * Maps in gps-pipeline.service.ts with a globally consistent Redis store.
 *
 * WHY REDIS:
 *   In production every driver's GPS HTTP POST can land on any Next.js
 *   container. With a process-local Map, the jump guard and raw-clock replay
 *   guard are per-container, which means:
 *     - Container A sees packets 1, 3, 5 → accepts all (no cross-container memory)
 *     - Container B sees packets 2, 4, 6 → accepts all (no cross-container memory)
 *   Result: both jump rejection and replay rejection are silently disabled in
 *   multi-instance deployments. This is a P0 reliability issue.
 *
 * APPROACH:
 *   Store last-location state in a Redis HASH per bus. Use an atomic Lua
 *   script that reads the current state and the incoming packet in a single
 *   Redis round-trip, performs all guard checks server-side, and returns the
 *   decision without a separate read-then-write race window.
 *
 * KEY STRUCTURE:
 *   gps:last:<busId>  →  HASH { lat, lng, ts, rawTs }
 *   TTL: 20 minutes (≈ 2× the trip lock TTL of 600s).
 *   Refreshed on every accepted packet.
 *
 * FALLBACK:
 *   When REDIS_URL is not configured (dev single-instance) or the Redis
 *   connection fails, the implementation falls back to the in-memory Maps
 *   transparently. This preserves correctness on single-instance deployments
 *   and dev environments.
 *
 * IMPORTANT — NOT imported by server/redis-client.ts: this module runs in the
 * Next.js app process. It has its own singleton connection.
 */

import * as net from 'net';

const KEY_PREFIX = 'gps:last:';
const TTL_SECONDS = 1200; // 20 minutes
const RECONNECT_DELAY_MS = 3000;
const CONNECT_TIMEOUT_MS = 3000;
// Match gps-normalizer.service.ts MAX_CLOCK_SKEW_MS exactly
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000; // 2 minutes

// ──────────────────────────────────────────────────────────────────────────────
// Singleton state (globalThis — survives Next.js HMR in dev)
// ──────────────────────────────────────────────────────────────────────────────

interface GpsRedisState {
  socket: net.Socket | null;
  ready: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  host: string;
  port: number;
  password?: string;
  generation: number;
  /** Pending command callbacks: resolve with response string or null on error */
  pending: Array<{ resolve: (v: string | null) => void }>;
  buffer: Buffer;
}

// ──────────────────────────────────────────────────────────────────────────────
// URL parsing
// ──────────────────────────────────────────────────────────────────────────────

function parseRedisUrl(urlStr?: string): { host: string; port: number; password?: string } {
  if (!urlStr) return { host: '127.0.0.1', port: 6379 };
  try {
    const u = new URL(urlStr);
    return {
      host: u.hostname || '127.0.0.1',
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
    };
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
}

function getState(): GpsRedisState {
  const g = globalThis as any;
  if (!g.__gpsRedis) {
    const parsed = parseRedisUrl(process.env.REDIS_URL);
    g.__gpsRedis = {
      socket: null,
      ready: false,
      reconnectTimer: null,
      host: parsed.host,
      port: parsed.port,
      password: parsed.password,
      generation: 0,
      pending: [],
      buffer: Buffer.alloc(0),
    } as GpsRedisState;
  }
  return g.__gpsRedis as GpsRedisState;
}

// ──────────────────────────────────────────────────────────────────────────────
// RESP command serialization
// ──────────────────────────────────────────────────────────────────────────────

function encodeCmd(args: string[]): string {
  let s = `*${args.length}\r\n`;
  for (const a of args) s += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
  return s;
}

// ──────────────────────────────────────────────────────────────────────────────
// RESP response parser (returns the first complete top-level element)
// ──────────────────────────────────────────────────────────────────────────────

type RespValue = string | number | null | RespValue[];

function parseResp(buf: Buffer, offset: number): { value: RespValue; next: number } | null {
  if (offset >= buf.length) return null;
  const prefix = buf[offset];
  const crlf = buf.indexOf('\r\n', offset + 1);
  if (crlf === -1) return null;

  if (prefix === 0x2b) { // '+' simple string
    return { value: buf.toString('utf8', offset + 1, crlf), next: crlf + 2 };
  }
  if (prefix === 0x2d) { // '-' error
    return { value: null, next: crlf + 2 };
  }
  if (prefix === 0x3a) { // ':' integer
    return { value: parseInt(buf.toString('utf8', offset + 1, crlf), 10), next: crlf + 2 };
  }
  if (prefix === 0x24) { // '$' bulk string
    const len = parseInt(buf.toString('utf8', offset + 1, crlf), 10);
    if (len === -1) return { value: null, next: crlf + 2 };
    const end = crlf + 2 + len;
    if (end + 2 > buf.length) return null;
    return { value: buf.toString('utf8', crlf + 2, end), next: end + 2 };
  }
  if (prefix === 0x2a) { // '*' array
    const numElems = parseInt(buf.toString('utf8', offset + 1, crlf), 10);
    if (numElems === -1) return { value: null, next: crlf + 2 };
    const arr: RespValue[] = [];
    let pos = crlf + 2;
    for (let i = 0; i < numElems; i++) {
      const elem = parseResp(buf, pos);
      if (!elem) return null;
      arr.push(elem.value);
      pos = elem.next;
    }
    return { value: arr, next: pos };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Connection
// ──────────────────────────────────────────────────────────────────────────────

function connectGpsRedis(state: GpsRedisState): void {
  const gen = ++state.generation;
  if (state.socket && !state.socket.destroyed) state.socket.destroy();
  state.ready = false;
  state.buffer = Buffer.alloc(0);

  const sock = net.createConnection({ host: state.host, port: state.port });

  const timeout = setTimeout(() => {
    if (gen !== state.generation) return;
    sock.destroy(new Error('GPS Redis connect timeout'));
  }, CONNECT_TIMEOUT_MS);

  sock.on('connect', () => {
    clearTimeout(timeout);
    if (gen !== state.generation) return;
    if (state.password) sock.write(encodeCmd(['AUTH', state.password]));
    state.ready = true;
    state.socket = sock;
  });

  sock.on('data', (chunk: Buffer) => {
    if (gen !== state.generation) return;
    state.buffer = Buffer.concat([state.buffer, chunk]);
    // Drain all complete messages and resolve pending callbacks
    while (state.pending.length > 0) {
      const parsed = parseResp(state.buffer, 0);
      if (!parsed) break;
      state.buffer = state.buffer.subarray(parsed.next);
      const cb = state.pending.shift();
      if (cb) {
        const raw = parsed.value;
        // Normalise to string | null for callers
        if (raw === null || raw === undefined) {
          cb.resolve(null);
        } else if (typeof raw === 'string') {
          cb.resolve(raw);
        } else if (typeof raw === 'number') {
          cb.resolve(String(raw));
        } else {
          // Array (Lua table, etc.) — JSON-encode for callers that parse it
          cb.resolve(JSON.stringify(raw));
        }
      }
    }
  });

  sock.on('error', (err) => {
    clearTimeout(timeout);
    if (gen !== state.generation) return;
    console.warn('[gps-redis] connection error:', err.message);
    state.ready = false;
    // Reject all pending
    for (const cb of state.pending) cb.resolve(null);
    state.pending = [];
    scheduleGpsReconnect(state);
  });

  sock.on('close', () => {
    clearTimeout(timeout);
    if (gen !== state.generation) return;
    state.ready = false;
    for (const cb of state.pending) cb.resolve(null);
    state.pending = [];
    scheduleGpsReconnect(state);
  });

  state.socket = sock;
}

function scheduleGpsReconnect(state: GpsRedisState): void {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectGpsRedis(state);
  }, RECONNECT_DELAY_MS);
}

function sendCommand(state: GpsRedisState, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    if (!state.ready || !state.socket || state.socket.destroyed) {
      resolve(null);
      return;
    }
    state.pending.push({ resolve });
    state.socket.write(encodeCmd(args));
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Lua script — atomic GPS guard
// ──────────────────────────────────────────────────────────────────────────────
// Inputs (ARGV):
//   1: newLat         (float, string)
//   2: newLng         (float, string)
//   3: newTs          (epoch ms, normalised, string)
//   4: newRawTs       (epoch ms, raw client clock, string; '-1' if unavailable)
//   5: maxJumpMeters  (string, e.g. '5000')
//   6: maxSkewMs      (string, e.g. '300000')
//
// Returns (bulk string):
//   'ok'              — packet accepted, state updated
//   'stale_raw'       — raw client clock older than last accepted
//   'jump'            — haversine distance exceeds maxJumpMeters
//   'speed'           — implied speed exceeds maxSpeedKmh
//   'out_of_order'    — normalised timestamp older than last accepted
//
// The KEYS[1] is the per-bus Redis HASH key.

const LUA_GPS_GUARD = `
local key = KEYS[1]
local newLat    = tonumber(ARGV[1])
local newLng    = tonumber(ARGV[2])
local newTs     = tonumber(ARGV[3])
local newRawTs  = tonumber(ARGV[4])
local maxJump   = tonumber(ARGV[5])
local maxSkew   = tonumber(ARGV[6])

local cur = redis.call('HMGET', key, 'lat', 'lng', 'ts', 'rawTs')
local curLat   = tonumber(cur[1])
local curLng   = tonumber(cur[2])
local curTs    = tonumber(cur[3])
local curRawTs = tonumber(cur[4])

-- Raw clock replay guard
if newRawTs > 0 and curRawTs ~= nil and newRawTs < curRawTs then
  return 'stale_raw'
end

-- Normalised timestamp ordering guard (5s skew tolerance)
if curTs ~= nil and newTs > 0 and newTs + 5000 < curTs then
  return 'out_of_order'
end

-- Haversine jump + speed guard (only when we have a previous fix)
if curLat ~= nil and curLng ~= nil then
  local R = 6371000
  local lat1 = math.rad(curLat)
  local lat2 = math.rad(newLat)
  local dlat = math.rad(newLat - curLat)
  local dlng = math.rad(newLng - curLng)
  local sinDlat = math.sin(dlat / 2)
  local sinDlng = math.sin(dlng / 2)
  local a = sinDlat * sinDlat + math.cos(lat1) * math.cos(lat2) * sinDlng * sinDlng
  local c = 2 * math.atan(math.sqrt(a), math.sqrt(1 - a))
  local dist = R * c

  if dist > maxJump then
    return 'jump'
  end

  if curTs ~= nil and newTs > 0 then
    local timeDiffSec = (newTs - curTs) / 1000.0
    if dist > 100 and timeDiffSec > 0.5 then
      local speedMps = dist / timeDiffSec
      local maxSpeedMps = 200.0 / 3.6
      if speedMps > maxSpeedMps then
        return 'speed'
      end
    end
  end
end

-- Accept: write new state and refresh TTL
local clampedRaw = newRawTs
if newRawTs > 0 then
  local serverNow = tonumber(ARGV[7])
  if newRawTs > serverNow + maxSkew then
    clampedRaw = serverNow + maxSkew
  end
end

redis.call('HSET', key, 'lat', newLat, 'lng', newLng, 'ts', newTs, 'rawTs', clampedRaw)
redis.call('EXPIRE', key, tonumber(ARGV[8]))
return 'ok'
`;

// ──────────────────────────────────────────────────────────────────────────────
// In-memory fallback (single-instance / Redis unavailable)
// ──────────────────────────────────────────────────────────────────────────────

interface LastLoc { lat: number; lng: number; ts: number; rawTs: number }

const memLast = new Map<string, LastLoc>();

const MAX_JUMP_M = 5000;
const MAX_SPEED_MPS = 200 / 3.6;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3;
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad, φ2 = lat2 * toRad;
  const Δφ = (lat2 - lat1) * toRad;
  const Δλ = (lng2 - lng1) * toRad;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type GpsGuardResult = 'ok' | 'stale_raw' | 'jump' | 'speed' | 'out_of_order' | 'duplicate' | 'redis_unavailable';

export function getGpsRedisHealth(): { ready: boolean; host: string; port: number } {
  const state = getState();
  return {
    ready: Boolean(state.ready && state.socket && !state.socket.destroyed),
    host: state.host,
    port: state.port,
  };
}

function memoryGuard(
  busId: string,
  newLat: number, newLng: number, newTs: number, newRawTs: number | null,
): GpsGuardResult {
  const cur = memLast.get(busId);
  if (cur) {
    // Raw clock replay guard: a replayed/stale packet carries an older raw clock.
    // Only apply when we have a real rawTs on both sides.
    if (newRawTs !== null && cur.rawTs > 0 && newRawTs < cur.rawTs) return 'stale_raw';

    const timeDiffSec = (newTs - cur.ts) / 1000;

    // Out-of-order normalised timestamp (allow 5s tolerance)
    if (timeDiffSec < -5) return 'out_of_order';

    const dist = haversineM(cur.lat, cur.lng, newLat, newLng);

    // Duplicate timestamp special cases
    if (timeDiffSec === 0) {
      if (dist > 50) return 'duplicate';  // same ts, big jump
      return 'ok';                         // same ts, same-ish coords — idempotent retry
    }

    if (dist > MAX_JUMP_M) return 'jump';
    if (dist > 100 && timeDiffSec > 0.5 && dist / timeDiffSec > MAX_SPEED_MPS) return 'speed';
  }

  const clampedRaw = newRawTs !== null
    ? Math.min(newRawTs, Date.now() + MAX_CLOCK_SKEW_MS)
    : 0;
  memLast.set(busId, { lat: newLat, lng: newLng, ts: newTs, rawTs: clampedRaw });
  return 'ok';
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  const url = process.env.REDIS_URL;
  if (!url) return; // memory-only mode
  const parsed = parseRedisUrl(url);
  const state = getState();
  state.host = parsed.host;
  state.port = parsed.port;
  state.password = parsed.password;
  connectGpsRedis(state);
}

async function waitForReady(state: GpsRedisState, timeoutMs = 400): Promise<boolean> {
  if (state.ready) return true;
  const start = Date.now();
  while (!state.ready && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
  return state.ready;
}

/**
 * Atomically check GPS guard conditions and update state.
 *
 * Returns 'ok' if the packet passes all guards and was committed.
 * Returns a rejection reason string otherwise.
 *
 * Thread-safe across Next.js instances via Redis Lua script.
 * In production, fails closed on Redis failure to guarantee multi-instance spatial correctness.
 * Falls back to process-local guard ONLY in non-production/dev environments.
 */
export async function atomicGpsGuardAndUpdate(
  busId: string,
  newLat: number,
  newLng: number,
  newTs: number,
  newRawTs: number | null,
): Promise<GpsGuardResult> {
  ensureInit();
  const state = getState();

  if (!state.ready && process.env.REDIS_URL) {
    await waitForReady(state, 400);
  }

  if (state.ready && state.socket && !state.socket.destroyed) {
    try {
      const key = `${KEY_PREFIX}${busId}`;
      const rawTsArg = newRawTs !== null ? String(newRawTs) : '-1';
      const serverNow = String(Date.now());

      // EVALSHA is not used here (no script pre-loading); EVAL is fine at this
      // call frequency (50 buses × 0.5 Hz = 25 calls/sec max).
      const result = await sendCommand(state, [
        'EVAL', LUA_GPS_GUARD, '1', key,
        String(newLat), String(newLng), String(newTs),
        rawTsArg,
        String(MAX_JUMP_M),
        String(MAX_CLOCK_SKEW_MS),
        serverNow,
        String(TTL_SECONDS),
      ]);

      if (result === 'ok' || result === 'stale_raw' || result === 'jump'
          || result === 'speed' || result === 'out_of_order') {
        return result as GpsGuardResult;
      }
      // Unexpected result — log and evaluate fallback policy below
    } catch (e) {
      console.warn('[gps-redis] atomicGpsGuardAndUpdate Redis error:', e);
    }
  }

  // Multi-instance Production Invariant:
  // If Redis is configured in production, do NOT silently fall back to process-local memLast,
  // as independent Next.js nodes would accept interleaved GPS packets bypassing jump/replay protection.
  const isProd = process.env.NODE_ENV === 'production';
  const hasRedisConfig = Boolean(process.env.REDIS_URL);
  const allowLocalFallback = process.env.ALLOW_INSECURE_LOCAL_GPS_FALLBACK === 'true';

  if (isProd && hasRedisConfig && !allowLocalFallback) {
    console.error('[gps-redis] FAIL-CLOSED: Redis coordination unavailable in production. Rejecting GPS update to protect spatial invariants.');
    return 'redis_unavailable';
  }

  // Non-production / local single-instance fallback
  return memoryGuard(busId, newLat, newLng, newTs, newRawTs);
}

/**
 * Clear GPS state for a bus (called when a trip ends).
 * Best-effort: clears both Redis and the in-memory fallback.
 */
export async function clearGpsState(busId: string): Promise<void> {
  memLast.delete(busId);
  const state = getState();
  if (state.ready && state.socket && !state.socket.destroyed) {
    try {
      await sendCommand(state, ['DEL', `${KEY_PREFIX}${busId}`]);
    } catch { /* best-effort */ }
  }
}

/**
 * Seed the process-local guard anchor for a bus.
 *
 * Called by setInMemoryLastLocation (pipeline) and the WS socket-router
 * when a driver connects and an initial position is available.
 * Keeps memLast coherent with inMemoryLastLocations so duplicate/replay
 * guards work correctly in single-instance (no-Redis) mode.
 *
 * Does NOT write to Redis — the HTTP pipeline owns the Redis state.
 */
export function seedGpsState(busId: string, lat: number, lng: number, ts: number): void {
  memLast.set(busId, { lat, lng, ts, rawTs: ts });
}

// Eagerly initialize connection if REDIS_URL is present at module load
if (typeof process !== 'undefined' && process.env?.REDIS_URL) {
  try {
    ensureInit();
  } catch {
    // best-effort eager init
  }
}


