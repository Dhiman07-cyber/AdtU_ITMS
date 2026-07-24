import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { shouldWriteLocationBreadcrumb } from '@/lib/services/location-write-throttle';

const MAX_SPEED_KMH = 200;
const MAX_JUMP_METERS = 5000;
const TIME_WINDOW_SECONDS = 5;
const MAX_LOCATION_CLOCK_SKEW_MS = 2 * 60 * 1000;

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

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

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
  async (_request, { auth, body }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId } = body;
    const driverUid = auth.uid;
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const speedNum = speed !== undefined ? Number(speed) : null;
    const headingNum = heading !== undefined ? Number(heading) : null;
    const accuracyNum = accuracy !== undefined ? Number(accuracy) : null;
    const now = normalizeLocationTimestamp(timestamp);

    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return NextResponse.json({ error: 'Valid latitude and longitude are required' }, { status: 400 });
    }

    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return NextResponse.json({ error: 'Coordinates are out of range' }, { status: 400 });
    }

    if (speedNum !== null && (!Number.isFinite(speedNum) || speedNum < 0 || speedNum > MAX_SPEED_KMH)) {
      return NextResponse.json({ error: `Speed exceeds limit (${MAX_SPEED_KMH} km/h)` }, { status: 400 });
    }

    if (accuracyNum !== null && (!Number.isFinite(accuracyNum) || accuracyNum < 0 || accuracyNum > 1000)) {
      return NextResponse.json({ error: 'Accuracy is out of range' }, { status: 400 });
    }

    if (headingNum !== null && (!Number.isFinite(headingNum) || headingNum < 0 || headingNum > 360)) {
      return NextResponse.json({ error: 'Heading is out of range' }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    const { data: activeTrip, error: activeTripError } = await supabase
      .from('active_trips')
      .select('trip_id, bus_id, route_id, driver_id, status')
      .eq('bus_id', busId)
      .eq('driver_id', driverUid)
      .eq('status', 'active')
      .maybeSingle();

    if (activeTripError || !activeTrip || activeTrip.route_id !== routeId) {
      return NextResponse.json({ error: 'No active session found for this driver/bus' }, { status: 403 });
    }

    if (tripId && activeTrip.trip_id !== tripId) {
      return NextResponse.json({ error: 'Trip mismatch for location update' }, { status: 403 });
    }

    const { data: lastLocations = [] } = await supabase
      .from('bus_locations')
      .select('lat, lng, timestamp')
      .eq('bus_id', busId)
      .eq('trip_id', activeTrip.trip_id)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (lastLocations.length > 0) {
      const lastLoc = lastLocations[0];
      const lastTime = new Date(lastLoc.timestamp).getTime();
      const timeDiff = (now.getTime() - lastTime) / 1000;

      if (timeDiff > 0 && timeDiff < TIME_WINDOW_SECONDS * 2) {
        const distance = calculateDistance(Number(lastLoc.lat), Number(lastLoc.lng), latNum, lngNum);
        if (distance > MAX_JUMP_METERS && timeDiff < TIME_WINDOW_SECONDS) {
          return NextResponse.json({ error: 'Location jump too large' }, { status: 400 });
        }
      }
    }

    const timestampIso = now.toISOString();
    const commonData = {
      bus_id: busId,
      route_id: routeId,
      driver_uid: driverUid,
      lat: latNum,
      lng: lngNum,
      accuracy: accuracyNum,
      speed: speedNum,
      heading: headingNum,
      timestamp: timestampIso,
      trip_id: activeTrip.trip_id,
    };

    const busLocationWrite = supabase.from('bus_locations').insert({ ...commonData, is_snapshot: false });
    const breadcrumbWrite = shouldWriteLocationBreadcrumb(activeTrip.trip_id, now.getTime())
      ? supabase.from('driver_location_updates').insert({
        driver_uid: driverUid,
        bus_id: busId,
        lat: latNum,
        lng: lngNum,
        accuracy: accuracyNum,
        speed: speedNum,
        heading: headingNum,
        timestamp: timestampIso,
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
      tripId: activeTrip.trip_id,
      timestamp: timestampIso,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: LocationUpdateBodySchema,
    rateLimit: RateLimits.LOCATION_UPDATE,
    allowBodyToken: true,
  }
);
