import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import * as routeService from '@/domains/route';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'routes', 'canEdit');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Route ID is required' }, { status: 400 });
    }

    const updatedRouteData = await request.json();

    const updated = {
      ...updatedRouteData,
      totalStops: Array.isArray(updatedRouteData.stops) ? updatedRouteData.stops.length : 0,
      updatedAt: new Date().toISOString()
    };

    const success = await routeService.update(id, updated);

    if (!success) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating route:', error);
    return NextResponse.json({ error: 'Failed to update route' }, { status: 500 });
  }
}
