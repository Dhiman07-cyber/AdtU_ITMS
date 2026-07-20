import { NextRequest, NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import {
  getStudentsByStatus,
  getStudentsByBusIds,
} from '@/domains/identity';
import { getSupabaseServer } from '@/lib/supabase-server';

// D1 Identity — Student list API. Runtime owner: PostgreSQL (student_profiles table).
// Supports optional query filters: busId, enrollmentId, q (search), limit, offset

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
    const limit = Math.min(parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10), MAX_LIMIT);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let studentRows: Record<string, any>[];

    if (busId) {
      studentRows = await getStudentsByBusIds([busId]);
      studentRows = studentRows.filter((row: any) => !row.status || row.status === 'active');
    } else if (q) {
      // Server-side search via ILIKE instead of loading all rows
      const db = getSupabaseServer();
      // Escape ILIKE wildcards to prevent abuse
      const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      const { data, error } = await db
        .from('student_profiles')
        .select('uid, full_name, email, phone, alt_phone, enrollment_id, gender, dob, faculty, department, parent_name, parent_phone, bus_id, route_id, assigned_bus_id, assigned_route_id, status, shift, profile_photo_url, session_start_year')
        .or(`full_name.ilike.${pattern},email.ilike.${pattern},enrollment_id.ilike.${pattern}`)
        .order('full_name', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      studentRows = (data || []).map((row: any) => ({
        uid: row.uid,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        altPhone: row.alt_phone,
        enrollmentId: row.enrollment_id,
        gender: row.gender,
        dob: row.dob,
        faculty: row.faculty,
        department: row.department,
        parentName: row.parent_name,
        parentPhone: row.parent_phone,
        busId: row.bus_id,
        routeId: row.route_id,
        assignedBusId: row.assigned_bus_id,
        assignedRouteId: row.assigned_route_id,
        status: row.status,
        shift: row.shift,
        profilePhotoUrl: row.profile_photo_url,
        enrollmentYear: row.session_start_year,
      }));
    } else {
      studentRows = await getStudentsByStatus('active');
    }

    const students = (enrollmentId ? studentRows.filter((row: any) =>
      (row.enrollmentId || '').toLowerCase() === enrollmentId.toLowerCase()
    ) : studentRows).map((row: any) => ({
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

    return NextResponse.json(students, { headers: rl.headers });
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json(handleApiError(error, 'students-get', 'Failed to fetch students'), { status: 500 });
  }
}
