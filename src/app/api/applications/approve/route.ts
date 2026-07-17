import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { approve } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { resolveUserRole } from '@/lib/security/role-cache';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';

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

    const result = await approve(
      applicationId,
      {
        uid,
        name: updaterInfo.name || 'Admin',
        role: userRole.role,
      },
      notes,
      {
        busId: body.overrideBusId,
        startYear: body.sessionStartYear ? Number(body.sessionStartYear) : undefined,
        endYear: body.sessionEndYear ? Number(body.sessionEndYear) : undefined,
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Application approved successfully',
      studentUid: result.studentUid,
    });
  } catch (error: any) {
    console.error('Approval error:', error);
    return NextResponse.json({ error: safeErrorMessage(error, 'Failed to approve application') }, { status: 500 });
  }
}
