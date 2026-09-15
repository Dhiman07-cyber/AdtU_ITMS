import { getDriverById,getUsersByRole,getValidFcmTokensForUsers } from '@/domains/identity';
import { adminDb,messaging } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const ReportBusIssueSchema = z.object({
  busId: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  // Legacy clients nest fields under `issueData`; manual validation below
  // enforces required fields for both shapes.
  issueData: z.record(z.string(), z.any()).optional(),
}).passthrough();

// Explicit allowlist of client-writable issue fields. Identity, status and
// timestamps are server-set; anything else in issueData is dropped.
const ALLOWED_ISSUE_FIELDS = new Set(['busId', 'title', 'description', 'severity']);

export const POST = withSecurity(
  async (request, { auth, body }) => {
    const driverUid = auth.uid;

    if (!adminDb) {
      return NextResponse.json({ error: 'Issue reporting unavailable' }, { status: 500 });
    }

    // Verify that the driver exists in PostgreSQL (canonical source of truth)
    const driverData = await getDriverById(driverUid);
    if (!driverData) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }

    const rawIssue = (body as any).issueData ?? body;
    const issueFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawIssue || {})) {
      if (ALLOWED_ISSUE_FIELDS.has(key)) issueFields[key] = value;
    }
    if (!issueFields.busId || !issueFields.title) {
      return NextResponse.json({ error: 'busId and title are required' }, { status: 400 });
    }

    // Bus binding: a driver on an active trip may only report their trip bus.
    // (Drivers without an active trip keep the legacy behavior.)
    const supabase = getSupabaseServer();
    const { data: activeTrip } = await supabase
      .from('active_trips')
      .select('bus_id')
      .eq('driver_id', driverUid)
      .eq('status', 'active')
      .maybeSingle();
    if (activeTrip && activeTrip.bus_id !== issueFields.busId) {
      return NextResponse.json({ error: 'You can only report issues for your active trip bus' }, { status: 403 });
    }

    // Add driver information to issue data
    const issueWithDriver = {
      ...issueFields,
      driverUid,
      driverName: driverData.fullName || driverData.name || "Unknown Driver",
      status: 'reported',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Save issue to Firestore (retained operational collection)
    const issueRef = await adminDb.collection('bus_issues').add(issueWithDriver);

    // Send FCM notification to moderators
    try {
      // Get all moderators from PostgreSQL (canonical source of truth)
      const moderators = await getUsersByRole('moderator');
      const moderatorIds = moderators.map((m) => m.uid);

      if (moderatorIds.length > 0) {
        // Fetch tokens from PostgreSQL
        const tokenRecords = await getValidFcmTokensForUsers(moderatorIds);
        const moderatorTokens = tokenRecords.map(t => t.token);

        // Send FCM notification
        if (moderatorTokens.length > 0) {
          const message = {
            notification: {
              title: 'Bus Issue Reported',
            body: `Driver ${issueWithDriver.driverName} reported an issue with bus ${issueFields.busId}: ${issueFields.title}`
            },
            tokens: moderatorTokens,
            android: {
              priority: 'high' as const,
              notification: { channelId: 'bus_alerts', sound: 'default' }
            },
            webpush: {
              headers: { Urgency: 'high' },
              notification: {
                title: 'Bus Issue Reported',
                body: `Driver ${issueWithDriver.driverName} reported an issue with bus ${issueFields.busId}: ${issueFields.title}`,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-72x72.png',
              },
              fcmOptions: {
                link: '/moderator/notifications'
              }
            }
          };

          await messaging.sendEachForMulticast(message);
        }
      }
    } catch (fcmError) {
      console.error('Error sending FCM notifications to moderators:', fcmError);
    }

    return NextResponse.json({
      success: true,
      message: 'Bus issue reported successfully',
      issueId: issueRef.id
    });
  },
  {
    requiredRoles: ['driver'],
    schema: ReportBusIssueSchema.passthrough(),
    rateLimit: RateLimits.CREATE,
  }
);