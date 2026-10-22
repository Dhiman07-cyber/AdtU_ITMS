import * as routeService from '@/domains/route';
import { RATE_LIMITS } from '@/lib/security/rate-limiter';
import { withSecurity } from '@/lib/security/api-security';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

function extractRouteId(url: string): string | null {
  const match = url.match(/\/api\/routes\/([^/?#]+)\/stops/);
  return match ? decodeURIComponent(match[1]) : null;
}

export const GET = withSecurity(
  async (request) => {
    try {
      const routeId = extractRouteId(request.url);

      if (!routeId) {
        return NextResponse.json({ error: 'Route ID is required' }, { status: 400 });
      }

      const cleanRoute = String(routeId).replace(/^route_/i, '').trim();
      const routeVariations = Array.from(
        new Set([String(routeId).trim(), `route_${cleanRoute}`, cleanRoute, `Route-${cleanRoute}`, `Route ${cleanRoute}`])
      );

      let route = null;
      for (const variation of routeVariations) {
        route = await routeService.getById(variation);
        if (route) break;
      }

      if (!route) {
        const supabase = getSupabaseServer();
        const { data } = await supabase
          .from('routes')
          .select('*')
          .in('id', routeVariations)
          .limit(1)
          .maybeSingle();

        if (data) {
          route = {
            id: data.id,
            name: data.route_name || data.name,
            stops: data.stops || [],
          } as any;
        }
      }

      if (!route) {
        return NextResponse.json({ error: 'Route not found' }, { status: 404 });
      }

      const stops = route.stops || [];

      return NextResponse.json({
        stops,
      });
    } catch (error: any) {
      console.error('Error fetching stops:', error);
      return NextResponse.json(
        { error: 'Failed to fetch stops' },
        { status: 500 }
      );
    }
  },
  {
    rateLimit: RATE_LIMITS.READ,
  }
);
