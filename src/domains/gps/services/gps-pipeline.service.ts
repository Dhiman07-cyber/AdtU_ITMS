import { LocationValidationService } from '@/lib/security/location-validation-service';
import { normalizeLocationUpdate } from './gps-normalizer.service';
import { persistLocation, checkActiveTrip, getLastLocation } from './gps-persistence.service';
import type { LocationUpdate, LocationUpdateNormalized, PipelineResult, LastLocation } from './types';

const validator = new LocationValidationService();

const MAX_SPEED_KMH = 200;
const MAX_JUMP_METERS = 5000;
const MAX_ACCURACY_METERS = 1000;

function validateBounds(n: LocationUpdateNormalized): string | null {
  if (!Number.isFinite(n.lat) || !Number.isFinite(n.lng)) return 'Valid latitude and longitude are required';
  if (n.lat < -90 || n.lat > 90 || n.lng < -180 || n.lng > 180) return 'Coordinates are out of range';
  if (n.speed !== null && (n.speed < 0 || n.speed > MAX_SPEED_KMH)) return `Speed exceeds limit (${MAX_SPEED_KMH} km/h)`;
  if (n.heading !== null && (n.heading < 0 || n.heading > 360)) return 'Heading is out of range';
  if (n.accuracy !== null && (n.accuracy < 0 || n.accuracy > MAX_ACCURACY_METERS)) return 'Accuracy is out of range';
  return null;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateJump(n: LocationUpdateNormalized, last: LastLocation): string | null {
  const lastTime = new Date(last.timestamp).getTime();
  const timeDiff = (n.timestamp.getTime() - lastTime) / 1000;

  if (timeDiff <= 0) return null;

  const distance = haversine(Number(last.lat), Number(last.lng), n.lat, n.lng);

  if (distance > MAX_JUMP_METERS) return `Location jump too large (${Math.round(distance)}m)`;

  if (distance > 100 && timeDiff > 0.5) {
    const calculatedSpeedMps = distance / timeDiff;
    const maxSpeedMps = MAX_SPEED_KMH / 3.6;
    if (calculatedSpeedMps > maxSpeedMps) {
      const calculatedKmh = Math.round(calculatedSpeedMps * 3.6);
      return `Calculated speed ${calculatedKmh} km/h exceeds limit (${MAX_SPEED_KMH} km/h)`;
    }
  }

  return null;
}

export async function processLocationUpdate(raw: LocationUpdate): Promise<PipelineResult> {
  const normalized = normalizeLocationUpdate(raw);

  const boundsError = validateBounds(normalized);
  if (boundsError) return { accepted: false, reason: boundsError, normalized };

  const session = await checkActiveTrip(normalized.driverId, normalized.busId, normalized.tripId);
  if (!session.valid) return { accepted: false, reason: session.reason, normalized };

  const lastLoc = await getLastLocation(normalized.busId, normalized.tripId);
  if (lastLoc) {
    const jumpError = validateJump(normalized, lastLoc);
    if (jumpError) return { accepted: false, reason: jumpError, normalized };
  }

  const persisted = await persistLocation(normalized);
  if (!persisted) return { accepted: false, reason: 'Failed to persist location', normalized };

  return { accepted: true, normalized, persisted: true };
}

export async function processLocationUpdateSimple(raw: LocationUpdate): Promise<PipelineResult> {
  const normalized = normalizeLocationUpdate(raw);

  const boundsError = validateBounds(normalized);
  if (boundsError) return { accepted: false, reason: boundsError, normalized };

  return { accepted: true, normalized };
}
