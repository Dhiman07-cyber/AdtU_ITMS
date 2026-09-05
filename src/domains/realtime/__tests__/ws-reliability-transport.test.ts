import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getClientWsUrl, getServerWsUrl } from '../ws-config';
import { parseTimestampMs } from '../location-packet-guard';
import { WebSocketTransport } from '../transport/websocket';

describe('Realtime Reliability & Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getClientWsUrl', () => {
    it('normalizes wss:// and appends /ws when configured without /ws suffix', () => {
      process.env.NEXT_PUBLIC_WS_URL = 'wss://itms-ws.onrender.com';
      expect(getClientWsUrl()).toBe('wss://itms-ws.onrender.com/ws');
    });

    it('does not duplicate /ws if already present', () => {
      process.env.NEXT_PUBLIC_WS_URL = 'wss://itms-ws.onrender.com/ws';
      expect(getClientWsUrl()).toBe('wss://itms-ws.onrender.com/ws');
    });

    it('converts https:// scheme to wss://', () => {
      process.env.NEXT_PUBLIC_WS_URL = 'https://itms-ws.onrender.com/ws';
      expect(getClientWsUrl()).toBe('wss://itms-ws.onrender.com/ws');
    });

    it('converts http:// scheme to ws://', () => {
      process.env.NEXT_PUBLIC_WS_URL = 'http://192.168.1.50:3001/ws';
      expect(getClientWsUrl()).toBe('ws://192.168.1.50:3001/ws');
    });

    it('strips query strings so tokens never leak in client URLs', () => {
      process.env.NEXT_PUBLIC_WS_URL = 'wss://itms-ws.onrender.com/ws?token=secret123';
      expect(getClientWsUrl()).toBe('wss://itms-ws.onrender.com/ws');
    });

    it('rewrites localhost to current LAN hostname when tested on mobile devices', () => {
      process.env.NEXT_PUBLIC_WS_URL = 'ws://localhost:3001';
      // Simulate mobile device visiting http://192.168.1.88:3000
      const originalWindow = global.window;
      (global as any).window = {
        location: {
          hostname: '192.168.1.88',
          protocol: 'http:',
        },
      };

      try {
        expect(getClientWsUrl()).toBe('ws://192.168.1.88:3001/ws');
      } finally {
        (global as any).window = originalWindow;
      }
    });

    it('upgrades to wss:// when loaded in HTTPS browser context on remote domain', () => {
      process.env.NEXT_PUBLIC_WS_URL = 'ws://itms.university.edu';
      const originalWindow = global.window;
      (global as any).window = {
        location: {
          hostname: 'itms.university.edu',
          protocol: 'https:',
        },
      };

      try {
        expect(getClientWsUrl()).toBe('wss://itms.university.edu/ws');
      } finally {
        (global as any).window = originalWindow;
      }
    });
  });

  describe('getServerWsUrl', () => {
    it('uses WS_SERVER_URL when provided', () => {
      process.env.WS_SERVER_URL = 'wss://itms-ws.onrender.com';
      expect(getServerWsUrl()).toBe('wss://itms-ws.onrender.com/ws');
    });

    it('strips query strings from server endpoint URL', () => {
      process.env.WS_SERVER_URL = 'wss://itms-ws.onrender.com/ws?token=leaked_secret';
      expect(getServerWsUrl()).toBe('wss://itms-ws.onrender.com/ws');
    });

    it('falls back to WS_HOST and WS_PORT when WS_SERVER_URL is omitted', () => {
      delete process.env.WS_SERVER_URL;
      delete process.env.WS_URL;
      process.env.WS_HOST = '10.0.0.5';
      process.env.WS_PORT = '3005';
      expect(getServerWsUrl()).toBe('ws://10.0.0.5:3005/ws');
    });

    it('defaults to 127.0.0.1:3001/ws for local single-node development', () => {
      delete process.env.WS_SERVER_URL;
      delete process.env.WS_URL;
      delete process.env.WS_HOST;
      delete process.env.WS_PORT;
      expect(getServerWsUrl()).toBe('ws://127.0.0.1:3001/ws');
    });
  });

  describe('WebSocketTransport First-Message Authentication', () => {
    it('connects to endpoint without token in query string and sends auth as first frame', async () => {
      process.env.WS_PRIVILEGED_TOKEN = 'test_privileged_secret_12345';
      process.env.WS_SERVER_URL = 'ws://127.0.0.1:3001/ws';

      let constructedUrl = '';
      const sentFrames: string[] = [];

      // Mock ws module
      const EventEmitter = (await import('events')).EventEmitter;
      class MockWs extends EventEmitter {
        readyState = 1;
        send = vi.fn((data: string) => {
          sentFrames.push(data);
        });
        close = vi.fn();
        removeAllListeners = vi.fn();
        constructor(url: string) {
          super();
          constructedUrl = url;
          setTimeout(() => {
            this.emit('open');
          }, 5);
        }
      }

      vi.doMock('ws', () => ({ default: MockWs }));

      const transport = new WebSocketTransport();
      await transport.connect();

      // Verify URL never contained the secret token
      expect(constructedUrl).toBe('ws://127.0.0.1:3001/ws');
      expect(constructedUrl).not.toContain('token=');
      expect(constructedUrl).not.toContain('test_privileged_secret_12345');

      // Verify frame 1 is the auth frame with the token
      expect(sentFrames.length).toBeGreaterThanOrEqual(1);
      const firstFrame = JSON.parse(sentFrames[0]);
      expect(firstFrame).toEqual({
        type: 'auth',
        token: 'test_privileged_secret_12345',
      });

      // Verify frame 2 is presence
      const secondFrame = JSON.parse(sentFrames[1]);
      expect(secondFrame).toEqual({
        type: 'presence',
        role: 'server',
      });

      await transport.disconnect();
    });
  });

  describe('HTTP Fallback Monotonic Timestamp Logic', () => {
    it('accepts initial location when previous state is null', () => {
      const prev = null;
      const newLoc = { lat: 26.14, lng: 91.73, timestamp: '2026-09-05T12:00:00.000Z' };

      const updated = (() => {
        if (!prev) return newLoc;
        const prevTs = parseTimestampMs((prev as any).timestamp);
        const newTs = parseTimestampMs(newLoc.timestamp);
        if (newTs > prevTs) return newLoc;
        return prev;
      })();

      expect(updated).toBe(newLoc);
    });

    it('accepts newer snapshot from HTTP fallback', () => {
      const prev = { lat: 26.14, lng: 91.73, timestamp: '2026-09-05T12:00:00.000Z' };
      const newLoc = { lat: 26.15, lng: 91.74, timestamp: '2026-09-05T12:00:05.000Z' };

      const updated = (() => {
        if (!prev) return newLoc;
        const prevTs = parseTimestampMs(prev.timestamp);
        const newTs = parseTimestampMs(newLoc.timestamp);
        if (newTs > prevTs) return newLoc;
        return prev;
      })();

      expect(updated).toBe(newLoc);
      expect(updated.lat).toBe(26.15);
    });

    it('strictly rejects older snapshot from lagging HTTP response', () => {
      const prev = { lat: 26.16, lng: 91.75, timestamp: '2026-09-05T12:00:10.000Z' };
      const staleSnapshot = { lat: 26.14, lng: 91.73, timestamp: '2026-09-05T12:00:02.000Z' };

      const updated = (() => {
        if (!prev) return staleSnapshot;
        const prevTs = parseTimestampMs(prev.timestamp);
        const newTs = parseTimestampMs(staleSnapshot.timestamp);
        if (newTs > prevTs) return staleSnapshot;
        return prev;
      })();

      expect(updated).toBe(prev);
      expect(updated.lat).toBe(26.16);
    });

    it('deterministically retains current state on identical timestamp', () => {
      const prev = { lat: 26.16, lng: 91.75, timestamp: '2026-09-05T12:00:10.000Z' };
      const duplicateSnapshot = { lat: 26.14, lng: 91.73, timestamp: '2026-09-05T12:00:10.000Z' };

      const updated = (() => {
        if (!prev) return duplicateSnapshot;
        const prevTs = parseTimestampMs(prev.timestamp);
        const newTs = parseTimestampMs(duplicateSnapshot.timestamp);
        if (newTs > prevTs) return duplicateSnapshot;
        return prev;
      })();

      expect(updated).toBe(prev);
    });
  });
});
