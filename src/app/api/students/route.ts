import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { getStudentsByStatus } from '@/domains/identity';

interface Student {
  id: string;
  name: string;
  email: string;
  phone?: string;
  altPhone?: string;
  enrollmentId?: string;
  gender?: string;
  dob?: string;
  faculty: string;
  department: string;
  parentName?: string;
  parentPhone?: string;
  busId?: string;
  routeId?: string;
  profilePhotoUrl?: string;
  [key: string]: any;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const studentRows = await getStudentsByStatus('active');

    const students: Student[] = studentRows.map((row: any) => ({
      id: row.uid,
      name: row.fullName || '',
      email: row.email || '',
      phone: row.phone || '',
      altPhone: row.altPhone || '',
      enrollmentId: row.enrollmentId || '',
      gender: row.gender || '',
      dob: row.dob || '',
      faculty: row.faculty || '',
      department: row.department || '',
      parentName: row.parentName || '',
      parentPhone: row.parentPhone || '',
      busId: row.busId || '',
      routeId: row.routeId || '',
      profilePhotoUrl: row.profilePhotoUrl || '',
    }));

    return NextResponse.json(students);
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json({ error: 'Failed to fetch students' }, { status: 500 });
  }
}