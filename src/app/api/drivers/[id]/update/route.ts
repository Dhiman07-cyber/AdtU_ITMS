import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { adminDb } from '@/lib/firebase-admin';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'drivers', 'canEdit');
    if (permissionDenied) return permissionDenied;

    if (!adminDb) {
      return NextResponse.json({ error: 'Database not available' }, { status: 500 });
    }

    const { id } = await params;
    const requestBody = await request.json();

    // FIELD ALLOW-LIST: Only safe fields may be updated via API
    const ALLOWED_FIELDS = new Set([
      'fullName', 'name', 'email', 'phone', 'employeeId', 'photoURL', 'phone_number'
    ]);
    const BLOCKED_FIELDS = new Set([
      'busId', 'routeId', 'role', 'status', 'assignedBusId', 'assignedRouteId'
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

    const driverDocRef = adminDb.collection('drivers').doc(id);
    const driverDoc = await driverDocRef.get();
    if (!driverDoc.exists) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }

    if (updatedDriverData.profilePhotoUrl !== undefined) {
      if (typeof updatedDriverData.profilePhotoUrl !== 'string') {
        delete updatedDriverData.profilePhotoUrl;
      } else if (updatedDriverData.profilePhotoUrl.trim() === '') {
        updatedDriverData.profilePhotoUrl = null;
      }
    }

    updatedDriverData.updatedAt = new Date().toISOString();

    await driverDocRef.update(updatedDriverData);

    const freshDoc = await driverDocRef.get();
    const data = freshDoc.data();
    const updatedDriver = {
      id: freshDoc.id,
      name: data?.fullName || data?.name || '',
      email: data?.email || '',
      phone: data?.phone || '',
      alternatePhone: data?.alternatePhone || '',
      licenseNumber: data?.licenseNumber || '',
      busAssigned: data?.busAssigned || data?.assignedBusId || '',
      routeId: data?.routeId || data?.assignedRouteId || '',
      profilePhotoUrl: data?.profilePhotoUrl || '',
      dob: data?.dob || '',
      joiningDate: data?.joiningDate || '',
      aadharNumber: data?.aadharNumber || '',
      employeeId: data?.employeeId || '',
      address: data?.address || '',
    };

    return NextResponse.json(updatedDriver);
  } catch (error: any) {
    console.error('Error updating driver:', error);
    return NextResponse.json({ error: 'Failed to update driver' }, { status: 500 });
  }
}
