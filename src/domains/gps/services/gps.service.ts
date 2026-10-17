import { LocationValidationService } from '@/lib/security/location-validation-service';
import { processLocationUpdate,processLocationUpdateSimple } from './gps-pipeline.service';
import type { GPSFilterResult,GPSLocation,LocationUpdate,PipelineResult } from './types';

const validator = new LocationValidationService();

export function clearHistory(userId: string): void {
  validator.clearHistory(userId);
}

export async function processUpdate(raw: LocationUpdate): Promise<PipelineResult> {
  return processLocationUpdate(raw);
}

export { getLastLocationForBus, getLastLocationForBusAsync } from './gps-pipeline.service';
export { getGpsStateFromRedis } from './gps-redis-guard';
export type { GPSFilterResult,GPSLocation,LocationUpdate,PipelineResult };
