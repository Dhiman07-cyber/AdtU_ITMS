import { clearHistory, flushStopDwellOnTripEnd, invalidateActiveTripCache, clearStopDwellState } from '@/domains/gps';
import { clearRedisActiveFlags, clearRedisTripLock, clearGpsState } from '@/domains/gps/services/gps-redis-guard';
import { clearInMemoryLastLocation } from '@/domains/gps/services/gps-pipeline.service';
import { emitEvent } from '@/domains/realtime/event-emitter';
import { clearTripBreadcrumbCache } from '@/lib/services/location-write-throttle';
import { invalidateCachedDeviceSession } from '@/lib/services/device-session-cache';
import { invalidateBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';
import { invalidateScannerBusCache } from '@/lib/security/scanner-auth';
import { getSupabaseServer } from '@/lib/supabase-server';

/**
 * Evict all bus runtime state across all memory and distributed Redis layers.
 * Unifies teardown across gps-persistence, gps-pipeline, stop-dwell, gps-redis-guard,
 * trip-snapshot-cache, device-session-cache, and location-write-throttle.
 */
export async function evictAllBusRuntimeState(
  busId: string,
  driverId?: string,
  tripId?: string
): Promise<void> {
  if (!busId) return;

  // 1. Invalidate active trip lock cache & DB state
  invalidateActiveTripCache(busId, driverId);

  // 2. Clear GPS pipeline location anchors, process-local raw timestamps, and driver history
  clearInMemoryLastLocation(busId);
  await clearGpsState(busId).catch(() => {});
  if (driverId) {
    clearHistory(driverId);
  }

  // 3. Flush & clear stop-dwell state (memory & Redis)
  await flushStopDwellOnTripEnd(busId).catch(() => {});
  clearStopDwellState(busId);

  // 4. Clear Redis waiting flags & active trip locks
  await Promise.allSettled([
    clearRedisActiveFlags(busId),
    clearRedisTripLock(busId),
  ]);

  // 5. Invalidate shared bus trip snapshot
  invalidateBusTripSnapshot(busId);

  // 6. Invalidate device session cache if driverId provided
  if (driverId) {
    invalidateCachedDeviceSession(driverId);
    invalidateScannerBusCache(driverId);
  }

  // 7. Clear breadcrumb throttle cache if tripId provided
  if (tripId) {
    clearTripBreadcrumbCache(tripId);
  }
}

export async function cleanupTrip(params: {
  driverId: string;
  busId: string;
  tripId: string;
}) {
  const supabase = getSupabaseServer();

  // 1. Delete first, capturing what was actually removed.
  const [{ data: deletedFlags }] = await Promise.all([
    supabase.from('waiting_flags')
      .delete()
      .eq('bus_id', params.busId)
      .in('status', ['raised', 'acknowledged', 'waiting'])
      .select('id, student_uid, bus_id'),
    supabase.from('device_sessions').delete().eq('user_id', params.driverId),
  ]);

  // 2. Atomically evict all bus runtime state across all memory and Redis layers (Fix 6)
  await evictAllBusRuntimeState(params.busId, params.driverId, params.tripId);

  // 3. Broadcast only the flags that were actually deleted.
  if (deletedFlags && deletedFlags.length > 0) {
    const broadcastPromises: Promise<any>[] = [];

    for (const flag of deletedFlags) {
      broadcastPromises.push(
        emitEvent(`student_${flag.student_uid}`, 'waiting_flag_removed', {
          flagId: flag.id,
          studentUid: flag.student_uid,
          busId: flag.bus_id,
          status: 'cancelled',
          reason: 'trip_ended',
        }).catch((err: Error) => console.warn('[cleanupTrip] student broadcast failed:', err))
      );

      broadcastPromises.push(
        emitEvent(`waiting_flags_${flag.bus_id}`, 'waiting_flag_removed', {
          flagId: flag.id,
          studentUid: flag.student_uid,
          student_uid: flag.student_uid,
          busId: flag.bus_id,
          status: 'cancelled',
          reason: 'trip_ended',
        }).catch((err: Error) => console.warn('[cleanupTrip] bus channel broadcast failed:', err))
      );
    }

    await Promise.allSettled(broadcastPromises);
  }
}
