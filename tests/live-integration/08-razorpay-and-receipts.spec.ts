/**
 * tests/live-integration/08-razorpay-and-receipts.spec.ts
 *
 * STAGE 9: RAZORPAY TEST MODE & CRYPTOGRAPHIC RECEIPT VERIFICATION BATTERY
 *
 * Combines and unifies:
 * Part A: Live Razorpay Test Mode Gateway Integration
 *   1. Test order creation on Razorpay gateway
 *   2. Order details fetch and verification
 *   3. HMAC-SHA256 signature verification (timingSafeEqual)
 *   4. Rejection of tampered signatures & payload mismatch
 *
 * Part B: Cryptographic Receipt Integrity & Secure QR (V2 / V1)
 *   1. Non-completed payments refuse signature issuance
 *   2. RSA-2048 document payload signing and verification
 *   3. Anti-tamper verification (altered amount/student breaks signature)
 *   4. Secure QR (V2) token generation and integrity validation
 *   5. Legacy (V1 HMAC-SHA256) receipt signature verification
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import crypto from 'crypto';

const ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(ROOT, '.env.local') });
dotenv.config({ path: path.join(ROOT, '.env') });

import {
  createRazorpayOrder,
  fetchOrderDetails,
  verifyRazorpaySignature,
} from '../../src/lib/payment/razorpay.service';

import { ensureReceiptSignature } from '../../src/lib/services/receipt.service';
import {
  DocumentCryptoService,
  buildDocumentPayloadFromPayment,
  generateSecureQRData,
  parseSecureQRData,
  verifyReceiptIntegrity,
} from '../../src/lib/security/document-crypto.service';
import {
  generateReceiptSignature,
  verifyReceiptSignature,
  quickValidateReceiptToken,
} from '../../src/lib/security/receipt-security.service';
import type { PaymentRecord } from '../../src/lib/services/payments-supabase';

async function main() {
  console.log('\n===============================================================');
  console.log('  STAGE 9: RAZORPAY TEST MODE & CRYPTOGRAPHIC RECEIPT BATTERY');
  console.log('===============================================================\n');

  let passCount = 0;
  let failCount = 0;

  function assert(name: string, condition: boolean, extra?: any) {
    if (condition) {
      console.log(`  [PASS] ${name}`);
      passCount++;
    } else {
      console.error(`  [FAIL] ${name}`, extra || '');
      failCount++;
    }
  }

  // =========================================================================
  // PART A: RAZORPAY TEST MODE GATEWAY VERIFICATION
  // =========================================================================
  console.log('--- PART A: Live Razorpay Test Mode Verification ---');
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

  const isTestMode = keyId.startsWith('rzp_test_');
  assert('Razorpay API credentials present in test mode', Boolean(keyId && keySecret && isTestMode));

  if (isTestMode && keySecret) {
    try {
      const testReceipt = `rcpt_test_${Date.now()}`;
      const testNotes = {
        test: 'true',
        purpose: 'live_integration_stage_9',
        environment: 'staging',
        timestamp: new Date().toISOString(),
      };

      // 1. Create real order on Razorpay Test Gateway
      const order = await createRazorpayOrder(100, testReceipt, testNotes); // 100 INR = 10000 paise
      assert('Razorpay order created successfully', Boolean(order && order.id && order.id.startsWith('order_')));
      assert('Order amount matches 10000 paise', order.amount === 10000);
      assert('Order receipt matches input', order.receipt === testReceipt);

      // 2. Fetch order back from gateway
      const fetchedOrder = await fetchOrderDetails(order.id);
      assert('Fetched order details from live gateway', Boolean(fetchedOrder && fetchedOrder.id === order.id));
      assert('Fetched order status is created', fetchedOrder.status === 'created');

      // 3. HMAC-SHA256 Signature Verification
      const mockPaymentId = `pay_mock_${Date.now()}`;
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${order.id}|${mockPaymentId}`)
        .digest('hex');

      const isSigValid = verifyRazorpaySignature({
        razorpay_order_id: order.id,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: expectedSignature,
      });
      assert('Valid HMAC-SHA256 signature accepted', isSigValid.isValid === true);

      // 4. Reject tampered signature
      const tamperedSig = expectedSignature.slice(0, -4) + 'abcd';
      const isTamperedRejected = verifyRazorpaySignature({
        razorpay_order_id: order.id,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: tamperedSig,
      });
      assert('Tampered HMAC signature rejected', isTamperedRejected.isValid === false);

      // 5. Reject mismatched order/payment ID
      const isMismatchedRejected = verifyRazorpaySignature({
        razorpay_order_id: 'order_wrong_123',
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: expectedSignature,
      });
      assert('Mismatched order ID rejected', isMismatchedRejected.isValid === false);
    } catch (err: any) {
      assert('Razorpay Gateway interaction succeeded without unhandled exception', false, err.message);
    }
  }

  // =========================================================================
  // PART B: CRYPTOGRAPHIC RECEIPT & QR VERIFICATION
  // =========================================================================
  console.log('\n--- PART B: Cryptographic Receipt Authenticity & QR Invariants ---');

  // 1. Invariant: Non-completed payments refuse signature issuance
  const pendingPayment: Partial<PaymentRecord> = {
    payment_id: `TEST_PENDING_${Date.now()}`,
    status: 'Pending',
    amount: 5000,
  };
  const pendingResult = await ensureReceiptSignature(pendingPayment as PaymentRecord);
  assert('ensureReceiptSignature refuses Pending payment', !pendingResult.ok && pendingResult.status === 'not_completed');

  const refundedPayment: Partial<PaymentRecord> = {
    payment_id: `TEST_REFUNDED_${Date.now()}`,
    status: 'Refunded',
    amount: 5000,
  };
  const refundedResult = await ensureReceiptSignature(refundedPayment as PaymentRecord);
  assert('ensureReceiptSignature refuses Refunded payment', !refundedResult.ok && refundedResult.status === 'not_completed');

  // 2. Completed Payment: Valid signature generation & verification
  const completedPayment: PaymentRecord = {
    id: 'pay_rec_stage9',
    payment_id: `rcpt_completed_${Date.now()}`,
    student_uid: 'stu_uid_stage9',
    student_id: 'ADTU2026CS001',
    student_name: 'Bhaskar Jyoti',
    amount: 12000,
    currency: 'INR',
    method: 'Online',
    status: 'Completed',
    session_start_year: 2026,
    session_end_year: 2027,
    duration_years: 1,
    valid_until: '2027-06-30T23:59:59.000Z',
    created_at: '2026-10-10T10:00:00.000Z',
    transaction_date: '2026-10-10T10:00:00.000Z',
    razorpay_payment_id: 'pay_test_stage9',
    razorpay_order_id: 'order_test_stage9',
  };

  const payload = buildDocumentPayloadFromPayment(completedPayment);
  const docSignature = DocumentCryptoService.signDocumentPayload(payload);
  const isValidSignature = DocumentCryptoService.verifyDocumentSignature(payload, docSignature);
  assert('DocumentCryptoService correctly signs and verifies Completed payment payload', isValidSignature);

  // 3. Anti-Tamper: Altered payload breaks cryptographic signature
  const tamperedPayload = { ...payload, amount: 500 };
  const isTamperedAccepted = DocumentCryptoService.verifyDocumentSignature(tamperedPayload, docSignature);
  assert('Altered payment amount (12000 -> 500) fails signature verification', !isTamperedAccepted);

  const tamperedStudentPayload = { ...payload, studentId: 'ADTU2026CS999' };
  const isTamperedStudentAccepted = DocumentCryptoService.verifyDocumentSignature(tamperedStudentPayload, docSignature);
  assert('Altered student ID fails signature verification', !isTamperedStudentAccepted);

  // 4. Secure QR Code Token (V2)
  const qrToken = generateSecureQRData(payload, docSignature);
  const parsedQR = parseSecureQRData(qrToken);
  assert('Secure QR token generated and parsed accurately', Boolean(parsedQR && parsedQR.rid === completedPayment.payment_id));

  const integrityCheck = verifyReceiptIntegrity(payload, docSignature, parsedQR!.sig);
  assert('verifyReceiptIntegrity confirmed document payload against QR signature', integrityCheck.valid);

  const tamperedQRToken = qrToken.slice(0, -2) + 'XX';
  const parsedTamperedQR = parseSecureQRData(tamperedQRToken);
  const tamperedIntegrity = parsedTamperedQR
    ? verifyReceiptIntegrity(payload, docSignature, parsedTamperedQR.sig)
    : { valid: false };
  assert('Tampered QR token rejected by verifyReceiptIntegrity', !tamperedIntegrity.valid);

  // 5. Legacy Receipt Token (V1 HMAC-SHA256)
  const v1Token = generateReceiptSignature(
    completedPayment.payment_id,
    completedPayment.student_uid!,
    completedPayment.student_name,
    completedPayment.student_id,
    completedPayment.amount,
    'Online',
    '2026-2027'
  );
  const isV1QuickValid = quickValidateReceiptToken(v1Token);
  const v1Payload = verifyReceiptSignature(v1Token);
  assert('V1 HMAC token generated, validated, and verified', Boolean(isV1QuickValid && v1Payload && v1Payload.receiptId === completedPayment.payment_id));

  console.log('\n===============================================================');
  console.log(`  STAGE 9 SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('===============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled fatal error in Stage 9 Battery:', err);
  process.exit(1);
});
