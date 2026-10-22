import { verifyUpcoming } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth }) => {
    const uid = auth.uid;

    const body = await request.json();
    const { applicationId, notes } = body;
    if (!applicationId) return NextResponse.json({ error: 'Application ID required' }, { status: 400 });

    const updaterInfo = await getUpdaterInfo(uid);

    const permissionDenied = await requireModeratorPermission(
      {
        uid,
        email: auth.email || '',
        role: auth.role,
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
        role: auth.role,
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
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.WRITE,
  }
);
