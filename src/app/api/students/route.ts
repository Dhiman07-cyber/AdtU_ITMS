import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import {
  getStudentsByStatus,
  getStudentsByBusIds,
  getAllStudents,
} from '@/domains/identity';

// D1 Identity — Student list API. Runtime owner: PostgreSQL (student_profiles table).
// Supports optional query filters: busId, enrollmentId, q (search)

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'students-list'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    const busId = searchParams.get('busId');
    const enrollmentId = searchParams.get('enrollmentId');
    const q = searchParams.get('q');

    let studentRows: Record<string, any>[];

    if (busId) {
      studentRows = await getStudentsByBusIds([busId]);
      studentRows = studentRows.filter((row: any) => !row.status || row.status === 'active');
    } else if (q) {
      const allRows = await getAllStudents();
      const lower = q.toLowerCase();
      studentRows = allRows.filter((row: any) =>
        (row.fullName || '').toLowerCase().includes(lower) ||
        (row.name || '').toLowerCase().includes(lower) ||
        (row.email || '').toLowerCase().includes(lower) ||
        (row.enrollmentId || '').toLowerCase().includes(lower)
      );
    } else {
      studentRows = await getStudentsByStatus('active');
    }

    const students = studentRows.map((row: any) => ({
      id: row.uid,
      name: row.fullName || row.name || '',
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
      assignedBusId: row.assignedBusId || row.busId || '',
      assignedRouteId: row.assignedRouteId || row.routeId || '',
      status: row.status || 'active',
      shift: row.shift || '',
      enrollmentYear: row.enrollmentYear || '',
    }));

    if (enrollmentId) {
      const match = students.filter((s: any) =>
        (s.enrollmentId || '').toLowerCase() === enrollmentId.toLowerCase()
      );
      return NextResponse.json(match, { headers: rl.headers });
    }

    return NextResponse.json(students, { headers: rl.headers });
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json(handleApiError(error, 'students-get', 'Failed to fetch students'), { status: 500 });
  }
}
