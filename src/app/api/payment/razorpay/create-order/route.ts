import { getSystemConfig } from '@/domains/admin';
import { getByUid as getStudentByUid } from '@/domains/student';
import { getCurrentBusFee } from '@/lib/bus-fee-service';
import { createRazorpayOrder, generateReceiptId } from '@/lib/payment/razorpay.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { isOriginAllowed, withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { CreateOrderSchema } from '@/lib/security/validation-schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

function amountsMatch(clientAmount: number, expectedAmount: number): boolean {
    return Math.round(clientAmount * 100) === Math.round(expectedAmount * 100);
}

export const POST = withSecurity<CreateOrderBody>(
    async (_request, { auth, body }) => {
        const { amount, notes, userName, enrollmentId, durationYears } = body;
        const trustedUserId = auth.uid;
        const trustedDurationYears = durationYears || Number(notes?.duration || 1);
        const [busFeeResult, systemConfigResult, student] = await Promise.all([
            getCurrentBusFee().catch((err) => {
                console.error('[create-order] getCurrentBusFee failed:', err);
                return null;
            }),
            getSystemConfig(),
            getStudentByUid(trustedUserId).catch(() => null),
        ]);

        const busFeeAmount = Number(busFeeResult?.amount ?? systemConfigResult.data.busFee?.amount ?? 0);
        const expectedAmount = busFeeAmount * trustedDurationYears;

        if (!busFeeAmount || busFeeAmount <= 0 || !amountsMatch(amount, expectedAmount)) {
            return NextResponse.json(
                { success: false, error: 'Payment amount does not match the official bus fee' },
                { status: 400 }
            );
        }

        const studentData = student as any;
        const trustedEnrollmentId = studentData?.enrollmentId || enrollmentId || notes?.enrollmentId || '';
        const trustedStudentName = studentData?.fullName || studentData?.name || userName || auth.name || 'Unknown';

        // SECURITY: 'type' is derived server-side, never from the client body.
        // A client claiming 'renewal' vs 'new_registration' at will could route
        // the payment through whichever funnel is cheaper to pass. A renewal is
        // a student who already holds transport validity (paid a prior session);
        // everyone else is a first-time registration.
        const isRenewal = !!(studentData?.validUntil) || !!(studentData?.sessionEndYear);
        const orderType = isRenewal ? 'renewal' : 'new_registration';

        // SECURITY: Academic session boundaries are derived or validated by trusted server-side logic.
        // A client must NEVER be able to inject arbitrary or conflicting years into Razorpay order notes.
        let trustedSessionStartYear: number;
        let trustedSessionEndYear: number;

        if (isRenewal) {
            const currentSessionEnd = Number(studentData?.sessionEndYear || 0);
            const currentYear = new Date().getUTCFullYear();
            const existingValidUntil = studentData?.validUntil;
            let baseYear = currentYear;
            if (existingValidUntil && new Date(existingValidUntil) > new Date() && currentSessionEnd > 0) {
                baseYear = currentSessionEnd;
            } else if (currentSessionEnd > 0) {
                baseYear = currentSessionEnd;
            }
            trustedSessionStartYear = baseYear;
            trustedSessionEndYear = baseYear + trustedDurationYears;
        } else {
            // New registration: derive from system academic year or current calendar
            const configAny = systemConfigResult.data as any;
            const systemStartYear = Number(configAny?.academicYear?.startYear || configAny?.busFee?.sessionStartYear || 0);
            const baseYear = systemStartYear > 2000 ? systemStartYear : new Date().getUTCFullYear();
            trustedSessionStartYear = baseYear;
            trustedSessionEndYear = baseYear + trustedDurationYears;
        }

        // If client provided conflicting session years in notes, log warning and overwrite
        if (notes?.sessionStartYear && Number(notes.sessionStartYear) !== trustedSessionStartYear) {
            console.warn(`[create-order] Client provided conflicting sessionStartYear (${notes.sessionStartYear} vs trusted ${trustedSessionStartYear}). Enforcing trusted server value.`);
        }
        if (notes?.sessionEndYear && Number(notes.sessionEndYear) !== trustedSessionEndYear) {
            console.warn(`[create-order] Client provided conflicting sessionEndYear (${notes.sessionEndYear} vs trusted ${trustedSessionEndYear}). Enforcing trusted server value.`);
        }

        // Generate unique receipt ID
        const receipt = generateReceiptId('ADTU_BUS');

        // Create order notes - IMPORTANT: These are used by webhook/verification
        // SECURITY: Use trustedUserId (from auth) instead of client-supplied userId.
        // `purpose` is set to the server-derived orderType: the client `purpose`
        // field is free-text and must never decide renewal vs registration
        // routing downstream (validity math differs per funnel).
        // `sessionStartYear` and `sessionEndYear` are explicitly server-derived.
        const orderNotes = {
            ...notes,
            userId: trustedUserId || 'unknown',
            enrollmentId: trustedEnrollmentId,
            studentId: trustedEnrollmentId || trustedUserId || '',
            studentName: trustedStudentName,
            userName: trustedStudentName,
            durationYears: trustedDurationYears.toString(),
            sessionStartYear: String(trustedSessionStartYear),
            sessionEndYear: String(trustedSessionEndYear),
            purpose: orderType,
            type: orderType,
            timestamp: new Date().toISOString(),
        };

        // Create Razorpay order with error handling
        let order;
        try {
            order = await createRazorpayOrder(expectedAmount, receipt, orderNotes);
        } catch (orderErr: any) {
            console.error('❌ Failed to create Razorpay order:', orderErr?.message || orderErr);
            const status = orderErr?.statusCode || 500;
            return NextResponse.json(
                { success: false, error: orderErr?.message || 'Failed to create payment order' },
                { status }
            );
        }

        console.log('📝 Order created:', {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt,
        });

        // DURABLE PRE-CHECKOUT PERSISTENCE: Write pending payment record to Supabase
        // before student begins client checkout. This provides trusted server attribution
        // and enables background reconciliation sweeps to discover captured funds even if
        // the client session is interrupted or webhook retries lapse.
        // INVARIANT: Fail-closed. Client MUST NOT receive a usable checkout response with
        // order ID unless the pending ledger record has been durably persisted locally.
        let persistedPaymentId: string | null = null;
        try {
            persistedPaymentId = await paymentsSupabaseService.upsertPayment({
                paymentId: order.id,
                studentUid: trustedUserId,
                studentId: trustedEnrollmentId,
                studentName: trustedStudentName,
                amount: expectedAmount,
                method: 'Online',
                status: 'Pending',
                sessionStartYear: trustedSessionStartYear,
                sessionEndYear: trustedSessionEndYear,
                durationYears: trustedDurationYears,
                razorpayOrderId: order.id,
                purpose: `Order created for ${orderType}. Awaiting checkout capture.`,
                metadata: {
                    order_type: orderType,
                    receipt_id: receipt,
                    checkout_initiated_at: new Date().toISOString(),
                    entitlement_status: 'pending_checkout',
                },
            });
        } catch (dbErr: any) {
            console.error('[create-order] Database write failure for pending payment:', dbErr);
            return NextResponse.json(
                {
                    success: false,
                    error: 'Database service failure: Unable to initiate order registration. Please try again.',
                },
                { status: 500 }
            );
        }

        if (!persistedPaymentId) {
            console.error('[create-order] Failed to persist initial pending payment record (null returned)');
            return NextResponse.json(
                {
                    success: false,
                    error: 'Failed to record pending checkout order in financial ledger. Checkout cannot proceed.',
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency,
                receipt: order.receipt,
                status: order.status,
                notes: order.notes,
            },
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        });
    },
    {
        requiredRoles: [], // Any authenticated user can create an order
        schema: CreateOrderSchema,
        rateLimit: RateLimits.PAYMENT_CREATE,
        allowBodyToken: true
    }
);

// OPTIONS method for CORS - Production safe
export async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get('origin') || '';
    const isAllowed = isOriginAllowed(origin);

    return new NextResponse(null, {
        status: isAllowed ? 204 : 403,
        headers: isAllowed ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '86400',
        } : {},
    });
}
