import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/identity.repository', () => ({
  findUserById: vi.fn().mockResolvedValue({ uid: 'u1', role: 'student' }),
  findUsersByRole: vi.fn().mockResolvedValue([{ uid: 'u2', role: 'driver' }]),
  updateUser: vi.fn().mockResolvedValue(undefined),
  removeUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/security/moderator-permissions', () => ({
  requireModeratorPermission: vi.fn(),
  getModeratorPermissions: vi.fn().mockResolvedValue({ students: { canView: true } }),
}));

import { getUserById, getUsersByRole, getModeratorPermissions } from '../services/identity.service';

describe('IdentityService', () => {
  it('delegates user lookup to the repository unchanged', async () => {
    const user = await getUserById('u1');
    expect(user).toEqual({ uid: 'u1', role: 'student' });
  });

  it('delegates role-based lookup to the repository unchanged', async () => {
    const users = await getUsersByRole('driver');
    expect(users).toEqual([{ uid: 'u2', role: 'driver' }]);
  });

  it('delegates moderator permission lookup to the security module', async () => {
    const perms = await getModeratorPermissions('mod1');
    expect(perms).toEqual({ students: { canView: true } });
  });
});
