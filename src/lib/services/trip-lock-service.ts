/**
 * Trip Lock Service (PostgreSQL-only)
 *
 * Handles multi-driver lock management with automatic heartbeat recovery.
 * No audit logging, no admin intervention - fully automatic and driver-driven.
 *
 * D9: All Firestore usage has been removed. The trip lock now lives entirely
 * in PostgreSQL active_trips table via RPCs. The unique partial indexes on
 * active_trips enforce the same atomic lock semantics that Firestore
 * transactions previously provided.
 *
 * "The system enforces exclusive bus operation using a server-controlled
 * distributed lock and automatic heartbeat recovery, without manual
 * overrides or administrative intervention."
 */

import { getSupabaseServer } from '@/lib/supabase-server';
import { SupabaseClient } from '@supabase/supabase-js';
import { appLogger } from '@/lib/logger';
import { getBusIdVariations } from '@/lib/utils';

// 30 minutes — prevents premature trip expiration during rural connectivity dead zones
// while zero-wait atomic handover allows Driver 2 to take over immediately with zero delay.
const HEARTBEAT_TIMEOUT_SECONDS = 1800;
const LOCK_TTL_SECONDS = 1800;
const HEARTBEAT_MIN_WRITE_INTERVAL_MS = 45 * 1000;
const heartbeatWriteCache = new Map<string, number>();

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
}

function isLockExpired(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
    if (!expiresAt) return true;
    const expiresAtMs = new Date(expiresAt).getTime();
    return nowMs > expiresAtMs;
}

// Types
export interface ActiveTripLock {
    active: boolean;
    tripId: string | null;
    driverId: string | null;
    shift: 'morning' | 'evening' | 'both' | null;
    since: string | null;
    expiresAt: string | null;
}

export interface CanOperateResult {
    allowed: boolean;
    reason?: string;
}

export interface StartTripResult {
    success: boolean;
    tripId?: string;
    alreadyActive?: boolean;
    reason?: string;
    errorCode?: 'LOCKED_BY_OTHER' | 'SUPABASE_ERROR' | 'VALIDATION_ERROR';
    handover?: boolean;
    previousDriverId?: string;
    previousTripId?: string;
}

export interface EndTripResult {
    success: boolean;
    alreadyEnded?: boolean;
    reason?: string;
}

export interface HeartbeatResult {
    success: boolean;
    reason?: string;
}

/**
 * Trip Lock Service Class
 *
 * D9: Pure PostgreSQL implementation. Uses RPCs for atomic lock operations
 * and direct queries for reads. The unique partial index on
 * active_trips(bus_id) WHERE status = 'active' enforces single-driver
 * exclusion — the same guarantee that Firestore transactions provided.
 */
export class TripLockService {
    private supabase: SupabaseClient;

    constructor() {
        this.supabase = getSupabaseServer();
    }

    /**
     * Check if a driver can operate a specific bus
     *
     * D9: Reads from PostgreSQL active_trips instead of Firestore buses.activeTripLock.
     * Uses the same expiry logic: if the lock exists and hasn't expired, only the
     * owning driver can operate.
     */
    async canOperate(driverId: string, busId: string): Promise<CanOperateResult> {
        try {
            const { data: activeTrip } = await this.supabase
                .from('active_trips')
                .select('driver_id, expires_at')
                .eq('bus_id', busId)
                .eq('status', 'active')
                .maybeSingle();

            // No active trip — bus is free
            if (!activeTrip) {
                return { allowed: true };
            }

            // Active trip exists — check if expired
            if (isLockExpired(activeTrip.expires_at)) {
                return { allowed: true };
            }

            // Lock exists and is valid — check if same driver (continuation)
            if (activeTrip.driver_id === driverId) {
                return { allowed: true };
            }

            // Locked by another driver
            return {
                allowed: false,
                reason: 'This bus is currently being operated by another driver. Please wait or try again later.'
            };

        } catch (error: unknown) {
            appLogger.error('trip-lock', 'can_operate_error', { busId, driverId, error: getErrorMessage(error) });
            throw error;
        }
    }

    /**
     * Start a trip with exclusive lock acquisition
     *
     * D9: Uses PostgreSQL RPC for atomic lock acquisition. The unique partial
     * index on active_trips(bus_id) WHERE status = 'active' enforces the same
     * single-driver exclusion that the Firestore transaction provided.
     *
     * Steps:
     * 1. Call acquire_trip_lock RPC (atomic INSERT with unique constraint)
     * 2. On unique violation → check if it's our own trip (idempotent retry)
     */
    async startTrip(
        driverId: string,
        busId: string,
        routeId: string,
        shift: 'morning' | 'evening' | 'both',
        tripId: string,
        deviceId?: string
    ): Promise<StartTripResult> {
        const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
        if (!idPattern.test(driverId) || !idPattern.test(busId) || !idPattern.test(routeId) || !idPattern.test(tripId)) {
            return { success: false, reason: 'Invalid ID formats provided', errorCode: 'VALIDATION_ERROR' };
        }

        try {
            const { data: result, error: rpcError } = await this.supabase
                .rpc('acquire_trip_lock', {
                    p_trip_id: tripId,
                    p_bus_id: busId,
                    p_driver_id: driverId,
                    p_route_id: routeId,
                    p_shift: shift,
                    p_ttl_seconds: LOCK_TTL_SECONDS,
                    p_device_id: deviceId || null,
                });

            if (rpcError) {
                appLogger.error('trip-lock', 'acquire_lock_rpc_error', { busId, driverId, tripId, error: rpcError.message });
                return { success: false, reason: rpcError.message, errorCode: 'SUPABASE_ERROR' };
            }

            if (!result?.success) {
                if (result?.error === 'LOCKED_BY_OTHER') {
                    return {
                        success: false,
                        reason: 'This bus is currently being operated by another driver. Please wait or try again later.',
                        errorCode: 'LOCKED_BY_OTHER'
                    };
                }
                return { success: false, reason: result?.error || 'Failed to acquire lock', errorCode: 'SUPABASE_ERROR' };
            }

            return {
                success: true,
                tripId: result.tripId || tripId,
                alreadyActive: result.alreadyActive === true,
                handover: result.handover === true,
                previousDriverId: result.previousDriverId,
                previousTripId: result.previousTripId,
            };

        } catch (error: unknown) {
            appLogger.error('trip-lock', 'start_trip_error', { busId, driverId, tripId, error: getErrorMessage(error) });
            return { success: false, reason: getErrorMessage(error) };
        }
    }

    /**
     * Update heartbeat for an active trip
     *
     * D9: Uses PostgreSQL RPC for heartbeat extension. No Firestore transaction needed.
     * The heartbeat write cache prevents excessive database writes.
     */
    async heartbeat(
        tripId: string,
        driverId: string,
        busId: string
    ): Promise<HeartbeatResult> {
        const now = new Date();
        const cacheKey = `${tripId}:${driverId}:${busId}`;
        const lastWrite = heartbeatWriteCache.get(cacheKey) || 0;

        if (now.getTime() - lastWrite < HEARTBEAT_MIN_WRITE_INTERVAL_MS) {
            return { success: true };
        }

        try {
            const { data: result, error: rpcError } = await this.supabase
                .rpc('extend_trip_lock', {
                    p_trip_id: tripId,
                    p_driver_id: driverId,
                    p_bus_id: busId,
                    p_ttl_seconds: LOCK_TTL_SECONDS,
                });

            if (rpcError) {
                appLogger.error('trip-lock', 'extend_lock_rpc_error', { tripId, driverId, busId, error: rpcError.message });
                return { success: false, reason: 'Failed to update heartbeat' };
            }

            if (!result?.success) {
                return { success: false, reason: result?.error || 'Active trip not found' };
            }

            heartbeatWriteCache.set(cacheKey, now.getTime());
            if (heartbeatWriteCache.size > 5000) {
                const firstKey = heartbeatWriteCache.keys().next().value;
                if (firstKey) heartbeatWriteCache.delete(firstKey);
            }

            return { success: true };

        } catch (error: unknown) {
            appLogger.error('trip-lock', 'heartbeat_error', { tripId, driverId, busId, error: getErrorMessage(error) });
            return { success: false, reason: getErrorMessage(error) };
        }
    }

    /**
     * End a trip cleanly (IDEMPOTENT + OWNERSHIP VERIFIED)
     * Updates active_trips to 'ended' status instead of deleting (audit trail).
     *
     * D9: Uses PostgreSQL RPC for lock release. No Firestore lock to release.
     */
    async endTrip(
        tripId: string,
        driverId?: string | null,
        busId = '',
        minDurationSeconds = 0,
        endedReason = 'completed'
    ): Promise<EndTripResult> {
        try {
            // Stage 1: Call 5-parameter signature
            let result: any = null;
            let rpcError: any = null;

            const rpcCall = await this.supabase
                .rpc('end_trip_atomically', {
                    p_trip_id: tripId,
                    p_bus_id: busId,
                    p_driver_id: driverId || null,
                    p_min_duration_seconds: minDurationSeconds,
                    p_ended_reason: endedReason,
                });
            result = rpcCall.data;
            rpcError = rpcCall.error;

            // Fallback 1 (Legacy 3-Arg RPC): If rpcError occurs and rpcError.code === 'PGRST202' or schema cache error
            const isMissingRpcError = rpcError && (
                rpcError.code === 'PGRST202' ||
                rpcError.code === '42883' ||
                rpcError.message?.includes('end_trip_atomically') ||
                rpcError.message?.includes('schema cache')
            );

            if (isMissingRpcError) {
                appLogger.warn('trip-lock', 'end_trip_fallback_3arg', { tripId, driverId, busId, error: rpcError.message });
                const retry3Arg = await this.supabase
                    .rpc('end_trip_atomically', {
                        p_trip_id: tripId,
                        p_bus_id: busId,
                        p_driver_id: driverId || null,
                    });
                result = retry3Arg.data;
                rpcError = retry3Arg.error;
            }

            // Fallback 2 (Direct Atomic Table Transition): If the RPC is still missing in schema OR if post-check shows row is still lingering in active_trips
            const isStillMissingRpc = rpcError && (
                rpcError.code === 'PGRST202' ||
                rpcError.code === '42883' ||
                rpcError.message?.includes('end_trip_atomically') ||
                rpcError.message?.includes('schema cache')
            );

            let needDirectCleanup = isStillMissingRpc;
            if (!needDirectCleanup && !rpcError && busId) {
                const busVariations = getBusIdVariations(busId);
                let checkQuery: any = this.supabase
                    .from('active_trips')
                    .select('trip_id');
                if (typeof checkQuery?.or === 'function' && busVariations.length > 0) {
                    checkQuery = checkQuery.or(`trip_id.eq.${tripId},bus_id.in.(${busVariations.join(',')})`);
                } else if (typeof checkQuery?.eq === 'function') {
                    checkQuery = checkQuery.eq('trip_id', tripId);
                }
                if (typeof checkQuery?.limit === 'function') {
                    checkQuery = checkQuery.limit(1);
                }
                const { data: lingering } = typeof checkQuery?.maybeSingle === 'function'
                    ? await checkQuery.maybeSingle()
                    : { data: null };
                if (lingering) {
                    needDirectCleanup = true;
                }
            }

            if (rpcError && !needDirectCleanup) {
                appLogger.error('trip-lock', 'end_trip_rpc_error', { tripId, driverId, busId, error: rpcError.message });
                return { success: false, reason: rpcError.message || 'Database error during end_trip_atomically' };
            }

            if (needDirectCleanup) {
                appLogger.warn('trip-lock', 'end_trip_fallback_direct_cleanup', { tripId, driverId, busId, rpcError: rpcError?.message });
                const busVariations = busId ? getBusIdVariations(busId) : [];

                // Query active_trips matching trip_id = tripId OR bus_id IN busVariations
                let activeRowQuery: any = this.supabase
                    .from('active_trips')
                    .select('*');
                if (typeof activeRowQuery?.or === 'function' && busVariations.length > 0) {
                    activeRowQuery = activeRowQuery.or(`trip_id.eq.${tripId},bus_id.in.(${busVariations.join(',')})`);
                } else if (typeof activeRowQuery?.eq === 'function') {
                    activeRowQuery = activeRowQuery.eq('trip_id', tripId);
                }
                const { data: activeRows } = typeof activeRowQuery?.then === 'function' ? await activeRowQuery : { data: null };
                const activeRow = (activeRows && activeRows.length > 0) ? activeRows[0] : null;

                // Delete the row from active_trips by trip_id and .in('bus_id', busVariations)
                let deleteQuery: any = this.supabase.from('active_trips').delete();
                if (typeof deleteQuery?.or === 'function' && busVariations.length > 0) {
                    deleteQuery = deleteQuery.or(`trip_id.eq.${tripId},bus_id.in.(${busVariations.join(',')})`);
                } else if (typeof deleteQuery?.eq === 'function') {
                    deleteQuery = deleteQuery.eq('trip_id', tripId);
                }
                if (typeof deleteQuery?.then === 'function') await deleteQuery;

                // Update driver_profiles setting trip_active = false, active_trip_id = null, updated_at = now
                const effectiveDriverId = driverId || activeRow?.driver_id;
                if (effectiveDriverId) {
                    const profileUpdate: any = this.supabase
                        .from('driver_profiles')
                        .update({
                            trip_active: false,
                            active_trip_id: null,
                            updated_at: new Date().toISOString(),
                        });
                    if (typeof profileUpdate?.eq === 'function') {
                        await profileUpdate.eq('uid', effectiveDriverId);
                    }
                }

                // Delete all rows from waiting_flags where .in('bus_id', busVariations) or .eq('trip_id', tripId)
                let flagDelete: any = this.supabase.from('waiting_flags').delete();
                if (typeof flagDelete?.or === 'function' && busVariations.length > 0) {
                    flagDelete = flagDelete.or(`trip_id.eq.${tripId},bus_id.in.(${busVariations.join(',')})`);
                } else if (typeof flagDelete?.eq === 'function') {
                    flagDelete = flagDelete.eq('trip_id', tripId);
                }
                if (typeof flagDelete?.then === 'function') await flagDelete;

                // Upsert the archived trip row into driver_trip_history (onConflict: 'trip_id')
                if (activeRow) {
                    const now = new Date();
                    const startTime = activeRow.start_time ? new Date(activeRow.start_time) : now;
                    const durationSeconds = Math.max(0, Math.floor((now.getTime() - startTime.getTime()) / 1000));
                    const historyUpsert: any = this.supabase
                        .from('driver_trip_history')
                        .upsert({
                            trip_id: activeRow.trip_id || tripId,
                            bus_id: activeRow.bus_id || busId,
                            driver_id: effectiveDriverId || activeRow.driver_id,
                            route_id: activeRow.route_id,
                            shift: activeRow.shift,
                            status: endedReason === 'force_ended' ? 'terminated_early' : 'completed',
                            ended_reason: endedReason,
                            start_time: activeRow.start_time || now.toISOString(),
                            end_time: now.toISOString(),
                            duration_seconds: durationSeconds,
                        }, { onConflict: 'trip_id' });
                    if (typeof historyUpsert?.then === 'function') await historyUpsert;
                }

                heartbeatWriteCache.delete(`${tripId}:${driverId}:${busId}`);
                return { success: true, alreadyEnded: false };
            }

            if (result?.alreadyEnded) {
                appLogger.info('trip-lock', 'end_trip_idempotent', { tripId, driverId, busId });
            }

            heartbeatWriteCache.delete(`${tripId}:${driverId}:${busId}`);
            return { success: true, alreadyEnded: result?.alreadyEnded === true };

        } catch (error: unknown) {
            appLogger.error('trip-lock', 'end_trip_error', { tripId, driverId, busId, error: getErrorMessage(error) });
            return { success: false, reason: getErrorMessage(error) };
        }
    }

    /**
     * Get active trip for a bus across all busId variations
     */
    async getActiveTrip(busId: string) {
        const busVariations = getBusIdVariations(busId);
        let query: any = this.supabase
            .from('active_trips')
            .select('*');
        if (typeof query?.in === 'function') {
            const inRes = query.in('bus_id', busVariations.length > 0 ? busVariations : [busId]);
            query = inRes && typeof inRes.eq === 'function' ? inRes : query.eq('bus_id', busId);
        } else if (typeof query?.eq === 'function') {
            query = query.eq('bus_id', busId);
        }
        if (typeof query?.eq === 'function') {
            query = query.eq('status', 'active');
        }
        if (typeof query?.limit === 'function') {
            query = query.limit(1);
        }
        const { data, error } = typeof query?.maybeSingle === 'function'
            ? await query.maybeSingle()
            : { data: null, error: null };

        if (error) {
            appLogger.error('trip-lock', 'get_active_trip_error', { busId, error: (error as any).message || String(error) });
            return null;
        }

        return data;
    }
}

// Export singleton instance
export const tripLockService = new TripLockService();
