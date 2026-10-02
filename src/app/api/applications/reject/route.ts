import { reject } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const { applicationId, reason } = (body || {}) as any;

      if (!applicationId || !reason) {
        return NextResponse.json({ error: 'Missing required fields', requestId }, { status: 400 });
      }

      const updaterInfo = await getUpdaterInfo(auth.uid);

      const permissionDenied = await requireModeratorPermission(
        {
          uid: auth.uid,
          email: auth.email || '',
          role: auth.role,
          name: updaterInfo.name || auth.name,
        },
        'applications',
        'canReject',
        requestId
      );
      if (permissionDenied) return permissionDenied;

      // Audit identity comes from the verified session, never the body —
      // client-supplied rejectorName would let anyone forge the audit trail.
      const result = await reject(
        applicationId,
        {
          uid: auth.uid,
          name: updaterInfo.name || auth.name,
          role: auth.role,
        },
        reason
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error, requestId }, { status: result.status || 500 });
      }

      return NextResponse.json({ success: true, message: 'Application rejected', requestId });
    } catch (error: any) {
      console.error('Error rejecting application:', error);
      return NextResponse.json(
        { error: safeErrorMessage(error, 'Failed to reject application'), requestId },
        { status: 500 }
      );
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.UPDATE,
  }
);
