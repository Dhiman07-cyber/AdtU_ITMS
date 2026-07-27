import { processCapturedPayment } from '@/lib/payment/payment.service';
import {
	fetchOrderDetails,
	fetchPaymentDetails,
	verifyRazorpaySignature,
} from '@/lib/payment/razorpay.service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { VerifyPaymentSchema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';
import { z } from 'zod';

type VerifyPaymentBody = z.infer<typeof VerifyPaymentSchema>;

type RazorpayNotes = Record<string, string | number | boolean | null | undefined>;

type RazorpayOrderDetails = {
    id?: string;
    amount: number;
    notes?: RazorpayNotes;
};

type RazorpayPaymentDetails = {
    id?: string;
    order_id?: string;
    amount?: number;
    status?: string;
    method?: string;
};

type OnlineTransactionRecord = {
    studentId: string;
    studentName: string;
    amount: number;
    paymentMethod: 'online';
    paymentId: string;
    timestamp: string;
    durationYears: number;
    validUntil: string;
    status: 'completed';
    purpose: 'new_registration' | 'renewal';
};

function noteString(notes: RazorpayNotes, key: string): string {
    const value = notes[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function parseDuration(value: string): number {
    const parsed = Number.parseInt(value || '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizePurpose(value: string): 'new_registration' | 'renewal' {
    const normalized = value.toLowerCase();
    return normalized.includes('registration') || normalized === 'new_registration'
        ? 'new_registration'
        : 'renewal';
}

export const POST = withSecurity<VerifyPaymentBody>(
    async (_request, { auth, body }) => {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment API POST handler ENTER. body:`, JSON.stringify(body), `auth:`, JSON.stringify(auth));
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;

        const verification = verifyRazorpaySignature({
            razorpay_payment_id,
            razorpay_order_id,
            razorpay_signature,
        });

        if (!verification.isValid) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyRazorpaySignature returned invalid. Error:`, verification.error);
            const res = NextResponse.json(
                { success: false, error: verification.error || 'Payment verification failed' },
                { status: 400 }
            );
            return res;
        }

        let orderDetails: RazorpayOrderDetails;
        try {
            orderDetails = await fetchOrderDetails(razorpay_order_id) as RazorpayOrderDetails;
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] fetchOrderDetails returned:`, JSON.stringify(orderDetails));
        } catch (fetchErr: any) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] fetchOrderDetails failed:`, fetchErr?.message || fetchErr);
            return NextResponse.json(
                { success: false, error: 'Failed to verify order details with Razorpay' },
                { status: 502 }
            );
        }

        const trustedNotes = orderDetails.notes || {};
        const trustedUserId = noteString(trustedNotes, 'userId');
        const trustedEnrollmentId = noteString(trustedNotes, 'enrollmentId') || noteString(trustedNotes, 'studentId');
        const trustedStudentName = noteString(trustedNotes, 'studentName') || noteString(trustedNotes, 'userName') || 'Unknown';
        const trustedDurationYears = parseDuration(noteString(trustedNotes, 'durationYears'));
        const trustedPurpose = normalizePurpose(noteString(trustedNotes, 'purpose') || noteString(trustedNotes, 'type'));
        const trustedAmount = Number(orderDetails.amount || 0) / 100;

        if (!trustedUserId || trustedUserId !== auth.uid) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] User mismatch. trustedUserId:`, trustedUserId, `auth.uid:`, auth.uid);
            return NextResponse.json(
                { success: false, error: 'Payment order does not belong to the authenticated user' },
                { status: 403 }
            );
        }

        let paymentDetails: RazorpayPaymentDetails;
        try {
            paymentDetails = await fetchPaymentDetails(razorpay_payment_id) as RazorpayPaymentDetails;
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] fetchPaymentDetails returned:`, JSON.stringify(paymentDetails));
        } catch (fetchPayErr: any) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] fetchPaymentDetails failed:`, fetchPayErr?.message || fetchPayErr);
            return NextResponse.json(
                { success: false, error: 'Failed to verify payment capture with Razorpay' },
                { status: 502 }
            );
        }

        if (
            paymentDetails.id !== razorpay_payment_id ||
            paymentDetails.order_id !== razorpay_order_id ||
            Number(paymentDetails.amount || 0) !== Number(orderDetails.amount || 0)
        ) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Details mismatch: paymentDetails.id=`, paymentDetails.id, `razorpay_payment_id=`, razorpay_payment_id, `paymentDetails.order_id=`, paymentDetails.order_id, `razorpay_order_id=`, razorpay_order_id);
            return NextResponse.json(
                { success: false, error: 'Razorpay payment details do not match the order' },
                { status: 400 }
            );
        }

        if (paymentDetails.status !== 'captured') {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Payment status not captured. status:`, paymentDetails.status);
            return NextResponse.json(
                { success: false, error: 'Payment is not captured yet. Please retry shortly.' },
                { status: 409 }
            );
        }

        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment invoking processCapturedPayment...`);

        let result: { status: 'success' | 'already_processed' | 'error' | 'already_paid_for_session'; error?: string };
        try {
            result = await processCapturedPayment({
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                amount: trustedAmount,
                method: paymentDetails.method || 'Online',
                notes: trustedNotes,
                source: 'verify-payment'
            });
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment: processCapturedPayment returned:`, JSON.stringify(result));
        } catch (procErr: any) {
            console.error('[verify-payment] processCapturedPayment threw:', procErr?.message || procErr);
            return NextResponse.json(
                { success: false, error: procErr?.message || 'Payment processing failed unexpectedly' },
                { status: 500 }
            );
        }

        if (result.status === 'error') {
            console.error('[verify-payment] processCapturedPayment returned error:', result.error);
            return NextResponse.json(
                { success: false, error: result.error || 'Failed to process payment' },
                { status: 500 }
            );
        }

        const pendingApproval = trustedPurpose === 'renewal';
        const responseBody = {
            success: true,
            pendingApproval,
            message: pendingApproval
                ? 'Payment received. Your renewal is now awaiting approval — transport access will be restored once an administrator approves it.'
                : 'Payment verified successfully',
            payment: {
                paymentId: razorpay_payment_id,
                orderId: razorpay_order_id,
                userId: trustedUserId,
                userName: trustedStudentName,
                purpose: trustedPurpose,
                amount: trustedAmount,
                status: paymentDetails.status,
                method: paymentDetails.method || 'unknown',
                capturedAt: new Date().toISOString(),
            },
            verification: {
                isValid: true,
                orderId: verification.orderId,
                paymentId: verification.paymentId,
            },
        };
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verify-payment API returning success. responseBody:`, JSON.stringify(responseBody));
        return NextResponse.json(responseBody);
    },
    {
        requiredRoles: [],
        schema: VerifyPaymentSchema,
        rateLimit: RateLimits.PAYMENT_VERIFY,
        allowBodyToken: true,
    }
);

export async function OPTIONS(request: Request) {
    const origin = request.headers.get('origin') || '';
    const allowedOrigins = ['https://adtu-bus.vercel.app', 'https://adtu-bus-xq.vercel.app', process.env.NEXT_PUBLIC_APP_URL || ''].filter(Boolean);
    const isVercelPreview = /^https:\/\/.*\.vercel\.app$/.test(origin);
    const isLocalhost = process.env.NODE_ENV === 'development' && (origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000');
    const isAllowed = allowedOrigins.includes(origin) || isVercelPreview || isLocalhost;

    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': isAllowed ? origin : (allowedOrigins[0] || ''),
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}
