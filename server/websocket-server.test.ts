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

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'http';
import type { Server } from 'http';
import WebSocket from 'ws';
import { wsServer } from './websocket-server';
import { metricsService } from './metrics-service';
import { sessionManager } from './session-manager';
import { stopMessageValidator } from './message-validator';
import { stopRateLimiter } from './rate-limiter';

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

interface Conn {
  ws: WebSocket;
  messages: any[];
  next(): Promise<any>;
}

function connect(query: string): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
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

afterAll(() => {
  wsServer.shutdown();
  stopMessageValidator();
  stopRateLimiter();
  server.close();
});

describe('WS server — auth handshake (Path B)', () => {
  it('does not drop subscribe messages sent immediately after auth', async () => {
    const c = await connect('');
    c.ws.send(JSON.stringify({ type: 'auth', token: 'tok-student' }));
    c.ws.send(JSON.stringify({ type: 'subscribe', channel: 'bus_location_b1' }));

    const ok = await c.next();
    expect(ok.type).toBe('auth_ok');

    // Without pre-auth buffering this 'subscribed' ack never arrives: the
    // subscribe was consumed by the temporary auth listener and dropped.
    const sub = await c.next();
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
  it('broadcasts driver location to bus_location_ subscribers and relays the subscriber channel to Redis', async () => {
    mockPublish.mockClear();

    const driver = await connect('?token=tok-driver');
    await driver.next(); // auth_ok

    const student = await connect('?token=tok-student');
    await student.next(); // auth_ok
    student.ws.send(JSON.stringify({ type: 'subscribe', channel: 'bus_location_b2' }));
    await student.next(); // subscribed (includes initial cached push on the same socket)

    const before = metricsService.get('gpsAccepted');
    driver.ws.send(JSON.stringify({
      type: 'location_update',
      busId: 'b2',
      lat: 11.11111,
      lng: 22.22222,
      speed: 30,
    }));

    // Subscriber receives the live update on bus_location_b2.
    const msg = await student.next();
    expect(msg.type).toBe('message');
    expect(msg.channel).toBe('bus_location_b2');
    expect(msg.event).toBe('bus_location_update');
    expect(msg.payload.busId).toBe('b2');

    // Cross-node relay publishes the channel subscribers actually listen on.
    expect(mockPublish).toHaveBeenCalledWith(
      'bus_location_b2',
      'bus_location_update',
      expect.objectContaining({ busId: 'b2' }),
    );
    expect(metricsService.get('gpsAccepted')).toBe(before + 1);

    driver.ws.close();
    student.ws.close();
  });

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
});
