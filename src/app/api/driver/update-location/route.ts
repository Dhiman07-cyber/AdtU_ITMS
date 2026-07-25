import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { shouldWriteLocationBreadcrumb } from '@/lib/services/location-write-throttle';

// Anti-spoofing constants
const MAX_SPEED_KMH = 200;
const MAX_JUMP_METERS = 5000;
const TIME_WINDOW_SECONDS = 5;
const MAX_LOCATION_CLOCK_SKEW_MS = 2 * 60 * 1000;
const MAX_ACCURACY_METERS = 1000;

type LocationUpdateBody = {
    busId: string;
    routeId: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    timestamp?: string | number;
    tripId?: string;
};

type WriteResult = {
    error?: unknown;
};

function writeFailed(result: PromiseSettledResult<WriteResult>): boolean {
    return result.status === 'rejected' || Boolean(result.value?.error);
}

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeLocationTimestamp(timestamp: unknown): Date {
    const serverNow = new Date();
    if (!timestamp) return serverNow;

    const candidate = new Date(timestamp as string | number);
    if (Number.isNaN(candidate.getTime())) return serverNow;

    const skewMs = Math.abs(candidate.getTime() - serverNow.getTime());
    return skewMs <= MAX_LOCATION_CLOCK_SKEW_MS ? candidate : serverNow;
}

export const POST = withSecurity<LocationUpdateBody>(
    async (request, { auth, body }) => {
        const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId } = body;
        const driverUid = auth.uid;
        const latNum = Number(lat);
        const lngNum = Number(lng);
        const accuracyNum = accuracy !== undefined ? Number(accuracy) : null;
        const speedNum = speed !== undefined ? Number(speed) : null;
        const headingNum = heading !== undefined ? Number(heading) : null;
        const now = normalizeLocationTimestamp(timestamp);

        if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
            return NextResponse.json({ error: 'Valid latitude and longitude are required' }, { status: 400 });
        }

        if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
            return NextResponse.json({ error: 'Coordinates are out of range' }, { status: 400 });
        }

        // 1. Initial speed verification (fast local check)
        if (speedNum !== null && (!Number.isFinite(speedNum) || speedNum < 0 || speedNum > MAX_SPEED_KMH)) {
            return NextResponse.json({ error: `Speed exceeds limit (${MAX_SPEED_KMH} km/h)` }, { status: 400 });
        }

        if (headingNum !== null && (!Number.isFinite(headingNum) || headingNum < 0 || headingNum > 360)) {
            return NextResponse.json({ error: 'Heading is out of range' }, { status: 400 });
        }

        if (accuracyNum !== null && (!Number.isFinite(accuracyNum) || accuracyNum < 0 || accuracyNum > MAX_ACCURACY_METERS)) {
            return NextResponse.json({ error: 'Location accuracy is out of range' }, { status: 400 });
        }

        const supabase = getSupabaseServer();

        // 2. Optimized Parallel Validation
        // We check Supabase driver_status instead of Firestore for sub-second auth verification
        const [statusResult, activeTripResult] = await Promise.all([
            supabase.from('driver_status').select('status, bus_id, route_id, trip_id').eq('driver_uid', driverUid).maybeSingle(),
            supabase.from('active_trips').select('trip_id, route_id, driver_id, status').eq('bus_id', busId).eq('driver_id', driverUid).eq('status', 'active').maybeSingle(),
        ]);

        // Authorization check via Supabase state (much faster/cheaper than Firestore)
        if (
            statusResult.error ||
            activeTripResult.error ||
            !statusResult.data ||
            !activeTripResult.data ||
            statusResult.data.bus_id !== busId ||
            statusResult.data.status !== 'on_trip' ||
            statusResult.data.trip_id !== activeTripResult.data.trip_id ||
            activeTripResult.data.route_id !== routeId
        ) {
            return NextResponse.json({ error: 'No active session found for this driver/bus' }, { status: 403 });
        }

        if (tripId && activeTripResult.data.trip_id !== tripId) {
            return NextResponse.json({ error: 'Trip mismatch for location update' }, { status: 403 });
        }

        const { data: lastLocations } = await supabase
            .from('bus_locations')
            .select('lat, lng, timestamp')
            .eq('bus_id', busId)
            .eq('trip_id', activeTripResult.data.trip_id)
            .order('timestamp', { ascending: false })
            .limit(1);

        // 3. Anti-spoofing Logic
        if (lastLocations && lastLocations.length > 0) {
            const lastLoc = lastLocations[0];
            const lastTime = new Date(lastLoc.timestamp).getTime();
            const timeDiff = (now.getTime() - lastTime) / 1000;

            if (timeDiff > 0) {
                const distance = calculateDistance(Number(lastLoc.lat), Number(lastLoc.lng), latNum, lngNum);
                
                // Reject coordinate jumps that are physically impossible
                if (distance > MAX_JUMP_METERS) {
                    return NextResponse.json({ error: 'Location jump too large', details: { distance } }, { status: 400 });
                }

                // Verify calculated speed if distance is significant to prevent high-speed jumps
                if (distance > 100 && timeDiff > 0.5) {
                    const calculatedSpeedMps = distance / timeDiff;
                    const maxSpeedMps = MAX_SPEED_KMH / 3.6;
                    if (calculatedSpeedMps > maxSpeedMps) {
                        return NextResponse.json({
                            error: 'Calculated speed exceeds limit',
                            details: { calculatedSpeedKmh: calculatedSpeedMps * 3.6, limit: MAX_SPEED_KMH }
                        }, { status: 400 });
                    }
                }
            }
        }

        // 4. Parallelized Writes
        const commonData = {
            bus_id: busId, route_id: routeId, driver_uid: driverUid,
            lat: latNum, lng: lngNum, accuracy: accuracyNum, speed: speedNum,
            heading: headingNum, timestamp: now.toISOString(),
            trip_id: activeTripResult.data.trip_id
        };

        const busLocationWrite = supabase.from('bus_locations').insert({ ...commonData, is_snapshot: false });
        const breadcrumbWrite = shouldWriteLocationBreadcrumb(activeTripResult.data.trip_id, now.getTime())
            ? supabase.from('driver_location_updates').insert({
                driver_uid: driverUid, bus_id: busId, lat: latNum, lng: lngNum,
                speed: speedNum, heading: headingNum,
                timestamp: now.toISOString()
            })
            : Promise.resolve({ error: null });

        const writeResults = await Promise.allSettled([busLocationWrite, breadcrumbWrite]);
        const failedWrite = writeResults.find(writeFailed);

        if (failedWrite) {
            return NextResponse.json({ error: 'Failed to save location update' }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            message: 'Location updated successfully',
            data: { busId, routeId, lat: latNum, lng: lngNum, timestamp: now.toISOString() }
        });
    },
    {
        requiredRoles: ['driver'],
        schema: LocationUpdateBodySchema,
        rateLimit: RateLimits.LOCATION_UPDATE,
        allowBodyToken: true
    }
);
