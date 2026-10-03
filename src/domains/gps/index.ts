export { checkActiveTrip } from './services/gps-persistence.service';
export {
	clearHistory,
	getLastLocationForBus,
	processUpdate,
} from './services/gps.service';
export type {
	GPSCoordinate,GPSFilterResult,GPSLocation,GPSUpdate,
	LocationUpdate,
	LocationUpdateNormalized,
	PipelineResult
} from './services/types';

