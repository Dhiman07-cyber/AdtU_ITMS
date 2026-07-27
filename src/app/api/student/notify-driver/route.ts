import { NextResponse } from 'next/server';
import { withSecurity } from '@/lib/security/api-security';
import { NotifyDriverSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { requireTransportEntitlement } from '@/lib/entitlement/require-transport-entitlement';
import { getDriversByBusId } from '@/domains/identity';

/**
 * POST /api/student/notify-driver
 *
 * Logic to notify a driver (FCM or other) when a student sends a request.
 */
export const POST = withSecurity(
  async (request, { auth, body }) => {
    const { busId, studentName } = body as any;
    const studentUid = auth.uid;

    // Phase 3 — only entitled students may contact the driver.
    const gate = await requireTransportEntitlement(studentUid);
    if (!gate.ok) return (gate as any).response;

    console.log('🔔 Student notifying driver:', { studentUid: studentUid.substring(0, 8) + '...', busId });

    // Find the driver assigned to this bus in PostgreSQL
    const drivers = await getDriversByBusId(busId);

    if (drivers.length === 0) {
      console.warn('⚠️ No driver found for bus:', busId);
      return NextResponse.json({
        success: false,
        message: 'No driver found for this bus'
      });
    }

    console.log(`📱 Found ${drivers.length} driver(s) for bus ${busId}`);

    // Note: FCM notification to driver would go here
    // For now, we're using Supabase broadcast which is already handled client-side

    return NextResponse.json({
      success: true,
      message: 'Driver notification queued',
      driversNotified: drivers.length
    });
  },
  {
    requiredRoles: ['student'],
    schema: NotifyDriverSchema,
    rateLimit: RateLimits.NOTIFICATION_CREATE,
    allowBodyToken: true
  }
);
