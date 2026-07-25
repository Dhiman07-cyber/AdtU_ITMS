import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getBusById, updateBus, removeBus } from '@/domains/fleet/services/fleet.service';

// D6 Fleet — Bus CRUD API. Runtime owner: PostgreSQL (fleet.repository.pg → buses table).
// NOTE: /api/buses/create and /api/buses/update handle the complex transactional variants
// with Firestore capacity writes (cross-domain, owned by Application/Assignment domains).
// This endpoint handles the admin CRUD for pure bus master-data.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator', 'driver', 'student']);
    if (!auth.authenticated) return auth.response;

    if (auth.role === 'moderator') {
      const permissionDenied = await requireModeratorPermission(auth, 'buses', 'canView');
      if (permissionDenied) return permissionDenied;
    }

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Bus ID is required' }, { status: 400 });

    const bus = await getBusById(id);
    if (!bus) return NextResponse.json({ error: 'Bus not found' }, { status: 404 });

    return NextResponse.json(bus);
  } catch (error: any) {
    console.error('Error fetching bus data:', error);
    return NextResponse.json({ error: 'Failed to fetch bus data' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'buses', 'canEdit');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Bus ID is required' }, { status: 400 });

    const requestBody = await request.json();

    // FIELD ALLOW-LIST: Only safe fields may be updated via this API.
    // Complex assignment/capacity updates go through /api/buses/update (transaction-safe).
    const ALLOWED_FIELDS = new Set(['busNumber', 'busName', 'routeId', 'capacity', 'status', 'notes', 'model', 'year', 'routeName', 'driverName']);
    const BLOCKED_FIELDS = new Set(['activeDriverId', 'assignedDriverId', 'driverUID']);

    const busData: Record<string, any> = {};
    for (const [key, value] of Object.entries(requestBody)) {
      if (BLOCKED_FIELDS.has(key)) {
        console.warn(`Blocked attempt to update forbidden field via admin API: ${key}`);
        continue;
      }
      if (ALLOWED_FIELDS.has(key)) {
        busData[key] = value;
      }
    }

    const ok = await updateBus(id, busData);
    if (!ok) return NextResponse.json({ error: 'Failed to update bus' }, { status: 500 });

    const updated = await getBusById(id);
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('Error updating bus data:', error);
    return NextResponse.json({ error: 'Failed to update bus data' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'buses', 'canDelete');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Bus ID is required' }, { status: 400 });

    console.log(`Deleting bus with ID: ${id}`);

    // Use centralized cleanup helper to delete bus and associated data (students, etc.)
    const { deleteBusAndData } = await import('@/lib/cleanup-helpers');
    const result = await deleteBusAndData(id);

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to delete bus' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Bus deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting bus:', error);
    return NextResponse.json({ error: 'Failed to delete bus' }, { status: 500 });
  }
}
