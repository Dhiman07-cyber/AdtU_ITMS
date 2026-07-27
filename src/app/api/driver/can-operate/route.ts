import * as tripService from '@/domains/trip';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { BusIdSchema } from '@/lib/security/validation-schemas';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { busId } = body as any;
    const driverId = auth.uid;

    const supabase = getSupabaseServer();

    const { data: bus } = await supabase.from('buses').select('id, status').eq('id', busId).maybeSingle();

    if (!bus) {
      return NextResponse.json({ error: 'Bus not found' }, { status: 404 });
    }

    if (bus.status === 'inactive') {
      return NextResponse.json({
        allowed: false,
        reason: 'This bus is inactive.',
      });
    }

    const result = await tripService.canOperate(driverId, busId);

    return NextResponse.json({
      allowed: result.allowed,
      reason: result.allowed ? undefined : result.reason,
    });
  },
  {
    requiredRoles: ['driver'],
    schema: BusIdSchema,
    rateLimit: RateLimits.READ,
    allowBodyToken: true,
  }
);
