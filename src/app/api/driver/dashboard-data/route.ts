import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

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

        // 1 & 2. Fetch Driver Profile and Active Trip in PARALLEL
        const [profileQueryRes, activeTripRes] = await Promise.all([
            supabase
                .from('driver_profiles')
                .select('uid, full_name, license_number, employee_id, joining_date, status')
                .eq('uid', uid)
                .maybeSingle(),
            supabase
                .from('active_trips')
                .select('trip_id, bus_id, route_id, shift, status, start_time')
                .eq('driver_id', uid)
                .eq('status', 'active')
                .maybeSingle()
        ]);

        let driverProfile = profileQueryRes.data;

        // Fallback: If driver_profiles row is missing, check users table and auto-create profile
        if (!driverProfile) {
            const { data: userData } = await supabase
                .from('users')
                .select('uid, name, email, role')
                .eq('uid', uid)
                .maybeSingle();

            const fallbackName = userData?.name || auth.name || 'Driver';
            const fallbackEmail = userData?.email || auth.email || '';

            const newProfile = {
                uid,
                email: fallbackEmail,
                full_name: fallbackName,
                license_number: 'N/A',
                employee_id: 'N/A',
                joining_date: new Date().toISOString(),
                status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            await supabase
                .from('driver_profiles')
                .upsert(newProfile, { onConflict: 'uid' });

            driverProfile = newProfile;
        }

        const activeTrip = activeTripRes.data;
        const isTripActive = !!activeTrip;
        const busId = activeTrip?.bus_id || null;
        const routeId = activeTrip?.route_id || null;

        // 3. Fetch Bus details, Route details, and Student counts if trip is active
        const [busResult, routeResult, totalStudentsRes, morningStudentsRes, eveningStudentsRes] = await Promise.all([
            busId
                ? supabase.from('buses').select('id, bus_number, status, current_members, capacity, route_id, morning_load, evening_load').eq('id', busId).maybeSingle()
                : Promise.resolve({ data: null, error: null }),
            routeId
                ? supabase.from('routes').select('id, route_name, stops, total_stops').eq('id', routeId).maybeSingle()
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
        ]);

        const bus = busResult.data || null;
        const route = routeResult.data || null;
        const studentCount = totalStudentsRes.count ?? bus?.current_members ?? 0;
        const morningCount = morningStudentsRes.count ?? bus?.morning_load ?? 0;
        const eveningCount = eveningStudentsRes.count ?? bus?.evening_load ?? 0;

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

        const formattedRoute = route ? {
            ...route,
            routeId: route.id,
            routeName: route.route_name,
            stops: Array.isArray(route.stops) ? route.stops : [],
            totalStops: Array.isArray(route.stops) ? route.stops.length : (route?.total_stops || 0)
        } : null;

        return NextResponse.json({
            driver: {
                ...driverProfile,
                fullName: driverProfile.full_name,
                busId,
                routeId,
            },
            bus: formattedBus,
            route: formattedRoute,
            studentCount,
            tripActive: isTripActive,
            tripData: activeTrip ? {
                tripId: activeTrip.trip_id,
                busId: activeTrip.bus_id,
                routeId: activeTrip.route_id,
                shift: activeTrip.shift,
                startTime: activeTrip.start_time,
            } : null
        });
    },
    {
        requiredRoles: ['driver'],
        rateLimit: RateLimits.READ
    }
);
