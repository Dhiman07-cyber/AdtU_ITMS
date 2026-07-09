import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { approveUnauth } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { safeErrorMessage } from '@/lib/security/safe-error';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decodedToken = await adminAuth.verifyIdToken(token);
    const moderatorUid = decodedToken.uid;
    const body = asRecord(await request.json());
    const studentUid = asString(body.studentUid);

    if (!studentUid) {
      return NextResponse.json({ error: 'Missing student UID' }, { status: 400 });
    }

    const [moderatorDoc, adminDoc] = await Promise.all([
      adminDb.collection('moderators').doc(moderatorUid).get(),
      adminDb.collection('admins').doc(moderatorUid).get(),
    ]);

    if (!moderatorDoc.exists && !adminDoc.exists) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const moderatorData = moderatorDoc.exists ? moderatorDoc.data() : adminDoc.data();
    const approverRole = adminDoc.exists ? 'admin' : 'moderator';
    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: decodedToken.email || '',
        role: approverRole,
        name: moderatorData?.fullName || moderatorData?.name || '',
      },
      'applications',
      'canApprove'
    );
    if (permissionDenied) return permissionDenied;

    const result = await approveUnauth(
      studentUid,
      {
        uid: moderatorUid,
        name: moderatorData?.name || moderatorData?.fullName || 'Approver',
        role: approverRole,
      },
      {
        busId: body.overrideBusId ? asString(body.overrideBusId) : undefined,
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
  } catch (error) {
    console.error('Error approving application:', error);
    return NextResponse.json(
      { error: safeErrorMessage(error, 'Failed to approve application') },
      { status: 500 }
    );
  }
}
