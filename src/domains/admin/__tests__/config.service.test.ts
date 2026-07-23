/**
 * D11 Config Service — unit tests
 *
 * Tests business logic with mocked Firestore adminDb.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock adminDb ─────────────────────────────────────────────────────────

const mockGet = vi.fn();
const mockSet = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: vi.fn((colName: string) => ({
      doc: vi.fn((docId: string) => ({
        get: mockGet,
        set: mockSet,
      })),
    })),
  },
}));

vi.mock('@/lib/security/object-safety', () => ({
  stripUnsafeObjectKeys: (v: any) => v,
}));

// ─── Import SUT after mocking ────────────────────────────────────────────────
import {
  getSystemConfig,
  updateSystemConfig,
  getLandingConfig,
  updateLandingConfig,
  getUiConfig,
  updateUiConfig,
  getLegalConfig,
  updateLegalConfig,
  findMarker,
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
});

describe('Config Service', () => {
  // ── System Config ────────────────────────────────────────────────────────

  describe('getSystemConfig', () => {
    it('returns ConfigResult with data and metadata from Firestore', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => SYSTEM_CONFIG_DATA,
      });

      const result = await getSystemConfig();
      expect(result.data.appName).toBe('AdtU Bus Services');
      expect(result.updatedAt).toBe('2026-07-14T12:00:00Z');
      expect(result.updatedByUid).toBe('admin-uid');
    });

    it('returns default config when document does not exist', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });

      const result = await getSystemConfig();
      expect(result.data).toBeDefined();
      expect(result.updatedAt).toBeNull();
    });
  });

  describe('updateSystemConfig', () => {
    it('upserts merged config to Firestore', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });
      mockSet.mockResolvedValue(undefined);

      await updateSystemConfig(
        { appName: 'Test', busFee: { amount: 100 } },
        'admin-uid',
      );

      expect(mockSet).toHaveBeenCalledTimes(1);
    });

    it('merges partial update with existing config', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({
          appName: 'Original',
          busFee: { amount: 5000, version: 1 },
          renewalDeadline: '2027-08-01',
        }),
      });
      mockSet.mockResolvedValue(undefined);

      await updateSystemConfig(
        { busFee: { amount: 5500 } },
        'admin-uid',
      );

      expect(mockSet).toHaveBeenCalledTimes(1);
      const [data] = mockSet.mock.calls[0];
      expect(data.appName).toBe('Original');
      expect(data.busFee.amount).toBe(5500);
    });
  });

  // ── Landing Config ───────────────────────────────────────────────────────

  describe('getLandingConfig', () => {
    it('returns ConfigResult with data merged with defaults', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => LANDING_CONFIG_DATA,
      });

      const result = await getLandingConfig();
      expect(result.data.videoPath).toBe('landing_video/test.mp4');
      expect(result.data.email).toBe('test@example.com');
    });

    it('returns defaults with null metadata when no config in Firestore', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });

      const result = await getLandingConfig();
      expect(result.data).toBeDefined();
      expect(result.updatedAt).toBeNull();
    });
  });

  describe('updateLandingConfig', () => {
    it('sets landing config in Firestore', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });
      mockSet.mockResolvedValue(undefined);

      await updateLandingConfig(
        { email: 'new@example.com' },
        'admin-uid',
      );

      expect(mockSet).toHaveBeenCalledTimes(1);
    });
  });

  // ── UI Config ────────────────────────────────────────────────────────────

  describe('getUiConfig', () => {
    it('returns UI config when found', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ({ version: '1.0.0' }),
      });

      const result = await getUiConfig();
      expect(result?.data.version).toBe('1.0.0');
    });

    it('returns null when no config', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });

      const result = await getUiConfig();
      expect(result).toBeNull();
    });
  });

  describe('updateUiConfig', () => {
    it('updates UI config in Firestore', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });
      mockSet.mockResolvedValue(undefined);

      await updateUiConfig({ version: '2.0.0' }, 'admin-uid');
      expect(mockSet).toHaveBeenCalledTimes(1);
    });
  });

  // ── Legal Config ─────────────────────────────────────────────────────────

  describe('getLegalConfig', () => {
    it('returns ConfigResult with privacy config', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => PRIVACY_CONFIG_DATA,
      });

      const result = await getLegalConfig('privacy');
      expect(result.data.title).toBe('Privacy Policy');
    });

    it('returns default privacy config when not in Firestore', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });

      const result = await getLegalConfig('privacy');
      expect(result.data.title).toBe('Privacy Policy');
    });
  });

  describe('updateLegalConfig', () => {
    it('upserts privacy config', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });
      mockSet.mockResolvedValue(undefined);

      await updateLegalConfig('privacy', { title: 'New Privacy' }, 'admin-uid');
      expect(mockSet).toHaveBeenCalledTimes(1);
    });
  });

  // ── System Markers ───────────────────────────────────────────────────────

  describe('findMarker', () => {
    it('returns marker data when found', async () => {
      mockGet.mockResolvedValue({
        exists: true,
        data: () => ACTIVATION_MARKER,
      });

      const result = await findMarker('activation_2027');
      expect(result).toEqual(ACTIVATION_MARKER);
    });

    it('returns null when marker not found', async () => {
      mockGet.mockResolvedValue({
        exists: false,
        data: () => null,
      });

      const result = await findMarker('activation_2099');
      expect(result).toBeNull();
    });
  });

  describe('upsertMarker', () => {
    it('upserts marker data in Firestore', async () => {
      mockSet.mockResolvedValue(undefined);

      await upsertMarker('activation_2027', ACTIVATION_MARKER);
      expect(mockSet).toHaveBeenCalledTimes(1);
    });
  });
});
