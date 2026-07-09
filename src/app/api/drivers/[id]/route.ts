import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getDriverById, updateDriver, removeDriver } from '@/domains/fleet/services/fleet.service';

// D6 Fleet — Driver CRUD API. Runtime owner: PostgreSQL (driver_profiles table).

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canView');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Driver ID is required' }, { status: 400 });

    const driver = await getDriverById(id);
    if (!driver) return NextResponse.json({ error: 'Driver not found' }, { status: 404 });

    return NextResponse.json({ driver });
  } catch (error) {
    console.error('Error fetching driver:', error);
    return NextResponse.json({ error: 'Failed to fetch driver' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canEdit');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Driver ID is required' }, { status: 400 });

    const data = await request.json();
    const ok = await updateDriver(id, data);
    if (!ok) return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 });

    const updated = await getDriverById(id);
    return NextResponse.json({ driver: updated });
  } catch (error) {
    console.error('Error updating driver:', error);
    return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canDelete');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Driver ID is required' }, { status: 400 });

    const ok = await removeDriver(id);
    if (!ok) return NextResponse.json({ error: 'Failed to delete driver' }, { status: 500 });

    return NextResponse.json({ success: true, message: 'Driver deleted successfully' });
  } catch (error) {
    console.error('Error deleting driver:', error);
    return NextResponse.json({ error: 'Failed to delete driver' }, { status: 500 });
  }
}
