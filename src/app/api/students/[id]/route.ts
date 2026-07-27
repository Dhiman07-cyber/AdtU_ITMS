import { getByEnrollmentId,getById,getByUid } from '@/domains/student';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextResponse } from 'next/server';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const permissionDenied = await requireModeratorPermission(auth, 'students', 'canView');
    if (permissionDenied) return permissionDenied;

    const { id } = await params;
    const cleanId = decodeURIComponent(id || '').trim();
    let student = await getById(cleanId);
    if (!student) {
      student = await getByUid(cleanId);
    }
    if (!student) {
      student = await getByEnrollmentId(cleanId);
    }

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
      uid: student.uid || student.id,
      name: student.fullName || student.name || '',
      fullName: student.fullName || student.name || '',
      email: student.email || '',
      phone: student.phone || (student as any).phoneNumber || '',
      phoneNumber: student.phone || (student as any).phoneNumber || '',
      altPhone: student.altPhone || (student as any).alternatePhone || '',
      alternatePhone: student.altPhone || (student as any).alternatePhone || '',
      enrollmentId: student.enrollmentId || '',
      gender: student.gender || '',
      dob: formattedDob,
      faculty: student.faculty || '',
      department: student.department || '',
      semester: student.semester || '',
      bloodGroup: student.bloodGroup || (student as any).blood_group || '',
      address: student.address || '',
      parentName: student.parentName || '',
      parentPhone: student.parentPhone || '',
      busId: student.busId || (student as any).bus_id || '',
      routeId: student.routeId || (student as any).route_id || '',
      shift: student.shift || '',
      stop_name: student.stop_name || (student as any).pickupPoint || '',
      pickupPoint: student.stop_name || (student as any).pickupPoint || '',
      status: student.status || 'active',
      validUntil: student.validUntil || (student as any).valid_until || null,
      softBlock: student.softBlock || (student as any).soft_block || null,
      hardBlock: student.hardBlock || (student as any).hard_block || null,
      sessionStartYear: student.sessionStartYear || (student as any).session_start_year || null,
      sessionEndYear: student.sessionEndYear || (student as any).session_end_year || null,
      sessionDuration: student.sessionDuration || (student as any).session_duration || null,
      approvedBy: student.approvedBy || (student as any).approved_by || '',
      approvedAt: student.approvedAt || (student as any).approved_at || null,
      profilePhotoUrl: student.profilePhotoUrl || '',
      createdAt: student.createdAt || (student as any).created_at || '',
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching student:', error);
    return NextResponse.json({ error: 'Failed to fetch student' }, { status: 500 });
  }
}
