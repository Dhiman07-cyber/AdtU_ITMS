import { beforeEach,describe,expect,it,vi } from 'vitest';

const mockRpc = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

vi.mock('@/domains/trip/services/trip-validation.service', () => ({
  verifyDriverBusAssignment: vi.fn(() => Promise.resolve({ authorized: true, busData: { bus_number: 'BUS-01' } })),
  checkNoConflict: vi.fn(() => Promise.resolve({ conflict: false })),
  resolveRouteId: vi.fn(() => Promise.resolve('r1')),
  resolveRouteName: vi.fn(() => Promise.resolve('Route 1')),
}));

vi.mock('@/domains/trip/services/trip-broadcast.service', () => ({
  broadcastTripEvent: vi.fn(),
}));

vi.mock('@/domains/trip/services/trip-notification.service', () => ({
  dispatchTripNotification: vi.fn(),
}));

import { broadcastTripEvent } from '../services/trip-broadcast.service';
import { startTrip } from '../services/trip-orchestrator';

describe('Trip startTrip — concurrency safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    });
  });

  it('does NOT broadcast on idempotent retry (alreadyActive=true)', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, tripId: 'existing-trip', alreadyActive: true },
      error: null,
    });

    const result = await startTrip({ driverId: 'd1', busId: 'b1', routeId: 'r1', shift: 'morning' });
    expect(result.success).toBe(true);
    expect(result.tripId).toBe('existing-trip');
    expect(broadcastTripEvent).not.toHaveBeenCalled();
  });

  it('broadcasts on first-time start (alreadyActive=false)', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, tripId: 'new-trip', alreadyActive: false },
      error: null,
    });

    const result = await startTrip({ driverId: 'd1', busId: 'b1', routeId: 'r1', shift: 'morning' });
    expect(result.success).toBe(true);
    expect(result.tripId).toBe('new-trip');
    expect(broadcastTripEvent).toHaveBeenCalledTimes(1);
  });

  it('handles concurrent startTrip for same bus — only one succeeds', async () => {
    let acquireCount = 0;
    mockRpc.mockImplementation(() => {
      acquireCount++;
      if (acquireCount === 1) {
        return Promise.resolve({ data: { success: true, tripId: 't1', alreadyActive: false }, error: null });
      }
      return Promise.resolve({ data: { success: false, error: 'LOCKED_BY_OTHER' }, error: null });
    });

    const results = await Promise.all([
      startTrip({ driverId: 'd1', busId: 'b1', shift: 'morning' }),
      startTrip({ driverId: 'd2', busId: 'b1', shift: 'morning' }),
    ]);

    const successes = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success).length;
    expect(successes).toBe(1);
    expect(failures).toBe(1);
    const failed = results.find((r) => !r.success);
    expect(failed?.errorCode).toBe('LOCKED_BY_OTHER');
  });
});
