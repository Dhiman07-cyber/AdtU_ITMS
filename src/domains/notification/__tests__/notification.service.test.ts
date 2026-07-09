import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/notification.repository', () => ({
  createNotification: vi.fn().mockResolvedValue('n1'),
  editNotification: vi.fn().mockResolvedValue(undefined),
  deleteNotificationGlobally: vi.fn().mockResolvedValue(undefined),
  markAsRead: vi.fn().mockResolvedValue(undefined),
}));

import {
  createNotification,
  markAsRead,
} from '../services/notification.service';

describe('NotificationService', () => {
  it('delegates createNotification to the repository unchanged', async () => {
    const id = await createNotification(
      { userId: 'u1', userName: 'Test', userRole: 'admin' },
      { type: 'all_users' },
      'Hello',
      'Title',
    );
    expect(id).toBe('n1');
  });

  it('delegates markAsRead to the repository unchanged', async () => {
    await expect(markAsRead('u1', 'n1')).resolves.toBeUndefined();
  });
});
