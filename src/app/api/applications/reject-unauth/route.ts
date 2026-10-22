import { rejectUnauth } from '@/domains/application';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth }) => {
    const moderatorUid = auth.uid;

    const body = await request.json();
    const applicationId = body.applicationId || body.studentUid;
    const reason = body.reason || 'Application rejected by moderator';

    if (!applicationId) {
      return NextResponse.json({ error: 'Missing required field: applicationId' }, { status: 400 });
    }

    const updaterInfo = await getUpdaterInfo(moderatorUid);

    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: auth.email || '',
        role: auth.role,
        name: updaterInfo.name,
      },
      'applications',
      'canReject'
    );
    if (permissionDenied) return permissionDenied;

    const result = await rejectUnauth(
      applicationId,
      {
        uid: moderatorUid,
        name: updaterInfo.name || 'Moderator',
        role: auth.role,
      },
      reason
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({ success: true, message: 'Application rejected' });
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.WRITE,
  }
);
