export { checkActiveTrip, setActiveTripCache, invalidateActiveTripCache, getPositiveTripLock, type PositiveTripLock } from './services/gps-persistence.service';
export { getRedisTripLock, getStudentTripFlagCount, incrementStudentTripFlagCount } from './services/gps-redis-guard';
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
	getBusIdVariations,
	isMatchingBusId,
} from './services/gps.service';
export type {
	GPSCoordinate,GPSFilterResult,GPSLocation,GPSUpdate,
	LocationUpdate,
	LocationUpdateNormalized,
	PipelineResult
} from './services/types';

