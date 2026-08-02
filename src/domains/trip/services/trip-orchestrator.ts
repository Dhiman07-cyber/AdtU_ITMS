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
import { checkNoConflict,resolveRouteId,resolveRouteName,tripStartPreflight,verifyDriverBusAssignment } from './trip-validation.service';
import { invalidateActiveTripCache } from '@/domains/gps/services/gps-persistence.service';
import { clearInMemoryLastLocation } from '@/domains/gps/services/gps-pipeline.service';

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
  const normalized = normalizeShift(params.shift);
  if (!normalized) {
    return { success: false, reason: 'Invalid or missing trip shift parameters', errorCode: 'VALIDATION_ERROR' };
  }
  const tripShift = normalized.toLowerCase() as ShiftLower;
  const logCtx = { driverId: params.driverId, busId: params.busId };

  // Single preflight: fires buses + active_trips in parallel (replaces 3 serial DB calls)
  const preflight = await tripStartPreflight(params.driverId, params.busId);
  if (!preflight.authorized) {
    const errorCode = preflight.conflict ? 'LOCKED_BY_OTHER' : 'VALIDATION_ERROR';
    const errorClass = preflight.conflict ? ErrorClass.TRIP_LOCK_CONFLICT : ErrorClass.TRIP_VALIDATION_FAILED;
    appLogger.warn('trip', 'start_rejected', { ...logCtx, reason: preflight.reason, errorClass, latencyMs: Date.now() - start });
    return { success: false, reason: preflight.reason, errorCode };
  }

  let effectiveRouteId: string;
  let routeName: string;
  try {
    // Use route_id already fetched from preflight busData when available
    const rawRouteId = params.routeId || preflight.busData?.route_id || null;
    if (!rawRouteId) throw new Error(`Bus ${params.busId} is not assigned to a valid route.`);
    effectiveRouteId = rawRouteId;
    routeName = await resolveRouteName(effectiveRouteId);
  } catch (routeErr: any) {
    appLogger.warn('trip', 'start_rejected', { ...logCtx, reason: routeErr.message, errorClass: ErrorClass.TRIP_VALIDATION_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: routeErr?.message || 'Route assignment validation failed', errorCode: 'VALIDATION_ERROR' };
  }

  const conflict = preflight;

  if (conflict.existingTripId) {
    appLogger.info('trip', 'start_idempotent', { ...logCtx, tripId: conflict.existingTripId, routeId: effectiveRouteId, latencyMs: Date.now() - start });
    return { success: true, tripId: conflict.existingTripId, routeId: effectiveRouteId, shift: tripShift };
  }

  const tripId = params.tripId || crypto.randomUUID();

  const lockResult = await tripLockService.startTrip(params.driverId, params.busId, effectiveRouteId, tripShift, tripId);
  if (!lockResult.success) {
    appLogger.error('trip', 'start_failed', { ...logCtx, tripId, routeId: effectiveRouteId, reason: lockResult.reason, errorClass: ErrorClass.TRIP_LOCK_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: lockResult.reason, errorCode: lockResult.errorCode };
  }

  // Drop any cached trip-lock entries for this driver/bus — the GPS pipeline's
  // 10s checkActiveTrip cache would otherwise reject (trip mismatch) or accept
  // updates against the previous trip after a quick restart.
  invalidateActiveTripCache(params.busId, params.driverId);

  const activeTripId = lockResult.tripId || tripId;
  const busNumber = preflight.busData?.bus_number || params.busId;

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

    await dispatchTripNotification({
      routeId: effectiveRouteId,
      tripId: activeTripId,
      routeName,
      busId: params.busId,
      shift: tripShift,
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
    // Fetch route_id, route_name, and bus_number together (avoids second buses query below)
    const { data: busData } = await supabase
      .from('buses')
      .select('route_id, route_name, bus_number')
      .eq('id', params.busId)
      .maybeSingle();
    if (busData) {
      routeId = busData.route_id || '';
      routeName = busData.route_name || 'your route';
      // Cache bus_number so the second fetch below is skipped
      Object.assign(params, { _cachedBusNumber: busData.bus_number || params.busId });
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

  // Run endTrip RPC and trip cleanup concurrently — cleanup is non-critical.
  // Also drop the persisted bus_locations row so the next trip can never
  // surface this trip's stale position (harmless if the trip stays active:
  // the next throttled GPS write re-persists within 30s).
  const [endResult] = await Promise.all([
    tripLockService.endTrip(activeTripId, params.driverId, params.busId),
    cleanupTrip({ driverId: params.driverId, busId: params.busId, tripId: activeTripId }),
    supabase.from('bus_locations').delete().eq('bus_id', params.busId),
  ]);

  if (!endResult.success) {
    appLogger.error('trip', 'end_failed', { ...logCtx, tripId: activeTripId, reason: endResult.reason, errorClass: ErrorClass.TRIP_LOCK_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: endResult.reason };
  }

  // The trip is over: the GPS pipeline must not compare the next trip's first
  // update against this trip's last position (jump rejection for 5+ minutes on
  // restart), and the 10s active-trip cache must not gate it on the old trip.
  invalidateActiveTripCache(params.busId, params.driverId);
  clearInMemoryLastLocation(params.busId);

  // Use bus_number already fetched during route resolution above (avoids a second buses query)
  const cachedBusNumber = (params as any)._cachedBusNumber;
  const busNumber = cachedBusNumber || (activeTrip ? (activeTrip as any).bus_number : null) || params.busId;

  appLogger.info('trip', 'ended', { ...logCtx, tripId: activeTripId, routeId, latencyMs: Date.now() - start });

  broadcastTripEvent({
    busId: params.busId,
    tripId: activeTripId,
    event: 'trip_ended',
    busNumber,
  });

  await dispatchTripNotification({
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
