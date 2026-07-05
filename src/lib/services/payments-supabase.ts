/**
 * Supabase Payments Service (PRODUCTION-SAFE) 
 * ALLOWED OPERATIONS:
 * - Create new payment records
 * - Update payment status (Pending → Completed)
 * - Read/query payment records
 *   
 * IMPORTANT: Use only with service role key on server side.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/supabase-server';
import { encryptData, decryptData } from '@/lib/security/encryption.service';
import { DocumentCryptoService, buildDocumentPayloadFromPayment } from '@/lib/security/document-crypto.service';

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
    stop_id?: string;                 // Stop ID (encrypted for new, plain for legacy)

    amount?: number;
    currency?: string;
    method?: 'Online' | 'Offline';
    status?: 'Pending' | 'Completed' | 'Rejected';
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
    stopId?: string;
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

// ============================================
// SERVICE CLASS (IMMUTABLE PAYMENT LEDGER)
// ============================================

class PaymentsSupabaseService {
    private supabase: SupabaseClient;
    private isInitialized: boolean = false;

    constructor() {
        try {
            this.supabase = getSupabaseServer();
            this.isInitialized = true;
        } catch (err) {
            console.error('[PaymentsSupabaseService] Missing Supabase credentials');
            this.supabase = null as unknown as SupabaseClient;
            this.isInitialized = false;
        }
    }

    isReady(): boolean {
        return this.isInitialized;
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
        const stop_id = record.stop_id ? decryptData(record.stop_id) : undefined;

        return {
            ...record,
            student_name: student_name !== null ? student_name : undefined,
            student_id: student_id !== null ? student_id : undefined,
            offline_transaction_id: offline_transaction_id !== null ? offline_transaction_id : undefined,
            stop_id: stop_id !== null ? stop_id : undefined,
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
            const validUntilIso = input.validUntil?.toISOString();
            const transactionDateIso = input.transactionDate?.toISOString() || new Date().toISOString();
            const documentSignature = this.buildCompletedPaymentSignature(input, {
                paymentId: input.paymentId,
                validUntil: validUntilIso,
                transactionDate: transactionDateIso,
            });
            const approvedBy = this.normalizeApprovedBy(input);

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
                // NOTE: stop_id is intentionally excluded - column doesn't exist in Supabase yet
                // To enable: run 'ALTER TABLE payments ADD COLUMN stop_id TEXT;' in Supabase SQL Editor
                // Then uncomment: stop_id: input.stopId ? encryptData(input.stopId) : null,

                // NOT encrypted - needed for Razorpay reconciliation/lookup
                razorpay_payment_id: input.razorpayPaymentId,
                razorpay_order_id: input.razorpayOrderId,

                approved_by: approvedBy,
                approved_at: input.approvedAt?.toISOString(),
            };

            if (documentSignature) {
                record.document_signature = documentSignature;
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

            const validUntilIso = input.validUntil?.toISOString();
            const transactionDateIso = input.transactionDate?.toISOString() || new Date().toISOString();
            const documentSignature = this.buildCompletedPaymentSignature(input, {
                paymentId: input.paymentId,
                validUntil: validUntilIso,
                transactionDate: transactionDateIso,
            });
            const approvedBy = this.normalizeApprovedBy(input);

            const record: Record<string, unknown> = {
                payment_id: input.paymentId,
                student_uid: input.studentUid,
                amount: input.amount,
                currency: 'INR',
                method: input.method,
                status: input.status || 'Pending',
                session_start_year: input.sessionStartYear,
                session_end_year: input.sessionEndYear,
                duration_years: input.durationYears,
                valid_until: validUntilIso,
                transaction_date: transactionDateIso,
                student_name: input.studentName ? encryptData(input.studentName) : null,
                student_id: input.studentId ? encryptData(input.studentId) : null,
                offline_transaction_id: input.offlineTransactionId ? encryptData(input.offlineTransactionId) : null,
                razorpay_payment_id: input.razorpayPaymentId,
                razorpay_order_id: input.razorpayOrderId,
                approved_by: approvedBy,
                approved_at: input.approvedAt?.toISOString(),
            };

            if (documentSignature) {
                record.document_signature = documentSignature;
            }

            const { data, error } = await this.supabase
                .from('payments')
                .insert([record])
                .select('payment_id')
                .single();

            if (error) {
                if (error.code === '23505') {
                    // Post-insert fallback / race-condition check
                    const query = this.supabase
                        .from('payments')
                        .select('payment_id, razorpay_payment_id, status')
                        .eq('status', 'Completed');
                    
                    if (input.studentUid) query.eq('student_uid', input.studentUid);
                    if (input.sessionStartYear) query.eq('session_start_year', input.sessionStartYear);
                    if (input.sessionEndYear) query.eq('session_end_year', input.sessionEndYear);

                    const { data: existingRecords, error: queryErr } = await query;

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
                    
                    // Fallback to check if the payment_id itself is a duplicate
                    const { data: idRecords } = await this.supabase
                        .from('payments')
                        .select('payment_id')
                        .eq('payment_id', input.paymentId);
                    if (idRecords && idRecords.length > 0) {
                        throw new Error('ALREADY_PROCESSED');
                    }
                    
                    throw new Error('DUPLICATE_SESSION_PAYMENT');
                }
                console.error('[PaymentsSupabaseService] Insert error:', error);
                return null;
            }

            return data?.payment_id || input.paymentId;
        } catch (err: any) {
            if (err.message === 'ALREADY_PROCESSED' || err.message === 'DUPLICATE_SESSION_PAYMENT') {
                throw err;
            }
            console.error('[PaymentsSupabaseService] Insert exception:', err);
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
                    .select('*')
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

    /**
     * Get payment by ID
     */
    async getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
        if (!this.isReady()) return null;

        try {
            const { data, error } = await this.supabase
                .from('payments')
                .select('*')
                .eq('payment_id', paymentId)
                .single();

            if (error) {
                return null;
            }
            return this.decryptRecord(data as PaymentRecord);
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
            // Cannot search by encrypted value with random IV. 
            // So this method might fail if we rely on the encrypted column.
            // However, usually online payments use payment_id = razorpay_payment_id.
            // So we can try `getPaymentById` instead if they match.

            // For now, attempting exact match on column will fail if encrypted.
            // I'll leave this query as is, but it will likely return nothing if encrypted.
            // Given the constraints, I will NOT encrypt razorpay_payment_id column to preserve lookup capability 
            // OR the user accepts this trade-off. 
            // Let's TRY to encrypt `student_name` and `offline_transaction_id` ONLY.

            const { data, error } = await this.supabase
                .from('payments')
                .select('*')
                .eq('razorpay_payment_id', razorpayPaymentId) // This query assumes plaintext
                .single();

            if (error) return null;
            return this.decryptRecord(data as PaymentRecord);
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
                .select('*')
                .eq('student_uid', studentUid)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (error) return [];
            return (data || []).map(p => this.decryptRecord(p as PaymentRecord));
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
                .select('*')
                .gte('transaction_date', startDate.toISOString())
                .lte('transaction_date', endDate.toISOString())
                .order('transaction_date', { ascending: true });

            if (error) return [];
            return (data || []).map(p => this.decryptRecord(p as PaymentRecord));
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
                .select('*')
                .order('created_at', { ascending: false })
                .limit(limit);

            if (error) return [];
            return (data || []).map(p => this.decryptRecord(p as PaymentRecord));
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
                .select('*')
                .eq('status', 'Pending')
                .eq('method', 'Offline')
                .order('created_at', { ascending: true });

            if (error) return [];
            return (data || []).map(p => this.decryptRecord(p as PaymentRecord));
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
                .select('*', { count: 'exact' });

            if (filters.method) {
                query = query.eq('method', filters.method);
            }
            if (filters.status) {
                query = query.eq('status', filters.status);
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

            return {
                payments: (data || []).map(p => this.decryptRecord(p as PaymentRecord)),
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
                .select('*')
                .gte('transaction_date', startDate.toISOString())
                .lte('transaction_date', endDate.toISOString())
                .eq('status', 'Completed')
                .order('transaction_date', { ascending: true });

            if (error) {
                console.error('[PaymentsSupabaseService] Reporting fetch error:', error);
                return [];
            }

            return (data || []).map(p => this.decryptRecord(p as PaymentRecord));
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
        totalRevenue: number;
        onlinePayments: number;
        offlinePayments: number;
    }> {
        if (!this.isReady()) {
            return { totalPayments: 0, completedPayments: 0, pendingPayments: 0, totalRevenue: 0, onlinePayments: 0, offlinePayments: 0 };
        }

        try {
            // Only pull the fields we need to reduce payload size
            const { data, error } = await this.supabase
                .from('payments')
                .select('status, amount, method');

            if (error) {
                console.error('[PaymentsSupabaseService] Stats error:', error);
                return { totalPayments: 0, completedPayments: 0, pendingPayments: 0, totalRevenue: 0, onlinePayments: 0, offlinePayments: 0 };
            }

            const payments = data || [];
            let completedCount = 0;
            let pendingCount = 0;
            let totalRevenue = 0;
            let onlineCount = 0;
            let offlineCount = 0;

            for (const p of payments) {
                const isCompleted = p.status === 'Completed' || (p.status || '').toLowerCase() === 'completed';
                const isPending = p.status === 'Pending' || (p.status || '').toLowerCase() === 'pending';

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
                }
            }

            return {
                totalPayments: payments.length,
                completedPayments: completedCount,
                pendingPayments: pendingCount,
                totalRevenue,
                onlinePayments: onlineCount,
                offlinePayments: offlineCount
            };
        } catch (error: unknown) {
            console.error('[PaymentsSupabaseService] Stats error:', error);
            return { totalPayments: 0, completedPayments: 0, pendingPayments: 0, totalRevenue: 0, onlinePayments: 0, offlinePayments: 0 };
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

            const startDate = last7Days[0].toISOString();

            const { data, error } = await this.supabase
                .from('payments')
                .select('amount, transaction_date')
                .eq('status', 'Completed')
                .gte('transaction_date', startDate)
                .order('transaction_date', { ascending: true });

            if (error) {
                console.error('[PaymentsSupabaseService] Trend error:', error);
                return [];
            }

            const payments = data || [];

            return last7Days.map(day => {
                const dateStr = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const dayISO = day.toISOString().split('T')[0];

                const dayTotal = payments
                    .filter(p => p.transaction_date?.startsWith(dayISO))
                    .reduce((sum, p) => sum + (p.amount || 0), 0);

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
                .eq('status', 'Completed')
                .gte('transaction_date', startDate)
                .order('transaction_date', { ascending: true });

            if (error) {
                console.error('[PaymentsSupabaseService] Monthly trend error:', error);
                return [];
            }

            const payments = data || [];

            return last6Months.map(month => {
                const dateStr = month.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                // Use local year and month for consistent filtering with the way last6Months was generated
                const monthYear = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

                const monthTotal = payments
                    .filter(p => p.transaction_date?.startsWith(monthYear))
                    .reduce((sum, p) => sum + (p.amount || 0), 0);

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
}

// Export singleton instance
export const paymentsSupabaseService = new PaymentsSupabaseService();

// Export class for custom instantiation
export { PaymentsSupabaseService };
