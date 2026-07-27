import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/domains/identity';
import { getBusById, createBus } from '@/domains/fleet';
import * as routeService from '@/domains/route';
import { assignDriverToBus } from '@/domains/fleet/repositories/driver-assignment.repository';

/**
 * Create Bus API - PostgreSQL-backed
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

    // Check permissions in PostgreSQL (canonical source of truth)
    const user = await getUserById(decodedToken.uid);
    if (!user || !['admin', 'moderator'].includes(user.role)) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Admin or Moderator access required' },
        { status: 403 }
      );
    }

    // Parse request body
    const busData = await request.json();
    console.log('🚌 Creating bus with data:', busData);

    const {
      busId,
      busNumber,
      color,
      capacity,
      driverUID,
      routeId,
      status = 'active',
      shift,
      load
    } = busData;

    // Validate required fields
    if (!busId || !busNumber || !color || !capacity || !routeId || !shift) {
      return NextResponse.json({
        success: false,
        error: 'Missing required fields'
      }, { status: 400 });
    }

    // Check if bus ID already exists in PostgreSQL
    const existingBus = await getBusById(busId);
    if (existingBus) {
      return NextResponse.json({
        success: false,
        error: `Bus ID ${busId} already exists.`
      }, { status: 400 });
    }

    // Fetch complete route data for denormalization from PostgreSQL
    const routeData = await routeService.getById(routeId);
    if (!routeData) {
      return NextResponse.json(
        { success: false, error: `Route ${routeId} not found. Please create the route first.` },
        { status: 404 }
      );
    }

    // Parse Load Data
    const morningCount = load?.morningCount ? parseInt(load.morningCount) : 0;
    const eveningCount = load?.eveningCount ? parseInt(load.eveningCount) : 0;
    const initialLoad = {
      morningCount: isNaN(morningCount) ? 0 : morningCount,
      eveningCount: isNaN(eveningCount) ? 0 : eveningCount
    };

    // Calculate Current Members
    const currentMembers = initialLoad.morningCount + initialLoad.eveningCount;

    // Create bus in PostgreSQL (canonical source of truth)
    await createBus({
      id: busId,
      busId: busId,
      busNumber: busNumber,
      color: color,
      capacity: parseInt(capacity),
      currentMembers: currentMembers,
      routeId: routeId,
      shift: shift,
      status: status,
      load: initialLoad
    });

    // Update driver assignment via canonical repository
    if (driverUID) {
      try {
        await assignDriverToBus(driverUID, busId, {
          routeId,
          assignedBy: 'admin',
          reason: 'assignment',
        });
      } catch (e) {
        console.error('⚠️ Failed to write driver_assignments:', e);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Bus created successfully',
      busId: busId
    });

  } catch (error: any) {
    console.error('❌ Error creating bus:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}