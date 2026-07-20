import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { getAllBuses, getBusesByRouteId, createBus } from '@/domains/fleet/services/fleet.service';

// D6 Fleet — Bus list API. Runtime owner: PostgreSQL (fleet.repository.pg → buses table).

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require authentication (any logged-in user can view buses for application forms)
    const auth = await verifyApiAuth(request);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'buses-list'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    const routeId = searchParams.get('routeId');

    const buses = routeId
      ? await getBusesByRouteId(routeId)
      : await getAllBuses();

    return NextResponse.json({ buses }, { headers: rl.headers });
  } catch (error: any) {
    console.error('Error fetching buses:', error);
    return NextResponse.json(handleApiError(error, 'buses-get', 'Failed to fetch buses'), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'buses-create'), RateLimits.CREATE);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const busData = await request.json();

    if (!busData.busNumber || typeof busData.busNumber !== 'string' || busData.busNumber.length > 50) {
      return NextResponse.json({ error: 'Valid bus number is required (max 50 chars)' }, { status: 400 });
    }
    if (!busData.routeId || typeof busData.routeId !== 'string' || busData.routeId.length > 100) {
      return NextResponse.json({ error: 'Valid route ID is required' }, { status: 400 });
    }
    if (busData.capacity && (typeof busData.capacity !== 'number' || busData.capacity < 1 || busData.capacity > 200)) {
      return NextResponse.json({ error: 'Capacity must be 1-200' }, { status: 400 });
    }

    const id = busData.busId || `bus_${Date.now()}`;
    const newBus = {
      id,
      busId: id,
      busNumber: busData.busNumber.trim(),
      model: (busData.model || 'Standard Model').substring(0, 100),
      capacity: busData.capacity || 50,
      driverUID: busData.driverUID || null,
      driverName: (busData.driverName || '').substring(0, 200),
      routeId: busData.routeId.trim(),
      routeName: (busData.routeName || '').substring(0, 200),
      status: busData.status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await createBus(newBus);

    return NextResponse.json({ id: newBus.id, ...newBus }, { status: 201, headers: rl.headers });
  } catch (error: any) {
    console.error('Error creating bus:', error);
    return NextResponse.json(handleApiError(error, 'buses-post', 'Failed to create bus'), { status: 500 });
  }
}