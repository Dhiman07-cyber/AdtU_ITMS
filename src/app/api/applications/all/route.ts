import { getAllPaginated } from '@/domains/application';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextRequest, NextResponse } from 'next/server';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // FIX-04c (RBAC-03): Enforce moderator permission gate for application list.
    const permDenied = await requireModeratorPermission(auth, 'applications', 'canView');
    if (permDenied) return permDenied;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'applications-all'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    // FIX (API-11): Guard against NaN from non-numeric query params to prevent
    // passing NaN to the DB query's LIMIT/OFFSET, which can cause a 500 or unbounded read.
    const rawLimit = parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = Number.isNaN(rawLimit) ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
    const offset = Number.isNaN(rawOffset) ? 0 : rawOffset;

    const applications = await getAllPaginated(limit, offset);
    const hasMore = applications.length === limit;

    return NextResponse.json(
      { applications, hasMore },
      {
        headers: {
          ...Object.fromEntries(new Headers(rl.headers || {})),
          'X-Has-More': String(hasMore),
          'X-Page-Offset': String(offset),
          'X-Page-Limit': String(limit),
        },
      }
    );
  } catch (error: any) {
    console.error('Error fetching applications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch applications' },
      { status: 500 }
    );
  }
}
