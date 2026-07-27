import { describe,expect,it,vi } from 'vitest';

vi.mock('@/lib/payment/payment.service', () => ({
  createOnlinePayment: vi.fn(),
  processCapturedPayment: vi.fn().mockResolvedValue({ status: 'success' }),
  createOfflinePaymentAtApproval: vi.fn(),
  approveOfflinePayment: vi.fn(),
  rejectOfflinePayment: vi.fn(),
  getPaymentsByStudent: vi.fn().mockResolvedValue([{ paymentId: 'p1' }]),
  getAllPayments: vi.fn().mockResolvedValue([{ paymentId: 'p1' }]),
  getPendingPayments: vi.fn().mockResolvedValue([]),
  getPaymentById: vi.fn().mockResolvedValue({ paymentId: 'p1' }),
  getPaymentDetails: vi.fn().mockResolvedValue({ paymentId: 'p1' }),
  isPaymentProcessed: vi.fn().mockResolvedValue(true),
}));

import { getByStudent,isProcessed,processCapturedPayment } from '../services/payment.service';

describe('PaymentService', () => {
  it('delegates student payment lookup to existing logic unchanged', async () => {
    const payments = await getByStudent('u1');
    expect(payments).toEqual([{ paymentId: 'p1' }]);
  });

  it('delegates idempotency check to existing logic unchanged', async () => {
    const processed = await isProcessed('p1');
    expect(processed).toBe(true);
  });

  it('delegates capture processing to existing logic unchanged', async () => {
    const result = await processCapturedPayment({ paymentId: 'p1', orderId: 'o1', amount: 100 });
    expect(result).toEqual({ status: 'success' });
  });
});
