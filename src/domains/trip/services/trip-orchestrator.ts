import type { CanOperateResult,HeartbeatResult } from '@/lib/services/trip-lock-service';
import { tripLockService } from '@/lib/services/trip-lock-service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { appLogger } from '@/lib/logger';
import { ErrorClass } from '@/lib/error-classes';
import { normalizeShift } from '@/lib/utils/shift-utils';
import crypto from 'crypto';
import { broadcastTripEvent } from './trip-broadcast.service';
import { cleanupTrip } from './trip-cleanup.service';
import { dispatchTripNotification } from './trip-notification.service';
import { checkNoConflict,resolveRouteId,resolveRouteName,verifyDriverBusAssignment } from './trip-validation.service';

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
  const start = Date.now();
  const tripShift = (normalizeShift(params.shift).toLowerCase() as ShiftLower) || 'both';
  const logCtx = { driverId: params.driverId, busId: params.busId };

  const assignment = await verifyDriverBusAssignment(params.driverId, params.busId);
  if (!assignment.authorized) {
    appLogger.warn('trip', 'start_rejected', { ...logCtx, reason: assignment.reason, errorClass: ErrorClass.TRIP_VALIDATION_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: assignment.reason, errorCode: 'VALIDATION_ERROR' };
  }

  const conflict = await checkNoConflict(params.busId, params.driverId);
  if (conflict.conflict) {
    appLogger.warn('trip', 'start_rejected', { ...logCtx, reason: conflict.reason, errorClass: ErrorClass.TRIP_LOCK_CONFLICT, latencyMs: Date.now() - start });
    return { success: false, reason: conflict.reason, errorCode: 'LOCKED_BY_OTHER' };
  }
  if (conflict.existingTripId) {
    const routeId = await resolveRouteId(params.busId, params.routeId);
    appLogger.info('trip', 'start_idempotent', { ...logCtx, tripId: conflict.existingTripId, routeId, latencyMs: Date.now() - start });
    return { success: true, tripId: conflict.existingTripId, routeId, shift: tripShift };
  }

  const effectiveRouteId = await resolveRouteId(params.busId, params.routeId);
  const tripId = params.tripId || crypto.randomUUID();

  const lockResult = await tripLockService.startTrip(params.driverId, params.busId, effectiveRouteId, tripShift, tripId);
  if (!lockResult.success) {
    appLogger.error('trip', 'start_failed', { ...logCtx, tripId, routeId: effectiveRouteId, reason: lockResult.reason, errorClass: ErrorClass.TRIP_LOCK_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: lockResult.reason, errorCode: lockResult.errorCode };
  }

  const activeTripId = lockResult.tripId || tripId;
  const busData = assignment.busData;
  const busNumber = busData?.bus_number || params.busId;
  const routeName = await resolveRouteName(effectiveRouteId);

  if (!lockResult.alreadyActive) {
    appLogger.info('trip', 'started', { ...logCtx, tripId: activeTripId, routeId: effectiveRouteId, shift: tripShift, latencyMs: Date.now() - start });
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
  }

  return { success: true, tripId: activeTripId, routeId: effectiveRouteId, shift: tripShift };
}

export async function endTrip(params: EndTripParams): Promise<EndTripOutput> {
  const start = Date.now();
  const supabase = getSupabaseServer();
  const logCtx = { driverId: params.driverId, busId: params.busId, tripId: params.tripId };

  let activeTripId = params.tripId;
  let routeId = '';
  let routeName = 'your route';

  const activeTrip = await tripLockService.getActiveTrip(params.busId);
  if (activeTrip) {
    if (activeTrip.driver_id !== params.driverId) {
      appLogger.warn('trip', 'end_rejected', { ...logCtx, reason: 'ownership_denied', errorClass: ErrorClass.TRIP_OWNERSHIP_DENIED, latencyMs: Date.now() - start });
      return { success: false, reason: 'Only the assigned driver can end this trip' };
    }
    if (activeTripId && activeTripId !== activeTrip.trip_id) {
      appLogger.warn('trip', 'end_rejected', { ...logCtx, reason: 'trip_mismatch', errorClass: ErrorClass.TRIP_NOT_FOUND, latencyMs: Date.now() - start });
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
    appLogger.info('trip', 'end_noop', { ...logCtx, reason: 'no_active_trip', latencyMs: Date.now() - start });
    return { success: true, reason: 'No active trip found' };
  }

  const endResult = await tripLockService.endTrip(activeTripId, params.driverId, params.busId);
  if (!endResult.success) {
    appLogger.error('trip', 'end_failed', { ...logCtx, tripId: activeTripId, reason: endResult.reason, errorClass: ErrorClass.TRIP_LOCK_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: endResult.reason };
  }

  await cleanupTrip({ driverId: params.driverId, busId: params.busId, tripId: activeTripId });

  const { data: busData } = await supabase
    .from('buses')
    .select('bus_number')
    .eq('id', params.busId)
    .maybeSingle();

  appLogger.info('trip', 'ended', { ...logCtx, tripId: activeTripId, routeId, latencyMs: Date.now() - start });

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

export type { CanOperateResult,EndTripResult,HeartbeatResult,StartTripResult } from '@/lib/services/trip-lock-service';
