import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

vi.mock('@/domains/trip/services/trip-broadcast.service', () => ({
  broadcastTripEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/trip/services/trip-notification.service', () => ({
  dispatchTripNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/trip/services/trip-cleanup.service', () => ({
  cleanupTrip: vi.fn().mockResolvedValue(undefined),
}));

import { tripLockService } from '@/lib/services/trip-lock-service';
import { endTrip } from '../services/trip-orchestrator';

describe('Trip end — atomicity and idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'active_trips') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { trip_id: 't-123', bus_id: 'b-1', driver_id: 'd-1', route_id: 'r-1', status: 'active' },
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      };
    });
  });

  it('1. Normal end trip — calls end_trip_atomically RPC with correct parameters', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, tripId: 't-123', alreadyEnded: false },
      error: null,
    });

    const result = await endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' });

    expect(result.success).toBe(true);
    expect(result.tripId).toBe('t-123');
    expect(mockRpc).toHaveBeenCalledWith('end_trip_atomically', {
      p_trip_id: 't-123',
      p_bus_id: 'b-1',
      p_driver_id: 'd-1',
    });
  });

  it('2. Double-click end trip — handles alreadyEnded idempotently without error', async () => {
    // First call succeeds
    mockRpc.mockResolvedValueOnce({
      data: { success: true, tripId: 't-123', alreadyEnded: false },
      error: null,
    });

    const first = await endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' });
    expect(first.success).toBe(true);

    // Second call receives alreadyEnded: true from RPC
    mockRpc.mockResolvedValueOnce({
      data: { success: true, tripId: 't-123', alreadyEnded: true },
      error: null,
    });

    const second = await endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' });
    expect(second.success).toBe(true);
    expect(second.tripId).toBe('t-123');
  });

  it('3. Concurrent end trip requests — both complete cleanly without duplicate errors', async () => {
    let callCount = 0;
    mockRpc.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          data: { success: true, tripId: 't-123', alreadyEnded: false },
          error: null,
        });
      }
      return Promise.resolve({
        data: { success: true, tripId: 't-123', alreadyEnded: true },
        error: null,
      });
    });

    const [res1, res2] = await Promise.all([
      endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' }),
      endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' }),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('4. RPC failure / rollback — surfaces failure cleanly when DB RPC errors', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'Database connection failed during transaction' },
    });

    const result = await endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('Database connection failed during transaction');
  });

  it('5. Retry after transient failure — second attempt succeeds after first RPC error', async () => {
    // Attempt 1 fails
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Transient deadlock' },
    });

    const attempt1 = await endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' });
    expect(attempt1.success).toBe(false);

    // Attempt 2 succeeds
    mockRpc.mockResolvedValueOnce({
      data: { success: true, tripId: 't-123', alreadyEnded: false },
      error: null,
    });

    const attempt2 = await endTrip({ driverId: 'd-1', busId: 'b-1', tripId: 't-123' });
    expect(attempt2.success).toBe(true);
    expect(attempt2.tripId).toBe('t-123');
  });

  it('6. Stale-lock cleanup compatibility — tripLockService.endTrip operates atomically', async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, tripId: 't-123', alreadyEnded: true },
      error: null,
    });

    const lockResult = await tripLockService.endTrip('t-123', 'd-1', 'b-1');
    expect(lockResult.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('end_trip_atomically', {
      p_trip_id: 't-123',
      p_bus_id: 'b-1',
      p_driver_id: 'd-1',
    });
  });
});
