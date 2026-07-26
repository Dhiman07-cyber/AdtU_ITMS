import { LocationValidationService } from '@/lib/security/location-validation-service';
import type { GPSLocation, GPSFilterResult, LocationUpdate, PipelineResult } from './types';
import { processLocationUpdate, processLocationUpdateSimple } from './gps-pipeline.service';

const validator = new LocationValidationService();

function toServiceLocation(loc: GPSLocation) {
  return {
    lat: loc.lat,
    lng: loc.lng,
    timestamp: loc.timestamp,
    accuracy: loc.accuracy,
    speed: loc.speed,
    heading: loc.heading,
    altitude: loc.altitude,
    source: loc.source,
  };
}

function toFilterResult(r: { valid: boolean; reasons: string[] }): GPSFilterResult {
  if (!r.valid) return { valid: false, reason: r.reasons.join('; ') };
  if (r.reasons.length > 0) return { valid: true, reason: r.reasons.join('; ') };
  return { valid: true };
}

export async function validateLocation(userId: string, location: GPSLocation): Promise<GPSFilterResult> {
  const result = validator.validateLocation(userId, toServiceLocation(location));
  return toFilterResult(result);
}

export async function filterUpdate(userId: string, current: GPSLocation): Promise<GPSFilterResult> {
  const result = validator.validateLocation(userId, toServiceLocation(current));
  return toFilterResult(result);
}

export function clearHistory(userId: string): void {
  validator.clearHistory(userId);
}

export async function processUpdate(raw: LocationUpdate): Promise<PipelineResult> {
  return processLocationUpdate(raw);
}

export async function validateUpdate(raw: LocationUpdate): Promise<PipelineResult> {
  return processLocationUpdateSimple(raw);
}

export type { GPSLocation, GPSFilterResult, LocationUpdate, PipelineResult };
