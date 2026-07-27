import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({ rpc: mockRpc, from: vi.fn() })),
}));

import { TripLockService } from '../trip-lock-service';

describe('TripLockService — stress / burst scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles 50 concurrent startTrip calls for same bus — exactly one succeeds', async () => {
    let callCount = 0;
    mockRpc.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: { success: true, tripId: 't1', alreadyActive: false }, error: null });
      }
      return Promise.resolve({ data: { success: false, error: 'LOCKED_BY_OTHER' }, error: null });
    });

    const service = new TripLockService();
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 50; i++) {
      promises.push(service.startTrip(`driver-${i}`, 'bus-1', 'route-1', 'morning', `trip-${i}`));
    }
    const results = await Promise.all(promises);
    expect(results.filter((r) => r.success).length).toBe(1);
    expect(results.filter((r) => !r.success).length).toBe(49);
    expect(results.filter((r) => r.errorCode === 'LOCKED_BY_OTHER').length).toBe(49);
  });

  it('handles 50 concurrent startTrip for different buses — all succeed', async () => {
    let callCount = 0;
    mockRpc.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ data: { success: true, tripId: `t${callCount}`, alreadyActive: false }, error: null });
    });

    const service = new TripLockService();
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 50; i++) {
      promises.push(service.startTrip(`driver-${i}`, `bus-${i}`, 'route-1', 'morning', `trip-${i}`));
    }
    const results = await Promise.all(promises);
    expect(results.filter((r) => r.success).length).toBe(50);
  });
});
