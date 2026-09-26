import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getUsersByIds, getUsersByEmails, getStudentsByIds } from '../services/identity.service';
import * as identityRepo from '../repositories/identity.repository';

describe('Identity Batch Lookup Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates getUsersByIds to identity.repository.findUsersByIds', async () => {
    const mockUsers = [
      { uid: 'u1', email: 'u1@test.com', name: 'User 1', role: 'admin' as const, createdAt: '' },
      { uid: 'u2', email: 'u2@test.com', name: 'User 2', role: 'moderator' as const, createdAt: '' },
    ];
    vi.spyOn(identityRepo, 'findUsersByIds').mockResolvedValue(mockUsers);

    const result = await getUsersByIds(['u1', 'u2']);
    expect(identityRepo.findUsersByIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect(result).toEqual(mockUsers);
  });

  it('delegates getUsersByEmails to identity.repository.findUsersByEmails', async () => {
    const mockUsers = [
      { uid: 'u1', email: 'u1@test.com', name: 'User 1', role: 'admin' as const, createdAt: '' },
    ];
    vi.spyOn(identityRepo, 'findUsersByEmails').mockResolvedValue(mockUsers);

    const result = await getUsersByEmails(['u1@test.com']);
    expect(identityRepo.findUsersByEmails).toHaveBeenCalledWith(['u1@test.com']);
    expect(result).toEqual(mockUsers);
  });

  it('delegates getStudentsByIds to identity.repository.findStudentsByIds', async () => {
    const mockStudents = [
      { uid: 's1', fullName: 'Student 1', enrollmentId: 'EN001' },
      { uid: 's2', fullName: 'Student 2', enrollmentId: 'EN002' },
    ];
    vi.spyOn(identityRepo, 'findStudentsByIds').mockResolvedValue(mockStudents);

    const result = await getStudentsByIds(['s1', 's2']);
    expect(identityRepo.findStudentsByIds).toHaveBeenCalledWith(['s1', 's2']);
    expect(result).toEqual(mockStudents);
  });
});
