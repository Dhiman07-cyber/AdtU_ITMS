import { tripLockService } from '@/lib/services/trip-lock-service';
import type { CanOperateResult, HeartbeatResult } from '@/lib/services/trip-lock-service';
import { normalizeShift } from '@/lib/utils/shift-utils';
import { broadcastTripEvent } from './trip-broadcast.service';
import { dispatchTripNotification } from './trip-notification.service';
import { cleanupTrip } from './trip-cleanup.service';
import { verifyDriverBusAssignment, checkNoConflict, resolveRouteId, resolveRouteName } from './trip-validation.service';
import { getSupabaseServer } from '@/lib/supabase-server';
import crypto from 'crypto';

type ShiftLower = 'morning' | 'evening' | 'both';

export interface StartTripParams {
  driverId: string;
  busId: string;
  routeId?: string;
  shift?: string;
  tripId?: string;
}

export interface StartTripOutput {
  success: boolean;
  tripId?: string;
  routeId?: string;
  reason?: string;
  errorCode?: string;
  shift?: ShiftLower;
}

export interface EndTripParams {
  driverId: string;
  busId: string;
  tripId?: string;
}

export interface EndTripOutput {
  success: boolean;
  tripId?: string;
  reason?: string;
}

export interface HeartbeatParams {
  driverId: string;
  busId: string;
  tripId: string;
}

export async function startTrip(params: StartTripParams): Promise<StartTripOutput> {
  const tripShift = (normalizeShift(params.shift).toLowerCase() as ShiftLower) || 'both';

  const assignment = await verifyDriverBusAssignment(params.driverId, params.busId);
  if (!assignment.authorized) {
    return { success: false, reason: assignment.reason, errorCode: 'VALIDATION_ERROR' };
  }

  const conflict = await checkNoConflict(params.busId, params.driverId);
  if (conflict.conflict) {
    return { success: false, reason: conflict.reason, errorCode: 'LOCKED_BY_OTHER' };
  }
  if (conflict.existingTripId) {
    const routeId = await resolveRouteId(params.busId, params.routeId);
    return { success: true, tripId: conflict.existingTripId, routeId, shift: tripShift };
  }

  const effectiveRouteId = await resolveRouteId(params.busId, params.routeId);
  const tripId = params.tripId || crypto.randomUUID();

  const lockResult = await tripLockService.startTrip(params.driverId, params.busId, effectiveRouteId, tripShift, tripId);
  if (!lockResult.success) {
    return { success: false, reason: lockResult.reason, errorCode: lockResult.errorCode };
  }

  const activeTripId = lockResult.tripId || tripId;
  const busData = assignment.busData;
  const busNumber = busData?.bus_number || params.busId;
  const routeName = await resolveRouteName(effectiveRouteId);

  broadcastTripEvent({
    busId: params.busId,
    tripId: activeTripId,
    event: 'trip_started',
    driverId: params.driverId,
    routeId: effectiveRouteId,
    shift: tripShift,
    busNumber,
  });

  dispatchTripNotification({
    routeId: effectiveRouteId,
    tripId: activeTripId,
    routeName,
    busId: params.busId,
    eventType: 'TRIP_STARTED',
  });

  return { success: true, tripId: activeTripId, routeId: effectiveRouteId, shift: tripShift };
}

export async function endTrip(params: EndTripParams): Promise<EndTripOutput> {
  const supabase = getSupabaseServer();

  let activeTripId = params.tripId;
  let routeId = '';
  let routeName = 'your route';

  const activeTrip = await tripLockService.getActiveTrip(params.busId);
  if (activeTrip) {
    if (activeTrip.driver_id !== params.driverId) {
      return { success: false, reason: 'Only the assigned driver can end this trip' };
    }
    if (activeTripId && activeTripId !== activeTrip.trip_id) {
      return { success: false, reason: 'Trip mismatch for this bus' };
    }
    if (!activeTripId) activeTripId = activeTrip.trip_id;
    routeId = activeTrip.route_id || '';
  } else {
    const { data: busData } = await supabase
      .from('buses')
      .select('route_id, route_name')
      .eq('id', params.busId)
      .maybeSingle();
    if (busData) {
      routeId = busData.route_id || '';
      routeName = busData.route_name || 'your route';
    }
  }

  if (routeId) {
    const resolvedName = await resolveRouteName(routeId);
    if (resolvedName !== routeId) routeName = resolvedName;
  }

  if (!activeTripId) {
    return { success: true, reason: 'No active trip found' };
  }

  const endResult = await tripLockService.endTrip(activeTripId, params.driverId, params.busId);
  if (!endResult.success) {
    return { success: false, reason: endResult.reason };
  }

  await cleanupTrip({ driverId: params.driverId, busId: params.busId, tripId: activeTripId });

  const { data: busData } = await supabase
    .from('buses')
    .select('bus_number')
    .eq('id', params.busId)
    .maybeSingle();

  broadcastTripEvent({
    busId: params.busId,
    tripId: activeTripId,
    event: 'trip_ended',
    busNumber: busData?.bus_number || params.busId,
  });

  dispatchTripNotification({
    routeId: routeId || 'unassigned_route',
    tripId: activeTripId,
    routeName,
    busId: params.busId,
    eventType: 'TRIP_ENDED',
  });

  return { success: true, tripId: activeTripId };
}

export async function heartbeat(params: HeartbeatParams): Promise<HeartbeatResult> {
  return tripLockService.heartbeat(params.tripId, params.driverId, params.busId);
}

export async function canOperate(driverId: string, busId: string): Promise<CanOperateResult> {
  return tripLockService.canOperate(driverId, busId);
}

export async function getActiveTrip(busId: string) {
  return tripLockService.getActiveTrip(busId);
}

export type { CanOperateResult, StartTripResult, EndTripResult, HeartbeatResult } from '@/lib/services/trip-lock-service';
