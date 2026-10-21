import { parseQRPayload } from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getBusIdVariations } from '@/lib/utils';
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
      const trimmedQr = qrData.trim();
      const qrVariations = Array.from(new Set([
        ...getBusIdVariations(trimmedQr),
        ...(/^\d+$/.test(trimmedQr.replace(/^bus_/, ''))
          ? [
              trimmedQr.replace(/^bus_/, '').padStart(2, '0'),
              `bus_${trimmedQr.replace(/^bus_/, '').padStart(2, '0')}`,
              String(parseInt(trimmedQr.replace(/^bus_/, ''), 10)),
              `bus_${parseInt(trimmedQr.replace(/^bus_/, ''), 10)}`
            ]
          : [])
      ]));
      const busByNumber = await supabase
        .from('buses')
        .select('id')
        .in('bus_number', qrVariations)
        .limit(1)
        .maybeSingle();

      if (busByNumber.data) {
        busId = busByNumber.data.id;
      }
    }

    if (!busId) {
      return NextResponse.json({ found: false, error: 'No bus found for this QR code' }, { status: 404 });
    }

    const busVariations = Array.from(new Set([
      ...getBusIdVariations(busId),
      ...(/^\d+$/.test(busId.replace(/^bus_/, ''))
        ? [
            busId.replace(/^bus_/, '').padStart(2, '0'),
            `bus_${busId.replace(/^bus_/, '').padStart(2, '0')}`,
            String(parseInt(busId.replace(/^bus_/, ''), 10)),
            `bus_${parseInt(busId.replace(/^bus_/, ''), 10)}`
          ]
        : [])
    ]));
    const now = new Date().toISOString();
    const [busResult, activeTripResult] = await Promise.all([
      supabase
        .from('buses')
        .select('id, bus_number, status, route_id, route_name')
        .in('id', busVariations)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('active_trips')
        .select('trip_id, driver_id')
        .in('bus_id', busVariations)
        .eq('status', 'active')
        .gt('expires_at', now)
        .limit(1)
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
