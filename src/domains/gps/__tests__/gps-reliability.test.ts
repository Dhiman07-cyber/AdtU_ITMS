/**
 * GPS Reliability Failure Tests — Phase 04
 *
 * Actively injects GPS failure modes and asserts deterministic rejection.
 * Does not mock success — every test verifies a real failure path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock persistence layer — tests focus on pipeline validation logic only
vi.mock('@/domains/gps/services/gps-persistence.service', () => ({
  checkActiveTrip: vi.fn().mockResolvedValue({ valid: true }),
  getLastLocation: vi.fn().mockResolvedValue(null),
  persistLocation: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/security/location-validation-service', () => {
  function LocationValidationService() {}
  LocationValidationService.prototype.validateLocation = () => ({ valid: true, reasons: [] });
  LocationValidationService.prototype.clearHistory = () => {};
  return { LocationValidationService };
});

import { processLocationUpdate } from '../services/gps-pipeline.service';
import * as persistence from '../services/gps-persistence.service';

const base = {
  driverId: 'driver-1',
  busId: 'bus-1',
  tripId: 'trip-1',
  routeId: 'route-1',
  lat: 12.9716,
  lng: 77.5946,
  timestamp: new Date().toISOString(),
};

describe('GPS Reliability — Coordinate Validation', () => {
  it('rejects null island coordinates (0,0) — GPS fix not acquired', async () => {
    const result = await processLocationUpdate({ ...base, lat: 0, lng: 0 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/null island/i);
  });

  it('rejects NaN latitude', async () => {
    const result = await processLocationUpdate({ ...base, lat: NaN, lng: 77.5946 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/latitude and longitude/i);
  });

  it('rejects coordinates out of global range', async () => {
    const result = await processLocationUpdate({ ...base, lat: 95, lng: 77.5946 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/out of range/i);
  });

  it('rejects speed exceeding 200 km/h', async () => {
    const result = await processLocationUpdate({ ...base, speed: 250 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/speed/i);
  });

  it('accepts valid coordinates with no prior location', async () => {
    vi.mocked(persistence.getLastLocation).mockResolvedValueOnce(null);
    const result = await processLocationUpdate(base);
    expect(result.accepted).toBe(true);
  });
});

describe('GPS Reliability — Timestamp Ordering', () => {
  const lastLocation = {
    lat: '12.9716',
    lng: '77.5946',
    timestamp: new Date(Date.now() - 5000).toISOString(), // 5s ago
  };

  beforeEach(() => {
    vi.mocked(persistence.getLastLocation).mockResolvedValue(lastLocation as any);
  });

  it('rejects out-of-order GPS packet (timestamp older than last accepted)', async () => {
    const staleTime = new Date(Date.now() - 10000).toISOString(); // 10s ago — older than last
    const result = await processLocationUpdate({ ...base, timestamp: staleTime });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/out-of-order/i);
  });

  it('rejects duplicate timestamp with significant coordinate jump', async () => {
    const sameTime = lastLocation.timestamp; // exact same timestamp
    const result = await processLocationUpdate({
      ...base,
      lat: 12.9725,
      lng: 77.5946,
      timestamp: sameTime,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/duplicate timestamp/i);
  });

  it('accepts duplicate timestamp with same coordinates (idempotent packet)', async () => {
    vi.mocked(persistence.persistLocation).mockResolvedValueOnce(true);
    const result = await processLocationUpdate({
      ...base,
      lat: 12.9716,
      lng: 77.5946,
      timestamp: lastLocation.timestamp,
    });
    expect(result.accepted).toBe(true);
  });

  it('rejects location jump > 5000m', async () => {
    const result = await processLocationUpdate({
      ...base,
      lat: 13.1716, // ~22km north
      lng: 77.5946,
      timestamp: new Date().toISOString(),
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/jump too large/i);
  });
});
