import { getCanonicalRouteGeometry, CANONICAL_ROUTE_GEOMETRIES } from '@/domains/route/data/canonical-route-geometries';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator', 'driver', 'student']);
    if (!auth.authenticated) return auth.response;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Route ID is required' }, { status: 400 });
    }

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'routes-geometry'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const coordinates = getCanonicalRouteGeometry(id);
    const cleanId = id.trim().toLowerCase().replace(/-/g, '_');
    const meta = CANONICAL_ROUTE_GEOMETRIES[cleanId];

    return NextResponse.json(
      {
        success: true,
        routeId: id,
        routeName: meta?.routeName || id,
        coordinates: coordinates || [],
        hasGeometry: Boolean(coordinates && coordinates.length > 0),
      },
      {
        headers: {
          ...rl.headers,
          'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching route geometry:', error);
    return NextResponse.json({ error: 'Failed to fetch route geometry' }, { status: 500 });
  }
}
