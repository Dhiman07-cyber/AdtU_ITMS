import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';

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

        // 1. D6: Fetch Driver Profile from driver_profiles
        const { data: driverProfile, error: driverError } = await supabase
            .from('driver_profiles')
            .select('uid, full_name, shift, license_number, driver_id, employee_id, joining_date, assigned_bus_id, bus_id, assigned_route_id, route_id')
            .eq('uid', uid)
            .maybeSingle();

        if (driverError || !driverProfile) {
            return NextResponse.json({ error: 'Driver profile not found' }, { status: 404 });
        }

        const busId = driverProfile.assigned_bus_id || driverProfile.bus_id;
        const routeId = driverProfile.assigned_route_id || driverProfile.route_id;

        // 2. Parallelize everything else
        const [busResult, routeResult, studentCountResult, tripStatus] = await Promise.all([
            busId
                ? supabase.from('buses').select('id, bus_number, color, status, current_members, capacity, route_id, driver_uid').eq('id', busId).maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            routeId
                ? supabase.from('routes').select('id, route_name, stops, route_distance, distance, total_distance').eq('id', routeId).maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            busId
                ? supabase.from('student_profiles').select('uid', { count: 'exact', head: true }).eq('bus_id', busId).eq('status', 'active')
                : Promise.resolve({ count: 0, error: null }),
            supabase.from('driver_status').select('status').eq('driver_uid', uid).maybeSingle()
        ]);

        const bus = busResult.data || null;
        const route = routeResult.data || null;
        const studentCount = studentCountResult.count || 0;
        const tripData = tripStatus?.data || null;
        const isTripActive = tripData ? (tripData.status === 'on_trip' || tripData.status === 'enroute') : false;

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
