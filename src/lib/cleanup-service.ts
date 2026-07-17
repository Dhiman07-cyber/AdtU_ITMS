import { db as adminDb, FieldValue } from './firebase-admin';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { getUsersByRole, getDriverById, getStudentsByBusIds } from '@/domains/identity';

/**
 * Event-Driven Cleanup Service
 * No cron jobs - only opportunistic cleanup when system is active
 */
export class CleanupService {

  /**
   * Clean up expired driver swaps and revert bus assignments
   * Called opportunistically when system is active
   *
   * Firestore hard limit: 500 operations per batch.
   * Each expired swap requires 2 operations (1 delete + 1 bus update).
   * We cap at 200 swaps per batch (400 ops) to stay safely under the limit.
   * Stale request cleanup runs in a separate batch.
   */
  static async cleanExpiredSwaps(): Promise<{ cleaned: number; reverted: number }> {
    try {
      const now = new Date();
      let cleaned = 0;
      let reverted = 0;
      const allBusUpdates: Map<string, string> = new Map(); // busId -> originalDriverId

      // Phase 1: Process expired swaps in chunked batches
      // Each swap = 1 delete + 1 bus update = 2 ops. Cap at 200 swaps = 400 ops.
      const SWAP_BATCH_SIZE = 200;
      let hasMoreSwaps = true;

      while (hasMoreSwaps) {
        const activeSwapsSnapshot = await adminDb
          .collection('driver_swap_requests')
          .where('status', '==', 'accepted')
          .limit(SWAP_BATCH_SIZE)
          .get();

        if (activeSwapsSnapshot.empty) {
          hasMoreSwaps = false;
          break;
        }

        const batch = adminDb.batch();
        const batchBusUpdates: Map<string, string> = new Map();

        for (const doc of activeSwapsSnapshot.docs) {
          const swap = doc.data();

          if (swap.timePeriod?.endTime) {
            const endTime = new Date(swap.timePeriod.endTime);

            if (endTime <= now) {
              batch.delete(doc.ref);
              batchBusUpdates.set(swap.busId, swap.fromDriverUID);
              cleaned++;
            }
          }
        }

        // Revert bus assignments for this chunk
        for (const [busId, originalDriverId] of batchBusUpdates.entries()) {
          const busRef = adminDb.collection('buses').doc(busId);
          batch.update(busRef, {
            activeDriverId: originalDriverId,
            updatedAt: FieldValue.serverTimestamp()
          });
          reverted++;
        }

        // Commit this chunk — max 200 deletes + 200 updates = 400 ops
        await batch.commit();

        // Collect bus updates for post-commit notifications
        for (const [busId, driverId] of batchBusUpdates.entries()) {
          allBusUpdates.set(busId, driverId);
        }

        // If we got fewer than SWAP_BATCH_SIZE docs, there are no more
        hasMoreSwaps = activeSwapsSnapshot.size === SWAP_BATCH_SIZE;
      }

      // Phase 2: Clean up old pending/rejected/cancelled requests (>7 days old)
      // Separate batch — max 100 ops, well under limit.
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const staleRequestsSnapshot = await adminDb
        .collection('driver_swap_requests')
        .where('status', 'in', ['pending', 'rejected', 'cancelled', 'expired'])
        .where('createdAt', '<', sevenDaysAgo)
        .limit(400)
        .get();

      if (staleRequestsSnapshot.size > 0) {
        const staleBatch = adminDb.batch();
        staleRequestsSnapshot.docs.forEach((doc: any) => {
          staleBatch.delete(doc.ref);
        });
        await staleBatch.commit();
        cleaned += staleRequestsSnapshot.size;
      }

      // Send notifications AFTER all commits — failure here does NOT
      // prevent the swap revert from being persisted.
      for (const [busId, originalDriverId] of allBusUpdates.entries()) {
        try {
          await this.notifySwapReverted(busId, originalDriverId);
        } catch (notifErr) {
          console.error(`Non-critical: notification failed for bus ${busId} revert:`, notifErr);
        }
      }

      console.log(`✅ Cleanup: ${cleaned} swaps cleaned, ${reverted} buses reverted`);
      return { cleaned, reverted };
    } catch (error) {
      console.error('❌ Error cleaning expired swaps:', error);
      return { cleaned: 0, reverted: 0 };
    }
  }

  /**
   * Clean up old audit logs (>30 days)
   * Called opportunistically
   */
  static async cleanOldAuditLogs(): Promise<number> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      let deleted = 0;

      const oldAuditSnapshot = await adminDb
        .collection('driver_swap_audit')
        .where('timestamp', '<', thirtyDaysAgo)
        .limit(100)
        .get();

      const batch = adminDb.batch();

      oldAuditSnapshot.docs.forEach((doc: any) => {
        batch.delete(doc.ref);
        deleted++;
      });

      await batch.commit();

      console.log(`✅ Cleanup: ${deleted} old audit logs deleted`);
      return deleted;
    } catch (error) {
      console.error('❌ Error cleaning old audit logs:', error);
      return 0;
    }
  }

  /**
   * Master cleanup function - runs all cleanup tasks
   * Call this opportunistically when system is active
   */
  static async runOpportunisticCleanup(): Promise<void> {
    console.log('🧹 Running opportunistic cleanup...');

    try {
      const results = await Promise.allSettled([
        this.cleanExpiredSwaps(),
        this.cleanOldAuditLogs()
      ]);

      console.log('✅ Opportunistic cleanup completed:', results);
    } catch (error) {
      console.error('❌ Error during opportunistic cleanup:', error);
    }
  }

  /**
   * Check and auto-revert a specific swap if time expired
   * Called when driver logs in or accesses system
   */
  static async checkAndRevertExpiredSwap(busId: string): Promise<boolean> {
    try {
      const now = new Date();

      // Find active swap for this bus
      const swapsSnapshot = await adminDb
        .collection('driver_swap_requests')
        .where('busId', '==', busId)
        .where('status', '==', 'accepted')
        .limit(1)
        .get();

      if (swapsSnapshot.empty) return false;

      const swapDoc = swapsSnapshot.docs[0];
      const swap = swapDoc.data();

      // Check if swap has expired
      if (swap.timePeriod?.endTime) {
        const endTime = new Date(swap.timePeriod.endTime);

        if (endTime <= now) {
          // Revert the swap
          await adminDb.runTransaction(async (transaction: any) => {
            const busRef = adminDb.collection('buses').doc(busId);
            const busSnap = await transaction.get(busRef);
            if (!busSnap.exists) return false;

            transaction.update(busRef, {
              activeDriverId: swap.fromDriverUID,
              updatedAt: FieldValue.serverTimestamp()
            });

            // DELETE the expired swap document
            transaction.delete(swapDoc.ref);
          });

          // Notify stakeholders
          await this.notifySwapReverted(busId, swap.fromDriverUID);

          console.log(`✅ Auto-reverted expired swap for bus ${busId}`);
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('❌ Error checking/reverting swap:', error);
      return false;
    }
  }

  /**
   * Send notifications when swap is auto-reverted
   */
  private static async notifySwapReverted(busId: string, originalDriverId: string): Promise<void> {
    try {
      // Get bus and driver details
      const [busDoc, driverData] = await Promise.all([
        adminDb.collection('buses').doc(busId).get(),
        getDriverById(originalDriverId)
      ]);

      const busNumber = busDoc.data()?.busNumber || busId;
      const driverName = driverData?.fullName || 'the original driver';

      // Notify students
      const pgStudents = await getStudentsByBusIds([busId]);
      const studentUIDs = pgStudents
        .map((s: any) => s.uid)
        .filter((uid: any) => uid);

      if (studentUIDs.length > 0) {
        // Calculate expiry (1 day from now)
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 1);
        expiryDate.setHours(23, 59, 59, 999);

        await pgInsertNotification({
          title: `Driver Change Complete — ${busNumber}`,
          content: `${driverName} is back as your regular driver for Bus ${busNumber}.`,
          type: 'info',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'all_role',
            roleFilter: 'student'
          },
          recipientIds: studentUIDs,
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          expiresAt: expiryDate.toISOString()
        });
      }

      // Notify moderators and admins
      const [moderatorUsers, adminUsers] = await Promise.all([
        getUsersByRole('moderator'),
        getUsersByRole('admin')
      ]);

      const moderatorUIDs = moderatorUsers.map((u: any) => u.uid).filter((uid: any) => uid);
      const adminUIDs = adminUsers.map((u: any) => u.uid).filter((uid: any) => uid);
      const managementUIDs = [...moderatorUIDs, ...adminUIDs];

      if (managementUIDs.length > 0) {
        // Calculate expiry (1 day from now)
        const mgmtExpiryDate = new Date();
        mgmtExpiryDate.setDate(mgmtExpiryDate.getDate() + 1);
        mgmtExpiryDate.setHours(23, 59, 59, 999);

        await pgInsertNotification({
          title: 'Driver Swap Auto-Completed',
          content: `Bus ${busNumber} swap period ended. ${driverName} resumed duties.`,
          type: 'info',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: managementUIDs
          },
          recipientIds: managementUIDs,
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          expiresAt: mgmtExpiryDate.toISOString()
        });
      }
    } catch (error) {
      console.error('❌ Error sending revert notifications:', error);
    }
  }

  /**
   * Cleanup orphaned data (safety check)
   * Called rarely, only when critical operations happen
   */
  static async cleanupOrphanedData(): Promise<void> {
    try {
      // Find buses with activeDriverId but no active swap
      const busesSnapshot = await adminDb
        .collection('buses')
        .where('activeDriverId', '!=', null)
        .get();

      for (const busDoc of busesSnapshot.docs) {
        const busData = busDoc.data();

        // Skip if activeDriverId same as assignedDriverId (not a swap)
        if (busData.activeDriverId === busData.assignedDriverId) continue;

        // Check if there's an active swap for this bus
        const swapsSnapshot = await adminDb
          .collection('driver_swap_requests')
          .where('busId', '==', busDoc.id)
          .where('status', '==', 'accepted')
          .limit(1)
          .get();

        // If no active swap found, revert to assigned driver
        if (swapsSnapshot.empty) {
          await busDoc.ref.update({
            activeDriverId: busData.assignedDriverId,
            updatedAt: FieldValue.serverTimestamp()
          });
          console.log(`⚠️ Reverted orphaned swap for bus ${busDoc.id}`);
        }
      }
    } catch (error) {
      console.error('❌ Error cleaning orphaned data:', error);
    }
  }
}
