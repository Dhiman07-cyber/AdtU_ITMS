import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getClientWsUrl, getServerWsUrl } from '../ws-config';

describe('ws-config: WebSocket endpoint resolution and security', () => {
  const originalEnv = process.env;
  const originalWindow = global.window;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    (global as any).window = originalWindow;
  });

  it('permits loopback ?ws= override in local / non-production environment', () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_WS_URL = 'ws://localhost:3001/ws';

    (global as any).window = {
      location: {
        hostname: 'localhost',
        protocol: 'http:',
        search: '?ws=ws://127.0.0.1:3003',
      },
    };

    const resolved = getClientWsUrl();
    expect(resolved).toBe('ws://127.0.0.1:3003/ws');
  });

  it('strictly rejects malicious / external ?ws= override and falls back to default', () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_WS_URL = 'wss://live.adtu.app/ws';

    (global as any).window = {
      location: {
        hostname: 'adtu.app',
        protocol: 'https:',
        search: '?ws=wss://malicious-attacker.com',
      },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolved = getClientWsUrl();
    expect(resolved).toBe('wss://live.adtu.app/ws');
    warnSpy.mockRestore();
  });

  it('rejects external domain even in development mode', () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_WS_URL = 'ws://localhost:3001/ws';

    (global as any).window = {
      location: {
        hostname: 'localhost',
        protocol: 'http:',
        search: '?ws=ws://evil.domain.com:3001',
      },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolved = getClientWsUrl();
    expect(resolved).toBe('ws://localhost:3001/ws');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SECURITY] Ignored untrusted ?ws= parameter:'),
      'evil.domain.com'
    );
    warnSpy.mockRestore();
  });

  it('rejects userinfo / @ credentials trick in target URL', () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_WS_URL = 'ws://localhost:3001/ws';

    (global as any).window = {
      location: {
        hostname: 'localhost',
        protocol: 'http:',
        search: '?ws=ws://attacker.com@localhost:3001',
      },
    };

    const resolved = getClientWsUrl();
    expect(resolved).toBe('ws://localhost:3001/ws');
  });

  it('rejects subdomain spoofing (e.g. localhost.attacker.com)', () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_WS_URL = 'ws://localhost:3001/ws';

    (global as any).window = {
      location: {
        hostname: 'localhost',
        protocol: 'http:',
        search: '?ws=ws://localhost.attacker.com:3001',
      },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolved = getClientWsUrl();
    expect(resolved).toBe('ws://localhost:3001/ws');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SECURITY] Ignored untrusted ?ws= parameter:'),
      'localhost.attacker.com'
    );
    warnSpy.mockRestore();
  });

  it('rejects non-ws/wss schemes such as javascript: or data:', () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.NEXT_PUBLIC_WS_URL = 'ws://localhost:3001/ws';

    (global as any).window = {
      location: {
        hostname: 'localhost',
        protocol: 'http:',
        search: '?ws=javascript:alert(1)',
      },
    };

    const resolved = getClientWsUrl();
    expect(resolved).toBe('ws://localhost:3001/ws');
  });
});

