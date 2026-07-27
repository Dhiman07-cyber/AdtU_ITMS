import { createAuditEvent,SYSTEM_ACTOR } from '@/domains/audit';
import { activateUpcomingSessionApplications } from '@/lib/services/session-activation.service';
import crypto from 'crypto';
import { NextRequest,NextResponse } from 'next/server';

/**
 * Daily session-activation cron.
 *
 * Schedule: daily at low traffic (see vercel.json). Activation logic lives in
 * `activateUpcomingSessionApplications` — this route is a thin authenticated
 * caller. The admin manual-trigger endpoint at
 * /api/admin/run-session-activation invokes the same service, by design.
 *
 * Idempotent. Failure-isolated. Reads "current session start year" from the
 * canonical academic-calendar engine. See the service file header.
 */
export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      console.error('🚫 CRON_SECRET not configured — blocking cron request');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    const provided = request.headers.get('Authorization')?.startsWith('Bearer ')
      ? request.headers.get('Authorization')!.substring(7)
      : '';
    if (
      provided.length !== cronSecret.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(cronSecret))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });

    await createAuditEvent({
      category: 'system',
      action: 'cron_session_activation_completed',
      summary: 'Session activation cron completed',
      severity: 'medium',
      actor_id: SYSTEM_ACTOR.id,
      actor_name: SYSTEM_ACTOR.name,
      actor_role: SYSTEM_ACTOR.role,
      target_type: 'cron',
      target_id: 'cron:session-activation',
      target_name: '',
      metadata: summary as unknown as Record<string, unknown>,
    });

    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('❌ Session activation cron error:', error);
    return NextResponse.json({ error: 'Session activation failed' }, { status: 500 });
  }
}
