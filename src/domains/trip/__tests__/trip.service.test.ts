import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/services/trip-lock-service', () => ({
  tripLockService: {
    startTrip: vi.fn().mockResolvedValue({ success: true, tripId: 't1' }),
    endTrip: vi.fn().mockResolvedValue({ success: true }),
    getActiveTrip: vi.fn().mockResolvedValue({ trip_id: 't1', bus_id: 'b1', status: 'active', driver_id: 'd1', route_id: 'r1' }),
    canOperate: vi.fn().mockResolvedValue({ allowed: true }),
    heartbeat: vi.fn().mockResolvedValue({ success: true }),
  },
}));

const makeQueryChain = vi.hoisted(() => {
  return (data: any) => {
    const chain: any = {};
    chain.maybeSingle = vi.fn().mockResolvedValue({ data });
    chain.eq = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.delete = vi.fn(() => chain);
    chain.update = vi.fn(() => chain);
    chain.insert = vi.fn(() => chain);
    chain.gte = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.then = vi.fn((resolveThen: any) => resolveThen({ data, error: null }));
    return chain;
  };
});

const busRow = vi.hoisted(() => ({ id: 'b1', driver_uid: 'd1', status: 'active', bus_number: 'BUS-001', route_id: 'r1', route_name: 'Route 1' }));
const routesRow = vi.hoisted(() => ({ id: 'r1', name: 'Route 1', route_name: 'Route 1' }));

vi.mock('@/lib/supabase-server', () => {
  const channelMock = { subscribe: vi.fn().mockResolvedValue(undefined), send: vi.fn().mockResolvedValue(undefined) };
  return {
    getSupabaseServer: vi.fn(() => ({
      from: vi.fn((table: string) => {
        if (table === 'buses' || table === 'driver_status') return makeQueryChain(busRow);
        if (table === 'routes') return makeQueryChain(routesRow);
        // active_trips and everything else: return null (no existing data)
        return makeQueryChain(null);
      }),
      channel: vi.fn(() => channelMock),
      removeChannel: vi.fn(),
    })),
  };
});

vi.mock('@/lib/services/fcm-notification-service', () => ({
  notifyRoute: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/domains/assignment', () => ({
  getDriverUidByBusId: vi.fn().mockResolvedValue('d1'),
  getBusIdByDriverUid: vi.fn().mockResolvedValue('b1'),
}));

vi.mock('@/domains/gps', () => ({
  clearHistory: vi.fn(),
}));

vi.mock('@/lib/utils/shift-utils', () => ({
  normalizeShift: vi.fn((s: any) => {
    if (!s) return 'Morning';
    const n = String(s).toLowerCase().trim();
    if (n === 'both') return 'Both';
    if (n.includes('even')) return 'Evening';
    if (n.includes('morn')) return 'Morning';
    return 'Morning';
  }),
}));

import { startTrip, endTrip, getActiveTrip, canOperate, heartbeat } from '../services/trip.service';
import { tripLockService } from '@/lib/services/trip-lock-service';

describe('TripService', () => {
  it('startTrip accepts options object and returns tripId', async () => {
    const result = await startTrip({ driverId: 'd1', busId: 'b1', routeId: 'r1', shift: 'Morning' });
    expect(result.success).toBe(true);
    expect(result.tripId).toBe('t1');
    expect(tripLockService.startTrip).toHaveBeenCalled();
  }, 10000);

  it('startTrip without shift defaults to both', async () => {
    const result = await startTrip({ driverId: 'd1', busId: 'b1' });
    expect(result.success).toBe(true);
  }, 10000);

  it('endTrip accepts options object and returns success', async () => {
    const result = await endTrip({ driverId: 'd1', busId: 'b1', tripId: 't1' });
    expect(result.success).toBe(true);
    expect(tripLockService.endTrip).toHaveBeenCalled();
  }, 10000);

  it('endTrip without tripId resolves from active trip', async () => {
    const result = await endTrip({ driverId: 'd1', busId: 'b1' });
    expect(result.success).toBe(true);
  }, 10000);

  it('getActiveTrip still accepts busId', async () => {
    const result = await getActiveTrip('b1');
    expect(result).toEqual({ trip_id: 't1', bus_id: 'b1', status: 'active', driver_id: 'd1', route_id: 'r1' });
  });

  it('canOperate still accepts positional args', async () => {
    const result = await canOperate('d1', 'b1');
    expect(result.allowed).toBe(true);
  });

  it('heartbeat accepts options object', async () => {
    const result = await heartbeat({ driverId: 'd1', busId: 'b1', tripId: 't1' });
    expect(result.success).toBe(true);
  });
});
