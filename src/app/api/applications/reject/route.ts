import { reject } from '@/domains/application';
import { adminAuth,adminDb } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { resolveUserRole } from '@/lib/security/role-cache';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const { applicationId, reason } = body;

    if (!applicationId || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const [userRole, updaterInfo] = await Promise.all([
      resolveUserRole(uid),
      getUpdaterInfo(adminDb, uid),
    ]);

    if (!userRole.role) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: decodedToken.email || '',
        role: userRole.role,
        name: updaterInfo.name,
      },
      'applications',
      'canReject'
    );
    if (permissionDenied) return permissionDenied;

    // Audit identity comes from the verified session, never the body —
    // client-supplied rejectorName would let anyone forge the audit trail.
    const result = await reject(
      applicationId,
      {
        uid,
        name: updaterInfo.name,
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
