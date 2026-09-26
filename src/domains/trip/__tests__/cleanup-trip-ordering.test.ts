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
        const chain: any = {};
        chain.eq = vi.fn(() => chain);
        chain.in = vi.fn(() => chain);
        chain.select = vi.fn().mockResolvedValue({ data: deletedFlags, error: null });
        return {
          delete: vi.fn(() => chain),
        };
      }
      if (table === 'device_sessions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      return { delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })) };
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
        const chain: any = {};
        chain.eq = vi.fn(() => chain);
        chain.in = vi.fn(() => chain);
        chain.select = vi.fn().mockResolvedValue({ data: onlyF1Deleted, error: null });
        return {
          delete: vi.fn(() => chain),
        };
      }
      if (table === 'device_sessions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      return { delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })) };
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
        const chain: any = {};
        chain.eq = vi.fn(() => chain);
        chain.in = vi.fn(() => chain);
        chain.select = vi.fn().mockResolvedValue({ data: [], error: null });
        return {
          delete: vi.fn(() => chain),
        };
      }
      if (table === 'device_sessions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        };
      }
      return { delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })) };
    });

    await cleanupTrip({ driverId: 'd1', busId: 'b1', tripId: 't1' });

    const removedCalls = mockEmitEvent.mock.calls.filter(
      (c: any[]) => c[1] === 'waiting_flag_removed'
    );
    expect(removedCalls.length).toBe(0);
  });

  it('unconditionally purges flags even if they had null or mismatched trip_id on the bus', async () => {
    // Real-world worst-case: student raised a flag before driver started trip (trip_id was null or old),
    // then driver completes trip t1. Both flags must be purged so no ghost pins linger.
    const orphanedFlags = [
      { id: 'f-orphaned-1', student_uid: 's1', bus_id: 'b1', trip_id: null },
      { id: 'f-orphaned-2', student_uid: 's2', bus_id: 'b1', trip_id: 't-old-previous' },
    ];

    let deleteFilterBusId: string | null = null;
    let deleteFilterTripId: string | null = null;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'waiting_flags') {
        const chain: any = {};
        chain.eq = vi.fn((field: string, val: string) => {
          if (field === 'bus_id') deleteFilterBusId = val;
          if (field === 'trip_id') deleteFilterTripId = val;
          return chain;
        });
        chain.in = vi.fn(() => chain);
        chain.select = vi.fn().mockResolvedValue({ data: orphanedFlags, error: null });
        return {
          delete: vi.fn(() => chain),
        };
      }
      return { delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })) };
    });

    await cleanupTrip({ driverId: 'd1', busId: 'b1', tripId: 't1' });

    // Assert that the delete filter was strictly scoped to bus_id and DID NOT filter on trip_id
    expect(deleteFilterBusId).toBe('b1');
    expect(deleteFilterTripId).toBeNull();

    // Verify broadcasts were dispatched for both orphaned flags
    const removedCalls = mockEmitEvent.mock.calls.filter(
      (c: any[]) => c[1] === 'waiting_flag_removed'
    );
    expect(removedCalls.length).toBe(4); // 2 flags × 2 channels (student + bus)
  });
});
