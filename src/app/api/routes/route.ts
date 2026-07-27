import * as routeService from '@/domains/route';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { NextRequest,NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require authentication (any logged-in user can view routes)
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return auth.response;

    // Rate limit
    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'routes-list'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const routes = await routeService.getAll();
    const mappedRoutes = routes.map(r => ({
      ...r,
      active: r.status === 'active'
    }));

    return NextResponse.json(mappedRoutes, { headers: rl.headers });
  } catch (error) {
    console.error('Error fetching routes:', error);
    return NextResponse.json(handleApiError(error, 'routes-get', 'Failed to fetch routes'), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Only admin/moderator can create routes
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // Rate limit
    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'routes-create'), RateLimits.CREATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const newRouteData = await request.json();

    // Input validation
    if (!newRouteData.routeName || typeof newRouteData.routeName !== 'string' || newRouteData.routeName.length > 200) {
      return NextResponse.json({ error: 'Valid route name is required (max 200 chars)' }, { status: 400 });
    }
    if (!newRouteData.stops || !Array.isArray(newRouteData.stops) || newRouteData.stops.length < 2) {
      return NextResponse.json({ error: 'At least 2 stops are required' }, { status: 400 });
    }

    // Determine status from active or status field
    let mappedStatus: 'active' | 'inactive' = 'active';
    if (newRouteData.status !== undefined) {
      mappedStatus = String(newRouteData.status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
    } else if (newRouteData.active !== undefined) {
      mappedStatus = newRouteData.active ? 'active' : 'inactive';
    }

    const newRoute = {
      routeId: newRouteData.routeId || `route_${Date.now()}`,
      routeName: newRouteData.routeName.trim().substring(0, 200),
      stops: newRouteData.stops,
      totalStops: newRouteData.stops.length,
      estimatedTime: (newRouteData.estimatedTime || '').substring(0, 50),
      status: mappedStatus,
    };

    const docId = await routeService.create(newRoute);

    return NextResponse.json({ id: docId, ...newRoute, active: mappedStatus === 'active' }, { status: 201, headers: rl.headers });
  } catch (error) {
    console.error('Error adding route:', error);
    return NextResponse.json(handleApiError(error, 'routes-post', 'Failed to add route'), { status: 500 });
  }
}