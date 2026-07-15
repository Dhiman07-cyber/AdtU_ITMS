/**
 * D11 Config Service — unit tests
 *
 * Tests business logic with mocked repository layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock repository ─────────────────────────────────────────────────────────

const mockPgFindConfig = vi.fn();
const mockPgUpsertConfig = vi.fn();
const mockPgFindMarker = vi.fn();
const mockPgUpsertMarker = vi.fn();

vi.mock('../repositories/config.repository.pg', () => ({
  pgFindConfig: (...args: any[]) => mockPgFindConfig(...args),
  pgUpsertConfig: (...args: any[]) => mockPgUpsertConfig(...args),
  pgFindMarker: (...args: any[]) => mockPgFindMarker(...args),
  pgUpsertMarker: (...args: any[]) => mockPgUpsertMarker(...args),
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
};

const LANDING_CONFIG_DATA = {
  videoPath: 'landing_video/test.mp4',
  supportPhones: ['+91 12345 67890'],
  email: 'test@example.com',
};

const PRIVACY_CONFIG_DATA = {
  title: 'Privacy Policy',
  sections: [{ title: 'Section 1', content: 'Content here' }],
};

const ACTIVATION_MARKER = {
  activatedAt: '2026-07-14T10:00:00Z',
  currentSessionStartYear: 2027,
  scanned: 50,
  activated: 45,
  pendingSeatAllocation: 5,
  trigger: 'admin',
};

const ROW_META = {
  updated_at: '2026-07-14T12:00:00Z',
  updated_by_uid: 'admin-uid',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Config Service', () => {
  // ── System Config ────────────────────────────────────────────────────────

  describe('getSystemConfig', () => {
    it('returns ConfigResult with data and metadata from PG', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'config',
        config_data: SYSTEM_CONFIG_DATA,
        ...ROW_META,
      });

      const result = await getSystemConfig();
      expect(result.data).toEqual(SYSTEM_CONFIG_DATA);
      expect(result.updatedAt).toBe(ROW_META.updated_at);
      expect(result.updatedByUid).toBe(ROW_META.updated_by_uid);
      expect(mockPgFindConfig).toHaveBeenCalledWith('config');
    });

    it('throws when config not found', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      await expect(getSystemConfig()).rejects.toThrow('System configuration missing');
    });
  });

  describe('updateSystemConfig', () => {
    it('upserts cleaned config without JSON metadata', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      mockPgUpsertConfig.mockResolvedValue(undefined);

      await updateSystemConfig(
        { appName: 'Test', busFee: { amount: 100 } },
        'admin-uid',
      );

      expect(mockPgUpsertConfig).toHaveBeenCalledTimes(1);
      const [key, data, uid] = mockPgUpsertConfig.mock.calls[0];
      expect(key).toBe('config');
      expect(data.appName).toBe('Test');
      expect(data.updatedBy).toBeUndefined();
      expect(data.lastUpdated).toBeUndefined();
      expect(uid).toBe('admin-uid');
    });

    it('merges partial update with existing config (no field loss)', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'config',
        config_data: {
          appName: 'Original',
          busFee: { amount: 5000, version: 1 },
          renewalDeadline: '2027-08-01',
        },
      });
      mockPgUpsertConfig.mockResolvedValue(undefined);

      await updateSystemConfig(
        { busFee: { amount: 5500 } },
        'admin-uid',
      );

      const [, data] = mockPgUpsertConfig.mock.calls[0];
      expect(data.appName).toBe('Original');
      expect(data.busFee.amount).toBe(5500);
      expect(data.renewalDeadline).toBe('2027-08-01');
    });
  });

  // ── Landing Config ───────────────────────────────────────────────────────

  describe('getLandingConfig', () => {
    it('returns ConfigResult with data merged with defaults', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'landing',
        config_data: LANDING_CONFIG_DATA,
        ...ROW_META,
      });

      const result = await getLandingConfig();
      expect(result.data.videoPath).toBe('landing_video/test.mp4');
      expect(result.data.email).toBe('test@example.com');
      expect(result.updatedAt).toBe(ROW_META.updated_at);
    });

    it('returns defaults with null metadata when no config in PG', async () => {
      mockPgFindConfig.mockResolvedValue(null);

      const result = await getLandingConfig();
      expect(result.data.videoPath).toBe('landing_video/Welcome_Final.mp4');
      expect(result.data.supportPhones).toHaveLength(3);
      expect(result.updatedAt).toBeNull();
      expect(result.updatedByUid).toBeNull();
    });
  });

  describe('updateLandingConfig', () => {
    it('upserts landing config', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      mockPgUpsertConfig.mockResolvedValue(undefined);

      await updateLandingConfig({ videoPath: 'test.mp4' }, 'admin-uid');

      expect(mockPgUpsertConfig).toHaveBeenCalledWith(
        'landing',
        expect.objectContaining({ videoPath: 'test.mp4' }),
        'admin-uid',
      );
    });

    it('merges partial update with existing landing config', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'landing',
        config_data: { videoPath: 'old.mp4', supportPhones: ['+91 11111'], email: 'old@test.com' },
      });
      mockPgUpsertConfig.mockResolvedValue(undefined);

      await updateLandingConfig({ videoPath: 'new.mp4' }, 'admin-uid');

      const [, data] = mockPgUpsertConfig.mock.calls[0];
      expect(data.videoPath).toBe('new.mp4');
      expect(data.supportPhones).toEqual(['+91 11111']);
      expect(data.email).toBe('old@test.com');
    });
  });

  // ── UI Config ────────────────────────────────────────────────────────────

  describe('getUiConfig', () => {
    it('returns ConfigResult with UI config from PG', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'ui',
        config_data: { version: '2.0.0' },
        ...ROW_META,
      });

      const result = await getUiConfig();
      expect(result?.data.version).toBe('2.0.0');
      expect(result?.updatedAt).toBe(ROW_META.updated_at);
    });

    it('returns null when no config', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      const result = await getUiConfig();
      expect(result).toBeNull();
    });
  });

  // ── Legal Config ─────────────────────────────────────────────────────────

  describe('getLegalConfig', () => {
    it('returns ConfigResult with privacy config from PG', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'privacy',
        config_data: PRIVACY_CONFIG_DATA,
        ...ROW_META,
      });

      const result = await getLegalConfig('privacy');
      expect(result.data.title).toBe('Privacy Policy');
      expect(result.data.sections).toHaveLength(1);
      expect(result.updatedAt).toBe(ROW_META.updated_at);
    });

    it('returns default privacy config with null metadata when not in PG', async () => {
      mockPgFindConfig.mockResolvedValue(null);

      const result = await getLegalConfig('privacy');
      expect(result.data.title).toBe('Privacy Policy');
      expect(result.data.sections).toEqual([]);
      expect(result.updatedAt).toBeNull();
    });

    it('returns default terms config when not in PG', async () => {
      mockPgFindConfig.mockResolvedValue(null);

      const result = await getLegalConfig('terms');
      expect(result.data.title).toBe('Terms & Conditions');
    });
  });

  describe('updateLegalConfig', () => {
    it('upserts privacy config', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      mockPgUpsertConfig.mockResolvedValue(undefined);

      await updateLegalConfig('privacy', PRIVACY_CONFIG_DATA, 'admin-uid');

      expect(mockPgUpsertConfig).toHaveBeenCalledWith(
        'privacy',
        expect.objectContaining({ title: 'Privacy Policy', sections: PRIVACY_CONFIG_DATA.sections }),
        'admin-uid',
      );
    });

    it('upserts terms config', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      mockPgUpsertConfig.mockResolvedValue(undefined);

      await updateLegalConfig('terms', PRIVACY_CONFIG_DATA, 'admin-uid');

      expect(mockPgUpsertConfig).toHaveBeenCalledWith(
        'terms',
        expect.objectContaining({ title: 'Privacy Policy', sections: PRIVACY_CONFIG_DATA.sections }),
        'admin-uid',
      );
    });

    it('merges partial update with existing legal config', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'privacy',
        config_data: { title: 'My Privacy', sections: [{ title: 'Old', content: 'Old content' }] },
      });
      mockPgUpsertConfig.mockResolvedValue(undefined);

      await updateLegalConfig('privacy', { sections: [{ title: 'New', content: 'New content' }] }, 'admin-uid');

      const [, data] = mockPgUpsertConfig.mock.calls[0];
      expect(data.title).toBe('My Privacy');
      expect(data.sections).toEqual([{ title: 'New', content: 'New content' }]);
    });
  });

  // ── Markers ──────────────────────────────────────────────────────────────

  describe('findMarker', () => {
    it('returns marker data when found', async () => {
      mockPgFindMarker.mockResolvedValue({
        marker_key: 'activation_2027',
        marker_data: ACTIVATION_MARKER,
      });

      const result = await findMarker('activation_2027');
      expect(result).toEqual(ACTIVATION_MARKER);
    });

    it('returns null when marker not found', async () => {
      mockPgFindMarker.mockResolvedValue(null);
      const result = await findMarker('activation_2099');
      expect(result).toBeNull();
    });
  });

  describe('upsertMarker', () => {
    it('upserts marker data', async () => {
      mockPgUpsertMarker.mockResolvedValue(undefined);

      await upsertMarker('activation_2027', ACTIVATION_MARKER);

      expect(mockPgUpsertMarker).toHaveBeenCalledWith('activation_2027', ACTIVATION_MARKER);
    });
  });
});
