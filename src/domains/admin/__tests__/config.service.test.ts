/**
 * D11 Config Service — unit tests
 *
 * Tests business logic with mocked PostgreSQL system_settings table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';

// ─── Mock Supabase Server ───────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
      upsert: mockUpsert,
    })),
  }),
}));

vi.mock('@/lib/security/object-safety', () => ({
  stripUnsafeObjectKeys: (v: any) => v,
}));

// ─── Import SUT after mocking ────────────────────────────────────────────────
import {
  findMarker,
  getLandingConfig,
  getLegalConfig,
  getSystemConfig,
  getUiConfig,
  invalidateConfigCache,
  updateLandingConfig,
  updateLegalConfig,
  updateSystemConfig,
  updateUiConfig,
  upsertMarker,
} from '../services/config.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SYSTEM_CONFIG_DATA = {
  appName: 'AdtU Bus Services',
  busFee: { amount: 5000, version: 1 },
  lastUpdated: '2026-07-14T12:00:00Z',
  updatedBy: 'admin-uid',
};

const LANDING_CONFIG_DATA = {
  videoPath: 'landing_video/test.mp4',
  supportPhones: ['+91 12345 67890'],
  email: 'test@example.com',
  updatedAt: '2026-07-14T12:00:00Z',
  updatedBy: 'admin-uid',
};

const PRIVACY_CONFIG_DATA = {
  title: 'Privacy Policy',
  sections: [{ title: 'Section 1', content: 'Content here' }],
  updatedAt: '2026-07-14T12:00:00Z',
  updatedBy: 'admin-uid',
};

const ACTIVATION_MARKER = {
  activatedAt: '2026-07-14T10:00:00Z',
  currentSessionStartYear: 2027,
  scanned: 50,
  activated: 45,
  pendingSeatAllocation: 5,
  trigger: 'admin',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  invalidateConfigCache();
});

describe('Config Service (PostgreSQL system_settings)', () => {
  // ── System Config ────────────────────────────────────────────────────────

  describe('getSystemConfig', () => {
    it('returns ConfigResult with data and metadata from PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: SYSTEM_CONFIG_DATA,
          updated_at: '2026-07-14T12:00:00Z',
          updated_by: 'admin-uid',
        },
        error: null,
      });

      const result = await getSystemConfig();
      expect(result.data.appName).toBe('AdtU Bus Services');
      expect(result.updatedAt).toBe('2026-07-14T12:00:00Z');
      expect(result.updatedByUid).toBe('admin-uid');
    });

    it('returns default config when record does not exist', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await getSystemConfig();
      expect(result.data).toBeDefined();
      expect(result.data.appName).toBe('AdtU Bus Services');
      expect(result.updatedAt).toBeNull();
    });
  });

  describe('updateSystemConfig', () => {
    it('upserts merged config to PostgreSQL system_settings', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockUpsert.mockResolvedValueOnce({ error: null });

      await updateSystemConfig(
        { appName: 'Test', busFee: { amount: 100 } },
        'admin-uid',
      );

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const [payload] = mockUpsert.mock.calls[0];
      expect(payload.key).toBe('config');
      expect(payload.value.appName).toBe('Test');
      expect(payload.value.busFee.amount).toBe(100);
      expect(payload.updated_by).toBe('admin-uid');
    });

    it('merges partial update with existing config in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: {
            appName: 'Original',
            busFee: { amount: 5000, version: 1 },
            renewalDeadline: '2027-08-01',
          },
          updated_at: '2026-07-14T12:00:00Z',
          updated_by: 'admin-uid',
        },
        error: null,
      });
      mockUpsert.mockResolvedValueOnce({ error: null });

      await updateSystemConfig(
        { busFee: { amount: 5500 } },
        'admin-uid',
      );

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const [payload] = mockUpsert.mock.calls[0];
      expect(payload.value.appName).toBe('Original');
      expect(payload.value.busFee.amount).toBe(5500);
    });
  });

  // ── Landing Config ───────────────────────────────────────────────────────

  describe('getLandingConfig', () => {
    it('returns ConfigResult with data from PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: LANDING_CONFIG_DATA,
          updated_at: '2026-07-14T12:00:00Z',
          updated_by: 'admin-uid',
        },
        error: null,
      });

      const result = await getLandingConfig();
      expect(result.data.videoPath).toBe('landing_video/test.mp4');
      expect(result.data.email).toBe('test@example.com');
    });

    it('returns defaults with null metadata when no config in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await getLandingConfig();
      expect(result.data).toBeDefined();
      expect(result.updatedAt).toBeNull();
    });
  });

  describe('updateLandingConfig', () => {
    it('sets landing config in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockUpsert.mockResolvedValueOnce({ error: null });

      await updateLandingConfig(
        { email: 'new@example.com' },
        'admin-uid',
      );

      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const [payload] = mockUpsert.mock.calls[0];
      expect(payload.key).toBe('landing');
      expect(payload.value.email).toBe('new@example.com');
    });
  });

  // ── UI Config ────────────────────────────────────────────────────────────

  describe('getUiConfig', () => {
    it('returns UI config when found in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: { version: '1.0.0' },
          updated_at: '2026-07-14T12:00:00Z',
          updated_by: 'admin-uid',
        },
        error: null,
      });

      const result = await getUiConfig();
      expect(result?.data.version).toBe('1.0.0');
    });

    it('returns null when no config in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await getUiConfig();
      expect(result).toBeNull();
    });
  });

  describe('updateUiConfig', () => {
    it('updates UI config in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockUpsert.mockResolvedValueOnce({ error: null });

      await updateUiConfig({ version: '2.0.0' }, 'admin-uid');
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const [payload] = mockUpsert.mock.calls[0];
      expect(payload.key).toBe('ui');
      expect(payload.value.version).toBe('2.0.0');
    });
  });

  // ── Legal Config ─────────────────────────────────────────────────────────

  describe('getLegalConfig', () => {
    it('returns ConfigResult with privacy config from PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: PRIVACY_CONFIG_DATA,
          updated_at: '2026-07-14T12:00:00Z',
          updated_by: 'admin-uid',
        },
        error: null,
      });

      const result = await getLegalConfig('privacy');
      expect(result.data.title).toBe('Privacy Policy');
    });

    it('returns default privacy config when not in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await getLegalConfig('privacy');
      expect(result.data.title).toBe('Privacy Policy');
    });
  });

  describe('updateLegalConfig', () => {
    it('upserts privacy config in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });
      mockUpsert.mockResolvedValueOnce({ error: null });

      await updateLegalConfig('privacy', { title: 'New Privacy' }, 'admin-uid');
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const [payload] = mockUpsert.mock.calls[0];
      expect(payload.key).toBe('privacy');
      expect(payload.value.title).toBe('New Privacy');
    });
  });

  // ── System Markers ───────────────────────────────────────────────────────

  describe('findMarker', () => {
    it('returns marker data when found in PostgreSQL', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: {
          value: ACTIVATION_MARKER,
          updated_at: '2026-07-14T10:00:00Z',
        },
        error: null,
      });

      const result = await findMarker('activation_2027');
      expect(result).toEqual(ACTIVATION_MARKER);
    });

    it('returns null when marker not found', async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const result = await findMarker('activation_2099');
      expect(result).toBeNull();
    });
  });

  describe('upsertMarker', () => {
    it('upserts marker data in PostgreSQL', async () => {
      mockUpsert.mockResolvedValueOnce({ error: null });

      await upsertMarker('activation_2027', ACTIVATION_MARKER);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const [payload] = mockUpsert.mock.calls[0];
      expect(payload.key).toBe('marker:activation_2027');
      expect(payload.value).toEqual(expect.objectContaining(ACTIVATION_MARKER));
    });
  });
});
