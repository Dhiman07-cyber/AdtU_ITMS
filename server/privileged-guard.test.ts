import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assertPrivilegedTokenSafe } from './authenticator';
import { validateEnvironment } from '@/lib/env-validator';
import { authenticateSocket } from './authenticator';

vi.mock('@/lib/firebase-admin', () => ({
  verifyToken: vi.fn().mockRejectedValue(new Error('Invalid test token')),
}));

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
      url: '/',
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    const res = await authenticateSocket(fakeReq);
    expect(res.authenticated).toBe(true);
    expect(res.uid).toBe('server');
    expect(res.role).toBe('server');
    // Ensure the secret is NOT exposed inside the AuthResult object
    expect((res as any).token).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(token);
  });

  it('rejects tokens passed via URL query parameter (AUTH-03 / SEC-04)', async () => {
    const token = 'test-long-secret-key-12345';
    process.env.WS_PRIVILEGED_TOKEN = token;
    (process.env as any).NODE_ENV = 'test';

    const fakeReq: any = {
      url: `/?token=${token}`,
      headers: {},
    };

    const res = await authenticateSocket(fakeReq);
    expect(res.authenticated).toBe(false);
    expect(res.role).toBeUndefined();
  });

  it('invalid token cannot establish role=server', async () => {
    const fakeReq: any = {
      url: '/',
      headers: {
        authorization: 'Bearer invalid-random-token-attempt',
      },
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

describe('INV-AUTH-003 & INV-WS-003: WebSocket Role Revocation & Active Socket Eviction', () => {
  it('closes all active sockets for revoked UID with code 4401 and purges from both registries', async () => {
    const { sessionManager } = await import('./session-manager');
    const { connectionRegistry } = await import('./connection-registry');
    const { redisPubSub } = await import('./redis-pubsub');
    const { initRedisBroadcastRelay } = await import('./redis-broadcast');
    const { invalidateTokenAuthCache } = await import('./authenticator');

    // 1. Capture the role_invalidate handler registered by initRedisBroadcastRelay
    let roleInvalidateHandler: ((rawUid: string) => void) | null = null;
    vi.spyOn(redisPubSub, 'subscribe').mockImplementation(async (channel, handler) => {
      if (channel === 'role_invalidate') {
        roleInvalidateHandler = handler;
      }
    });

    await initRedisBroadcastRelay(vi.fn(), vi.fn());
    expect(roleInvalidateHandler).toBeDefined();

    // 2. Setup established sessions: 2 sockets for mod_123, 1 socket for student_999
    const fakeWs1: any = { close: vi.fn(), readyState: 1 };
    const fakeWs2: any = { close: vi.fn(), readyState: 1 };
    const fakeWsStudent: any = { close: vi.fn(), readyState: 1 };

    const session1 = sessionManager.create({
      socketId: 'sock-mod-1',
      uid: 'mod_123',
      role: 'moderator',
      ip: '127.0.0.1',
    });
    connectionRegistry.register('sock-mod-1', fakeWs1, session1);

    const session2 = sessionManager.create({
      socketId: 'sock-mod-2',
      uid: 'mod_123',
      role: 'moderator',
      ip: '127.0.0.1',
    });
    connectionRegistry.register('sock-mod-2', fakeWs2, session2);

    const sessionStudent = sessionManager.create({
      socketId: 'sock-student-1',
      uid: 'student_999',
      role: 'student',
      ip: '127.0.0.1',
    });
    connectionRegistry.register('sock-student-1', fakeWsStudent, sessionStudent);

    // Verify initial registration in both registries
    expect(connectionRegistry.get('sock-mod-1')).toBeDefined();
    expect(connectionRegistry.get('sock-mod-2')).toBeDefined();
    expect(connectionRegistry.get('sock-student-1')).toBeDefined();
    expect(sessionManager.getByUid('mod_123')).toHaveLength(2);
    expect(sessionManager.getByUid('student_999')).toHaveLength(1);

    // 3. Admin revokes role: Redis role_invalidate message arrives with "mod_123"
    roleInvalidateHandler!('mod_123');

    // 4. Verify both sockets for mod_123 were closed with code 4401
    expect(fakeWs1.close).toHaveBeenCalledTimes(1);
    expect(fakeWs1.close).toHaveBeenCalledWith(4401, 'Role revoked or permissions modified - please re-authenticate');
    expect(fakeWs2.close).toHaveBeenCalledTimes(1);
    expect(fakeWs2.close).toHaveBeenCalledWith(4401, 'Role revoked or permissions modified - please re-authenticate');

    // 5. Verify sessions were purged from connectionRegistry and sessionManager
    expect(connectionRegistry.get('sock-mod-1')).toBeUndefined();
    expect(connectionRegistry.get('sock-mod-2')).toBeUndefined();
    expect(sessionManager.getByUid('mod_123')).toHaveLength(0);

    // 6. Verify non-revoked socket (student_999) remains untouched
    expect(fakeWsStudent.close).not.toHaveBeenCalled();
    expect(connectionRegistry.get('sock-student-1')).toBeDefined();
    expect(sessionManager.getByUid('student_999')).toHaveLength(1);

    // Clean up student session
    connectionRegistry.unregister('sock-student-1');
    sessionManager.delete('sock-student-1');
  });

  it('multi-node simulation: role_invalidate received on Node A and Node B evicts matching sockets across nodes', async () => {
    const { sessionManager } = await import('./session-manager');
    const { connectionRegistry } = await import('./connection-registry');
    const { redisPubSub } = await import('./redis-pubsub');
    const { initRedisBroadcastRelay } = await import('./redis-broadcast');

    let relayHandler: ((rawUid: string) => void) | null = null;
    vi.spyOn(redisPubSub, 'subscribe').mockImplementation(async (channel, handler) => {
      if (channel === 'role_invalidate') relayHandler = handler;
    });

    await initRedisBroadcastRelay(vi.fn(), vi.fn());

    // Create session on this node
    const fakeWsNodeA: any = { close: vi.fn(), readyState: 1 };
    const sessionNodeA = sessionManager.create({
      socketId: 'sock-node-a',
      uid: 'user_cross_node',
      role: 'admin',
      ip: '10.0.0.1',
    });
    connectionRegistry.register('sock-node-a', fakeWsNodeA, sessionNodeA);

    // Trigger revocation
    relayHandler!('user_cross_node');

    // Socket closed with 4401
    expect(fakeWsNodeA.close).toHaveBeenCalledWith(4401, expect.stringContaining('Role revoked'));
    expect(connectionRegistry.get('sock-node-a')).toBeUndefined();
    expect(sessionManager.getByUid('user_cross_node')).toHaveLength(0);
  });
});

