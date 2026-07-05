import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { adminDb } from '@/lib/firebase-admin';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'students', 'canEdit');
    if (permissionDenied) return permissionDenied;

    if (!adminDb) {
      return NextResponse.json({ error: 'Database not available' }, { status: 500 });
    }

    const { id } = await params;
    const requestBody = await request.json();

    // FIELD ALLOW-LIST: Only safe fields may be updated via API
    const ALLOWED_FIELDS = new Set([
      'fullName', 'name', 'email', 'phone', 'enrollmentId', 'photoURL',
      'faculty', 'department', 'yearOfStudy',
      'stopId', 'stopName', 'stopLat', 'stopLng',
      'shift'
    ]);
    const BLOCKED_FIELDS = new Set([
      'status', 'validUntil', 'busId', 'routeId', 'role', 'paymentAmount',
      'seatReleasedAt', 'softBlock', 'hardBlock', 'approvedBy'
    ]);

    const updatedStudentData: Record<string, any> = {};
    for (const [key, value] of Object.entries(requestBody)) {
      if (BLOCKED_FIELDS.has(key)) {
        console.warn(`Blocked attempt to update forbidden field: ${key}`);
        continue;
      }
      if (ALLOWED_FIELDS.has(key)) {
        if (key === 'shift') {
          // Students may ONLY have 'Morning' or 'Evening' - use canonical validation
          const { normalizeShift } = await import('@/lib/utils/shift-utils');
          const normalized = normalizeShift(value as string);
          if (normalized !== 'Morning' && normalized !== 'Evening') {
            console.warn(`Invalid shift value rejected: ${value}`);
            continue;
          }
          updatedStudentData[key] = normalized;
          continue;
        }
        updatedStudentData[key] = value;
      }
    }

    const studentDocRef = adminDb.collection('students').doc(id);
    const studentDoc = await studentDocRef.get();
    if (!studentDoc.exists) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    if (updatedStudentData.profilePhotoUrl !== undefined) {
      if (typeof updatedStudentData.profilePhotoUrl !== 'string') {
        delete updatedStudentData.profilePhotoUrl;
      } else if (updatedStudentData.profilePhotoUrl.trim() === '') {
        updatedStudentData.profilePhotoUrl = null;
      }
    }

    const unifiedUpdateData = {
      ...updatedStudentData,
      assignedBusId: updatedStudentData.busId || updatedStudentData.assignedBusId,
      assignedRouteId: updatedStudentData.routeId || updatedStudentData.assignedRouteId,
      updatedAt: new Date().toISOString(),
    };

    await studentDocRef.update(unifiedUpdateData);

    const freshDoc = await studentDocRef.get();
    const data = freshDoc.data();
    const updatedStudent = {
      id: freshDoc.id,
      name: data?.fullName || data?.name || '',
      email: data?.email || '',
      phone: data?.phone || '',
      alternatePhone: data?.alternatePhone || '',
      enrollmentId: data?.enrollmentId || '',
      gender: data?.gender || '',
      dob: data?.dob || '',
      faculty: data?.faculty || '',
      department: data?.department || '',
      parentName: data?.parentName || '',
      parentPhone: data?.parentPhone || '',
      busAssigned: data?.busAssigned || data?.busId || '',
      routeId: data?.routeId || '',
      profilePhotoUrl: data?.profilePhotoUrl || '',
      address: data?.address || '',
      bloodGroup: data?.bloodGroup || '',
    };

    return NextResponse.json(updatedStudent);
  } catch (error: any) {
    console.error('Error updating student:', error);
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 });
  }
}
