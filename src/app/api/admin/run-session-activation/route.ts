import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import {
  activateUpcomingSessionApplications,
  activateSingleApplication,
} from '@/lib/services/session-activation.service';
import { createAuditEvent } from '@/domains/audit';

/**
 * Admin manual trigger for the canonical session-activation service.
 *
 * This is NOT a second implementation of activation. It calls
 * activateUpcomingSessionApplications() — identical to the daily cron. Exists
 * purely so an admin can immediately activate eligible upcoming applications
 * after a deploy/outage delay or when they have confirmed the new session has
 * begun.
 *
 * Admin-only. The same idempotency, failure-isolation, and capacity guarantees
 * as the cron apply.
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    const userRole = await resolveUserRole(decoded.uid);
    if (userRole.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Optional: single-application retry. Used by the Applications page when an
    // admin clicks "Retry" on a pending_seat_allocation row.
    let applicationId: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.applicationId === 'string' && body.applicationId.trim()) {
        applicationId = body.applicationId.trim();
      }
    } catch {
      // No body — fall through to bulk activation.
    }

    const summary = applicationId
      ? await activateSingleApplication(applicationId, 'admin')
      : await activateUpcomingSessionApplications({ trigger: 'admin' });

    void createAuditEvent({
      action: 'admin_session_activation_triggered',
      actor_id: decoded.uid,
      actor_name: userRole.name || 'Admin',
      actor_role: 'admin',
      target_id: 'admin:run-session-activation',
      target_type: 'admin_action',
      target_name: '',
      category: 'system',
      summary: 'Admin triggered session activation',
      severity: 'medium',
      metadata: { reason: 'manual_trigger', ...summary },
    });

    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('❌ Manual session activation error:', error);
    return NextResponse.json({ error: 'Session activation failed' }, { status: 500 });
  }
}
