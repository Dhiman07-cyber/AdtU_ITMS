import { adminDb } from '@/lib/firebase-admin';
import { paymentsSupabaseService, type CreatePaymentInput } from '@/lib/services/payments-supabase';

export interface PaymentTransaction {
  // Core Fields (Required)
  studentId: string; // Enrollment ID
  studentName: string;
  amount: number;
  paymentMethod: 'online' | 'offline' | 'manual';
  paymentId: string;
  timestamp: string; // ISO string
  userId?: string; // Firebase UID, used by newer callers
  studentUid?: string; // Firebase UID, used by Supabase-backed callers
  durationYears: number;
  validUntil: string; // ISO string - for compatibility
  status?: 'completed' | 'pending' | 'failed';
  offlineTransactionId?: string; // UPI ID or Reference ID
  sessionStartYear?: number;
  sessionEndYear?: number;

  // Extended Audit Fields (Optional - for offline/manual renewals)
  studentEmail?: string;
  studentPhone?: string;

  // Detailed Validity Tracking
  previousValidUntil?: string | null;
  newValidUntil?: string;
  previousSessionEndYear?: number;
  newSessionEndYear?: number;
  previousDurationYears?: number;
  newDurationYears?: number;

  // Detailed Approver Information (for fraud prevention)
  approvedBy?: string | {
    name: string;
    empId: string;
    userId: string;
    email: string;
    role: 'admin' | 'moderator';
  };
  approvedByDisplay?: string; // "Name (EmpId)" format

  // Request Tracking
  renewalRequestId?: string;
  requestSubmittedAt?: string | null;

  // Multiple Timestamps for Verification
  timestampMs?: number;
  approvedAtISO?: string;



  // Allow additional fields for future extensions
  [key: string]: unknown;
}

export class PaymentTransactionService {
  private static getApprovedBy(transaction: PaymentTransaction): CreatePaymentInput['approvedBy'] {
    if (!transaction.approvedBy || typeof transaction.approvedBy !== 'object') {
      return undefined;
    }

    return {
      type: 'Manual',
      userId: transaction.approvedBy.userId,
      empId: transaction.approvedBy.empId,
      name: transaction.approvedBy.name,
      role: transaction.approvedBy.role,
    };
  }

  private static getApproverInfo(transaction: PaymentTransaction): {
    userId: string;
    name: string;
    empId?: string;
    role: string;
  } | undefined {
    if (!transaction.approvedBy || typeof transaction.approvedBy !== 'object') {
      return undefined;
    }

    return {
      userId: transaction.approvedBy.userId,
      name: transaction.approvedBy.name,
      empId: transaction.approvedBy.empId,
      role: transaction.approvedBy.role === 'admin' ? 'Admin' : 'Moderator',
    };
  }

  private static async upsertCompletedTransaction(
    transaction: PaymentTransaction,
    method: 'Online' | 'Offline'
  ): Promise<void> {
    const approvedBy = this.getApprovedBy(transaction);
    const paymentId = await paymentsSupabaseService.upsertPayment({
      paymentId: transaction.paymentId,
      studentId: transaction.studentId,
      studentUid: transaction.userId || transaction.studentUid,
      studentName: transaction.studentName,
      amount: transaction.amount,
      method,
      status: 'Completed',
      sessionStartYear: transaction.sessionStartYear,
      sessionEndYear: transaction.sessionEndYear || transaction.newSessionEndYear,
      durationYears: transaction.durationYears,
      validUntil: transaction.validUntil ? new Date(transaction.validUntil) : undefined,
      transactionDate: transaction.timestamp ? new Date(transaction.timestamp) : new Date(),
      offlineTransactionId: transaction.offlineTransactionId,
      metadata: {
        renewalRequestId: transaction.renewalRequestId,
        previousValidUntil: transaction.previousValidUntil,
        previousSessionEndYear: transaction.previousSessionEndYear,
        approvedByDisplay: transaction.approvedByDisplay,
      },
      approvedBy,
      approvedAt: transaction.approvedAtISO ? new Date(transaction.approvedAtISO) : new Date(),
    });

    if (!paymentId) {
      throw new Error('Failed to persist completed transaction details to Supabase');
    }
  }

  /**
   * Save a transaction record - NOW WRITES TO SUPABASE (Firestore is blocked)
   * Prevents duplicates by checking for existing records first.
   */
  static async saveTransaction(transaction: PaymentTransaction): Promise<void> {
    try {
      // 1. Check if record already exists to avoid redundant creation
      const existing = await paymentsSupabaseService.getPaymentById(transaction.paymentId);
      
      // Map legacy status/method to Supabase format
      let status: 'Pending' | 'Completed' = 'Completed';
      if (transaction.status === 'pending') status = 'Pending';
      if (transaction.status === 'failed') status = 'Pending';
      
      const method: 'Online' | 'Offline' = (transaction.paymentMethod === 'online') ? 'Online' : 'Offline';

      if (existing) {
        // Pending records are already present; do not churn the ledger on retries.
        if (status === 'Pending') {
          console.log(`[PaymentTransaction] Record ${transaction.paymentId} already exists as pending, skipping.`);
          return;
        }

        if (existing.status === 'Completed' && status === 'Completed') {
          console.log(`[PaymentTransaction] Record ${transaction.paymentId} already completed, skipping.`);
          return;
        }

        if (existing.status === 'Rejected') {
          throw new Error('Cannot complete a rejected payment record');
        }

        // It exists but needs status/validity update (e.g. Pending -> Completed).
        console.log(`[PaymentTransaction] Updating existing record: ${transaction.paymentId}`);
        const updated = await paymentsSupabaseService.updatePaymentStatus(
          transaction.paymentId,
          'Completed',
          this.getApproverInfo(transaction)
        );

        if (!updated) {
          throw new Error('Payment was already processed before transaction details could be saved');
        }

        await this.upsertCompletedTransaction(transaction, method);
        return;
      }

      // 2. Create new payment in Supabase (Uses upsert internally for safety)
      const paymentId = await paymentsSupabaseService.createPayment({
        paymentId: transaction.paymentId,
        studentId: transaction.studentId,
        studentUid: transaction.userId || transaction.studentUid,
        studentName: transaction.studentName,
        amount: transaction.amount,
        method,
        status,
        sessionStartYear: transaction.sessionStartYear,
        sessionEndYear: transaction.sessionEndYear,
        durationYears: transaction.durationYears,
        validUntil: transaction.validUntil ? new Date(transaction.validUntil) : undefined,
        transactionDate: transaction.timestamp ? new Date(transaction.timestamp) : new Date(),
        offlineTransactionId: transaction.offlineTransactionId,
        approvedBy: this.getApprovedBy(transaction),
        approvedAt: transaction.approvedAtISO ? new Date(transaction.approvedAtISO) : undefined,
      });

      if (!paymentId) {
        throw new Error('Failed to save transaction to Supabase');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[PaymentTransaction] Save error:', message);
      throw error;
    }
  }

  /**
   * Check if a payment has already been processed
   * Checks Supabase (single source of truth)
   */
  static async isPaymentProcessed(paymentId: string): Promise<boolean> {
    try {
      // Check Supabase (primary source of truth)
      const supabasePayment = await paymentsSupabaseService.getPaymentById(paymentId);

      if (supabasePayment) {
        return supabasePayment.status === 'Completed';
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Get all transactions for a specific student from Supabase
   */
  static async getStudentTransactions(studentId: string): Promise<PaymentTransaction[]> {
    try {
      const payments = await paymentsSupabaseService.getPaymentsByStudentUid(studentId);

      return payments.map(p => ({
        studentId: p.student_id || '',
        studentName: p.student_name || '',
        amount: p.amount || 0,
        paymentMethod: (p.method?.toLowerCase() === 'online' ? 'online' : 'offline') as 'online' | 'offline' | 'manual',
        paymentId: p.payment_id,
        timestamp: p.transaction_date || new Date().toISOString(),
        durationYears: p.duration_years || 1,
        validUntil: p.valid_until || '',
        status: (p.status?.toLowerCase() === 'completed' ? 'completed' : p.status?.toLowerCase() === 'pending' ? 'pending' : 'failed') as 'completed' | 'pending' | 'failed',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get all transactions (for admin/moderator view) from Supabase
   * Optimized to use paginated fetch for large sets
   */
  static async getAllTransactions(
    year?: number,
    month?: number,
    studentId?: string
  ): Promise<PaymentTransaction[]> {
    try {
      const filters: { year?: number } = {};
      if (year) filters.year = year;
      
      // We still need to fetch a large chunk if they really want "all"
      // But we use the paginated endpoint to at least push some filtering to the DB
      const result = await paymentsSupabaseService.getPaginatedPayments(filters, 1, 1000);
      const payments = result.payments;

      let transactions = payments.map(p => ({
        studentId: p.student_id || '',
        studentName: p.student_name || '',
        amount: p.amount || 0,
        paymentMethod: (p.method?.toLowerCase() === 'online' ? 'online' : 'offline') as 'online' | 'offline' | 'manual',
        paymentId: p.payment_id,
        timestamp: p.transaction_date || new Date().toISOString(),
        durationYears: p.duration_years || 1,
        validUntil: p.valid_until || '',
        status: (p.status?.toLowerCase() === 'completed' ? 'completed' : p.status?.toLowerCase() === 'pending' ? 'pending' : 'failed') as 'completed' | 'pending' | 'failed',
      }));

      // Filter by studentId if provided
      if (studentId) {
        transactions = transactions.filter(t => t.studentId === studentId);
      }

      // In-memory filtering for month if provided
      if (month) {
        transactions = transactions.filter(t => new Date(t.timestamp).getMonth() + 1 === month);
      }

      return transactions;
    } catch {
      return [];
    }
  }

  /**
   * Get paginated transactions for admin view
   */
  static async getPaginatedTransactions(
    page: number = 1,
    limit: number = 50,
    filters?: {
      year?: number;
      month?: number;
      studentId?: string;
      paymentMethod?: 'online' | 'offline' | 'manual';
    }
  ): Promise<{
    transactions: PaymentTransaction[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    // Construct filters for Supabase
    const dbFilters: { year?: number; method?: 'Online' | 'Offline' } = {};
    if (filters?.year) dbFilters.year = filters.year;
    if (filters?.paymentMethod) {
      dbFilters.method = filters.paymentMethod === 'online' ? 'Online' : 'Offline';
    }
    
    // Fetch directly using getPaginatedPayments
    const result = await paymentsSupabaseService.getPaginatedPayments(dbFilters, page, limit);
    const payments = result.payments;
    const total = result.total;

    let transactions = payments.map(p => ({
      studentId: p.student_id || '',
      studentName: p.student_name || '',
      amount: p.amount || 0,
      paymentMethod: (p.method?.toLowerCase() === 'online' ? 'online' : 'offline') as 'online' | 'offline' | 'manual',
      paymentId: p.payment_id,
      timestamp: p.transaction_date || new Date().toISOString(),
      durationYears: p.duration_years || 1,
      validUntil: p.valid_until || '',
      status: (p.status?.toLowerCase() === 'completed' ? 'completed' : p.status?.toLowerCase() === 'pending' ? 'pending' : 'failed') as 'completed' | 'pending' | 'failed',
    }));

    // In-memory filtering for fields not supported by dbFilters (studentId, month)
    // NOTE: This breaks exact pagination if these filters are used, but is necessary for now
    if (filters?.studentId) {
      transactions = transactions.filter(t => t.studentId === filters.studentId);
      // Total count becomes inaccurate when filtering in-memory after pagination
    }
    if (filters?.month) {
      transactions = transactions.filter(t => new Date(t.timestamp).getMonth() + 1 === filters.month);
    }

    const totalPages = Math.ceil(total / limit);

    return {
      transactions,
      total,
      page,
      totalPages
    };
  }

  /**
   * Mark a transaction as pending for manual reconciliation.
   * Writes a detectable outbox record in Firestore `audit_failures` so the next
   * cron, admin scan, or reconciliation pass can identify and repair the state.
   */
  static async markTransactionPending(paymentId: string): Promise<void> {
    try {
      await adminDb.collection('audit_failures').add({
        kind: 'webhook_payment_sync_pending',
        paymentId,
        error: 'saveTransaction failed after Firestore commit; payment needs Supabase ledger entry',
        recovered: false,
        createdAtISO: new Date().toISOString(),
      });
      console.warn(`[PaymentTransaction] Marked ${paymentId} as pending for reconciliation (outbox record written).`);
    } catch (outboxErr) {
      console.error(`[PaymentTransaction] CRITICAL: Could not write outbox for ${paymentId}:`, outboxErr);
    }
  }
}
