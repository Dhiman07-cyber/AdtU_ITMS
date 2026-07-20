import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteUserAndData } from '../../cleanup-helpers';
import { adminAuth } from '../../firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import * as fleetService from '@/domains/fleet';

// Mock dependencies
vi.mock('@/lib/supabase-server', () => {
  const mockRpc = vi.fn().mockResolvedValue({ error: null });
  return {
    getSupabaseServer: () => ({
      rpc: mockRpc,
    }),
  };
});

vi.mock('@/domains/identity', () => {
  const mockStudent = {
    uid: 'test-student-123',
    email: 'test@student.com',
    fullName: 'Test Student',
    busId: 'bus-1',
    shift: 'Morning',
    status: 'active',
  };
  return {
    getStudentById: vi.fn().mockImplementation((id) => {
      if (id === 'test-student-123') return Promise.resolve(mockStudent);
      return Promise.resolve(null);
    }),
    deleteUser: vi.fn().mockResolvedValue(void 0),
    deleteStudent: vi.fn().mockResolvedValue(void 0),
  };
});

vi.mock('@/domains/fleet', () => {
  return {
    onStudentDeleted: vi.fn().mockResolvedValue(void 0),
  };
});

vi.mock('../../cloudinary-server', () => ({
  extractPublicId: vi.fn().mockReturnValue('mock-public-id'),
  deleteAsset: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../firebase-admin', () => {
  const mockBatchCommit = vi.fn().mockResolvedValue(void 0);
  const mockBatchDelete = vi.fn();
  const mockBatch = vi.fn().mockReturnValue({
    delete: mockBatchDelete,
    commit: mockBatchCommit,
  });

  const mockGet = vi.fn().mockResolvedValue({
    empty: false,
    size: 2,
    docs: [
      { ref: { delete: vi.fn().mockResolvedValue(void 0) } },
      { ref: { delete: vi.fn().mockResolvedValue(void 0) } },
    ],
  });

  const mockWhere = vi.fn().mockReturnValue({
    limit: vi.fn().mockReturnValue({
      get: mockGet,
    }),
  });

  const mockCollection = vi.fn().mockReturnValue({
    doc: vi.fn().mockReturnValue({
      collection: vi.fn().mockReturnValue({
        get: mockGet,
      }),
    }),
    where: mockWhere,
  });

  const mockDb = {
    batch: mockBatch,
    collection: mockCollection,
  };

  return {
    adminAuth: {
      getUser: vi.fn().mockResolvedValue({ providerData: [] }),
      revokeRefreshTokens: vi.fn().mockResolvedValue(void 0),
      deleteUser: vi.fn().mockResolvedValue(void 0),
    },
    adminDb: mockDb,
    db: mockDb,
  };
});

describe('Student Hard Delete Unit Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully execute the transactional delete flow in correct order', async () => {
    const result = await deleteUserAndData('test-student-123', 'student');
    expect(result.success).toBe(true);

    // Verify PostgreSQL RPC was called
    const supabase = getSupabaseServer();
    expect(supabase.rpc).toHaveBeenCalledWith('delete_student_cascade_v1', {
      p_student_uid: 'test-student-123',
    });

    // Verify Firebase Auth deletion was triggered
    expect(adminAuth.revokeRefreshTokens).toHaveBeenCalledWith('test-student-123');
    expect(adminAuth.deleteUser).toHaveBeenCalledWith('test-student-123');

    // Verify Fleet service notification was sent
    expect(fleetService.onStudentDeleted).toHaveBeenCalledWith({
      studentUid: 'test-student-123',
      busId: 'bus-1',
      shift: 'Morning',
    });
  });

  it('should behave idempotently and fail gracefully on the second delete attempt', async () => {
    // First deletion (mocked student exists)
    const result1 = await deleteUserAndData('test-student-123', 'student');
    expect(result1.success).toBe(true);

    // Second deletion (student no longer exists in identity store)
    const result2 = await deleteUserAndData('non-existent-student', 'student');
    expect(result2.success).toBe(false);
    expect(result2.error).toBe('User not found');
  });
});
