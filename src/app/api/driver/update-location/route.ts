import { processUpdate } from '@/domains/gps';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { LocationUpdateBodySchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { busId, routeId, lat, lng, accuracy, speed, heading, timestamp, tripId, deviceId } = body as any;
    const driverUid = auth.uid;

    const requestDeviceId = deviceId || (request instanceof Request ? request.headers.get('x-device-id') : (request as any).headers?.get?.('x-device-id'));
    const supabase = getSupabaseServer();
    const { data: sessionData } = await supabase
      .from('device_sessions')
      .select('device_id, last_active_at')
      .eq('user_id', driverUid)
      .eq('feature', 'driver_location_share')
      .order('last_active_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionData) {
      const sessionAge = Date.now() - new Date(sessionData.last_active_at).getTime();
      if (sessionAge <= 30000 && (!requestDeviceId || sessionData.device_id !== requestDeviceId)) {
        return NextResponse.json({
          error: 'Active session exists on another device. Location update rejected.',
          code: 'ANOTHER_DEVICE_ACTIVE'
        }, { status: 403 });
      }
    }

    const result = await processUpdate({
      driverId: driverUid,
      tripId: tripId || '',
      busId,
      routeId,
      lat: Number(lat),
      lng: Number(lng),
      accuracy: accuracy !== undefined ? Number(accuracy) : undefined,
      heading: heading !== undefined ? Number(heading) : undefined,
      speed: speed !== undefined ? Number(speed) : undefined,
      timestamp: timestamp ? String(timestamp) : new Date().toISOString(),
    });

    if (!result.accepted) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    const n = result.normalized!;
    return NextResponse.json({
      success: true,
      message: 'Location updated successfully',
      data: { busId, routeId, lat: n.lat, lng: n.lng, timestamp: n.timestamp.toISOString() },
    });
  },
  {
    requiredRoles: ['driver'],
    schema: LocationUpdateBodySchema,
    rateLimit: RateLimits.LOCATION_UPDATE,
    allowBodyToken: true,
  }
);
