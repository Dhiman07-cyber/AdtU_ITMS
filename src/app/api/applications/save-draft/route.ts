import { saveDraft } from '@/domains/application';
import { verifyTokenOnly } from '@/lib/security/api-auth';
import { RateLimits, checkRateLimit, createRateLimitId } from '@/lib/security/rate-limiter';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const user = await verifyTokenOnly(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const uid = user.uid;

    const rateLimitId = createRateLimitId(uid, 'app:save-draft');
    const rateCheck = checkRateLimit(rateLimitId, RateLimits.CREATE.maxRequests, RateLimits.CREATE.windowMs);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before saving draft again.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)) },
        }
      );
    }

    const body = await request.json();
    const { applicationId, formData } = body;
    if (formData && 'age' in formData) {
      delete formData.age;
    }

    const result = await saveDraft(uid, applicationId, formData);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      applicationId: result.applicationId,
      message: applicationId ? 'Draft updated successfully' : 'Draft created successfully',
    });
  } catch (error: any) {
    console.error('Error saving draft:', error);
    return NextResponse.json(
      { error: 'Failed to save draft' },
      { status: 500 }
    );
  }
}
