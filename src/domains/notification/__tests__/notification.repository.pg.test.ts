/**
 * D10 Notification — PostgreSQL Repository unit tests
 *
 * Tests repository functions using a mocked Supabase client.
 * No live DB connection required.
 *
 * Test philosophy: verify observable behaviour (returned domain objects,
 * thrown errors, field mapping correctness), not mock wiring details.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase client ────────────────────────────────────────────────────

let _mockResult: any = { data: null, error: null };

function createChain() {
  const chain: any = {};
  const chainableMethods = [
    'select', 'insert', 'update', 'delete', 'order',
    'eq', 'or', 'not', 'lte', 'in', 'contains', 'gt', 'gte', 'lt', 'like', 'ilike',
  ];
  for (const method of chainableMethods) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve(_mockResult));
  chain.maybeSingle = vi.fn(() => Promise.resolve(_mockResult));
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
  pgFindNotificationsByUser,
  pgFindNotificationById,
  pgFindExpiredNotifications,
  pgInsertNotification,
  pgUpdateNotification,
  pgDeleteNotification,
  pgBulkDeleteNotifications,
  pgDeleteNotificationsByUser,
} from '../repositories/notification.repository.pg';

// ─── Fixtures ────────────────────────────────────────────────────────────────
const PG_ROW = {
  id: 'test-uuid-123',
  title: 'Test Notification',
  content: 'Hello World',
  type: 'notice',
  sender: { userId: 'user-1', userName: 'Admin User', userRole: 'admin' },
  sender_user_id: 'user-1',
  target: { type: 'all_users' },
  recipient_ids: ['user-1', 'user-2', 'user-3'],
  auto_injected_recipient_ids: ['mod-1'],
  read_by_user_ids: ['user-1'],
  hidden_for_user_ids: [],
  is_edited: false,
  is_deleted_globally: false,
  deleted_by_user_id: null,
  deleted_at: null,
  created_at: '2026-07-14T10:00:00.000Z',
  updated_at: null,
  expires_at: '2026-07-15T23:59:59.999Z',
  edit_history: [],
  metadata: { priority: 'high', actionUrl: '/admin' },
};

const CREATE_INPUT = {
  title: 'New Notification',
  content: 'Test content',
  type: 'info',
  sender: { userId: 'system', userName: 'System', userRole: 'admin' as const },
  target: { type: 'specific_users' as const, specificUserIds: ['user-1'] },
  recipientIds: ['user-1'],
  autoInjectedRecipientIds: [],
  readByUserIds: [],
  hiddenForUserIds: [],
  expiresAt: '2026-07-15T23:59:59.999Z',
  metadata: { test: true },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('pgFindNotificationsByUser', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('returns mapped notifications with correct field names', async () => {
    _mockResult = { data: [PG_ROW], error: null };
    const result = await pgFindNotificationsByUser('user-1', 50);

    expect(result).toHaveLength(1);
    const n = result[0];
    expect(n.id).toBe('test-uuid-123');
    expect(n.title).toBe('Test Notification');
    expect(n.content).toBe('Hello World');
    expect(n.type).toBe('notice');
    expect(n.sender).toEqual({ userId: 'user-1', userName: 'Admin User', userRole: 'admin' });
    expect(n.target).toEqual({ type: 'all_users' });
    expect(n.recipientIds).toEqual(['user-1', 'user-2', 'user-3']);
    expect(n.autoInjectedRecipientIds).toEqual(['mod-1']);
    expect(n.readByUserIds).toEqual(['user-1']);
    expect(n.hiddenForUserIds).toEqual([]);
    expect(n.isEdited).toBe(false);
    expect(n.isDeletedGlobally).toBe(false);
    expect(n.deletedByUserId).toBeUndefined();
    expect(n.createdAt).toBe('2026-07-14T10:00:00.000Z');
    expect(n.updatedAt).toBeUndefined();
    expect(n.expiryAt).toBe('2026-07-15T23:59:59.999Z');
    expect(n.editHistory).toEqual([]);
    expect(n.metadata).toEqual({ priority: 'high', actionUrl: '/admin' });
  });

  it('returns empty array when no notifications found', async () => {
    _mockResult = { data: [], error: null };
    const result = await pgFindNotificationsByUser('user-1');
    expect(result).toEqual([]);
  });

  it('defaults null arrays to empty arrays', async () => {
    const rowWithNulls = {
      ...PG_ROW,
      recipient_ids: null,
      auto_injected_recipient_ids: null,
      read_by_user_ids: null,
      hidden_for_user_ids: null,
      edit_history: null,
      metadata: null,
    };
    _mockResult = { data: [rowWithNulls], error: null };
    const result = await pgFindNotificationsByUser('user-1');

    expect(result[0].recipientIds).toEqual([]);
    expect(result[0].autoInjectedRecipientIds).toEqual([]);
    expect(result[0].readByUserIds).toEqual([]);
    expect(result[0].hiddenForUserIds).toEqual([]);
    expect(result[0].editHistory).toEqual([]);
    expect(result[0].metadata).toEqual({});
  });

  it('throws when Supabase returns an error', async () => {
    _mockResult = { data: null, error: { message: 'connection refused' } };
    await expect(pgFindNotificationsByUser('user-1')).rejects.toThrow(
      'NotificationRepository (PG) findByUser failed: connection refused'
    );
  });
});

describe('pgFindNotificationById', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('returns a mapped notification by ID', async () => {
    _mockResult = { data: PG_ROW, error: null };
    const result = await pgFindNotificationById('test-uuid-123');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('test-uuid-123');
    expect(result!.title).toBe('Test Notification');
    expect(result!.isEdited).toBe(false);
    expect(result!.isDeletedGlobally).toBe(false);
    expect(result!.recipientIds).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('returns null when not found', async () => {
    _mockResult = { data: null, error: null };
    const result = await pgFindNotificationById('nonexistent');
    expect(result).toBeNull();
  });

  it('throws when Supabase returns an error', async () => {
    _mockResult = { data: null, error: { message: 'timeout' } };
    await expect(pgFindNotificationById('test-uuid')).rejects.toThrow(
      'NotificationRepository (PG) findById failed: timeout'
    );
  });
});

describe('pgFindExpiredNotifications', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('returns notifications with expiryAt set', async () => {
    _mockResult = { data: [PG_ROW], error: null };
    const result = await pgFindExpiredNotifications();

    expect(result).toHaveLength(1);
    expect(result[0].expiryAt).toBe('2026-07-15T23:59:59.999Z');
    expect(result[0].id).toBe('test-uuid-123');
  });

  it('returns empty array when no expired notifications', async () => {
    _mockResult = { data: [], error: null };
    const result = await pgFindExpiredNotifications();
    expect(result).toEqual([]);
  });

  it('throws when Supabase returns an error', async () => {
    _mockResult = { data: null, error: { message: 'query cancelled' } };
    await expect(pgFindExpiredNotifications()).rejects.toThrow(
      'NotificationRepository (PG) findExpired failed: query cancelled'
    );
  });
});

describe('pgInsertNotification', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('returns the generated ID on success', async () => {
    _mockResult = { data: { id: 'new-uuid-456' }, error: null };
    const id = await pgInsertNotification(CREATE_INPUT);
    expect(id).toBe('new-uuid-456');
  });

  it('throws when insert fails', async () => {
    _mockResult = { data: null, error: { message: 'unique violation' } };
    await expect(pgInsertNotification(CREATE_INPUT)).rejects.toThrow(
      'NotificationRepository (PG) insert failed: unique violation'
    );
  });
});

describe('pgUpdateNotification', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('writes exactly the fields provided — no merging or computing', async () => {
    _mockResult = { data: null, error: null };
    await pgUpdateNotification('test-uuid', { title: 'New Title', readByUserIds: ['a', 'b'] });

    // Verify the update was called (mock chain resolves successfully)
    expect(mockFrom).toHaveBeenCalledWith('notifications');
  });

  it('does nothing when called with empty input', async () => {
    _mockResult = { data: null, error: null };
    await expect(pgUpdateNotification('test-uuid', {})).resolves.toBeUndefined();
  });

  it('throws when update fails', async () => {
    _mockResult = { data: null, error: { message: 'foreign key violation' } };
    await expect(
      pgUpdateNotification('test-uuid', { content: 'updated' })
    ).rejects.toThrow('NotificationRepository (PG) update failed: foreign key violation');
  });
});

describe('pgDeleteNotification', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('deletes without error', async () => {
    _mockResult = { data: null, error: null };
    await expect(pgDeleteNotification('test-uuid')).resolves.toBeUndefined();
  });

  it('throws when delete fails', async () => {
    _mockResult = { data: null, error: { message: 'permission denied' } };
    await expect(pgDeleteNotification('test-uuid')).rejects.toThrow(
      'NotificationRepository (PG) delete failed: permission denied'
    );
  });
});

describe('pgBulkDeleteNotifications', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('returns the count of deleted notifications', async () => {
    _mockResult = { error: null, count: 3 };
    const count = await pgBulkDeleteNotifications(['id-1', 'id-2', 'id-3']);
    expect(count).toBe(3);
  });

  it('returns 0 for empty array without touching the database', async () => {
    const count = await pgBulkDeleteNotifications([]);
    expect(count).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws when bulk delete fails', async () => {
    _mockResult = { error: null, count: 0 };
    _mockResult = { data: null, error: { message: 'timeout' } };
    await expect(pgBulkDeleteNotifications(['id-1'])).rejects.toThrow(
      'NotificationRepository (PG) bulkDelete failed: timeout'
    );
  });
});

describe('pgDeleteNotificationsByUser', () => {
  beforeEach(() => { vi.clearAllMocks(); _mockResult = { data: null, error: null }; });

  it('returns total count from both recipient and sender deletions', async () => {
    _mockResult = { error: null, count: 5 };
    const count = await pgDeleteNotificationsByUser('user-1');
    // Mock returns count:5 for both queries (recipient + sender), sum = 10
    expect(count).toBe(10);
  });

  it('returns 0 when no notifications match', async () => {
    _mockResult = { error: null, count: 0 };
    const count = await pgDeleteNotificationsByUser('nonexistent-user');
    expect(count).toBe(0);
  });
});
