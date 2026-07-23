import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getDriverById, updateDriver } from '@/domains/identity';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canEdit');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    const requestBody = await request.json();

    const ALLOWED_FIELDS = new Set([
      'fullName', 'name', 'email', 'phone', 'employeeId', 'profilePhotoUrl', 'phone_number'
    ]);
    const BLOCKED_FIELDS = new Set([
      'busId', 'routeId', 'role', 'status', 'busId', 'routeId'
    ]);

    const updatedDriverData: Record<string, any> = {};
    for (const [key, value] of Object.entries(requestBody)) {
      if (BLOCKED_FIELDS.has(key)) {
        console.warn(`Blocked attempt to update forbidden field: ${key}`);
        continue;
      }
      if (ALLOWED_FIELDS.has(key)) {
        updatedDriverData[key] = value;
      }
    }

    const existingDriver = await getDriverById(id);
    if (!existingDriver) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }

    updatedDriverData.updatedAt = new Date().toISOString();
    await updateDriver(id, updatedDriverData);

    const freshDriver = await getDriverById(id);
    return NextResponse.json({
      id,
      name: (freshDriver as any)?.fullName || (freshDriver as any)?.name || '',
      email: (freshDriver as any)?.email || '',
      phone: (freshDriver as any)?.phone || '',
      ...freshDriver,
    });
  } catch (error: any) {
    console.error('Error updating driver:', error);
    return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 });
  }
}
