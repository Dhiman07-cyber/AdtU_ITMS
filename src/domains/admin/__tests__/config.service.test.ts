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
  lastUpdated: '2026-07-14',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Config Service', () => {
  // ── System Config ────────────────────────────────────────────────────────

  describe('getSystemConfig', () => {
    it('returns system config from PG', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'config',
        config_data: SYSTEM_CONFIG_DATA,
      });

      const result = await getSystemConfig();
      expect(result).toEqual(SYSTEM_CONFIG_DATA);
      expect(mockPgFindConfig).toHaveBeenCalledWith('config');
    });

    it('throws when config not found', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      await expect(getSystemConfig()).rejects.toThrow('System configuration missing');
    });
  });

  describe('updateSystemConfig', () => {
    it('upserts cleaned config with metadata', async () => {
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
      expect(data.updatedBy).toBe('admin-uid');
      expect(data.lastUpdated).toBeDefined();
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
    it('returns config from PG merged with defaults', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'landing',
        config_data: LANDING_CONFIG_DATA,
      });

      const result = await getLandingConfig();
      expect(result.videoPath).toBe('landing_video/test.mp4');
      expect(result.email).toBe('test@example.com');
    });

    it('returns defaults when no config in PG', async () => {
      mockPgFindConfig.mockResolvedValue(null);

      const result = await getLandingConfig();
      expect(result.videoPath).toBe('landing_video/Welcome_Final.mp4');
      expect(result.supportPhones).toHaveLength(3);
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
    it('returns UI config from PG', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'ui',
        config_data: { version: '2.0.0', lastUpdated: '2026-07-14' },
      });

      const result = await getUiConfig();
      expect(result?.version).toBe('2.0.0');
    });

    it('returns null when no config', async () => {
      mockPgFindConfig.mockResolvedValue(null);
      const result = await getUiConfig();
      expect(result).toBeNull();
    });
  });

  // ── Legal Config ─────────────────────────────────────────────────────────

  describe('getLegalConfig', () => {
    it('returns privacy config from PG', async () => {
      mockPgFindConfig.mockResolvedValue({
        config_key: 'privacy',
        config_data: PRIVACY_CONFIG_DATA,
      });

      const result = await getLegalConfig('privacy');
      expect(result.title).toBe('Privacy Policy');
      expect(result.sections).toHaveLength(1);
    });

    it('returns default privacy config when not in PG', async () => {
      mockPgFindConfig.mockResolvedValue(null);

      const result = await getLegalConfig('privacy');
      expect(result.title).toBe('Privacy Policy');
      expect(result.sections).toEqual([]);
    });

    it('returns default terms config when not in PG', async () => {
      mockPgFindConfig.mockResolvedValue(null);

      const result = await getLegalConfig('terms');
      expect(result.title).toBe('Terms & Conditions');
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
        config_data: { title: 'My Privacy', lastUpdated: '2026-01-01', sections: [{ title: 'Old', content: 'Old content' }] },
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
