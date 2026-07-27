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

    const busResult = await supabase
      .from('buses')
      .select('id, bus_number, status, route_id, route_name')
      .eq('id', busId)
      .maybeSingle();

    if (!busResult.data) {
      return NextResponse.json({ found: false, error: 'Bus not found' }, { status: 404 });
    }

    return NextResponse.json({
      found: true,
      busId: busResult.data.id,
      busNumber: busResult.data.bus_number,
      status: busResult.data.status,
      routeId: busResult.data.route_id,
      routeName: busResult.data.route_name,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: ResolveBusQRSchema,
    rateLimit: RateLimits.READ,
  },
);
