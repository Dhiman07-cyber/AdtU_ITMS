import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
  async (request, { auth }) => {
    const supabase = getSupabaseServer();

    const { data: buses, error } = await supabase
      .from('buses')
      .select('id, bus_number, status, route_id, route_name, capacity')
      .neq('status', 'inactive')
      .order('bus_number');

    if (error) {
      console.error('Error fetching available buses:', error);
      return NextResponse.json({ buses: [] });
    }

    return NextResponse.json({ buses: buses || [] });
  },
  {
    requiredRoles: ['driver'],
    rateLimit: RateLimits.READ,
  },
);
