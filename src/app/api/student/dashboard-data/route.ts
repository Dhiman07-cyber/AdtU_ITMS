import { getBusById } from '@/domains/fleet';
import * as routeService from '@/domains/route';
import { getByUid } from '@/domains/student';
import { getTransportEntitlement } from '@/lib/entitlement/transport-entitlement';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSharedBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';
import { getSupabaseServer } from '@/lib/supabase-server';
import { isShiftCompatible, getBusIdVariations } from '@/lib/utils';
import { isWaitingFlagExpired } from '@/lib/waiting-flag-helpers';
import { NextResponse } from 'next/server';

interface CachedDriverDisplay {
    uid: string;
    fullName: string;
    phone: string | null;
    profilePhotoUrl: string | null;
    joiningDate?: string | null;
    expiresAtMs: number;
}

const DRIVER_DISPLAY_TTL_MS = 60 * 1000; // 60-second L1 cache
const MAX_DRIVER_CACHE = 200;
const driverDisplayCache = new Map<string, CachedDriverDisplay>();

export function clearDriverDisplayCache(): void {
    driverDisplayCache.clear();
}

async function getCachedDriverDisplay(driverUid: string, supabase: any): Promise<CachedDriverDisplay | null> {
    const cached = driverDisplayCache.get(driverUid);
    if (cached && Date.now() < cached.expiresAtMs) {
        return cached;
    }

    try {
        const { data: driverRow } = await supabase
            .from('driver_profiles')
            .select('uid, full_name, phone, profile_photo_url, joining_date, status')
            .eq('uid', driverUid)
            .maybeSingle();

        if (driverRow) {
            const entry: CachedDriverDisplay = {
                uid: driverRow.uid,
                fullName: driverRow.full_name || 'Driver',
                phone: driverRow.phone || null,
                profilePhotoUrl: driverRow.profile_photo_url || null,
                joiningDate: driverRow.joining_date || null,
                expiresAtMs: Date.now() + DRIVER_DISPLAY_TTL_MS,
            };

            if (driverDisplayCache.size >= MAX_DRIVER_CACHE) {
                const oldest = driverDisplayCache.keys().next().value;
                if (oldest) driverDisplayCache.delete(oldest);
            }
            driverDisplayCache.set(driverUid, entry);
            return entry;
        }
    } catch (err) {
        console.warn('Failed to query driver_profiles for driver display:', err);
    }

    return null;
}

/**
 * GET /api/student/dashboard-data
 * 
 * COMPREHENSIVE DASHBOARD DATA FETCH
 * Fetches student profile, bus, route, driver, and live trip status with coalesced singleflight caching.
 */
export const GET = withSecurity(
    async (request, { auth }) => {
        const uid = auth.uid;
        const supabase = getSupabaseServer();

        // 1. Fetch Student Profile and Application fallback in parallel
        const [studentDataRes, appRes] = await Promise.all([
            getByUid(uid).catch(() => null),
            supabase
                .from('applications')
                .select('application_id, application_type, state, applicant_email, form_data, target_session, bus_id, route_id, stop_name, shift, created_at')
                .eq('applicant_uid', uid)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
        ]);

        let studentData = studentDataRes as Record<string, any> | null;
        const appRow = appRes?.data;

        // FIX 19: Prioritize Active student_profiles Over Stale applications
        // If student_profiles exists and is active (or has bus/route assigned), treat as active student.
        // NEVER overwrite student.status with leftover applications.state!
        let renewalApplication: any = null;
        if (studentData) {
            const hasActiveMarkers = studentData.status === 'active' || !!studentData.busId || !!studentData.bus_id;
            if (hasActiveMarkers && studentData.status !== 'soft_blocked' && studentData.status !== 'hard_blocked') {
                studentData.status = 'active';
            }
            if (appRow && (appRow.application_type === 'renewal' || appRow.form_data?.isRenewal) &&
                ['submitted', 'awaiting_verification', 'pending_seat_allocation'].includes(appRow.state)) {
                renewalApplication = appRow;
            }
        } else if (appRow) {
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
                    stop_name: appRow.stop_name || appRow.form_data?.stop_name || appRow.form_data?.stopName,
                    shift: appRow.shift || appRow.form_data?.shift || 'Morning',
                },
                application: appRow,
                renewalApplication: null,
                bus: null,
                route: null,
                driver: null,
                tripActive: false,
                tripData: null,
                entitled: false,
                entitlementReason: reason,
            });
        } else {
            return NextResponse.json({
                student: null,
                renewalApplication: null,
                bus: null,
                route: null,
                driver: null,
                tripActive: false,
                tripData: null,
                entitled: false,
                entitlementReason: 'no_account',
            });
        }

        // CANONICAL entitlement gate (Phase 3)
        const entitlement = getTransportEntitlement(studentData);
        if (!entitlement.entitled) {
            return NextResponse.json({
                student: studentData,
                renewalApplication,
                bus: null,
                route: null,
                driver: null,
                tripActive: false,
                tripData: null,
                entitled: false,
                entitlementReason: entitlement.reason,
            });
        }

        // FIX 21: Bus Lookup Across ID Variations & bus_number
        const rawBusId = studentData.busId || studentData.bus_id || studentData.assignedBusId;
        let busData: any = null;
        if (rawBusId) {
            const busVariations = getBusIdVariations(rawBusId);
            const { data: busesById } = await supabase
                .from('buses')
                .select('*')
                .in('id', busVariations.length > 0 ? busVariations : [rawBusId])
                .limit(1);
            busData = busesById?.[0] || null;

            if (!busData && busVariations.length > 0) {
                const { data: busesByNum } = await supabase
                    .from('buses')
                    .select('*')
                    .in('bus_number', busVariations)
                    .limit(1);
                busData = busesByNum?.[0] || null;
            }
            if (!busData) {
                busData = await getBusById(rawBusId).catch(() => null);
            }
            if (busData?.id) {
                studentData.busId = busData.id;
                studentData.bus_id = busData.id;
            }
        }
        const canonicalBusId = busData?.id || rawBusId;

        // FIX 22: Route Lookup Fallback to bus.route_id & Route ID Variations
        const rawRouteId = studentData.routeId || studentData.route_id || studentData.assignedRouteId || busData?.routeId || busData?.route_id;
        let dbRoute: any = null;
        if (rawRouteId) {
            const cleanRoute = String(rawRouteId).replace(/^route_/i, '').trim();
            const routeVariations = Array.from(new Set([
                String(rawRouteId).trim(),
                `route_${cleanRoute}`,
                cleanRoute,
                `Route-${cleanRoute}`,
                `Route ${cleanRoute}`
            ]));

            const { data: routesById } = await supabase
                .from('routes')
                .select('*')
                .in('id', routeVariations)
                .limit(1);
            dbRoute = routesById?.[0] || null;

            if (!dbRoute) {
                const { data: routesByName } = await supabase
                    .from('routes')
                    .select('*')
                    .in('route_name', routeVariations)
                    .limit(1);
                dbRoute = routesByName?.[0] || null;
            }
            if (!dbRoute) {
                dbRoute = await routeService.getById(rawRouteId).catch(() => null);
            }
            if (dbRoute?.id) {
                studentData.routeId = dbRoute.id;
                studentData.route_id = dbRoute.id;
            }
        }

        // 2. Parallelize trip snapshot and waiting flag reads:
        const [tripSnapshot, waitingFlagRes] = await Promise.all([
            canonicalBusId ? getSharedBusTripSnapshot(canonicalBusId) : Promise.resolve(null),
            supabase.from('waiting_flags').select('id, student_uid, bus_id, status, trip_id, stop_name, created_at, expires_at').eq('student_uid', uid).in('status', ['raised', 'acknowledged', 'waiting']).limit(1)
        ]);

        // Process Bus & Route
        const bus = busData || null;
        const route = dbRoute ? { ...dbRoute, active: dbRoute.status === 'active' } : null;

        // Process Trip Status (Match student shift strictly with trip shift)
        const studentShift = studentData.shift;
        let isTripActive = tripSnapshot?.tripActive ?? false;
        const tripData = tripSnapshot?.tripData || null;

        if (isTripActive && tripData) {
            if (!studentShift || !isShiftCompatible(studentShift, tripData.shift)) {
                isTripActive = false;
            }
        }

        // Process Driver (2-Tier Authority: Live On-Duty Driver -> Primary Driver -> Relief Pool Fallback)
        let driver: any = null;

        if (isTripActive && tripData?.driverUid) {
            const liveDriver = await getCachedDriverDisplay(tripData.driverUid, supabase);

            if (liveDriver) {
                driver = {
                    uid: liveDriver.uid,
                    fullName: liveDriver.fullName,
                    driverName: liveDriver.fullName,
                    name: liveDriver.fullName,
                    phone: liveDriver.phone,
                    profilePhotoUrl: liveDriver.profilePhotoUrl,
                    joiningDate: liveDriver.joiningDate,
                    driverStatus: 'on_duty_live',
                    activeShift: tripData.shift,
                };
            } else {
                driver = {
                    uid: tripData.driverUid,
                    fullName: 'Active Transit Driver',
                    driverName: 'Active Transit Driver',
                    name: 'Active Transit Driver',
                    driverStatus: 'on_duty_live',
                    activeShift: tripData.shift,
                };
            }
        } else {
            // Bus is Off-Duty: resolve Primary Driver
            const primaryDriverUid = bus?.primaryDriverUid || bus?.driverUID || bus?.primary_driver_uid || bus?.driver_uid;
            if (primaryDriverUid) {
                const primaryDriver = await getCachedDriverDisplay(primaryDriverUid, supabase);

                if (primaryDriver) {
                    driver = {
                        uid: primaryDriver.uid,
                        fullName: primaryDriver.fullName,
                        driverName: primaryDriver.fullName,
                        name: primaryDriver.fullName,
                        phone: primaryDriver.phone,
                        profilePhotoUrl: primaryDriver.profilePhotoUrl,
                        joiningDate: primaryDriver.joiningDate,
                        driverStatus: 'off_duty_primary',
                    };
                } else if (bus?.driverName || bus?.driver_name) {
                    driver = {
                        uid: primaryDriverUid,
                        fullName: bus.driverName || bus.driver_name,
                        driverName: bus.driverName || bus.driver_name,
                        name: bus.driverName || bus.driver_name,
                        driverStatus: 'off_duty_primary',
                    };
                }
            } else if (bus?.driverName || bus?.driver_name) {
                driver = {
                    fullName: bus.driverName || bus.driver_name,
                    driverName: bus.driverName || bus.driver_name,
                    name: bus.driverName || bus.driver_name,
                    driverStatus: 'off_duty_primary',
                };
            } else {
                driver = {
                    fullName: 'Transit Relief Pool Operator',
                    driverName: 'Transit Relief Pool Operator',
                    name: 'Transit Relief Pool Operator',
                    driverStatus: 'relief_pool',
                };
            }
        }

        const flagCandidate = waitingFlagRes?.data?.[0];
        const isFlagExpired = isWaitingFlagExpired(flagCandidate);
        const activeWaitingFlag = (isTripActive && flagCandidate && !isFlagExpired)
            ? flagCandidate
            : null;

        const formattedTripData = (isTripActive && tripData) ? {
            ...tripData,
            trip_id: tripData.tripId,
            driver_id: tripData.driverUid,
            start_time: tripData.startedAt,
            last_heartbeat: tripData.lastUpdated,
        } : null;

        return NextResponse.json({
            student: studentData,
            renewalApplication,
            bus,
            route,
            driver,
            tripActive: isTripActive,
            tripData: formattedTripData,
            activeWaitingFlag,
            entitled: true,
            entitlementReason: entitlement.reason,
        });
    },
    {
        requiredRoles: ['student'],
        rateLimit: RateLimits.READ
    }
);
