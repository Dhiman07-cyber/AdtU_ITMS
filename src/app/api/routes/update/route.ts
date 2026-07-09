import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import * as routeService from '@/domains/route';

/**
 * Update Route API
 * Modifies only the route document in PostgreSQL.
 * Supports both PUT and POST.
 */
async function handleUpdate(request: Request) {
  try {
    const authHeader = (await headers()).get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userDoc = await adminDb.collection('users').doc(decodedToken.uid).get();

    if (!userDoc.exists || !['admin', 'moderator'].includes(userDoc.data()?.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { routeId, routeName, status, active, stops } = body;

    if (!routeId) {
      return NextResponse.json({ success: false, error: 'Route ID is required' }, { status: 400 });
    }

    // Determine status from active or status field
    let mappedStatus: 'active' | 'inactive' = 'active';
    if (status !== undefined) {
      mappedStatus = String(status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
    } else if (active !== undefined) {
      mappedStatus = active ? 'active' : 'inactive';
    }

    const cleanData: any = {
      status: mappedStatus,
    };
    if (routeName !== undefined) cleanData.routeName = routeName;
    
    if (stops !== undefined && Array.isArray(stops)) {
      // Format stops
      const formattedStops = stops.map((stop: any, index: number) => ({
        name: stop.name,
        sequence: index + 1,
        stopId: stop.stopId
      }));
      cleanData.stops = formattedStops;
      cleanData.totalStops = formattedStops.length;
    }

    // Update Route in PG only (Strict Isolation)
    const success = await routeService.update(routeId, cleanData);

    if (!success) {
      return NextResponse.json({ success: false, error: 'Route not found or update failed' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Route updated successfully in PG' });

  } catch (error: any) {
    console.error('Update route error:', error);
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  return handleUpdate(request);
}

export async function POST(request: Request) {
  return handleUpdate(request);
}
