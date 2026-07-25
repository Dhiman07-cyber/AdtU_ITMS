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
        const [driverProfileResult, busIdFromRepo] = await Promise.all([
            supabase
                .from('driver_profiles')
                .select('uid, full_name, shift, license_number, employee_id, joining_date, route_id, bus_id')
                .eq('uid', uid)
                .maybeSingle(),
            getBusIdByDriverUid(uid),
        ]);

        let driverProfile = driverProfileResult.data;

        // Fallback: If driver_profiles row is missing, check users table and auto-create profile
        if (!driverProfile) {
            const { data: userData } = await supabase
                .from('users')
                .select('uid, name, email, role')
                .eq('uid', uid)
                .maybeSingle();

            const { data: busByDriver } = await supabase
                .from('buses')
                .select('id, route_id')
                .eq('driver_uid', uid)
                .maybeSingle();

            const fallbackName = userData?.name || auth.name || 'Driver';
            const fallbackEmail = userData?.email || auth.email || '';
            const fallbackBusId = busByDriver?.id || null;
            const fallbackRouteId = busByDriver?.route_id || null;

            const newProfile = {
                uid,
                email: fallbackEmail,
                full_name: fallbackName,
                shift: 'Both',
                license_number: 'N/A',
                employee_id: 'N/A',
                joining_date: new Date().toISOString(),
                bus_id: fallbackBusId,
                route_id: fallbackRouteId,
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            // Auto-upsert into PostgreSQL so it exists permanently
            await supabase
                .from('driver_profiles')
                .upsert(newProfile, { onConflict: 'uid' });

            driverProfile = newProfile;
        }

        // 2. Resolve bus_id across all sources (driver_assignments -> driver_profiles -> buses.driver_uid)
        let busId = busIdFromRepo || driverProfile.bus_id || null;
        if (!busId) {
            const { data: busByDriver } = await supabase
                .from('buses')
                .select('id')
                .eq('driver_uid', uid)
                .maybeSingle();
            if (busByDriver) {
                busId = busByDriver.id;
            }
        }

        // 3. Fetch Bus details
        const busResult = busId
            ? await supabase
                .from('buses')
                .select('id, bus_number, color, status, current_members, capacity, route_id, morning_load, evening_load')
                .eq('id', busId)
                .maybeSingle()
            : { data: null, error: null };

        const bus = busResult.data || null;

        // 4. Resolve route_id across driver_profiles and buses
        const routeId = driverProfile.route_id || bus?.route_id || null;

        // 5. Fetch Route, Student Counts (Total, Morning, Evening), and Active Trip Status in parallel
        const [routeResult, totalStudentsRes, morningStudentsRes, eveningStudentsRes, tripStatus] = await Promise.all([
            routeId
                ? supabase.from('routes').select('id, route_name, stops, route_distance, distance, total_distance').eq('id', routeId).maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            busId
                ? supabase.from('student_profiles').select('uid', { count: 'exact', head: true }).eq('bus_id', busId).eq('status', 'active')
                : Promise.resolve({ count: 0, error: null }),
            busId
                ? supabase.from('student_profiles').select('uid', { count: 'exact', head: true }).eq('bus_id', busId).eq('status', 'active').eq('shift', 'Morning')
                : Promise.resolve({ count: 0, error: null }),
            busId
                ? supabase.from('student_profiles').select('uid', { count: 'exact', head: true }).eq('bus_id', busId).eq('status', 'active').eq('shift', 'Evening')
                : Promise.resolve({ count: 0, error: null }),
            supabase.from('active_trips').select('status').eq('driver_id', uid).eq('status', 'active').maybeSingle()
        ]);

        const route = routeResult.data || null;
        const studentCount = totalStudentsRes.count ?? bus?.current_members ?? 0;
        const morningCount = morningStudentsRes.count ?? bus?.morning_load ?? 0;
        const eveningCount = eveningStudentsRes.count ?? bus?.evening_load ?? 0;

        const tripData = tripStatus?.data || null;
        const isTripActive = tripData?.status === 'active';

        // Format bus object for frontend expectations
        const formattedBus = bus ? {
            ...bus,
            busId: bus.id,
            busNumber: bus.bus_number,
            currentMembers: studentCount,
            totalCapacity: bus.capacity,
            load: {
                morningCount,
                eveningCount,
            }
        } : null;

        // Format route object for frontend expectations
        const formattedRoute = route ? {
            ...route,
            routeId: route.id,
            routeName: route.route_name,
            stops: Array.isArray(route.stops) ? route.stops : [],
            totalStops: Array.isArray(route.stops) ? route.stops.length : 0
        } : null;

        return NextResponse.json({
            driver: {
                ...driverProfile,
                fullName: driverProfile.full_name,
                busId: busId,
                routeId: routeId,
            },
            bus: formattedBus,
            route: formattedRoute,
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
