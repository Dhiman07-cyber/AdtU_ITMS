# Bus Fees, Pricing Engine & Financial Verification

## 1. Architectural Philosophy: Server-Authoritative Pricing

Financial integrity in Assam down town University (AdtU) ITMS requires that all fee calculations, order creations, and payment validations remain **100% server-authoritative**:
- **Zero Client Trust:** Pricing is never accepted from client-side form payloads or frontend state.
- **No Fallback Guarantee (`getCurrentBusFee`):** If bus fee configuration is missing or non-numeric in the database, the system throws an explicit error and fails closed. The system never falls back to hardcoded default values for financial transactions.
- **Immutable Transaction Ledger:** Every fee settlement (online Razorpay or offline bank challan) produces an immutable record in `public.payments`.

```
        ┌────────────────────────────────────────────────────────┐
        │            ADMIN CONFIG: `settings/config`             │
        │      busFee: { amount: 8000, version: 3, ... }         │
        └──────────────────────────┬─────────────────────────────┘
                                   │
                                   ▼
        ┌────────────────────────────────────────────────────────┐
        │          STUDENT RENEWAL / ADMISSION CHECKOUT          │
        │           POST /api/student/renew-service-v2           │
        └──────────────────────────┬─────────────────────────────┘
                                   │
                                   ▼
        ┌────────────────────────────────────────────────────────┐
        │             SERVER-SIDE PRICE CALCULATION              │
        │        const busFee = await getCurrentBusFee();        │
        │        const totalFee = busFee.amount * durationYears; │
        └──────────────────────────┬─────────────────────────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 ▼                                   ▼
       Online Payment Mode                  Offline Payment Mode
        (Razorpay Gateway)                   (Challan / Receipt)
                 │                                   │
                 ▼                                   ▼
    Razorpay Order Created:                 Application Held in Queue:
    - Amount in paise (totalFee * 100)      - Uploads receipt image
    - HMAC signature verified on webhook    - Moderator verifies bank ref
                 │                                   │
                 └─────────────────┬─────────────────┘
                                   │
                                   ▼
        ┌────────────────────────────────────────────────────────┐
        │              IMMUTABLE PAYMENT COMMIT                  │
        │     PostgreSQL `payments` Table (Status: verified)     │
        │     Student Pass Validity Extended via Domain API      │
        └────────────────────────────────────────────────────────┘
```

---

## 2. Bus Fee Configuration Schema & Management

The authoritative bus fee is persisted in the Firestore `settings/config` document under `busFee`:

```typescript
export interface BusFeeData {
  amount: number;         // Current fee per academic session (e.g. 8000)
  updatedAt: string;      // ISO 8601 timestamp of last revision
  updatedBy: string;      // Admin UID who committed the change
  version: number;        // Monotonically increasing revision counter
  history?: Array<{      // Capped audit log of previous 3 rates
    amount: number;
    updatedAt: string;
    updatedBy: string;
    version: number;
  }>;
}
```

### 2.1 Updating Bus Fees (`POST /api/settings/bus-fees`)
Only authenticated Administrators (`role: 'admin'`) can revise transit fees:
1. **Schema Validation:** Evaluates payload against `BusFeeUpdateSchema` (`amount >= 1`).
2. **Version Bump & History Truncation:**
   - Previous rate is appended to `history`.
   - The history array is capped at the 3 most recent adjustments to prevent document bloat.
   - Increments `version = version + 1`.
3. **Automated Announcement Broadcast (`notifyBusFeeChange`):**
   - Automatically dispatches a system-wide announcement notification to all registered users:
     `"The bus fee for the upcoming session has been revised from ₹{oldAmount} to ₹{newAmount}. Please update your payment plans accordingly."`
   - Emits an audit event: `action: 'bus_fee_updated'`.

---

## 3. Online Razorpay Checkout Lifecycle

When a student pays transit fees online:
1. **Order Initialization (`/api/student/renew-service-v2` or `/api/payments/create-order`):**
   - Fetches authoritative `currentBusFee` from database.
   - Calculates `totalFee = currentBusFee * durationYears`.
   - Generates Razorpay Order via `createRazorpayOrder(totalFee, receipt, { studentUid, ... })`.
2. **Cryptographic Webhook & Signature Verification:**
   - On payment capture, client submits `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`.
   - Server validates HMAC-SHA256 signature using `RAZORPAY_KEY_SECRET`.
   - Prevents client tampering with payment confirmation payloads.
3. **Idempotent Settlement:**
   - Database checks `payments.payment_id` for duplicate transactions.
   - Records transaction in `public.payments` with `status = 'verified'`.
   - Calls `applyPaymentValidity(studentUid, ...)` to extend pass validity.

---

## 4. Offline Payment Verification Workflow

Students paying through bank challan, NEFT/RTGS, or university cash counters submit offline applications:
1. **Receipt Submission:**
   - Student enters offline transaction reference ID and uploads a photograph of the bank receipt/challan.
   - Application enters `submitted` state with `verifiedBy = 'system_offline_submission_bypass'`.
2. **Moderator Verification & Permission Guard:**
   - Offline verification is gated by `requireModeratorPermission(auth, 'payments', 'canApproveOffline')`.
   - Default moderators cannot verify or approve offline payments.
3. **Approval Execution:**
   - Authorized reviewer cross-checks uploaded receipt against the university bank statement.
   - On approval, creates a `payments` row with `payment_mode = 'offline'`, `verified_by = approverUid`, and `status = 'verified'`.
   - If payment is rejected, the student is notified with the reason and prompted to re-upload.
