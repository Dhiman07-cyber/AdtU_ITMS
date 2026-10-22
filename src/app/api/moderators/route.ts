import { getAllModerators } from '@/domains/identity';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { NextRequest,NextResponse } from 'next/server';

interface Moderator {
  id: string;
  name: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  faculty?: string;
  assignedFaculty?: string;
  joinDate?: string;
  joiningDate?: string;
  profilePhotoUrl?: string;
  dob?: string;
  aadharNumber?: string;
  employeeId?: string;
  [key: string]: any;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin']);
    if (!auth.authenticated) return auth.response;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'moderators-list'), RateLimits.ADMIN);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || searchParams.get('q');

    let moderatorRows = await getAllModerators();

    if (search && search.trim()) {
      const { getSupabaseServer } = await import('@/lib/supabase-server');
      const db = getSupabaseServer();
      const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;
      const { data, error } = await db
        .from('moderator_profiles')
        .select('*')
        .or(`full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},employee_id.ilike.${pattern},faculty.ilike.${pattern},team_name.ilike.${pattern}`)
        .order('full_name', { ascending: true });

      if (!error && data && data.length > 0) {
        moderatorRows = data;
      } else {
        const term = search.trim().toLowerCase();
        moderatorRows = moderatorRows.filter((row: any) =>
          (row.fullName || row.name || '').toLowerCase().includes(term) ||
          (row.email || '').toLowerCase().includes(term) ||
          (row.phone || '').toLowerCase().includes(term) ||
          (row.employeeId || '').toLowerCase().includes(term) ||
          (row.faculty || '').toLowerCase().includes(term)
        );
      }
    }

    const moderators: Moderator[] = moderatorRows.map((row: any) => ({
      id: row.uid,
      name: row.fullName || row.name || '',
      email: row.email || '',
      phone: row.phone || '',
      alternatePhone: row.alternatePhone || '',
      faculty: row.faculty || '',
      assignedFaculty: row.assignedFaculty || row.faculty || '',
      joinDate: row.joinDate || row.joiningDate || '',
      joiningDate: row.joiningDate || row.joinDate || '',
      profilePhotoUrl: row.profilePhotoUrl || '',
      dob: row.dob || '',
      aadharNumber: row.aadharNumber || '',
      employeeId: row.employeeId || '',
      status: row.status || 'active',
      permissions: row.permissions || null,
      permissionsUpdatedAt: row.permissionsUpdatedAt || null,
      permissionsUpdatedBy: row.permissionsUpdatedBy || null,
    }));

    return NextResponse.json(moderators, { headers: rl.headers });
  } catch (error) {
    console.error('Error fetching moderators:', error);
    return NextResponse.json(handleApiError(error, 'moderators-get', 'Failed to fetch moderators'), { status: 500 });
  }
}