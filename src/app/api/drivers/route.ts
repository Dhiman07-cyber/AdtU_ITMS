import { getAllDrivers } from '@/domains/identity';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { NextRequest,NextResponse } from 'next/server';

// D6 Fleet — Drivers list API. Runtime owner: PostgreSQL (driver_profiles table).
// Ponytail: drivers are a finite staff set — no pagination needed.

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // FIX-04b (RBAC-02): Enforce moderator permission gate for driver list.
    const permDenied = await requireModeratorPermission(auth, 'drivers', 'canView');
    if (permDenied) return permDenied;

    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'drivers-list'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const drivers = await getAllDrivers();

    return NextResponse.json(drivers, { headers: rl.headers });
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return NextResponse.json(handleApiError(error, 'drivers-get', 'Failed to fetch drivers'), { status: 500 });
  }
}