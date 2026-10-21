/**
 * ADTU Bus Services Payment Service
 * 
 * Unified payment service for SUPABASE-based payment management.
 * 
 * ⚠️ CRITICAL ARCHITECTURE RULES:
 * 1. All payments are stored in Supabase ONLY (not Firestore).
 * 2. Payments are IMMUTABLE - once created, they CANNOT be deleted.
 * 3. Supabase `payments` table is the SINGLE SOURCE OF TRUTH.
 * 4. Payments are permanent financial records (5-10+ years).
 * 
 * Key Features:
 * - Fraud prevention through identity-based accountability
 * - Immutability after creation (append-only ledger)
 * - Status transitions: Pending → Completed (no deletions)
 */

import { getById as getApplicationById, getByApplicantUid } from '@/domains/application';
import { createAuditEvent } from '@/domains/audit';
import { getUsersByRole } from '@/domains/identity';
import * as Notification from '@/domains/notification';
import { applyPaymentValidity, getByEnrollmentId as getStudentByEnrollmentId, getByUid as getStudentByUid, SeatReclaimRequiredError } from '@/domains/student';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { paymentsSupabaseService,type PaymentRecord } from '@/lib/services/payments-supabase';
import { ensureReceiptSignature } from '@/lib/services/receipt.service';
import { getSupabaseServer } from '@/lib/supabase-server';
import {
	ApprovePaymentRequest,
	CreateOnlinePaymentRequest,
	OfflinePaymentDocument,
	OnlinePaymentDocument,
	PaginatedPaymentResponse,
	PaymentDetailModalData,
	PaymentDisplayData,
	PaymentDocument,
	PaymentQueryFilters,
	RejectPaymentRequest,
	generateOfflinePaymentId,
	generateOnlinePaymentId,
	isOfflinePayment,
	isOnlinePayment,
} from '@/lib/types/payment';
import { calculateValidUntilDate } from '@/lib/utils/date-utils';

// ============================================================================
// PAYMENT CREATION - NOW WRITES TO SUPABASE
// ============================================================================

/**
 * Create an online payment record (auto-approved via Razorpay)
 * Called after Razorpay webhook verification
 * 
 * ✅ WRITES TO SUPABASE (not Firestore)
 */
export async function createOnlinePayment(
    request: CreateOnlinePaymentRequest
): Promise<OnlinePaymentDocument> {
    const now = new Date();
    const paymentId = request.razorpayPaymentId || generateOnlinePaymentId(request.purpose);

    // Build the payment document for return
    const paymentDoc: OnlinePaymentDocument = {
        paymentId,
        studentId: request.studentId,
        studentUid: request.studentUid,
        studentName: request.studentName || 'Student', // Fallback for missing name
        amount: request.amount,
        durationYears: request.durationYears,
        method: 'Online',
        status: 'Completed',
        sessionStartYear: request.sessionStartYear,
        sessionEndYear: request.sessionEndYear,
        validUntil: request.validUntil,
        createdAt: now,
        updatedAt: now,
        razorpayPaymentId: request.razorpayPaymentId,
        razorpayOrderId: request.razorpayOrderId,
        razorpaySignature: request.razorpaySignature,
        approvedBy: { type: 'SYSTEM' },
        approvedAt: now,
    };

    // ✅ Write to SUPABASE (IMMUTABLE - cannot be deleted later)
    const result = await paymentsSupabaseService.createPayment({
        paymentId,
        studentId: request.studentId,
        studentUid: request.studentUid,
        studentName: request.studentName || 'Unknown', // Fallback for missing name
        amount: request.amount,
        method: 'Online',
        status: 'Completed',
        sessionStartYear: request.sessionStartYear,
        sessionEndYear: request.sessionEndYear,
        durationYears: request.durationYears,
        validUntil: typeof request.validUntil === 'string'
            ? new Date(request.validUntil)
            : ((request.validUntil as any) instanceof Date ? (request.validUntil as any) : undefined),
        transactionDate: now,
        razorpayPaymentId: request.razorpayPaymentId,
        razorpayOrderId: request.razorpayOrderId,
        approvedBy: { type: 'SYSTEM' },
        approvedAt: now,
    });

    if (!result) {
        const msg = `Failed to create secured online payment ledger record: ${request.razorpayPaymentId}`;
        console.error(`❌ ${msg}`);
        throw new Error(msg);
    }

    return paymentDoc;
}

/**
 * Canonical online payment completion processing.
 * Unifies webhook verification, client verification, and recovery actions.
 * Strict idempotency checks ensure exactly one success processing.
 */
const inFlightPayments = new Map<string, Promise<{ status: 'success' | 'already_processed' | 'error' | 'already_paid_for_session' | 'captured_pending_review'; error?: string }>>();

export async function processCapturedPayment(paymentDetails: {
    paymentId: string;
    orderId: string;
    amount: number; // in rupees
    method?: string;
    notes?: any;
    source?: string;
}): Promise<{ status: 'success' | 'already_processed' | 'error' | 'already_paid_for_session' | 'captured_pending_review'; error?: string }> {
    const { paymentId } = paymentDetails;
    if (inFlightPayments.has(paymentId)) {
        console.log(`[PAYMENT_TRACE] Deduplicating concurrent execution for in-flight payment ${paymentId}`);
        return await inFlightPayments.get(paymentId)!;
    }

    const execPromise = executeProcessCapturedPayment(paymentDetails);
    inFlightPayments.set(paymentId, execPromise);
    try {
        return await execPromise;
    } finally {
        inFlightPayments.delete(paymentId);
    }
}

async function executeProcessCapturedPayment(paymentDetails: {
    paymentId: string;
    orderId: string;
    amount: number; // in rupees
    method?: string;
    notes?: any;
    source?: string;
}): Promise<{ status: 'success' | 'already_processed' | 'error' | 'already_paid_for_session' | 'captured_pending_review'; error?: string }> {
    const { paymentId, orderId, amount, method = 'Online', notes = {}, source = 'system' } = paymentDetails;
    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment ENTER. paymentId:`, paymentId, `orderId:`, orderId, `amount:`, amount, `source:`, source);

    try {
        // 1. Idempotency Check: check if already processed
        const isProcessed = await isPaymentProcessed(paymentId);
        if (isProcessed) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment: ${paymentId} is already in Supabase ledger.`);
            
            // Check if this payment was already recorded as a duplicate capture or pending review
            const existingPayment = await paymentsSupabaseService.getPaymentById(paymentId)
                || await paymentsSupabaseService.getPaymentByRazorpayId(paymentId);
            if (existingPayment?.status === 'Duplicate_Pending_Refund') {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment: ${paymentId} is already recorded as Duplicate_Pending_Refund. Returning already_paid_for_session.`);
                return { status: 'already_paid_for_session' };
            }
            if (existingPayment?.status === 'Captured_Pending_Review') {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment: ${paymentId} is already recorded as Captured_Pending_Review. Returning captured_pending_review.`);
                return { status: 'captured_pending_review' };
            }

            // SELF-HEALING GUARANTEE: For renewal payments, verify that the renewal application record exists.
            // If a previous payment capture failed halfway due to a transient database outage or network switch,
            // recover and create the renewal application now instead of dropping it.
            // Server-derived `type` (set at order creation) is authoritative;
            // free-text `purpose` is only a legacy fallback.
            const rawPurpose = String(notes.type || notes.purpose || '');
            const isRenewal = !rawPurpose.toLowerCase().includes('registration') && rawPurpose.toLowerCase() !== 'new_registration';
            if (isRenewal) {
                const applicationId = `online_${paymentId}`;
                const existingRequest = await getApplicationById(applicationId).catch(() => null);
                if (existingRequest || existingPayment?.metadata?.entitlement_status === 'active') {
                    if (existingPayment?.metadata?.entitlement_status !== 'active') {
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'active',
                            application_id: applicationId,
                            activated_at: new Date().toISOString(),
                        }).catch(() => null);
                    }
                    return { status: 'already_processed' };
                }
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Self-healing missing renewal application for payment ${paymentId}`);
                try {
                    const enrollmentId = notes.enrollmentId || notes.studentId;
                    const userId = notes.userId;
                    const durationYears = parseInt(notes.durationYears || '1', 10) || 1;
                    const studentName = notes.studentName || notes.userName || 'Unknown';
                    let studentUid = userId || '';
                    let actualStudentName = studentName;
                    let studentEmail = '';
                    let studentPhone = '';
                    let studentData: any = null;
                    if (studentUid) {
                        const student = await getStudentByUid(studentUid);
                        if (student) studentData = student as any;
                    }
                    if (studentData) {
                        actualStudentName = studentData.fullName || studentName;
                        studentEmail = studentData.email || '';
                        studentPhone = studentData.phone || studentData.phoneNumber || '';
                    }
                    const existingValidUntil = studentData?.validUntil;
                    let baseYear = new Date().getUTCFullYear();
                    const now = new Date();
                    if (existingValidUntil) {
                        const existingDate = new Date(existingValidUntil);
                        if (existingDate > now) {
                            baseYear = studentData?.sessionEndYear || baseYear;
                        }
                    }
                    const deadlineConfig = await getDeadlineConfig();
                    const newValidUntil = calculateValidUntilDate(baseYear, durationYears, deadlineConfig);
                    const { submitFinal } = await import('@/domains/application');
                    const healSubmitRes = await submitFinal(
                        studentUid,
                        studentEmail || '',
                        {
                            studentId: studentUid,
                            enrollmentId: enrollmentId || studentData?.enrollmentId || '',
                            studentName: actualStudentName,
                            studentEmail,
                            studentPhone,
                            durationYears,
                            totalFee: amount,
                            paymentMode: 'online',
                            paymentId,
                            razorpayOrderId: orderId,
                            paymentStatus: 'paid',
                            requestedValidUntil: newValidUntil.toISOString(),
                            phoneNumber: studentPhone,
                            shift: studentData?.shift || 'Morning',
                            busId: studentData?.busId || '',
                            routeId: studentData?.routeId || '',
                            stop_name: studentData?.stop_name || studentData?.stopName || '',
                            sessionStartYear: studentData?.sessionEndYear || baseYear,
                            sessionEndYear: (studentData?.sessionEndYear || baseYear) + durationYears,
                        },
                        {
                            applicationId,
                            applicationType: 'renewal',
                            shift: studentData?.shift || 'Morning',
                            busId: studentData?.busId || '',
                            routeId: studentData?.routeId || '',
                            stop_name: studentData?.stop_name || studentData?.stopName || '',
                            sessionStartYear: studentData?.sessionEndYear || baseYear,
                            sessionEndYear: (studentData?.sessionEndYear || baseYear) + durationYears,
                        }
                    );
                    if (healSubmitRes && !healSubmitRes.success) {
                        console.warn(`[PAYMENT_TRACE] submitFinal self-heal returned failure for renewal ${applicationId}:`, healSubmitRes.error);
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'failed',
                            application_id: applicationId,
                            entitlement_error: healSubmitRes?.error || 'submitFinal self-heal returned failure',
                            last_attempt_at: new Date().toISOString(),
                        }).catch(() => null);
                    } else {
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'active',
                            application_id: applicationId,
                            activated_at: new Date().toISOString(),
                        }).catch(() => null);
                    }
                    return { status: 'success' };
                } catch (healError: any) {
                    console.error(`[PAYMENT_TRACE] Self-heal failed for payment ${paymentId}:`, healError);
                    await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                        entitlement_status: 'failed',
                        application_id: applicationId,
                        entitlement_error: healError?.message || String(healError),
                        last_attempt_at: new Date().toISOString(),
                    }).catch(() => null);
                    return { status: 'error', error: `Self-heal failed: ${healError?.message || String(healError)}` };
                }
            } else {
                const registrationAppId = notes.userId || notes.studentId;
                if (registrationAppId) {
                    const existingApp = await getApplicationById(registrationAppId).catch(() => null);
                    if (existingApp && existingPayment?.metadata?.entitlement_status !== 'active') {
                        await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                            entitlement_status: 'active',
                            application_id: registrationAppId,
                            activated_at: new Date().toISOString(),
                        }).catch(() => null);
                    }
                }
                return { status: 'already_processed' };
            }
        }

        const enrollmentId = notes.enrollmentId || notes.studentId;
        const userId = notes.userId;
        const durationYears = parseInt(notes.durationYears || '1', 10) || 1;
        const studentName = notes.studentName || notes.userName || 'Unknown';

        if (!enrollmentId && !userId) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment error: Missing enrollment/user ID in notes:`, JSON.stringify(notes));
            return { status: 'error', error: 'Missing enrollment or user ID in payment notes' };
        }

        const rawPurpose = String(notes.purpose || notes.type || '');
        const isNewRegistration = rawPurpose.toLowerCase().includes('registration') || rawPurpose.toLowerCase() === 'new_registration';
        const deadlineConfig = await getDeadlineConfig();

        if (isNewRegistration) {
            let sessionStartYear: number | undefined;
            let sessionEndYear: number | undefined;
            let targetValidUntil: Date;
            if (userId) {
                const app = await getApplicationById(userId);
                if (app) {
                    const ts = (app as any).targetSession;
                    if (ts && Number(ts.startYear) > 0 && Number(ts.endYear) > 0) {
                        sessionStartYear = Number(ts.startYear);
                        sessionEndYear = Number(ts.endYear);
                    }
                }
            }
            if (sessionStartYear && sessionEndYear) {
                const anchorMonth = deadlineConfig.academicYear.anchorMonth;
                const anchorDay = deadlineConfig.academicYear.anchorDay;
                targetValidUntil = new Date(Date.UTC(sessionEndYear, anchorMonth, anchorDay, 23, 59, 59, 999));
            } else if (notes.sessionStartYear && notes.sessionEndYear) {
                const parsedStart = parseInt(notes.sessionStartYear, 10);
                const parsedEnd = parseInt(notes.sessionEndYear, 10);
                if (parsedStart > 2000 && parsedEnd > parsedStart) {
                    sessionStartYear = parsedStart;
                    sessionEndYear = parsedEnd;
                    const anchorMonth = deadlineConfig.academicYear.anchorMonth;
                    const anchorDay = deadlineConfig.academicYear.anchorDay;
                    targetValidUntil = new Date(Date.UTC(sessionEndYear, anchorMonth, anchorDay, 23, 59, 59, 999));
                }
            }

            if (!sessionStartYear || !sessionEndYear) {
                console.warn(`[processCapturedPayment] Academic session could not be determined for registration payment ${paymentId}. Preserving in ledger without granting transit entitlement.`);
                await paymentsSupabaseService.createDuplicatePaymentRecord({
                    paymentId,
                    studentUid: userId || enrollmentId || '',
                    studentId: enrollmentId || '',
                    studentName,
                    amount,
                    method,
                    status: 'Captured_Pending_Review',
                    sessionStartYear: undefined,
                    sessionEndYear: undefined,
                    razorpayPaymentId: paymentId,
                    razorpayOrderId: orderId,
                    notes: `Captured registration payment missing verified academic session. Preserved in ledger for manual review without granting transit entitlement.`,
                    metadata: {
                        requires_manual_review: true,
                        unresolved_academic_session: true,
                        duplicate_session_capture: false,
                    }
                });
                return {
                    status: 'captured_pending_review'
                };
            }

            // Save Completed online payment record to Supabase (Immutable Ledger)
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert`);
            const registrationAppId = userId || enrollmentId;
            let initialEntitlementStatus = 'pending_registration_submission';
            if (registrationAppId) {
                const existingApp = await getApplicationById(registrationAppId).catch(() => null);
                if (existingApp) {
                    initialEntitlementStatus = 'active';
                }
            }

            const result = await paymentsSupabaseService.createPayment({
                paymentId,
                studentId: enrollmentId || '',
                studentUid: userId || '',
                studentName,
                amount,
                method: 'Online',
                status: 'Completed',
                sessionStartYear,
                sessionEndYear,
                durationYears,
                validUntil: targetValidUntil,
                transactionDate: new Date(),
                razorpayPaymentId: paymentId,
                razorpayOrderId: orderId,
                approvedBy: { type: 'SYSTEM' },
                approvedAt: new Date(),
                metadata: {
                    ...(notes || {}),
                    entitlement_status: initialEntitlementStatus,
                    application_id: registrationAppId || undefined,
                    initial_captured_at: new Date().toISOString(),
                },
            });

            if (!result) {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert FAILED`);
                throw new Error(`Failed to create online payment ledger record: ${paymentId}`);
            }

            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert SUCCESS: ${result}`);

            return { status: 'success' };
        } else {
            // Renewal Flow
            let studentUid = userId || '';
            let actualStudentName = studentName;
            let studentEmail = '';
            let studentPhone = '';
            let transactionRecord: any = null;

            // Resolve student from domain API (needed for renewal validity calc)
            let studentData: any = null;
            if (studentUid) {
                const student = await getStudentByUid(studentUid);
                if (student) studentData = student as any;
            }

            if (studentData) {
                actualStudentName = studentData.fullName || studentName;
                studentEmail = studentData.email || '';
                studentPhone = studentData.phone || studentData.phoneNumber || '';
            }

            let existingSessionStartYear = studentData?.sessionStartYear;
            let existingSessionEndYear = studentData?.sessionEndYear;

            // If not on student profile, check verified order notes
            if (!existingSessionStartYear || !existingSessionEndYear) {
                if (notes.sessionStartYear && notes.sessionEndYear) {
                    const parsedStart = parseInt(notes.sessionStartYear, 10);
                    const parsedEnd = parseInt(notes.sessionEndYear, 10);
                    if (parsedStart > 2000 && parsedEnd > parsedStart) {
                        existingSessionStartYear = parsedStart;
                        existingSessionEndYear = parsedEnd;
                    }
                }
            }

            if (!existingSessionStartYear || !existingSessionEndYear) {
                console.warn(`[processCapturedPayment] Renewal session could not be determined for student ${studentUid}. Preserving in ledger without granting transit entitlement.`);
                await paymentsSupabaseService.createDuplicatePaymentRecord({
                    paymentId,
                    studentUid,
                    studentId: enrollmentId || studentData?.enrollmentId || '',
                    studentName: actualStudentName,
                    amount,
                    method,
                    status: 'Captured_Pending_Review',
                    sessionStartYear: undefined,
                    sessionEndYear: undefined,
                    razorpayPaymentId: paymentId,
                    razorpayOrderId: orderId,
                    notes: `Captured renewal payment missing verified academic session. Preserved in ledger for manual review without granting transit entitlement.`,
                    metadata: {
                        requires_manual_review: true,
                        unresolved_academic_session: true,
                        duplicate_session_capture: false,
                    }
                });
                return {
                    status: 'captured_pending_review'
                };
            }

            const existingDurationYears = studentData?.durationYears || 0;
            const existingValidUntil = studentData?.validUntil;
            const previousValidUntilISO = existingValidUntil
                ? (typeof existingValidUntil === 'string' ? existingValidUntil : new Date(existingValidUntil).toISOString())
                : null;

            let baseYear = new Date().getUTCFullYear();
            const now = new Date();

            if (existingValidUntil) {
                const existingDate = new Date(existingValidUntil);
                if (existingDate > now) {
                    baseYear = existingSessionEndYear;
                }
            }

            let newValidUntil = calculateValidUntilDate(baseYear, durationYears, deadlineConfig);
            let newSessionStartYear = baseYear;
            let newSessionEndYear = baseYear + durationYears;
            let totalDurationYears = existingDurationYears + durationYears;

            transactionRecord = {
                studentId: enrollmentId || studentData?.enrollmentId || '',
                studentName: actualStudentName,
                amount,
                paymentMethod: 'online' as const,
                paymentId,
                timestamp: new Date().toISOString(),
                durationYears,
                validUntil: newValidUntil.toISOString(),
                previousValidUntil: previousValidUntilISO,
                newValidUntil: newValidUntil.toISOString(),
                previousSessionEndYear: existingSessionEndYear,
                newSessionEndYear,
                previousDurationYears: existingDurationYears,
                newDurationYears: totalDurationYears,
                userId: studentUid,
                status: 'completed' as const
            };

            // Save Completed online payment record to Supabase (Immutable Ledger)
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert`);
            const applicationId = `online_${paymentId}`;
            const result = await paymentsSupabaseService.createPayment({
                paymentId,
                studentId: transactionRecord.studentId,
                studentUid: transactionRecord.userId,
                studentName: transactionRecord.studentName,
                amount: transactionRecord.amount,
                method: 'Online',
                status: 'Completed',
                sessionStartYear: newSessionStartYear,
                sessionEndYear: newSessionEndYear,
                durationYears: transactionRecord.durationYears,
                validUntil: new Date(transactionRecord.validUntil),
                transactionDate: new Date(),
                razorpayPaymentId: paymentId,
                razorpayOrderId: orderId,
                approvedBy: { type: 'SYSTEM' },
                approvedAt: new Date(),
                metadata: {
                    ...(notes || {}),
                    entitlement_status: 'pending_application',
                    application_id: applicationId,
                    initial_captured_at: new Date().toISOString(),
                },
            });

            if (!result) {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert FAILED`);
                throw new Error(`Failed to create online payment ledger record: ${paymentId}`);
            }

            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] PROCESS_CAPTURED[2] Supabase insert SUCCESS: ${result}`);

            // D8: Create the PENDING renewal application in PostgreSQL instead of Firestore
            const existingRequest = await getApplicationById(applicationId);
            if (!existingRequest) {
                const { submitFinal } = await import('@/domains/application');
                const renewalSubmitRes = await submitFinal(
                    studentUid,
                    studentEmail || '',
                    {
                        studentId: studentUid,
                        enrollmentId: enrollmentId || transactionRecord?.studentId || studentData?.enrollmentId || '',
                        studentName: actualStudentName,
                        studentEmail,
                        studentPhone,
                        durationYears,
                        totalFee: amount,
                        paymentMode: 'online',
                        paymentId,
                        razorpayOrderId: orderId,
                        paymentStatus: 'paid',
                        paymentInfo: {
                            paymentMode: 'online',
                            razorpayPaymentId: paymentId,
                            razorpayOrderId: orderId,
                            amountPaid: amount,
                            paymentStatus: 'paid',
                        },
                        requestedValidUntil: newValidUntil.toISOString(),
                        phoneNumber: studentPhone,
                        shift: studentData?.shift || 'Morning',
                        busId: studentData?.busId || '',
                        routeId: studentData?.routeId || '',
                        stop_name: studentData?.stop_name || studentData?.stopName || '',
                        sessionStartYear: baseYear,
                        sessionEndYear: baseYear + durationYears,
                    },
                    {
                        applicationId,
                        applicationType: 'renewal',
                        paymentId,
                        paymentMode: 'online',
                        amountPaid: amount,
                        shift: studentData?.shift || 'Morning',
                        busId: studentData?.busId || '',
                        routeId: studentData?.routeId || '',
                        stop_name: studentData?.stop_name || studentData?.stopName || '',
                        sessionStartYear: baseYear,
                        sessionEndYear: baseYear + durationYears,
                    }
                );
                if (renewalSubmitRes && !renewalSubmitRes.success) {
                    console.warn(`[PAYMENT_TRACE] submitFinal renewal returned failure for ${applicationId}:`, renewalSubmitRes.error);
                    await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                        entitlement_status: 'failed',
                        application_id: applicationId,
                        entitlement_error: renewalSubmitRes?.error || 'submitFinal renewal returned failure',
                        last_attempt_at: new Date().toISOString(),
                    }).catch(() => null);
                } else if (renewalSubmitRes && renewalSubmitRes.success) {
                    await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                        entitlement_status: 'active',
                        application_id: applicationId,
                        activated_at: new Date().toISOString(),
                    }).catch(() => null);
                }
            } else {
                await paymentsSupabaseService.updatePaymentMetadata?.(paymentId, {
                    entitlement_status: 'active',
                    application_id: applicationId,
                    activated_at: new Date().toISOString(),
                }).catch(() => null);
            }

            // Cross-process entitlement cache invalidation
            try {
                const { invalidateStudentAssignmentCache } = await import('@/domains/student');
                await invalidateStudentAssignmentCache(studentUid);
            } catch (cacheErr) {
                console.warn('[processCapturedPayment] Post-capture cache invalidation warning:', cacheErr);
            }

                // Send notification to staff
                try {
                    const [admins, moderators] = await Promise.all([
                        getUsersByRole('admin'),
                        getUsersByRole('moderator'),
                    ]);
                    const allStaffIds = [
                        ...admins.map((u: any) => u.id || u.uid),
                        ...moderators.map((u: any) => u.id || u.uid),
                    ].filter(Boolean);
                    if (allStaffIds.length > 0) {
                        await Notification.createNotification(
                            {
                                userId: studentUid || enrollmentId || '',
                                userName: actualStudentName,
                                userRole: 'student',
                                employeeId: enrollmentId || '',
                            },
                            {
                                type: 'specific_users',
                                specificUserIds: allStaffIds,
                            },
                            `${actualStudentName} (${enrollmentId || ''}) paid online for a ${durationYears} year(s) renewal and is awaiting approval.`,
                            'Online Renewal Awaiting Approval',
                            { paymentId },
                        );
                    }
                } catch (notifyErr) {
                    console.error('[processCapturedPayment] Failed to notify staff of online renewal request:', notifyErr);
                }

            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment (renewal) returning success.`);
            return { status: 'success' };
        }
    } catch (err: any) {
        if (err.message === 'ALREADY_PROCESSED') {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment returning already_processed`);
            return { status: 'already_processed' };
        }
        if (err.message === 'DUPLICATE_SESSION_PAYMENT') {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] processCapturedPayment DUPLICATE_SESSION_PAYMENT for paymentId: ${paymentId}. Durably recording in ledger as Duplicate_Pending_Refund.`);

            // 1. Durably record in payments ledger so money is never lost or untracked
            let dupRecordedId: string | null = null;
            let dupSessionStart = notes.sessionStartYear ? parseInt(notes.sessionStartYear, 10) : undefined;
            let dupSessionEnd = notes.sessionEndYear ? parseInt(notes.sessionEndYear, 10) : undefined;

            // If notes omitted session years, inherit the session from the student's existing Completed transaction
            if (!dupSessionStart || !dupSessionEnd) {
                const targetUid = notes.userId || notes.studentId || '';
                if (targetUid) {
                    try {
                        const supabase = getSupabaseServer();
                        const query = supabase
                            .from('payments')
                            .select('session_start_year, session_end_year')
                            .eq('student_uid', targetUid)
                            .eq('status', 'Completed');

                        let existingCompleted: any = null;
                        if (typeof (query as any).order === 'function') {
                            const res = await (query as any).order('created_at', { ascending: false }).limit(1).maybeSingle();
                            existingCompleted = res?.data;
                        } else if (typeof (query as any).maybeSingle === 'function') {
                            const res = await (query as any).maybeSingle();
                            existingCompleted = res?.data;
                        } else if (typeof (query as any).single === 'function') {
                            const res = await (query as any).single();
                            existingCompleted = res?.data;
                        }

                        if (existingCompleted?.session_start_year && existingCompleted?.session_end_year) {
                            dupSessionStart = existingCompleted.session_start_year;
                            dupSessionEnd = existingCompleted.session_end_year;
                        }
                    } catch (lookupErr) {
                        console.warn('[processCapturedPayment] Error looking up completed session for duplicate capture:', lookupErr);
                    }
                }
            }

            try {
                dupRecordedId = await paymentsSupabaseService.createDuplicatePaymentRecord({
                    paymentId,
                    studentUid: notes.userId || notes.studentId || '',
                    studentId: notes.enrollmentId || notes.studentId || '',
                    studentName: notes.studentName || notes.userName || 'Student',
                    amount,
                    method,
                    status: 'Duplicate_Pending_Refund',
                    sessionStartYear: dupSessionStart,
                    sessionEndYear: dupSessionEnd,
                    razorpayPaymentId: paymentId,
                    razorpayOrderId: orderId,
                    notes: `Duplicate payment captured for student ${notes.userId || notes.studentId}. Academic session was already covered. Flagged for manual refund review.`
                });
            } catch (dupInsertErr: any) {
                console.error('[processCapturedPayment] Could not insert duplicate payment row:', dupInsertErr?.message);
            }

            // FAIL-CLOSED GUARANTEE: If ledger insertion failed, do NOT return already_paid_for_session
            // because webhook would return HTTP 200 to Razorpay and permanently drop unrecorded money!
            if (!dupRecordedId) {
                console.error(`[processCapturedPayment] CRITICAL: Failed to persist duplicate payment ${paymentId} in ledger. Returning error to trigger provider retry.`);
                return {
                    status: 'error',
                    error: 'Failed to record duplicate payment in financial ledger. Provider retry required.'
                };
            }

            // 2. High-priority audit trail event for financial reconciliation
            try {
                const { createAuditEvent } = await import('@/domains/audit');
                void createAuditEvent({
                    category: 'financial',
                    action: 'duplicate_session_payment_captured',
                    summary: `Duplicate payment ${paymentId} (₹${amount}) captured for student ${notes.userId || notes.studentId}. Recorded as Duplicate_Pending_Refund.`,
                    severity: 'high',
                    actor_id: notes.userId || 'system',
                    actor_name: notes.studentName || 'Student',
                    actor_role: 'system',
                    target_type: 'payment',
                    target_id: paymentId,
                    target_name: orderId,
                    metadata: {
                        paymentId,
                        orderId,
                        amount,
                        notes,
                        source,
                        reason: 'DUPLICATE_SESSION_PAYMENT'
                    }
                });
            } catch (auditErr: any) {
                console.warn('[processCapturedPayment] Could not emit duplicate payment audit event:', auditErr?.message);
            }

            return { status: 'already_paid_for_session' };
        }
        throw err;
    }
}

/**
 * Create a completed offline payment record AT APPROVAL TIME.
 * 
 * ⚠️ CRITICAL: This is the ONLY way offline payments enter the financial ledger.
 * 
 * Offline workflow:
 *   Student submits application → NO payment row
 *   Admin verifies & approves → THIS function creates payment row (status=completed)
 * 
 * The financial ledger contains ONLY verified financial events, not user claims.
 * 
 * @param request - Verified payment details from admin/moderator review
 * @returns The created payment document
 */
export async function createOfflinePaymentAtApproval(
    request: {
        studentId: string;
        studentUid: string;
        studentName: string;
        amount: number;
        durationYears: number;
        sessionStartYear: number;
        sessionEndYear: number;
        validUntil: string;
        /** Student's submitted transaction reference (verified by admin) */
        transactionId: string;
        /** Student's submitted payment date/time (verified by admin) */
        paidAt: Date;
        /** Receipt URL (verified by admin) */
        receipt?: string;
        /** Approver details */
        approverUserId: string;
        approverName: string;
        approverEmpId: string;
        approverRole: string;
        /** Purpose: new_registration or renewal */
        purpose: 'new_registration' | 'renewal';
    }
): Promise<OfflinePaymentDocument> {
    const paymentId = generateOfflinePaymentId(request.purpose);
    const now = new Date();

    // Build the payment document for return
    const paymentDoc: OfflinePaymentDocument = {
        paymentId,
        studentId: request.studentId,
        studentUid: request.studentUid,
        studentName: request.studentName,
        amount: request.amount,
        durationYears: request.durationYears,
        method: 'Offline',
        status: 'Completed',
        sessionStartYear: request.sessionStartYear,
        sessionEndYear: request.sessionEndYear,
        validUntil: request.validUntil,
        createdAt: now,
        updatedAt: now,
        offlineTransactionId: request.transactionId,
        approvedBy: {
            type: 'Manual',
            userId: request.approverUserId,
            name: request.approverName,
            empId: request.approverEmpId,
            role: request.approverRole as 'Admin' | 'Moderator',
        },
        approvedAt: now,
    };

    // Write COMPLETED payment to Supabase (immutable financial record)
    const result = await paymentsSupabaseService.createPayment({
        paymentId,
        studentId: request.studentId,
        studentUid: request.studentUid,
        studentName: request.studentName,
        amount: request.amount,
        method: 'Offline',
        status: 'Completed',
        sessionStartYear: request.sessionStartYear,
        sessionEndYear: request.sessionEndYear,
        durationYears: request.durationYears,
        validUntil: new Date(request.validUntil),
        transactionDate: request.paidAt,
        offlineTransactionId: request.transactionId,
        approvedBy: {
            type: 'Manual',
            userId: request.approverUserId,
            name: request.approverName,
            empId: request.approverEmpId,
            role: request.approverRole,
        },
        approvedAt: now,
    });

    if (!result) {
        throw new Error(`Failed to create offline payment ledger record at approval: ${paymentId}`);
    }

    return paymentDoc;
}

export async function applyPaymentValidityToStudent(payment: PaymentRecord): Promise<void> {
    if (!payment.student_uid) return;

    await applyPaymentValidity(payment.student_uid, {
        valid_until: payment.valid_until,
        session_start_year: payment.session_start_year,
        session_end_year: payment.session_end_year,
    });
}

/**
 * Recover and reconcile missing or failed transit entitlements
 * for an already-Completed payment record.
 * 
 * Invariants:
 * - Does not alter financial status or amounts (protect_completed_payments compliance).
 * - Idempotently applies student validity extension.
 * - Updates metadata.entitlement_status to 'active' or records failed retry attempt.
 */
export async function recoverPaymentEntitlement(
    payment: PaymentRecord
): Promise<{ success: boolean; error?: string; alreadyClaimed?: boolean; pendingSubmission?: boolean; prolonged?: boolean; claimError?: boolean }> {
    if (payment.status !== 'Completed') {
        return { success: false, error: 'Cannot recover entitlement for non-completed payment' };
    }

    // CROSS-INSTANCE LEASE COORDINATION: Atomically claim work to prevent concurrent workers from colliding
    let claimToken: string | undefined;
    if (typeof paymentsSupabaseService.claimPaymentForEntitlementRecovery === 'function') {
        const claimResult = await paymentsSupabaseService.claimPaymentForEntitlementRecovery(payment.payment_id);
        const isClaimed = typeof claimResult === 'boolean' ? claimResult : Boolean(claimResult?.claimed);
        if (!isClaimed) {
            if (typeof claimResult === 'object' && (claimResult as any)?.error) {
                // Database or connection error during claim — distinguish from active lease
                return { success: false, error: (claimResult as any).error?.message || String((claimResult as any).error), claimError: true };
            }
            // Already active or claimed by another concurrent worker instance
            return { success: true, alreadyClaimed: true };
        }
        if (typeof claimResult === 'object' && claimResult?.leaseTime) {
            claimToken = claimResult.leaseTime;
        }
    }

    try {
        const appId = payment.metadata?.application_id || payment.student_uid || payment.student_id;
        const entStatus = payment.metadata?.entitlement_status;

        // If payment was made before application submission, check if application has now been submitted
        if (entStatus === 'pending_registration_submission') {
            let app = appId ? await getApplicationById(String(appId)).catch(() => null) : null;
            if (!app && payment.student_uid) {
                app = await getByApplicantUid(payment.student_uid).catch(() => null);
            }
            if (!app) {
                // Application form has not yet been submitted by the student.
                // Maintain pending_registration_submission, release recovering lease, and wait for future sweep.
                // Returns success: false, pendingSubmission: true so it is NOT counted as recovered while remaining pending.
                await paymentsSupabaseService.updatePaymentMetadata?.(
                    payment.payment_id,
                    {
                        entitlement_status: 'pending_registration_submission',
                        recovering_since: null,
                    },
                    claimToken ? { expectedClaimTime: claimToken } : undefined
                );
                return { success: false, pendingSubmission: true };
            }
        }

        if (payment.student_uid) {
            await applyPaymentValidityToStudent(payment);
        }

        const updateOptions = claimToken ? { expectedClaimTime: claimToken } : undefined;
        let updateSuccess: boolean | undefined = true;
        if (updateOptions) {
            updateSuccess = await paymentsSupabaseService.updatePaymentMetadata?.(
                payment.payment_id,
                {
                    entitlement_status: 'active',
                    entitlement_synced_at: new Date().toISOString(),
                    recovering_since: null,
                },
                updateOptions
            );
        } else {
            updateSuccess = await paymentsSupabaseService.updatePaymentMetadata?.(
                payment.payment_id,
                {
                    entitlement_status: 'active',
                    entitlement_synced_at: new Date().toISOString(),
                    recovering_since: null,
                }
            );
        }

        if (updateSuccess === false) {
            // Conditional update matched 0 rows (lease expired and acquired by newer worker)
            return { success: false, error: 'Lost lease or concurrent update collision' };
        }

        await createAuditEvent({
            action: 'payment_entitlement_recovered',
            actor_id: 'system:reconciliation_sweep',
            actor_name: 'System Sweep',
            actor_role: 'system',
            target_id: payment.payment_id,
            target_type: 'payment',
            target_name: payment.student_name || payment.student_uid || payment.payment_id,
            category: 'financial',
            severity: 'low',
            summary: `Entitlement successfully recovered and synchronized for completed payment ${payment.payment_id}`,
            metadata: {
                paymentId: payment.payment_id,
                studentUid: payment.student_uid,
                sessionStartYear: payment.session_start_year,
                sessionEndYear: payment.session_end_year,
            },
        });

        return { success: true };
    } catch (err: any) {
        console.error(`[recoverPaymentEntitlement] Failed to recover entitlement for ${payment.payment_id}:`, err);
        const currentRetries = (payment.metadata?.entitlement_retry_count as number) || 0;
        const nextRetryMs = Math.min(24 * 3600 * 1000, Math.pow(2, Math.min(currentRetries, 6)) * 60 * 1000);
        const isProlonged = currentRetries + 1 >= 5;
        const errMetadata: Record<string, unknown> = {
            entitlement_status: 'failed',
            entitlement_error: err?.message || String(err),
            entitlement_failed_at: new Date().toISOString(),
            entitlement_retry_count: currentRetries + 1,
            next_retry_after: new Date(Date.now() + nextRetryMs).toISOString(),
            recovering_since: null,
            ...(isProlonged && { prolonged_unresolved: true }),
        };

        if (isProlonged) {
            console.error(`[recoverPaymentEntitlement] PROLONGED UNRESOLVED: Payment ${payment.payment_id} has failed ${currentRetries + 1} times. Flagging for administrative inspection.`);
        }

        if (claimToken) {
            await paymentsSupabaseService.updatePaymentMetadata?.(
                payment.payment_id,
                errMetadata,
                { expectedClaimTime: claimToken }
            ).catch(() => null);
        } else {
            await paymentsSupabaseService.updatePaymentMetadata?.(
                payment.payment_id,
                errMetadata
            ).catch(() => null);
        }

        return { success: false, error: err?.message || String(err), prolonged: isProlonged };
    }
}

async function requireSecuredReceiptSignature(payment: PaymentRecord): Promise<void> {
    const signatureResult = await ensureReceiptSignature(payment);
    if (!signatureResult.ok) {
        throw new Error(`Payment receipt signature could not be secured (${signatureResult.status})`);
    }
}

// ============================================================================
// PAYMENT APPROVAL/REJECTION - NOW USES SUPABASE
// ============================================================================

/**
 * Approve an offline payment (IDEMPOTENT + ATOMIC)
 * Updates payment status in Supabase and student validity in Firestore
 * 
 * ✅ PAYMENT STATUS IN SUPABASE, STUDENT UPDATE IN FIRESTORE
 * ✅ IDEMPOTENT: If already Completed, returns success
 * ✅ ATOMIC: Supabase WHERE status='Pending' prevents race conditions
 */
export async function approveOfflinePayment(
    request: ApprovePaymentRequest
): Promise<{ success: boolean; payment?: PaymentDocument; error?: string }> {
    try {
        // Get payment from Supabase first
        const payment = await paymentsSupabaseService.getPaymentById(request.paymentId);

        if (!payment) {
            throw new Error('Payment not found in Supabase');
        }

        // IDEMPOTENT: If already completed, return success
        if (payment.status === 'Completed') {
            await applyPaymentValidityToStudent(payment);
            // Receipt signature is secondary — log failure but don't throw
            try {
                await requireSecuredReceiptSignature(payment);
            } catch (sigErr: any) {
                console.error(`⚠️ Receipt signature failed for already-completed payment ${request.paymentId}:`, sigErr.message);
            }
            return {
                success: true,
                payment: mapSupabaseToFirestoreFormat(payment),
            };
        }

        // Cannot approve rejected payments — must be re-submitted
        if (payment.status === 'Rejected') {
            throw new Error('Cannot approve a rejected payment. Student must re-submit.');
        }

        if (payment.method !== 'Offline') {
            throw new Error('Cannot manually approve online payments');
        }

        // LC-01 GUARD: Check if student seat was released during soft-block.
        // If seat was released, offline payment approval cannot reactivate the student without
        // reclaiming a bus seat — must go through Renewal Approval (approve_renewal_with_seat).
        if (payment.student_uid) {
            const student = await getStudentByUid(payment.student_uid);
            if (student && (student as any).seatReleasedAt) {
                return {
                    success: false,
                    error: `Student ${payment.student_uid} seat was released during soft-block. Payment cannot be approved directly without seat allocation. Please process via Renewal Approval (approve_renewal_with_seat).`
                };
            }
        }

        // ATOMIC: Update payment status in Supabase (WHERE status='Pending')
        const updateSuccess = await paymentsSupabaseService.updatePaymentStatus(
            request.paymentId,
            'Completed',
            {
                userId: request.approverUserId,
                name: request.approverName,
                empId: request.approverEmpId,
                role: request.approverRole,
            }
        );

        if (!updateSuccess) {
            // Another request likely approved/rejected it first (race condition handled)
            throw new Error('Payment was already processed by another approver');
        }

        // State is atomically confirmed Completed by updatePaymentStatus CAS check
        const completedPayment: PaymentRecord = {
            ...payment,
            status: 'Completed',
            approved_by: {
                type: request.approverRole?.toLowerCase() === 'admin' ? 'admin' : 'moderator',
                userId: request.approverUserId,
                empId: request.approverEmpId,
                name: request.approverName,
                role: request.approverRole,
            },
            approved_at: new Date().toISOString(),
        };

        // Update student document validity in Firestore safely via helper.
        // Retry up to 3 times — if this fails, the payment is Completed but the
        // student's validity was never extended. The admin must manually renew.
        if (completedPayment.student_uid) {
            let studentUpdated = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await applyPaymentValidityToStudent(completedPayment);
                    studentUpdated = true;
                    console.log(`✅ Success: Student ${payment.student_uid.substring(0,8)}... validity updated securely (attempt ${attempt}).`);
                    await paymentsSupabaseService.updatePaymentMetadata?.(completedPayment.payment_id, {
                        entitlement_status: 'active',
                        entitlement_synced_at: new Date().toISOString(),
                    }).catch(() => null);
                    break;
                } catch (studentErr: any) {
                    console.error(`❌ Attempt ${attempt}/3: Failed to update student ${completedPayment.student_uid.substring(0,8)}... validity:`, studentErr.message);
                    if (studentErr instanceof SeatReclaimRequiredError || studentErr?.name === 'SeatReclaimRequiredError') {
                        break;
                    }
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
            }
            if (!studentUpdated) {
                console.error(`🔴 CRITICAL: Payment ${request.paymentId} is Completed but student ${completedPayment.student_uid.substring(0,8)}... validity was NOT updated after 3 attempts. Admin must manually renew.`);
                await paymentsSupabaseService.updatePaymentMetadata?.(completedPayment.payment_id, {
                    entitlement_status: 'failed',
                    entitlement_failed_at: new Date().toISOString(),
                    entitlement_error: 'Student validity update failed after 3 retries',
                }).catch(() => null);

                // Write a PostgreSQL audit event so the next cron, admin scan, or
                // reconciliation pass can identify and repair this diverged state.
                try {
                    await createAuditEvent({
                        action: 'PAYMENT_VALIDITY_SYNC_FAILED',
                        category: 'payment',
                        severity: 'high',
                        summary: `Payment ${request.paymentId} completed but student ${completedPayment.student_uid} validity update failed after 3 retries.`,
                        actor_id: 'system',
                        actor_name: 'System',
                        actor_role: 'admin',
                        target_type: 'payment',
                        target_id: request.paymentId,
                        target_name: request.paymentId,
                        metadata: {
                            paymentId: request.paymentId,
                            studentUid: completedPayment.student_uid,
                            paymentStatus: 'Completed',
                            error: 'Student validity update failed after 3 retries',
                            recovered: false,
                        }
                    });
                } catch (outboxErr) {
                    console.error('CRITICAL: Could not write audit_failure outbox for payment', request.paymentId.substring(0, 8) + '...', outboxErr);
                }
            }
        }

        // Receipt signature is secondary — log failure but don't throw
        try {
            await requireSecuredReceiptSignature(completedPayment);
        } catch (sigErr: any) {
            console.error(`⚠️ Receipt signature failed for payment ${request.paymentId}:`, sigErr.message);
        }

        await createAuditEvent({
            action: 'payment_approved',
            actor_id: request.approverUserId,
            actor_name: request.approverName || '',
            actor_role: request.approverRole?.toLowerCase() || 'admin',
            target_id: request.paymentId,
            target_type: 'payment',
            target_name: completedPayment.student_name || '',
            category: 'renewals',
            summary: 'Payment approved for ' + (completedPayment.student_name || ''),
            severity: 'medium',
            metadata: {
                before: { status: 'Pending', amount: payment.amount },
                after: { status: 'Completed', amount: completedPayment.amount, validUntil: completedPayment.valid_until },
                studentUid: completedPayment.student_uid,
                empId: request.approverEmpId,
                reason: 'manual_offline_approval',
            },
        });

        // Return compatible format
        return {
            success: true,
            payment: {
                paymentId: completedPayment.payment_id,
                studentId: completedPayment.student_id || '',
                studentUid: completedPayment.student_uid || '',
                studentName: completedPayment.student_name || '',
                amount: completedPayment.amount || 0,
                durationYears: completedPayment.duration_years || 1,
                method: completedPayment.method as 'Online' | 'Offline',
                status: 'Completed',
                sessionStartYear: completedPayment.session_start_year || new Date().getFullYear(),
                sessionEndYear: completedPayment.session_end_year || new Date().getFullYear() + 1,
                validUntil: completedPayment.valid_until || '',
                createdAt: new Date(completedPayment.transaction_date || Date.now()),
                updatedAt: new Date(),
            } as PaymentDocument
        };
    } catch (error) {
        console.error(`❌ Error approving payment ${request.paymentId}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Reject an offline payment (ATOMIC)
 * 
 * ✅ IMMUTABLE: Payment record is preserved — status transitions to 'Rejected'
 * ✅ ATOMIC: Supabase WHERE status='Pending' prevents race conditions
 * ✅ AUDIT: Rejector info stored on the record
 */
export async function rejectOfflinePayment(
    request: RejectPaymentRequest
): Promise<{ success: boolean; error?: string }> {
    try {
        // Get payment from Supabase first
        const payment = await paymentsSupabaseService.getPaymentById(request.paymentId);

        if (!payment) {
            throw new Error('Payment not found');
        }

        if (payment.status === 'Completed') {
            throw new Error('Cannot reject completed payment');
        }

        // IDEMPOTENT: If already rejected, return success
        if (payment.status === 'Rejected') {
            console.log(`ℹ️ Payment ${request.paymentId} already rejected (idempotent success)`);
            return { success: true };
        }

        if (payment.method !== 'Offline') {
            throw new Error('Cannot reject online payments');
        }

        // ATOMIC: Update payment status to 'Rejected' (WHERE status='Pending')
        // Payment record is preserved — NO deletions (immutable ledger)
        const updateSuccess = await paymentsSupabaseService.updatePaymentStatus(
            request.paymentId,
            'Rejected',
            {
                userId: request.rejectorUserId,
                name: request.rejectorName,
                empId: request.rejectorEmpId,
                role: request.rejectorRole,
            }
        );

        if (!updateSuccess) {
            // Another request likely approved/rejected it first (race condition handled)
            throw new Error('Payment was already processed by another reviewer');
        }

        console.log(`🗑️ Payment ${request.paymentId.substring(0,8)}... rejected by ${request.rejectorName?.substring(0,8) || 'admin'}...`);

        await createAuditEvent({
            action: 'payment_rejected',
            actor_id: request.rejectorUserId,
            actor_name: request.rejectorName || '',
            actor_role: request.rejectorRole?.toLowerCase() || 'admin',
            target_id: request.paymentId,
            target_type: 'payment',
            target_name: payment.student_name || '',
            category: 'renewals',
            summary: 'Payment rejected for ' + (payment.student_name || ''),
            severity: 'medium',
            metadata: {
                before: { status: 'Pending', amount: payment.amount },
                after: { status: 'Rejected' },
                studentUid: payment.student_uid,
                empId: request.rejectorEmpId,
                reason: 'manual_offline_rejection',
            },
        });

        return { success: true };
    } catch (error) {
        console.error(`❌ Error processing rejection for ${request.paymentId}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Controlled administrative reconciliation of an unresolved capture.
 * Transitions: Captured_Pending_Review → Completed.
 *
 * Operational Guarantees:
 * 1. Requires verified administrator actor.
 * 2. Validates session boundaries (start < end, start >= 2000).
 * 3. Atomic conditional database update in Supabase (with check against duplicate session completion).
 * 4. Activates student transit entitlement EXACTLY ONCE and ONLY AFTER durable persistence succeeds.
 * 5. Emits immutable high-severity audit event.
 */
export async function reconcileUnresolvedCapture(request: {
    paymentId: string;
    sessionStartYear: number;
    sessionEndYear: number;
    reconcilerUserId: string;
    reconcilerName: string;
    reconcilerRole: string;
    reconcilerEmpId?: string;
    evidence: string;
}): Promise<{ success: boolean; error?: string; payment?: any }> {
    if (request.reconcilerRole?.toLowerCase() !== 'admin') {
        return { success: false, error: 'Only authorized administrators may reconcile unresolved captured payments.' };
    }

    if (!request.evidence || !request.evidence.trim()) {
        return { success: false, error: 'Explicit audit evidence is mandatory for payment reconciliation.' };
    }

    if (!request.sessionStartYear || !request.sessionEndYear || request.sessionStartYear >= request.sessionEndYear || request.sessionStartYear < 2000) {
        return { success: false, error: 'Invalid session boundaries: sessionStartYear must be strictly less than sessionEndYear and at least 2000.' };
    }

    try {
        const deadlineConfig = await getDeadlineConfig();
        const durationYears = request.sessionEndYear - request.sessionStartYear;
        const validUntil = calculateValidUntilDate(request.sessionStartYear, durationYears, deadlineConfig);

        // 1. Execute durable database transition in Supabase ledger
        const reconcileRes = await paymentsSupabaseService.reconcileCapturedPendingReviewPayment({
            paymentId: request.paymentId,
            sessionStartYear: request.sessionStartYear,
            sessionEndYear: request.sessionEndYear,
            actor: {
                userId: request.reconcilerUserId,
                name: request.reconcilerName,
                role: request.reconcilerRole,
                empId: request.reconcilerEmpId,
            },
            reconciliationEvidence: request.evidence,
            validUntil,
        });

        if (!reconcileRes.success || !reconcileRes.payment) {
            return {
                success: false,
                error: reconcileRes.error || 'Failed to reconcile payment in ledger',
            };
        }

        const completedPayment = reconcileRes.payment;

        // 2. Activate transit entitlement EXACTLY ONCE and ONLY AFTER durable persistence succeeded
        if (completedPayment.student_uid) {
            try {
                await applyPaymentValidityToStudent(completedPayment);
                await paymentsSupabaseService.updatePaymentMetadata?.(completedPayment.payment_id, {
                    entitlement_status: 'active',
                    entitlement_synced_at: new Date().toISOString(),
                }).catch(() => null);
            } catch (entitlementErr: any) {
                console.error(`[reconcileUnresolvedCapture] Entitlement sync failed for ${completedPayment.student_uid}:`, entitlementErr);
                await paymentsSupabaseService.updatePaymentMetadata?.(completedPayment.payment_id, {
                    entitlement_status: 'failed',
                    entitlement_failed_at: new Date().toISOString(),
                    entitlement_error: entitlementErr?.message || String(entitlementErr),
                }).catch(() => null);
                // Ledger record is already Completed; log audit alert for admin visibility
            }
        }

        // 3. Emit immutable audit event
        await createAuditEvent({
            action: 'payment_reconciled',
            actor_id: request.reconcilerUserId,
            actor_name: request.reconcilerName,
            actor_role: 'admin',
            target_id: request.paymentId,
            target_type: 'payment',
            target_name: completedPayment.student_name || request.paymentId,
            category: 'renewals',
            severity: 'high',
            summary: `Payment ${request.paymentId} reconciled to session ${request.sessionStartYear}–${request.sessionEndYear} for ${completedPayment.student_name || completedPayment.student_uid}`,
            metadata: {
                paymentId: request.paymentId,
                before: { status: 'Captured_Pending_Review' },
                after: {
                    status: 'Completed',
                    sessionStartYear: request.sessionStartYear,
                    sessionEndYear: request.sessionEndYear,
                },
                studentUid: completedPayment.student_uid,
                evidence: request.evidence,
                reconcilerUserId: request.reconcilerUserId,
            },
        });

        return {
            success: true,
            payment: completedPayment,
        };
    } catch (err: any) {
        console.error(`[reconcileUnresolvedCapture] Error reconciling ${request.paymentId}:`, err);
        return { success: false, error: err?.message || 'Unknown reconciliation error' };
    }
}

/**
 * Confirm an external refund executed by University Finance.
 * Allowed from Duplicate_Pending_Refund or Captured_Pending_Review.
 */
export async function confirmManualRefund(request: {
    paymentId: string;
    refundReference: string;
    refundedAmount: number;
    authorizerUserId: string;
    authorizerName: string;
    authorizerRole: string;
    empId?: string;
    reason: string;
}): Promise<{ success: boolean; error?: string; isPartial?: boolean; cumulativeRefunded?: number }> {
    if (request.authorizerRole?.toLowerCase() !== 'admin') {
        return { success: false, error: 'Only administrators / finance officers may confirm external refunds.' };
    }

    try {
        const result = await paymentsSupabaseService.confirmManualRefundRecord({
            paymentId: request.paymentId,
            refundReference: request.refundReference,
            refundedAmount: request.refundedAmount,
            authorizedBy: {
                userId: request.authorizerUserId,
                name: request.authorizerName,
                role: request.authorizerRole,
                empId: request.empId,
            },
            reason: request.reason,
        });

        if (!result.success) {
            return result;
        }

        const isPartial = !!result.isPartial;
        const cumulativeRefunded = result.cumulativeRefunded;

        await createAuditEvent({
            action: isPartial ? 'payment_partially_refunded' : 'payment_refunded',
            actor_id: request.authorizerUserId,
            actor_name: request.authorizerName,
            actor_role: 'admin',
            target_id: request.paymentId,
            target_type: 'payment',
            target_name: request.paymentId,
            category: 'finance',
            severity: 'high',
            summary: isPartial
                ? `Payment ${request.paymentId} partially refunded: Rs. ${request.refundedAmount} (Cumulative: Rs. ${cumulativeRefunded}, Reference: ${request.refundReference})`
                : `Payment ${request.paymentId} confirmed as fully refunded (Reference: ${request.refundReference})`,
            metadata: {
                paymentId: request.paymentId,
                refundReference: request.refundReference,
                refundedAmount: request.refundedAmount,
                cumulativeRefunded,
                isPartial,
                reason: request.reason,
            },
        });

        return { success: true, isPartial, cumulativeRefunded };
    } catch (err: any) {
        console.error(`[confirmManualRefund] Error:`, err);
        return { success: false, error: err?.message || 'Unknown error confirming refund' };
    }
}

/**
 * Deny a refund claim for a captured transaction (retaining captured money in university ledger).
 * Allowed from Duplicate_Pending_Refund or Captured_Pending_Review.
 */
export async function denyManualRefund(request: {
    paymentId: string;
    denierUserId: string;
    denierName: string;
    denierRole: string;
    reason: string;
}): Promise<{ success: boolean; error?: string }> {
    if (request.denierRole?.toLowerCase() !== 'admin') {
        return { success: false, error: 'Only administrators may deny refund claims.' };
    }

    if (!request.reason || !request.reason.trim()) {
        return { success: false, error: 'Mandatory audit denial reason is required to deny refund request.' };
    }

    try {
        const result = await paymentsSupabaseService.denyRefundRecord({
            paymentId: request.paymentId,
            deniedBy: {
                userId: request.denierUserId,
                name: request.denierName,
                role: request.denierRole,
            },
            denialReason: request.reason,
        });

        if (!result.success) {
            return result;
        }

        await createAuditEvent({
            action: 'payment_refund_denied',
            actor_id: request.denierUserId,
            actor_name: request.denierName,
            actor_role: 'admin',
            target_id: request.paymentId,
            target_type: 'payment',
            target_name: request.paymentId,
            category: 'finance',
            severity: 'high',
            summary: `Refund request for payment ${request.paymentId} denied. Funds retained in ledger.`,
            metadata: {
                paymentId: request.paymentId,
                reason: request.reason,
                deniedBy: request.denierUserId,
            },
        });

        return { success: true };
    } catch (err: any) {
        console.error(`[denyManualRefund] Error:`, err);
        return { success: false, error: err?.message || 'Unknown error denying refund' };
    }
}

// ============================================================================
// PAYMENT QUERIES - NOW FROM SUPABASE
// ============================================================================

/**
 * Get payments for a specific student from Supabase
 * Merges results from UID and Enrollment ID lookups
 * Supports pagination for student-facing endpoints
 */
export async function getPaymentsByStudent(
  studentUid: string,
  studentId?: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{ payments: PaymentDocument[]; total: number }> {
    const allPayments: PaymentDocument[] = [];
    const fetchedPaymentIds = new Set<string>();

    // 1. Fetch by UID
    const paymentsByUid = await paymentsSupabaseService.getPaymentsByStudentUid(studentUid, { limit: pageSize, offset: (page - 1) * pageSize });
    const mappedByUid = paymentsByUid.map(mapSupabaseToFirestoreFormat);

    for (const p of mappedByUid) {
        if (!fetchedPaymentIds.has(p.paymentId)) {
            fetchedPaymentIds.add(p.paymentId);
            allPayments.push(p);
        }
    }

    // 2. Fetch by Enrollment ID if available (resolved via Student domain API)
    if (studentId) {
        let resolvedUid: string | null = null;
        try {
            const student = await getStudentByEnrollmentId(studentId);
            if (student) {
                resolvedUid = (student as any).uid || (student as any).id;
            }
        } catch (e) {
            console.error('Error resolving studentId in getPaymentsByStudent:', e);
        }

        if (resolvedUid && resolvedUid !== studentUid) {
            const paymentsById = await paymentsSupabaseService.getPaymentsByStudentUid(resolvedUid, { limit: pageSize, offset: (page - 1) * pageSize });
            const mappedById = paymentsById.map(mapSupabaseToFirestoreFormat);

            for (const p of mappedById) {
                if (!fetchedPaymentIds.has(p.paymentId)) {
                    fetchedPaymentIds.add(p.paymentId);
                    allPayments.push(p);
                }
            }
        }
    }

    // Sort by date (newest first)
    allPayments.sort((a, b) => {
        const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return timeB - timeA;
    });

    // Pagination
    const total = allPayments.length;
    const offset = (page - 1) * pageSize;
    const paginatedPayments = allPayments.slice(offset, offset + pageSize);

    return { payments: paginatedPayments, total };
}

/**
 * Get all payments with filters (for admin/moderator) from Supabase
 */
export async function getAllPayments(
    filters?: PaymentQueryFilters,
    page: number = 1,
    pageSize: number = 20
): Promise<PaginatedPaymentResponse> {
    // Strategy: Result merging
    // If we have studentUid OR studentId filters, we want to fetch from specific indices
    // and merge the results to ensure we catch all payments (created with either ID)
    if (filters?.studentUid || filters?.studentId) {
        const allPayments: PaymentDocument[] = [];
        const fetchedPaymentIds = new Set<string>();

        // 1. Fetch by UID if available
        if (filters.studentUid) {
            const paymentsByUid = await paymentsSupabaseService.getPaymentsByStudentUid(filters.studentUid);
            const mappedByUid = paymentsByUid.map(mapSupabaseToFirestoreFormat);

            for (const p of mappedByUid) {
                if (!fetchedPaymentIds.has(p.paymentId)) {
                    fetchedPaymentIds.add(p.paymentId);
                    allPayments.push(p);
                }
            }
        }

        // 2. Fetch by Enrollment ID if available (resolved via Student domain API)
        if (filters.studentId) {
            let resolvedUid: string | null = null;
            try {
                const student = await getStudentByEnrollmentId(filters.studentId);
                if (student) {
                    resolvedUid = (student as any).uid || (student as any).id;
                }
            } catch (e) {
                console.error('Error resolving studentId in getAllPayments:', e);
            }

            if (resolvedUid && resolvedUid !== filters.studentUid) {
                const paymentsById = await paymentsSupabaseService.getPaymentsByStudentUid(resolvedUid);
                const mappedById = paymentsById.map(mapSupabaseToFirestoreFormat);

                for (const p of mappedById) {
                    if (!fetchedPaymentIds.has(p.paymentId)) {
                        fetchedPaymentIds.add(p.paymentId);
                        allPayments.push(p);
                    }
                }
            }
        }

        // 3. Apply memory-side filtering (year, method, status)
        let filtered = allPayments;

        if (filters.year) {
            filtered = filtered.filter(p => p.sessionStartYear === filters.year);
        }
        if (filters.method) {
            filtered = filtered.filter(p => p.method === filters.method);
        }
        if (filters.status) {
            filtered = filtered.filter(p => p.status === filters.status);
        }

        // 4. Sort by date (newest first)
        filtered.sort((a, b) => {
            const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
            const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
            return timeB - timeA;
        });

        // 5. Pagination
        const total = filtered.length;
        const totalPages = Math.ceil(total / pageSize);
        const offset = (page - 1) * pageSize;
        const paginatedPayments = filtered.slice(offset, offset + pageSize);

        return {
            payments: paginatedPayments,
            total,
            page,
            pageSize,
            totalPages,
        };
    }
    // Otherwise, use server-side paginated payments
    const result = await paymentsSupabaseService.getPaginatedPayments(filters || {}, page, pageSize);

    // Apply filters manually
    const mapped = result.payments.map(mapSupabaseToFirestoreFormat);

    return {
        payments: mapped,
        total: result.total,
        page,
        pageSize,
        totalPages: Math.ceil(result.total / pageSize),
    };
}

/**
 * Get pending offline payments (for approval queue) from Supabase
 */
export async function getPendingPayments(): Promise<OfflinePaymentDocument[]> {
    const payments = await paymentsSupabaseService.getPendingPayments();
    return payments.map(p => mapSupabaseToFirestoreFormat(p) as OfflinePaymentDocument);
}

/**
 * Get payment by ID from Supabase
 */
export async function getPaymentById(paymentId: string): Promise<PaymentDocument | null> {
    const payment = await paymentsSupabaseService.getPaymentById(paymentId);
    if (!payment) return null;
    return mapSupabaseToFirestoreFormat(payment);
}

/**
 * Get payment details for modal display
 */
export async function getPaymentDetails(paymentId: string): Promise<PaymentDetailModalData | null> {
    const payment = await getPaymentById(paymentId);

    if (!payment) {
        return null;
    }

    const createdAt = payment.createdAt instanceof Date
        ? payment.createdAt
        : new Date(payment.createdAt as string);

    const updatedAt = payment.updatedAt instanceof Date
        ? payment.updatedAt
        : new Date(payment.updatedAt as string);

    const validUntil = typeof payment.validUntil === 'string'
        ? new Date(payment.validUntil)
        : payment.validUntil instanceof Date
            ? payment.validUntil
            : new Date();

    const detailData: PaymentDetailModalData = {
        studentName: payment.studentName,
        studentId: payment.studentId,
        studentUid: payment.studentUid,
        paymentId: payment.paymentId,
        amount: payment.amount,
        durationYears: payment.durationYears,
        method: payment.method,
        status: payment.status,
        sessionStartYear: payment.sessionStartYear,
        sessionEndYear: payment.sessionEndYear,
        validUntil,
        createdAt,
        updatedAt,
    };

    if (isOfflinePayment(payment)) {
        detailData.offlineTransactionId = payment.offlineTransactionId;

        if (payment.approvedBy && payment.approvedBy.type === 'Manual') {
            const approvedAt = payment.approvedAt instanceof Date
                ? payment.approvedAt
                : new Date(payment.approvedAt as string);

            detailData.approver = {
                name: payment.approvedBy.name,
                empId: payment.approvedBy.empId,
                role: payment.approvedBy.role,
                approvedAt,
            };
        }
    } else if (isOnlinePayment(payment)) {
        detailData.razorpayPaymentId = payment.razorpayPaymentId;
    }

    return detailData;
}

// ============================================================================
// IDEMPOTENCY CHECK
// ============================================================================

/**
 * Check if a payment has already been processed (idempotency check).
 * Canonical implementation — used by webhook and verify-payment routes.
 */
export async function isPaymentProcessed(paymentId: string): Promise<boolean> {
    const isRazorpayId = paymentId.startsWith('pay_') && !paymentId.startsWith('pay_online_');
    if (isRazorpayId) {
        const paymentByRazorpay = await paymentsSupabaseService.getPaymentByRazorpayId(paymentId);
        if (
            paymentByRazorpay?.status === 'Completed' ||
            paymentByRazorpay?.status === 'Duplicate_Pending_Refund' ||
            paymentByRazorpay?.status === 'Captured_Pending_Review'
        ) return true;
        const payment = await paymentsSupabaseService.getPaymentById(paymentId);
        return (
            payment?.status === 'Completed' ||
            payment?.status === 'Duplicate_Pending_Refund' ||
            payment?.status === 'Captured_Pending_Review'
        );
    }

    // 1. Check by Primary ID (Supabase)
    const payment = await paymentsSupabaseService.getPaymentById(paymentId);
    if (
        payment?.status === 'Completed' ||
        payment?.status === 'Duplicate_Pending_Refund' ||
        payment?.status === 'Captured_Pending_Review'
    ) return true;

    // 2. Check by Razorpay ID (Supabase) - In case paymentId passed is a Razorpay ID
    const paymentByRazorpay = await paymentsSupabaseService.getPaymentByRazorpayId(paymentId);
    if (
        paymentByRazorpay?.status === 'Completed' ||
        paymentByRazorpay?.status === 'Duplicate_Pending_Refund' ||
        paymentByRazorpay?.status === 'Captured_Pending_Review'
    ) return true;

    return false;
}

// ============================================================================
// HELPER: Map Supabase format to Firestore format for backwards compatibility
// ============================================================================

function mapSupabaseToFirestoreFormat(p: PaymentRecord): PaymentDocument {
    return {
        paymentId: p.payment_id,
        studentId: p.student_id || '',
        studentUid: p.student_uid || '',
        studentName: p.student_name || '',
        amount: p.amount || 0,
        durationYears: p.duration_years || 1,
        method: p.method || 'Offline',
        status: p.status || 'Pending',
        sessionStartYear: p.session_start_year || new Date().getFullYear(),
        sessionEndYear: p.session_end_year || new Date().getFullYear() + 1,
        validUntil: p.valid_until || '',
        createdAt: p.transaction_date ? new Date(p.transaction_date) : (p.created_at ? new Date(p.created_at) : new Date()),
        updatedAt: p.transaction_date ? new Date(p.transaction_date) : (p.created_at ? new Date(p.created_at) : new Date()),
        ...(p.method === 'Offline' && {
            offlineTransactionId: p.offline_transaction_id,
        }),
        ...(p.method === 'Online' && {
            razorpayPaymentId: p.razorpay_payment_id,
            razorpayOrderId: p.razorpay_order_id,
        }),
        ...(p.approved_by && {
            approvedBy: p.approved_by,
            approvedAt: p.approved_at ? new Date(p.approved_at) : undefined,
        }),
    } as PaymentDocument;
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Convert PaymentDocument to PaymentDisplayData for UI
 */
export function toDisplayData(payment: PaymentDocument): PaymentDisplayData {
    const createdAt = payment.createdAt instanceof Date
        ? payment.createdAt
        : new Date(payment.createdAt as string);

    const validUntil = typeof payment.validUntil === 'string'
        ? new Date(payment.validUntil)
        : payment.validUntil instanceof Date
            ? payment.validUntil
            : new Date();

    const displayData: PaymentDisplayData = {
        paymentId: payment.paymentId,
        studentName: payment.studentName,
        studentId: payment.studentId,
        amount: payment.amount,
        method: payment.method,
        status: payment.status,
        durationYears: payment.durationYears,
        validUntil,
        createdAt,
    };

    if (isOfflinePayment(payment) && payment.approvedBy?.type === 'Manual') {
        displayData.approverName = payment.approvedBy.name;
        displayData.approverEmpId = payment.approvedBy.empId;
        displayData.approverRole = payment.approvedBy.role;

        if (payment.approvedAt) {
            displayData.approvedAt = payment.approvedAt instanceof Date
                ? payment.approvedAt
                : new Date(payment.approvedAt as string);
        }

        displayData.offlineTransactionId = payment.offlineTransactionId;
    }

    if (isOnlinePayment(payment)) {
        displayData.razorpayPaymentId = payment.razorpayPaymentId;
    }

    return displayData;
}
