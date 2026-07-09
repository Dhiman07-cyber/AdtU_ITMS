import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getById, update } from '@/domains/student';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'students', 'canEdit');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    const requestBody = await request.json();

    // FIELD ALLOW-LIST: Only safe fields may be updated via API
    const ALLOWED_FIELDS = new Set([
      'fullName', 'name', 'email', 'phone', 'enrollmentId', 'photoURL',
      'faculty', 'department', 'yearOfStudy',
      'stopId', 'stopName', 'stopLat', 'stopLng',
      'shift', 'profilePhotoUrl', 'address', 'bloodGroup', 'dob', 'parentName', 'parentPhone'
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

    const student = await getById(id);
    if (!student) {
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

    const success = await update(id, unifiedUpdateData);
    if (!success) {
      return NextResponse.json({ error: 'Failed to update student profile' }, { status: 500 });
    }

    const freshStudent = await getById(id);
    if (!freshStudent) {
      return NextResponse.json({ error: 'Student not found after update' }, { status: 404 });
    }

    const responseStudent = {
      id: freshStudent.id || freshStudent.uid,
      name: freshStudent.fullName || freshStudent.name || '',
      email: freshStudent.email || '',
      phone: freshStudent.phone || '',
      alternatePhone: freshStudent.altPhone || '',
      enrollmentId: freshStudent.enrollmentId || '',
      gender: freshStudent.gender || '',
      dob: freshStudent.dob || '',
      faculty: freshStudent.faculty || '',
      department: freshStudent.department || '',
      parentName: freshStudent.parentName || '',
      parentPhone: freshStudent.parentPhone || '',
      busAssigned: freshStudent.busId || freshStudent.assignedBusId || '',
      routeId: freshStudent.routeId || freshStudent.assignedRouteId || '',
      profilePhotoUrl: freshStudent.profilePhotoUrl || '',
      address: freshStudent.address || '',
      bloodGroup: freshStudent.bloodGroup || '',
    };

    return NextResponse.json(responseStudent);
  } catch (error: any) {
    console.error('Error updating student:', error);
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 });
  }
}
