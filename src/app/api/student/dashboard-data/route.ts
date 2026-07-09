import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { getByUid } from '@/domains/student';
import * as routeService from '@/domains/route';

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

        const busId = studentData.busId || studentData.assignedBusId;
        const routeId = studentData.routeId || studentData.assignedRouteId;

        // 2. Parallelize everything else (bus/driver in Firestore, route in PG via Route Service)
        const [busSnap, dbRoute, driverSnaps, tripStatus] = await Promise.all([
            busId ? adminDb.collection('buses').doc(busId).get() : Promise.resolve(null),
            routeId ? routeService.getById(routeId) : Promise.resolve(null),
            busId ? adminDb.collection('drivers').where('assignedBusId', '==', busId).get() : Promise.resolve(null),
            busId ? supabase.from('driver_status').select('status, started_at, last_updated_at').eq('bus_id', busId).maybeSingle() : Promise.resolve(null)
        ]);

        // Process Bus & Route
        const bus = busSnap?.exists ? { id: busSnap.id, ...busSnap.data() } : null;
        const route = dbRoute ? { ...dbRoute, active: dbRoute.status === 'active' } : null;

        // Process Driver (Match shift)
        let driver = null;
        if (driverSnaps && !driverSnaps.empty) {
            const drivers = driverSnaps.docs.map(d => ({ id: d.id, ...d.data() }));
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
