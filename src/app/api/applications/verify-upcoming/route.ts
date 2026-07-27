import { verifyUpcoming } from '@/domains/application';
import { adminAuth,adminDb } from '@/lib/firebase-admin';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { resolveUserRole } from '@/lib/security/role-cache';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { applicationId, notes } = body;
    if (!applicationId) return NextResponse.json({ error: 'Application ID required' }, { status: 400 });

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const userRole = await resolveUserRole(uid);
    if (!userRole.role) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const updaterInfo = await getUpdaterInfo(adminDb, uid);

    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: decodedToken.email || '',
        role: userRole.role,
        name: updaterInfo.name,
      },
      'applications',
      'canApprove'
    );
    if (permissionDenied) return permissionDenied;

    const result = await verifyUpcoming(
      applicationId,
      {
        uid,
        name: updaterInfo.name || 'Admin',
        role: userRole.role,
      },
      notes
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Upcoming application verified successfully. It will be activated when the new session begins.',
    });
  } catch (error: any) {
    console.error('Verify upcoming error:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Failed to verify upcoming application') }, { status: 500 });
  }
}
