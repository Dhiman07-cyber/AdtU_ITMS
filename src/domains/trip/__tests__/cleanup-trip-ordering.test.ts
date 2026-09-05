import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());
const mockEmitEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/domains/realtime/event-emitter', () => ({
  emitEvent: mockEmitEvent,
}));

vi.mock('@/domains/gps', () => ({
  clearHistory: vi.fn(),
}));

vi.mock('@/lib/services/location-write-throttle', () => ({
  clearTripBreadcrumbCache: vi.fn(),
}));

import { cleanupTrip } from '../services/trip-cleanup.service';

describe('WAIT-003: cleanupTrip — broadcast/delete ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcasts removal events for flags that were actually deleted', async () => {
    const deletedFlags = [
      { id: 'f1', student_uid: 's1', bus_id: 'b1' },
      { id: 'f2', student_uid: 's2', bus_id: 'b1' },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({ data: deletedFlags, error: null }),
                }),
              })),
            })),
          })),
        };
      }
      if (table === 'device_sessions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      return { delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) })) };
    });

    await cleanupTrip({ driverId: 'd1', busId: 'b1', tripId: 't1' });

    // Should broadcast waiting_flag_removed for each deleted flag
    const removedCalls = mockEmitEvent.mock.calls.filter(
      (c: any[]) => c[1] === 'waiting_flag_removed'
    );
    expect(removedCalls.length).toBe(4); // 2 flags × 2 channels (student + bus)
  });

  it('does NOT broadcast for a flag that was created after the DELETE', async () => {
    // Only f1 was actually deleted — f2 was created after the DELETE and wasn't affected
    const onlyF1Deleted = [{ id: 'f1', student_uid: 's1', bus_id: 'b1' }];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({ data: onlyF1Deleted, error: null }),
                }),
              })),
            })),
          })),
        };
      }
      if (table === 'device_sessions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      return { delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) })) };
    });

    await cleanupTrip({ driverId: 'd1', busId: 'b1', tripId: 't1' });

    const removedCalls = mockEmitEvent.mock.calls.filter(
      (c: any[]) => c[1] === 'waiting_flag_removed'
    );
    // Only f1 was deleted → only f1 should be broadcast (1 flag × 2 channels = 2)
    expect(removedCalls.length).toBe(2);
    // Verify it's f1, not f2
    expect(removedCalls[0][0]).toBe('student_s1');
  });

  it('returns empty deleted list when no flags exist — no broadcast', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                in: vi.fn().mockReturnValue({
                  select: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              })),
            })),
          })),
        };
      }
      if (table === 'device_sessions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      return { delete: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) })) };
    });

    await cleanupTrip({ driverId: 'd1', busId: 'b1', tripId: 't1' });

    const removedCalls = mockEmitEvent.mock.calls.filter(
      (c: any[]) => c[1] === 'waiting_flag_removed'
    );
    expect(removedCalls.length).toBe(0);
  });
});
