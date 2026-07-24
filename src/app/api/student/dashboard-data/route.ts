import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { getByUid } from '@/domains/student';
import * as routeService from '@/domains/route';
import { getBusById } from '@/domains/fleet';
import { getDriversByBusId } from '@/domains/identity';

/**
 * GET /api/student/dashboard-data
 * 
 * COMPREHENSIVE DASHBOARD DATA FETCH
 * Fetches student profile, bus, route, driver, and live trip status in PARALLEL.
 *
 * Migration status: COMPLETED — student profile reads from PostgreSQL.
 * Bus/route/driver reads still use Firestore (separate domains).
 */
export const GET = withSecurity(
    async (request, { auth }) => {
        const uid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Fetch Student Profile from PostgreSQL
        let studentData: Record<string, any> | null = null;
        try {
            studentData = await getByUid(uid) as Record<string, any> | null;
        } catch {
            studentData = null;
        }

        if (!studentData) {
            // Check if student has an application in PostgreSQL
            const { data: appRow } = await supabase
                .from('applications')
                .select('*')
                .eq('applicant_uid', uid)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (appRow) {
                const appState = appRow.state;
                let reason: any = 'application_submitted';
                if (appState === 'verified_upcoming') reason = 'verified_upcoming';
                else if (appState === 'pending_seat_allocation') reason = 'pending_seat_allocation';

                return NextResponse.json({
                    student: {
                        uid,
                        fullName: appRow.form_data?.fullName || appRow.applicant_email,
                        status: appState,
                        state: appState,
                        applicationId: appRow.application_id,
                        targetSession: appRow.target_session || appRow.form_data?.sessionInfo,
                        busId: appRow.bus_id || appRow.form_data?.busId,
                        routeId: appRow.route_id || appRow.form_data?.routeId,
                        stop_name: appRow.stop_name || appRow.form_data?.stop_name || appRow.form_data?.stop_name || appRow.form_data?.stop_name,
                        shift: appRow.shift || appRow.form_data?.shift || 'Morning',
                    },
                    application: appRow,
                    bus: null,
                    route: null,
                    driver: null,
                    tripActive: false,
                    tripData: null,
                    entitled: false,
                    entitlementReason: reason,
                });
            }

            return NextResponse.json({
                student: null,
                bus: null,
                route: null,
                driver: null,
                tripActive: false,
                tripData: null,
                entitled: false,
                entitlementReason: 'no_account',
            });
        }

        // CANONICAL entitlement gate (Phase 3): never serve live transport data
        // (bus / route / driver / trip) to a student who does not currently own
        // transport access. The profile is still returned so the dashboard can
        // render the lifecycle/renewal panel.
        const entitlement = getTransportEntitlement(studentData);
        if (!entitlement.entitled) {
            return NextResponse.json({
                student: studentData,
                bus: null,
                route: null,
                driver: null,
                tripActive: false,
                tripData: null,
                entitled: false,
                entitlementReason: entitlement.reason,
            });
        }

        const busId = studentData.busId || studentData.busId;
        const routeId = studentData.routeId || studentData.routeId;

        // 2. Parallelize everything else (bus from PG, driver from PG, route from PG)
        const [busData, dbRoute, drivers, tripStatus] = await Promise.all([
            busId ? getBusById(busId) : Promise.resolve(null),
            routeId ? routeService.getById(routeId) : Promise.resolve(null),
            busId ? getDriversByBusId(busId) : Promise.resolve([]),
            busId ? supabase.from('active_trips').select('status, start_time, last_heartbeat').eq('bus_id', busId).eq('status', 'active').maybeSingle() : Promise.resolve(null)
        ]);

        // Process Bus & Route
        const bus = busData || null;
        const route = dbRoute ? { ...dbRoute, active: dbRoute.status === 'active' } : null;

        // Process Driver (Match shift)
        let driver = null;
        if (drivers && drivers.length > 0) {
            const studentShift = (studentData.shift || 'Morning').toString().toLowerCase();
            
            // Try shift match
            driver = drivers.find((d: any) => (d.shift || '').toLowerCase().includes(studentShift));
            
            // Fallback to "Both" or first driver
            if (!driver) driver = drivers.find((d: any) => (d.shift || '').toLowerCase().includes('both'));
            if (!driver) driver = drivers[0];
        }

        // Process Trip Status
        const isTripActive = tripStatus?.data ? (tripStatus.data.status === 'on_trip' || tripStatus.data.status === 'enroute') : false;

        return NextResponse.json({
            student: studentData,
            bus,
            route,
            driver,
            tripActive: isTripActive,
            tripData: tripStatus?.data || null,
            entitled: true,
            entitlementReason: entitlement.reason,
        });
    },
    {
        requiredRoles: ['student'],
        rateLimit: RateLimits.READ
    }
);
