import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { adminAuth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import * as routeService from '@/domains/route';

/**
 * Create Route API
 * Updated to support PG routeService.
 */
export async function POST(request: Request) {
  try {
    // Verify authentication
    const authHeader = (await headers()).get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const decodedToken = await adminAuth.verifyIdToken(token);

    // Check if user is admin or moderator
    const userRole = await resolveUserRole(decodedToken.uid);
    if (!['admin', 'moderator'].includes(userRole.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin or Moderator access required' },
        { status: 403 }
      );
    }

    // Parse request body
    const routeData = await request.json();
    console.log('🛣️ Creating route with data:', routeData);

    const {
      routeId: providedRouteId,
      routeName,
      stops,
      status
    } = routeData;

    // Validate required fields
    if (!routeName || !stops || !Array.isArray(stops) || stops.length < 2) {
      return NextResponse.json({
        success: false,
        error: 'Route name and at least 2 stops are required'
      }, { status: 400 });
    }

    // Determine Route ID
    let routeId = providedRouteId;
    if (!routeId) {
      const num = routeName.match(/\d+/)?.[0] || Date.now().toString();
      routeId = `route_${num}`;
    }

    // Check if route already exists in PG
    const existingRoute = await routeService.getById(routeId);
    if (existingRoute) {
      return NextResponse.json(
        { success: false, error: `Route ${routeId} already exists` },
        { status: 400 }
      );
    }

    // Format stops array
    const formattedStops = stops.map((stop: any, index: number) => ({
      name: stop.name,
      sequence: index + 1,
      stopId: stop.stopId
    }));

    // Determine status from active or status field
    let mappedStatus: 'active' | 'inactive' = 'active';
    if (status !== undefined) {
      mappedStatus = String(status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
    }

    // Build complete route document
    const routeDocument: any = {
      routeId,
      routeName,
      stops: formattedStops,
      totalStops: formattedStops.length,
      status: mappedStatus,
    };

    // Create route in PG
    await routeService.create({ id: routeId, ...routeDocument });
    console.log(`✅ Route ${routeId} created successfully in PG`);

    return NextResponse.json({
      success: true,
      message: 'Route created successfully!',
      routeId,
      routeDocument: {
        ...routeDocument,
        active: mappedStatus === 'active'
      }
    });

  } catch (error: any) {
    console.error('❌ Error creating route:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create route' },
      { status: 500 }
    );
  }
}
