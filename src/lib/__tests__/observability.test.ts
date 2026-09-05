/**
 * Observability Tests — Phase 05
 *
 * Verifies that structured logging, error classification, and metrics
 * instrumentation behave correctly. Tests inject failures and assert
 * that logs are emitted with the correct fields.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Ensure INFO-level logs are emitted (default in test env is WARN which drops INFO).
process.env.LOG_LEVEL = 'INFO';

// ─── App Logger Format ────────────────────────────────────────────────────────

describe('App Logger — Structured Output', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('info log emits JSON with required fields', async () => {
    const { appLogger } = await import('@/lib/logger');
    appLogger.info('gps', 'location_accepted', { busId: 'bus-1', tripId: 'trip-1' });
    expect(consoleSpy).toHaveBeenCalledOnce();
    const entry = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      level: 'info',
      component: 'gps',
      op: 'location_accepted',
      busId: 'bus-1',
      tripId: 'trip-1',
    });
    expect(entry.timestamp).toBeTruthy();
  });

  it('warn log writes to console.warn', async () => {
    const { appLogger } = await import('@/lib/logger');
    appLogger.warn('trip', 'start_rejected', { reason: 'lock_conflict' });
    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    const entry = JSON.parse(consoleWarnSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe('warn');
    expect(entry.component).toBe('trip');
  });

  it('error log writes to console.error', async () => {
    const { appLogger } = await import('@/lib/logger');
    appLogger.error('gps', 'persist_failed', { errorClass: 'GPS_PERSIST_FAILED' });
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const entry = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe('error');
    expect(entry.errorClass).toBe('GPS_PERSIST_FAILED');
  });

  it('log entries are valid JSON (not concatenated strings)', async () => {
    const { appLogger } = await import('@/lib/logger');
    appLogger.info('test', 'op', { key: 'value with "quotes"', num: 42 });
    const raw = consoleSpy.mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ─── Error Classification — Exhaustive Coverage ───────────────────────────────

describe('Error Classification — ErrorClass', () => {
  it('all error class values are non-empty strings', async () => {
    const { ErrorClass } = await import('@/lib/error-classes');
    for (const [, value] of Object.entries(ErrorClass)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('GPS error classes are distinct', async () => {
    const { ErrorClass } = await import('@/lib/error-classes');
    const gpsClasses = [
      ErrorClass.GPS_NULL_ISLAND,
      ErrorClass.GPS_INVALID_COORDINATES,
      ErrorClass.GPS_OUT_OF_ORDER,
      ErrorClass.GPS_JUMP_TOO_LARGE,
      ErrorClass.GPS_SPEED_EXCEEDED,
      ErrorClass.GPS_NO_ACTIVE_TRIP,
      ErrorClass.GPS_PERSIST_FAILED,
      ErrorClass.GPS_DUPLICATE_TIMESTAMP,
    ];
    const unique = new Set(gpsClasses);
    expect(unique.size).toBe(gpsClasses.length);
  });

  it('trip error classes are distinct', async () => {
    const { ErrorClass } = await import('@/lib/error-classes');
    const tripClasses = [
      ErrorClass.TRIP_LOCK_CONFLICT,
      ErrorClass.TRIP_LOCK_FAILED,
      ErrorClass.TRIP_VALIDATION_FAILED,
      ErrorClass.TRIP_NOT_FOUND,
      ErrorClass.TRIP_OWNERSHIP_DENIED,
      ErrorClass.TRIP_HEARTBEAT_FAILED,
    ];
    const unique = new Set(tripClasses);
    expect(unique.size).toBe(tripClasses.length);
  });

  it('auth error classes are distinct', async () => {
    const { ErrorClass } = await import('@/lib/error-classes');
    const authClasses = [
      ErrorClass.AUTH_TOKEN_MISSING,
      ErrorClass.AUTH_TOKEN_EXPIRED,
      ErrorClass.AUTH_TOKEN_INVALID,
      ErrorClass.AUTH_ROLE_DENIED,
      ErrorClass.AUTH_ADMIN_UNAVAILABLE,
    ];
    const unique = new Set(authClasses);
    expect(unique.size).toBe(authClasses.length);
  });

  it('all error class keys match their values (screaming_snake casing)', async () => {
    const { ErrorClass } = await import('@/lib/error-classes');
    for (const [key, value] of Object.entries(ErrorClass)) {
      expect(key).toBe(value);
    }
  });
});

// ─── GPS Pipeline — Observability Integration ─────────────────────────────────

describe('GPS Pipeline — Structured Log Emission on Rejection', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('emits structured warn log when (0,0) GPS coordinates are rejected', async () => {
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

    const { processLocationUpdate } = await import('@/domains/gps/services/gps-pipeline.service');

    const result = await processLocationUpdate({
      driverId: 'd1', busId: 'b1', tripId: 't1', routeId: 'r1',
      lat: 0, lng: 0, timestamp: new Date().toISOString(),
    });

    expect(result.accepted).toBe(false);
    // At least one warn should have been emitted
    expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
    const logEntry = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logEntry.component).toBe('gps');
    expect(logEntry.op).toBe('location_rejected');
    expect(logEntry.errorClass).toBe('GPS_NULL_ISLAND');
  });
});
