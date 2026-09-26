import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => handler,
}));

vi.mock('@/lib/security/rate-limiter', () => ({
  RateLimits: { CREATE: {} },
}));

vi.mock('@/lib/security/validation-schemas', () => ({
  DeviceSessionSchema: {},
}));

import { POST } from '../route';

describe('POST /api/driver/device-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  const dummyAuth = { uid: 'driver_001', role: 'driver' };

  describe('action: check', () => {
    it('returns isCurrentDevice=true, hasActiveSession=false when no session exists in DB', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      });

      const body = { action: 'check', feature: 'driver_location_share', deviceId: 'dev_A' };
      const req = new Request('http://localhost/api/driver/device-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await (POST as any)(req, { auth: dummyAuth, body });
      const data = await res.json();

      expect(data).toEqual({ isCurrentDevice: true, hasActiveSession: false });
    });

    it('returns isCurrentDevice=true, hasActiveSession=true when active session matches deviceId within 30s', async () => {
      const recentTimestamp = new Date(Date.now() - 5000).toISOString();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { device_id: 'dev_A', last_active_at: recentTimestamp },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const body = { action: 'check', feature: 'driver_location_share', deviceId: 'dev_A' };
      const req = new Request('http://localhost/api/driver/device-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await (POST as any)(req, { auth: dummyAuth, body });
      const data = await res.json();

      expect(data.isCurrentDevice).toBe(true);
      expect(data.hasActiveSession).toBe(true);
      expect(data.otherDeviceId).toBeUndefined();
    });

    it('returns isCurrentDevice=false, hasActiveSession=true when active session belongs to another device', async () => {
      const recentTimestamp = new Date(Date.now() - 5000).toISOString();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { device_id: 'dev_B', last_active_at: recentTimestamp },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const body = { action: 'check', feature: 'driver_location_share', deviceId: 'dev_A' };
      const req = new Request('http://localhost/api/driver/device-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await (POST as any)(req, { auth: dummyAuth, body });
      const data = await res.json();

      expect(data.isCurrentDevice).toBe(false);
      expect(data.hasActiveSession).toBe(true);
      expect(data.otherDeviceId).toBe('dev_B');
    });

    it('treats session as inactive when last_active_at is older than 30 seconds', async () => {
      const staleTimestamp = new Date(Date.now() - 45000).toISOString();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { device_id: 'dev_B', last_active_at: staleTimestamp },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const body = { action: 'check', feature: 'driver_location_share', deviceId: 'dev_A' };
      const req = new Request('http://localhost/api/driver/device-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await (POST as any)(req, { auth: dummyAuth, body });
      const data = await res.json();

      expect(data).toEqual({ isCurrentDevice: true, hasActiveSession: false });
    });
  });

  describe('action: register', () => {
    it('successfully upserts device session with onConflict user_id,feature and 24h expiration', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({
        upsert: mockUpsert,
      });

      const body = { action: 'register', feature: 'driver_location_share', deviceId: 'dev_A' };
      const req = new Request('http://localhost/api/driver/device-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await (POST as any)(req, { auth: dummyAuth, body });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'driver_001',
          device_id: 'dev_A',
          feature: 'driver_location_share',
          last_active_at: expect.any(String),
          last_active: expect.any(String),
          expires_at: expect.any(String),
          created_at: expect.any(String),
        }),
        {
          onConflict: 'user_id,feature',
          ignoreDuplicates: false,
        }
      );
    });
  });

  describe('action: heartbeat', () => {
    it('updates last_active_at, last_active, and expires_at for user+feature+device', async () => {
      const mockEqDevice = vi.fn().mockResolvedValue({ error: null });
      const mockEqFeature = vi.fn().mockReturnValue({ eq: mockEqDevice });
      const mockEqUser = vi.fn().mockReturnValue({ eq: mockEqFeature });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEqUser });

      mockFrom.mockReturnValue({
        update: mockUpdate,
      });

      const body = { action: 'heartbeat', feature: 'driver_location_share', deviceId: 'dev_A' };
      const req = new Request('http://localhost/api/driver/device-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await (POST as any)(req, { auth: dummyAuth, body });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          last_active_at: expect.any(String),
          last_active: expect.any(String),
          expires_at: expect.any(String),
        })
      );
      expect(mockEqUser).toHaveBeenCalledWith('user_id', 'driver_001');
      expect(mockEqFeature).toHaveBeenCalledWith('feature', 'driver_location_share');
      expect(mockEqDevice).toHaveBeenCalledWith('device_id', 'dev_A');
    });
  });

  describe('action: release', () => {
    it('deletes the session for user+feature+device', async () => {
      const mockEqDevice = vi.fn().mockResolvedValue({ error: null });
      const mockEqFeature = vi.fn().mockReturnValue({ eq: mockEqDevice });
      const mockEqUser = vi.fn().mockReturnValue({ eq: mockEqFeature });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEqUser });

      mockFrom.mockReturnValue({
        delete: mockDelete,
      });

      const body = { action: 'release', feature: 'driver_location_share', deviceId: 'dev_A' };
      const req = new Request('http://localhost/api/driver/device-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const res = await (POST as any)(req, { auth: dummyAuth, body });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEqUser).toHaveBeenCalledWith('user_id', 'driver_001');
      expect(mockEqFeature).toHaveBeenCalledWith('feature', 'driver_location_share');
      expect(mockEqDevice).toHaveBeenCalledWith('device_id', 'dev_A');
    });
  });
});
