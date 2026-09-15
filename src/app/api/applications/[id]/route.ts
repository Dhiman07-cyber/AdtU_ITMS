import { getById } from '@/domains/application';
import { withSecurity } from '@/lib/security/api-security';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
  async (request, { auth }) => {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const applicationId = pathParts[pathParts.length - 1];

    if (!applicationId) {
      return NextResponse.json({ error: 'Application ID required' }, { status: 400 });
    }

    if (auth.role === 'moderator') {
      const permissionDenied = await requireModeratorPermission(auth, 'applications', 'canView');
      if (permissionDenied) return permissionDenied;
    }

    const application = await getById(applicationId);

    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, application });
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.READ,
  }
);
