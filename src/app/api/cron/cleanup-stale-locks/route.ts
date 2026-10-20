/**
 * Stale Lock Cleanup Worker
 *
 * Cron job endpoint that cleans up stale active_trips locks automatically.
 *
 * CURRENT SCHEDULE (vercel.json): `0 4 * * *` — once daily at 04:00 UTC.
 * Rationale: Vercel Hobby accounts enforce a strict limit of daily cron jobs. Sub-daily
 * schedules (e.g. every 5 minutes) cause deployment rejection on Vercel Hobby accounts.
 * Note: Stale locks are also passively validated and treated as expired during tripStartPreflight.
 * For high-frequency sweeps in production, trigger via external cron webhook or Vercel Pro.
 * Ref: FIX-12 (A-16), CRIT-05.
 *
 * D9: Fully migrated to PostgreSQL. No Firestore usage.
 * The cleanup_stale_locks RPC handles all lock cleanup in PostgreSQL.
 *
 * Actions:
 * 1. Clean stale active trips (no heartbeat > HEARTBEAT_TIMEOUT)
 * 2. Comprehensive cleanup of all trip-related tables
 * 3. Broadcast trip end to connected clients
 *
 * No manual overrides, no admin intervention - fully automatic.
 */

import { emitEvent } from '@/domains/realtime/event-emitter';
import { evictAllBusRuntimeState } from '@/domains/trip';
import { verifyCronAuth } from '@/lib/security/cron-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

// Configuration — 10 minutes; university buses commonly pass through
// connectivity dead zones (tunnels, parking garages) where heartbeats
// pause temporarily. 5 min was too aggressive and killed active trips.
const HEARTBEAT_TIMEOUT_SECONDS = 600;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function GET(request: Request) {
    // Verify cron auth
    if (!verifyCronAuth(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();
    const stats = {
        staleLocksCleaned: 0,
        comprehensiveCleanups: 0,
        errors: [] as string[]
    };

    try {
        // Initialize Supabase
        if (!supabaseUrl || !supabaseKey) {
            return NextResponse.json(
                { error: 'Missing Supabase configuration' },
                { status: 500 }
            );
        }

        const supabase = getSupabaseServer();

        console.log('🔄 Running stale lock cleanup...');

        // STEP 1: Clean stale active trips using database function
        try {
            const { data: cleanedLocks, error: cleanError } = await supabase
                .rpc('cleanup_stale_locks', { p_heartbeat_timeout_seconds: HEARTBEAT_TIMEOUT_SECONDS });

            if (cleanError) {
                console.error('Error cleaning stale locks:', cleanError);
                stats.errors.push('stale_locks_cleanup_error');
            } else if (cleanedLocks && cleanedLocks.length > 0) {
                stats.staleLocksCleaned = cleanedLocks.length;

                // Process ALL expired locks in parallel — each is independent.
                // Under mass-expiry (network outage knocking out many buses at once),
                // the old serial loop would take N × 2 DB round-trips before completing.
                const cleanupResults = await Promise.allSettled(
                    cleanedLocks.map(async (lock: any) => {
                        // Atomically evict all bus runtime state across all memory and Redis layers (Fix 6)
                        await evictAllBusRuntimeState(lock.cleaned_bus_id, lock.cleaned_driver_id, lock.cleaned_trip_id);
                        // Non-critical broadcast — fire and forget
                        emitEvent(`trip-status-${lock.cleaned_bus_id}`, 'trip_ended', {
                            busId: lock.cleaned_bus_id,
                            tripId: lock.cleaned_trip_id,
                            reason: 'heartbeat_timeout',
                            timestamp: new Date().toISOString()
                        }).catch(() => {});

                        // Scoped cleanup — bus_id ensures we expire all pending flags on this bus
                        // Soft-archive waiting flags to 'expired' and broadcast waiting_flag_removed (Fix 7)
                        const { data: expiredFlags } = await supabase
                            .from('waiting_flags')
                            .update({ status: 'expired' })
                            .eq('bus_id', lock.cleaned_bus_id)
                            .in('status', ['raised', 'acknowledged', 'waiting'])
                            .select('id, student_uid, bus_id');

                        if (expiredFlags && expiredFlags.length > 0) {
                            for (const flag of expiredFlags) {
                                emitEvent(`student_${flag.student_uid}`, 'waiting_flag_removed', {
                                    flagId: flag.id,
                                    studentUid: flag.student_uid,
                                    busId: flag.bus_id,
                                    reason: 'heartbeat_timeout',
                                }).catch(() => {});
                                emitEvent(`waiting_flags_${lock.cleaned_bus_id}`, 'waiting_flag_removed', {
                                    flagId: flag.id,
                                    studentUid: flag.student_uid,
                                    busId: flag.bus_id,
                                    reason: 'heartbeat_timeout',
                                }).catch(() => {});
                            }
                        }

                        await supabase.from('device_sessions').delete().eq('user_id', lock.cleaned_driver_id);

                        return lock.cleaned_bus_id;
                    })
                );

                for (const r of cleanupResults) {
                    if (r.status === 'fulfilled') {
                        stats.comprehensiveCleanups++;
                    } else {
                        stats.errors.push(`comprehensive_cleanup_error`);
                        console.error(`Error in comprehensive cleanup:`, r.reason);
                    }
                }

                console.log(`✅ Cleaned ${stats.staleLocksCleaned} stale locks`);
            }
        } catch (err: any) {
            console.error('Error in stale lock cleanup:', err);
            stats.errors.push('stale_locks_general_error');
        }

        // STEP 2: Ancillary system health sweep — expire orphan waiting flags, stale sessions, abandoned app locks
        try {
            // SEAM FIX 11: Pre-sweep expired waiting flags from Redis and broadcast removal before DB expiry
            try {
                const { data: candidateExpiredFlags } = await supabase
                    .from('waiting_flags')
                    .select('id, bus_id, student_uid')
                    .in('status', ['raised', 'waiting', 'acknowledged'])
                    .lt('expires_at', new Date().toISOString());

                if (candidateExpiredFlags && candidateExpiredFlags.length > 0) {
                    const { removeRedisActiveFlag } = await import('@/domains/gps/services/gps-redis-guard');
                    const { invalidateBusTripSnapshot } = await import('@/lib/services/trip-snapshot-cache');
                    for (const flag of candidateExpiredFlags) {
                        await removeRedisActiveFlag(flag.bus_id, flag.id).catch(() => {});
                        invalidateBusTripSnapshot(flag.bus_id);
                        emitEvent(`student_${flag.student_uid}`, 'waiting_flag_removed', {
                            flagId: flag.id,
                            studentUid: flag.student_uid,
                            busId: flag.bus_id,
                            reason: 'expired',
                        }).catch(() => {});
                        emitEvent(`waiting_flags_${flag.bus_id}`, 'waiting_flag_removed', {
                            flagId: flag.id,
                            studentUid: flag.student_uid,
                            busId: flag.bus_id,
                            reason: 'expired',
                        }).catch(() => {});
                    }
                }
            } catch (flagSweepErr) {
                console.warn('⚠️ Expired waiting flag pre-sweep warning:', flagSweepErr);
            }

            const [flagsRes, sessionsRes, appLocksRes] = await Promise.allSettled([
                supabase.rpc('expire_waiting_flags'),
                supabase.rpc('cleanup_stale_device_sessions'),
                supabase.rpc('cleanup_abandoned_application_locks'),
            ]);

            if (flagsRes.status === 'rejected') {
                console.warn('⚠️ expire_waiting_flags warning:', flagsRes.reason);
            }
            if (sessionsRes.status === 'rejected') {
                console.warn('⚠️ cleanup_stale_device_sessions warning:', sessionsRes.reason);
            }
            if (appLocksRes.status === 'rejected') {
                console.warn('⚠️ cleanup_abandoned_application_locks warning:', appLocksRes.reason);
            }
        } catch (ancillaryErr: any) {
            console.warn('⚠️ Ancillary maintenance sweep warning:', ancillaryErr?.message);
        }

        const elapsed = Date.now() - startTime;

        if (stats.staleLocksCleaned > 0) {
            console.log(`✅ Cleanup completed in ${elapsed}ms:`, stats);
        }

        return NextResponse.json({
            success: true,
            stats,
            elapsedMs: elapsed,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('❌ Cleanup worker error:', error);
        return NextResponse.json(
            { error: 'Cleanup failed' },
            { status: 500 }
        );
    }
}

// Also support POST for manual trigger
export async function POST(request: Request) {
    return GET(request);
}
