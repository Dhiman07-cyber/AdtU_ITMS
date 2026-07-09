/**
 * Cleanup Helper Functions
 * Utilities for deleting data from Firestore and associated resources
 */

import { adminAuth, adminDb } from './firebase-admin';
import { decrementBusCapacity } from './busCapacityService';
import { extractPublicId, deleteAsset } from './cloudinary-server';
import { wasSeatReleased } from './config/capacity-flags';
import { deleteUser, deleteStudent, deleteDriver, deleteModerator } from '@/domains/identity';
import * as fleetService from '@/domains/fleet';
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

    // Get user data first to retrieve profile image URL and Firebase Auth UID
    const userDoc = await adminDb.collection(`${userType}s`).doc(userId).get();

    if (!userDoc.exists) {
      return { success: false, error: 'User not found' };
    }

    const userData = userDoc.data();
    const profileImageUrl = userData?.profilePhotoUrl || userData?.photoURL || userData?.avatar;
    const firebaseAuthUid = userData?.uid || userId; // Use uid field if available, fallback to userId

    // Step 1: Delete profile image from Cloudinary if exists
    if (profileImageUrl) {
      console.log('Deleting Cloudinary image:', profileImageUrl);
      const cloudinaryResult = await deleteCloudinaryImage(profileImageUrl);
      if (cloudinaryResult) {
        console.log('Successfully deleted Cloudinary image');
      } else {
        console.warn('Failed to delete Cloudinary image, continuing with other deletions');
      }
    }

    // Step 2: Delete related data based on user type
    if (userType === 'student') {
      // Get the student's busId before deleting to decrement capacity
      const busId = userData?.busId || userData?.currentBusId || userData?.assignedBusId || null;

      // Delete student's applications from PG
      try {
        const db = getSupabaseServer();
        await db.from('applications').delete().eq('applicant_uid', userId);
        console.log(`Deleted applications from PG for student:`, userId.substring(0,8)+'...');
      } catch (pgErr) {
        console.error('Error deleting applications from PG:', pgErr);
      }

      // Delete profile update requests for this student
      try {
        const profileRequestsSnapshot = await adminDb.collection('profile_update_requests')
          .where('studentUid', '==', userId)
          .limit(400)
          .get();
        if (profileRequestsSnapshot.size > 0) {
          const batch = adminDb.batch();
          profileRequestsSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();
          console.log(`Deleted ${profileRequestsSnapshot.size} profile update requests for student:`, userId.substring(0,8)+'...');
        }
      } catch (requestsError) {
        console.error('Error deleting profile update requests:', requestsError);
      }

      // Delete student's waiting flags
      const waitingFlagsQuery = await adminDb.collection('waiting_flags')
        .where('student_uid', '==', userId)
        .limit(400)
        .get();

      if (waitingFlagsQuery.size > 0) {
        const batch = adminDb.batch();
        waitingFlagsQuery.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`Deleted ${waitingFlagsQuery.size} waiting flags for student:`, userId.substring(0,8)+'...');
      }

      // Delete any legacy fcm_tokens collection documents for this student
      // (FCM token is now embedded in student doc, but clean up old data too)
      try {
        const fcmTokensQuery = await adminDb.collection('fcm_tokens')
          .where('userUid', '==', userId)
          .limit(400)
          .get();

        if (fcmTokensQuery.size > 0) {
          const batch = adminDb.batch();
          fcmTokensQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();
          console.log(`🧹 Deleted ${fcmTokensQuery.size} legacy FCM tokens for student:`, userId.substring(0,8)+'...');
        }
      } catch (fcmError) {
        console.error('⚠️ Error cleaning up legacy FCM tokens:', fcmError);
      }

      // Decrement bus capacity if student was assigned to a bus.
      // DEDUP GUARD: skip if the seat was already released at soft block.
      // FIX: pass the student's shift so the per-shift counter is decremented too
      // (previously omitted → currentMembers moved but morningCount/eveningCount did
      // not, diverging the counters and violating currentMembers === morning+evening).
      if (busId) {
        if (wasSeatReleased(userData)) {
          console.log(`⏭️ Skipping decrement for bus ${busId} — seat already released at soft block (student: ${userId})`);
        } else {
          try {
            await decrementBusCapacity(busId, userId, userData?.shift);
            console.log(`✅ Decremented bus capacity for bus ${busId}`);
          } catch (busError) {
            console.error(`⚠️ Error decrementing bus capacity for bus ${busId}:`, busError);
            try {
              await adminDb.collection('audit_failures').add({
                kind: 'bus_capacity_decrement',
                studentUid: userId,
                busId: busId,
                shift: userData?.shift || null,
                error: busError instanceof Error ? busError.message : String(busError),
                recovered: false,
                createdAtISO: new Date().toISOString(),
              });
            } catch (outboxErr) {
              console.error('CRITICAL: Could not write audit_failure outbox for bus capacity decrement', outboxErr);
            }
          }
        }
      }

      // Delete student's notifications
      await deleteUserNotifications(userId);
    } else if (userType === 'driver') {
      // Delete driver's trip logs
      await deleteDriverTripLogs(userId);

      // Delete driver's notifications
      await deleteUserNotifications(userId);
    } else if (userType === 'moderator') {
      // Delete moderator's notifications
      await deleteUserNotifications(userId);
    }

    // Step 3: Delete user document from Firestore
    await adminDb.collection(`${userType}s`).doc(userId).delete();
    console.log(`Deleted ${userType} document from Firestore:`, userId.substring(0,8)+'...');

    // Also delete from users collection if it exists
    try {
      await adminDb.collection('users').doc(userId).delete();
      console.log(`Deleted user document from users collection:`, userId.substring(0,8)+'...');
    } catch (userDeleteError) {
      console.log(`User with ID ${userId.substring(0,8)}... not found in users collection or already deleted`);
    }

    // Delete from PostgreSQL (canonical source of truth)
    try {
      await deleteUser(userId);
      console.log(`Deleted user from PostgreSQL:`, userId.substring(0,8)+'...');
    } catch (pgDeleteError) {
      console.log(`User with ID ${userId.substring(0,8)}... not found in PostgreSQL or already deleted`);
    }

    // Delete student profile from PostgreSQL if applicable
    if (userType === 'student') {
      try {
        await deleteStudent(userId);
        console.log(`Deleted student profile from PostgreSQL:`, userId.substring(0,8)+'...');
      } catch (pgDeleteError) {
        console.log(`Student profile with ID ${userId.substring(0,8)}... not found in PostgreSQL or already deleted`);
      }
    }

    // Delete driver profile from PostgreSQL if applicable
    if (userType === 'driver') {
      try {
        await deleteDriver(userId);
        console.log(`Deleted driver profile from PostgreSQL:`, userId.substring(0,8)+'...');
      } catch (pgDeleteError) {
        console.log(`Driver profile with ID ${userId.substring(0,8)}... not found in PostgreSQL or already deleted`);
      }
    }

    // Delete moderator profile from PostgreSQL if applicable
    if (userType === 'moderator') {
      try {
        await deleteModerator(userId);
        console.log(`Deleted moderator profile from PostgreSQL:`, userId.substring(0,8)+'...');
      } catch (pgDeleteError) {
        console.log(`Moderator profile with ID ${userId.substring(0,8)}... not found in PostgreSQL or already deleted`);
      }
    }

    // Step 4: Delete from Firebase Authentication with enhanced Google account handling
    try {
      // First, get the user record to check for Google provider
      const userRecord = await adminAuth.getUser(firebaseAuthUid);
      const hasGoogleProvider = userRecord.providerData.some(provider => provider.providerId === 'google.com');

      if (hasGoogleProvider) {
        console.log(`User ${firebaseAuthUid.substring(0,8)}... has Google provider - performing enhanced deletion`);

        // Disconnect Google provider before deletion
        try {
          await adminAuth.updateUser(firebaseAuthUid, {
            providerToDelete: 'google.com'
          });
          console.log(`Successfully disconnected Google provider for user:`, firebaseAuthUid.substring(0,8)+'...');
        } catch (disconnectError: any) {
          console.log(`Could not disconnect Google provider (user may not have Google linked):`, disconnectError.message);
        }
      }

      // Delete the user from Firebase Authentication
      await adminAuth.deleteUser(firebaseAuthUid);
      console.log(`Successfully deleted user from Firebase Auth:`, firebaseAuthUid.substring(0,8)+'...');

      // Log additional information for audit
      if (hasGoogleProvider) {
        console.log(`User ${firebaseAuthUid.substring(0,8)}... was deleted with Google account disconnection`);
      }

    } catch (authError: any) {
      if (authError.code === 'auth/user-not-found') {
        console.log(`User with UID ${firebaseAuthUid.substring(0,8)}... not found in Firebase Auth`);
      } else {
        console.error('Error deleting user from Firebase Auth:', authError);
        // Don't fail the entire operation if Firebase Auth deletion fails
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
    // Delete notifications where user is in recipientIds (canonical schema)
    const recipientQuery = await adminDb.collection('notifications')
      .where('recipientIds', 'array-contains', userId)
      .limit(400)
      .get();

    if (recipientQuery.size > 0) {
      const batch1 = adminDb.batch();
      recipientQuery.docs.forEach(doc => {
        batch1.delete(doc.ref);
      });
      await batch1.commit();
      console.log(`Deleted ${recipientQuery.size} notifications for user (recipientIds):`, userId.substring(0,8)+'...');
    }

    // Also delete notifications where user is sender
    const senderQuery = await adminDb.collection('notifications')
      .where('sender.userId', '==', userId)
      .limit(400)
      .get();

    if (senderQuery.size > 0) {
      const batch2 = adminDb.batch();
      senderQuery.docs.forEach(doc => {
        batch2.delete(doc.ref);
      });
      await batch2.commit();
      console.log(`Deleted ${senderQuery.size} notifications for user (sender):`, userId.substring(0,8)+'...');
    }
  } catch (error) {
    console.error('Error deleting user notifications:', error);
  }
}

/**
 * Delete driver's trip logs
 */
async function deleteDriverTripLogs(driverId: string): Promise<void> {
  try {
    // Delete from trip_logs or similar collection
    const tripsQuery = await adminDb.collection('trip_logs')
      .where('driverId', '==', driverId)
      .limit(400)
      .get();

    const batch = adminDb.batch();
    tripsQuery.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`Deleted ${tripsQuery.size} trip logs for driver:`, driverId.substring(0,8)+'...');
  } catch (error) {
    console.error('Error deleting driver trip logs:', error);
  }
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
    const busDoc = await adminDb.collection('buses').doc(busId).get();

    if (!busDoc.exists) {
      return { success: false, error: 'Bus not found' };
    }

    // Clean student references before deleting the bus
    const studentsQuery = await adminDb.collection('students')
      .where('busId', '==', busId)
      .limit(400)
      .get();

    if (studentsQuery.size > 0) {
      const batch = adminDb.batch();
      studentsQuery.docs.forEach(doc => {
        batch.update(doc.ref, { busId: null, routeId: null, stopId: null, updatedAt: new Date().toISOString() });
      });
      await batch.commit();
      console.log(`Cleared busId/routeId/stopId from ${studentsQuery.size} students for bus:`, busId);
    }

    // Delete bus document
    await adminDb.collection('buses').doc(busId).delete();
    console.log('Deleted bus document:', busId);

    // Unassign bus from drivers
    const driversQuery = await adminDb.collection('drivers')
      .where('busId', '==', busId)
      .limit(400)
      .get();

    const batch1 = adminDb.batch();
    driversQuery.docs.forEach(doc => {
      batch1.update(doc.ref, { busId: null, updatedAt: new Date().toISOString() });
    });
    await batch1.commit();
    console.log(`Unassigned bus from ${driversQuery.size} drivers`);

    // Delete bus trip logs
    const tripsQuery = await adminDb.collection('trip_logs')
      .where('busId', '==', busId)
      .limit(400)
      .get();

    const batch2 = adminDb.batch();
    tripsQuery.docs.forEach(doc => {
      batch2.delete(doc.ref);
    });
    await batch2.commit();
    console.log(`Deleted ${tripsQuery.size} trip logs for bus:`, busId);

    return { success: true };
  } catch (error: any) {
    console.error('Error deleting bus:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete route and associated data
 */
export async function deleteRouteAndData(
  routeId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('Deleting route with ID:', routeId);

    // 1. Bulk unassign route on buses in PG
    await fleetService.unassignRoute(routeId);
    console.log(`Unassigned route ${routeId} from buses in PG`);

    // 2. Bulk unassign route on students in PG
    await studentService.unassignRoute(routeId);
    console.log(`Unassigned route ${routeId} from students in PG`);

    // 3. Delete the route from PG
    await routeService.remove(routeId);
    console.log(`Deleted route ${routeId} from PG`);

    return { success: true };
  } catch (error: any) {
    console.error('Error deleting route:', error);
    return { success: false, error: error.message };
  }
}


/**
 * Clean up trip data when driver ends trip
 */
export async function cleanupTripData(
  tripId: string,
  driverId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('Cleaning up trip data for trip ID:', tripId);

    // Delete trip log from Firestore
    await adminDb.collection('trip_logs').doc(tripId).delete();
    console.log('Deleted trip log:', tripId);

    // Delete real-time location data
    const locationsQuery = await adminDb.collection('real_time_locations')
      .where('tripId', '==', tripId)
      .limit(400)
      .get();

    const batch1 = adminDb.batch();
    locationsQuery.docs.forEach(doc => {
      batch1.delete(doc.ref);
    });
    await batch1.commit();
    console.log(`Deleted ${locationsQuery.size} location entries for trip:`, tripId);

    // Delete waiting flags for this trip
    const waitingFlagsQuery = await adminDb.collection('waiting_flags')
      .where('tripId', '==', tripId)
      .limit(400)
      .get();

    const batch2 = adminDb.batch();
    waitingFlagsQuery.docs.forEach(doc => {
      batch2.delete(doc.ref);
    });
    await batch2.commit();
    console.log(`Deleted ${waitingFlagsQuery.size} waiting flags for trip:`, tripId);

    // If using Supabase for real-time tracking, clean up there too
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      await cleanupSupabaseTripData(tripId, driverId);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error cleaning up trip data:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Clean up trip data from Supabase
 */
async function cleanupSupabaseTripData(tripId: string, driverId: string): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) return;

    // Delete from bus_locations table
    await fetch(`${supabaseUrl}/rest/v1/bus_locations?trip_id=eq.${tripId}`, {
      method: 'DELETE',
      headers: {
        'apikey': supabaseKey!,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    // Delete from waiting_flags table
    await fetch(`${supabaseUrl}/rest/v1/waiting_flags?trip_id=eq.${tripId}`, {
      method: 'DELETE',
      headers: {
        'apikey': supabaseKey!,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Cleaned up Supabase trip data for trip:', tripId);
  } catch (error) {
    console.error('Error cleaning up Supabase data:', error);
  }
}

