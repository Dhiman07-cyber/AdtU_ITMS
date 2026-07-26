export {
  validateLocation,
  filterUpdate,
  clearHistory,
  processUpdate,
  validateUpdate,
} from './services/gps.service';
export type {
  GPSLocation,
  GPSFilterResult,
  GPSCoordinate,
  GPSUpdate,
  LocationUpdate,
  LocationUpdateNormalized,
  PipelineResult,
} from './services/types';
export { validateLocationUpdate } from './services/gps-validation.service';
export type { ValidationResult } from './services/gps-validation.service';
export { persistLocation, checkActiveTrip, getLastLocation } from './services/gps-persistence.service';
