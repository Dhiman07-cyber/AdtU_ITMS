import {
	getStudentsByBusIds,
	getStudentsByStatus,
} from '@/domains/identity';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextRequest,NextResponse } from 'next/server';

// D1 Identity — Student list API. Runtime owner: PostgreSQL (student_profiles table).
// Supports optional query filters: busId, enrollmentId, q (search), limit, offset

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator', 'driver']);
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
    let totalCount = 0;

    const STUDENT_FIELDS = 'uid, full_name, email, phone, alt_phone, enrollment_id, gender, dob, faculty, department, parent_name, parent_phone, bus_id, route_id, stop_name, status, shift, semester, profile_photo_url, session_start_year, session_end_year';

    if (enrollmentId) {
      const db = getSupabaseServer();
      const { data, error, count } = await db
        .from('student_profiles')
        .select(STUDENT_FIELDS, { count: 'exact' })
        .ilike('enrollment_id', enrollmentId.trim());

      if (error) throw error;
      studentRows = data || [];
      totalCount = count ?? studentRows.length;
    } else if (busId) {
      studentRows = await getStudentsByBusIds([busId]);
      studentRows = studentRows.filter((row: any) => !row.status || row.status === 'active');
      totalCount = studentRows.length;
      if (offset > 0 || limit < studentRows.length) {
        studentRows = studentRows.slice(offset, offset + limit);
      }
    } else if (q) {
      // Server-side search via ILIKE instead of loading all rows
      const db = getSupabaseServer();

      // Escape ILIKE wildcards to prevent abuse
      const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      const { data, error, count } = await db
        .from('student_profiles')
        .select(STUDENT_FIELDS, { count: 'exact' })
        .or(`full_name.ilike.${pattern},email.ilike.${pattern},enrollment_id.ilike.${pattern}`)
        .order('full_name', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      studentRows = data || [];
      totalCount = count ?? studentRows.length;
    } else {
      const db = getSupabaseServer();

      const { data, error, count } = await db
        .from('student_profiles')
        .select(STUDENT_FIELDS, { count: 'exact' })
        .eq('status', 'active')
        .order('full_name', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      studentRows = data || [];
      totalCount = count ?? studentRows.length;
    }

    const isStaff = ['admin', 'moderator'].includes(auth.role);

    const students = studentRows.map((row: any) => ({
      id: row.uid || row.id,
      name: row.full_name || row.fullName || row.name || '',
      fullName: row.full_name || row.fullName || row.name || '',
      email: isStaff ? (row.email || '') : '',
      phone: isStaff ? (row.phone || '') : '',
      altPhone: isStaff ? (row.alt_phone || row.altPhone || '') : '',
      enrollmentId: row.enrollment_id || row.enrollmentId || '',
      gender: row.gender || '',
      dob: isStaff ? (row.dob || '') : '',
      faculty: row.faculty || '',
      department: row.department || '',
      parentName: isStaff ? (row.parent_name || row.parentName || '') : '',
      parentPhone: isStaff ? (row.parent_phone || row.parentPhone || '') : '',
      busId: row.bus_id || row.busId || '',
      routeId: row.route_id || row.routeId || '',
      stop_name: row.stop_name || '',
      profilePhotoUrl: row.profile_photo_url || row.profilePhotoUrl || '',
      status: row.status || 'active',
      shift: row.shift || '',
      semester: row.semester || '',
      sessionStartYear: row.session_start_year || row.sessionStartYear || '',
      sessionEndYear: row.session_end_year || row.sessionEndYear || '',
      enrollmentYear: row.session_start_year || row.sessionStartYear || '',
    }));

    const hasMore = offset + studentRows.length < totalCount;
    const responseHeaders = new Headers(rl.headers || {});
    responseHeaders.set('X-Total-Count', String(totalCount));
    responseHeaders.set('X-Has-More', String(hasMore));
    responseHeaders.set('X-Page-Offset', String(offset));
    responseHeaders.set('X-Page-Limit', String(limit));

    if (searchParams.get('paginate') === 'true' || searchParams.get('format') === 'paginated') {
      return NextResponse.json({
        students,
        total: totalCount,
        hasMore,
        offset,
        limit,
      }, { headers: responseHeaders });
    }

    return NextResponse.json(students, { headers: responseHeaders });
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json(handleApiError(error, 'students-get', 'Failed to fetch students'), { status: 500 });
  }
}
