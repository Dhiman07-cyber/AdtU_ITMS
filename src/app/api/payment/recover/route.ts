import { getByApplicantUid } from '@/domains/application';
import { isPaymentProcessed, processCapturedPayment } from '@/lib/payment/payment.service';
import { fetchOrderDetails, fetchOrderPayments, fetchPaymentDetails } from '@/lib/payment/razorpay.service';
import { isOriginAllowed, withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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
        let renewalPaymentId = '';
        let renewalOrderId = '';
        const appDoc = await getByApplicantUid(targetUid);
        if (appDoc) {
            const appData = appDoc as any;
            if (appData.state === 'approved' || appData.state === 'verified_upcoming') {
                isApplicationApproved = true;
            }
            appPaymentId = appData.paymentId || appData.formData?.paymentId || '';
            appOrderId = appData.formData?.paymentInfo?.razorpayOrderId || '';

            // D8: Check renewal applications from PostgreSQL
            if (appDoc.applicationType === 'renewal' || appDoc.applicationType === 'renewal_after_soft_block') {
                if (appDoc.state === 'approved' || appDoc.state === 'submitted') {
                    isRenewalCompleted = appDoc.state === 'approved';
                }
                renewalPaymentId = appDoc.paymentId || (appDoc.formData as any)?.paymentId || '';
                renewalOrderId = (appDoc.formData as any)?.razorpayOrderId || '';
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

        // SEAM FIX 3: Check if student has a Completed payment from a rejected application that can be re-bound
        const unconsumedPayment = studentPayments.find(p => 
            p.status === 'Completed' && 
            p.metadata?.entitlement_status === 'application_rejected_unconsumed'
        );
        if (unconsumedPayment && (!queryPaymentId || queryPaymentId === unconsumedPayment.payment_id)) {
            return NextResponse.json({
                success: true,
                status: 'unconsumed_payment_available',
                paymentId: unconsumedPayment.payment_id,
                orderId: unconsumedPayment.razorpay_order_id,
                amount: unconsumedPayment.amount,
                sessionStartYear: unconsumedPayment.session_start_year,
                sessionEndYear: unconsumedPayment.session_end_year,
                message: 'You have an existing completed payment from a previous application that will be applied to your submission.'
            });
        }

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

        let matchedPendingOnline: any = null;
        if (!resolvedOrderId && !resolvedPaymentId) {
            matchedPendingOnline = studentPayments.find(p => {
                if (p.status !== 'Pending') return false;
                const createdAt = p.created_at ? new Date(p.created_at).getTime() : 0;
                return (Date.now() - createdAt) <= 72 * 60 * 60 * 1000;
            });
            if (matchedPendingOnline) {
                resolvedOrderId = matchedPendingOnline.razorpay_order_id || (matchedPendingOnline.payment_id?.startsWith('order_') ? matchedPendingOnline.payment_id : '');
                resolvedPaymentId = matchedPendingOnline.razorpay_payment_id || '';
                if (resolvedOrderId) allowedOrderIds.add(resolvedOrderId);
                if (resolvedPaymentId) allowedPaymentIds.add(resolvedPaymentId);
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

            // 1. Fetch payments associated with the order directly from Razorpay
            if (!razorpayPayment && resolvedOrderId) {
                try {
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: fetching payments for order:`, resolvedOrderId);
                    const orderPayments = await withTimeout(fetchOrderPayments(resolvedOrderId), RAZORPAY_TIMEOUT_MS);
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: fetched order payments:`, JSON.stringify(orderPayments));
                    if (orderPayments && orderPayments.items && orderPayments.items.length > 0) {
                        // Find the first captured or authorized payment, fallback to the first one
                        const successfulPayment = orderPayments.items.find((p: any) => p.status === 'captured' || p.status === 'authorized');
                        razorpayPayment = successfulPayment || orderPayments.items[0];
                        if (razorpayPayment) {
                            resolvedPaymentId = razorpayPayment.id;
                            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: resolved payment from order payments:`, resolvedPaymentId);
                        }
                    }
                } catch (err: any) {
                    console.warn(`[recover] Failed to fetch order payments for ${resolvedOrderId}:`, err);
                }
            }

            // 2. Fallback: Fetch order details to see if status is paid and map from local ledger
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
                            if (resolvedPaymentId) {
                                razorpayPayment = await withTimeout(fetchPaymentDetails(resolvedPaymentId), RAZORPAY_TIMEOUT_MS);
                                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: fetched payment details in fallback:`, JSON.stringify(razorpayPayment));
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
                    let mergedNotes = { ...(razorpayPayment.notes || {}) };
                    if ((!mergedNotes.sessionStartYear || !mergedNotes.userId) && (resolvedOrderId || razorpayPayment.order_id)) {
                        try {
                            const orderInfo = await withTimeout(fetchOrderDetails(resolvedOrderId || razorpayPayment.order_id), RAZORPAY_TIMEOUT_MS);
                            if (orderInfo?.notes) {
                                mergedNotes = { ...orderInfo.notes, ...mergedNotes };
                            }
                        } catch (e) {
                            console.warn('[recover] Order notes fetch warning:', e);
                        }
                    }
                    if (matchedPendingOnline?.metadata) {
                        mergedNotes = { ...(matchedPendingOnline.metadata as any), ...mergedNotes };
                    }
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: captured. Invoking processCapturedPayment...`);
                    const completion = await processCapturedPayment({
                        paymentId: resolvedPaymentId,
                        orderId: resolvedOrderId || razorpayPayment.order_id,
                        amount: Number(razorpayPayment.amount) / 100,
                        method: razorpayPayment.method || 'Online',
                        notes: mergedNotes,
                        source: 'recovery'
                    });
                    console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] recover: processCapturedPayment returned:`, JSON.stringify(completion));

                    if (completion.status === 'error') {
                        throw new Error(completion.error || 'Completion handler failed');
                    }

                    if (completion.status === 'already_paid_for_session') {
                        return NextResponse.json({
                            success: true,
                            duplicatePayment: true,
                            status: 'duplicate_pending_refund',
                            message: `Payment received and recorded (Reference: ${resolvedPaymentId}). An existing active payment already covers this academic session. This transaction has been flagged in the university ledger for refund review.`
                        });
                    }

                    if (completion.status === 'captured_pending_review') {
                        return NextResponse.json({
                            success: true,
                            pendingReview: true,
                            status: 'captured_pending_review',
                            message: `Payment received and recorded (Reference: ${resolvedPaymentId}). Academic session details could not be automatically established. This transaction has been queued for administrative review and attribution.`
                        });
                    }

                    const rawPurpose = String(mergedNotes.type || mergedNotes.purpose || '');
                    const isRenewal = !rawPurpose.toLowerCase().includes('registration') && rawPurpose.toLowerCase() !== 'new_registration';
                    if (isRenewal) {
                        return NextResponse.json({
                            success: true,
                            pendingApproval: true,
                            status: 'pending_approval',
                            message: 'Payment received. Your renewal is now awaiting approval — transport access will be restored once an administrator approves it.'
                        });
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
    const isAllowed = isOriginAllowed(origin);

    return new NextResponse(null, {
        status: isAllowed ? 204 : 403,
        headers: isAllowed ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '86400',
        } : {},
    });
}
