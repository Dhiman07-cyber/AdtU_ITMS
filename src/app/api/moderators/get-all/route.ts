import { getAllModerators } from '@/domains/identity';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { NextRequest,NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin']);
    if (!auth.authenticated) return auth.response;

    const moderatorRows = await getAllModerators();

    const moderators = moderatorRows
      .filter((data: any) => {
        const hasValidData = data.email && (data.name || data.fullName);
        const isActive = hasValidData && (!data.status || data.status === 'active');
        const permissions = data.permissions;
        const canAppearInList = !permissions || permissions.canAppearInModeratorList !== false;
        return isActive && canAppearInList;
      })
      .map((data: any) => ({
        moderatorUid: data.uid,
        name: data.name || data.fullName || 'Unknown Moderator',
        empId: data.employeeId || data.empId || data.staffId || data.emp_id || 'N/A',
        role: 'moderator',
        active: data.active || data.status === 'active' || !data.status,
      }));

    return NextResponse.json({
      success: true,
      moderators,
    });
  } catch (error: any) {
    console.error('Error fetching moderators:', error);
    return NextResponse.json(
      { error: 'Failed to fetch moderators' },
      { status: 500 }
    );
  }
}
