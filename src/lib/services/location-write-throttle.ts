const MIN_BREADCRUMB_INTERVAL_MS = 60 * 1000;
const breadcrumbWriteCache = new Map<string, number>();

export function shouldWriteLocationBreadcrumb(tripId: string, nowMs: number): boolean {
  const lastWrite = breadcrumbWriteCache.get(tripId) || 0;

  if (nowMs - lastWrite < MIN_BREADCRUMB_INTERVAL_MS) {
    return false;
  }

  breadcrumbWriteCache.set(tripId, nowMs);
  if (breadcrumbWriteCache.size > 5000) {
    const firstKey = breadcrumbWriteCache.keys().next().value;
    if (firstKey) breadcrumbWriteCache.delete(firstKey);
  }

  return true;
}

export function clearTripBreadcrumbCache(tripId: string): void {
  breadcrumbWriteCache.delete(tripId);
}

// Heartbeat throttle: caps active_trips.last_heartbeat writes to 1 per bus per 45s.
// Lives here (not in the route file) so it's co-located with the breadcrumb throttle
// and easier to back with Redis if multi-worker sharing becomes necessary.
const MIN_HEARTBEAT_INTERVAL_MS = 45 * 1000;
const heartbeatWriteCache = new Map<string, number>();

export function shouldWriteHeartbeat(busId: string, nowMs: number): boolean {
  const last = heartbeatWriteCache.get(busId) || 0;
  if (nowMs - last < MIN_HEARTBEAT_INTERVAL_MS) return false;
  heartbeatWriteCache.set(busId, nowMs);
  if (heartbeatWriteCache.size > 1000) {
    const first = heartbeatWriteCache.keys().next().value;
    if (first) heartbeatWriteCache.delete(first);
  }
  return true;
}

export function clearHeartbeatCache(busId: string): void {
  heartbeatWriteCache.delete(busId);
}

