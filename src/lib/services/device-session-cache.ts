/**
 * In-memory short-lived cache for active driver device sessions.
 * At 2s GPS update intervals with dozens of active drivers,
 * this prevents 25-50 repetitive PostgreSQL queries per second.
 *
 * Cache entries expire in 8 seconds (well below the 30s session timeout window).
 * Cache entries can also be invalidated immediately on explicit session registration/termination.
 */
export interface CachedDeviceSession {
  deviceId: string;
  lastActiveAtMs: number;
  cachedAtMs: number;
}

const sessionCache = new Map<string, CachedDeviceSession>();
const CACHE_TTL_MS = 8000;

export function getCachedDeviceSession(userId: string): CachedDeviceSession | null {
  const cached = sessionCache.get(userId);
  if (!cached) return null;
  if (Date.now() - cached.cachedAtMs > CACHE_TTL_MS) {
    sessionCache.delete(userId);
    return null;
  }
  return cached;
}

export function setCachedDeviceSession(userId: string, deviceId: string, lastActiveAtMs: number): void {
  sessionCache.set(userId, {
    deviceId,
    lastActiveAtMs,
    cachedAtMs: Date.now(),
  });
}

export function invalidateCachedDeviceSession(userId: string): void {
  sessionCache.delete(userId);
}
