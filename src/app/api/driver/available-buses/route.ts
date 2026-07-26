import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase-server';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getBusIdByDriverUid } from '@/domains/fleet/repositories/driver-assignment.repository';

export const GET = withSecurity(
  async (request, { auth }) => {
    const driverUid = auth.uid;
    const supabase = getSupabaseServer();

    const assignedBusId = await getBusIdByDriverUid(driverUid);

    let busIds: string[] = [];
    if (assignedBusId) {
      busIds.push(assignedBusId);
    }

    const { data: busByDriverUid } = await supabase
      .from('buses')
      .select('id')
      .eq('driver_uid', driverUid);

    if (busByDriverUid) {
      for (const b of busByDriverUid) {
        if (!busIds.includes(b.id)) busIds.push(b.id);
      }
    }

    if (busIds.length === 0) {
      return NextResponse.json({ buses: [] });
    }

    const { data: buses } = await supabase
      .from('buses')
      .select('id, bus_number, status, route_id, route_name, capacity')
      .in('id', busIds)
      .order('bus_number');

    return NextResponse.json({ buses: buses || [] });
  },
  {
    requiredRoles: ['driver'],
    rateLimit: RateLimits.READ,
  },
);
