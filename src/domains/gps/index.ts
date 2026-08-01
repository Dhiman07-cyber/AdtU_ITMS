export { checkActiveTrip } from './services/gps-persistence.service';
export { validateLocationUpdate } from './services/gps-validation.service';
export type { ValidationResult } from './services/gps-validation.service';
export {
	clearHistory,filterUpdate,getLastLocationForBus,processUpdate,validateLocation,validateUpdate
} from './services/gps.service';
export type {
	GPSCoordinate,GPSFilterResult,GPSLocation,GPSUpdate,
	LocationUpdate,
	LocationUpdateNormalized,
	PipelineResult
} from './services/types';

