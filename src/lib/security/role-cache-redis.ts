/**
 * Role Cache Redis Bridge
 *
 * Minimal Redis pub/sub client for the Next.js app process.
 * Purpose: broadcast role invalidations across Next.js instances so that
 * a role change on one node is immediately visible to all other nodes,
 * regardless of the 5-minute local TTL.
 *
 * Shares NO code with server/redis-client.ts (different process). Uses the
 * same raw TCP RESP protocol to avoid adding an npm dependency.
 *
 * Channel: 'role_invalidate'
 * Message format: plain UID string
 *
 * Lifecycle:
 *   - Initialized lazily on first call to invalidateCachedRoleGlobally().
 *   - Reconnects automatically on socket error/close.
 *   - If REDIS_URL is not set, operates in no-op mode (local-only behaviour,
 *     safe in single-instance dev deployments).
 */

import * as net from 'net';

const ROLE_INVALIDATE_CHANNEL = 'role_invalidate';
const RECONNECT_DELAY_MS = 5000;

// ──────────────────────────────────────────────────────────────────────────────
// Internal state (globalThis singleton — survives Next.js HMR in dev)
// ──────────────────────────────────────────────────────────────────────────────

interface BridgeState {
  pubSocket: net.Socket | null;
  subSocket: net.Socket | null;
  pubReady: boolean;
  subReady: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  host: string;
  port: number;
  password?: string;
  invalidationHandlers: Set<(uid: string) => void>;
  initialized: boolean;
}

function getState(): BridgeState {
  const g = globalThis as any;
  if (!g.__roleCacheRedis) {
    g.__roleCacheRedis = {
      pubSocket: null,
      subSocket: null,
      pubReady: false,
      subReady: false,
      reconnectTimer: null,
      host: '127.0.0.1',
      port: 6379,
      password: undefined,
      invalidationHandlers: new Set<(uid: string) => void>(),
      initialized: false,
    } as BridgeState;
  }
  return g.__roleCacheRedis as BridgeState;
}

// ──────────────────────────────────────────────────────────────────────────────
// RESP command serialization
// ──────────────────────────────────────────────────────────────────────────────

function encodeCommand(args: string[]): string {
  let cmd = `*${args.length}\r\n`;
  for (const a of args) {
    cmd += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
  }
  return cmd;
}

function parseUrl(urlStr?: string): { host: string; port: number; password?: string } {
  const defaults = { host: '127.0.0.1', port: 6379 };
  if (!urlStr) return defaults;
  try {
    const u = new URL(urlStr);
    return {
      host: u.hostname || '127.0.0.1',
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
    };
  } catch {
    return defaults;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// RESP subscription message parser (minimal — only handles 'message' arrays)
// ──────────────────────────────────────────────────────────────────────────────

function parseSubData(buf: Buffer, handlers: Set<(uid: string) => void>): Buffer {
  let offset = 0;
  while (offset < buf.length) {
    // Scan for a RESP array '*'
    if (buf[offset] !== 0x2a) {
      const next = buf.indexOf(0x2a, offset + 1);
      if (next === -1) return Buffer.alloc(0);
      offset = next;
      continue;
    }
    const crlf1 = buf.indexOf('\r\n', offset);
    if (crlf1 === -1) break;
    const numElems = parseInt(buf.toString('utf8', offset + 1, crlf1), 10);
    if (numElems !== 3) {
      // skip — subscribe ack is *3 too; we rely on the first element being 'message'
      offset = crlf1 + 2;
      continue;
    }
    // parse 3 bulk strings
    let pos = crlf1 + 2;
    const parts: string[] = [];
    let ok = true;
    for (let i = 0; i < 3; i++) {
      if (pos >= buf.length || buf[pos] !== 0x24) { ok = false; break; }
      const lCrlf = buf.indexOf('\r\n', pos);
      if (lCrlf === -1) { ok = false; break; }
      const len = parseInt(buf.toString('utf8', pos + 1, lCrlf), 10);
      const end = lCrlf + 2 + len;
      if (end + 2 > buf.length) { ok = false; break; }
      parts.push(buf.toString('utf8', lCrlf + 2, end));
      pos = end + 2;
    }
    if (!ok) break;
    offset = pos;
    if (parts[0] === 'message') {
      const uid = parts[2];
      for (const h of handlers) {
        try { h(uid); } catch { /* swallow */ }
      }
    }
  }
  return buf.subarray(offset) as Buffer;
}

// ──────────────────────────────────────────────────────────────────────────────
// Connection management
// ──────────────────────────────────────────────────────────────────────────────

function connectPub(state: BridgeState): void {
  if (state.pubSocket && !state.pubSocket.destroyed) state.pubSocket.destroy();
  state.pubReady = false;

  const sock = net.createConnection({ host: state.host, port: state.port }, () => {
    state.pubReady = true;
    if (state.password) sock.write(encodeCommand(['AUTH', state.password]));
  });

  sock.on('error', () => {
    state.pubReady = false;
    scheduleReconnect(state);
  });

  sock.on('close', () => {
    state.pubReady = false;
    scheduleReconnect(state);
  });

  state.pubSocket = sock;
}

function connectSub(state: BridgeState): void {
  if (state.subSocket && !state.subSocket.destroyed) state.subSocket.destroy();
  state.subReady = false;

  const sock = net.createConnection({ host: state.host, port: state.port }, () => {
    state.subReady = true;
    if (state.password) sock.write(encodeCommand(['AUTH', state.password]));
    sock.write(encodeCommand(['SUBSCRIBE', ROLE_INVALIDATE_CHANNEL]));
  });

  let buf: Buffer = Buffer.alloc(0);
  sock.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    buf = parseSubData(buf, state.invalidationHandlers);
  });

  sock.on('error', () => {
    state.subReady = false;
    scheduleReconnect(state);
  });

  sock.on('close', () => {
    state.subReady = false;
    scheduleReconnect(state);
  });

  state.subSocket = sock;
}


function scheduleReconnect(state: BridgeState): void {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (!state.pubReady) connectPub(state);
    if (!state.subReady) connectSub(state);
  }, RECONNECT_DELAY_MS);
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the Redis bridge. Safe to call multiple times.
 * No-ops if REDIS_URL is not configured.
 */
export function initRoleCacheRedis(localInvalidate: (uid: string) => void): void {
  const state = getState();
  if (state.initialized) {
    // Register the (potentially new) handler from the current module instance
    state.invalidationHandlers.add(localInvalidate);
    return;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    // No Redis configured — log once and operate in local-only mode.
    console.info('[role-cache] REDIS_URL not set; role invalidations are local-only (single-instance mode).');
    state.initialized = true;
    return;
  }

  const parsed = parseUrl(redisUrl);
  state.host = parsed.host;
  state.port = parsed.port;
  state.password = parsed.password;
  state.initialized = true;

  state.invalidationHandlers.add(localInvalidate);

  connectPub(state);
  connectSub(state);
}

/**
 * Publish a role invalidation to all Next.js instances via Redis pub/sub.
 * Falls back to no-op if Redis is not connected.
 */
export function publishRoleInvalidation(uid: string): void {
  const state = getState();
  if (!state.initialized) return;
  if (state.pubReady && state.pubSocket && !state.pubSocket.destroyed) {
    try {
      state.pubSocket.write(encodeCommand(['PUBLISH', ROLE_INVALIDATE_CHANNEL, uid]));
    } catch {
      /* best-effort — local invalidation already happened */
    }
  }
}
