/**
 * Cleanup Helper Functions
 * Utilities for deleting data from Firestore and associated resources
 */

import { adminAuth, adminDb } from './firebase-admin';
import { pgDeleteNotificationsByUser } from '@/domains/notification/repositories/notification.repository.pg';
import { extractPublicId, deleteAsset } from './cloudinary-server';
import { wasSeatReleased } from './config/capacity-flags';
import { deleteUser, deleteStudent, deleteDriver, deleteModerator, updateStudent, updateDriver, getAllDrivers, getStudentsByBusIds, getStudentById, getDriverById, getModeratorById } from '@/domains/identity';
import * as fleetService from '@/domains/fleet';
import { deleteUserTokens } from '@/lib/services/fcm-token-service';
import * as studentService from '@/domains/student';
import * as routeService from '@/domains/route';
import { getSupabaseServer } from '@/lib/supabase-server';

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
 * Delete user and associated data from Firestore, Firebase Auth, and Cloudinary
 * 
 * IMPORTANT: Google Account Deletion Process
 * - This function deletes the user from Firebase Authentication
 * - For Google-authenticated users, it attempts to disconnect the Google provider
 * - However, the actual Google account itself cannot be deleted programmatically
 * - The Google account remains active but is disconnected from Firebase Auth
 * - Users cannot re-register with the same Google account unless manually reconnected
 * 
 * What happens to Google accounts:
 * 1. Google provider is disconnected from Firebase Auth
 * 2. Firebase Auth user record is deleted
 * 3. Google account remains active but cannot be used to sign in
 * 4. User would need to manually reconnect their Google account to re-register
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

    const profileImageUrl = userData?.profilePhotoUrl;
    const firebaseAuthUid = userData?.uid || userId;
    const busId = userData?.busId || userData?.currentBusId || userData?.busId || null;
    const shouldDecrement = !!busId && !wasSeatReleased(userData);

    // 2. PostgreSQL Transaction Commit Boundary (PG deletes first)
    if (userType === 'student') {
      const db = getSupabaseServer();
      const { error: rpcError } = await db.rpc('delete_student_cascade_v1', {
        p_student_uid: userId,
      });
      if (rpcError) {
        throw new Error(`delete_student_cascade_v1 RPC failed: ${rpcError.message}`);
      }
      console.log(`✅ PostgreSQL database cascade transaction committed for student: ${userId.substring(0,8)}...`);
    } else {
      // Driver and Moderator - non-cascade deletes
      try {
        await deleteUser(userId);
        console.log(`Deleted user from PostgreSQL:`, userId.substring(0,8)+'...');
      } catch (pgDeleteError: any) {
        console.warn(`User with ID ${userId.substring(0,8)}... user table delete warning:`, pgDeleteError.message);
      }

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
    }

    // 3. Firebase Auth User Deletion & JWT Revocation (Pre-commit / External)
    try {
      await adminAuth.revokeRefreshTokens(firebaseAuthUid);
      await adminAuth.deleteUser(firebaseAuthUid);
      console.log(`Successfully deleted user from Firebase Auth:`, firebaseAuthUid.substring(0,8)+'...');
    } catch (authError: any) {
      if (authError.code !== 'auth/user-not-found') {
        console.warn('Firebase Auth deletion warning:', authError.message);
      }
    }

    // 4. Firestore & Legacy Cleanup (External)
    if (userType === 'student') {
      // Delete FCM tokens from Firestore subcollection
      try {
        await deleteUserTokens(userId);
      } catch (fcmErr: any) {
        console.warn('Firestore tokens subcollection delete warning:', fcmErr.message);
      }

      // Delete profile update requests
      try {
        const profileRequestsSnapshot = await adminDb.collection('profile_update_requests')
          .where('studentUid', '==', userId)
          .limit(400)
          .get();
        if (!profileRequestsSnapshot.empty) {
          const batch = adminDb.batch();
          profileRequestsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      } catch (requestsError: any) {
        console.warn('Firestore profile update requests delete warning:', requestsError.message);
      }

      // ponytail: Legacy Firestore fcm_tokens collection cleanup removed — PostgreSQL
      // fcm_tokens table is the canonical store. Old Firestore collection is dead data.

      // ponytail: Firestore waiting_flags cleanup removed — PostgreSQL
      // delete_student_cascade_v1 RPC already deletes waiting_flags by student_uid.
    } else if (userType === 'driver') {
      // Delete driver's trip logs
      await deleteDriverTripLogs(userId);
    }

    // Common non-student notifications delete (already handled in RPC for student)
    if (userType !== 'student') {
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
    if (userType === 'student' && shouldDecrement && busId) {
      try {
        await fleetService.onStudentDeleted({
          studentUid: userId,
          busId,
          shift: userData?.shift,
        });
        console.log(`✅ Fleet notified of student deletion (capacity update delegated)`);
      } catch (fleetErr: any) {
        console.error(`⚠️ Fleet capacity update delegation failed:`, fleetErr.message);
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
 * Delete user's notifications
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
 * Delete driver's trip logs
 *
 * ponytail: Firestore trip_logs cleanup removed — trip data lifecycle is
 * managed by PostgreSQL: active_trips cleaned by cleanup-stale-locks cron,
 * bus_locations/driver_location_updates cleaned by cleanup_old_* RPCs.
 */
async function deleteDriverTripLogs(_driverId: string): Promise<void> {
  // No-op: PostgreSQL trip lifecycle manages this data.
}

/**
 * Delete bus and associated data
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

    // 1. Clean student references in PostgreSQL
    try {
      const students = await getStudentsByBusIds([busId]);
      for (const student of students) {
        await updateStudent(student.uid, {
          busId: null,
          routeId: null,
          stop_name: null
        });
      }
      console.log(`Cleared busId/routeId/stop_name from ${students.length} students in PostgreSQL`);
    } catch (pgStudErr) {
      console.error('Error clearing student bus assignments in PostgreSQL:', pgStudErr);
    }

    // 2. Unassign bus from drivers in PostgreSQL
    try {
      const drivers = await getAllDrivers();
      const assignedDrivers = drivers.filter(d => d.busId === busId || d.busId === busId);
      for (const driver of assignedDrivers) {
        await updateDriver(driver.uid, {
          busId: null,
        });
      }
      console.log(`Unassigned bus ${busId} from ${assignedDrivers.length} drivers in PostgreSQL`);
    } catch (pgDriverErr) {
      console.error('Error unassigning bus from drivers in PostgreSQL:', pgDriverErr);
    }

    // 3. Delete bus from PostgreSQL
    try {
      await fleetService.removeBus(busId);
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

    console.log(`Route ${routeId} deleted: ${data.busesCleaned} buses, ${data.studentsCleaned} students cleaned`);
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting route:', error);
    return { success: false, error: error.message };
  }
}


// ponytail: cleanupTripData/cleanupSupabaseTripData removed — never called.
// Trip data cleanup is handled by PostgreSQL cron: cleanup-stale-locks cleans
// active_trips, bus_locations, driver_location_updates, waiting_flags by trip_id.

