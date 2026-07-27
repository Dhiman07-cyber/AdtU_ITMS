import type { LocationUpdate } from './types';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export async function validateLocationUpdate(update: LocationUpdate): Promise<ValidationResult> {
  if (!update.busId) return { valid: false, reason: 'busId is required' };
  if (typeof update.lat !== 'number' || isNaN(update.lat)) return { valid: false, reason: 'Invalid latitude' };
  if (typeof update.lng !== 'number' || isNaN(update.lng)) return { valid: false, reason: 'Invalid longitude' };
  if (update.lat < -90 || update.lat > 90) return { valid: false, reason: 'Latitude out of range' };
  if (update.lng < -180 || update.lng > 180) return { valid: false, reason: 'Longitude out of range' };

  if (update.speed !== undefined && (typeof update.speed !== 'number' || update.speed < 0)) {
    return { valid: false, reason: 'Invalid speed' };
  }
  if (update.heading !== undefined && (typeof update.heading !== 'number' || update.heading < 0 || update.heading > 360)) {
    return { valid: false, reason: 'Invalid heading' };
  }

  return { valid: true };
}
