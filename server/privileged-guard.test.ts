import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertPrivilegedTokenSafe } from './authenticator';
import { validateEnvironment } from '@/lib/env-validator';
import { authenticateSocket } from './authenticator';

describe('Privileged Token Production Startup Guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('A. rejects missing token in production', () => {
    delete process.env.WS_PRIVILEGED_TOKEN;
    expect(() => assertPrivilegedTokenSafe(undefined, 'production')).toThrow(
      'WS_PRIVILEGED_TOKEN is missing or insecure in production.'
    );
  });

  it('B. rejects empty/whitespace token in production', () => {
    expect(() => assertPrivilegedTokenSafe('', 'production')).toThrow(
      'WS_PRIVILEGED_TOKEN is missing or insecure in production.'
    );
    expect(() => assertPrivilegedTokenSafe('   ', 'production')).toThrow(
      'WS_PRIVILEGED_TOKEN is missing or insecure in production.'
    );
  });

  it('C. rejects placeholder "__server__" in production', () => {
    expect(() => assertPrivilegedTokenSafe('__server__', 'production')).toThrow(
      'WS_PRIVILEGED_TOKEN is missing or insecure in production.'
    );
  });

  it('D. accepts valid cryptographically random token in production', () => {
    const validToken = 'k'.repeat(64);
    expect(() => assertPrivilegedTokenSafe(validToken, 'production')).not.toThrow();
  });

  it('E. preserves non-production compatibility (development / test)', () => {
    expect(() => assertPrivilegedTokenSafe(undefined, 'development')).not.toThrow();
    expect(() => assertPrivilegedTokenSafe('', 'development')).not.toThrow();
    expect(() => assertPrivilegedTokenSafe('__server__', 'development')).not.toThrow();
    expect(() => assertPrivilegedTokenSafe(undefined, 'test')).not.toThrow();
  });

  it('integrates guard with validateEnvironment in production', () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.WS_PRIVILEGED_TOKEN = '__server__';

    const result = validateEnvironment({ isWebSocketServer: true });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('WS_PRIVILEGED_TOKEN');

    // Valid long secret in production
    process.env.WS_PRIVILEGED_TOKEN = 'a'.repeat(64);
    process.env.FIREBASE_CLIENT_EMAIL = 'admin@itms.local';
    process.env.FIREBASE_PRIVATE_KEY = 'mock-key';

    const validResult = validateEnvironment({ isWebSocketServer: true });
    expect(validResult.missing.filter(k => k === 'WS_PRIVILEGED_TOKEN')).toHaveLength(0);
  });
});

describe('Privileged Authenticator Token Boundary', () => {
  it('valid privileged token establishes role=server and uid=server', async () => {
    const token = 'test-long-secret-key-12345';
    process.env.WS_PRIVILEGED_TOKEN = token;
    (process.env as any).NODE_ENV = 'test';

    const fakeReq: any = {
      url: `/?token=${token}`,
      headers: {},
    };

    const res = await authenticateSocket(fakeReq);
    expect(res.authenticated).toBe(true);
    expect(res.uid).toBe('server');
    expect(res.role).toBe('server');
    // Ensure the secret is NOT exposed inside the AuthResult object
    expect((res as any).token).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(token);
  });

  it('invalid token cannot establish role=server', async () => {
    const fakeReq: any = {
      url: '/?token=invalid-random-token-attempt',
      headers: {},
    };

    const res = await authenticateSocket(fakeReq);
    // Non-matching token goes to Firebase verification and fails
    expect(res.role).not.toBe('server');
  });

  it('request with no token is rejected without server role', async () => {
    const fakeReq: any = {
      url: '/',
      headers: {},
    };

    const res = await authenticateSocket(fakeReq);
    expect(res.authenticated).toBe(false);
    expect(res.role).toBeUndefined();
  });
});
