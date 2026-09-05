# Financial Ledger & Bus Pass Renewal Lifecycle

## 1. Bus Pass Validity & Entitlement Model

Bus pass access in ITMS is governed by an academic calendar ledger. Each enrolled student record in `student_profiles` carries explicit entitlement timestamps:

| Column | Data Type | Business Meaning |
| :--- | :--- | :--- |
| `valid_until` | `TIMESTAMPTZ` | The date through which transportation fees are paid in full. |
| `soft_block` | `TIMESTAMPTZ` | Grace period threshold. When passed, student receives warnings on pass scan but may still board. |
| `hard_block` | `TIMESTAMPTZ` | Absolute cutoff date. When passed, driver boarding scanner displays `DENIED` and blocks vehicle entry. |
| `session_start_year` | `INTEGER` | Academic year start (e.g. `2026`). |
| `session_end_year` | `INTEGER` | Academic year end (e.g. `2027`). |

---

## 2. Pass Renewal Workflow

```
[ Active Student ] ──► [ Approaching Expiry ] ──► [ Soft Block Window ] ──► [ Hard Block / Inactive ]
 (valid_until > now)     (Notification dispatched) (Grace period active)       (Boarding Denied)
                                │
                                ▼ Student clicks /student/renew
                       +─────────────────────────────────+
                       | Payment Checkout / Offline Slip |
                       +────────────────┬────────────────+
                                        │
                         ┌──────────────┴──────────────┐
                         ▼ Online Razorpay             ▼ Offline Bank Deposit
               [ Webhook Auto-Approval ]     [ Moderator Review & Approval ]
                         │                             │
                         └──────────────┬──────────────┘
                                        ▼
                       +─────────────────────────────────+
                       | applyPaymentValidity()          |
                       | - valid_until extended to next  |
                       |   academic session end date     |
                       | - soft/hard blocks reset        |
                       | - Digitally signed receipt      |
                       +─────────────────────────────────+
```

---

## 3. Offline Payment & Moderator Ledger Approval

For students who pay tuition or transport fees via offline bank challans, moderators or financial administrators review the deposit receipt before granting entitlement:

```typescript
// src/lib/payment/payment.service.ts

export async function approveOfflinePayment(
  paymentId: string,
  approverInfo: { userId: string; name: string; empId?: string; role: string }
): Promise<boolean> {
  const supabase = getSupabaseServer();

  // 1. Fetch payment record
  const payment = await paymentsSupabaseService.getPaymentById(paymentId);
  if (!payment || payment.status !== 'Pending') {
    throw new Error('Payment not found or already processed');
  }

  // 2. Compute academic validity dates
  const newValidUntil = calculateValidUntilDate(
    payment.sessionEndYear || new Date().getFullYear() + 1
  );

  // 3. Update payment status to Completed (IMMUTABLE record updated in place)
  await paymentsSupabaseService.updatePaymentStatus(paymentId, 'Completed', {
    ...approverInfo,
    approvedAt: new Date(),
  });

  // 4. Update student profile with new validity
  await applyPaymentValidity(payment.studentUid, {
    validUntil: newValidUntil,
    sessionStartYear: payment.sessionStartYear,
    sessionEndYear: payment.sessionEndYear,
  });

  return true;
}
```

---

## 4. Automated Expiry & Scheduled Jobs

Transportation validity is monitored by automated Vercel Cron routes configured in [`vercel.json`](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/vercel.json):

1. `/api/cron/expiry-check?type=main`:
   - Runs on the 1st of March, April, and June.
   - Evaluates upcoming graduations and semester transitions.
   - Dispatches FCM push notifications and emails alerting students to renew.
2. `/api/cron/cleanup-expired-students`:
   - Runs daily at midnight.
   - Identifies students past their `hard_block` threshold and updates status from `active` to `expired`.
3. `/api/cron/session-activation`:
   - Activates upcoming academic sessions, transitioning verified renewal applications into the active student roster.
