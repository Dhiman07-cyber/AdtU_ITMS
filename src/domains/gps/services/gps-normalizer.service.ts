import type { LocationUpdate,LocationUpdateNormalized } from './types';

const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

export function normalizeLocationUpdate(raw: LocationUpdate): LocationUpdateNormalized {
  return {
    driverId: raw.driverId,
    tripId: raw.tripId,
    busId: raw.busId,
    routeId: raw.routeId,
    lat: roundTo(raw.lat, 6),
    lng: roundTo(raw.lng, 6),
    accuracy: raw.accuracy != null && Number.isFinite(raw.accuracy) ? raw.accuracy : null,
    heading: raw.heading != null && Number.isFinite(raw.heading) ? raw.heading : null,
    speed: raw.speed != null && Number.isFinite(raw.speed) ? raw.speed : null,
    altitude: raw.altitude != null && Number.isFinite(raw.altitude) ? raw.altitude : null,
    timestamp: normalizeTimestamp(raw.timestamp),
    provider: raw.provider || 'unknown',
    battery: raw.battery != null && Number.isFinite(raw.battery) ? raw.battery : null,
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function normalizeTimestamp(raw: string | number | Date | undefined | null): Date {
  const serverNow = new Date();
  if (!raw) return serverNow;

  const candidate = new Date(raw);
  if (Number.isNaN(candidate.getTime())) return serverNow;

  const skewMs = Math.abs(candidate.getTime() - serverNow.getTime());
  return skewMs <= MAX_CLOCK_SKEW_MS ? candidate : serverNow;
}
