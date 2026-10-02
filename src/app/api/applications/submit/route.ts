import { getById, submit } from '@/domains/application';
import { adminAuth } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const body = await request.json();
    const { applicationId } = body;

    if (!applicationId || typeof applicationId !== 'string') {
      return NextResponse.json({ error: 'Invalid application ID' }, { status: 400 });
    }

    // FIX-01 (IDOR-01): Verify the authenticated user owns this application.
    // Without this check, any authenticated user can force-submit another
    // student's verified application by supplying their applicationId.
    // The transition_application_state RPC accepts any application_id without
    // comparing it to p_actor_uid; ownership must be enforced at the HTTP layer.
    const existingApp = await getById(applicationId);
    if (!existingApp) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (existingApp.applicantUid !== uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await submit(applicationId, uid);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      success: true,
      applicationId,
      message: 'Application submitted successfully',
    });
  } catch (error: any) {
    console.error('Error submitting application:', error);
    return NextResponse.json(
      { error: 'Failed to submit application' },
      { status: 500 }
    );
  }
}

