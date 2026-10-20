import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';

/**
 * POST /api/fleet/force-end-trip
 *
 * DISABLED / DEPRECATED: External force-ending of active trips is intentionally disabled.
 * In accordance with the ITMS distributed state machine invariants, only the assigned driver
 * himself can end an active trip. Stale or orphaned trip locks are automatically reaped by the
 * heartbeat expiry monitor in PostgreSQL / Redis.
 */
export const POST = withSecurity(
  async (_request, _ctx) => {
    return NextResponse.json(
      {
        success: false,
        error: 'External force-ending of trips is disabled. Trips can only be terminated by the assigned driver or automatically reaped by the heartbeat mechanism.',
      },
      { status: 403 }
    );
  },
  {
    requiredRoles: ['admin', 'moderator'],
    rateLimit: RateLimits.ADMIN,
  }
);

