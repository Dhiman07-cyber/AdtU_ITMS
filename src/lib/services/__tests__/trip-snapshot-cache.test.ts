import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSharedBusTripSnapshot, invalidateBusTripSnapshot } from '../trip-snapshot-cache';
import { getSupabaseServer } from '@/lib/supabase-server';

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(),
}));

vi.mock('@/domains/gps', () => ({
  getLastLocationForBusAsync: vi.fn().mockResolvedValue({
    lat: 26.1445,
    lng: 91.7362,
    speed: 35,
    heading: 90,
    accuracy: 10,
    timestamp: '2026-10-18T07:15:00.000Z',
  }),
  getLastLocationForBus: vi.fn().mockReturnValue(null),
}));

describe('Optimization 1: getSharedBusTripSnapshot (Singleflight & Snapshot Cache)', () => {
  let queryCount = 0;

  beforeEach(() => {
    queryCount = 0;
    invalidateBusTripSnapshot();
    vi.clearAllMocks();

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'waiting_flags') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'flag_01',
                        student_uid: 'student_99',
                        status: 'waiting',
                        lat: 26.14,
                        lng: 91.73,
                        stop_lat: null,
                        stop_lng: null,
                        route_progress_meters: 1500,
                        expires_at: new Date(Date.now() + 60000).toISOString(),
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gt: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockImplementation(async () => {
                      queryCount++;
                      // Simulate non-zero database latency
                      await new Promise((r) => setTimeout(r, 20));
                      return {
                        data: [
                          {
                            trip_id: 'trip_100',
                            bus_id: 'bus_04',
                            driver_id: 'driver_01',
                            route_id: 'route_1',
                            shift: 'Morning',
                            status: 'active',
                            start_time: '2026-10-18T07:00:00.000Z',
                            last_heartbeat: '2026-10-18T07:15:00.000Z',
                            expires_at: '2026-10-18T07:25:00.000Z',
                          },
                        ],
                        error: null,
                      };
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }),
    };

    (getSupabaseServer as any).mockReturnValue(mockSupabase);
  });

  it('coalesces 60 concurrent requests for the same bus into exactly 1 Supabase query', async () => {
    // 60 students on bus_04 requesting trip-status simultaneously
    const requests = Array.from({ length: 60 }, () => getSharedBusTripSnapshot('bus_04'));
    const results = await Promise.all(requests);

    expect(results).toHaveLength(60);
    expect(queryCount).toBe(1);

    for (const r of results) {
      expect(r.tripActive).toBe(true);
      expect(r.tripData?.tripId).toBe('trip_100');
      expect(r.tripData?.current_location?.lat).toBe(26.1445);
      expect(r.activeFlagsByStudentUid['student_99']).toBeDefined();
      expect(r.activeFlagsByStudentUid['student_99'].status).toBe('waiting');
    }
  });

  it('serves sequential requests within 3000ms TTL directly from memory without querying database', async () => {
    const first = await getSharedBusTripSnapshot('bus_04');
    expect(queryCount).toBe(1);
    expect(first.tripActive).toBe(true);

    const second = await getSharedBusTripSnapshot('bus_04');
    expect(queryCount).toBe(1); // 0 additional DB queries
    expect(second.tripData?.tripId).toBe('trip_100');
  });

  it('immediately queries database after invalidateBusTripSnapshot is called', async () => {
    await getSharedBusTripSnapshot('bus_04');
    expect(queryCount).toBe(1);

    invalidateBusTripSnapshot('bus_04');

    await getSharedBusTripSnapshot('bus_04');
    expect(queryCount).toBe(2);
  });
});
