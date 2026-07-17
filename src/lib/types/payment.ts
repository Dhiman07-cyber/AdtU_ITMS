/**
 * ADTU Bus Services Payment System Types
 * 
 * Unified payment document schema for both Online (Razorpay) and Offline (Manual) payments.
 * Designed for fraud prevention through identity-based accountability.
 */

// ============================================================================
// ENUMS & CONSTANTS
// ============================================================================

export type PaymentMethod = 'Online' | 'Offline';
export type PaymentStatus = 'Pending' | 'Completed' | 'Rejected';

export type ApproverType = 'SYSTEM' | 'Manual';
export type ApproverRole = 'Moderator' | 'Admin';

// ============================================================================
// APPROVER TYPES (Critical for Fraud Prevention)
// ============================================================================

/**
 * System Approver - For auto-verified online payments
 */
export interface SystemApprover {
    type: 'SYSTEM';
}

/**
 * Manual Approver - For offline payments approved by moderator/admin
 * All fields are REQUIRED for audit trail
 */
export interface ManualApprover {
    type: 'Manual';
    userId: string;      // Firebase Auth UID
    empId: string;       // Employee ID (e.g., "EMP-001")
    name: string;        // Full name of approver
    role: ApproverRole;  // 'Moderator' | 'Admin'
}

export type PaymentApprover = SystemApprover | ManualApprover;



// ============================================================================
// PAYMENT DOCUMENT SCHEMA
// ============================================================================

/**
 * Base Payment Document - Common fields for all payments
 * Stored in Firestore: /payments/{paymentId}
 */
export interface PaymentDocumentBase {
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY
    // ─────────────────────────────────────────────────────────────────────────

    /** Unique payment ID - Razorpay ID for online, `manual_${timestamp}_${random}` for offline */
    paymentId: string;

    /** Student's enrollment ID (e.g., "ADTU/E/2024-28/BVSK/076") */
    studentId: string;

    /** Student's Firebase Auth UID */
    studentUid: string;

    /** Student's full name (denormalized for quick display) */
    studentName: string;

    // ─────────────────────────────────────────────────────────────────────────
    // PAYMENT DETAILS
    // ─────────────────────────────────────────────────────────────────────────

    /** Payment amount in INR (e.g., 1200) */
    amount: number;

    /** Subscription duration in years (e.g., 1, 2, 3, 4) */
    durationYears: number;

    /** Payment method: 'Online' (Razorpay) or 'Offline' (Manual) */
    method: PaymentMethod;

    /** Current payment status */
    status: PaymentStatus;

    // ─────────────────────────────────────────────────────────────────────────
    // SESSION INFORMATION
    // ─────────────────────────────────────────────────────────────────────────

    /** Academic session start year */
    sessionStartYear: number;

    /** Academic session end year */
    sessionEndYear: number;

    /** New validity date after payment completion */
    validUntil: Date | string;

    // ─────────────────────────────────────────────────────────────────────────
    // TIMESTAMPS
    // ─────────────────────────────────────────────────────────────────────────

    /** When payment was initiated */
    createdAt: Date | string;

    /** Last status update timestamp */
    updatedAt: Date | string;
}

/**
 * Online Payment Document - Auto-verified via Razorpay
 */
export interface OnlinePaymentDocument extends PaymentDocumentBase {
    method: 'Online';

    // Razorpay-specific fields
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature?: string;

    // Approval (always SYSTEM for online)
    approvedBy: SystemApprover;
    approvedAt: Date | string;
}

/**
 * Offline Payment Document - Requires manual approval
 */
export interface OfflinePaymentDocument extends PaymentDocumentBase {
    method: 'Offline';

    // Offline transaction reference (UPI ID, Bank Transfer ID, etc.)
    offlineTransactionId: string;

    // Approval fields (set when approved)
    approvedBy?: ManualApprover;
    approvedAt?: Date | string;
}

/**
 * Unified Payment Document type
 */
export type PaymentDocument = OnlinePaymentDocument | OfflinePaymentDocument;

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Request to create an online payment record
 */
export interface CreateOnlinePaymentRequest {
    studentUid: string;
    studentId: string;
    studentName: string;
    amount: number;
    durationYears: number;
    sessionStartYear: number;
    sessionEndYear: number;
    validUntil: string;
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature?: string;
    purpose: 'new_registration' | 'renewal';
}

/**
 * Request to create an offline payment (pending approval)
 */
export interface CreateOfflinePaymentRequest {
    studentUid: string;
    studentId: string;
    studentName: string;
    amount: number;
    durationYears: number;
    sessionStartYear: number;
    sessionEndYear: number;
    validUntil: string;
    offlineTransactionId: string;
    purpose: 'new_registration' | 'renewal';
}

/**
 * Request to approve an offline payment
 */
export interface ApprovePaymentRequest {
    paymentId: string;
    approverUserId: string;
    approverEmpId: string;
    approverName: string;
    approverRole: ApproverRole;
}

/**
 * Request to reject an offline payment
 */
export interface RejectPaymentRequest {
    paymentId: string;
    rejectorUserId: string;
    rejectorEmpId: string;
    rejectorName: string;
    rejectorRole: ApproverRole;
}

/**
 * Payment query filters
 */
export interface PaymentQueryFilters {
    studentUid?: string;
    studentId?: string;
    method?: PaymentMethod;
    status?: PaymentStatus;
    year?: number;
    startDate?: Date;
    endDate?: Date;
}

/**
 * Paginated payment response
 */
export interface PaginatedPaymentResponse {
    payments: PaymentDocument[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

// ============================================================================
// UI DISPLAY TYPES
// ============================================================================

/**
 * Payment display data for UI components
 */
export interface PaymentDisplayData {
    paymentId: string;
    studentName: string;
    studentId: string;
    amount: number;
    method: PaymentMethod;
    status: PaymentStatus;
    durationYears: number;
    validUntil: Date;
    createdAt: Date;

    // For admin view - approver details
    approverName?: string;
    approverEmpId?: string;
    approverRole?: ApproverRole;
    approvedAt?: Date;

    // For offline payments
    offlineTransactionId?: string;

    // For online payments
    razorpayPaymentId?: string;
}

/**
 * Payment detail modal data
 */
export interface PaymentDetailModalData {
    // Student info
    studentName: string;
    studentId: string;
    studentUid: string;

    // Payment info
    paymentId: string;
    offlineTransactionId?: string;
    razorpayPaymentId?: string;
    amount: number;
    durationYears: number;
    method: PaymentMethod;
    status: PaymentStatus;

    // Session info
    sessionStartYear: number;
    sessionEndYear: number;
    validUntil: Date;

    // Approval info (for completed offline payments)
    approver?: {
        name: string;
        empId: string;
        role: ApproverRole;
        approvedAt: Date;
    };

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if payment is an online payment
 */
export function isOnlinePayment(payment: PaymentDocument): payment is OnlinePaymentDocument {
    return payment.method === 'Online';
}

/**
 * Check if payment is an offline payment
 */
export function isOfflinePayment(payment: PaymentDocument): payment is OfflinePaymentDocument {
    return payment.method === 'Offline';
}

/**
 * Check if approver is manual (not system)
 */
export function isManualApprover(approver: PaymentApprover): approver is ManualApprover {
    return approver.type === 'Manual';
}

/**
 * Check if payment is immutable (completed or rejected)
 */
export function isPaymentImmutable(payment: PaymentDocument): boolean {
    return payment.status === 'Completed' || payment.status === 'Rejected';
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a cryptographically secure random string of a given length
 */
function getSecureRandomString(len: number = 8): string {
    const cryptoObj = typeof window !== 'undefined' ? (window.crypto || (window as any).msCrypto) : globalThis.crypto;
    if (cryptoObj && cryptoObj.randomUUID) {
        return cryptoObj.randomUUID().replace(/-/g, '').substring(0, len).toUpperCase();
    } else if (cryptoObj && cryptoObj.getRandomValues) {
        const array = new Uint32Array(Math.ceil(len / 4));
        cryptoObj.getRandomValues(array);
        let result = '';
        for (let i = 0; i < array.length; i++) {
            result += array[i].toString(36);
        }
        return result.substring(0, len).toUpperCase();
    } else {
        let result = '';
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        for (let i = 0; i < len; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
        return result;
    }
}

/**
 * Generate a unique payment ID for offline payments
 */
export function generateOfflinePaymentId(purpose: 'new_registration' | 'renewal' = 'new_registration'): string {
    const timestamp = Date.now();
    const random = getSecureRandomString(8);
    const prefix = purpose === 'new_registration' ? 'OADF_' : 'ORTF_';
    return `${prefix}${timestamp}_${random}`;
}

/**
 * Generate a unique payment ID for online payments
 */
export function generateOnlinePaymentId(purpose: 'new_registration' | 'renewal' = 'new_registration'): string {
    const timestamp = Date.now();
    const random = getSecureRandomString(8);
    const prefix = purpose === 'new_registration' ? 'OADN_' : 'ORTN_';
    return `${prefix}${timestamp}_${random}`;
}

/**
 * Format approver display string
 */
export function formatApproverDisplay(approver: PaymentApprover): string {
    if (approver.type === 'SYSTEM') {
        return 'System Verified';
    }
    return `${approver.name} (${approver.empId})`;
}

/**
 * Get status badge color class
 */
export function getStatusBadgeClass(status: PaymentStatus): string {
    switch (status) {
        case 'Completed':
            return 'bg-gradient-to-r from-green-500 to-emerald-600 text-white';
        case 'Pending':
            return 'bg-gradient-to-r from-yellow-500 to-amber-600 text-white';
        case 'Rejected':
            return 'bg-gradient-to-r from-red-500 to-rose-600 text-white';
        default:
            return 'bg-gray-500 text-white';
    }
}

/**
 * Get method badge color class
 */
export function getMethodBadgeClass(method: PaymentMethod): string {
    switch (method) {
        case 'Online':
            return 'bg-gradient-to-r from-blue-500 to-cyan-600 text-white';
        case 'Offline':
            return 'bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white cursor-pointer hover:shadow-lg transition-shadow';
        default:
            return 'bg-gray-500 text-white';
    }
}
