/**
 * D9 Trip Repository
 *
 * Persistence only — no business logic. Wraps the existing trip lock service
 * which manages dual-storage (Firestore locks + Supabase active_trips).
 *
 * ponytail: src/lib/services/trip-lock-service.ts already implements the
 * complete trip lifecycle (start, heartbeat, end, canOperate, getActiveTrip)
 * with distributed locking, idempotency, and heartbeat recovery — wrapped
 * by reference, not reimplemented.
 */
import type {
	ActiveTripLock,
	CanOperateResult,
	EndTripResult,
	HeartbeatResult,
	StartTripResult,
} from '@/lib/services/trip-lock-service';
import { tripLockService } from '@/lib/services/trip-lock-service';

export async function canOperate(driverId: string, busId: string): Promise<CanOperateResult> {
  return tripLockService.canOperate(driverId, busId);
}

export async function startTrip(
  driverId: string,
  busId: string,
  routeId: string,
  shift: 'morning' | 'evening' | 'both',
  tripId: string,
): Promise<StartTripResult> {
  return tripLockService.startTrip(driverId, busId, routeId, shift, tripId);
}

export async function heartbeat(
  tripId: string,
  driverId: string,
  busId: string,
): Promise<HeartbeatResult> {
  return tripLockService.heartbeat(tripId, driverId, busId);
}

export async function endTrip(
  tripId: string,
  driverId: string,
  busId: string,
): Promise<EndTripResult> {
  return tripLockService.endTrip(tripId, driverId, busId);
}

export async function getActiveTrip(busId: string) {
  return tripLockService.getActiveTrip(busId);
}

export type { ActiveTripLock,CanOperateResult,EndTripResult,HeartbeatResult,StartTripResult };
