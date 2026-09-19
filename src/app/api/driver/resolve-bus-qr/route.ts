import { parseQRPayload } from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ResolveBusQRSchema = z.object({
  qrData: z.string().min(1).max(500),
});

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { qrData } = body as z.infer<typeof ResolveBusQRSchema>;
    const supabase = getSupabaseServer();

    let busId: string | null = null;

    try {
      const contract = parseQRPayload(qrData);
      if (contract.busId) {
        busId = contract.busId;
      }
    } catch {
      busId = null;
    }

    if (!busId) {
      const busByNumber = await supabase
        .from('buses')
        .select('id')
        .eq('bus_number', qrData.trim())
        .maybeSingle();

      if (busByNumber.data) {
        busId = busByNumber.data.id;
      }
    }

    if (!busId) {
      return NextResponse.json({ found: false, error: 'No bus found for this QR code' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const [busResult, activeTripResult] = await Promise.all([
      supabase
        .from('buses')
        .select('id, bus_number, status, route_id, route_name')
        .eq('id', busId)
        .maybeSingle(),
      supabase
        .from('active_trips')
        .select('trip_id, driver_id')
        .eq('bus_id', busId)
        .eq('status', 'active')
        .gt('expires_at', now)
        .maybeSingle(),
    ]);

    if (!busResult.data) {
      return NextResponse.json({ found: false, error: 'Bus not found' }, { status: 404 });
    }

    const activeTrip = activeTripResult.data;
    const isOperatedByOther = !!(activeTrip && activeTrip.driver_id !== auth.uid);

    return NextResponse.json({
      found: true,
      busId: busResult.data.id,
      busNumber: busResult.data.bus_number,
      status: busResult.data.status,
      routeId: busResult.data.route_id,
      routeName: busResult.data.route_name,
      isInTrip: !!activeTrip,
      is_operated_by_other: isOperatedByOther,
      isOperatedByOther,
      activeDriverId: activeTrip?.driver_id || null,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: ResolveBusQRSchema,
    rateLimit: RateLimits.READ,
  },
);
