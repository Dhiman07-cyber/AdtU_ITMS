import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { rejectUnauth } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { resolveUserRole } from '@/lib/security/role-cache';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decodedToken = await adminAuth.verifyIdToken(token);
    const moderatorUid = decodedToken.uid;

    const body = await request.json();
    const { studentUid } = body;
    const reason = body.reason || 'Application rejected by moderator';

    if (!studentUid) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const userRole = await resolveUserRole(moderatorUid);
    if (!userRole.role) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const updaterInfo = await getUpdaterInfo(adminDb, moderatorUid);

    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: decodedToken.email || '',
        role: userRole.role,
        name: updaterInfo.name,
      },
      'applications',
      'canReject'
    );
    if (permissionDenied) return permissionDenied;

    const result = await rejectUnauth(
      studentUid,
      {
        uid: moderatorUid,
        name: updaterInfo.name || 'Moderator',
        role: userRole.role,
      },
      reason
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({ success: true, message: 'Application rejected' });
  } catch (error: any) {
    console.error('Error rejecting application:', error);
    return NextResponse.json(
      { error: 'Failed to reject application' },
      { status: 500 }
    );
  }
}
