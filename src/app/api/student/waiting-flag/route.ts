import { emitEvent } from '@/domains/realtime/event-emitter';
import { getByUid } from '@/domains/student';
import { getCachedStudentAssignment } from '@/domains/student/services/student-assignment-cache';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import {
	WaitingFlagDeleteSchema,
	WaitingFlagPostSchema,
	WaitingFlagQuerySchema
} from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { isWaitingFlagExpired } from '@/lib/waiting-flag-helpers';
import { findCanonicalStopCoordinates } from '@/domains/route/data/canonical-route-geometries';
import { projectPointToRouteCorridor, checkApproachingBusWindow } from '@/domains/route/services/route-alignment-engine';
import {
    getGpsStateFromRedis,
    setRedisActiveFlag,
    removeRedisActiveFlag,
    incrementStudentTripFlagCount,
} from '@/domains/gps/services/gps-redis-guard';
import { getSharedBusTripSnapshot, invalidateBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';
import { pgFindById } from '@/domains/route/repositories/route.repository.pg';
import { NextResponse } from 'next/server';

/**
 * POST /api/student/waiting-flag
 *
 * Raises a waiting flag for a student using the 3-Lock Route Corridor Engine:
 * - Freshness & Accuracy: timestamp <= 60s skew, accuracy <= 150m.
 * - Lock 1: Continuous route corridor geofence (<= 120m cross-track or <= 200m from named stop).
 * - Lock 2: Directional approaching bus window (bus not > 150m past, bus not > 4km upstream).
 * - Lock 3: Per-trip anti-spam cooldown (<= 2 flag raises per trip_id).
 */
export const POST = withSecurity(
    async (request, { auth, body }) => {
        const { busId, lat, lng, message, timestamp, routeId, stop_name, stopLat, stopLng, accuracy } = body as any;
        const studentUid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Parallelize student profile fetch, duplicate flag check, and active trip lookup
        // Uses getCachedStudentAssignment (L1 + Redis) when available, falling back safely to getByUid
        const [studentData, existingFlagRes, activeTripRes] = await Promise.all([
            (async () => {
                if (typeof getCachedStudentAssignment === 'function') {
                    try {
                        const cached = await getCachedStudentAssignment(studentUid);
                        if (cached) {
                            return {
                                uid: cached.uid,
                                id: cached.uid,
                                fullName: cached.fullName,
                                bus_id: cached.busId,
                                busId: cached.busId,
                                route_id: cached.routeId,
                                routeId: cached.routeId,
                                shift: cached.shift,
                                stop_name: cached.stopName,
                                stopName: cached.stopName,
                                status: cached.status,
                                softBlock: cached.softBlock,
                                validUntil: cached.validUntil,
                                hardBlock: cached.hardBlock,
                            };
                        }
                    } catch {}
                }
                return getByUid(studentUid).catch(() => null);
            })(),
            supabase.from('waiting_flags')
                .select('id, status, created_at, expires_at')
                .eq('student_uid', studentUid)
                .in('status', ['raised', 'waiting', 'acknowledged'])
                .limit(5),
            supabase.from('active_trips')
                .select('trip_id, bus_id, route_id, shift')
                .eq('bus_id', busId)
                .eq('status', 'active')
                .maybeSingle()
        ]);

        if (!studentData) return NextResponse.json({ error: 'Student record not found' }, { status: 404 });

        // Transport entitlement check
        const entitlement = getTransportEntitlement(studentData);
        if (!entitlement.entitled) {
            return NextResponse.json(
                { error: 'Transport access is not active for this account.', entitled: false, reason: entitlement.reason },
                { status: 403 }
            );
        }

        const studentBusId = studentData.bus_id || studentData.busId || (studentData as any).id;
        
        if (!studentBusId || studentBusId !== busId) {
            return NextResponse.json({
                error: `Forbidden: You are not assigned to bus ${busId}. Your assigned bus is ${studentBusId || 'none'}.`
            }, { status: 403 });
        }

        // Check if any existing flag is genuinely active (not expired)
        const activeExistingFlag = existingFlagRes.data?.find(f => !isWaitingFlagExpired(f));

        if (activeExistingFlag) {
            return NextResponse.json({
                success: false,
                error: 'You already have an active waiting flag for this bus',
                existingFlagId: activeExistingFlag.id
            }, { status: 409 });
        }

        // If there are stale/expired flags still sitting in active status, lazily expire them in DB
        if (existingFlagRes.data && existingFlagRes.data.length > 0) {
            const staleFlags = existingFlagRes.data.filter(f => isWaitingFlagExpired(f));
            for (const stale of staleFlags) {
                await supabase
                    .from('waiting_flags')
                    .update({ status: 'expired' })
                    .eq('id', stale.id);
            }
        }

        // Active Trip Check
        const tripId = activeTripRes.data?.trip_id;
        if (!tripId) {
            return NextResponse.json({
                success: false,
                error: 'Cannot raise waiting flag: No active trip is currently running on your assigned bus.',
                code: 'NO_ACTIVE_TRIP'
            }, { status: 409 });
        }

        // 2. Validate timestamp freshness (<= 60s skew)
        if (timestamp !== undefined && timestamp !== null) {
            const tsNum = Number(timestamp);
            if (Number.isFinite(tsNum) && Math.abs(Date.now() - tsNum) > 60_000) {
                return NextResponse.json({
                    success: false,
                    error: 'GPS coordinate timestamp expired or clock drifted > 60s from server time.',
                    code: 'TIMESTAMP_EXPIRED',
                }, { status: 400 });
            }
        }

        // 3. Validate GPS accuracy (<= 150m)
        if (accuracy !== undefined && accuracy !== null) {
            const accNum = Number(accuracy);
            if (Number.isFinite(accNum) && accNum > 150) {
                return NextResponse.json({
                    success: false,
                    error: `Reported GPS accuracy (${Math.round(accNum)}m) is too low (must be <= 150m).`,
                    code: 'ACCURACY_TOO_LOW',
                }, { status: 400 });
            }
        }

        // 4. Determine coordinates
        let studentLat: number | null = null;
        let studentLng: number | null = null;
        if (lat !== undefined && lng !== undefined) {
            studentLat = parseFloat(lat as any);
            studentLng = parseFloat(lng as any);
        } else if (stopLat !== undefined && stopLng !== undefined) {
            studentLat = parseFloat(stopLat as any);
            studentLng = parseFloat(stopLng as any);
        }

        if (studentLat === null || studentLng === null || isNaN(studentLat) || isNaN(studentLng)) {
            return NextResponse.json({ error: 'Location is required', code: 'LOCATION_REQUIRED' }, { status: 400 });
        }

        // Lock 3: Per-Trip Anti-Spam Cooldown Guard (max 2 flag raises per trip)
        const tripFlagCount = await incrementStudentTripFlagCount(tripId, studentUid);
        if (tripFlagCount > 2) {
            return NextResponse.json({
                success: false,
                error: 'You have reached the maximum of 2 waiting flag raises for this trip.',
                code: 'FLAG_COOLDOWN_ACTIVE',
            }, { status: 429 });
        }

        const targetRouteId = routeId || studentData.route_id || studentData.routeId || activeTripRes.data?.route_id || 'route_1';
        const targetStopName = stop_name || studentData.stop_name || studentData.stopName;

        // Lock 1 — Continuous Route Corridor Geofence (<= 120m from Road Polyline OR <= 200m from Named Stop)
        const studentCorridor = projectPointToRouteCorridor(
            { lat: studentLat, lng: studentLng },
            targetRouteId
        );

        if (!studentCorridor.isInCorridor) {
            return NextResponse.json({
                success: false,
                error: 'You must be at the roadside along your bus route to raise a waiting flag.',
                code: 'OUT_OF_ROUTE_CORRIDOR',
                crossTrackDistanceMeters: studentCorridor.crossTrackDistanceMeters,
                nearestStopDistanceMeters: studentCorridor.nearestStopDistanceMeters,
            }, { status: 403 });
        }

        // Lock 2 — Directional & Approaching Bus Window (Zero DB Reads — Uses Redis gps:last:<busId>)
        const tripShift = activeTripRes.data?.shift || 'Morning';
        const busLoc = await getGpsStateFromRedis(busId);
        if (busLoc && Number.isFinite(busLoc.lat) && Number.isFinite(busLoc.lng)) {
            const busCorridor = projectPointToRouteCorridor(
                { lat: busLoc.lat, lng: busLoc.lng },
                targetRouteId
            );
            const busProgressMeters = busCorridor.routeProgressMeters;
            const studentProgressMeters = studentCorridor.routeProgressMeters;

            const windowCheck = checkApproachingBusWindow(
                busProgressMeters,
                studentProgressMeters,
                tripShift
            );

            if (windowCheck.alreadyPassed) {
                return NextResponse.json({
                    success: false,
                    error: 'Your bus has already passed your location on the route.',
                    code: 'BUS_ALREADY_PASSED',
                    busDeltaMeters: windowCheck.busDeltaMeters,
                }, { status: 409 });
            }

            if (windowCheck.tooFarUpstream) {
                return NextResponse.json({
                    success: false,
                    error: 'You can raise your waiting flag once the bus is within 4 km of your location.',
                    code: 'BUS_TOO_FAR_UPSTREAM',
                    upstreamDistanceMeters: windowCheck.signedAheadMeters,
                }, { status: 400 });
            }
        }

        // 6. Prepare flag data with exact roadside pickup coordinates
        const currentTimestamp = timestamp || Date.now();
        const flagExpiresAt = new Date(currentTimestamp + 15 * 60 * 1000).toISOString();
        const flagData: any = {
            student_uid: studentUid,
            student_name: studentData.fullName || studentData.name || 'Student',
            bus_id: busId,
            route_id: targetRouteId || 'unknown',
            stop_name: targetStopName || studentCorridor.nearestStopName || 'Roadside Pickup',
            status: 'raised',
            trip_id: tripId,
            shift: tripShift,
            created_at: new Date(currentTimestamp).toISOString(),
            expires_at: flagExpiresAt,
            message: message || null,
            stop_lat: studentLat,
            stop_lng: studentLng,
        };

        // 7. Atomic Insert (1 Supabase write)
        const { data: insertData, error: insertError } = await supabase
            .from('waiting_flags')
            .insert(flagData)
            .select('id, student_uid, student_name, bus_id, route_id, stop_name, stop_lat, stop_lng, status, trip_id, created_at, expires_at, message')
            .single();

        if (insertError) {
            if (insertError.code === '23505') {
                const { data: conflictRecord } = await supabase
                    .from('waiting_flags')
                    .select('id, status, created_at, expires_at')
                    .eq('student_uid', studentUid)
                    .in('status', ['raised', 'waiting', 'acknowledged'])
                    .maybeSingle();

                if (conflictRecord && isWaitingFlagExpired(conflictRecord)) {
                    await supabase
                        .from('waiting_flags')
                        .update({ status: 'expired' })
                        .eq('id', conflictRecord.id);

                    const retryInsert = await supabase
                        .from('waiting_flags')
                        .insert(flagData)
                        .select('id, student_uid, student_name, bus_id, route_id, stop_name, stop_lat, stop_lng, status, trip_id, created_at, expires_at, message')
                        .single();

                    if (!retryInsert.error && retryInsert.data) {
                        // Store in Redis flags:active:<busId> for 0-DB-read hot path
                        await setRedisActiveFlag(busId, {
                            flagId: retryInsert.data.id,
                            studentUid,
                            studentName: retryInsert.data.student_name,
                            stopName: retryInsert.data.stop_name,
                            lat: studentLat,
                            lng: studentLng,
                            routeProgressMeters: studentCorridor.routeProgressMeters,
                            ackSent: false,
                            busId,
                            routeId: retryInsert.data.route_id,
                            tripId,
                            shift: tripShift,
                            createdAt: currentTimestamp,
                        });

                        const broadcastPayload = {
                            ...retryInsert.data,
                            lat: studentLat,
                            lng: studentLng,
                            stop_lat: studentLat,
                            stop_lng: studentLng,
                            routeProgressMeters: studentCorridor.routeProgressMeters,
                        };
                        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_created', broadcastPayload).catch(() => {});
                        emitEvent(`student_${studentUid}`, 'waiting_flag_created', broadcastPayload).catch(() => {});
                        invalidateBusTripSnapshot(busId);

                        return NextResponse.json({
                            success: true,
                            flagId: retryInsert.data.id,
                            flag: broadcastPayload
                        });
                    }
                }

                return NextResponse.json({ error: 'You already have an active waiting flag for this bus' }, { status: 409 });
            }
            console.error('Supabase insert error:', insertError);
            return NextResponse.json({ error: 'Failed to create waiting flag' }, { status: 500 });
        }

        // 8. Store in Redis flags:active:<busId> for 0-DB-read hot path
        await setRedisActiveFlag(busId, {
            flagId: insertData.id,
            studentUid,
            studentName: insertData.student_name,
            stopName: insertData.stop_name,
            lat: studentLat,
            lng: studentLng,
            routeProgressMeters: studentCorridor.routeProgressMeters,
            ackSent: false,
            busId,
            routeId: insertData.route_id,
            tripId,
            shift: tripShift,
            createdAt: currentTimestamp,
        });

        // 9. Non-blocking WebSocket Broadcast with exact roadside (lat, lng) coordinates
        const broadcastPayload = {
            ...insertData,
            lat: studentLat,
            lng: studentLng,
            stop_lat: studentLat,
            stop_lng: studentLng,
            routeProgressMeters: studentCorridor.routeProgressMeters,
        };
        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_created', broadcastPayload).catch(err => {
            console.warn('Broadcast failed (non-critical):', err);
        });
        emitEvent(`student_${studentUid}`, 'waiting_flag_created', broadcastPayload).catch(err => {
            console.warn('Student broadcast failed (non-critical):', err);
        });
        invalidateBusTripSnapshot(busId);

        return NextResponse.json({
            success: true,
            flagId: insertData.id,
            flag: broadcastPayload
        });
    },
    {
        requiredRoles: ['student'],
        schema: WaitingFlagPostSchema,
        rateLimit: RateLimits.WAITING_FLAG,
        allowBodyToken: true
    }
);

/**
 * DELETE /api/student/waiting-flag
 * 
 * Cancels a waiting flag.
 */
export const DELETE = withSecurity(
    async (request, { auth, body }) => {
        const { flagId, busId } = body as any;
        const studentUid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Concurrent status update (audit-safe)
        const { data: updatedData, error: supabaseError } = await supabase
            .from('waiting_flags')
            .update({ status: 'cancelled' })
            .eq('id', flagId)
            .eq('student_uid', studentUid)
            .in('status', ['raised', 'acknowledged', 'waiting'])
            .select('id');

        if (supabaseError) {
            console.error('Supabase error:', supabaseError);
            return NextResponse.json({ error: 'Failed to cancel waiting flag' }, { status: 500 });
        }

        if (!updatedData || updatedData.length === 0) {
            return NextResponse.json({ error: 'Cannot cancel waiting flag that is already boarded, cancelled, or expired' }, { status: 409 });
        }

        // 2. Evict from Redis active flags
        await removeRedisActiveFlag(busId, flagId).catch(() => {});

        // 3. Non-blocking Broadcast via WebSocket (Background)
        emitEvent(`waiting_flags_${busId}`, 'waiting_flag_removed', { flagId, studentUid, reason: 'cancelled' }).catch(err => {
            console.warn('Broadcast failed (non-critical):', err);
        });
        emitEvent(`student_${studentUid}`, 'waiting_flag_removed', { flagId, studentUid, reason: 'cancelled' }).catch(err => {
            console.warn('Broadcast failed (non-critical):', err);
        });
        invalidateBusTripSnapshot(busId);

        return NextResponse.json({ success: true });
    },
    {
        requiredRoles: ['student'],
        schema: WaitingFlagDeleteSchema,
        rateLimit: RateLimits.WAITING_FLAG,
        allowBodyToken: true
    }
);

/**
 * GET /api/student/waiting-flag
 * 
 * Fetches the current active flag for a student.
 */
export const GET = withSecurity(
    async (request, { auth, body }) => {
        const { studentUid } = body as any;
        const requesterUid = auth.uid;

        // SECURITY: IDOR prevention — students can only query their own flags
        if (requesterUid !== studentUid) {
            return NextResponse.json({ error: 'Forbidden: Cannot query another student\'s waiting flag' }, { status: 403 });
        }

        const supabase = getSupabaseServer();

        const { data, error } = await supabase
            .from('waiting_flags')
            .select('id, student_uid, bus_id, status, trip_id, created_at, expires_at, stop_name, stop_lat, stop_lng, message')
            .eq('student_uid', studentUid)
            .in('status', ['waiting', 'raised', 'acknowledged'])
            .maybeSingle();

        if (error) {
            console.error('Error fetching waiting flag:', error);
            return NextResponse.json({ error: 'Database error' }, { status: 500 });
        }

        const isExpired = isWaitingFlagExpired(data);
        return NextResponse.json({ data: isExpired ? null : (data || null) });
    },
    {
        requiredRoles: ['student'],
        schema: WaitingFlagQuerySchema,
        rateLimit: RateLimits.READ
    }
);