import { describe,expect,it } from 'vitest';
import {
	generateSecureQRData,
	parseSecureQRData,
	signDocumentPayload,
	verifyReceiptIntegrity,
	type DocumentPayload,
} from '../document-crypto.service';

const payload: DocumentPayload = {
  receiptId: 'pay_test_123',
  studentUid: 'student_uid_1',
  studentName: 'Test Student',
  enrollmentId: 'ADTU-001',
  amount: 12000,
  method: 'Offline',
  sessionStartYear: '2026',
  sessionEndYear: '2027',
  validUntil: '2027-06-30T00:00:00.000Z',
  transactionDate: '2026-06-08T10:00:00.000Z',
  offlineTransactionId: 'upi-ref-1',
  approvedBy: 'Approver',
};

describe('document crypto receipt integrity', () => {
  it('verifies a valid canonical receipt payload and QR signature prefix', () => {
    const signature = signDocumentPayload(payload);
    const token = generateSecureQRData(payload, signature);
    const qrData = parseSecureQRData(token);

    expect(qrData?.rid).toBe(payload.receiptId);
    expect(qrData?.ver).toBe(2);

    const result = verifyReceiptIntegrity(payload, signature, qrData?.sig);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('valid');
  });

  it('rejects tampered canonical receipt payloads', () => {
    const signature = signDocumentPayload(payload);
    const token = generateSecureQRData(payload, signature);
    const qrData = parseSecureQRData(token);

    const result = verifyReceiptIntegrity(
      { ...payload, amount: payload.amount + 1 },
      signature,
      qrData?.sig
    );

    expect(result.valid).toBe(false);
    expect(result.status).toBe('signature_mismatch');
  });

  it('rejects malformed v2 QR payloads', () => {
    expect(parseSecureQRData('ADTU-R2-not-valid-json')).toBeNull();
    expect(parseSecureQRData('not-a-receipt')).toBeNull();
  });
});
