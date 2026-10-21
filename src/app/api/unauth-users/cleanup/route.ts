import { deleteUnauthUser, getAllUnauthUsers, getUserById } from '@/domains/identity';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { verifyCronAuth } from '@/lib/security/cron-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextRequest,NextResponse } from 'next/server';

/**
 * Cleanup old unauth users and handle application states
 * This should be called periodically (e.g., daily cron job)
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyCronAuth(request)) {
      const auth = await verifyApiAuth(request, ['admin']);
      if (!auth.authenticated) return auth.response;
    }

    const now = new Date();
    const fortyFiveDaysAgo = new Date(now.getTime() - (45 * 24 * 60 * 60 * 1000));

    let deletedCount = 0;
    let movedCount = 0;
    let totalProcessed = 0;
    const cleanupResults: Array<{ userId: string; action: string; reason: string }> = [];

    // Get all unauth users from PostgreSQL (canonical source of truth)
    const unauthUsers = await getAllUnauthUsers();
    const supabase = getSupabaseServer();

    for (const userData of unauthUsers) {
      const userId = userData.uid;
      const lastLoginAt = userData.lastLoginAt ? new Date(userData.lastLoginAt) : new Date(userData.createdAt);
      totalProcessed++;

      // Check if user should be deleted (45+ days old with no activity)
      if (lastLoginAt < fortyFiveDaysAgo) {
        // FIX 1: Protect users with active/pending/upcoming applications or completed/pending payments
        const [{ data: apps }, { data: payments }] = await Promise.all([
          supabase
            .from('applications')
            .select('application_id')
            .eq('applicant_uid', userId)
            .in('state', ['submitted', 'verified', 'awaiting_verification', 'verified_upcoming', 'pending_seat_allocation', 'approved'])
            .limit(1),
          supabase
            .from('payments')
            .select('payment_id')
            .eq('student_uid', userId)
            .in('status', ['Completed', 'Pending', 'Captured_Pending_Review', 'Duplicate_Pending_Refund'])
            .limit(1),
        ]);

        if ((apps && apps.length > 0) || (payments && payments.length > 0)) {
          cleanupResults.push({
            userId,
            action: 'skipped',
            reason: 'protected_active_application_or_payment',
          });
          continue;
        }

        try {
          await adminAuth.deleteUser(userId);
        } catch (authError: any) {
          console.error(`Failed to delete Firebase Auth user ${userId}:`, authError.message);
        }

        // Delete from PostgreSQL first (canonical)
        try {
          await deleteUnauthUser(userId);
        } catch (pgErr: any) {
          console.error(`PG delete failed for ${userId}:`, pgErr.message);
        }

        deletedCount++;
        cleanupResults.push({ userId, action: 'deleted', reason: '45+ days inactive' });
        continue;
      }

      // Check if user should be moved to users collection (approved applications)
      if (userData.status === 'approved') {
        try {
          const existingUser = await getUserById(userId);
          if (existingUser) {
            try {
              await deleteUnauthUser(userId);
              cleanupResults.push({ userId, action: 'deleted', reason: 'already migrated to users' });
            } catch (pgErr: any) {
              console.error(`PG delete failed for already migrated unauth user ${userId}:`, pgErr.message);
            }
          } else {
            // FIX 6: If user is approved but does NOT yet exist in public.users,
            // do NOT create a broken skeleton student profile without bus/shift/validUntil/capacity!
            // Leave the record for Application.approve / session-activation to activate properly with full bus capacity.
            cleanupResults.push({ userId, action: 'skipped', reason: 'awaiting_proper_session_activation' });
          }
        } catch (moveError: any) {
          console.error(`Failed to move user ${userId}:`, moveError.message);
        }
        continue;
      }

      // Check if user should be deleted (rejected applications)
      if (userData.status === 'rejected') {
        try {
          await adminAuth.deleteUser(userId);
        } catch (authError: any) {
          console.error(`Failed to delete Firebase Auth user ${userId}:`, authError.message);
        }

        // Delete from PostgreSQL first (canonical)
        try {
          await deleteUnauthUser(userId);
        } catch (pgErr: any) {
          console.error(`PG delete failed for ${userId}:`, pgErr.message);
        }

        deletedCount++;
        cleanupResults.push({ userId, action: 'deleted', reason: 'rejected application' });
        continue;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Cleanup completed successfully',
      results: {
        totalProcessed,
        deleted: deletedCount,
        moved: movedCount,
        kept: totalProcessed - deletedCount - movedCount
      },
      details: cleanupResults
    });

  } catch (error: any) {
    console.error('Error during cleanup:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup unauth users' },
      { status: 500 }
    );
  }
}

export const GET = POST;

