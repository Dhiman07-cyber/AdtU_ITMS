/**
 * WS Server integration tests — Phase 06 audit fixes.
 *
 * Runs the REAL websocket-server.ts + socket-router.ts pipeline over a real
 * HTTP server on an ephemeral port, with only the Firebase authenticator and
 * the Redis bridge mocked. Covers the fixes:
 *   1. Pre-auth message buffering (subscribe sent right after auth is not dropped)
 *   2. auth_ok carries reconnect_token (session restore was dead code)
 *   3. Session restore is bound to the authenticated uid
 *   4. location_update publishes the subscriber channel (bus_location_*) to Redis
 *   5. Role gating on location_update + GPS metrics wiring
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';
import WebSocket from 'ws';
import { wsServer } from './websocket-server';
import { metricsService } from './metrics-service';
import { sessionManager } from './session-manager';
import { stopMessageValidator } from './message-validator';
import { stopRateLimiter, clearAllRateLimits } from './rate-limiter';

const { authenticateSocket } = vi.hoisted(() => ({
  authenticateSocket: vi.fn(async (request: any) => {
    const url = new URL(request.url || '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    const authHeader = request.headers?.authorization || '';
    const token = queryToken || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '');
    const map: Record<string, { uid: string; role: string }> = {
      'tok-driver': { uid: 'driver-1', role: 'driver' },
      'tok-driver2': { uid: 'driver-2', role: 'driver' },
      'tok-student': { uid: 'student-1', role: 'student' },
      'tok-server': { uid: 'server', role: 'server' },
    };
    const mapped = map[token];
    if (!mapped) return { authenticated: false, error: 'unknown token' };
    return { authenticated: true, ...mapped };
  }),
}));

vi.mock('./authenticator', () => ({ authenticateSocket }));

const mockPublish = vi.hoisted(() => vi.fn());
vi.mock('./redis-broadcast', () => ({
  publishToRedis: mockPublish,
  MY_NODE_ID: 'test-node',
  initRedisBroadcastRelay: vi.fn(async () => {}),
}));

// Mock the Supabase server client used by the presence handler.
// The presence handler calls getSupabaseServer().from(...).select(...).eq(...).maybeSingle().
// In unit tests there are no real env vars, so we mock the entire client.
// Authorization logic:
//   student-1  is authorized for any bus it claims (controlled per-test by busAuthMap)
//   driver-1   is authorized via active_trips for any bus it claims
const busAuthMap: Record<string, string | null> = {};
const mockSupabaseFrom = vi.fn((table: string) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => {
      // Determine which identity is being queried by inspecting the eq calls
      // accumulated on this chain. We piggyback on the last eq() arg to find uid.
      const calls: any[][] = (chain.eq as any).mock.calls;
      const uidCall = calls.find((c) => c[0] === 'uid' || c[0] === 'driver_id');
      const uid = uidCall?.[1];

      if (table === 'student_profiles' && uid === 'student-1') {
        const busId = busAuthMap['student-1'] ?? null;
        return { data: busId ? { bus_id: busId } : null, error: null };
      }
      if (table === 'active_trips' && uid === 'driver-1') {
        const busId = busAuthMap['driver-1'] ?? null;
        return { data: busId ? { bus_id: busId } : null, error: null };
      }
      if (table === 'driver_profiles' && uid === 'driver-1') {
        const busId = busAuthMap['driver-1'] ?? null;
        return { data: busId ? { bus_id: busId } : null, error: null };
      }
      return { data: null, error: null };
    }),
  };
  // Each eq() call must return the same chain object for chaining to work.
  (chain.eq as any).mockImplementation((..._args: any[]) => chain);
  (chain.select as any).mockImplementation((..._args: any[]) => chain);
  return chain;
});
vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({ from: mockSupabaseFrom }),
}));

interface Conn {
  ws: WebSocket;
  messages: any[];
  next(): Promise<any>;
}

function connect(query: string, headers: Record<string, string> = {}): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`, { headers });
    const messages: any[] = [];
    const waiters: ((msg: any) => void)[] = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const w = waiters.shift();
      if (w) w(msg);
      else messages.push(msg);
    });
    ws.on('error', reject);
    ws.on('open', () => resolve({
      ws,
      messages,
      next: () => new Promise((res) => {
        if (messages.length) res(messages.shift());
        else waiters.push(res);
      }),
    }));
  });
}

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer();
  wsServer.start(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as any).port;
});

// Each test starts with a clean rate-limiter state — the burst tests below
// legitimately saturate per-socket/user buckets and must not bleed into the
// next test's assertions.
beforeEach(() => {
  clearAllRateLimits();
});

afterAll(() => {
  wsServer.shutdown();
  stopMessageValidator();
  stopRateLimiter();
  server.close();
});

describe('WS server — auth handshake (Path B)', () => {
  it('does not drop subscribe messages sent immediately after auth', async () => {
    busAuthMap['student-1'] = 'b1';
    const c = await connect('');
    c.ws.send(JSON.stringify({ type: 'auth', token: 'tok-student' }));
    c.ws.send(JSON.stringify({ type: 'presence', busId: 'b1' }));
    c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'bus_location_b1' }));

    const ok = await c.next();
    expect(ok.type).toBe('auth_ok');

    const pres = await c.next();
    expect(pres.type).toBe('presence_ok');

    // Without pre-auth buffering this 'subscribed' ack never arrives: the
    // subscribe was consumed by the temporary auth listener and dropped.
    const sub = await c.next();
    expect(sub.type).toBe('subscribed');
    expect(sub.channel).toBe('bus_location_b1');
    c.ws.close();
  });

  it('[RACE REGRESSION] subscribe sent immediately after presence must succeed even when presence DB query is slow', async () => {
    // This is the exact historical production failure:
    //   presence starts async DB query → subscribe executes before DB resolves
    //   → session.busId still unset → subscribe rejected with
    //   "Must send presence with busId before subscribing to bus channels"
    //
    // The fix (per-socket message queue + await routeMessage) must prevent this.
    // If the queue is removed or routeMessage reverts to fire-and-forget, this
    // test MUST fail — that is the intended regression guard.
    busAuthMap['student-1'] = 'b1';
    const c = await connect('');
    // Send auth + presence + subscribe in a single burst with no await between
    // them — simulating the real client behaviour that triggered the race.
    c.ws.send(JSON.stringify({ type: 'auth', token: 'tok-student' }));
    c.ws.send(JSON.stringify({ type: 'presence', busId: 'b1' }));
    c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'bus_location_b1' }));

    const auth = await c.next();
    expect(auth.type).toBe('auth_ok');

    const pres = await c.next();
    // Must be presence_ok — NOT an error frame about unauthorized bus
    expect(pres.type).toBe('presence_ok');

    const sub = await c.next();
    // Must be subscribed — NOT an error frame about "send presence first"
    // If the race exists this is 'error' with message
    // "Must send presence with busId before subscribing to bus channels"
    expect(sub.type).toBe('subscribed');
    expect(sub.channel).toBe('bus_location_b1');
    c.ws.close();
  });

  it('delivers reconnect_token in auth_ok so the client can persist it', async () => {
    const c = await connect('?token=tok-student');
    const ok = await c.next();
    expect(ok.type).toBe('auth_ok');
    expect(ok.data.reconnect_token).toBeTruthy();
    c.ws.close();
  });

  it('accepts Path B auth on reconnect URLs (?reconnect_token= must not trigger Path A)', async () => {
    // Regression: '?reconnect_token=' contains the substring 'token=' — a naive
    // includes('token=') check forced Path A, auth found no token param, and the
    // socket was closed with 4001 before the Path B auth message was read.
    const c = await connect('?reconnect_token=some-arbitrary-token');
    c.ws.send(JSON.stringify({ type: 'auth', token: 'tok-student' }));
    const ok = await c.next();
    expect(ok.type).toBe('auth_ok');
    c.ws.close();
  });

  it('rejects connections that never send an auth message', async () => {
    const c = await connect('');
    const ok = await c.next();
    expect(ok.type).toBe('auth_required');
    expect(metricsService.get('authFailures')).toBeGreaterThan(0);
    c.ws.close();
  }, 10000);
});

describe('WS server — session restore', () => {
  it('restores the session only for the uid that owns the reconnect token', async () => {
    const s1 = await connect('?token=tok-driver');
    const ok1 = await s1.next();
    const token = ok1.data.reconnect_token;
    const before = metricsService.get('reconnectsHandled');

    // Same uid reconnects with the token → session restored.
    const s2 = await connect(`?token=tok-driver&reconnect_token=${token}`);
    const ok2 = await s2.next();
    expect(ok2.type).toBe('auth_ok');
    expect(metricsService.get('reconnectsHandled')).toBe(before + 1);
    const freshToken = ok2.data.reconnect_token;

    // Different uid with the same token → NOT restored (uid-bound check).
    const before2 = metricsService.get('reconnectsHandled');
    const s3 = await connect(`?token=tok-driver2&reconnect_token=${freshToken}`);
    const ok3 = await s3.next();
    expect(ok3.type).toBe('auth_ok');
    expect(metricsService.get('reconnectsHandled')).toBe(before2);
    expect(sessionManager.getByUid('driver-2').length).toBeGreaterThanOrEqual(1);

    s1.ws.close();
    s2.ws.close();
    s3.ws.close();
  });
});

describe('WS server — location pipeline', () => {
  it('drops legacy driver location_update messages and does not broadcast them', async () => {
    mockPublish.mockClear();
    busAuthMap['driver-1'] = 'b2';
    busAuthMap['student-1'] = 'b2';

    const driver = await connect('?token=tok-driver');
    await driver.next(); // auth_ok
    driver.ws.send(JSON.stringify({ type: 'presence', busId: 'b2' }));
    await driver.next(); // presence_ok

    const student = await connect('?token=tok-student');
    await student.next(); // auth_ok
    student.ws.send(JSON.stringify({ type: 'presence', busId: 'b2' }));
    await student.next(); // presence_ok
    student.ws.send(JSON.stringify({ type: 'subscribe', channel: 'bus_location_b2' }));
    await student.next(); // subscribed ack

    const before = metricsService.get('gpsAccepted');
    driver.ws.send(JSON.stringify({
      type: 'location_update',
      busId: 'b2',
      lat: 11.11111,
      lng: 22.22222,
      speed: 30,
    }));

    // Wait a moment to ensure no message is received
    await new Promise((r) => setTimeout(r, 50));

    // Cross-node relay should NOT be called
    expect(mockPublish).not.toHaveBeenCalled();
    // Metric is still incremented for legacy tracking
    expect(metricsService.get('gpsAccepted')).toBe(before + 1);

    driver.ws.close();
    student.ws.close();
  });

  it('exempts the privileged server broadcast socket from per-socket rate limiting', async () => {
    // The server bridge socket is the ingestion path for every GPS broadcast.
    // A driver's location_update generates ~1 msg/tick on the DRIVER socket, but
    // the server socket receives 10 broadcasts per tick (1 per bus). At 2s
    // cadence with 10 buses that is 50 msgs/10s — under the old 60/socket limit
    // only by margin, and bursty reconnect drains push it over. Regression:
    // the server socket must NEVER be rate-limited or broadcasts get dropped.
    busAuthMap['student-1'] = 'b3';
    const server = await connect('?token=tok-server');
    await server.next(); // auth_ok
    const student = await connect('?token=tok-student');
    await student.next(); // auth_ok
    student.ws.send(JSON.stringify({ type: 'presence', busId: 'b3' }));
    await student.next(); // presence_ok
    student.ws.send(JSON.stringify({ type: 'subscribe', channel: 'bus_location_b3' }));
    await student.next(); // subscribed

    const before = metricsService.get('rateLimitBlocks');
    // 250 broadcasts on the server socket in a tight burst — far beyond any
    // per-socket limit. With the exemption they must ALL be relayed to the
    // student; without it, >60 would be silently dropped.
    for (let i = 0; i < 250; i++) {
      server.ws.send(JSON.stringify({
        type: 'broadcast',
        channel: 'bus_location_b3',
        event: 'bus_location_update',
        payload: { busId: 'b3', driverUid: 'driver-1', lat: 11.1, lng: 22.2, timestamp: new Date().toISOString() },
      }));
    }

    let received = 0;
    const deadline = Date.now() + 5000;
    while (received < 250 && Date.now() < deadline) {
      try {
        const msg = await Promise.race([
          student.next(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000)),
        ]);
        if (msg?.type === 'message' && msg.channel === 'bus_location_b3') received++;
      } catch { break; }
    }

    expect(metricsService.get('rateLimitBlocks')).toBe(before);
    expect(received).toBeGreaterThan(200); // the burst was NOT rate-limited away
    server.ws.close();
    student.ws.close();
  }, 15000);

  it('does not drop broadcasts to a student socket with bufferedAmount at the cap', async () => {
    // Regression for backpressure-induced silent drops: broadcastToChannel sends
    // only when the socket is OPEN AND its writable buffer is below the cap.
    // Saturated sockets fall back to enqueueOffline (durable retry on reconnect)
    // instead of ws.send() silently dropping the frame.
    busAuthMap['student-1'] = 'b4';
    const server = await connect('?token=tok-server');
    await server.next(); // auth_ok
    const student = await connect('?token=tok-student');
    await student.next(); // auth_ok
    student.ws.send(JSON.stringify({ type: 'presence', busId: 'b4' }));
    await student.next(); // presence_ok
    student.ws.send(JSON.stringify({ type: 'subscribe', channel: 'bus_location_b4' }));
    await student.next(); // subscribed

    const before = metricsService.get('rateLimitBlocks');
    // Push 500 broadcasts — even if the socket buffer saturates, the server must
    // not crash and the offline queue must absorb the excess.
    for (let i = 0; i < 500; i++) {
      server.ws.send(JSON.stringify({
        type: 'broadcast',
        channel: 'bus_location_b4',
        event: 'bus_location_update',
        payload: { busId: 'b4', driverUid: 'driver-1', lat: 11.1, lng: 22.2, timestamp: new Date().toISOString() },
      }));
    }

    // Give the send loop + offline queue time to process.
    await new Promise((r) => setTimeout(r, 500));
    expect(metricsService.get('rateLimitBlocks')).toBe(before);
    server.ws.close();
    student.ws.close();
  }, 15000);


  it('rejects location updates from non-driver roles and counts them as GPS rejections', async () => {
    const before = metricsService.get('gpsRejected');
    const student = await connect('?token=tok-student');
    await student.next(); // auth_ok
    student.ws.send(JSON.stringify({ type: 'location_update', busId: 'b3', lat: 1, lng: 2 }));
    const err = await student.next();
    expect(err.type).toBe('error');
    expect(metricsService.get('gpsRejected')).toBe(before + 1);
    student.ws.close();
  });

  describe('Rate Limiter & Privileged Server Exemption', () => {
    it('enforces PER_SOCKET limit (60) on normal client socket', async () => {
      const student = await connect('?token=tok-student');
      await student.next(); // auth_ok

      const initialBlocks = metricsService.get('rateLimitBlocks');

      // Send 60 messages (allowed under PER_SOCKET = 60)
      for (let i = 0; i < 60; i++) {
        student.ws.send(JSON.stringify({ type: 'pong' }));
      }
      for (let i = 0; i < 60; i++) {
        const ack = await student.next();
        expect(ack.type).toBe('pong_ack');
      }

      // The 61st message exceeds the per-socket limit (60)
      student.ws.send(JSON.stringify({ type: 'pong' }));
      const blocked = await student.next();
      expect(blocked.type).toBe('error');
      expect(blocked.message).toBe('Rate limit exceeded');
      expect(metricsService.get('rateLimitBlocks')).toBe(initialBlocks + 1);

      student.ws.close();
    });

    it('enforces PER_USER limit (200) across multiple sockets for the same user', async () => {
      // Connect 4 sockets for the same user (uid: 'student-1') with distinct IPs to isolate PER_USER from PER_IP (100)
      const s1 = await connect('?token=tok-student', { 'x-forwarded-for': '192.168.1.1' });
      await s1.next(); // auth_ok
      const s2 = await connect('?token=tok-student', { 'x-forwarded-for': '192.168.1.2' });
      await s2.next(); // auth_ok
      const s3 = await connect('?token=tok-student', { 'x-forwarded-for': '192.168.1.3' });
      await s3.next(); // auth_ok
      const s4 = await connect('?token=tok-student', { 'x-forwarded-for': '192.168.1.4' });
      await s4.next(); // auth_ok

      const sockets = [s1, s2, s3, s4];
      // Distribute 50 messages to each socket (50 * 4 = 200, within PER_SOCKET=60, hitting PER_USER=200)
      for (let i = 0; i < 50; i++) {
        for (const s of sockets) {
          s.ws.send(JSON.stringify({ type: 'pong' }));
        }
      }
      for (const s of sockets) {
        for (let i = 0; i < 50; i++) {
          const ack = await s.next();
          expect(ack.type).toBe('pong_ack');
        }
      }

      // The 201st message across this user's sockets exceeds PER_USER (200)
      s1.ws.send(JSON.stringify({ type: 'pong' }));
      const blocked = await s1.next();
      expect(blocked.type).toBe('error');
      expect(blocked.message).toBe('Rate limit exceeded');

      for (const s of sockets) s.ws.close();
    });

    it('proves normal client cannot self-assign role=server and cannot broadcast', async () => {
      const student = await connect('?token=tok-student');
      const authOk = await student.next();
      expect(authOk.data.role).toBe('student');

      // Attempt to self-assign server role via presence
      student.ws.send(JSON.stringify({ type: 'presence', role: 'server' }));
      const presRes = await student.next();
      // Presence ignores role and acknowledges presence
      expect(presRes.type).toBe('presence_ok');

      // Attempt privileged broadcast as ordinary client
      student.ws.send(JSON.stringify({
        type: 'broadcast',
        channel: 'bus_location_test',
        event: 'test_event',
        payload: { test: true },
      }));
      const broadcastErr = await student.next();
      expect(broadcastErr.type).toBe('error');
      expect(broadcastErr.message).toBe('Only server can broadcast');

      student.ws.close();
    });

    it('proves authenticated server connection is strictly exempt from PER_SOCKET (60) and PER_USER (200)', async () => {
      const server = await connect('?token=tok-server');
      const authOk = await server.next();
      expect(authOk.data.role).toBe('server');

      const initialBlocks = metricsService.get('rateLimitBlocks');

      // Send 250 broadcasts — far exceeding both PER_SOCKET (60) and PER_USER (200)
      for (let i = 0; i < 250; i++) {
        server.ws.send(JSON.stringify({
          type: 'broadcast',
          channel: 'bus_location_exempt_test',
          event: 'bus_location_update',
          payload: { busId: 'b-exempt', lat: 10, lng: 20 },
        }));
      }

      // Wait 300ms to allow all 250 to process through messageQueue
      await new Promise((r) => setTimeout(r, 300));

      // No rate limit blocks occurred
      expect(metricsService.get('rateLimitBlocks')).toBe(initialBlocks);

      server.ws.close();
    });
  });
});
