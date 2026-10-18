import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCachedStudentAssignment,
  invalidateStudentAssignment,
  clearStudentAssignmentMemoryCache,
} from '../services/student-assignment-cache';
import { getSupabaseServer } from '@/lib/supabase-server';

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(),
}));

vi.mock('@/domains/gps/services/gps-redis-guard', () => ({
  executeGpsRedisCommand: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/security/role-cache-redis', () => ({
  publishRoleInvalidation: vi.fn(),
}));

describe('Optimization 3: Student Assignment Metadata Cache (L1 Memory + Singleflight)', () => {
  let dbQueries = 0;

  beforeEach(() => {
    dbQueries = 0;
    clearStudentAssignmentMemoryCache();
    vi.clearAllMocks();

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(async () => {
              dbQueries++;
              await new Promise((r) => setTimeout(r, 15));
              return {
                data: {
                  uid: 'student_123',
                  full_name: 'Rahul Sarma',
                  bus_id: 'bus_04',
                  route_id: 'route_1',
                  shift: 'Morning',
                  stop_name: 'Jalukbari Point',
                  status: 'active',
                  soft_block: null,
                  valid_until: '2026-12-31T23:59:59.000Z',
                  hard_block: null,
                },
                error: null,
              };
            }),
          }),
        }),
      }),
    };

    (getSupabaseServer as any).mockReturnValue(mockSupabase);
  });

  it('coalesces concurrent requests for the same student into 1 DB query', async () => {
    // 10 concurrent requests for student_123 (e.g. reconnect blip / multiple tabs)
    const requests = Array.from({ length: 10 }, () => getCachedStudentAssignment('student_123'));
    const results = await Promise.all(requests);

    expect(results).toHaveLength(10);
    expect(dbQueries).toBe(1);

    for (const r of results) {
      expect(r?.busId).toBe('bus_04');
      expect(r?.fullName).toBe('Rahul Sarma');
      expect(r?.shift).toBe('Morning');
    }
  });

  it('serves subsequent requests from L1 memory cache without DB reads', async () => {
    const first = await getCachedStudentAssignment('student_123');
    expect(dbQueries).toBe(1);
    expect(first?.busId).toBe('bus_04');

    const second = await getCachedStudentAssignment('student_123');
    expect(dbQueries).toBe(1); // 0 additional queries
    expect(second?.busId).toBe('bus_04');
  });

  it('invalidates L1 cache and re-fetches after invalidateStudentAssignment', async () => {
    await getCachedStudentAssignment('student_123');
    expect(dbQueries).toBe(1);

    await invalidateStudentAssignment('student_123');

    await getCachedStudentAssignment('student_123');
    expect(dbQueries).toBe(2);
  });
});
