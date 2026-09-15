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

// FCM send is best-effort and must not dictate trip-response latency, but it
// also must not be dropped silently: serverless runtimes may freeze the
// function after the response, so a bare fire-and-forget can lose the send.
// Bound it: give FCM up to 5s, then return and let the dedup lock
// (acquire_fcm_lock) make any late/duplicate delivery safe.
function dispatchFcmBounded(promise: Promise<unknown>, label: string): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('FCM dispatch timeout (5s)')), 5000)
  );
  return Promise.race([promise, timeout]).then(
    () => undefined,
    (e) => {
      console.warn(`${label} FCM dispatch failed or timed out (non-critical):`, (e as Error)?.message || e);
    }
  );
}

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

  // Drop any cached trip-lock entries and in-memory location anchors for this driver/bus —
  // ensures every new trip begins with a completely clean GPS state.
  invalidateActiveTripCache(params.busId, params.driverId);
  clearInMemoryLastLocation(params.busId);

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

    // FCM off the critical path but bounded (see dispatchFcmBounded): dedup
    // via acquire_fcm_lock is preserved; a notification failure must never
    // fail an already-acquired trip start.
    await dispatchFcmBounded(
      dispatchTripNotification({
        routeId: effectiveRouteId,
        tripId: activeTripId,
        routeName,
        busId: params.busId,
        shift: tripShift,
        eventType: 'TRIP_STARTED',
      }),
      'trip start'
    );
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
  let tripDurationMinutes = 0;

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

    // Calculate trip duration in minutes from active_trips start_time/created_at
    const startTimeStr = (activeTrip as any).start_time || (activeTrip as any).created_at;
    if (startTimeStr) {
      const startTimeMs = new Date(startTimeStr).getTime();
      if (Number.isFinite(startTimeMs) && startTimeMs > 0) {
        tripDurationMinutes = (Date.now() - startTimeMs) / (1000 * 60);
      }
    }
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

  // Enforce 10-minute minimum duration rule:
  // If driver accidentally started and immediately ended trip (<10 minutes),
  // do NOT save to driver_trip_history and delete the accidental trip row.
  const IS_ACCIDENTAL_SHORT_TRIP = tripDurationMinutes > 0 && tripDurationMinutes < 10;

  if (IS_ACCIDENTAL_SHORT_TRIP) {
    appLogger.info('trip', 'short_duration_discarded', {
      ...logCtx,
      tripId: activeTripId,
      durationMinutes: Math.round(tripDurationMinutes * 10) / 10,
      reason: 'Trip duration < 10 minutes — discarded from history',
    });
  }

  // 1. Authoritative state transition FIRST — no side effects until this succeeds.
  // Sub-10-minute ("accidental") trips are discarded from driver_trip_history
  // inside the RPC; cleanup + broadcast below still run so clients converge.
  const endResult = await tripLockService.endTrip(activeTripId, params.driverId, params.busId, 600);

  if (!endResult.success) {
    // The RPC failed (e.g. lock conflict). Do NOT force-delete — that
    // bypasses the lock. Return failure so the driver can retry.
    appLogger.error('trip', 'end_failed', { ...logCtx, tripId: activeTripId, reason: endResult.reason, errorClass: ErrorClass.TRIP_LOCK_FAILED, latencyMs: Date.now() - start });
    return { success: false, reason: endResult.reason };
  }

  // Idempotent retry (double-click / network retry after a successful end):
  // the lock is already gone, so there is nothing to clean up or broadcast.
  // Return success WITHOUT emitting a second trip_ended / FCM / cleanup wave.
  if (endResult.alreadyEnded) {
    appLogger.info('trip', 'end_duplicate_suppressed', { ...logCtx, tripId: activeTripId, latencyMs: Date.now() - start });
    return { success: true, tripId: activeTripId };
  }

  // 2. RPC succeeded — now safe to clean up transient state.
  // History is written atomically by end_trip_atomically (duration_seconds);
  // sub-10-minute trips are discarded from history inside the RPC.
  await Promise.allSettled([
    cleanupTrip({ driverId: params.driverId, busId: params.busId, tripId: activeTripId }),
    supabase.from('bus_locations').delete().eq('bus_id', params.busId),
  ]);

  invalidateActiveTripCache(params.busId, params.driverId);
  clearInMemoryLastLocation(params.busId);

  const cachedBusNumber = (params as any)._cachedBusNumber;
  const busNumber = cachedBusNumber || (activeTrip ? (activeTrip as any).bus_number : null) || params.busId;

  appLogger.info('trip', 'ended', { ...logCtx, tripId: activeTripId, routeId, durationMinutes: Math.round(tripDurationMinutes * 10) / 10, latencyMs: Date.now() - start });

  // 3. Broadcast only after authoritative success.
  broadcastTripEvent({
    busId: params.busId,
    tripId: activeTripId,
    event: 'trip_ended',
    busNumber,
  });

  // FCM is bounded, not unbounded (see dispatchFcmBounded): token fetch +
  // multicast no longer defines the tail latency of the driver's end-trip
  // response, while the send still gets up to 5s to complete. Deduplication
  // via acquire_fcm_lock is preserved, and failures here must never fail an
  // already-committed trip end.
  await dispatchFcmBounded(
    dispatchTripNotification({
      routeId: routeId || 'unassigned_route',
      tripId: activeTripId,
      routeName,
      busId: params.busId,
      eventType: 'TRIP_ENDED',
    }),
    'trip end'
  );

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
