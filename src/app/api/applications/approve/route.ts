import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { approve } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { safeErrorMessage } from '@/lib/security/safe-error';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { applicationId, notes } = body;
    if (!applicationId) return NextResponse.json({ error: 'Application ID required' }, { status: 400 });

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const [adminSnap, modSnap] = (await adminDb.getAll(
      adminDb.collection('admins').doc(uid),
      adminDb.collection('moderators').doc(uid),
    )) as any[];

    if (!adminSnap.exists && !modSnap.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const approverData = adminSnap.exists ? adminSnap.data() : modSnap.data();
    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: decodedToken.email || '',
        role: adminSnap.exists ? 'admin' : 'moderator',
        name: approverData?.fullName || approverData?.name || '',
      },
      'applications',
      'canApprove'
    );
    if (permissionDenied) return permissionDenied;

    const result = await approve(
      applicationId,
      {
        uid,
        name: approverData?.fullName || approverData?.name || 'Admin',
        role: adminSnap.exists ? 'admin' : 'moderator',
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
