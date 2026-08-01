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

// Configuration from environment
// 10 minutes — university buses commonly pass through connectivity dead zones.
// 5 min was too aggressive and killed active trips during temporary network loss.
const HEARTBEAT_TIMEOUT_SECONDS = 600;
const LOCK_TTL_SECONDS = 600;
const HEARTBEAT_MIN_WRITE_INTERVAL_MS = 20 * 1000;
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
}

export interface EndTripResult {
    success: boolean;
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
        tripId: string
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

            return { success: true, tripId: result.tripId || tripId, alreadyActive: result.alreadyActive === true };

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
        driverId: string,
        busId: string
    ): Promise<EndTripResult> {
        try {
            // Ownership is already verified by the orchestrator before this call.
            // The end_trip_atomically RPC also enforces driver_id at the DB level,
            // so a second getActiveTrip here was a redundant network round-trip.
            const { data: result, error: rpcError } = await this.supabase
                .rpc('end_trip_atomically', {
                    p_trip_id: tripId,
                    p_bus_id: busId,
                    p_driver_id: driverId,
                });

            if (rpcError) {
                appLogger.error('trip-lock', 'end_trip_rpc_error', { tripId, driverId, busId, error: rpcError.message });
                return { success: false, reason: rpcError.message };
            }

            if (result?.alreadyEnded) {
                appLogger.info('trip-lock', 'end_trip_idempotent', { tripId, driverId, busId });
            }

            heartbeatWriteCache.delete(`${tripId}:${driverId}:${busId}`);
            return { success: true };

        } catch (error: unknown) {
            appLogger.error('trip-lock', 'end_trip_error', { tripId, driverId, busId, error: getErrorMessage(error) });
            return { success: false, reason: getErrorMessage(error) };
        }
    }

    /**
     * Get active trip for a bus
     */
    async getActiveTrip(busId: string) {
        const { data, error } = await this.supabase
            .from('active_trips')
            .select('trip_id, driver_id, route_id, shift, expires_at, status')
            .eq('bus_id', busId)
            .eq('status', 'active')
            .maybeSingle();

        if (error) {
            appLogger.error('trip-lock', 'get_active_trip_error', { busId, error: (error as any).message || String(error) });
            return null;
        }

        return data;
    }
}

// Export singleton instance
export const tripLockService = new TripLockService();
