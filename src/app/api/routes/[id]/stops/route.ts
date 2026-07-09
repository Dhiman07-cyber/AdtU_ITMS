import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import * as routeService from '@/domains/route';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await adminAuth.verifyIdToken(token);

    const { id: routeId } = await params;

    const route = await routeService.getById(routeId);

    if (!route) {
      return NextResponse.json({ error: 'Route not found' }, { status: 404 });
    }

    const stops = route.stops || [];

    return NextResponse.json({
      stops
    });
  } catch (error: any) {
    console.error('Error fetching stops:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stops' },
      { status: 500 }
    );
  }
}
