const MIN_BREADCRUMB_INTERVAL_MS = 30 * 1000;
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
