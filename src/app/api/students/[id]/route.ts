import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { getById } from '@/domains/student';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'students', 'canView');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    const student = await getById(id);

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    // Format the date of birth to ensure it's in YYYY-MM-DD format (if present)
    let formattedDob = '';
    if (student.dob) {
      if (typeof student.dob === 'string') {
        formattedDob = student.dob;
      } else {
        formattedDob = new Date(student.dob).toISOString().split('T')[0];
      }
    }

    // Mapped response matching the expected interface exactly
    const responseData = {
      id: student.id || student.uid,
      name: student.fullName || student.name || '',
      email: student.email || '',
      phone: student.phone || '',
      altPhone: student.altPhone || '',
      enrollmentId: student.enrollmentId || '',
      gender: student.gender || '',
      dob: formattedDob,
      faculty: student.faculty || '',
      department: student.department || '',
      parentName: student.parentName || '',
      parentPhone: student.parentPhone || '',
      busId: student.busId || student.assignedBusId || '',
      routeId: student.routeId || student.assignedRouteId || '',
      profilePhotoUrl: student.profilePhotoUrl || '',
      createdAt: student.createdAt || '',
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching student:', error);
    return NextResponse.json({ error: 'Failed to fetch student' }, { status: 500 });
  }
}
