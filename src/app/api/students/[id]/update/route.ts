import { getById,update } from '@/domains/student';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { normalizeShift } from '@/lib/utils/shift-utils';
import { NextResponse } from 'next/server';

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
      'stop_name', 'stop_name', 'stopLat', 'stopLng',
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

    const unifiedUpdateData: Record<string, any> = {
      ...updatedStudentData,
      busId: updatedStudentData.busId || student.busId,
      routeId: updatedStudentData.routeId || student.routeId,
      updatedAt: new Date().toISOString(),
    };


    await update(id, unifiedUpdateData);

    const responseStudent = {
      id: student.id || student.uid,
      name: unifiedUpdateData.fullName ?? unifiedUpdateData.name ?? student.fullName ?? student.name ?? '',
      email: unifiedUpdateData.email ?? student.email ?? '',
      phone: unifiedUpdateData.phone ?? student.phone ?? '',
      alternatePhone: student.altPhone || '',
      enrollmentId: unifiedUpdateData.enrollmentId ?? student.enrollmentId ?? '',
      gender: student.gender || '',
      dob: unifiedUpdateData.dob ?? student.dob ?? '',
      faculty: unifiedUpdateData.faculty ?? student.faculty ?? '',
      department: unifiedUpdateData.department ?? student.department ?? '',
      parentName: unifiedUpdateData.parentName ?? student.parentName ?? '',
      parentPhone: unifiedUpdateData.parentPhone ?? student.parentPhone ?? '',
      busAssigned: student.busId || '',
      routeId: student.routeId || '',
      profilePhotoUrl: unifiedUpdateData.profilePhotoUrl !== undefined ? (unifiedUpdateData.profilePhotoUrl || '') : (student.profilePhotoUrl || ''),
      address: unifiedUpdateData.address ?? student.address ?? '',
      bloodGroup: unifiedUpdateData.bloodGroup ?? student.bloodGroup ?? '',
    };

    return NextResponse.json(responseStudent);
  } catch (error: any) {
    console.error('Error updating student:', error);
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 });
  }
}
