import { approve } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextResponse } from 'next/server';

export const POST = withSecurity(
  async (request, { auth, body, requestId }) => {
    try {
      const { applicationId, notes, overrideBusId, sessionStartYear, sessionEndYear } = (body || {}) as any;
      if (!applicationId) return NextResponse.json({ error: 'Application ID required', requestId }, { status: 400 });

      const updaterInfo = await getUpdaterInfo(auth.uid);

      const permissionDenied = await requireModeratorPermission(
        {
          uid: auth.uid,
          email: auth.email || '',
          role: auth.role,
          name: updaterInfo.name || auth.name,
        },
        'applications',
        'canApprove',
        requestId
      );
      if (permissionDenied) return permissionDenied;

      const result = await approve(
        applicationId,
        {
          uid: auth.uid,
          name: updaterInfo.name || auth.name || 'Admin',
          role: auth.role,
        },
        notes,
        {
          busId: overrideBusId,
          startYear: sessionStartYear ? Number(sessionStartYear) : undefined,
          endYear: sessionEndYear ? Number(sessionEndYear) : undefined,
        }
      );

      if (!result.success) {
        return NextResponse.json({ error: result.error, requestId }, { status: result.status || 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Application approved successfully',
        studentUid: result.studentUid,
        requestId,
      });
    } catch (error: any) {
      console.error('Approval error:', error);
      return NextResponse.json({ error: safeErrorMessage(error, 'Failed to approve application'), requestId }, { status: 500 });
    }
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.UPDATE,
  }
);
