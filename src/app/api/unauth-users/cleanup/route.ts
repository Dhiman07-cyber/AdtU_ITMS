import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { verifyApiAuth, verifyCronSecret } from '@/lib/security/api-auth';
import { createUser, getUserById, createStudent, deleteUnauthUser } from '@/domains/identity';

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

    if (!adminDb) {
      console.error('Admin Firestore not initialized');
      return NextResponse.json({ error: 'Database not available' }, { status: 500 });
    }

    const now = new Date();
    const fortyFiveDaysAgo = new Date(now.getTime() - (45 * 24 * 60 * 60 * 1000));

    // Get all unauth users (paginated to prevent OOM)
    const PAGE_SIZE = 500;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    let hasMore = true;
    let deletedCount = 0;
    let movedCount = 0;
    let totalProcessed = 0;
    const cleanupResults: Array<{ userId: string; action: string; reason: string }> = [];

    while (hasMore) {
      let query = adminDb.collection('unauthUsers').orderBy('__name__').limit(PAGE_SIZE) as any;
      if (lastDoc) query = query.startAfter(lastDoc);
      const unauthUsersQuery = await query.get();

      if (unauthUsersQuery.empty || unauthUsersQuery.docs.length < PAGE_SIZE) hasMore = false;
      if (unauthUsersQuery.docs.length > 0) lastDoc = unauthUsersQuery.docs[unauthUsersQuery.docs.length - 1];

      for (const doc of unauthUsersQuery.docs) {
        const userData = doc.data();
        const userId = doc.id;
        const lastLoginAt = new Date(userData.lastLoginAt);
        totalProcessed++;

        // Check if user should be deleted (45+ days old with no activity)
        if (lastLoginAt < fortyFiveDaysAgo) {
          try {
            await adminAuth.deleteUser(userId);
          } catch (authError: any) {
            console.error(`Failed to delete Firebase Auth user ${userId}:`, authError.message);
          }

          await adminDb.collection('unauthUsers').doc(userId).delete();
          // Also delete from PostgreSQL
          try { await deleteUnauthUser(userId); } catch (pgErr: any) { console.error(`PG delete failed for ${userId}:`, pgErr.message); }
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
              name: userData.displayName,
              role: 'student',
              createdAt: userData.createdAt || new Date().toISOString(),
              lastLoginAt: userData.lastLoginAt || null,
              profilePhotoUrl: userData.profilePhotoUrl || null,
            });

            await adminDb.collection('students').doc(userId).set({
              uid: userId,
              email: userData.email,
              fullName: userData.displayName,
              profilePhotoUrl: userData.profilePhotoUrl || null,
              createdAt: userData.createdAt,
              updatedAt: new Date().toISOString()
            });

            // Write student to PostgreSQL (canonical source of truth)
            await createStudent({
              uid: userId,
              email: userData.email,
              fullName: userData.displayName,
              profilePhotoUrl: userData.profilePhotoUrl || null,
              createdAt: userData.createdAt,
              updatedAt: new Date().toISOString(),
            });

            await adminDb.collection('unauthUsers').doc(userId).delete();
            // Also delete from PostgreSQL
            try { await deleteUnauthUser(userId); } catch (pgErr: any) { console.error(`PG delete failed for ${userId}:`, pgErr.message); }
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

          await adminDb.collection('unauthUsers').doc(userId).delete();
          // Also delete from PostgreSQL
          try { await deleteUnauthUser(userId); } catch (pgErr: any) { console.error(`PG delete failed for ${userId}:`, pgErr.message); }
          deletedCount++;
          cleanupResults.push({ userId, action: 'deleted', reason: 'rejected application' });
          continue;
        }
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
