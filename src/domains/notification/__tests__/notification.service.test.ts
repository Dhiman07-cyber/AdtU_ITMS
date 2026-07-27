import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockInsert = vi.fn().mockResolvedValue('n1');
const mockFindById = vi.fn();
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockResolveTargetRecipients = vi.fn().mockResolvedValue(['u2', 'u3']);
const mockGetAutoInjectedRecipients = vi.fn().mockResolvedValue([]);

vi.mock('../repositories/notification.repository', () => ({
  canUserSend: vi.fn(() => ({ allowed: true })),
  canUserEdit: vi.fn(() => ({ allowed: true })),
  canUserDeleteGlobally: vi.fn(() => ({ allowed: true })),
  getAutoInjectedRecipients: (...args: any[]) => mockGetAutoInjectedRecipients(...args),
  resolveTargetRecipients: (...args: any[]) => mockResolveTargetRecipients(...args),
  insert: (...args: any[]) => mockInsert(...args),
  findById: (...args: any[]) => mockFindById(...args),
  update: (...args: any[]) => mockUpdate(...args),
}));

import {
	createNotification,
	markAsRead,
} from '../services/notification.service';

describe('NotificationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createNotification resolves recipients and inserts via PG', async () => {
    const id = await createNotification(
      { userId: 'u1', userName: 'Test', userRole: 'admin' },
      { type: 'all_users' },
      'Hello',
      'Title',
    );
    expect(id).toBe('n1');
    expect(mockResolveTargetRecipients).toHaveBeenCalledWith({ type: 'all_users' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Title',
        content: 'Hello',
        recipientIds: expect.arrayContaining(['u2', 'u3']),
        readByUserIds: ['u1'],
      }),
    );
  });

  it('markAsRead appends userId to readByUserIds', async () => {
    mockFindById.mockResolvedValue({
      id: 'n1',
      readByUserIds: ['u2'],
      sender: { userId: 'u1' },
    });

    await markAsRead('u1', 'n1');

    expect(mockUpdate).toHaveBeenCalledWith('n1', {
      readByUserIds: ['u2', 'u1'],
    });
  });

  it('markAsRead is idempotent — no-op if already read', async () => {
    mockFindById.mockResolvedValue({
      id: 'n1',
      readByUserIds: ['u1'],
      sender: { userId: 'u2' },
    });

    await markAsRead('u1', 'n1');

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
