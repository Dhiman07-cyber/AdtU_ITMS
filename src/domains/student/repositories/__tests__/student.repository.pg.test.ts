import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSelect = vi.fn();
const mockOr = vi.fn();
const mockNot = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockGt = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    from: () => ({
      select: mockSelect,
    }),
  }),
}));

import { pgFindSeatOccupying } from '../student.repository.pg';

describe('pgFindSeatOccupying — Keyset Pagination Verification (CAP-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('paginates and retrieves all rows across multiple chunks exceeding 1,000 items', async () => {
    // Generate 1,200 simulated student records across 2 pages (page 1: 1,000 rows, page 2: 200 rows)
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      uid: `student-${String(i).padStart(4, '0')}`,
      bus_id: 'bus-1',
      shift: 'Morning',
      status: 'active',
      seat_released_at: null,
      stop_name: 'Stop A',
    }));

    const page2 = Array.from({ length: 200 }, (_, i) => ({
      uid: `student-${String(1000 + i).padStart(4, '0')}`,
      bus_id: 'bus-1',
      shift: 'Morning',
      status: 'active',
      seat_released_at: null,
      stop_name: 'Stop A',
    }));

    let queryCount = 0;

    mockSelect.mockReturnValue({
      or: mockOr,
    });
    mockOr.mockReturnValue({
      not: mockNot,
    });
    mockNot.mockReturnValue({
      order: mockOrder,
    });
    mockOrder.mockReturnValue({
      limit: mockLimit,
    });

    mockLimit.mockImplementation(() => {
      queryCount++;
      if (queryCount === 1) {
        return {
          gt: mockGt,
          then: (resolve: any) => resolve({ data: page1, error: null }),
        };
      }
      return {
        gt: mockGt,
        then: (resolve: any) => resolve({ data: page2, error: null }),
      };
    });

    mockGt.mockImplementation(() => ({
      then: (resolve: any) => resolve({ data: page2, error: null }),
    }));

    const result = await pgFindSeatOccupying();

    // Verifies that all 1,200 students are retrieved without 1,000-row PostgREST truncation
    expect(result.length).toBe(1200);
    expect(result[0].uid).toBe('student-0000');
    expect(result[1199].uid).toBe('student-1199');
  });
});
