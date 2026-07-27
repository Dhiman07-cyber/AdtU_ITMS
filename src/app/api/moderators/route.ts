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

    const moderatorRows = await getAllModerators();

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
    }));

    return NextResponse.json(moderators, { headers: rl.headers });
  } catch (error) {
    console.error('Error fetching moderators:', error);
    return NextResponse.json(handleApiError(error, 'moderators-get', 'Failed to fetch moderators'), { status: 500 });
  }
}