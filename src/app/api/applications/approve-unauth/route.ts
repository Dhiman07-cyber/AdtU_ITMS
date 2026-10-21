import { approveUnauth } from '@/domains/application';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { RateLimits, checkRateLimit, createRateLimitId } from '@/lib/security/rate-limiter';
import { safeErrorMessage } from '@/lib/security/safe-error';
import { getUpdaterInfo } from '@/lib/utils/updatedBy';
import { NextRequest,NextResponse } from 'next/server';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? value as JsonRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    const rateLimitId = createRateLimitId(auth.uid, 'app:approve-unauth');
    const rateCheck = checkRateLimit(rateLimitId, RateLimits.UPDATE.maxRequests, RateLimits.UPDATE.windowMs);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before approving again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)) },
        }
      );
    }

    const moderatorUid = auth.uid;
    const body = asRecord(await request.json());
    const applicationId = asString(body.applicationId || body.studentUid);

    if (!applicationId) {
      return NextResponse.json({ error: 'Missing application ID' }, { status: 400 });
    }

    const updaterInfo = await getUpdaterInfo(moderatorUid);

    const permissionDenied = await requireModeratorPermission(
      {
        uid: moderatorUid,
        email: auth.email || '',
        role: auth.role,
        name: updaterInfo.name || auth.name,
      },
      'applications',
      'canApprove'
    );
    if (permissionDenied) return permissionDenied;

    const result = await approveUnauth(
      applicationId,
      {
        uid: moderatorUid,
        name: updaterInfo.name || auth.name || 'Approver',
        role: auth.role,
      },
      {
        busId: body.overrideBusId ? asString(body.overrideBusId) : undefined,
        startYear: body.sessionStartYear ? Number(body.sessionStartYear) : undefined,
        endYear: body.sessionEndYear ? Number(body.sessionEndYear) : undefined,
        queueForSeat: Boolean(body.queueForSeat),
      }
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Application approved successfully',
      studentUid: result.studentUid,
    });
  } catch (error) {
    console.error('Error approving application:', error);
    return NextResponse.json(
      { error: safeErrorMessage(error, 'Failed to approve application') },
      { status: 500 }
    );
  }
}
