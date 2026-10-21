/**
 * Cleanup Helper Functions
 * Utilities for cascading user, bus, and route deletions across PostgreSQL (Supabase), Firebase Auth, Cloudinary, and FCM.
 */

import * as fleetService from '@/domains/fleet';
import { deleteDriver,deleteModerator,deleteUser,getAllDrivers,getDriverById,getModeratorById,getStudentById,getStudentsByBusIds,updateDriver,updateStudent } from '@/domains/identity';
import { pgDeleteNotificationsByUser } from '@/domains/notification/repositories/notification.repository.pg';
import { deleteUserTokens } from '@/lib/services/fcm-token-service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { deleteAsset,extractPublicId } from './cloudinary-server';
import { wasSeatReleased } from './config/capacity-flags';
import { adminAuth } from './firebase-admin';
import { invalidateStudentAssignmentCache } from '@/domains/student';
import { invalidateCachedRole } from '@/lib/security/role-cache';
import { invalidateModeratorPermissionCache } from '@/lib/security/moderator-permissions';
import { getBusIdVariations } from '@/lib/utils';
import { invalidateBusTripSnapshot } from '@/lib/services/trip-snapshot-cache';

/**
 * Delete profile image from Cloudinary
 * Uses the centralised cloudinary-server module (SDK-based, no manual signatures).
 */
export async function deleteCloudinaryImage(imageUrl: string): Promise<boolean> {
  if (!imageUrl || !imageUrl.includes('cloudinary')) {
    return false;
  }

  const publicId = extractPublicId(imageUrl);
  if (!publicId) {
    console.error('Could not extract public_id from URL:', imageUrl);
    return false;
  }

  console.log('Deleting Cloudinary image with public_id:', publicId);
  return deleteAsset(publicId);
}

/**
 * Delete user and associated data from PostgreSQL, Firebase Auth, Cloudinary, and FCM
 * 
 * IMPORTANT: Google Account Deletion Process
 * - This function deletes the user from Firebase Authentication
 * - For Google-authenticated users, it attempts to disconnect the Google provider
 * - However, the actual Google account itself cannot be deleted programmatically
 * - The Google account remains active but is disconnected from Firebase Auth
 * 
 * What happens to Google accounts:
 * 1. Google provider is disconnected from Firebase Auth
 * 2. Firebase Auth user record is deleted
 * 3. Google account remains active but cannot be used to sign in
 */
export async function deleteUserAndData(
  userId: string,
  userType: 'student' | 'driver' | 'moderator'
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`Deleting ${userType} with ID:`, userId.substring(0,8)+'...');

    // 1. Retrieve current state first (pre-commit lookup)
    let userData: Record<string, any> | null = null;
    if (userType === 'student') {
      userData = await getStudentById(userId);
    } else if (userType === 'driver') {
      userData = await getDriverById(userId);
    } else if (userType === 'moderator') {
      userData = await getModeratorById(userId);
    }

    if (!userData) {
      return { success: false, error: 'User not found' };
    }

    // Active trip protection for drivers
    if (userType === 'driver') {
      const db = getSupabaseServer();
      const { data: activeTrip } = await db
        .from('active_trips')
        .select('id')
        .eq('driver_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (activeTrip) {
        return { success: false, error: 'Cannot delete driver while an active trip is in progress. End the trip first.' };
      }
    }

    const profileImageUrl = userData?.profilePhotoUrl;
    const firebaseAuthUid = userData?.uid || userId;
    const busId = userData?.busId || userData?.currentBusId || null;
    const shouldDecrement = !!busId && !wasSeatReleased(userData);

    // 2. PostgreSQL Transaction Commit Boundary (PG deletes first)
    if (userType === 'student') {
      const db = getSupabaseServer();
      const { data: rpcData, error: rpcError } = await db.rpc('delete_student_cascade_v1', {
        p_student_uid: userId,
      });
      if (rpcError) {
        throw new Error(`delete_student_cascade_v1 RPC failed: ${rpcError.message}`);
      }
      if (!rpcData || (rpcData as any).success !== true) {
        const rpcErr = (rpcData as any)?.error;
        const msg = rpcErr === 'ACTIVE_STUDENT_ABORT_DELETE'
          ? 'Cannot delete student: Student has active transport status. Release seat or soft-block first.'
          : rpcErr === 'ACTIVE_RENEWAL_APP_ABORT_DELETE'
          ? 'Cannot delete student: Student has an active renewal application in progress.'
          : `Student deletion aborted: ${rpcErr || 'Database cascade did not return success'}`;
        return { success: false, error: msg };
      }
      console.log(`✅ PostgreSQL database cascade transaction committed for student: ${userId.substring(0,8)}...`);
    } else {
      // Driver and Moderator - delete profile first, then user table
      if (userType === 'driver') {
        try {
          await deleteDriver(userId);
          console.log(`Deleted driver profile from PostgreSQL:`, userId.substring(0,8)+'...');
        } catch (pgDeleteError: any) {
          console.warn(`Driver profile delete warning:`, pgDeleteError.message);
        }
      } else if (userType === 'moderator') {
        try {
          await deleteModerator(userId);
          console.log(`Deleted moderator profile from PostgreSQL:`, userId.substring(0,8)+'...');
        } catch (pgDeleteError: any) {
          console.warn(`Moderator profile delete warning:`, pgDeleteError.message);
        }
      }

      try {
        await deleteUser(userId);
        console.log(`Deleted user from PostgreSQL:`, userId.substring(0,8)+'...');
      } catch (pgDeleteError: any) {
        console.warn(`User with ID ${userId.substring(0,8)}... user table delete warning:`, pgDeleteError.message);
      }
    }

    // Invalidate role cache and permissions immediately
    invalidateCachedRole(userId);
    if (userType === 'moderator') {
      invalidateModeratorPermissionCache(userId);
    }
    if (firebaseAuthUid && firebaseAuthUid !== userId) {
      invalidateCachedRole(firebaseAuthUid);
      if (userType === 'moderator') {
        invalidateModeratorPermissionCache(firebaseAuthUid);
      }
    }

    // 3. Firebase Auth User Deletion & JWT Revocation (External)
    try {
      await adminAuth.revokeRefreshTokens(firebaseAuthUid);
      await adminAuth.deleteUser(firebaseAuthUid);
      console.log(`Successfully deleted user from Firebase Auth:`, firebaseAuthUid.substring(0,8)+'...');
    } catch (authError: any) {
      if (authError.code !== 'auth/user-not-found') {
        console.warn('Firebase Auth deletion warning:', authError.message);
      }
    }

    // 4. FCM & Cache Cleanup (External)
    if (userType === 'student') {
      // Invalidate student assignment cache across L1 memory and Redis
      try {
        await invalidateStudentAssignmentCache(userId);
      } catch (cacheErr: any) {
        console.warn('Student assignment cache invalidation warning:', cacheErr.message);
      }

      // Delete FCM tokens from Firestore subcollection
      try {
        await deleteUserTokens(userId);
      } catch (fcmErr: any) {
        console.warn('FCM tokens subcollection delete warning:', fcmErr.message);
      }
    } else if (userType === 'driver') {
      console.log(`ℹ️ Preserving trip history logs and operational notifications for deleted driver: ${userId.substring(0,8)}...`);
    }

    // Common moderator notifications cleanup
    if (userType === 'moderator') {
      await deleteUserNotifications(userId);
    }

    // 5. Cloudinary Profile Image Deletion (External)
    if (profileImageUrl) {
      const publicId = extractPublicId(profileImageUrl);
      if (publicId) {
        try {
          await deleteAsset(publicId);
          console.log('Successfully deleted Cloudinary image:', publicId);
        } catch (cloudErr: any) {
          console.warn('Cloudinary delete warning:', cloudErr.message);
        }
      }
    }

    // 6. Fleet Domain Delegation (Post-commit)
    // Note: Database capacity counters are decremented atomically inside delete_student_cascade_v1.
    // Invalidate bus and student assignment caches to ensure fresh reads without double-decrementing.
    if (userType === 'student' && busId) {
      try {
        fleetService.invalidateBusCache(busId);
        await invalidateStudentAssignmentCache(userId);
        console.log(`✅ Fleet and student caches invalidated for deleted student`);
      } catch (fleetErr: any) {
        console.error(`⚠️ Fleet/student cache invalidation failed:`, fleetErr.message);
      }
    }

    console.log(`Successfully completed deletion of ${userType} with ID:`, userId.substring(0,8)+'...');
    return { success: true };
  } catch (error: any) {
    console.error(`Error deleting ${userType}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete user's notifications in PostgreSQL
 */
async function deleteUserNotifications(userId: string): Promise<void> {
  try {
    const count = await pgDeleteNotificationsByUser(userId);
    console.log(`Deleted ${count} notifications for user:`, userId.substring(0,8)+'...');
  } catch (error) {
    console.error('Error deleting user notifications:', error);
  }
}

/**
 * Delete bus and associated data in PostgreSQL
 */
export async function deleteBusAndData(
  busId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('Deleting bus with ID:', busId);

    // Get bus data
    const busData = await fleetService.getBusById(busId);

    if (!busData) {
      return { success: false, error: 'Bus not found' };
    }

    const db = getSupabaseServer();

    // 1. Active Trip Guard (Cannot delete bus during active trip)
    const busVariations = getBusIdVariations(busId);
    const { data: activeTrips } = await db
      .from('active_trips')
      .select('id, status')
      .in('bus_id', busVariations)
      .in('status', ['active', 'SCHEDULED', 'IN_TRANSIT', 'started', 'in_progress'])
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (activeTrips && activeTrips.length > 0) {
      return { success: false, error: 'Cannot delete bus while an active trip is in progress. End the trip first.' };
    }

    // 2. Active Enrolled Students Guard (Cannot delete bus with active seat-holding students)
    const students = (await getStudentsByBusIds(busVariations)) || [];
    const activeStudents = students.filter(s => s.status === 'active' && !wasSeatReleased(s));
    if (activeStudents.length > 0) {
      return {
        success: false,
        error: `Cannot delete bus while ${activeStudents.length} active seat-holding student(s) are assigned to it. Reassign students first.`
      };
    }

    // 3. Clean student references for remaining inactive/seat-released students (batch update, no N+1 loops)
    try {
      const { data: updatedStudents, error: studErr } = await db
        .from('student_profiles')
        .update({
          bus_id: null,
          route_id: null,
          stop_name: null,
          updated_at: new Date().toISOString(),
        })
        .in('bus_id', busVariations)
        .select('uid');

      if (studErr) {
        console.error('Error clearing student bus assignments in PostgreSQL:', studErr);
      }

      const affectedStudentUids = new Set<string>([
        ...students.map((s) => s.uid),
        ...(updatedStudents || []).map((s: { uid: string }) => s.uid),
      ]);

      for (const sUid of affectedStudentUids) {
        invalidateStudentAssignmentCache(sUid);
      }
      console.log(`Cleared busId/routeId/stop_name from ${affectedStudentUids.size} students in PostgreSQL`);
    } catch (pgStudErr) {
      console.error('Error clearing student bus assignments in PostgreSQL:', pgStudErr);
    }

    // 4. Unassign bus from drivers in PostgreSQL (batch update, no N+1 loops)
    try {
      const { data: updatedDrivers, error: driverErr } = await db
        .from('driver_profiles')
        .update({
          bus_id: null,
          updated_at: new Date().toISOString(),
        })
        .in('bus_id', busVariations)
        .select('uid');

      if (driverErr) {
        console.error('Error unassigning bus from drivers in PostgreSQL:', driverErr);
      } else {
        console.log(`Unassigned bus ${busId} from ${updatedDrivers?.length || 0} drivers in PostgreSQL`);
      }
    } catch (pgDriverErr) {
      console.error('Error unassigning bus from drivers in PostgreSQL:', pgDriverErr);
    }

    // 5. Delete bus from PostgreSQL and invalidate all caches
    try {
      await fleetService.removeBus(busId);
      for (const bVar of busVariations) {
        fleetService.invalidateBusCache(bVar);
        invalidateBusTripSnapshot(bVar);
      }
      console.log('Deleted bus from PostgreSQL:', busId);
    } catch (pgBusErr) {
      console.error('Error deleting bus from PostgreSQL:', pgBusErr);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error deleting bus:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete route and associated data (atomic via PostgreSQL RPC)
 */
export async function deleteRouteAndData(
  routeId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('Deleting route with ID:', routeId);

    const db = getSupabaseServer();
    const { data, error } = await db.rpc('delete_route_cascade_v1', {
      p_route_id: routeId,
    });

    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error('RPC returned failure');

    const { invalidateRouteCache } = await import('@/domains/route');
    invalidateRouteCache(routeId);
    fleetService.invalidateBusCache();

    console.log(`Route ${routeId} deleted: ${data.busesCleaned} buses, ${data.studentsCleaned} students cleaned`);
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting route:', error);
    return { success: false, error: error.message };
  }
}
