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

        const busVariations = [busId];
        if (busId.startsWith('bus_')) {
            busVariations.push(busId.replace('bus_', ''));
        } else {
            busVariations.push(`bus_${busId}`);
        }

        // PERF: Use singleton Supabase client instead of creating one per request
        const supabase = getSupabaseServer();

        // Query active_trips for active trips in PostgreSQL lock table.
        const { data: rows, error } = await supabase
            .from('active_trips')
            .select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat')
            .in('bus_id', busVariations)
            .eq('status', 'active')
            .order('start_time', { ascending: false })
            .limit(1);

        const data = rows && rows.length > 0 ? rows[0] : null;

        if (error) {
            console.error('❌ Error querying active_trips:', error);
            return NextResponse.json({
                tripActive: false,
                error: 'An unexpected error occurred',
                tripData: null
            });
        }

        if (data) {
            // Check shift compatibility for student role
            if (auth.role === 'student') {
                const resolved = await getStudentProfileAndShift(auth.uid);

                if (resolved.shift && !isShiftCompatible(resolved.shift, data.shift)) {
                    console.log(`ℹ️ Trip active for bus ${busId} but shift incompatible (student: ${resolved.shift}, trip: ${data.shift})`);
                    return NextResponse.json({
                        tripActive: false,
                        tripData: null,
                        reason: 'shift_mismatch'
                    });
                }
            }

            console.log(`✅ Active trip found for bus ${busId}:`, {
                tripId: data.trip_id,
                status: data.status,
                startedAt: data.start_time
            });

            const { getLastLocationForBus } = await import('@/domains/gps');
            const lastLoc = getLastLocationForBus(busId);

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
                    current_location: lastLoc ? {
                        busId,
                        driverUid: data.driver_id,
                        lat: lastLoc.lat,
                        lng: lastLoc.lng,
                        timestamp: lastLoc.timestamp,
                    } : null
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
