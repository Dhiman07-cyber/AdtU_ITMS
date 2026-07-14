/**
 * D11 Config — PostgreSQL Repository unit tests
 *
 * Tests repository functions using a mocked Supabase client.
 * No live DB connection required.
 *
 * Test philosophy: verify observable behaviour (returned domain objects,
 * thrown errors), not mock wiring details.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase client ────────────────────────────────────────────────────

let _mockResult: any = { data: null, error: null };

function createChain() {
  const chain: any = {};
  const chainableMethods = ['select', 'insert', 'update', 'delete', 'eq', 'maybeSingle'];
  for (const method of chainableMethods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(_mockResult));
  chain.upsert = vi.fn(() => Promise.resolve(_mockResult));
  chain.single = vi.fn(() => Promise.resolve(_mockResult));
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(_mockResult).then(resolve, reject);
  return chain;
}

const mockFrom = vi.fn(() => createChain());

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({ from: mockFrom }),
}));

// ─── Import SUT after mocking ────────────────────────────────────────────────
import {
  pgFindConfig,
  pgUpsertConfig,
  pgFindMarker,
  pgUpsertMarker,
} from '../repositories/config.repository.pg';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONFIG_ROW = {
  config_key: 'config',
  config_data: {
    appName: 'AdtU Bus Services',
    busFee: { amount: 5000, version: 1 },
  },
  updated_at: '2026-07-14T10:00:00Z',
  updated_by_uid: 'admin-uid-123',
};

const MARKER_ROW = {
  marker_key: 'activation_2027',
  marker_data: {
    activatedAt: '2026-07-14T10:00:00Z',
    currentSessionStartYear: 2027,
    scanned: 50,
    activated: 45,
    pendingSeatAllocation: 5,
    trigger: 'admin',
  },
  created_at: '2026-07-14T10:00:00Z',
  updated_at: '2026-07-14T10:00:00Z',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _mockResult = { data: null, error: null };
});

describe('Config Repository (PG)', () => {
  // ── pgFindConfig ──────────────────────────────────────────────────────────

  describe('pgFindConfig', () => {
    it('returns config row when found', async () => {
      _mockResult = { data: CONFIG_ROW, error: null };

      const result = await pgFindConfig('config');

      expect(result).toEqual(CONFIG_ROW);
      expect(mockFrom).toHaveBeenCalledWith('system_config');
    });

    it('returns null when config not found', async () => {
      _mockResult = { data: null, error: null };

      const result = await pgFindConfig('nonexistent');

      expect(result).toBeNull();
    });

    it('throws on PG error', async () => {
      _mockResult = { data: null, error: { message: 'connection refused' } };

      await expect(pgFindConfig('config')).rejects.toThrow('connection refused');
    });
  });

  // ── pgUpsertConfig ────────────────────────────────────────────────────────

  describe('pgUpsertConfig', () => {
    it('upserts config with data and updated_by_uid', async () => {
      _mockResult = { data: null, error: null };

      await pgUpsertConfig('config', { appName: 'Test' }, 'uid-123');

      expect(mockFrom).toHaveBeenCalledWith('system_config');
    });

    it('upserts config without updated_by_uid', async () => {
      _mockResult = { data: null, error: null };

      await pgUpsertConfig('landing', { videoPath: 'test.mp4' });

      expect(mockFrom).toHaveBeenCalledWith('system_config');
    });

    it('throws on PG error', async () => {
      _mockResult = { data: null, error: { message: 'constraint violation' } };

      await expect(pgUpsertConfig('config', {})).rejects.toThrow('constraint violation');
    });
  });

  // ── pgFindMarker ──────────────────────────────────────────────────────────

  describe('pgFindMarker', () => {
    it('returns marker row when found', async () => {
      _mockResult = { data: MARKER_ROW, error: null };

      const result = await pgFindMarker('activation_2027');

      expect(result).toEqual(MARKER_ROW);
      expect(mockFrom).toHaveBeenCalledWith('system_markers');
    });

    it('returns null when marker not found', async () => {
      _mockResult = { data: null, error: null };

      const result = await pgFindMarker('activation_2099');

      expect(result).toBeNull();
    });

    it('throws on PG error', async () => {
      _mockResult = { data: null, error: { message: 'query failed' } };

      await expect(pgFindMarker('activation_2027')).rejects.toThrow('query failed');
    });
  });

  // ── pgUpsertMarker ────────────────────────────────────────────────────────

  describe('pgUpsertMarker', () => {
    it('upserts marker data', async () => {
      _mockResult = { data: null, error: null };

      await pgUpsertMarker('activation_2027', { activatedAt: '2026-07-14T10:00:00Z' });

      expect(mockFrom).toHaveBeenCalledWith('system_markers');
    });

    it('throws on PG error', async () => {
      _mockResult = { data: null, error: { message: 'upsert failed' } };

      await expect(pgUpsertMarker('activation_2027', {})).rejects.toThrow('upsert failed');
    });
  });
});
