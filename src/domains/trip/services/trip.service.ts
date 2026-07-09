/**
 * D9 TripService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: trip lifecycle management (start, end, heartbeat),
 * active trip queries, driver operation checks.
 *
 * ponytail: delegates entirely to existing production logic in
 * src/lib/services/trip-lock-service.ts (via tripRepository) — zero
 * behavior change. FCM notification dispatch and GPS tracking stay
 * internal to their respective modules, not part of the domain's public
 * capability surface.
 */
import * as tripRepository from '../repositories/trip.repository';
import type {
  CanOperateResult,
  StartTripResult,
  EndTripResult,
  HeartbeatResult,
} from '../repositories/trip.repository';

export async function canOperate(driverId: string, busId: string): Promise<CanOperateResult> {
  return tripRepository.canOperate(driverId, busId);
}

export async function startTrip(
  driverId: string,
  busId: string,
  routeId: string,
  shift: 'morning' | 'evening' | 'both',
  tripId: string,
): Promise<StartTripResult> {
  return tripRepository.startTrip(driverId, busId, routeId, shift, tripId);
}

export async function heartbeat(
  tripId: string,
  driverId: string,
  busId: string,
): Promise<HeartbeatResult> {
  return tripRepository.heartbeat(tripId, driverId, busId);
}

export async function endTrip(
  tripId: string,
  driverId: string,
  busId: string,
): Promise<EndTripResult> {
  return tripRepository.endTrip(tripId, driverId, busId);
}

export async function getActiveTrip(busId: string) {
  return tripRepository.getActiveTrip(busId);
}

export type { CanOperateResult, StartTripResult, EndTripResult, HeartbeatResult };
