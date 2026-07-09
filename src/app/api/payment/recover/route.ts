import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { fetchOrderDetails, fetchPaymentDetails } from '@/lib/payment/razorpay.service';
import { processCapturedPayment, isPaymentProcessed } from '@/lib/payment/payment.service';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { z } from 'zod';
import { getById as getApplicationById } from '@/domains/application';

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RECOVERY_THROTTLE_SECONDS = Number(process.env.RECOVERY_THROTTLE_SECONDS || 15);
const RAZORPAY_TIMEOUT_MS = Number(process.env.RAZORPAY_TIMEOUT_MS || 6000);

// In-memory fallback for local development without Upstash Redis
const localCache = new Map<string, number>();

async function isRecoveryThrottled(uid: string): Promise<boolean> {
    const key = `payment-recovery:${uid}`;
    
    if (UPSTASH_URL && UPSTASH_TOKEN) {
        try {
            // Try to set the key with NX (only if it doesn't exist) and EX (expire in seconds)
            const res = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}/1/EX/${RECOVERY_THROTTLE_SECONDS}/NX`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
                cache: 'no-store',
            });
            
            if (res.ok) {
                const data = await res.json();
                // Upstash returns { result: "OK" } if it was set, or { result: null } if not set
                const wasSet = data?.result === 'OK';
                return !wasSet; // if it was NOT set, it means it already existed (throttled)
            } else {
                console.error(`[Recover Throttle] Redis returned status ${res.status}. Skipping throttle.`);
                return false; // Skip throttle on Redis non-ok responses
            }
        } catch (err) {
            console.error('[Recover Throttle] Redis check failed with error. Skipping throttle:', err);
            return false; // Skip throttle on Redis fetch errors
        }
    }
    
    // In-memory fallback for local development when credentials are NOT configured
    const now = Date.now();
    const lastCheck = localCache.get(uid);
    if (lastCheck && now - lastCheck < (RECOVERY_THROTTLE_SECONDS * 1000)) {
        return true;
    }
    localCache.set(uid, now);
    return false;
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
            setTimeout(() => reject(new Error('Razorpay Gateway Timeout')), timeoutMs)
        )
    ]);
};

const RecoverQuerySchema = z.object({
    orderId: z.string().min(1).max(100).optional(),
    paymentId: z.string().min(1).max(100).optional(),
    studentUid: z.string().min(1).max(100).optional(),
});

export const GET = withSecurity(
    async (request, { auth, body }) => {
        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover API GET handler ENTER. body/query:`, JSON.stringify(body), `auth:`, JSON.stringify(auth));
        // withSecurity for GET passes validated query parameters in body
        const { orderId: queryOrderId, paymentId: queryPaymentId, studentUid: queryStudentUid } = body as z.infer<typeof RecoverQuerySchema>;
        const requesterUid = auth.uid;
        const requesterRole = (auth as any).role || 'student';

        // 1. Authorization & target UID identification
        const isStaff = requesterRole === 'admin' || requesterRole === 'moderator';
        const targetUid = (isStaff && queryStudentUid) ? queryStudentUid : requesterUid;

        if (!isStaff && queryStudentUid && queryStudentUid !== requesterUid) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Forbidden for studentUid:`, queryStudentUid, `requesterUid:`, requesterUid);
            return NextResponse.json({ error: 'Forbidden: Cannot recover payments for other students' }, { status: 403 });
        }

        // 2. Collect current repository states & allowed ownership lists
        let appPaymentId = '';
        let appOrderId = '';
        let isApplicationApproved = false;
        let isRenewalCompleted = false;

        // Check student's application via domain API
        const appDoc = await getApplicationById(targetUid);
        if (appDoc) {
            const appData = appDoc as any;
            if (appData.state === 'approved' || appData.state === 'verified_upcoming') {
                isApplicationApproved = true;
            }
            appPaymentId = appData.paymentId || appData.formData?.paymentId || '';
            appOrderId = appData.formData?.paymentInfo?.razorpayOrderId || '';
        }

        // Check student's renewal requests
        let renewalPaymentId = '';
        let renewalOrderId = '';
        const renewalQuery = await adminDb.collection('renewal_requests')
            .where('studentId', '==', targetUid)
            .get();

        if (!renewalQuery.empty) {
            for (const doc of renewalQuery.docs) {
                const renewalData = doc.data();
                if (renewalData.status === 'approved' || renewalData.status === 'completed') {
                    isRenewalCompleted = true;
                }
                renewalPaymentId = renewalData.paymentId || '';
                renewalOrderId = renewalData.razorpayOrderId || '';
            }
        }

        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: appPaymentId=${appPaymentId} appOrderId=${appOrderId} isApplicationApproved=${isApplicationApproved} isRenewalCompleted=${isRenewalCompleted}`);

        // 3. Fast-path: already approved / completed -> Return success immediately
        if (isApplicationApproved || isRenewalCompleted) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Fast-path already approved/completed.`);
            return NextResponse.json({
                success: true,
                status: 'already_processed',
                message: 'Your service entitlement is already active or processed.'
            });
        }

        // Fetch payment history of target student from Supabase
        const studentPayments = await paymentsSupabaseService.getPaymentsByStudentUid(targetUid, { limit: 5 });

        // Collect all verified IDs belonging to target student for Ownership validation
        const allowedPaymentIds = new Set<string>();
        const allowedOrderIds = new Set<string>();
        
        if (appPaymentId) allowedPaymentIds.add(appPaymentId);
        if (appOrderId) allowedOrderIds.add(appOrderId);
        if (renewalPaymentId) allowedPaymentIds.add(renewalPaymentId);
        if (renewalOrderId) allowedOrderIds.add(renewalOrderId);
        
        studentPayments.forEach(p => {
            if (p.payment_id) allowedPaymentIds.add(p.payment_id);
            if (p.razorpay_payment_id) allowedPaymentIds.add(p.razorpay_payment_id);
            if (p.razorpay_order_id) allowedOrderIds.add(p.razorpay_order_id);
        });

        // Strict Security Ownership Verification:
        // Disallow clients trying to verify order/payment IDs that do not belong to targetUid
        if (queryPaymentId && !allowedPaymentIds.has(queryPaymentId)) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Forbidden payment ID ownership mismatch:`, queryPaymentId);
            return NextResponse.json({ error: 'Forbidden: Invalid payment ownership' }, { status: 403 });
        }
        if (queryOrderId && !allowedOrderIds.has(queryOrderId)) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Forbidden order ID ownership mismatch:`, queryOrderId);
            return NextResponse.json({ error: 'Forbidden: Invalid order ownership' }, { status: 403 });
        }

        // Resolve inputs (prefer verified query parameters, fallback to latest records)
        let resolvedPaymentId = queryPaymentId || appPaymentId || renewalPaymentId || '';
        let resolvedOrderId = queryOrderId || appOrderId || renewalOrderId || '';

        if (!resolvedOrderId && !resolvedPaymentId) {
            const pendingOnline = studentPayments.find(p => p.status === 'Pending' && p.method === 'Online');
            if (pendingOnline) {
                resolvedOrderId = pendingOnline.razorpay_order_id || '';
                resolvedPaymentId = pendingOnline.razorpay_payment_id || '';
            }
        }

        console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Resolved IDs: resolvedPaymentId=${resolvedPaymentId} resolvedOrderId=${resolvedOrderId}`);

        // If no payment was ever initiated, let them restart payment safely
        if (!resolvedOrderId && !resolvedPaymentId) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: No order or payment ID resolved.`);
            return NextResponse.json({
                success: false,
                status: 'not_found',
                message: 'No online payment history was found for this application. You can safely restart the payment.'
            });
        }

        // 4. Throttling Gate: check Redis throttle
        if (await isRecoveryThrottled(targetUid)) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Throttle active.`);
            // Throttled: bypass Razorpay, return current database status
            const dbProcessed = resolvedPaymentId ? await isPaymentProcessed(resolvedPaymentId) : false;
            if (dbProcessed) {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Throttle active, but DB records resolvedPaymentId=${resolvedPaymentId} as processed.`);
                return NextResponse.json({
                    success: true,
                    status: 'success',
                    message: 'Payment verified and processed successfully.'
                });
            }
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Throttle active, returning verification_pending.`);
            return NextResponse.json({
                success: true,
                status: 'verification_pending',
                message: 'We cannot confirm your payment yet. We are verifying it securely with Razorpay. If your payment has been captured, your application will update automatically.'
            });
        }

        // 5. Query Razorpay
        try {
            let razorpayPayment: any = null;

            if (resolvedPaymentId) {
                try {
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: fetching payment details for:`, resolvedPaymentId);
                    razorpayPayment = await withTimeout(fetchPaymentDetails(resolvedPaymentId), RAZORPAY_TIMEOUT_MS);
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: fetched payment details:`, JSON.stringify(razorpayPayment));
                } catch (err: any) {
                    console.warn(`[recover] Failed to fetch payment details for ${resolvedPaymentId}, trying order details:`, err);
                }
            }

            if (!razorpayPayment && resolvedOrderId) {
                try {
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: fetching order details for:`, resolvedOrderId);
                    const orderData = await withTimeout(fetchOrderDetails(resolvedOrderId), RAZORPAY_TIMEOUT_MS);
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: fetched order details:`, JSON.stringify(orderData));
                    if (orderData && orderData.id) {
                        if (orderData.status === 'paid') {
                            if (!resolvedPaymentId) {
                                const supabaseRec = await paymentsSupabaseService.getPaymentByRazorpayId(orderData.id);
                                if (supabaseRec) {
                                    resolvedPaymentId = supabaseRec.razorpay_payment_id || supabaseRec.payment_id;
                                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: mapped orderId to resolvedPaymentId:`, resolvedPaymentId);
                                }
                            }
                        }
                    }
                } catch (err: any) {
                    console.warn(`[recover] Failed to fetch order details for ${resolvedOrderId}:`, err);
                }
            }

            // Scenario C/D/E/F based on payment status
            if (razorpayPayment) {
                const status = razorpayPayment.status;
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: Razorpay payment status:`, status);

                if (status === 'captured') {
                    // Scenario A: Captured -> process it canonical style
                    const notes = razorpayPayment.notes || {};
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: captured. Invoking processCapturedPayment...`);
                    const completion = await processCapturedPayment({
                        paymentId: resolvedPaymentId,
                        orderId: resolvedOrderId || razorpayPayment.order_id,
                        amount: Number(razorpayPayment.amount) / 100,
                        method: razorpayPayment.method || 'Online',
                        notes,
                        source: 'recovery'
                    });
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: processCapturedPayment returned:`, JSON.stringify(completion));

                    if (completion.status === 'error') {
                        throw new Error(completion.error || 'Completion handler failed');
                    }

                    return NextResponse.json({
                        success: true,
                        status: 'success',
                        message: 'Payment verified and processed successfully.'
                    });
                } else if (status === 'failed') {
                    // Scenario C: Failed — log raw reason internally, do NOT return it
                    const rawReason = razorpayPayment.error_reason || razorpayPayment.error_code || 'unknown';
                    console.info(`[recover] Payment ${resolvedPaymentId} failed. rawReason=${rawReason} uid=${targetUid}`);
                    const resBody = {
                        success: false,
                        status: 'failed',
                        message: 'Your payment was not completed. No transport service has been activated. Please try again using the same or another payment method.'
                    };
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: payment failed, returning:`, JSON.stringify(resBody));
                    return NextResponse.json(resBody);
                } else {
                    // Scenario D: Processing (created, authorized, processing)
                    console.log(`[recover] Payment ${resolvedPaymentId} in intermediate state=${status} uid=${targetUid}`);
                    const resBody = {
                        success: true,
                        status: 'processing',
                        message: 'We are confirming your payment with Razorpay. Please do not make another payment. This usually completes within a few moments.'
                    };
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: status other, returning:`, JSON.stringify(resBody));
                    return NextResponse.json(resBody);
                }
            } else {
                // Scenario E: Payment not found in Razorpay
                console.warn(`[recover] No razorpay payment found for orderId=${resolvedOrderId} paymentId=${resolvedPaymentId} uid=${targetUid}`);
                const resBody = {
                    success: false,
                    status: 'not_found',
                    message: 'No online payment history was found for this order. You can safely start a new payment.'
                };
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: payment not found, returning:`, JSON.stringify(resBody));
                return NextResponse.json(resBody);
            }

        } catch (razorpayErr: any) {
            console.error('[recover] Razorpay API or network error:', razorpayErr.message);
            // Scenario F/G: Outage or timeout -> never assume failure, return verification_pending
            const resBody = {
                success: true,
                status: 'verification_pending',
                message: 'We cannot confirm your payment yet. We are verifying it securely with Razorpay. If your payment has been captured, your application will update automatically.'
            };
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover error caught, returning:`, JSON.stringify(resBody));
            return NextResponse.json(resBody);
        }
    },
    {
        requiredRoles: [],
        schema: RecoverQuerySchema,
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
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}
