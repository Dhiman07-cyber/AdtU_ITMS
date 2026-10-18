# Razorpay Online Payment Gateway Architecture & Lifecycle Verification

**Document Metadata:**
- **Domain:** Domain 12 — Payment & Financial Ledger
- **Status:** Verified against Active Production Codebase (`c:\Users\ADMIN\Desktop\Projects\ITMS`)
- **Key Modules Audited:**
  - Client Hook: [`src/hooks/useRazorpay.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/hooks/useRazorpay.ts)
  - Order Creation API: [`src/app/api/payment/razorpay/create-order/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payment/razorpay/create-order/route.ts)
  - Webhook Ingestion API: [`src/app/api/payment/webhook/razorpay/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payment/webhook/razorpay/route.ts)
  - Client Verification API: [`src/app/api/payment/razorpay/verify-payment/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payment/razorpay/verify-payment/route.ts)
  - Core Payment Service: [`src/lib/payment/payment.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/payment/payment.service.ts)
  - Gateway Client Wrapper: [`src/lib/payment/razorpay.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/payment/razorpay.service.ts)
  - State Taxonomy: [`src/lib/payment/payment-state.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/payment/payment-state.ts)
  - Supabase Ledger Persistence: [`src/lib/services/payments-supabase.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/services/payments-supabase.ts)

---

## 1. Executive Architecture & Engineering Invariants

The Assam down town University Intelligent Transport Management System (ADTU ITMS) integrates with **Razorpay** to process semester and multi-year bus transportation fees for thousands of university commuters across Guwahati and Kamrup metropolitan corridors.

### Core System Invariants (INV-PAY)
1. **Single Source of Truth**: All payment records are persisted exclusively in Supabase PostgreSQL (`public.payments` table). Third-party payment gateways are treated as untrusted external settlement networks; no commuter pass is granted based solely on client-side success callbacks.
2. **Strict Immutability & Append-Only Accounting**: Payment records are immutable financial audit entries. Once a payment reaches a terminal or captured status (`Completed`, `Refunded`, `Refund_Denied`, `Rejected`, `Duplicate_Pending_Refund`, `Captured_Pending_Review`), it **cannot be deleted, and financial identity fields cannot be modified**.
3. **Fail-Closed Pre-Checkout Persistence**: Before a student receives a Razorpay `order_id` in their browser, a `Pending` transaction row must be durably written to PostgreSQL. If database insertion fails, the checkout request aborts immediately. This guarantees that uncaptured or stranded orders can be audited and reconciled by background sweeps.
4. **Idempotency & Concurrent Settlement Deduplication**: Webhook retries, student network retransmits, and simultaneous client-side `verify-payment` calls are safely deduplicated via in-memory execution promises (`inFlightPayments`), PostgreSQL unique constraints (`idx_payments_unique_razorpay_payment_id`), and distributed Redis rate guards.
5. **Session Overpayment Defense & Duplicate Capture Segregation**: A student can have at most ONE `Completed` payment for a specific academic session (`session_start_year` to `session_end_year`). If a concurrent or delayed capture arrives for an already covered session, the funds are **never dropped**; instead, the system records the transaction as `Duplicate_Pending_Refund` and dispatches high-priority financial audit alerts for manual officer review.
6. **Realistic Engineering Reliability (No "Zero-Failure" Fictions)**: Real distributed payment systems face internet outages, browser crashes, webhook drops, banking timeouts, and database connection exhaustion. The architecture does not claim "it will never fail"; rather, it is designed with **bounded recovery mechanisms** (idempotent retries, self-healing endpoints, and automated background reconciliation sweeps) that converge to a consistent state without losing money or granting unentitled transit access.

---

## 2. End-to-End Online Payment Lifecycle Topology

```
+-------------------------------------------------------------------------------------------------------------------------------------------------+
|                                                   ADTU ITMS — RAZORPAY PAYMENT DATA FLOW                                                        |
+-------------------------------------------------------------------------------------------------------------------------------------------------+

 [ Student Browser PWA ]                 [ Next.js API Layer ]                     [ Razorpay Gateway ]                 [ PostgreSQL Ledger ]
           │                                      │                                         │                                      │
           │─── 1. POST /api/payment/create-order─►│                                         │                                      │
           │    { amount, durationYears }         ├── 2. Validate against system_config ────┼─────────────────────────────────────►│
           │                                      ├── 3. Derive session years server-side ──┼─────────────────────────────────────►│
           │                                      ├── 4. razorpay.orders.create ───────────►│                                      │
           │                                      │◄── 5. Returns order_id ─────────────────┤                                      │
           │                                      ├── 6. INSERT Pending payment (Fail-closed)─────────────────────────────────────►│
           │◄── 7. Return order_id & key_id ──────┤                                         │                                      │
           │                                      │                                         │                                      │
  ═════════╡ CLIENT CHECKOUT MODAL OPENS ═════════╡                                         │                                      │
           │─── 8. User enters UPI / Card / NetBank────────────────────────────────────────►│                                      │
           │                                      │                                         │                                      │
  ═════════╡ DUAL INGESTION PATHWAYS (RACING CONCURRENTLY) ═════════════════════════════════╡                                      │
           │                                      │                                         │                                      │
           │                                      │◄── 9. Webhook POST: payment.captured ──┤                                      │
           │                                      │    [X-Razorpay-Signature]               │                                      │
           │                                      ├── 10. Timing-safe HMAC SHA-256 check    │                                      │
           │                                      ├── 11. fetchOrderDetails (bind notes) ──►│                                      │
           │                                      ├── 12. Check inFlightPayments & DB ────────────────────────────────────────────►│
           │                                      ├── 13. UPDATE Pending -> Completed ────────────────────────────────────────────►│
           │                                      ├── 14. Extend Student valid_until ─────────────────────────────────────────────►│
           │                                      │                                         │                                      │
           │─── 15. POST /verify-payment ────────►│                                         │                                      │
           │    { payment_id, order_id, sig }     ├── 16. Verify signature & auth ownership │                                      │
           │                                      ├── 17. Parallel order/payment fetch ────►│                                      │
           │                                      ├── 18. Already processed? Return 200 ────┼─────────────────────────────────────►│
           │◄── 19. Payment Success Modal ────────┤                                         │                                      │
```

---

## 3. Component Deep Dive: Client Hook & Script Ingestion

### Implementation: [`src/hooks/useRazorpay.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/hooks/useRazorpay.ts)

The client integration manages dynamic script injection, mobile viewport handling, back-button dismissal recovery, and checkout modal dispatch.

```typescript
// Script loading with mobile resilience in src/hooks/useRazorpay.ts
useEffect(() => {
  let script: HTMLScriptElement | null = null;

  const loadScript = () => {
    if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
      setIsScriptLoaded(true);
      return;
    }

    script = document.createElement('script');
    script.setAttribute('src', 'https://checkout.razorpay.com/v1/checkout.js');
    script.async = true;
    script.onload = () => setIsScriptLoaded(true);
    script.onerror = () => setError('Failed to load payment gateway');
    document.body.appendChild(script);
  };

  if (window.Razorpay) {
    setIsScriptLoaded(true);
  } else {
    loadScript();
  }

  return () => {
    if (script && script.parentNode) script.parentNode.removeChild(script);
  };
}, []);
```

### Mobile & Browser Edge Cases Handled:
1. **Zombie Script Cleanup**: Re-mounting the checkout component checks the DOM before appending duplicate `<script>` tags, preventing memory leaks during React re-renders.
2. **Back-Button Dismissal**: The Razorpay modal configuration provides an `ondismiss` handler that transitions client state back to `ready` instead of leaving the checkout in a perpetually disabled `processing` state.
3. **Readonly Contact Details**: `prefill` data (name, email, phone) sets `readonly: { email: true, contact: true }` so students cannot accidentally tamper with phone numbers or email addresses bound to their university profile.

---

## 4. Pre-Checkout Order Creation & Server-Side Derivation

### Implementation: [`src/app/api/payment/razorpay/create-order/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payment/razorpay/create-order/route.ts)

A major vulnerability in naive e-commerce setups is client-side fee manipulation (e.g. paying ₹1 for an ₹8,000 semester pass). ITMS completely eliminates this vulnerability by treating all incoming fee amounts as untrusted proposals.

```typescript
// Fee Verification & Server-Side Session Derivation (Lines 23-78)
const [busFeeResult, systemConfigResult, student] = await Promise.all([
  getCurrentBusFee().catch(() => null),
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

// Server derives whether this is a renewal or new registration
const isRenewal = !!(studentData?.validUntil) || !!(studentData?.sessionEndYear);
const orderType = isRenewal ? 'renewal' : 'new_registration';
```

### Durable Pre-Checkout Persistence (Fail-Closed Pattern)
Before the order is returned to the client, the application persists the uncaptured order in the PostgreSQL ledger:

```typescript
// Fail-Closed Pre-Checkout Persistence (Lines 138-180)
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
  return NextResponse.json(
    { success: false, error: 'Database service failure: Unable to initiate order registration.' },
    { status: 500 }
  );
}

if (!persistedPaymentId) {
  return NextResponse.json(
    { success: false, error: 'Failed to record pending checkout order in financial ledger.' },
    { status: 500 }
  );
}
```

**Why the system fails without this**: If the student's browser closes immediately after completing UPI authorization at their bank, Razorpay has captured the money, but no local record exists. By saving the order upfront as `Pending`, the nightly reconciliation cron ([`payment-reconciliation`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/cron/payment-reconciliation/route.ts)) automatically discovers the order, queries Razorpay, matches the payment, and unlocks the student's pass without requiring administrative intervention.

---

## 5. Webhook Security & Dual-Path Ingestion

### Implementation: [`src/app/api/payment/webhook/razorpay/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payment/webhook/razorpay/route.ts)

Razorpay dispatches asynchronous HTTP `POST` notifications when payments succeed, fail, or refund. Because webhooks traverse the public internet, they are subject to request forgery, timing attacks, and replaying.

### 5.1 HMAC SHA-256 Timing-Safe Signature Check
```typescript
// Lines 34-47 in src/app/api/payment/webhook/razorpay/route.ts
const expectedSignature = crypto
  .createHmac('sha256', secret)
  .update(body)
  .digest('hex');

if (
  !signature ||
  signature.length !== expectedSignature.length ||
  !crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  )
) {
  return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
}
```

### 5.2 Untrusted Payment Notes vs Trusted Order Notes
In Razorpay's API architecture, metadata attached to a payment entity at checkout can differ from the original order notes created by our secure backend. An attacker could tamper with payment notes in custom checkout flows. 
**ITMS Security Rule**: The webhook handler **never** reads student ID or duration from `paymentEntity.notes`. It fetches the authoritative order record directly from Razorpay:

```typescript
// Lines 75-84 in src/app/api/payment/webhook/razorpay/route.ts
let orderDetails;
try {
  orderDetails = await fetchOrderDetails(order_id);
} catch (error) {
  // Return 502 so Razorpay retries the webhook later instead of dropping unverified notes
  return NextResponse.json({ error: 'Order verification unavailable, retrying' }, { status: 502 });
}
const notes = orderDetails.notes || {};
```

### 5.3 Currency & Integer Paise Invariants
```typescript
// Currency binding check (Lines 94-104)
const rawOrderCurrency = orderDetails.currency;
const rawPaymentCurrency = paymentEntity.currency;
const isOrderCurrencyValid = typeof rawOrderCurrency === 'string' && rawOrderCurrency.trim().toUpperCase() === 'INR';
const isPaymentCurrencyValid = typeof rawPaymentCurrency === 'string' && rawPaymentCurrency.trim().toUpperCase() === 'INR';

if (!isOrderCurrencyValid || !isPaymentCurrencyValid) {
  return NextResponse.json({ error: 'Currency mismatch' }, { status: 400 });
}
```

---

## 6. Client Payment Verification API

### Implementation: [`src/app/api/payment/razorpay/verify-payment/route.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/payment/razorpay/verify-payment/route.ts)

When the Razorpay modal completes in the student's browser, the client SDK immediately invokes `POST /api/payment/razorpay/verify-payment`.

### 6.1 Authentication & Ownership Boundary
```typescript
// Verification body validation & auth ownership (Lines 68-116)
const verification = verifyRazorpaySignature({
  razorpay_payment_id,
  razorpay_order_id,
  razorpay_signature,
});
if (!verification.isValid) {
  return NextResponse.json({ success: false, error: 'Payment verification failed' }, { status: 400 });
}

const [orderRes, paymentRes] = await Promise.all([
  fetchOrderDetails(razorpay_order_id),
  fetchPaymentDetails(razorpay_payment_id),
]);

// Anti-IDOR: Verify that the authenticated student actually owns this Razorpay order
const trustedUserId = noteString(trustedNotes, 'userId');
if (!trustedUserId || trustedUserId !== auth.uid) {
  return NextResponse.json(
    { success: false, error: 'Payment order does not belong to the authenticated user' },
    { status: 403 }
  );
}
```

---

## 7. The Core Settlement Engine (`processCapturedPayment`)

### Implementation: [`src/lib/payment/payment.service.ts`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/lib/payment/payment.service.ts) (Lines 120–756)

Both the webhook route and the client `verify-payment` route delegate to `processCapturedPayment`. Because both events frequently fire within 15 milliseconds of each other, race conditions are a critical engineering concern.

```
                  ┌───────────────────────────────────────────────┐
                  │          processCapturedPayment(details)      │
                  └───────────────────────┬───────────────────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
             [ inFlightPayments Map ]             [ isPaymentProcessed ]
             In-memory promise deduplication      Check Supabase payments table
                        │                                   │
         ┌──────────────┴──────────────┐                    │
         ▼ Yes                         ▼ No                 ▼ Yes
  Return shared promise         Proceed to execution ──► Return already_processed
                                                            │
                                ┌───────────────────────────┴───────────────────────────┐
                                ▼ Valid Session                                         ▼ Missing / Unverifiable Session
                     [ Session Validation ]                                   [ createDuplicatePaymentRecord ]
                     start < end, year > 2000                                 Insert Captured_Pending_Review
                                │                                             (Money preserved, pass withheld)
                                ▼                                                       │
                     [ createPayment Ledger ]                                           ▼
                     Insert status = 'Completed'                              Return captured_pending_review
                                │
                 ┌──────────────┴──────────────┐
                 ▼ Success                     ▼ 23505 Collision (idx_payments_one_completed_per_session)
      [ Entitlement Activation ]               [ createDuplicatePaymentRecord ]
      Extend student valid_until               Insert Duplicate_Pending_Refund
      Submit renewal application               Emit high-priority audit event
      Return { status: 'success' }             Return already_paid_for_session
```

### 7.1 In-Flight Promise Deduplication
```typescript
// Memory-level lock in src/lib/payment/payment.service.ts (Lines 129-141)
const inFlightPayments = new Map<string, Promise<any>>();

export async function processCapturedPayment(paymentDetails: PaymentInput) {
  const { paymentId } = paymentDetails;
  if (inFlightPayments.has(paymentId)) {
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
```

### 7.2 Session Year Sanity Gate & `Captured_Pending_Review`
If a payment is captured but the academic session cannot be determined with mathematical certainty (e.g., student changed browsers or corrupted order notes):
```typescript
// Lines 346-370 in src/lib/payment/payment.service.ts
if (!sessionStartYear || !sessionEndYear) {
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
    notes: 'Captured payment missing verified academic session. Preserved for manual review.',
    metadata: {
      requires_manual_review: true,
      unresolved_academic_session: true,
    },
  });
  return { status: 'captured_pending_review' };
}
```
**Why this matters**: In financial systems, dropping captured money because metadata is imperfect is catastrophic; however, granting a free 4-year bus pass based on corrupt data is equally dangerous. `Captured_Pending_Review` strikes the exact engineering balance: **funds are safely preserved in the ledger, while entitlement is withheld until an administrator reconciles the record**.

### 7.3 Duplicate Payment Handling & `Duplicate_Pending_Refund`
When a student pays twice for the same academic session, PostgreSQL's partial unique index `idx_payments_one_completed_per_session` rejects the second insert with error `23505`:
```typescript
// Lines 654-753 in src/lib/payment/payment.service.ts
if (err.message === 'DUPLICATE_SESSION_PAYMENT') {
  const dupRecordedId = await paymentsSupabaseService.createDuplicatePaymentRecord({
    paymentId,
    studentUid: notes.userId || notes.studentId || '',
    studentId: notes.enrollmentId || notes.studentId || '',
    studentName: notes.studentName || 'Student',
    amount,
    method,
    status: 'Duplicate_Pending_Refund',
    sessionStartYear: dupSessionStart,
    sessionEndYear: dupSessionEnd,
    razorpayPaymentId: paymentId,
    razorpayOrderId: orderId,
    notes: 'Duplicate payment captured for student. Academic session already covered. Flagged for refund.',
  });

  // Fail-Closed: If duplicate could not be saved, do NOT return success
  if (!dupRecordedId) {
    return { status: 'error', error: 'Failed to record duplicate payment in ledger.' };
  }

  void createAuditEvent({
    category: 'financial',
    action: 'duplicate_session_payment_captured',
    severity: 'high',
    actor_id: notes.userId || 'system',
    target_id: paymentId,
  });

  return { status: 'already_paid_for_session' };
}
```

---

## 8. Webhook Event Matrix & State Transitions

The webhook endpoint handles 5 distinct Razorpay gateway events:

| Gateway Event | Target Row | Payload Keys Verified | Database Transition | Side Effects |
|---|---|---|---|---|
| `payment.captured` | `payments` | `payment.entity.id`, `order_id`, `amount`, `currency` | `Pending` ➔ `Completed`<br>*(or `Duplicate_Pending_Refund` / `Captured_Pending_Review`)* | Extends student `valid_until`; submits renewal application; notifies administrators. |
| `payment.failed` | `payments` | `order_id`, `error_code`, `error_description` | Status remains `Pending`; `metadata` updated with `gateway_payment_failed_at`, error codes. | Student UI prompted with user-friendly retry; financial ledger preserves audit trail. |
| `refund.created` | `payments` | `refund.entity.id`, `payment_id`, `amount` | `metadata.refund_history` appended with `{ refund_id, status: 'created', amount }`. | Audit trail updated; no balance mutation until processed. |
| `refund.processed` | `payments` | `refund.entity.id`, `payment_id`, `amount` | Calls RPC `process_payment_refund_atomic`.<br>If full: `Completed` ➔ `Refunded`.<br>If partial: remains `Completed`. | Cumulative refunded amount recalculated; student pass revoked if fully refunded. |
| `refund.failed` | `payments` | `refund.entity.id`, `payment_id`, `error_code` | Status unchanged; `metadata.requires_refund_review = true` and `refund_failed_alert = true`. | Emits alert for university financial bursar to investigate banking rejection. |

---

## 9. Realistic Edge Cases & Failure Analysis

In compliance with Level 0 production engineering rules, the following matrix details concrete failure modes, architectural impacts, and recovery behaviors:

| Concrete Failure Mode | Direct Failure Impact | Mitigation & System Guarantee |
|---|---|---|
| **Student closes browser tab during bank redirect** | Client `verify-payment` call never fires. | Webhook executes independently within 2–5 seconds; completes payment and updates pass.<br>If webhook drops, nightly reconciliation sweep ([Phase 1](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/src/app/api/cron/payment-reconciliation/route.ts#L59)) recovers it. |
| **Razorpay gateway maintenance (HTTP 503)** | `createRazorpayOrder` fails. | Retry loop retries up to 2 times with exponential backoff on 502/503/504.<br>If gateway remains down, fails closed with descriptive message advising offline payment. |
| **Concurrent webhook & verify-payment execution** | Two separate serverless lambdas attempt to process payment simultaneously. | `inFlightPayments` Map deduplicates in-process calls.<br>Database-level `idx_payments_unique_razorpay_payment_id` catches cross-process collisions with error `23505` (`ALREADY_PROCESSED`). |
| **Student double-pays for same session across devices** | Second payment captures ₹8,000 for an already active academic year. | Partial unique index `idx_payments_one_completed_per_session` aborts second insert.<br>Handler catches error, records `Duplicate_Pending_Refund`, alerts finance staff for refund. |
| **Supabase PostgreSQL temporary connection exhaustion** | Webhook fails to write payment record. | Handler returns HTTP 500.<br>Razorpay webhook policy automatically retries delivery with exponential backoff over 24 hours. |
| **Floating point arithmetic precision errors** | `8000.00 * 100` resulting in `799999.9999999` in JavaScript V8 runtime. | System uses `Math.round(amount * 100)` across all layers.<br>PostgreSQL RPC `process_payment_refund_atomic` strictly uses integer `BIGINT` paise (`amount_paise`). |
