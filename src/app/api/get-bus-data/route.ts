import { getBusById } from '@/domains/fleet';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { applyRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { handleApiError } from '@/lib/security/safe-error';
import { NextRequest,NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require authentication
    const auth = await verifyApiAuth(request, ['admin', 'moderator', 'driver', 'student']);
    if (!auth.authenticated) return auth.response;

    // Rate limit
    const rl = await applyRateLimit(createRateLimitId(auth.uid, 'get-bus-data'), RateLimits.READ);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: rl.headers });
    }

    const { searchParams } = new URL(request.url);
    const busId = searchParams.get('busId');

    if (!busId || typeof busId !== 'string' || busId.length > 100) {
      return NextResponse.json({ error: 'Valid Bus ID is required' }, { status: 400 });
    }

    const bus = await getBusById(busId);

    if (!bus) {
      return NextResponse.json({ error: 'Bus not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: bus
    }, { headers: rl.headers });
  } catch (error: any) {
    console.error('Error fetching bus data:', error);
    return NextResponse.json(handleApiError(error, 'get-bus-data', 'Failed to fetch bus data'), { status: 500 });
  }
}