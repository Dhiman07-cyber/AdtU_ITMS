import { requireTransportEntitlement } from '@/lib/entitlement/require-transport-entitlement';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { TripStatusQuerySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
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

        // PERF: Use singleton Supabase client instead of creating one per request
        const supabase = getSupabaseServer();

        // Query active_trips for active trips in PostgreSQL lock table.
        const { data: rows, error } = await supabase
            .from('active_trips')
            .select('trip_id, bus_id, driver_id, route_id, shift, status, start_time, last_heartbeat')
            .eq('bus_id', busId)
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
            console.log(`✅ Active trip found for bus ${busId}:`, {
                tripId: data.trip_id,
                status: data.status,
                startedAt: data.start_time
            });

            return NextResponse.json({
                tripActive: true,
                tripData: {
                    tripId: data.trip_id,
                    status: data.status,
                    driverUid: data.driver_id,
                    routeId: data.route_id,
                    shift: data.shift,
                    startedAt: data.start_time,
                    lastUpdated: data.last_heartbeat
                }
            });
        }

        console.log(`ℹ️ No active trip found for bus ${busId}`);
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
