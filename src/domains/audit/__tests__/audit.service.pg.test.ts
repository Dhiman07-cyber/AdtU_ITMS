/**
 * D12 Audit Service (PG) — unit tests
 *
 * Tests service functions using mocked repository.
 * Verifies validation, result types, and error handling.
 */
import { beforeEach,describe,expect,it,vi } from 'vitest';

// ─── Mock repository ─────────────────────────────────────────────────────────

const mockPgInsertAuditEvent = vi.fn().mockResolvedValue('audit-pg-id-1');
const mockPgQueryAuditEvents = vi.fn().mockResolvedValue({
  data: [],
  total: 0,
  page: 1,
  per_page: 20,
});

vi.mock('../repositories/audit.repository.pg', () => ({
  pgInsertAuditEvent: (...args: any[]) => mockPgInsertAuditEvent(...args),
  pgQueryAuditEvents: (...args: any[]) => mockPgQueryAuditEvents(...args),
}));

// ─── Import SUT after mocking ────────────────────────────────────────────────

import {
	createAuditEvent,
	queryAuditEvents,
	SYSTEM_ACTOR,
} from '../services/audit.service.pg';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_INPUT = {
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

const AUDIT_ROW = {
  id: 'audit-pg-id-1',
  ...VALID_INPUT,
  created_at: '2026-07-14T10:00:00Z',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockPgInsertAuditEvent.mockResolvedValue('audit-pg-id-1');
  mockPgQueryAuditEvents.mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    per_page: 20,
  });
});

describe('AuditService (PG)', () => {
  // ── SYSTEM_ACTOR ───────────────────────────────────────────────────────

  describe('SYSTEM_ACTOR', () => {
    it('has correct values', () => {
      expect(SYSTEM_ACTOR).toEqual({
        id: 'system',
        name: 'System (automated)',
        role: 'system',
      });
    });
  });

  // ── createAuditEvent ──────────────────────────────────────────────────

  describe('createAuditEvent', () => {
    it('returns success with id on valid input', async () => {
      const result = await createAuditEvent(VALID_INPUT);

      expect(result.success).toBe(true);
      expect(result.id).toBe('audit-pg-id-1');
      expect(result.error).toBeUndefined();
    });

    it('returns failure for invalid category', async () => {
      const result = await createAuditEvent({
        ...VALID_INPUT,
        category: 'banana',
      });

      expect(result.success).toBe(false);
      expect(result.id).toBeUndefined();
      expect(result.error).toContain('Invalid audit category');
    });

    it('returns failure for invalid severity', async () => {
      const result = await createAuditEvent({
        ...VALID_INPUT,
        severity: 'very_high',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid audit severity');
    });

    it('returns failure for invalid actor_role', async () => {
      const result = await createAuditEvent({
        ...VALID_INPUT,
        actor_role: 'superadmin',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid audit actor_role');
    });

    it('returns failure with error message when repository throws', async () => {
      mockPgInsertAuditEvent.mockRejectedValueOnce(
        new Error('connection refused')
      );

      const result = await createAuditEvent(VALID_INPUT);

      expect(result.success).toBe(false);
      expect(result.id).toBeUndefined();
      expect(result.error).toBe('connection refused');
    });

    it('returns failure with generic message for non-Error throws', async () => {
      mockPgInsertAuditEvent.mockRejectedValueOnce('unknown');

      const result = await createAuditEvent(VALID_INPUT);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database insert failed');
    });
  });

  // ── queryAuditEvents ──────────────────────────────────────────────────

  describe('queryAuditEvents', () => {
    it('returns mapped results from repository', async () => {
      mockPgQueryAuditEvents.mockResolvedValueOnce({
        data: [AUDIT_ROW],
        total: 1,
        page: 1,
        per_page: 20,
      });

      const result = await queryAuditEvents({}, { page: 1, per_page: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('audit-pg-id-1');
      expect(result.data[0].metadata).toEqual({ applicationId: 'app-789' });
      expect(result.total).toBe(1);
    });
  });
});
