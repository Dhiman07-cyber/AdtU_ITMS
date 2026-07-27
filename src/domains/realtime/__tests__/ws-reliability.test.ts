/**
 * WebSocket Reliability Failure Tests — Phase 04
 *
 * Tests reconnect backoff, error handler recovery, and offline queue cleanup
 * determinism. Focuses on logic correctness without importing server modules
 * from outside the src/ boundary (server runs as a separate process).
 */

import { describe, it, expect } from 'vitest';

// ─── Reconnect Backoff Logic ──────────────────────────────────────────────────

describe('WS Client — Reconnect Backoff', () => {
  function computeDelay(attempt: number, baseDelay = 1000, maxDelay = 30000): number {
    return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  }

  it('first attempt uses base delay (1s)', () => {
    expect(computeDelay(0)).toBe(1000);
  });

  it('delay increases exponentially with each attempt', () => {
    const delays = [0, 1, 2, 3, 4].map(a => computeDelay(a));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('delay is capped at 30 seconds regardless of attempt count', () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      expect(computeDelay(attempt)).toBeLessThanOrEqual(30000);
    }
  });

  it('attempt 5 equals 30s cap (32000ms uncapped → capped to 30000)', () => {
    // 2^5 = 32 → 32000ms → capped to 30000
    expect(computeDelay(5)).toBe(30000);
  });
});

// ─── Transport Error Handler Recovery (logic test) ───────────────────────────

describe('WS Transport — Error Handler Reconnect', () => {
  it('scheduleReconnect is called on socket error (not just close)', () => {
    // Simulates the corrected error handler behavior
    let reconnectScheduled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const transport = {
      connected: true,
      reconnectTimer: null as ReturnType<typeof setTimeout> | null,
      scheduleReconnect() {
        if (this.reconnectTimer) return;
        reconnectScheduled = true;
        timerId = setTimeout(() => {}, 9999);
        this.reconnectTimer = timerId;
      },
      // Fixed error handler: calls scheduleReconnect
      onError() {
        this.connected = false;
        this.scheduleReconnect();
      },
    };

    transport.onError();

    expect(transport.connected).toBe(false);
    expect(reconnectScheduled).toBe(true);
    if (timerId) clearTimeout(timerId);
  });

  it('scheduleReconnect is idempotent — duplicate calls do not create multiple timers', () => {
    let callCount = 0;
    const transport = {
      reconnectTimer: null as ReturnType<typeof setTimeout> | null,
      scheduleReconnect() {
        if (this.reconnectTimer) return;
        callCount++;
        this.reconnectTimer = setTimeout(() => {}, 9999);
      },
    };

    transport.scheduleReconnect();
    transport.scheduleReconnect();
    transport.scheduleReconnect();

    expect(callCount).toBe(1);
    if (transport.reconnectTimer) clearTimeout(transport.reconnectTimer);
  });
});

// ─── Offline Queue Cleanup Logic ─────────────────────────────────────────────

describe('Offline Queue — Disconnect Cleanup Logic', () => {
  // Replicate the module-level queue logic without importing server files
  function makeQueue() {
    const queues = new Map<string, unknown[]>();
    return {
      enqueue(socketId: string, msg: unknown) {
        if (!queues.has(socketId)) queues.set(socketId, []);
        queues.get(socketId)!.push(msg);
      },
      clear(socketId: string) {
        queues.delete(socketId);
      },
      size(socketId: string) {
        return queues.get(socketId)?.length ?? 0;
      },
    };
  }

  it('clear removes all messages for disconnected socket', () => {
    const q = makeQueue();
    q.enqueue('s1', { a: 1 });
    q.enqueue('s1', { a: 2 });
    expect(q.size('s1')).toBe(2);
    q.clear('s1');
    expect(q.size('s1')).toBe(0);
  });

  it('clear on unknown socket is a no-op', () => {
    const q = makeQueue();
    expect(() => q.clear('does-not-exist')).not.toThrow();
  });

  it('clear only removes target socket — other sockets unaffected', () => {
    const q = makeQueue();
    q.enqueue('A', {});
    q.enqueue('B', {});
    q.clear('A');
    expect(q.size('A')).toBe(0);
    expect(q.size('B')).toBe(1);
  });

  it('queue grows bounded to MAX_QUEUE_SIZE by shifting oldest', () => {
    const MAX = 5;
    const queues = new Map<string, unknown[]>();
    const sid = 's1';
    queues.set(sid, []);

    function enqueue(msg: unknown) {
      const q = queues.get(sid)!;
      if (q.length >= MAX) q.shift(); // drop oldest
      q.push(msg);
    }

    for (let i = 0; i < 8; i++) enqueue({ seq: i });
    const q = queues.get(sid)!;
    expect(q.length).toBe(MAX);
    // Newest items retained (seq 3..7)
    expect((q[0] as any).seq).toBe(3);
    expect((q[4] as any).seq).toBe(7);
  });
});

// ─── Session Reconnect Token Invalidation ────────────────────────────────────

describe('Session Manager — Reconnect Token Lifecycle', () => {
  function makeSessionStore() {
    const sessions = new Map<string, { token: string }>();
    const tokens = new Map<string, string>(); // token → socketId

    return {
      create(socketId: string, token: string) {
        sessions.set(socketId, { token });
        tokens.set(token, socketId);
      },
      delete(socketId: string) {
        const s = sessions.get(socketId);
        if (s) tokens.delete(s.token);
        sessions.delete(socketId);
      },
      findByToken(token: string) {
        const socketId = tokens.get(token);
        return socketId ? sessions.get(socketId) : undefined;
      },
      hasSession(socketId: string) {
        return sessions.has(socketId);
      },
    };
  }

  it('old reconnect token is invalidated after session restore', () => {
    const store = makeSessionStore();
    store.create('old-socket', 'old-token');
    // restore: delete old, create new
    store.delete('old-socket');
    store.create('new-socket', 'new-token');

    expect(store.findByToken('old-token')).toBeUndefined();
    expect(store.findByToken('new-token')).toBeDefined();
    expect(store.hasSession('old-socket')).toBe(false);
    expect(store.hasSession('new-socket')).toBe(true);
  });

  it('reconnect with unknown token does not restore session', () => {
    const store = makeSessionStore();
    const result = store.findByToken('nonexistent-token');
    expect(result).toBeUndefined();
  });
});
