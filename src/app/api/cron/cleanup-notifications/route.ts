import { verifyCronAuth } from '@/lib/security/cron-auth';
import { deleteExpiredNotifications } from '@/lib/notification-expiry';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron endpoint for notification cleanup
 * Should be called EVERY 3 DAYS at 2:00 AM UTC
 * 
 * Schedule in vercel.json:
 * "schedule": "0 2 *\/3 * *"  (Every 3 days at 02:00 UTC)
 * 
 * Actions:
 * - Deletes all notifications where expiresAt < now
 * - Uses batch operations for efficiency
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyCronAuth(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🕐 [CRON] Starting 3-day notification cleanup...');
    const startTime = Date.now();

    const result = await deleteExpiredNotifications();

    const duration = Date.now() - startTime;
    console.log(`🎉 [CRON] Cleanup completed in ${duration}ms`);
    console.log(`   Deleted: ${result.deletedNotifications} notifications`);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      message: `Cleaned up ${result.deletedNotifications} expired notifications`,
      result
    });
  } catch (error: any) {
    console.error('❌ Cron job error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Cron job failed'
      },
      { status: 500 }
    );
  }
}

/**
 * Manual trigger endpoint (for testing or admin use)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin authentication
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { adminAuth } = await import('@/lib/firebase-admin');
    const decodedToken = await adminAuth.verifyIdToken(token);

    const { resolveUserRole } = await import('@/lib/security/role-cache');
    const userRole = await resolveUserRole(decodedToken.uid);

    if (userRole.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('🔄 Manual notification cleanup triggered by admin:', decodedToken.uid);

    const result = await deleteExpiredNotifications();

    return NextResponse.json({
      success: true,
      message: 'Manual notification cleanup completed',
      result
    });
  } catch (error: any) {
    console.error('❌ Manual trigger error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Manual trigger failed'
      },
      { status: 500 }
    );
  }
}

