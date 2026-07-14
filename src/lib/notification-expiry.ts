/**
 * Notification Expiry Management
 * Automatically delete expired notifications at midnight
 */

import { cleanupExpired } from '@/domains/payment/repositories/processed-payments.repository';
import { pgFindExpiredNotifications, pgBulkDeleteNotifications } from '@/domains/notification/repositories/notification.repository.pg';

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

    // 2. Delete expired notifications via PG
    try {
      const expired = await pgFindExpiredNotifications();
      result.debug.scanned = expired.length;

      if (expired.length > 0) {
        const ids = expired.map(n => n.id);
        await pgBulkDeleteNotifications(ids);
        result.deletedNotifications = ids.length;
      }

      console.log(`   Scanned ${result.debug.scanned} expired notifications. Deleted ${result.deletedNotifications}.`);
    } catch (notifErr: any) {
      console.error('❌ Exception in deleteExpiredNotifications:', notifErr);
      result.errors.push(`Notification cleanup exception: ${notifErr.message}`);
    }

    return result;
  } catch (error: any) {
    console.error('❌ Fatal error in notification expiry cleanup:', error);
    result.errors.push(`Fatal error: ${error.message}`);
    return result;
  }
}


