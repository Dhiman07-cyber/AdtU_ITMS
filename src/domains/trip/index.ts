// D9 Trip — public surface. Only this file may be imported by other domains.
//
// Trip operations only. Heartbeat, lock checks, and GPS plumbing
// remain internal implementation details.
export {
  startTrip,
  endTrip,
  getActiveTrip,
} from './services/trip.service';
export type {
  StartTripResult,
  EndTripResult,
} from './services/trip.service';
