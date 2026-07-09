import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { reject } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const { applicationId, rejectorName, rejectorId, reason } = body;

    if (!applicationId || !rejectorName || !rejectorId || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const adminDoc = await adminDb.collection('admins').doc(uid).get();
    const modDoc = await adminDb.collection('moderators').doc(uid).get();

    if (!adminDoc.exists && !modDoc.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const actorData = adminDoc.exists ? adminDoc.data() : modDoc.data();
    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: decodedToken.email || '',
        role: adminDoc.exists ? 'admin' : 'moderator',
        name: actorData?.fullName || actorData?.name || '',
      },
      'applications',
      'canReject'
    );
    if (permissionDenied) return permissionDenied;

    const result = await reject(
      applicationId,
      {
        uid,
        name: rejectorName,
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
