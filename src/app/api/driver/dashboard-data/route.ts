import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getBusIdByDriverUid } from '@/domains/fleet/repositories/driver-assignment.repository';

/**
 * GET /api/driver/dashboard-data
 * 
 * COMPREHENSIVE DRIVER DASHBOARD DATA FETCH
 * Parallelizes: Driver Profile, Assigned Bus, Route, Student Count, and Trip Status.
 * D9: All reads from Supabase (PostgreSQL) — no Firestore.
 */
export const GET = withSecurity(
    async (request, { auth }) => {
        const uid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Fetch Driver Profile + assignment from canonical source
        const [driverProfileResult, busId] = await Promise.all([
            supabase
                .from('driver_profiles')
                .select('uid, full_name, shift, license_number, employee_id, joining_date, route_id')
                .eq('uid', uid)
                .maybeSingle(),
            getBusIdByDriverUid(uid),
        ]);

        const driverProfile = driverProfileResult.data;
        if (!driverProfile) {
            return NextResponse.json({ error: 'Driver profile not found' }, { status: 404 });
        }

        const routeId = driverProfile.route_id;

        // 2. Parallelize everything else
        const [busResult, routeResult, studentCountResult, tripStatus] = await Promise.all([
            busId
                ? supabase.from('buses').select('id, bus_number, color, status, current_members, capacity, route_id').eq('id', busId).maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            routeId
                ? supabase.from('routes').select('id, route_name, stops, route_distance, distance, total_distance').eq('id', routeId).maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            busId
                ? supabase.from('student_profiles').select('uid', { count: 'exact', head: true }).eq('bus_id', busId).eq('status', 'active')
                : Promise.resolve({ count: 0, error: null }),
            supabase.from('active_trips').select('status').eq('driver_id', uid).eq('status', 'active').maybeSingle()
        ]);

        const bus = busResult.data || null;
        const route = routeResult.data || null;
        const studentCount = studentCountResult.count || 0;
        const tripData = tripStatus?.data || null;
        const isTripActive = tripData?.status === 'active';

        return NextResponse.json({
            driver: driverProfile,
            bus,
            route,
            studentCount,
            tripActive: isTripActive,
            tripData
        });
    },
    {
        requiredRoles: ['driver'],
        rateLimit: RateLimits.READ
    }
);
