import { getById, submit } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth }) => {
    const uid = auth.uid;

    const body = await request.json();
    const { applicationId } = body;

    if (!applicationId || typeof applicationId !== 'string') {
      return NextResponse.json({ error: 'Invalid application ID' }, { status: 400 });
    }

    // FIX-01 (IDOR-01): Verify the authenticated user owns this application or is admin/moderator
    const existingApp = await getById(applicationId);
    if (!existingApp) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }
    if (existingApp.applicantUid !== uid && !['admin', 'moderator'].includes(auth.role)) {
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
  },
  {
    requiredRoles: ['student', 'applicant', 'unauthenticated', 'admin', 'moderator'],
    rateLimit: RateLimits.WRITE,
  }
);
