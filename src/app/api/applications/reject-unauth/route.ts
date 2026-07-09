import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { rejectUnauth } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';

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

    const moderatorDoc = await adminDb.collection('moderators').doc(moderatorUid).get();
    const adminDoc = await adminDb.collection('admins').doc(moderatorUid).get();

    if (!moderatorDoc.exists && !adminDoc.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const moderatorData = moderatorDoc.exists ? moderatorDoc.data() : adminDoc.data();
    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: decodedToken.email || '',
        role: adminDoc.exists ? 'admin' : 'moderator',
        name: moderatorData?.fullName || moderatorData?.name || '',
      },
      'applications',
      'canReject'
    );
    if (permissionDenied) return permissionDenied;

    const result = await rejectUnauth(
      studentUid,
      {
        uid: moderatorUid,
        name: moderatorData?.fullName || moderatorData?.name || 'Moderator',
        role: adminDoc.exists ? 'admin' : 'moderator',
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
