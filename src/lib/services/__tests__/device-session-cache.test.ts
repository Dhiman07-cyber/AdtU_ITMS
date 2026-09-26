import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getCachedDeviceSession,
  setCachedDeviceSession,
  invalidateCachedDeviceSession,
} from '../device-session-cache';

describe('device-session-cache', () => {
  beforeEach(() => {
    invalidateCachedDeviceSession('driver-123');
    invalidateCachedDeviceSession('driver-456');
  });

  it('stores and retrieves cached device session within TTL', () => {
    const now = Date.now();
    setCachedDeviceSession('driver-123', 'device-abc', now);

    const cached = getCachedDeviceSession('driver-123');
    expect(cached).not.toBeNull();
    expect(cached?.deviceId).toBe('device-abc');
    expect(cached?.lastActiveAtMs).toBe(now);
  });

  it('returns null for nonexistent user', () => {
    const cached = getCachedDeviceSession('nonexistent-driver');
    expect(cached).toBeNull();
  });

  it('invalidates cache explicitly when invalidateCachedDeviceSession is called', () => {
    setCachedDeviceSession('driver-123', 'device-abc', Date.now());
    invalidateCachedDeviceSession('driver-123');

    const cached = getCachedDeviceSession('driver-123');
    expect(cached).toBeNull();
  });

  it('expires cached session when TTL (8000ms) has elapsed', () => {
    const originalNow = Date.now;
    let mockTime = 1000000;
    vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

    setCachedDeviceSession('driver-123', 'device-abc', mockTime);
    expect(getCachedDeviceSession('driver-123')).not.toBeNull();

    // Advance time past 8000ms TTL
    mockTime += 8001;
    expect(getCachedDeviceSession('driver-123')).toBeNull();

    vi.restoreAllMocks();
  });
});
