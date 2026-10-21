# docs/02-payments-and-subscriptions: Payments, Subscriptions & Financial Ledger

**Module Status:** PRODUCTION-HARDENED & AUDITED  
**Target Environment:** Node.js 26 | Next.js 16.3.0 App Router | Supabase PostgreSQL 16 | Razorpay API v1  
**Security Baseline:** OWASP ASVS 5.0.0 Level 2 / Level 3 | Indian Payment Gateway Standard  

---

## 1. Executive Summary

This directory contains the authoritative Low-Level Design (LLD), database schema contracts, cryptographic protocols, failure mode analyses, and quantitative database query accounting for the financial subsystem of the **Assam down town University Intelligent Transport Management System (ADTU ITMS)**.

The financial subsystem handles both online digital transactions (Razorpay UPI, Netbanking, Cards) and institutional offline payments (Bank Challans, Cash Counter receipts) for thousands of university commuters paying semester transit fees (typically ₹18,000–₹32,500 per term).

```text
                             02-PAYMENTS-AND-SUBSCRIPTIONS ROADMAP
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │ 01-razorpay-lifecycle.md                                                               │
 │ Complete online payment pipeline: client SDK initialization (useRazorpay.ts), pre-     │
 │ checkout persistence (/api/payment/create-order), timing-safe HMAC SHA-256 validation, │
 │ webhook racing deduplication, duplicate/under-review states, and failure recovery.     │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ 02-ledger-and-renewals.md                                                              │
 │ Financial ledger schema, AES-256-GCM PII encryption, immutable trigger engine          │
 │ (protect_completed_payments), offline zero-precreation workflow, term rollover math,   │
 │ atomic seat reclamation (approve_renewal_with_seat), and atomic refunds.               │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ 03-payment-query-audit-and-accounting.md                                               │
 │ Quantitative forensic accounting: exact SQL SELECT, INSERT, UPDATE, RPC, and external │
 │ HTTP calls per operation, per person, per page, with index coverage and audit trail.   │
 ├────────────────────────────────────────────────────────────────────────────────────────┤
 │ PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md                                           │
 │ The authoritative 14,000+ line forensic codebase truth extraction covering all payment │
 │ events P1-P10, chaos remediations, ledger immutability triggers, and release freeze.   │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Navigation & Reading Guide

| Document | Focus & Scope | Core Code References |
|---|---|---|
| **[01-razorpay-lifecycle.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/01-razorpay-lifecycle.md)** | **Online Payment Flow & Telematics** | Dynamic pricing engine, checkout initiation, HMAC validation, and dual-path webhook processing (`src/app/api/payments/`, `src/hooks/useRazorpay.ts`). |
| **[02-ledger-and-renewals.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/02-ledger-and-renewals.md)** | **Ledger Invariants & Pass Entitlements** | Double-entry ledger immutability, `approve_renewal_with_seat`, entitlement gate, and refunds (`src/domains/student/`, `COMPLETE_SCHEMA.sql`). |
| **[03-payment-query-audit-and-accounting.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/03-payment-query-audit-and-accounting.md)** | **Database Query Audit & Accounting** | Detailed breakdown of all database round-trips for Events P1 through P10, student checkout funnels, admin verification desks, and background reconciliation crons. |
| **[04-offline-challan-and-moderator-workflow.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/04-offline-challan-and-moderator-workflow.md)** | **Offline Bank Challan & Counter Receipts** | Offline bank challans, counter receipts, moderator verification queue, document audit, and approval RPCs (`src/app/api/payments/offline/`, `src/domains/payment/`). |
| **[05-digital-boarding-pass-and-qr-issuance.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/05-digital-boarding-pass-and-qr-issuance.md)** | **Digital Boarding Pass & Cryptographic QR** | Boarding pass generation, 128-bit cryptographic QR tokens, client-side PDF download, and 4-gate scanner verification (`src/app/student/pass/page.tsx`, `BoardingPassCard.tsx`). |
| **[06-academic-lifecycle-crons-and-retention.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/06-academic-lifecycle-crons-and-retention.md)** | **Automated Expiry Crons & Retention** | Daily lifecycle crons, session activation, 7d/3d expiry warnings, soft-block seat reclaim, and hard cascade deletion (`src/app/api/cron/cleanup-expired-students/`). |
| **[07-database-schema-and-rpc-reference.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/07-database-schema-and-rpc-reference.md)** | **Financial Ledger Schema & Atomic RPCs** | Relational schema, immutable ledger triggers (`protect_completed_payments`), check constraints, and stored procedures (`COMPLETE_SCHEMA.sql`). |
| **[08-chaos-hardening-and-verification-gates.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/08-chaos-hardening-and-verification-gates.md)** | **Chaos Hardening & Verification Gates** | 16-point chaos hardening, payment network failure recovery matrix, 12 cross-pillar integration seam remediations, and permanent production freeze. |
| **[PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md](file:///c:/Users/ADMIN/Desktop/Projects/ITMS/docs/02-payments-and-subscriptions/PAYMENT_LIFECYCLE_FORENSIC_CODEBASE_TRUTH.md)** | **Consolidated Master Reference** | Scheduled for archival after child file transition verification. |

---

## 3. High-Impact Architectural Highlights

### A. The 6 Non-Negotiable Payment Invariants
1. **INV-PAY-01 (Pre-Checkout Persistence)**: Order ID and pending payment intent must be persisted in `public.payments` before the Razorpay Modal opens. No order may exist on Razorpay servers without an internal row.
2. **INV-PAY-02 (Timing-Safe Cryptographic Validation)**: All signatures (`verifyPaymentSignature` and `verifyWebhookSignature`) are validated with constant-time equality checks (`crypto.timingSafeEqual`) to prevent side-channel timing attacks.
3. **INV-PAY-03 (Ledger Immutability Trigger)**: `protect_completed_payments()` blocks `DELETE` on finalized/audit payment rows and prohibits mutation of `amount`, `currency`, `method`, `student_uid`, or `razorpay_payment_id`.
4. **INV-PAY-04 (Offline Zero Pre-Creation)**: Offline challans and counter submissions create records in `public.applications`, but never pre-create unverified rows in `public.payments`. The payment record is created only when a verified moderator signs the approval.
5. **INV-PAY-05 (Seat Reclamation Safety)**: When soft-blocked students pay to renew, `applyPaymentValidity()` throws `SeatReclaimRequiredError` if their seat was previously surrendered. The transaction must execute `approve_renewal_with_seat` to acquire row-level locks on `buses` before reclaiming capacity.
6. **INV-PAY-06 (Atomic Cumulative Refunds)**: Multi-step partial or full refunds execute via `process_payment_refund_atomic`, locking the payment row `FOR UPDATE` and checking cumulative refunded paise against the gross capture amount before appending an immutable ledger event.

### B. Realistic Engineering Posture: Bounded Failure Handling
In accordance with production engineering standards, the system rejects claims of theoretical invulnerability and instead implements explicit, observable recovery loops:
- **Client Network Drop after UPI Debit**: Solved via Razorpay server-to-server webhook ingestion + User Self-Healing `/api/payment/recover` endpoint + Nightly 3-phase reconciliation cron.
- **Webhook vs Client Race Condition**: Managed by in-flight in-memory promise locking and database partial unique constraint `idx_payments_unique_razorpay_payment_id` returning error `23505`.
- **Soft-Blocked Commuter Renewal Overcapacity**: Solved by throwing `SeatReclaimRequiredError`, redirecting the student to the Route Selection desk, and keeping payment safely stored under `Completed` with `pending_seat_reclaim` status.
