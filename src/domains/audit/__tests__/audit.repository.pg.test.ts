/**
 * D12 Audit — PostgreSQL Repository unit tests
 *
 * Tests repository functions using a mocked Supabase client.
 * Verifies observable behaviour: returned values, errors, nulls.
 */
import { beforeEach,describe,expect,it,vi } from 'vitest';

// ─── Mock Supabase client ────────────────────────────────────────────────────

let _mockResult: any = { data: null, error: null, count: 0 };

function createChain() {
  const chain: any = {};
  const chainableMethods = [
    'select', 'insert', 'update', 'delete', 'eq',
    'gte', 'lte', 'order', 'range', 'maybeSingle',
  ];
  for (const method of chainableMethods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(() => Promise.resolve(_mockResult));
  chain.single = vi.fn(() => Promise.resolve(_mockResult));
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(_mockResult).then(resolve, reject);
  return chain;
}

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({ from: () => createChain() }),
}));

// ─── Import SUT after mocking ────────────────────────────────────────────────

import {
	pgInsertAuditEvent,
	pgQueryAuditEvents,
} from '../repositories/audit.repository.pg';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AUDIT_ROW = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  action: 'application_approved',
  category: 'applications',
  severity: 'high',
  summary: 'Application approved: John Doe',
  actor_id: 'admin-uid-123',
  actor_name: 'Admin User',
  actor_role: 'admin',
  target_type: 'student',
  target_id: 'student-uid-456',
  target_name: 'John Doe',
  metadata: { applicationId: 'app-789' },
  created_at: '2026-07-14T10:00:00Z',
};

const INSERT_INPUT = {
  action: 'application_approved',
  category: 'applications',
  severity: 'high',
  summary: 'Application approved: John Doe',
  actor_id: 'admin-uid-123',
  actor_name: 'Admin User',
  actor_role: 'admin',
  target_type: 'student',
  target_id: 'student-uid-456',
  target_name: 'John Doe',
  metadata: { applicationId: 'app-789' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _mockResult = { data: null, error: null, count: 0 };
});

describe('Audit Repository (PG)', () => {
  // ── pgInsertAuditEvent ───────────────────────────────────────────────────

  describe('pgInsertAuditEvent', () => {
    it('returns the inserted id', async () => {
      _mockResult = { data: { id: AUDIT_ROW.id }, error: null };

      const id = await pgInsertAuditEvent(INSERT_INPUT);

      expect(id).toBe(AUDIT_ROW.id);
    });

    it('maps empty strings to null for optional fields', async () => {
      _mockResult = { data: { id: 'new-id' }, error: null };

      const id = await pgInsertAuditEvent({
        ...INSERT_INPUT,
        summary: '',
        actor_name: '',
        target_type: '',
        target_id: '',
        target_name: '',
      });

      expect(id).toBe('new-id');
    });

    it('throws when PG returns an error', async () => {
      _mockResult = { data: null, error: { message: 'connection refused' } };

      await expect(pgInsertAuditEvent(INSERT_INPUT)).rejects.toThrow(
        'connection refused'
      );
    });
  });

  // ── pgQueryAuditEvents ───────────────────────────────────────────────────

  describe('pgQueryAuditEvents', () => {
    it('returns mapped results with total and pagination metadata', async () => {
      _mockResult = {
        data: [AUDIT_ROW],
        error: null,
        count: 1,
      };

      const result = await pgQueryAuditEvents(
        {},
        { page: 1, per_page: 20 }
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(AUDIT_ROW.id);
      expect(result.data[0].action).toBe('application_approved');
      expect(result.data[0].metadata).toEqual({ applicationId: 'app-789' });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.per_page).toBe(20);
    });

    it('returns empty array when no results', async () => {
      _mockResult = { data: [], error: null, count: 0 };

      const result = await pgQueryAuditEvents(
        { category: 'nonexistent' },
        { page: 1, per_page: 20 }
      );

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('throws when PG returns an error', async () => {
      _mockResult = { data: null, error: { message: 'query failed' } };

      await expect(
        pgQueryAuditEvents({}, { page: 1, per_page: 20 })
      ).rejects.toThrow('query failed');
    });
  });
});
