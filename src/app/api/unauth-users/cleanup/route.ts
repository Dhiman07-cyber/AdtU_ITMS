import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyApiAuth, verifyCronSecret } from '@/lib/security/api-auth';
import { createUser, getUserById, createStudent, deleteUnauthUser, getAllUnauthUsers } from '@/domains/identity';

/**
 * Cleanup old unauth users and handle application states
 * This should be called periodically (e.g., daily cron job)
 */
export async function POST(request: NextRequest) {
  try {
    if (!verifyCronSecret(request)) {
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

    for (const userData of unauthUsers) {
      const userId = userData.uid;
      const lastLoginAt = userData.lastLoginAt ? new Date(userData.lastLoginAt) : new Date(userData.createdAt);
      totalProcessed++;

      // Check if user should be deleted (45+ days old with no activity)
      if (lastLoginAt < fortyFiveDaysAgo) {
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
          if (existingUser) continue;

          // Write user to PostgreSQL (canonical source of truth)
          await createUser({
            uid: userId,
            email: userData.email,
            name: userData.displayName || userData.name,
            role: 'student',
            createdAt: userData.createdAt || new Date().toISOString(),
            lastLoginAt: userData.lastLoginAt || null,
            profilePhotoUrl: userData.profilePhotoUrl || null,
          });

          // Write student to PostgreSQL (canonical source of truth)
          await createStudent({
            uid: userId,
            email: userData.email,
            fullName: userData.displayName || userData.name,
            profilePhotoUrl: userData.profilePhotoUrl || null,
            createdAt: userData.createdAt,
            updatedAt: new Date().toISOString(),
          });

          // Delete unauth user from PostgreSQL
          try {
            await deleteUnauthUser(userId);
          } catch (pgErr: any) {
            console.error(`PG delete failed for ${userId}:`, pgErr.message);
          }

          movedCount++;
          cleanupResults.push({ userId, action: 'moved', reason: 'approved application' });
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
