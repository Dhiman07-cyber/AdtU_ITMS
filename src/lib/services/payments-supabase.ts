/**
 * Supabase Payments Service (PRODUCTION-SAFE) 
 * ALLOWED OPERATIONS:
 * - Create new payment records
 * - Update payment status (Pending → Completed)
 * - Read/query payment records
 *   
 * IMPORTANT: Use only with service role key on server side.
 */

import { DocumentCryptoService,buildDocumentPayloadFromPayment } from '@/lib/security/document-crypto.service';
import { decryptData,encryptData } from '@/lib/security/encryption.service';
import { getSupabaseServer } from '@/lib/supabase-server';
import { SupabaseClient } from '@supabase/supabase-js';

// ============================================
// TYPES
// ============================================

export interface PaymentRecord {
    id: string;
    payment_id: string;
    student_uid?: string;  // Firebase UID - NOT encrypted (needed for RLS filtering)

    // These fields store ENCRYPTED data (AES-256-GCM base64url) for new records
    // Legacy plain-text data is automatically handled by decryptData() - it returns as-is if not encrypted
    student_id?: string;              // Enrollment ID (encrypted for new, plain for legacy)
    student_name?: string;            // Student name (encrypted for new, plain for legacy)
    offline_transaction_id?: string;  // TX ID (encrypted for new, plain for legacy)
    stop_name?: string;                 // Stop ID (encrypted for new, plain for legacy)

    amount?: number;
    currency?: string;
    method?: 'Online' | 'Offline';
    status?: 'Pending' | 'Completed' | 'Rejected' | 'Duplicate_Pending_Refund' | 'Captured_Pending_Review' | 'Refunded' | 'Refund_Denied';
    session_start_year?: number;
    session_end_year?: number;
    duration_years?: number;
    valid_until?: string;
    transaction_date?: string;
    razorpay_payment_id?: string;     // NOT encrypted - needed for Razorpay reconciliation
    razorpay_order_id?: string;       // NOT encrypted - needed for API lookups
    approved_by?: {
        type?: string;
        userId?: string;
        empId?: string;
        name?: string;
        role?: string;
    };
    approved_at?: string;
    purpose?: string;
    metadata?: Record<string, unknown>;
    created_at?: string;
    document_signature?: string;
}

export interface CreatePaymentInput {
    paymentId: string;
    studentId?: string;
    studentUid?: string;
    studentName?: string;
    stop_name?: string;
    amount?: number;
    method: 'Online' | 'Offline';
    status?: 'Pending' | 'Completed' | 'Rejected';
    sessionStartYear?: number;
    sessionEndYear?: number;
    durationYears?: number;
    validUntil?: Date;
    transactionDate?: Date;
    offlineTransactionId?: string;
    razorpayPaymentId?: string;
    razorpayOrderId?: string;
    purpose?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
    approvedBy?: {
        type?: string;
        userId?: string;
        empId?: string;
        name?: string;
        role?: string;
    };
    approvedAt?: Date;
}

export interface ReconcileCapturedPaymentInput {
    paymentId: string;
    sessionStartYear: number;
    sessionEndYear: number;
    actor: {
        userId: string;
        name: string;
        role: string;
        empId?: string;
    };
    reconciliationEvidence: string;
    validUntil?: Date;
}

export interface ReconcileCapturedPaymentResult {
    success: boolean;
    error?: string;
    code?: 'NOT_FOUND' | 'INVALID_STATUS' | 'INVALID_SESSION' | 'DUPLICATE_SESSION' | 'UPDATE_FAILED';
    payment?: PaymentRecord;
}

export interface ConfirmRefundInput {
    paymentId: string;
    refundReference: string;
    refundedAmount: number;
    authorizedBy: {
        userId: string;
        name: string;
        role: string;
        empId?: string;
        type?: string;
    };
    reason: string;
}

export interface DenyRefundInput {
    paymentId: string;
    deniedBy: {
        userId: string;
        name: string;
        role: string;
        empId?: string;
        type?: string;
    };
    denialReason: string;
}

const PAYMENT_COLUMNS = 'id, payment_id, student_uid, student_id, student_name, offline_transaction_id, stop_name, amount, currency, method, status, session_start_year, session_end_year, duration_years, valid_until, transaction_date, razorpay_payment_id, razorpay_order_id, approved_by, approved_at, purpose, metadata, created_at, document_signature';

// ============================================
// SERVICE CLASS (IMMUTABLE PAYMENT LEDGER)
// ============================================

class PaymentsSupabaseService {
    private get supabase(): SupabaseClient {
        return getSupabaseServer();
    }

    isReady(): boolean {
        return true;
    }



    // ============================================
    // ENCRYPTION HELPERS
    // ============================================

    /**
     * Decrypt sensitive fields in a payment record
     */
    private decryptRecord(record: PaymentRecord): PaymentRecord {
        if (!record) return record;

        const student_name = record.student_name ? decryptData(record.student_name) : undefined;
        const student_id = record.student_id ? decryptData(record.student_id) : undefined;
        const offline_transaction_id = record.offline_transaction_id ? decryptData(record.offline_transaction_id) : undefined;
        const stop_name = record.stop_name ? decryptData(record.stop_name) : undefined;

        return {
            ...record,
            student_name: student_name !== null ? student_name : undefined,
            student_id: student_id !== null ? student_id : undefined,
            offline_transaction_id: offline_transaction_id !== null ? offline_transaction_id : undefined,
            stop_name: stop_name !== null ? stop_name : undefined,
            // razorpay_payment_id & razorpay_order_id are stored as plaintext for lookup
        };
    }

    private normalizeApprovedBy(input: CreatePaymentInput): CreatePaymentInput['approvedBy'] {
        if (input.approvedBy) return input.approvedBy;
        if (input.status === 'Completed' && input.method === 'Online') {
            return { type: 'SYSTEM' };
        }
        return undefined;
    }

    private buildCompletedPaymentSignature(input: CreatePaymentInput, normalized: {
        paymentId: string;
        validUntil?: string;
        transactionDate: string;
    }): string | null {
        if (input.status !== 'Completed') return null;
        const approvedBy = this.normalizeApprovedBy(input);

        const documentPayload = buildDocumentPayloadFromPayment({
            payment_id: normalized.paymentId,
            student_uid: input.studentUid || '',
            student_name: input.studentName || 'Unknown',
            student_id: input.studentId || '',
            amount: input.amount || 0,
            method: input.method,
            session_start_year: input.sessionStartYear,
            session_end_year: input.sessionEndYear,
            valid_until: normalized.validUntil,
            transaction_date: normalized.transactionDate,
            razorpay_order_id: input.razorpayOrderId,
            razorpay_payment_id: input.razorpayPaymentId,
            offline_transaction_id: input.offlineTransactionId,
            approved_by: approvedBy,
        });

        return DocumentCryptoService.signDocumentPayload(documentPayload);
    }

    // ============================================
    // CREATE OPERATIONS
    // ============================================

    /**
     * Create or update a payment record in Supabase
     */
    async upsertPayment(input: CreatePaymentInput): Promise<string | null> {
        if (!this.isReady()) {
            console.error('[PaymentsSupabaseService] Not initialized');
            return null;
        }

        try {
            // Prepare record - encrypt PII fields before storage
            // Data is stored encrypted in existing columns
            // decryptData() will handle both encrypted and legacy plain-text when reading
            // Pre-lookup profile data if studentName or studentId is missing to guarantee no NULLs
            if ((!input.studentName || !input.studentId) && input.studentUid) {
                try {
                    const profileQuery = this.supabase?.from?.('student_profiles');
                    const { data: profile } = profileQuery?.select
                        ? await profileQuery
                            .select('full_name, enrollment_id')
                            .eq('uid', input.studentUid)
                            .maybeSingle()
                        : { data: null };
                    if (profile) {
                        input.studentName = input.studentName || profile.full_name;
                        input.studentId = input.studentId || profile.enrollment_id;
                    }
                    if (!input.studentName) {
                        const userQuery = this.supabase?.from?.('users');
                        const { data: userRec } = userQuery?.select
                            ? await userQuery
                                .select('name')
                                .eq('uid', input.studentUid)
                                .maybeSingle()
                            : { data: null };
                        if (userRec && userRec.name) input.studentName = userRec.name;
                    }
                } catch (e) {
                    console.error('[PaymentsSupabaseService] Profile pre-lookup error:', e);
                }
            }

            const validUntilIso = input.validUntil?.toISOString();
            const transactionDateIso = input.transactionDate?.toISOString() || new Date().toISOString();
            const documentSignature = this.buildCompletedPaymentSignature(input, {
                paymentId: input.paymentId,
                validUntil: validUntilIso,
                transactionDate: transactionDateIso,
            });
            const approvedBy = this.normalizeApprovedBy(input);
            const approvedAtIso = input.approvedAt
                ? input.approvedAt.toISOString()
                : (input.status === 'Completed' ? new Date().toISOString() : null);

            const record: Record<string, unknown> = {
                payment_id: input.paymentId,
                student_uid: input.studentUid,  // NOT encrypted - needed for RLS filtering
                amount: input.amount,
                currency: 'INR',
                method: input.method,
                status: input.status || 'Pending',
                session_start_year: input.sessionStartYear,
                session_end_year: input.sessionEndYear,
                duration_years: input.durationYears,
                valid_until: validUntilIso,
                transaction_date: transactionDateIso,

                // ENCRYPTED PII FIELDS - stored in existing columns
                student_name: input.studentName ? encryptData(input.studentName) : null,
                student_id: input.studentId ? encryptData(input.studentId) : null,
                offline_transaction_id: input.offlineTransactionId ? encryptData(input.offlineTransactionId) : null,

                // NOT encrypted - needed for Razorpay reconciliation/lookup
                razorpay_payment_id: input.razorpayPaymentId,
                razorpay_order_id: input.razorpayOrderId,

                approved_by: approvedBy,
                approved_at: approvedAtIso,
            };

            if (input.purpose) {
                record.purpose = input.purpose;
            }
            if (input.metadata) {
                record.metadata = input.metadata;
            }

            if (documentSignature) {
                record.document_signature = documentSignature;
            }

            // IMMUTABILITY & CONCURRENCY GUARD: Check if row already exists in ledger
            if (input.paymentId) {
                const { data: existing } = await this.supabase
                    .from('payments')
                    .select('payment_id, status, metadata')
                    .eq('payment_id', input.paymentId)
                    .maybeSingle();

                if (existing) {
                    const AUDIT_TERMINAL_STATUSES = [
                        'Completed',
                        'Duplicate_Pending_Refund',
                        'Captured_Pending_Review',
                        'Refunded',
                        'Refund_Denied',
                        'Rejected',
                    ];
                    if (AUDIT_TERMINAL_STATUSES.includes(existing.status) && !AUDIT_TERMINAL_STATUSES.includes(input.status)) {
                        // INVARIANT: Never downgrade or overwrite a finalized/audit-locked payment record!
                        return existing.payment_id;
                    }
                    if (existing.metadata && input.metadata) {
                        record.metadata = { ...(existing.metadata as Record<string, unknown>), ...input.metadata };
                    }
                }
            }

            const { data, error } = await this.supabase
                .from('payments')
                .upsert([record], { onConflict: 'payment_id' })
                .select('payment_id')
                .single();

            if (error) {
                console.error('[PaymentsSupabaseService] Upsert error:', error);
                return null;
            }

            return data?.payment_id || input.paymentId;
        } catch (err) {
            console.error('[PaymentsSupabaseService] Upsert exception:', err);
            return null;
        }
    }

    /**
     * Create a new payment record without overwriting an existing ledger entry.
     * Retries and duplicate submissions return the existing payment_id instead
     * of downgrading or replacing a processed financial record.
     */
    async createPayment(input: CreatePaymentInput): Promise<string | null> {
        if (!this.isReady()) {
            console.error('[PaymentsSupabaseService] Not initialized');
            return null;
        }

        try {
            // Validate academic session boundaries for Completed payments upfront
            if (input.status === 'Completed') {
                if (
                    !input.sessionStartYear ||
                    !input.sessionEndYear ||
                    input.sessionStartYear >= input.sessionEndYear ||
                    input.sessionStartYear < 2000
                ) {
                    throw new Error(
                        `INVALID_SESSION_YEARS: Completed payments require valid academic session years (received start=${input.sessionStartYear}, end=${input.sessionEndYear})`
                    );
                }
            }

            // 1. Pre-insert check: Query existing completed payment for the student and session
            if (input.studentUid && input.sessionStartYear && input.sessionEndYear) {
                const { data: existingRecords, error: queryErr } = await this.supabase
                    .from('payments')
                    .select('payment_id, razorpay_payment_id, status')
                    .eq('student_uid', input.studentUid)
                    .eq('session_start_year', input.sessionStartYear)
                    .eq('session_end_year', input.sessionEndYear)
                    .eq('status', 'Completed');

                if (!queryErr && existingRecords && existingRecords.length > 0) {
                    const existing = existingRecords[0];
                    const isSamePayment = existing.payment_id === input.paymentId || 
                                          (existing.razorpay_payment_id && existing.razorpay_payment_id === input.razorpayPaymentId) ||
                                          (input.razorpayPaymentId && existing.payment_id === input.razorpayPaymentId);
                    
                    if (isSamePayment) {
                        throw new Error('ALREADY_PROCESSED');
                    } else {
                        throw new Error('DUPLICATE_SESSION_PAYMENT');
                    }
                }
            }

            // Pre-lookup profile data if studentName or studentId is missing to guarantee no NULLs
            if ((!input.studentName || !input.studentId) && input.studentUid) {
                try {
                    const profileQuery = this.supabase?.from?.('student_profiles');
                    const { data: profile } = profileQuery?.select
                        ? await profileQuery
                            .select('full_name, enrollment_id')
                            .eq('uid', input.studentUid)
                            .maybeSingle()
                        : { data: null };
                    if (profile) {
                        input.studentName = input.studentName || profile.full_name;
                        input.studentId = input.studentId || profile.enrollment_id;
                    }
                    if (!input.studentName) {
                        const userQuery = this.supabase?.from?.('users');
                        const { data: userRec } = userQuery?.select
                            ? await userQuery
                                .select('name')
                                .eq('uid', input.studentUid)
                                .maybeSingle()
                            : { data: null };
                        if (userRec && userRec.name) input.studentName = userRec.name;
                    }
                } catch (e) {
                    console.error('[PaymentsSupabaseService] Profile pre-lookup error in createPayment:', e);
                }
            }

            const validUntilIso = input.validUntil?.toISOString();
            const transactionDateIso = input.transactionDate?.toISOString() || new Date().toISOString();
            const documentSignature = this.buildCompletedPaymentSignature(input, {
                paymentId: input.paymentId,
                validUntil: validUntilIso,
                transactionDate: transactionDateIso,
            });
            const approvedBy = this.normalizeApprovedBy(input);
            const approvedAtIso = input.approvedAt
                ? input.approvedAt.toISOString()
                : (input.status === 'Completed' ? new Date().toISOString() : null);

            const effectiveSessionStartYear = input.sessionStartYear;
            const effectiveSessionEndYear = input.sessionEndYear;

            if (input.status === 'Completed') {
                if (
                    !effectiveSessionStartYear ||
                    !effectiveSessionEndYear ||
                    effectiveSessionStartYear >= effectiveSessionEndYear ||
                    effectiveSessionStartYear < 2000
                ) {
                    throw new Error(
                        `INVALID_SESSION_YEARS: Completed payments require valid academic session years (received start=${effectiveSessionStartYear}, end=${effectiveSessionEndYear})`
                    );
                }
            }

            const record: Record<string, unknown> = {
                payment_id: input.paymentId,
                student_uid: input.studentUid,
                amount: input.amount,
                currency: 'INR',
                method: input.method,
                status: input.status || 'Pending',
                session_start_year: effectiveSessionStartYear ?? null,
                session_end_year: effectiveSessionEndYear ?? null,
                duration_years: input.durationYears,
                valid_until: validUntilIso,
                transaction_date: transactionDateIso,
                student_name: input.studentName ? encryptData(input.studentName) : null,
                student_id: input.studentId ? encryptData(input.studentId) : null,
                offline_transaction_id: input.offlineTransactionId ? encryptData(input.offlineTransactionId) : null,
                razorpay_payment_id: input.razorpayPaymentId,
                razorpay_order_id: input.razorpayOrderId,
                approved_by: approvedBy,
                approved_at: approvedAtIso,
                metadata: input.metadata || null,
            };

            if (documentSignature) {
                record.document_signature = documentSignature;
            }

            // ATOMIC TRANSITION: If a pending payment record already exists for this order
            // (e.g. created at checkout initiation), transition it atomically to Completed
            // with the final captured payment_id and provider identifiers.
            if (input.razorpayOrderId) {
                try {
                    const { data: pendingRow } = await this.supabase
                        .from('payments')
                        .select('payment_id, status')
                        .eq('razorpay_order_id', input.razorpayOrderId)
                        .eq('status', 'Pending')
                        .maybeSingle();

                    if (pendingRow) {
                        const { data: updated, error: updateErr } = await this.supabase
                            .from('payments')
                            .update(record)
                            .eq('payment_id', pendingRow.payment_id)
                            .eq('status', 'Pending')
                            .select('payment_id')
                            .maybeSingle();

                        if (!updateErr && updated) {
                            return updated.payment_id || input.paymentId;
                        }
                    }
                } catch (pendingCheckErr) {
                    console.warn('[PaymentsSupabaseService] Pending order transition check warning:', pendingCheckErr);
                }
            }

            const { data, error } = await this.supabase
                .from('payments')
                .insert([record])
                .select('payment_id')
                .single();

            if (error) {
                if (error.code === '23505') {
                    const errorDetail = String((error as any).details || (error as any).message || '');

                    // Fast-path: Check explicit constraint names in PostgreSQL error message
                    if (
                        errorDetail.includes('idx_payments_unique_razorpay_payment_id') ||
                        errorDetail.includes('payments_razorpay_payment_id_key')
                    ) {
                        throw new Error('ALREADY_PROCESSED');
                    }

                    if (
                        errorDetail.includes('payments_pkey') ||
                        errorDetail.includes('payments_payment_id_key')
                    ) {
                        throw new Error('ALREADY_PROCESSED');
                    }

                    if (errorDetail.includes('idx_payments_one_completed_per_session')) {
                        // Named session lock collision: check if same transaction or duplicate capture
                        const { data: existingRecords, error: queryErr } = await this.supabase
                            .from('payments')
                            .select('payment_id, razorpay_payment_id, status')
                            .eq('status', 'Completed')
                            .eq('student_uid', input.studentUid!)
                            .eq('session_start_year', effectiveSessionStartYear!)
                            .eq('session_end_year', effectiveSessionEndYear!);

                        if (queryErr) {
                            console.error('[PaymentsSupabaseService] Query error looking up completed session:', queryErr);
                            throw new Error(`PAYMENT_LOOKUP_FAILED: ${queryErr.message}`);
                        }

                        if (existingRecords && existingRecords.length > 0) {
                            const existing = existingRecords[0];
                            const isSamePayment =
                                existing.payment_id === input.paymentId ||
                                (existing.razorpay_payment_id && existing.razorpay_payment_id === input.razorpayPaymentId);

                            if (isSamePayment) {
                                throw new Error('ALREADY_PROCESSED');
                            } else {
                                throw new Error('DUPLICATE_SESSION_PAYMENT');
                            }
                        }

                        throw new Error('DUPLICATE_SESSION_PAYMENT');
                    }

                    // Fallback path when constraint name is omitted from driver error details:
                    // 1. Primary Idempotency Check: Was the provider transaction already recorded?
                    if (input.razorpayPaymentId) {
                        const { data: rzpRecords, error: rzpErr } = await this.supabase
                            .from('payments')
                            .select('payment_id, razorpay_payment_id, status')
                            .eq('razorpay_payment_id', input.razorpayPaymentId);
                        if (rzpErr) {
                            throw new Error(`PAYMENT_LOOKUP_FAILED: ${rzpErr.message}`);
                        }
                        if (rzpRecords && rzpRecords.length > 0) {
                            throw new Error('ALREADY_PROCESSED');
                        }
                    }

                    // 2. Was the internal payment_id already recorded?
                    if (input.paymentId) {
                        const { data: idRecords, error: idErr } = await this.supabase
                            .from('payments')
                            .select('payment_id, status')
                            .eq('payment_id', input.paymentId);
                        if (idErr) {
                            throw new Error(`PAYMENT_LOOKUP_FAILED: ${idErr.message}`);
                        }
                        if (idRecords && idRecords.length > 0) {
                            throw new Error('ALREADY_PROCESSED');
                        }
                    }

                    // 3. Check for existing completed session record
                    if (input.studentUid && effectiveSessionStartYear && effectiveSessionEndYear) {
                        const { data: existingRecords, error: queryErr } = await this.supabase
                            .from('payments')
                            .select('payment_id, razorpay_payment_id, status')
                            .eq('status', 'Completed')
                            .eq('student_uid', input.studentUid)
                            .eq('session_start_year', effectiveSessionStartYear)
                            .eq('session_end_year', effectiveSessionEndYear);

                        if (queryErr) {
                            console.error('[PaymentsSupabaseService] Query error looking up completed session:', queryErr);
                            throw new Error(`PAYMENT_LOOKUP_FAILED: ${queryErr.message}`);
                        }

                        if (existingRecords && existingRecords.length > 0) {
                            const existing = existingRecords[0];
                            const isSamePayment =
                                existing.payment_id === input.paymentId ||
                                (existing.razorpay_payment_id && existing.razorpay_payment_id === input.razorpayPaymentId);

                            if (isSamePayment) {
                                throw new Error('ALREADY_PROCESSED');
                            } else {
                                throw new Error('DUPLICATE_SESSION_PAYMENT');
                            }
                        }
                    }

                    // If neither provider ID, payment ID, nor session matched, this was an unrelated unique constraint violation
                    console.error('[PaymentsSupabaseService] Unrelated unique constraint violation in 23505 handler:', error);
                    throw new Error('UNIQUE_CONSTRAINT_VIOLATION');
                }
                console.error('[PaymentsSupabaseService] Insert error:', error);
                return null;
            }

            return data?.payment_id || input.paymentId;
        } catch (err: any) {
            if (
                err.message === 'ALREADY_PROCESSED' ||
                err.message === 'DUPLICATE_SESSION_PAYMENT' ||
                err.message === 'UNIQUE_CONSTRAINT_VIOLATION' ||
                err.message?.startsWith('PAYMENT_LOOKUP_FAILED') ||
                err.message?.startsWith('INVALID_SESSION_YEARS')
            ) {
                throw err;
            }
            console.error('[PaymentsSupabaseService] Insert exception:', err);
            return null;
        }
    }

    /**
     * Durably record an overpayment / duplicate payment captured by Razorpay for a session
     * that already has a Completed payment.
     * Prevents captured money from disappearing without a database record (B4-F04 / W12).
     */
    async createDuplicatePaymentRecord(input: {
        paymentId: string;
        studentUid: string;
        studentId?: string;
        studentName?: string;
        amount: number;
        method?: string;
        status?: string;
        sessionStartYear?: number;
        sessionEndYear?: number;
        razorpayPaymentId?: string;
        razorpayOrderId?: string;
        notes?: string;
        metadata?: Record<string, unknown>;
    }): Promise<string | null> {
        if (!this.isReady()) return null;

        try {
            const transactionDateIso = new Date().toISOString();
            const record: Record<string, unknown> = {
                payment_id: input.paymentId,
                student_uid: input.studentUid,
                amount: input.amount,
                currency: 'INR',
                method: input.method || 'Online',
                status: input.status || 'Duplicate_Pending_Refund',
                session_start_year: input.sessionStartYear ?? null,
                session_end_year: input.sessionEndYear ?? null,
                duration_years: 1,
                transaction_date: transactionDateIso,
                student_name: input.studentName ? encryptData(input.studentName) : null,
                student_id: input.studentId ? encryptData(input.studentId) : null,
                razorpay_payment_id: input.razorpayPaymentId || input.paymentId,
                razorpay_order_id: input.razorpayOrderId || null,
                notes: input.notes || 'DUPLICATE_SESSION_PAYMENT - pending refund review',
                metadata: input.metadata || {
                    duplicate_session_capture: true,
                    requires_refund_review: true,
                }
            };

            const { data, error } = await this.supabase
                .from('payments')
                .insert([record])
                .select('payment_id')
                .single();

            if (error) {
                if (error.code === '23505') {
                    console.log(`[PaymentsSupabaseService] Duplicate payment ${input.paymentId} already in ledger.`);
                    return input.paymentId;
                }
                console.error('[PaymentsSupabaseService] Failed to record duplicate payment:', error);
                return null;
            }

            return data?.payment_id || input.paymentId;
        } catch (err: any) {
            console.error('[PaymentsSupabaseService] Exception recording duplicate payment:', err);
            return null;
        }
    }

    /**
     * Update payment status (approve or reject payment)
     * Allows: Pending → Completed, Pending → Rejected
     */
    /**
     * Update payment status with ATOMIC transition guard.
     * Only allows: Pending → Completed, Pending → Rejected
     * The WHERE clause ensures no double-approval/rejection race conditions.
     */
    async updatePaymentStatus(
        paymentId: string,
        status: 'Completed' | 'Rejected',
        approverInfo?: {
            userId: string;
            name: string;
            empId?: string;
            role: string;
        }
    ): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const now = new Date().toISOString();
            const updateData: Record<string, unknown> = { status };

            if (status === 'Completed' && approverInfo) {
                updateData.approved_by = {
                    type: approverInfo.role === 'Admin' ? 'admin' : 'moderator',
                    userId: approverInfo.userId,
                    empId: approverInfo.empId,
                    name: approverInfo.name,
                    role: approverInfo.role,
                };
                updateData.approved_at = now;

                const { data: pendingPayment, error: pendingError } = await this.supabase
                    .from('payments')
                    .select(PAYMENT_COLUMNS)
                    .eq('payment_id', paymentId)
                    .eq('status', 'Pending')
                    .single();

                if (pendingError || !pendingPayment) {
                    console.warn(`[PaymentsSupabaseService] Cannot sign ${paymentId} before completion; pending row not found`);
                    return false;
                }

                const paymentForSignature = {
                    ...this.decryptRecord(pendingPayment as PaymentRecord),
                    approved_by: updateData.approved_by as PaymentRecord['approved_by'],
                };

                updateData.document_signature = DocumentCryptoService.signDocumentPayload(
                    buildDocumentPayloadFromPayment(paymentForSignature)
                );
            }

            // ATOMIC: Only transition from 'Pending' — prevents race conditions
            const { data, error } = await this.supabase
                .from('payments')
                .update(updateData)
                .eq('payment_id', paymentId)
                .eq('status', 'Pending')
                .select('payment_id');

            if (error) {
                console.error('[PaymentsSupabaseService] Update error:', error);
                return false;
            }

            // If no rows matched, the payment was already processed
            if (!data || data.length === 0) {
                console.warn(`[PaymentsSupabaseService] No rows updated for ${paymentId} — already processed or not found`);
                return false;
            }

            return true;
        } catch (err) {
            console.error('[PaymentsSupabaseService] Update exception:', err);
            return false;
        }
    }

    /**
     * Atomically reconcile an unresolved capture (Captured_Pending_Review → Completed).
     * Strictly verifies:
     * - Session boundaries: start < end, start >= 2000
     * - Authorized actor info
     * - Idempotency & session unique constraint: ensures student doesn't already have Completed session
     * - Preserves immutable audit trail in metadata (prior_status, reconciled_by, reconciled_at, reconciliation_evidence)
     * - Generates document signature for the finalized Completed record
     */
    async reconcileCapturedPendingReviewPayment(input: ReconcileCapturedPaymentInput): Promise<ReconcileCapturedPaymentResult> {
        if (!this.isReady()) {
            return { success: false, error: 'Database service not initialized' };
        }

        const { paymentId, sessionStartYear, sessionEndYear, actor, reconciliationEvidence } = input;

        if (!sessionStartYear || !sessionEndYear || sessionStartYear >= sessionEndYear || sessionStartYear < 2000) {
            return {
                success: false,
                code: 'INVALID_SESSION',
                error: `Invalid session years: start=${sessionStartYear}, end=${sessionEndYear}. Expected start < end and start >= 2000.`
            };
        }

        if (!actor || !actor.userId) {
            return {
                success: false,
                code: 'UPDATE_FAILED',
                error: 'Reconciliation requires an authorized actor identifier.'
            };
        }

        if (!reconciliationEvidence || !reconciliationEvidence.trim()) {
            return {
                success: false,
                code: 'UPDATE_FAILED',
                error: 'Reconciliation requires explicit audit evidence documentation.'
            };
        }

        try {
            // 1. Fetch current payment record
            const { data: currentRaw, error: fetchErr } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('payment_id', paymentId)
                .maybeSingle();

            if (fetchErr || !currentRaw) {
                return { success: false, code: 'NOT_FOUND', error: `Payment record ${paymentId} not found` };
            }

            const current = currentRaw as PaymentRecord;

            // 2. Validate current state
            if (current.status !== 'Captured_Pending_Review') {
                return {
                    success: false,
                    code: 'INVALID_STATUS',
                    error: `Payment ${paymentId} has status '${current.status}'. Reconcile is strictly permitted only from 'Captured_Pending_Review'.`
                };
            }

            // 3. Pre-check: Ensure student has no existing Completed payment for target session
            if (current.student_uid) {
                const { data: existingCompleted, error: checkErr } = await this.supabase
                    .from('payments')
                    .select('payment_id')
                    .eq('student_uid', current.student_uid)
                    .eq('session_start_year', sessionStartYear)
                    .eq('session_end_year', sessionEndYear)
                    .eq('status', 'Completed')
                    .maybeSingle();

                if (!checkErr && existingCompleted) {
                    return {
                        success: false,
                        code: 'DUPLICATE_SESSION',
                        error: `Student ${current.student_uid} already holds a Completed payment (${existingCompleted.payment_id}) for session ${sessionStartYear}–${sessionEndYear}. Duplicate entitlement blocked.`
                    };
                }
            }

            const now = new Date().toISOString();
            const durationYears = sessionEndYear - sessionStartYear;
            const validUntilIso = input.validUntil ? input.validUntil.toISOString() : (current.valid_until || now);
            const approverData = {
                type: 'admin',
                userId: actor.userId,
                name: actor.name,
                role: actor.role,
                empId: actor.empId,
            };

            const updatedMetadata = {
                ...(current.metadata || {}),
                prior_status: 'Captured_Pending_Review',
                reconciled_by: actor.userId,
                reconciled_by_name: actor.name,
                reconciled_at: now,
                reconciliation_evidence: reconciliationEvidence.trim(),
                requires_manual_review: false,
                unresolved_academic_session: false,
            };

            const decryptedCurrent = this.decryptRecord(current);
            const paymentForSignature = {
                ...decryptedCurrent,
                session_start_year: sessionStartYear,
                session_end_year: sessionEndYear,
                duration_years: durationYears,
                valid_until: validUntilIso,
                approved_by: approverData,
                status: 'Completed' as const,
            };

            const documentSignature = DocumentCryptoService.signDocumentPayload(
                buildDocumentPayloadFromPayment(paymentForSignature)
            );

            // 4. Atomic conditional update (CAS)
            const { data: updatedRaw, error: updateErr } = await this.supabase
                .from('payments')
                .update({
                    status: 'Completed',
                    session_start_year: sessionStartYear,
                    session_end_year: sessionEndYear,
                    duration_years: durationYears,
                    valid_until: validUntilIso,
                    approved_by: approverData,
                    approved_at: now,
                    metadata: updatedMetadata,
                    document_signature: documentSignature,
                })
                .eq('payment_id', paymentId)
                .eq('status', 'Captured_Pending_Review')
                .select(PAYMENT_COLUMNS)
                .single();

            if (updateErr) {
                if (updateErr.code === '23505') {
                    return {
                        success: false,
                        code: 'DUPLICATE_SESSION',
                        error: 'Concurrent completion detected: student already has a Completed payment for this session.'
                    };
                }
                console.error('[PaymentsSupabaseService] Reconciliation update error:', updateErr);
                return { success: false, code: 'UPDATE_FAILED', error: updateErr.message };
            }

            const decryptedUpdated = this.decryptRecord(updatedRaw as PaymentRecord);
            return {
                success: true,
                payment: decryptedUpdated,
            };
        } catch (err: any) {
            console.error('[PaymentsSupabaseService] Reconciliation exception:', err);
            return { success: false, code: 'UPDATE_FAILED', error: err?.message || String(err) };
        }
    }

    /**
     * Atomically confirm an external refund executed by University Finance or Razorpay Gateway.
     * Allowed only from 'Duplicate_Pending_Refund' or 'Captured_Pending_Review'.
     *
     * Invariants & Verification Guarantees:
     * - Reconciles with database trigger protect_completed_payments():
     *   Populates top-level approved_by and approved_at when transitioning to Refunded.
     * - Preserves auditable actor identity: human finance officers retain userId, name, role, empId;
     *   automated gateway webhooks retain type: 'system', userId: 'system:razorpay_webhook'.
     * - Verifies original captured amount against refunded amount.
     * - Tracks each distinct Razorpay refund ID in metadata.refund_history.
     * - Repeated events for already-processed refund IDs are handled idempotently without duplicate balance reduction.
     * - Partial refunds (cumulativeRefunded < originalAmount) DO NOT transition status to Refunded;
     *   they update metadata with partial audit tracking while retaining the review state.
     * - Full refunds (cumulativeRefunded >= originalAmount) transition status to Refunded with required evidence.
     */
    async confirmManualRefundRecord(input: ConfirmRefundInput): Promise<{
        success: boolean;
        error?: string;
        isPartial?: boolean;
        cumulativeRefunded?: number;
    }> {
        if (!this.isReady()) return { success: false, error: 'Database service not initialized' };

        const { paymentId, refundReference, refundedAmount, authorizedBy, reason } = input;

        if (!refundReference || !refundReference.trim()) {
            return { success: false, error: 'External refund reference is mandatory for marking a payment as Refunded.' };
        }
        if (!authorizedBy || !authorizedBy.userId) {
            return { success: false, error: 'Authorized finance officer identifier is required.' };
        }
        if (!refundedAmount || refundedAmount <= 0) {
            return { success: false, error: 'Refunded amount must be greater than zero.' };
        }

        try {
            const trimmedRef = refundReference.trim();
            const now = new Date().toISOString();
            const refundAmountPaise = Math.round(refundedAmount * 100);

            // Construct auditable actor object
            const approverData = {
                type: authorizedBy.type || (authorizedBy.userId.startsWith('system:') ? 'system' : 'admin'),
                userId: authorizedBy.userId,
                name: authorizedBy.name || (authorizedBy.userId.startsWith('system:') ? 'System Actor' : 'Finance Administrator'),
                role: authorizedBy.role || (authorizedBy.userId.startsWith('system:') ? 'system' : 'admin'),
                ...(authorizedBy.empId ? { empId: authorizedBy.empId } : {}),
            };

            // Atomic PostgreSQL procedure with row-level locking (SELECT ... FOR UPDATE)
            // FAIL CLOSED: Never fall through to non-atomic client-side accounting in production.
            if (typeof this.supabase?.rpc !== 'function') {
                console.error('[PaymentsSupabaseService] process_payment_refund_atomic RPC unavailable: this.supabase.rpc is not a function');
                return {
                    success: false,
                    error: 'Atomic refund procedure unavailable: database RPC interface not configured.',
                };
            }

            const { data: rpcData, error: rpcError } = await this.supabase
                .rpc('process_payment_refund_atomic', {
                    p_payment_id: paymentId,
                    p_refund_id: trimmedRef,
                    p_amount_paise: refundAmountPaise,
                    p_authorized_by: approverData,
                    p_reason: reason || 'Approved refund',
                });

            // Fail closed on any PostgREST / Supabase RPC error (42883, PGRST202, permission denied, connection error, etc.)
            if (rpcError) {
                console.error('[PaymentsSupabaseService] process_payment_refund_atomic RPC error:', rpcError);
                return {
                    success: false,
                    error: rpcError.message || `Atomic refund RPC execution failed (${rpcError.code || 'UNKNOWN'})`,
                };
            }

            if (!rpcData || typeof rpcData !== 'object') {
                console.error('[PaymentsSupabaseService] process_payment_refund_atomic unexpected response:', rpcData);
                return {
                    success: false,
                    error: 'Unexpected or empty response from atomic refund procedure',
                };
            }

            const res = rpcData as any;
            if (res.success) {
                return {
                    success: true,
                    isPartial: Boolean(res.is_partial),
                    cumulativeRefunded: Number(res.cumulative_refunded) || (Number(res.cumulative_refunded_paise) / 100),
                };
            } else {
                return {
                    success: false,
                    error: res.error || 'Failed to process refund via atomic procedure',
                };
            }
        } catch (err: any) {
            console.error('[PaymentsSupabaseService] process_payment_refund_atomic exception:', err);
            return {
                success: false,
                error: err?.message || 'Exception during atomic refund procedure execution',
            };
        }
    }

    /**
     * Atomically deny a refund for a captured transaction (financial retention).
     * Allowed only from 'Duplicate_Pending_Refund' or 'Captured_Pending_Review'.
     * Preserves the captured funds in university accounts without granting transit pass.
     * Invariant: Sets top-level approved_by and approved_at to satisfy protect_completed_payments().
     */
    async denyRefundRecord(input: DenyRefundInput): Promise<{ success: boolean; error?: string }> {
        if (!this.isReady()) return { success: false, error: 'Database service not initialized' };

        const { paymentId, deniedBy, denialReason } = input;

        if (!deniedBy || !deniedBy.userId) {
            return { success: false, error: 'Reviewer identifier is required to deny a refund.' };
        }
        if (!denialReason || !denialReason.trim()) {
            return { success: false, error: 'Explicit denial reason is required.' };
        }

        try {
            const { data: currentRaw, error: fetchErr } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('payment_id', paymentId)
                .maybeSingle();

            if (fetchErr || !currentRaw) {
                return { success: false, error: `Payment record ${paymentId} not found` };
            }

            const current = currentRaw as PaymentRecord;
            if (current.status !== 'Duplicate_Pending_Refund' && current.status !== 'Captured_Pending_Review') {
                return {
                    success: false,
                    error: `Payment ${paymentId} has status '${current.status}'. Denying refund is only permitted from review states.`
                };
            }

            const now = new Date().toISOString();
            const denierData = {
                type: deniedBy.type || 'admin',
                userId: deniedBy.userId,
                name: deniedBy.name,
                role: deniedBy.role,
                ...(deniedBy.empId ? { empId: deniedBy.empId } : {}),
            };

            const updatedMetadata = {
                ...(current.metadata || {}),
                prior_status: current.status,
                denied_by: denierData,
                denied_at: now,
                denial_reason: denialReason.trim(),
                requires_refund_review: false,
                requires_manual_review: false,
            };

            const { data, error } = await this.supabase
                .from('payments')
                .update({
                    status: 'Refund_Denied',
                    approved_by: denierData,
                    approved_at: now,
                    metadata: updatedMetadata,
                })
                .eq('payment_id', paymentId)
                .in('status', ['Duplicate_Pending_Refund', 'Captured_Pending_Review'])
                .select('payment_id');

            if (error) {
                console.error('[PaymentsSupabaseService] Deny refund update error:', error);
                return { success: false, error: error.message };
            }

            if (!data || data.length === 0) {
                return { success: false, error: 'Concurrent update detected: payment is no longer in pending review state' };
            }

            return { success: true };
        } catch (err: any) {
            console.error('[PaymentsSupabaseService] Deny refund exception:', err);
            return { success: false, error: err?.message || String(err) };
        }
    }

    /**
     * @deprecated Payments are IMMUTABLE financial records and cannot be deleted.
     * This method is intentionally blocked. Use updatePaymentStatus('Rejected') instead.
     */
    async deletePayment(): Promise<boolean> {
        console.error('[PaymentsSupabaseService] ❌ BLOCKED: deletePayment() called. Payments are IMMUTABLE.');
        return false;
    }

    /**
     * Store document signature for a payment (for tamper-proof receipts)
     * This signature is generated using RSA-2048 and stored separately
     */
    async storeDocumentSignature(
        paymentId: string,
        signature: string,
        options: { onlyIfMissing?: boolean } = {}
    ): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            let query = this.supabase
                .from('payments')
                .update({ document_signature: signature })
                .eq('payment_id', paymentId)
                .eq('status', 'Completed');

            if (options.onlyIfMissing) {
                query = query.is('document_signature', null);
            }

            const { data, error } = await query.select('payment_id, document_signature');

            if (error) {
                console.error('[PaymentsSupabaseService] Signature storage error:', error);
                return false;
            }

            return Boolean(data?.[0]?.document_signature === signature);
        } catch (err: unknown) {
            console.error('[PaymentsSupabaseService] Signature storage exception:', err);
            return false;
        }
    }

    /**
     * Get document signature for a payment
     */
    async getDocumentSignature(paymentId: string): Promise<string | null> {
        if (!this.isReady()) return null;

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select('document_signature')
                .eq('payment_id', paymentId)
                .single();

            if (error) return null;
            return data?.document_signature || null;
        } catch {
            return null;
        }
    }

    // ============================================
    // READ OPERATIONS
    // ============================================

    private async enrichPaymentWithStudentProfile(record: PaymentRecord): Promise<PaymentRecord> {
        const decrypted = this.decryptRecord(record);
        if (!decrypted) return decrypted;

        const hasValidName = decrypted.student_name && !decrypted.student_name.startsWith('enc:v1:');
        const hasValidId = decrypted.student_id && !decrypted.student_id.startsWith('enc:v1:');
        const hasValidUntil = Boolean(decrypted.valid_until);

        // Fast-path: If decrypted payment record already contains complete details, skip DB fallback
        if (hasValidName && hasValidId && hasValidUntil) {
            return decrypted;
        }

        if (decrypted.student_uid) {
            try {
                const { data: profile } = await this.supabase
                    .from('student_profiles')
                    .select('full_name, enrollment_id, valid_until')
                    .eq('uid', decrypted.student_uid)
                    .maybeSingle();

                if (profile) {
                    if (!hasValidName && profile.full_name) {
                        decrypted.student_name = profile.full_name;
                    }
                    if (!hasValidId && profile.enrollment_id) {
                        decrypted.student_id = profile.enrollment_id;
                    }
                    if (profile.valid_until) {
                        const payValidYear = decrypted.valid_until ? new Date(decrypted.valid_until).getUTCFullYear() : 0;
                        const targetEndYear = decrypted.session_end_year || 0;
                        if (!decrypted.valid_until || (targetEndYear > 0 && payValidYear < targetEndYear)) {
                            decrypted.valid_until = profile.valid_until;
                        }
                    }
                }
            } catch {
                // Ignore fallback error
            }
        }

        if (decrypted.session_end_year) {
            const payValidYear = decrypted.valid_until ? new Date(decrypted.valid_until).getUTCFullYear() : 0;
            if (!decrypted.valid_until || payValidYear < decrypted.session_end_year) {
                decrypted.valid_until = new Date(Date.UTC(decrypted.session_end_year, 5, 30, 23, 59, 59, 999)).toISOString();
            }
        }

        return decrypted;
    }

    private async enrichPaymentsWithStudentProfiles(records: PaymentRecord[]): Promise<PaymentRecord[]> {
        if (!records || records.length === 0) return [];

        const decryptedRecords = records.map(r => this.decryptRecord(r));
        const uidsNeedingEnrichment = new Set<string>();

        for (const decrypted of decryptedRecords) {
            const hasValidName = decrypted.student_name && !decrypted.student_name.startsWith('enc:v1:');
            const hasValidId = decrypted.student_id && !decrypted.student_id.startsWith('enc:v1:');
            const hasValidUntil = Boolean(decrypted.valid_until);

            if ((!hasValidName || !hasValidId || !hasValidUntil) && decrypted.student_uid) {
                uidsNeedingEnrichment.add(decrypted.student_uid);
            }
        }

        // Fast path: all records already have complete decrypted data
        if (uidsNeedingEnrichment.size === 0) {
            return decryptedRecords.map(decrypted => {
                if (decrypted.session_end_year) {
                    const payValidYear = decrypted.valid_until ? new Date(decrypted.valid_until).getUTCFullYear() : 0;
                    if (!decrypted.valid_until || payValidYear < decrypted.session_end_year) {
                        decrypted.valid_until = new Date(Date.UTC(decrypted.session_end_year, 5, 30, 23, 59, 59, 999)).toISOString();
                    }
                }
                return decrypted;
            });
        }

        // Batch query all missing profile UIDs in a single SQL query
        const profileMap = new Map<string, { full_name?: string; enrollment_id?: string; valid_until?: string }>();
        try {
            const { data: profiles } = await this.supabase
                .from('student_profiles')
                .select('uid, full_name, enrollment_id, valid_until')
                .in('uid', Array.from(uidsNeedingEnrichment));

            if (profiles) {
                for (const prof of profiles) {
                    profileMap.set(prof.uid, prof);
                }
            }
        } catch {
            // Ignore batch query error
        }

        return decryptedRecords.map(decrypted => {
            const profile = decrypted.student_uid ? profileMap.get(decrypted.student_uid) : undefined;
            const hasValidName = decrypted.student_name && !decrypted.student_name.startsWith('enc:v1:');
            const hasValidId = decrypted.student_id && !decrypted.student_id.startsWith('enc:v1:');

            if (profile) {
                if (!hasValidName && profile.full_name) {
                    decrypted.student_name = profile.full_name;
                }
                if (!hasValidId && profile.enrollment_id) {
                    decrypted.student_id = profile.enrollment_id;
                }
                if (profile.valid_until) {
                    const payValidYear = decrypted.valid_until ? new Date(decrypted.valid_until).getUTCFullYear() : 0;
                    const targetEndYear = decrypted.session_end_year || 0;
                    if (!decrypted.valid_until || (targetEndYear > 0 && payValidYear < targetEndYear)) {
                        decrypted.valid_until = profile.valid_until;
                    }
                }
            }

            if (decrypted.session_end_year) {
                const payValidYear = decrypted.valid_until ? new Date(decrypted.valid_until).getUTCFullYear() : 0;
                if (!decrypted.valid_until || payValidYear < decrypted.session_end_year) {
                    decrypted.valid_until = new Date(Date.UTC(decrypted.session_end_year, 5, 30, 23, 59, 59, 999)).toISOString();
                }
            }

            return decrypted;
        });
    }

    /**
     * Get payment by ID
     */
    async getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
        if (!this.isReady()) return null;

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('payment_id', paymentId)
                .single();

            if (error) {
                return null;
            }
            return await this.enrichPaymentWithStudentProfile(data as PaymentRecord);
        } catch {
            return null;
        }
    }

    /**
     * Get payment by Razorpay Payment ID
     * 
     * NOTE: razorpay_payment_id is stored as PLAINTEXT to allow exact-match looking.
     * Encrypting it would require a separate hash column for lookups, which is not currently implemented.
     */
    async getPaymentByRazorpayId(razorpayPaymentId: string): Promise<PaymentRecord | null> {
        if (!this.isReady()) return null;

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('razorpay_payment_id', razorpayPaymentId) // This query assumes plaintext
                .single();

            if (error) return null;
            return await this.enrichPaymentWithStudentProfile(data as PaymentRecord);
        } catch {
            return null;
        }
    }

    /**
     * Get payment by Razorpay Order ID
     *
     * Used to look up a Pending pre-checkout payment record using the Razorpay
     * order_id that was stored at order-creation time. This is distinct from
     * getPaymentByRazorpayId which queries by the captured razorpay_payment_id.
     */
    async getPaymentByRazorpayOrderId(razorpayOrderId: string): Promise<PaymentRecord | null> {
        if (!this.isReady()) return null;

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('razorpay_order_id', razorpayOrderId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) return null;
            if (!data) return null;
            return await this.enrichPaymentWithStudentProfile(data as PaymentRecord);
        } catch {
            return null;
        }
    }

    /**
     * Get payments by student UID with pagination
     */
    async getPaymentsByStudentUid(
        studentUid: string,
        options?: { limit?: number; offset?: number }
    ): Promise<PaymentRecord[]> {
        if (!this.isReady()) return [];

        const limit = options?.limit || 100;
        const offset = options?.offset || 0;

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('student_uid', studentUid)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) return [];
            return await this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);
        } catch {
            return [];
        }
    }



    /**
     * Get all payments for a date range (for export/reporting)
     * READ-ONLY - no modifications
     */
    async getPaymentsForExport(
        startDate: Date,
        endDate: Date
    ): Promise<PaymentRecord[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .gte('transaction_date', startDate.toISOString())
                .lte('transaction_date', endDate.toISOString())
                .order('transaction_date', { ascending: true });

            if (error) return [];
            return this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);
        } catch {
            return [];
        }
    }

    /**
     * Get recent transactions
     */
    async getRecentTransactions(limit: number = 5): Promise<PaymentRecord[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) return [];
            return this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);
        } catch {
            return [];
        }
    }

    /**
     * Get pending offline payments (for approval queue)
     */
    async getPendingPayments(): Promise<PaymentRecord[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('status', 'Pending')
                .eq('method', 'Offline')
                .order('created_at', { ascending: true });

            if (error) return [];
            return this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);
        } catch {
            return [];
        }
    }

    /**
     * Get paginated and filtered payments (SERVER-SIDE)
     */
    async getPaginatedPayments(
        filters: { method?: string; status?: string; year?: number },
        page: number = 1,
        pageSize: number = 20
    ): Promise<{ payments: PaymentRecord[], total: number }> {
        if (!this.isReady()) return { payments: [], total: 0 };

        try {
            let query = this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS, { count: 'exact' });

            if (filters.method) {
                const m = filters.method.toLowerCase();
                if (m === 'online') {
                    query = query.in('method', ['Online', 'online']);
                } else if (m === 'offline') {
                    query = query.in('method', ['Offline', 'offline']);
                } else {
                    query = query.eq('method', filters.method);
                }
            }
            if (filters.status) {
                const s = filters.status.toLowerCase();
                if (s === 'completed') {
                    query = query.in('status', ['Completed', 'completed']);
                } else if (s === 'pending') {
                    query = query.in('status', ['Pending', 'pending']);
                } else if (s === 'rejected') {
                    query = query.in('status', ['Rejected', 'rejected']);
                } else if (s === 'duplicate_pending_refund') {
                    query = query.in('status', ['Duplicate_Pending_Refund', 'duplicate_pending_refund']);
                } else if (s === 'captured_pending_review') {
                    query = query.in('status', ['Captured_Pending_Review', 'captured_pending_review']);
                } else if (s === 'refunded') {
                    query = query.in('status', ['Refunded', 'refunded']);
                } else if (s === 'refund_denied') {
                    query = query.in('status', ['Refund_Denied', 'refund_denied']);
                } else {
                    query = query.eq('status', filters.status);
                }
            }
            if (filters.year) {
                query = query.eq('session_start_year', filters.year);
            }

            const offset = (page - 1) * pageSize;
            query = query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);

            const { data, count, error } = await query;

            if (error) {
                console.error('[PaymentsSupabaseService] Paginated fetch error:', error);
                return { payments: [], total: 0 };
            }

            const payments = await this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);

            return {
                payments,
                total: count || 0
            };
        } catch (err) {
            console.error('[PaymentsSupabaseService] Paginated fetch exception:', err);
            return { payments: [], total: 0 };
        }
    }

    /**
     * Get completed payments for a date range (for reporting)
     * READ-ONLY - no modifications
     */
    async getCompletedPaymentsForReporting(
        startDate: Date,
        endDate: Date
    ): Promise<PaymentRecord[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .gte('transaction_date', startDate.toISOString())
                .lte('transaction_date', endDate.toISOString())
                .eq('status', 'Completed')
                .order('transaction_date', { ascending: true });

            if (error) {
                console.error('[PaymentsSupabaseService] Reporting fetch error:', error);
                return [];
            }

            return this.enrichPaymentsWithStudentProfiles((data || []) as PaymentRecord[]);
        } catch (err) {
            console.error('[PaymentsSupabaseService] Reporting fetch exception:', err);
            return [];
        }
    }

    // ============================================
    // STATISTICS & AGGREGATION
    // ============================================

    /**
     * Get payment statistics for dashboard
     * Optimized to fetch only required fields
     */
    async getPaymentStats(): Promise<{
        totalPayments: number;
        completedPayments: number;
        pendingPayments: number;
        duplicateRefundCount: number;
        unresolvedReviewCount: number;
        refundDeniedCount?: number;
        totalRevenue: number;
        onlinePayments: number;
        offlinePayments: number;
    }> {
        if (!this.isReady()) {
            return { totalPayments: 0, completedPayments: 0, pendingPayments: 0, duplicateRefundCount: 0, unresolvedReviewCount: 0, refundDeniedCount: 0, totalRevenue: 0, onlinePayments: 0, offlinePayments: 0 };
        }

        try {
            // 1. Primary path: Fast database-side aggregation RPC (O(1) transfer, immune to PostgREST row limits)
            const { data: rpcData, error: rpcError } = await this.supabase
                .rpc('get_payment_analytics_aggregates')
                .maybeSingle();

            if (!rpcError && rpcData) {
                const rpcStats = rpcData as any;
                return {
                    totalPayments: Number(rpcStats.total_payments || 0),
                    completedPayments: Number(rpcStats.completed_payments || 0),
                    pendingPayments: Number(rpcStats.pending_payments || 0),
                    duplicateRefundCount: Number(rpcStats.duplicate_refund_count || 0),
                    unresolvedReviewCount: Number(rpcStats.unresolved_review_count || 0),
                    refundDeniedCount: Number(rpcStats.refund_denied_count || 0),
                    totalRevenue: Number(rpcStats.total_revenue || 0),
                    onlinePayments: Number(rpcStats.online_payments || 0),
                    offlinePayments: Number(rpcStats.offline_payments || 0),
                };
            }

            // 2. Fallback path: Explicit chunked pagination across complete dataset
            // Prevents silent truncation at PostgREST default 1,000-row limit
            const pageSize = 1000;
            let offset = 0;
            let totalPayments = 0;
            let completedCount = 0;
            let pendingCount = 0;
            let duplicateRefundCount = 0;
            let unresolvedReviewCount = 0;
            let refundDeniedCount = 0;
            let totalRevenue = 0;
            let onlineCount = 0;
            let offlineCount = 0;

            while (true) {
                const { data, error } = await this.supabase
                    .from('payments')
                    .select('status, amount, method')
                    .order('created_at', { ascending: true })
                    .range(offset, offset + pageSize - 1);

                if (error) {
                    console.error(`[PaymentsSupabaseService] Stats fetch error at offset ${offset}:`, error);
                    throw new Error(`Failed to fetch payment stats at offset ${offset}: ${error.message}`);
                }

                const page = data || [];
                totalPayments += page.length;

                for (const p of page) {
                    const isCompleted = p.status === 'Completed' || (p.status || '').toLowerCase() === 'completed';
                    const isPending = p.status === 'Pending' || (p.status || '').toLowerCase() === 'pending';
                    const isDuplicateRefund = p.status === 'Duplicate_Pending_Refund' || (p.status || '').toLowerCase() === 'duplicate_pending_refund';
                    const isUnresolvedReview = p.status === 'Captured_Pending_Review' || (p.status || '').toLowerCase() === 'captured_pending_review';
                    const isRefundDenied = p.status === 'Refund_Denied' || (p.status || '').toLowerCase() === 'refund_denied';

                    if (isCompleted) {
                        completedCount++;
                        totalRevenue += (p.amount || 0);

                        if (p.method === 'Online' || (p.method || '').toLowerCase() === 'online') {
                            onlineCount++;
                        } else if (p.method === 'Offline' || (p.method || '').toLowerCase() === 'offline') {
                            offlineCount++;
                        }
                    } else if (isPending) {
                        pendingCount++;
                    } else if (isDuplicateRefund) {
                        duplicateRefundCount++;
                    } else if (isUnresolvedReview) {
                        unresolvedReviewCount++;
                    } else if (isRefundDenied) {
                        refundDeniedCount++;
                    }
                }

                if (page.length < pageSize) {
                    break;
                }
                offset += pageSize;
            }

            return {
                totalPayments,
                completedPayments: completedCount,
                pendingPayments: pendingCount,
                duplicateRefundCount,
                unresolvedReviewCount,
                refundDeniedCount,
                totalRevenue,
                onlinePayments: onlineCount,
                offlinePayments: offlineCount,
            };
        } catch (error: unknown) {
            console.error('[PaymentsSupabaseService] Stats error:', error);
            throw error;
        }
    }

    /**
     * Get payment method preference trend (Online vs Offline)
     */
    async getPaymentMethodTrend(): Promise<{ name: string; value: number; color: string }[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select('method')
                .or('status.eq.Completed,status.eq.completed');

            if (error) return [];

            const online = data.filter(p => (p.method || '').toLowerCase() === 'online').length;
            const offline = data.filter(p => (p.method || '').toLowerCase() === 'offline').length;

            return [
                { name: 'Online Payments', value: online, color: '#6366f1' },
                { name: 'Offline Payments', value: offline, color: '#10b981' }
            ];
        } catch {
            return [];
        }
    }

    /**
     * Get payment trend for the last 7 days (Daily Revenue)
     */
    async getPaymentTrend(): Promise<{ date: string; amount: number }[]> {
        if (!this.isReady()) return [];

        try {
            const last7Days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                d.setHours(0, 0, 0, 0);
                return d;
            });

            // Start from 8 days ago UTC to ensure local time zone coverage
            const startDate = new Date(Date.now() - 8 * 86400000).toISOString();

            const { data, error } = await this.supabase
                .from('payments')
                .select('amount, transaction_date')
                .in('status', ['Completed', 'completed'])
                .gte('transaction_date', startDate)
                .order('transaction_date', { ascending: true });

            if (error) {
                console.error('[PaymentsSupabaseService] Trend error:', error);
                return [];
            }

            const payments = data || [];

            return last7Days.map(day => {
                const dateStr = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                const dayTotal = payments
                    .filter(p => {
                        if (!p.transaction_date) return false;
                        const pDate = new Date(p.transaction_date);
                        return pDate.getFullYear() === day.getFullYear() &&
                               pDate.getMonth() === day.getMonth() &&
                               pDate.getDate() === day.getDate();
                    })
                    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                return {
                    date: dateStr,
                    amount: dayTotal
                };
            });
        } catch (err) {
            console.error('[PaymentsSupabaseService] Trend exception:', err);
            return [];
        }
    }

    /**
     * Get payment trend for the last 6 months (Monthly Revenue)
     */
    async getPaymentTrendMonthly(): Promise<{ date: string; amount: number }[]> {
        if (!this.isReady()) return [];

        try {
            // Generate last 6 months - Set date to 1st first to avoid overflow when setting month
            const last6Months = Array.from({ length: 6 }, (_, i) => {
                const d = new Date();
                d.setDate(1); // Set to 1st first to avoid month-end overflow
                d.setMonth(d.getMonth() - (5 - i));
                d.setHours(0, 0, 0, 0);
                return d;
            });

            const startDate = last6Months[0].toISOString();

            const { data, error } = await this.supabase
                .from('payments')
                .select('amount, transaction_date')
                .in('status', ['Completed', 'completed'])
                .gte('transaction_date', startDate)
                .order('transaction_date', { ascending: true });

            if (error) {
                console.error('[PaymentsSupabaseService] Monthly trend error:', error);
                return [];
            }

            const payments = data || [];

            return last6Months.map(month => {
                const dateStr = month.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

                const monthTotal = payments
                    .filter(p => {
                        if (!p.transaction_date) return false;
                        const pDate = new Date(p.transaction_date);
                        return pDate.getFullYear() === month.getFullYear() &&
                               pDate.getMonth() === month.getMonth();
                    })
                    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

                return {
                    date: dateStr,
                    amount: monthTotal
                };
            });
        } catch (err) {
            console.error('[PaymentsSupabaseService] Monthly trend exception:', err);
            return [];
        }
    }

    /**
     * Get student's total payment amount
     */
    async getStudentTotalPayments(studentUid: string): Promise<number> {
        if (!this.isReady()) return 0;

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select('amount')
                .eq('student_uid', studentUid)
                .eq('status', 'Completed');

            if (error) return 0;
            return (data || []).reduce((sum, p) => sum + (p.amount || 0), 0);
        } catch {
            return 0;
        }
    }

    /**
     * Retrieve recent pending orders that have an associated Razorpay order ID
     * for automated background reconciliation sweeps.
     */
    async getRecentPendingOrders(hours = 48): Promise<{ data: any[] | null; error: any }> {
        if (!this.isReady()) {
            return { data: [], error: null };
        }

        try {
            const cutoffDate = new Date(Date.now() - hours * 3600 * 1000).toISOString();
            const { data, error } = await this.supabase
                .from('payments')
                .select('payment_id, student_uid, student_id, student_name, razorpay_order_id, razorpay_payment_id, amount, status, created_at')
                .eq('status', 'Pending')
                .not('razorpay_order_id', 'is', null)
                .gte('created_at', cutoffDate)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) {
                console.error('[PaymentsSupabaseService] getRecentPendingOrders query error:', error);
                return { data: null, error };
            }

            return { data: data || [], error: null };
        } catch (err) {
            console.error('[PaymentsSupabaseService] getRecentPendingOrders exception:', err);
            return { data: null, error: err };
        }
    }

    /**
     * Update metadata on an existing payment record (e.g. tracking entitlement lifecycle).
     * Safe on Completed payments: metadata is explicitly permitted by protect_completed_payments.
     */
    async updatePaymentMetadata(
        paymentId: string,
        metadataUpdates: Record<string, unknown>,
        options?: {
            expectedClaimTime?: string;
        }
    ): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const current = (await this.getPaymentById(paymentId)) || (await this.getPaymentByRazorpayId(paymentId));
            if (!current) {
                console.warn(`[PaymentsSupabaseService] Payment ${paymentId} not found for metadata update`);
                return false;
            }

            // CRITICAL INVARIANT: An already-active (healed) entitlement must NEVER be downgraded
            const currentStatus = current.metadata?.entitlement_status;
            const newStatus = metadataUpdates.entitlement_status;
            if (currentStatus === 'active' && newStatus && newStatus !== 'active') {
                console.warn(`[PaymentsSupabaseService] Refusing to downgrade active entitlement for ${paymentId} to ${newStatus}`);
                return false;
            }

            // Lease verification: If a specific lease claim timestamp was expected, verify worker still owns it
            if (options?.expectedClaimTime && current.metadata?.recovering_since !== options.expectedClaimTime) {
                console.warn(`[PaymentsSupabaseService] Lease ownership lost for ${paymentId} (expected ${options.expectedClaimTime}, current ${current.metadata?.recovering_since})`);
                return false;
            }

            const updatedMetadata = {
                ...(current.metadata || {}),
                ...metadataUpdates,
                last_metadata_update: new Date().toISOString(),
            };

            let query = this.supabase
                .from('payments')
                .update({ metadata: updatedMetadata })
                .eq('payment_id', current.payment_id);

            // DB-level guard: If not setting to active, never overwrite a row that became active concurrently.
            // NULL-safe: permits rows where metadata is NULL or entitlement_status is NULL or non-active.
            if (newStatus && newStatus !== 'active') {
                query = query.or('metadata.is.null,metadata->>entitlement_status.is.null,metadata->>entitlement_status.neq.active');
            }

            if (options?.expectedClaimTime) {
                query = query.eq('metadata->>recovering_since', options.expectedClaimTime);
            }

            const { data, error } = await query.select('payment_id');

            if (error) {
                console.error('[PaymentsSupabaseService] updatePaymentMetadata error:', error);
                return false;
            }

            // CRITICAL VERIFICATION: Ensure the conditional update actually changed a row.
            // If another worker acquired ownership or the state changed concurrently, PostgREST returns 0 rows.
            if (!data || (Array.isArray(data) && data.length === 0)) {
                console.warn(`[PaymentsSupabaseService] updatePaymentMetadata matched 0 rows for ${paymentId} (concurrent lease loss or state changed)`);
                return false;
            }

            return true;
        } catch (err) {
            console.error('[PaymentsSupabaseService] updatePaymentMetadata exception:', err);
            return false;
        }
    }

    /**
     * Retrieve completed payments with incomplete entitlement status
     * for automated background self-healing.
     * 
     * INVARIANT: No long-running failure may become permanently stranded by aging out.
     * Queries both recent window (<= hours) and durable backlog of unhealed failures (> hours).
     * Partitions the limit quota fairly between recent window and backlog so neither starves.
     */
    async getCompletedPaymentsWithPendingEntitlements(hours = 72, limit = 100): Promise<{ data: any[] | null; error: any }> {
        if (!this.isReady()) {
            return { data: [], error: null };
        }

        try {
            const cutoffDate = new Date(Date.now() - hours * 3600 * 1000).toISOString();
            // Lease timeout: stale 'recovering' leases older than 5 minutes are eligible for retry
            const leaseThresholdISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

            // Fair quota partition: partition limit equally between recent window and older backlog
            const batchQuota = Math.max(1, Math.floor(limit / 2));

            // 1. Recent window query: captures recent completed payments with pending/failed entitlements.
            // Uses .or() to discover rows with null metadata, null entitlement_status, or non-active status,
            // filtering out already-active entitlements at the DB level before limiting results.
            // Includes pending_registration_submission so submitted registration payments are discovered.
            const { data: recentData, error: recentErr } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('status', 'Completed')
                .gte('created_at', cutoffDate)
                .or('metadata.is.null,metadata->>entitlement_status.is.null,metadata->>entitlement_status.neq.active')
                .order('created_at', { ascending: false })
                .limit(batchQuota);

            if (recentErr) {
                console.error('[PaymentsSupabaseService] getCompletedPaymentsWithPendingEntitlements recent query error:', recentErr);
                return { data: null, error: recentErr };
            }

            // 2. Durable backlog query: captures unhealed failures older than cutoffDate so they are NEVER permanently stranded.
            // FAIR PROGRESSION & RETRY BACKOFF: To prevent a persistently failing oldest batch from starving later unresolved records,
            // we filter out records whose next_retry_after is still in the future.
            const nowIso = new Date().toISOString();
            const { data: backlogData, error: backlogErr } = await this.supabase
                .from('payments')
                .select(PAYMENT_COLUMNS)
                .eq('status', 'Completed')
                .lt('created_at', cutoffDate)
                .or('metadata.is.null,metadata->>entitlement_status.is.null,metadata->>entitlement_status.neq.active')
                .or(`metadata->>next_retry_after.is.null,metadata->>next_retry_after.lte.${nowIso}`)
                .order('created_at', { ascending: true })
                .limit(batchQuota);

            if (backlogErr) {
                console.error('[PaymentsSupabaseService] getCompletedPaymentsWithPendingEntitlements backlog query error:', backlogErr);
                return { data: null, error: backlogErr };
            }

            const combined = [...(recentData || []), ...(backlogData || [])];
            const seen = new Set<string>();
            const pendingEntitlements: any[] = [];

            for (const p of combined) {
                if (!p?.payment_id || seen.has(p.payment_id)) continue;
                seen.add(p.payment_id);

                // Backoff check: skip records whose backoff window has not elapsed
                if (p.metadata?.next_retry_after) {
                    const retryAfter = new Date(String(p.metadata.next_retry_after)).getTime();
                    if (Date.now() < retryAfter) {
                        continue;
                    }
                }

                const entStatus = p.metadata?.entitlement_status;
                // Null/undefined entitlement_status means it was never set — treat as pending
                const isPending = !entStatus ||
                    entStatus === 'failed' ||
                    entStatus === 'pending_application' ||
                    entStatus === 'pending' ||
                    entStatus === 'pending_registration_submission';

                if (isPending) {
                    pendingEntitlements.push(this.decryptRecord(p));
                    continue;
                }

                if (entStatus === 'recovering') {
                    // Only include stale leases (worker crashed without releasing)
                    const recoveringSince = p.metadata?.recovering_since
                        ? new Date(String(p.metadata.recovering_since)).getTime()
                        : 0;
                    if (Date.now() - recoveringSince >= 5 * 60 * 1000) {
                        pendingEntitlements.push(this.decryptRecord(p));
                    }
                    // else: fresh lease held by active worker — skip
                }
            }

            return { data: pendingEntitlements, error: null };
        } catch (err) {
            console.error('[PaymentsSupabaseService] getCompletedPaymentsWithPendingEntitlements exception:', err);
            return { data: null, error: err };
        }
    }

    /**
     * Cross-instance lease coordination for background entitlement recovery.
     * Prevents multiple concurrent serverless instances or workers from processing
     * the same payment entitlement simultaneously.
     *
     * ATOMICITY GUARANTEE: The lease conditions are enforced inside the UPDATE WHERE clause,
     * not in application-level if-checks before the UPDATE. This eliminates the TOCTOU race
     * where two concurrent workers both read 'not recovering', both decide to proceed, and both
     * write the lease — only to process the same payment twice.
     *
     * The UPDATE only executes (and returns a row) when PostgreSQL verifies:
     *   - entitlement_status IS NOT 'active'  (already fully healed — skip)
     *   - entitlement_status IS NOT 'recovering' OR the lease is stale (worker crashed)
     * If another worker already claimed the lease, this UPDATE matches 0 rows → data is null → returns { claimed: false }.
     */
    async claimPaymentForEntitlementRecovery(
        paymentId: string,
        leaseTimeoutMs = 5 * 60 * 1000
    ): Promise<{ claimed: boolean; leaseTime?: string; reason?: 'actively_leased' | 'already_active' | 'not_found' | 'error'; error?: any }> {
        if (!this.isReady()) return { claimed: false };

        try {
            // Fetch current record to merge existing metadata into the claim payload.
            // This read is safe: the atomicity guard is in the UPDATE WHERE clause below,
            // not in application-side conditional checks.
            const current = (await this.getPaymentById(paymentId)) || (await this.getPaymentByRazorpayId(paymentId));
            if (!current) {
                console.warn(`[PaymentsSupabaseService] Payment ${paymentId} not found for recovery claim`);
                return { claimed: false, reason: 'not_found' };
            }

            const leaseThresholdISO = new Date(Date.now() - leaseTimeoutMs).toISOString();

            // Fast-path bailout: If already active or actively leased, avoid database write lock
            if (current.metadata?.entitlement_status === 'active') {
                return { claimed: false, reason: 'already_active' };
            }
            if (current.metadata?.entitlement_status === 'recovering') {
                const recoveringSince = current.metadata?.recovering_since
                    ? new Date(String(current.metadata.recovering_since)).getTime()
                    : 0;
                if (Date.now() - recoveringSince < leaseTimeoutMs) {
                    return { claimed: false, reason: 'actively_leased' };
                }
            }

            const claimTimestamp = new Date().toISOString();
            const claimMetadata = {
                ...(current.metadata || {}),
                entitlement_status: 'recovering',
                recovering_since: claimTimestamp,
                last_metadata_update: claimTimestamp,
            };

            // ATOMIC CAS: embed all lease conditions directly in the UPDATE WHERE clause.
            // PostgreSQL evaluates this atomically; no gap exists between read and write.
            //
            // Conditions translated to PostgREST:
            //   (metadata->>'entitlement_status' != 'active')               — never overwrite healed
            //   AND (
            //     metadata->>'entitlement_status' != 'recovering'           — unclaimed, OR
            //     OR metadata->>'recovering_since' < leaseThresholdISO      — stale crashed lease
            //   )
            const { data, error } = await this.supabase
                .from('payments')
                .update({ metadata: claimMetadata })
                .eq('payment_id', current.payment_id)
                // Guard 1 & 2 combined with NULL-safety:
                // Evaluates atomically in PostgREST/PostgreSQL:
                // 1. Unclaimed: metadata is NULL, entitlement_status is NULL, or entitlement_status is not 'active' and not 'recovering'
                // 2. Stale lease: entitlement_status is 'recovering', but recovering_since is older than leaseThresholdISO
                // 3. Never claims: rows where entitlement_status is 'active', or rows actively leased by another worker
                .or(`metadata.is.null,metadata->>entitlement_status.is.null,and(metadata->>entitlement_status.neq.active,metadata->>entitlement_status.neq.recovering),and(metadata->>entitlement_status.neq.active,metadata->>recovering_since.lt.${leaseThresholdISO})`)
                .select('payment_id')
                .maybeSingle();

            if (error) {
                console.warn('[PaymentsSupabaseService] Failed to establish recovery lease:', error);
                return { claimed: false, error, reason: 'error' };
            }

            if (!data) {
                // UPDATE matched 0 rows: another worker already holds a fresh lease, or the
                // payment is already active. Both are correct reasons to skip.
                return { claimed: false, reason: 'actively_leased' };
            }

            return { claimed: true, leaseTime: claimTimestamp };
        } catch (err) {
            console.error('[PaymentsSupabaseService] claimPaymentForEntitlementRecovery exception:', err);
            return { claimed: false, error: err, reason: 'error' };
        }
    }

    /**
     * Retrieve stale pending orders created MORE than `olderThanHours` ago
     * to prevent captures older than 48 hours from being permanently abandoned.
     */
    async getStalePendingOrders(olderThanHours = 48, limit = 50): Promise<{ data: any[] | null; error: any }> {
        if (!this.isReady()) {
            return { data: [], error: null };
        }

        try {
            const cutoffDate = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();
            const { data, error } = await this.supabase
                .from('payments')
                .select('payment_id, student_uid, student_id, student_name, razorpay_order_id, razorpay_payment_id, amount, status, created_at, metadata')
                .eq('status', 'Pending')
                .not('razorpay_order_id', 'is', null)
                .lt('created_at', cutoffDate)
                .order('created_at', { ascending: true })
                .limit(limit);

            if (error) {
                console.error('[PaymentsSupabaseService] getStalePendingOrders error:', error);
                return { data: null, error };
            }

            return { data: data || [], error: null };
        } catch (err) {
            console.error('[PaymentsSupabaseService] getStalePendingOrders exception:', err);
            return { data: null, error: err };
        }
    }
}

// Export singleton instance
export const paymentsSupabaseService = new PaymentsSupabaseService();

// Export class for custom instantiation
export { PaymentsSupabaseService };
