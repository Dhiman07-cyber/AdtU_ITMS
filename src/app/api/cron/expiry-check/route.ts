import { NextRequest, NextResponse } from 'next/server';
import { checkAndNotifyExpiringStudents, sendMidJuneReminder } from '@/lib/expiry-check';
import crypto from 'crypto';

/**
 * Cron endpoint for expiry checks
 * 
 * This should be called by a cron service (e.g., Vercel Cron, Cloud Scheduler)
 * Schedule:
 * - June 1st: Main expiry check
 * - June 15th: Mid-month reminder
 * 
 * Security: Add authorization header check in production
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (in production)
    const authHeader = request.headers.get('Authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('🚫 CRON_SECRET not configured — blocking cron request');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }
    const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
    const secretsMatch = providedToken.length === cronSecret.length &&
      crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(cronSecret));
    if (!secretsMatch) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check query params for which check to run
    const searchParams = request.nextUrl.searchParams;
    const checkType = searchParams.get('type') || 'main';

    let result;

    if (checkType === 'mid-june') {
      console.log('🔄 Running mid-June reminder check...');
      result = await sendMidJuneReminder();
    } else {
      console.log('🔄 Running main expiry check...');
      result = await checkAndNotifyExpiringStudents();
    }

    return NextResponse.json({
      success: true,
      message: 'Expiry check completed',
      result
    });
  } catch (error: any) {
    console.error('❌ Cron job error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Expiry check failed'
      },
      { status: 500 }
    );
  }
}

/**
 * Manual trigger endpoint (for testing)
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

    console.log('🔄 Manual expiry check triggered by admin:', decodedToken.uid);

    const result = await checkAndNotifyExpiringStudents();

    return NextResponse.json({
      success: true,
      message: 'Manual expiry check completed',
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

