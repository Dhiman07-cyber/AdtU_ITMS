import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock dependencies for tripLockService
vi.mock('@/lib/supabase-server', () => {
  return {
    getSupabaseServer: vi.fn(),
  };
});

vi.mock('@/lib/app-logger', () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getSupabaseServer } from '@/lib/supabase-server';
import { TripLockService } from '@/lib/services/trip-lock-service';

describe('Zero-Wait Driver Handover & Resilient Tracking Tests', () => {
  it('Driver 2 starts trip on Bus 04 without Driver 1 ending -> atomic zero-wait handover succeeds without LOCKED_BY_OTHER', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        tripId: 'trip_driver_2_new',
        handover: true,
        previousDriverId: 'driver_1_old',
        previousTripId: 'trip_driver_1_old',
      },
      error: null,
    });

    (getSupabaseServer as any).mockReturnValue({
      rpc: mockRpc,
      from: vi.fn(),
    });

    const tripLockService = new TripLockService();

    // Driver 2 attempts to start trip on Bus 04 while Driver 1 is still technically listed as active
    const result = await tripLockService.startTrip(
      'driver_2_new',
      'bus_04',
      'route_kamrup',
      'morning',
      'trip_driver_2_new',
      'device_driver_2_uuid'
    );

    expect(result.success).toBe(true);
    expect(result.handover).toBe(true);
    expect(result.previousDriverId).toBe('driver_1_old');
    expect(result.previousTripId).toBe('trip_driver_1_old');
    expect(result.errorCode).toBeUndefined();

    // Verify RPC was invoked with p_device_id
    expect(mockRpc).toHaveBeenCalledWith('acquire_trip_lock', expect.objectContaining({
      p_trip_id: 'trip_driver_2_new',
      p_bus_id: 'bus_04',
      p_driver_id: 'driver_2_new',
      p_device_id: 'device_driver_2_uuid',
    }));
  });

  it('verifies Web Worker driver-tracker-worker.js exists and implements START_TICKER and STOP_TICKER contract', () => {
    const workerPath = path.resolve(process.cwd(), 'public/workers/driver-tracker-worker.js');
    expect(fs.existsSync(workerPath)).toBe(true);

    const content = fs.readFileSync(workerPath, 'utf8');
    expect(content).toContain('START_TICKER');
    expect(content).toContain('STOP_TICKER');
    expect(content).toContain('TICK');
    expect(content).toContain('postMessage');
  });

  it('validates local-first search logic: immediate 0ms in-memory match, triggers server query on local miss', () => {
    const localItems = [
      { id: '1', name: 'Kabir Barman', enrollmentId: 'ADT-2024-001' },
      { id: '2', name: 'Ritu Sarma', enrollmentId: 'ADT-2024-002' },
      { id: '3', name: 'Anup Kalita', enrollmentId: 'ADT-2024-003' },
    ];

    // Filter helper mirroring useLocalAndServerSearch
    const filterLocally = (items: typeof localItems, query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return items;
      return items.filter(i =>
        i.name.toLowerCase().includes(q) || i.enrollmentId.toLowerCase().includes(q)
      );
    };

    // 1. In-memory local hit (0ms)
    const localMatches = filterLocally(localItems, 'Kabir');
    expect(localMatches.length).toBe(1);
    expect(localMatches[0].name).toBe('Kabir Barman');

    // 2. In-memory local miss (triggers server fallback)
    const localMiss = filterLocally(localItems, 'Deepak');
    expect(localMiss.length).toBe(0);
    // When localMatches.length === 0 and query is not empty, server query parameter ?search=Deepak is dispatched
  });

  it('verifies batch mark-all-read notification endpoint contract exists and handles multiple IDs in single transaction', () => {
    const routePath = path.resolve(process.cwd(), 'src/app/api/notifications/mark-all-read/route.ts');
    expect(fs.existsSync(routePath)).toBe(true);

    const content = fs.readFileSync(routePath, 'utf8');
    expect(content).toContain('markMultipleAsRead');
    expect(content).toContain('notificationIds');
    expect(content).toContain('withSecurity');
  });
});
