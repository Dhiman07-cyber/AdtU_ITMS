import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setActiveTripCache,
  getPositiveTripLock,
  invalidateActiveTripCache,
} from '../services/gps-persistence.service';

vi.mock('../services/gps-redis-guard', () => ({
  getRedisTripLock: vi.fn().mockResolvedValue(null),
  setRedisTripLock: vi.fn().mockResolvedValue(undefined),
  clearRedisTripLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/trip-snapshot-cache', () => ({
  invalidateBusTripSnapshot: vi.fn(),
}));

describe('Optimization 4: Positive Trip Lock & Device Session Coalescing', () => {
  beforeEach(() => {
    invalidateActiveTripCache();
    vi.clearAllMocks();
  });

  it('stores and retrieves driver device session inside the active trip lock in memory', () => {
    const expiresAt = Date.now() + 600_000;
    setActiveTripCache('bus_04', {
      tripId: 'trip_100',
      driverId: 'driver_01',
      routeId: 'route_1',
      deviceId: 'device_pixel_8',
      expiresAtMs: expiresAt,
    });

    const lock = getPositiveTripLock('driver_01', 'bus_04');
    expect(lock).not.toBeNull();
    expect(lock?.tripId).toBe('trip_100');
    expect(lock?.driverId).toBe('driver_01');
    expect(lock?.deviceId).toBe('device_pixel_8');
  });

  it('clears positive lock on invalidateActiveTripCache', () => {
    setActiveTripCache('bus_04', {
      tripId: 'trip_100',
      driverId: 'driver_01',
      deviceId: 'device_pixel_8',
      expiresAtMs: Date.now() + 600_000,
    });

    expect(getPositiveTripLock('driver_01', 'bus_04')).not.toBeNull();

    invalidateActiveTripCache('bus_04', 'driver_01');

    expect(getPositiveTripLock('driver_01', 'bus_04')).toBeNull();
  });
});
