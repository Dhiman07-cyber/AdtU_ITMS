/**
 * Notification Expiry Management
 * Automatically delete expired notifications at midnight
 */

import { cleanupExpired } from '@/domains/payment/repositories/processed-payments.repository';
import { adminDb } from './firebase-admin';

export function calculateNotificationExpiry(startDate: Date, daysToLive: number = 0): string {
  const expiresAt = new Date(startDate);
  expiresAt.setDate(expiresAt.getDate() + daysToLive);
  expiresAt.setHours(23, 59, 59, 999);
  return expiresAt.toISOString();
}

/**
 * Clean up expired processed_payments rows in PostgreSQL.
 * Markers are kept for 7 days for idempotency/retry safety, then deleted.
 */
export async function deleteExpiredProcessedPayments(): Promise<{
  deletedPayments: number;
  errors: string[];
}> {
  const result = {
    deletedPayments: 0,
    errors: [] as string[]
  };

  try {
    const deleted = await cleanupExpired();
    result.deletedPayments = deleted;
    console.log(`   Deleted ${result.deletedPayments} expired processed payments.`);
    return result;
  } catch (error: any) {
    console.error('❌ Error in processed payments cleanup:', error);
    result.errors.push(`Processed payments cleanup error: ${error.message}`);
    return result;
  }
}

/**
 * Delete expired notifications (run at midnight)
 * Deletes notifications where expiry date is before current date.
 * Uses pagination to avoid loading the entire collection into memory.
 */
export async function deleteExpiredNotifications(): Promise<{
  deletedNotifications: number;
  deletedProcessedPayments?: number;
  errors: string[];
  debug?: any;
}> {
  const result: any = {
    deletedNotifications: 0,
    deletedProcessedPayments: 0,
    errors: [] as string[],
    debug: { method: 'paginated-filtering', scanned: 0 }
  };

  try {
    const nowMs = Date.now();
    console.log(`🧹 Starting Robust Cleanup at ${new Date().toISOString()}`);

    // 1. Clean up expired processed payments
    try {
      const payResult = await deleteExpiredProcessedPayments();
      result.deletedProcessedPayments = payResult.deletedPayments;
      if (payResult.errors.length > 0) {
        result.errors.push(...payResult.errors);
      }
    } catch (payErr: any) {
      console.error('❌ Exception in deleteExpiredProcessedPayments:', payErr);
      result.errors.push(`Processed payments cleanup exception: ${payErr.message}`);
    }

    // Paginate through notifications instead of loading all into memory.
    // Firestore limits `in` queries to 30 items, so we batch deletes
    // and use cursor-based pagination for reads.
    const PAGE_SIZE = 500;
    let lastDoc: any = null;
    let hasMore = true;

    while (hasMore) {
      let query = adminDb.collection('notifications')
        .orderBy('__name__')
        .limit(PAGE_SIZE);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      result.debug.scanned += snapshot.size;

      if (snapshot.empty || snapshot.size < PAGE_SIZE) {
        hasMore = false;
      }

      if (snapshot.docs.length > 0) {
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }

      // Identify expired docs in this page
      const idsToDelete: string[] = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        let expiryMillis = 0;

        if (data.expiryAt) {
          if (typeof data.expiryAt.toMillis === 'function') {
            expiryMillis = data.expiryAt.toMillis();
          } else if (typeof data.expiryAt === 'number') {
            expiryMillis = data.expiryAt;
          } else if (typeof data.expiryAt === 'string') {
            expiryMillis = new Date(data.expiryAt).getTime();
          } else if (data.expiryAt instanceof Date) {
            expiryMillis = data.expiryAt.getTime();
          }
        } else if (data.expiresAt) {
          expiryMillis = new Date(data.expiresAt).getTime();
        }

        if (expiryMillis > 0 && expiryMillis <= nowMs) {
          idsToDelete.push(doc.id);
        }
      }

      if (idsToDelete.length > 0) {
        console.log(`   Found ${idsToDelete.length} expired notifications in this page.`);

        // Batch delete in chunks of 400
        const chunkSize = 400;
        for (let i = 0; i < idsToDelete.length; i += chunkSize) {
          const batch = adminDb.batch();
          const chunk = idsToDelete.slice(i, i + chunkSize);

          chunk.forEach(id => {
            const ref = adminDb.collection('notifications').doc(id);
            batch.delete(ref);
          });

          await batch.commit();
        }

        result.deletedNotifications += idsToDelete.length;
      }
    }

    console.log(`   Scanned ${result.debug.scanned} total notifications. Deleted ${result.deletedNotifications}.`);
    return result;
  } catch (error: any) {
    console.error('❌ Fatal error in notification expiry cleanup:', error);
    result.errors.push(`Fatal error: ${error.message}`);
    return result;
  }
}


