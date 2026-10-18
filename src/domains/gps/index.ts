export { checkActiveTrip, setActiveTripCache, invalidateActiveTripCache, getPositiveTripLock, type PositiveTripLock } from './services/gps-persistence.service';
export { getRedisTripLock } from './services/gps-redis-guard';
export {
	clearHistory,
	getLastLocationForBus,
	getLastLocationForBusAsync,
	getGpsStateFromRedis,
	processUpdate,
	trackStopDwell,
	flushStopDwellOnTripEnd,
	clearStopDwellState,
	getActiveDwellState,
} from './services/gps.service';
export type {
	GPSCoordinate,GPSFilterResult,GPSLocation,GPSUpdate,
	LocationUpdate,
	LocationUpdateNormalized,
	PipelineResult
} from './services/types';

