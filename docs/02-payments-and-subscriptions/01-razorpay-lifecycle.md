# Razorpay Payment Lifecycle & Webhook Verification

## 1. Architecture & Immutability Rules

The ITMS payment infrastructure integrates with **Razorpay** to process semester and annual bus transportation fees for Assam Down Town University students.

### Core Architectural Invariants
1. **Single Source of Truth**: All payment records are persisted exclusively in Supabase PostgreSQL (`payments` table).
2. **Strict Immutability**: Payment records are append-only financial logs. Once a payment is created or captured, it **cannot be deleted or overwritten**.
3. **Idempotency**: Webhook retries and duplicate student payment submissions are safely deduplicated using `razorpay_payment_id` and unique transaction identifiers.

```
+----------------------------------------------------------------------------------------------------+
|                                    RAZORPAY INTEGRATION LIFECYCLE                                   |
+----------------------------------------------------------------------------------------------------+

  [ Student Browser ]               [ Next.js API Layer ]        [ Razorpay Gateway ]      [ PostgreSQL DB ]
           │                                 │                            │                       │
           ├── 1. POST /api/payment/create ─►│                            │                       │
           │   { amount, studentId }         ├── 2. razorpay.orders.create►│                       │
           │                                 │◄── 3. order_id returned ───┤                       │
           │◄── 4. Return order_id ──────────┤                            │                       │
           │                                 │                            │                       │
           ├── 5. User Enters Payment Info ──────────────────────────────►│                       │
           │      (Card/UPI/NetBanking)      │                            │                       │
           │                                 │                            ├── 6. Webhook POST ───►│
           │                                 │◄── payment.captured ───────┤      /api/payment/    │
           │                                 │   [X-Razorpay-Signature]   │      webhook          │
           │                                 │                            │                       │
           │                                 ├── 7. Verify HMAC SHA-256   │                       │
           │                                 ├── 8. Check Idempotency ───────────────────────────►│
           │                                 │      (isPaymentProcessed)  │                       │
           │                                 ├── 9. Insert Immutable Payment Record ─────────────►│
           │                                 ├── 10. Update Student Valid Until ─────────────────►│
           │◄── 11. Payment Success Modal ───┤                            │                       │
```

---

## 2. Webhook Signature Verification

Payment completion relies on asynchronous server-to-server webhooks dispatched by Razorpay (`payment.captured`, `order.paid`). To prevent request spoofing, the webhook handler validates the signature using the pre-shared `RAZORPAY_WEBHOOK_SECRET`:

```typescript
// Webhook Signature Verification Algorithm
import crypto from 'crypto';

export function verifyRazorpaySignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): boolean {
  if (!signatureHeader || !webhookSecret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'utf8'),
    Buffer.from(signatureHeader, 'utf8')
  );
}
```

---

## 3. Idempotent Payment Ingestion (`src/lib/payment/payment.service.ts`)

When Razorpay dispatches a captured payment, `createOnlinePayment` creates an immutable record and auto-approves the transaction:

```typescript
// src/lib/payment/payment.service.ts

export async function createOnlinePayment(
  request: CreateOnlinePaymentRequest
): Promise<OnlinePaymentDocument> {
  const now = new Date();
  const paymentId = request.razorpayPaymentId || generateOnlinePaymentId(request.purpose);

  const paymentDoc: OnlinePaymentDocument = {
    paymentId,
    studentId: request.studentId,
    studentUid: request.studentUid,
    studentName: request.studentName || 'Student',
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

  // Writes to Supabase PostgreSQL payments table (IMMUTABLE)
  await paymentsSupabaseService.createPayment({
    paymentId,
    studentId: request.studentId,
    studentUid: request.studentUid,
    studentName: request.studentName || 'Unknown',
    amount: request.amount,
    method: 'Online',
    status: 'Completed',
    sessionStartYear: request.sessionStartYear,
    sessionEndYear: request.sessionEndYear,
    durationYears: request.durationYears,
    validUntil: typeof request.validUntil === 'string' ? new Date(request.validUntil) : request.validUntil,
    transactionDate: now,
    razorpayPaymentId: request.razorpayPaymentId,
    razorpayOrderId: request.razorpayOrderId,
    approvedBy: { type: 'SYSTEM' },
  });

  return paymentDoc;
}
```

---

## 4. Status Machine & Transitions

```
                    ┌────────────────────────────┐
                    │      INITIALIZED           │
                    │ (Razorpay Order Generated) │
                    └─────────────┬──────────────┘
                                  │
                   ┌──────────────┴──────────────┐
                   ▼ Webhook captured            ▼ User cancelled / timed out
        ┌────────────────────────────┐    ┌────────────────────────────┐
        │         COMPLETED          │    │          FAILED            │
        │  - Immutable row in DB     │    │  - No entitlement granted  │
        │  - Extends student pass    │    │  - Student may retry       │
        │  - Generates receipt PDF   │    └────────────────────────────┘
        └────────────────────────────┘
```

- **Reversal / Refund Policy**: In the event of a refund, the original `Completed` transaction is **never** deleted. A counter-entry or refund adjustment event is recorded in the audit logs.
