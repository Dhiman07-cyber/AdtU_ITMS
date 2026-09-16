import { requireTransportEntitlement } from '@/lib/entitlement/require-transport-entitlement';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { TripStatusQuerySchema } from '@/lib/security/validation-schemas';
import { getStudentProfileAndShift } from '@/lib/student-shift-resolver';
import { getSupabaseServer } from '@/lib/supabase-server';
import { isShiftCompatible } from '@/lib/utils';
import { NextResponse } from 'next/server';

/**
 * GET /api/student/trip-status
 * 
 * Check if there's an active trip for a given bus.
 * Uses service role key to bypass RLS policies.
 */
export const GET = withSecurity(
    async (request, { auth }) => {
        // Phase 3 — students may only see live trip status while they own transport
        // access. Staff (driver/admin/moderator) are exempt from this gate.
        if (auth.role === 'student') {
            const gate = await requireTransportEntitlement(auth.uid);
            if (!gate.ok) return (gate as any).response;
        }

        // Extract busId from URL parameters for GET request
        const url = new URL(request.url);
        const busId = url.searchParams.get('busId');

        if (!busId) {
            return NextResponse.json({
                tripActive: false,
                error: 'busId is required',
                tripData: null
            }, { status: 400 });
        }

        // Resolve student profile once — reused for both the bus-assignment security
        // check and the shift-compatibility check below. Avoids duplicate DB call.
        let studentProfile: { busId?: string | null; shift?: string | null } | null = null;
        if (auth.role === 'student') {
            studentProfile = await getStudentProfileAndShift(auth.uid);
            const studentBusId = studentProfile.busId;
            if (studentBusId && studentBusId !== busId && studentBusId !== busId.replace('bus_', '') && `bus_${studentBusId}` !== busId) {
                return NextResponse.json({
                    tripActive: false,
                    error: 'Forbidden: You are not assigned to this bus',
                    tripData: null
                }, { status: 403 });
            }
        }

        const busVariations = [busId];
        if (busId.startsWith('bus_')) {
            busVariations.push(busId.replace('bus_', ''));
        } else {
            busVariations.push(`bus_${busId}`);
        }

        const supabase = getSupabaseServer();

        const { data: rows, error } = await supabase
            .from('active_trips')
            .select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat, expires_at')
            .in('bus_id', busVariations)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString())
            .order('start_time', { ascending: false })
            .limit(1);

        const data = rows && rows.length > 0 ? rows[0] : null;

        if (error) {
            console.error('Error querying active_trips:', error);
            return NextResponse.json({
                tripActive: false,
                error: 'An unexpected error occurred',
                tripData: null
            });
        }

        if (data) {
            // Check shift compatibility for student role using already-resolved profile.
            if (auth.role === 'student' && studentProfile) {
                if (studentProfile.shift && !isShiftCompatible(studentProfile.shift, data.shift)) {
                    return NextResponse.json({
                        tripActive: false,
                        tripData: null,
                        reason: 'shift_mismatch'
                    });
                }
            }

            const { getLastLocationForBus } = await import('@/domains/gps');
            const lastLoc = getLastLocationForBus(busId);

            let currentLocation = null;
            if (lastLoc) {
                currentLocation = {
                    busId,
                    driverUid: data.driver_id,
                    lat: lastLoc.lat,
                    lng: lastLoc.lng,
                    timestamp: lastLoc.timestamp,
                };
            } else {
                const { data: dbLoc } = await supabase
                    .from('bus_locations')
                    .select('lat, lng, timestamp')
                    .eq('bus_id', data.bus_id)
                    .order('timestamp', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                if (dbLoc) {
                    currentLocation = {
                        busId,
                        driverUid: data.driver_id,
                        lat: dbLoc.lat,
                        lng: dbLoc.lng,
                        timestamp: dbLoc.timestamp,
                    };
                }
            }

            return NextResponse.json({
                tripActive: true,
                tripData: {
                    tripId: data.trip_id,
                    status: data.status,
                    driverUid: data.driver_id,
                    routeId: data.route_id,
                    shift: data.shift,
                    startedAt: data.start_time,
                    lastUpdated: data.last_heartbeat,
                    current_location: currentLocation
                }
            });
        }

        return NextResponse.json({
            tripActive: false,
            tripData: null
        });
    },
    {
        requiredRoles: ['student', 'driver', 'admin', 'moderator'],
        schema: TripStatusQuerySchema,
        rateLimit: RateLimits.READ
    }
);
