/**
 * Stale Lock Cleanup Worker
 *
 * Cron job endpoint that cleans up stale locks automatically.
 * Should be called every minute via Vercel Cron.
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

import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import crypto from 'crypto';

// Configuration — 10 minutes; university buses commonly pass through
// connectivity dead zones (tunnels, parking garages) where heartbeats
// pause temporarily. 5 min was too aggressive and killed active trips.
const HEARTBEAT_TIMEOUT_SECONDS = 600;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// SECURITY: Fail-closed cron auth verification
function verifyCronAuth(request: Request): boolean {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // SECURITY: Fail-closed — if CRON_SECRET is not configured, deny all
    if (!cronSecret) {
        console.error('🚫 CRON_SECRET not configured — blocking cron request');
        return false;
    }

    const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
    if (providedToken.length !== cronSecret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(cronSecret));
}

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

                // For each cleaned lock, comprehensive cleanup
                for (const lock of cleanedLocks) {
                    try {
                        // Broadcast lock release
                        const channel = supabase.channel(`trip-status-${lock.cleaned_bus_id}`);
                        await channel.send({
                            type: 'broadcast',
                            event: 'trip_ended',
                            payload: {
                                busId: lock.cleaned_bus_id,
                                tripId: lock.cleaned_trip_id,
                                reason: 'heartbeat_timeout',
                                timestamp: new Date().toISOString()
                            }
                        });

                        // Comprehensive cleanup of ALL trip-related tables.
                        // Scoped by trip_id (not just bus_id) to avoid deleting data
                        // from a new trip that may have started on the same bus between
                        // the Supabase RPC cleanup and these deletes.
                        await Promise.allSettled([
                            // Delete bus_locations — scoped to this trip
                            supabase.from('bus_locations').delete()
                                .eq('bus_id', lock.cleaned_bus_id)
                                .eq('trip_id', lock.cleaned_trip_id),
                            // Delete driver_location_updates — scoped to this trip's driver
                            supabase.from('driver_location_updates').delete()
                                .eq('driver_uid', lock.cleaned_driver_id)
                                .eq('trip_id', lock.cleaned_trip_id),
                            // Delete waiting_flags — scoped to this trip's bus
                            supabase.from('waiting_flags').delete()
                                .eq('bus_id', lock.cleaned_bus_id)
                                .eq('trip_id', lock.cleaned_trip_id)
                                .in('status', ['raised', 'acknowledged']),
                            // Clean device sessions for this driver
                            supabase.from('device_sessions').delete().eq('user_id', lock.cleaned_driver_id),
                        ]);
                        stats.comprehensiveCleanups++;
                        console.log(`✅ Comprehensive cleanup done for stale bus ${lock.cleaned_bus_id}`);

                    } catch (err: any) {
                        console.error(`Error in comprehensive cleanup for ${lock.cleaned_bus_id}:`, err);
                        stats.errors.push(`comprehensive_cleanup_error`);
                    }
                }

                console.log(`✅ Cleaned ${stats.staleLocksCleaned} stale locks`);
            }
        } catch (err: any) {
            console.error('Error in stale lock cleanup:', err);
            stats.errors.push('stale_locks_general_error');
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
