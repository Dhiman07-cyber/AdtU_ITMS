import { describe, expect, it, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { NextRequest } from 'next/server';

// Mock Supabase Server
const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

// Mock encryption and crypto helpers
vi.mock('@/lib/security/encryption', () => ({
  encryptData: (val: string) => val,
  decryptData: (val: string) => val,
}));

vi.mock('@/lib/security/document-crypto', () => ({
  DocumentCryptoService: {
    signDocumentPayload: vi.fn(() => 'sig_test_123'),
  },
  buildDocumentPayloadFromPayment: vi.fn(() => ({})),
}));

// Mock razorpay service
vi.mock('@/lib/payment/razorpay.service', () => ({
  fetchOrderDetails: vi.fn(),
  fetchPaymentDetails: vi.fn(),
  verifyRazorpaySignature: vi.fn(),
}));

// Mock api-security withSecurity wrapper
vi.mock('@/lib/security/api-security', () => ({
  withSecurity: (handler: any) => {
    return async (req: any) => {
      const body = await req.json();
      return handler(req, {
        auth: { uid: body.studentUid || 'student_123', name: 'Test Student', role: 'student' },
        body,
      });
    };
  },
  getClientIp: () => '127.0.0.1',
}));

// Mock payment domain service for processCapturedPayment
vi.mock('@/lib/payment/payment.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payment/payment.service')>();
  return {
    ...actual,
    processCapturedPayment: vi.fn().mockResolvedValue({ status: 'success' }),
  };
});

import { PaymentsSupabaseService } from '@/lib/services/payments-supabase';
import { POST as webhookPost } from '@/app/api/payment/webhook/razorpay/route';
import { POST as verifyPaymentPost } from '@/app/api/payment/razorpay/verify-payment/route';
import { fetchOrderDetails, fetchPaymentDetails, verifyRazorpaySignature } from '@/lib/payment/razorpay.service';
import { confirmManualRefund } from '@/lib/payment/payment.service';

describe('Refund Lifecycle, Database Trigger Reconcile & Currency Invariants Suite', () => {
  let service: PaymentsSupabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PaymentsSupabaseService();
  });

  describe('1. confirmManualRefundRecord & Database Trigger Alignment', () => {
    it('sets top-level approved_by and approved_at when fully transitioning to Refunded with admin actor', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: false,
          cumulative_refunded: 15000,
        },
        error: null,
      });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_rev_1',
        refundReference: 'rfnd_admin_123',
        refundedAmount: 15000,
        authorizedBy: {
          userId: 'admin_officer_1',
          name: 'Finance Admin',
          role: 'admin',
          empId: 'EMP-FIN-01',
        },
        reason: 'Duplicate payment resolved with full refund',
      });

      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(false);
      expect(result.cumulativeRefunded).toBe(15000);

      // Verifies RPC was called with exact parameters and paise calculation
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', {
        p_payment_id: 'pay_rev_1',
        p_refund_id: 'rfnd_admin_123',
        p_amount_paise: 1500000,
        p_authorized_by: {
          type: 'admin',
          userId: 'admin_officer_1',
          name: 'Finance Admin',
          role: 'admin',
          empId: 'EMP-FIN-01',
        },
        p_reason: 'Duplicate payment resolved with full refund',
      });

      // INVARIANT: No non-atomic client-side update was performed!
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('passes default reason "Approved refund" to process_payment_refund_atomic when reason is omitted', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: false,
          cumulative_refunded: 10000,
        },
        error: null,
      });

      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_default_reason',
        refundReference: 'rfnd_default_1',
        refundedAmount: 10000,
        authorizedBy: {
          userId: 'admin_officer_2',
          name: 'Audit Officer',
          role: 'admin',
        },
        reason: '',
      });

      expect(result.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', {
        p_payment_id: 'pay_default_reason',
        p_refund_id: 'rfnd_default_1',
        p_amount_paise: 1000000,
        p_authorized_by: {
          type: 'admin',
          userId: 'admin_officer_2',
          name: 'Audit Officer',
          role: 'admin',
        },
        p_reason: 'Approved refund',
      });
    });

    it('sets top-level approved_by and approved_at when transitioning to Refunded with system webhook actor', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: false,
          cumulative_refunded: 15000,
        },
        error: null,
      });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_rev_webhook',
        refundReference: 'rfnd_auto_gateway',
        refundedAmount: 15000,
        authorizedBy: {
          userId: 'system:razorpay_webhook',
          name: 'Razorpay Gateway Webhook',
          role: 'system',
          type: 'system',
        },
        reason: 'Automated gateway refund processed event',
      });

      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(false);
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', {
        p_payment_id: 'pay_rev_webhook',
        p_refund_id: 'rfnd_auto_gateway',
        p_amount_paise: 1500000,
        p_authorized_by: {
          type: 'system',
          userId: 'system:razorpay_webhook',
          name: 'Razorpay Gateway Webhook',
          role: 'system',
        },
        p_reason: 'Automated gateway refund processed event',
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('does NOT mark payment as Refunded when a partial refund is processed', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: true,
          cumulative_refunded: 5000,
        },
        error: null,
      });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_partial_1',
        refundReference: 'rfnd_part_1',
        refundedAmount: 5000, // 5000 of 15000 is partial
        authorizedBy: {
          userId: 'admin_officer_1',
          name: 'Finance Admin',
          role: 'admin',
        },
        reason: 'Partial cancellation refund',
      });

      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(true);
      expect(result.cumulativeRefunded).toBe(5000);
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.objectContaining({
        p_payment_id: 'pay_partial_1',
        p_refund_id: 'rfnd_part_1',
        p_amount_paise: 500000,
      }));
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('handles repeated events idempotently without double-counting refund amount', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: true,
          cumulative_refunded: 5000,
          already_processed: true,
        },
        error: null,
      });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      // Repeat identical refund reference
      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_replay_1',
        refundReference: 'rfnd_part_1',
        refundedAmount: 5000,
        authorizedBy: {
          userId: 'admin_officer_1',
          name: 'Finance Admin',
          role: 'admin',
        },
        reason: 'Duplicate webhook replay',
      });

      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(true);
      expect(result.cumulativeRefunded).toBe(5000);
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.objectContaining({
        p_payment_id: 'pay_replay_1',
        p_refund_id: 'rfnd_part_1',
        p_amount_paise: 500000,
      }));
      // Update query was NOT called because atomic procedure handled it
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('transitions to Refunded when cumulative distinct partial refunds equal the full amount', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: false,
          cumulative_refunded: 15000,
        },
        error: null,
      });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      // Second distinct refund for 10,000 (total cumulative: 15,000)
      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_two_step',
        refundReference: 'rfnd_part_2',
        refundedAmount: 10000,
        authorizedBy: {
          userId: 'admin_officer_1',
          name: 'Finance Admin',
          role: 'admin',
        },
        reason: 'Second installment to complete full refund',
      });

      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(false);
      expect(result.cumulativeRefunded).toBe(15000);
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.objectContaining({
        p_payment_id: 'pay_two_step',
        p_refund_id: 'rfnd_part_2',
        p_amount_paise: 1000000,
      }));
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects when cumulative refund amount exceeds original captured amount', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Cumulative refunded amount (17000) cannot exceed original payment amount (15000).',
        },
        error: null,
      });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_overflow',
        refundReference: 'rfnd_2',
        refundedAmount: 7000, // 10000 + 7000 = 17000 > 15000
        authorizedBy: {
          userId: 'admin_1',
          name: 'Admin',
          role: 'admin',
        },
        reason: 'Excess refund attempt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cumulative refunded amount');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('denyRefundRecord populates approved_by and approved_at to satisfy protect_completed_payments trigger', async () => {
      const mockPayment = {
        payment_id: 'pay_deny_test',
        amount: 15000,
        currency: 'INR',
        status: 'Duplicate_Pending_Refund',
        metadata: {},
      };

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: [{ payment_id: 'pay_deny_test' }],
              error: null,
            }),
          }),
        }),
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockPayment, error: null }),
              }),
            }),
            update: mockUpdate,
          };
        }
        return {};
      });

      const result = await service.denyRefundRecord({
        paymentId: 'pay_deny_test',
        deniedBy: {
          userId: 'admin_officer_2',
          name: 'Finance Reviewer',
          role: 'admin',
          empId: 'EMP-FIN-02',
        },
        denialReason: 'Duplicate bus pass intentionally granted for double route allocation',
      });

      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'Refund_Denied',
          approved_by: {
            type: 'admin',
            userId: 'admin_officer_2',
            name: 'Finance Reviewer',
            role: 'admin',
            empId: 'EMP-FIN-02',
          },
          approved_at: expect.any(String),
          metadata: expect.objectContaining({
            denial_reason: 'Duplicate bus pass intentionally granted for double route allocation',
          }),
        })
      );
    });

    it('fully transitions initially Completed payment to Refunded with verified audit evidence', async () => {
      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: false,
          cumulative_refunded: 15000,
        },
        error: null,
      });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const result = await service.confirmManualRefundRecord({
        paymentId: 'pay_completed_full',
        refundReference: 'rfnd_comp_full_1',
        refundedAmount: 15000,
        authorizedBy: {
          userId: 'admin_officer_1',
          name: 'Finance Admin',
          role: 'admin',
        },
        reason: 'Student dropped bus service, granted 100% refund',
      });

      expect(result.success).toBe(true);
      expect(result.isPartial).toBe(false);
      expect(result.cumulativeRefunded).toBe(15000);

      // Verifies Completed -> Refunded transition is executed via atomic RPC
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.objectContaining({
        p_payment_id: 'pay_completed_full',
        p_refund_id: 'rfnd_comp_full_1',
        p_amount_paise: 1500000,
      }));
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('multiple partial refunds reaching exact full amount transitions Completed payment to Refunded', async () => {
      mockRpc
        .mockResolvedValueOnce({
          data: { success: true, is_partial: true, cumulative_refunded: 4000 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { success: true, is_partial: true, cumulative_refunded: 8000 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { success: true, is_partial: false, cumulative_refunded: 12000 },
          error: null,
        });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      // Step 1: Partial refund of 4,000 (of 12,000)
      const res1 = await service.confirmManualRefundRecord({
        paymentId: 'pay_three_step',
        refundReference: 'rfnd_step_1',
        refundedAmount: 4000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'First partial installment',
      });
      expect(res1.success).toBe(true);
      expect(res1.isPartial).toBe(true);
      expect(res1.cumulativeRefunded).toBe(4000);

      // Step 2: Second partial refund of 4,000 (total cumulative: 8,000)
      const res2 = await service.confirmManualRefundRecord({
        paymentId: 'pay_three_step',
        refundReference: 'rfnd_step_2',
        refundedAmount: 4000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Second partial installment',
      });
      expect(res2.success).toBe(true);
      expect(res2.isPartial).toBe(true);
      expect(res2.cumulativeRefunded).toBe(8000);

      // Step 3: Final partial refund of 4,000 (total cumulative: 12,000, exactly reaching original amount)
      const res3 = await service.confirmManualRefundRecord({
        paymentId: 'pay_three_step',
        refundReference: 'rfnd_step_3',
        refundedAmount: 4000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Third installment completing 100% refund',
      });
      expect(res3.success).toBe(true);
      expect(res3.isPartial).toBe(false);
      expect(res3.cumulativeRefunded).toBe(12000);

      expect(mockRpc).toHaveBeenCalledTimes(3);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('simulates two concurrent distinct refund events atomically accumulating without lost updates', async () => {
      mockRpc
        .mockResolvedValueOnce({
          data: { success: true, is_partial: true, cumulative_refunded: 4000 },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { success: true, is_partial: false, cumulative_refunded: 10000 },
          error: null,
        });

      const mockUpdate = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      // Event A: refund of 4,000
      const resA = await service.confirmManualRefundRecord({
        paymentId: 'pay_concurrent_1',
        refundReference: 'rfnd_event_A',
        refundedAmount: 4000,
        authorizedBy: { userId: 'system:razorpay_webhook', name: 'Razorpay Gateway Webhook', role: 'system', type: 'system' },
        reason: 'Concurrent event A',
      });
      expect(resA.success).toBe(true);
      expect(resA.cumulativeRefunded).toBe(4000);

      // Event B: refund of 6,000
      const resB = await service.confirmManualRefundRecord({
        paymentId: 'pay_concurrent_1',
        refundReference: 'rfnd_event_B',
        refundedAmount: 6000,
        authorizedBy: { userId: 'system:razorpay_webhook', name: 'Razorpay Gateway Webhook', role: 'system', type: 'system' },
        reason: 'Concurrent event B',
      });

      expect(resB.success).toBe(true);
      expect(resB.isPartial).toBe(false);
      expect(resB.cumulativeRefunded).toBe(10000);

      expect(mockRpc).toHaveBeenCalledTimes(2);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('verifies explicit system actor identity cannot grant human administrative authorization via confirmManualRefund', async () => {
      // Human admin interface in payment.service.ts requires authorizerRole === 'admin'
      const systemActorAttempt = await confirmManualRefund({
        paymentId: 'pay_auth_test',
        refundReference: 'rfnd_system_fake_admin',
        refundedAmount: 5000,
        authorizerUserId: 'system:razorpay_webhook',
        authorizerName: 'Razorpay Gateway Webhook',
        authorizerRole: 'system', // System actor cannot pose as human administrator!
        reason: 'Unauthorized attempt to bypass admin gate',
      });

      expect(systemActorAttempt.success).toBe(false);
      expect(systemActorAttempt.error).toBe('Only administrators / finance officers may confirm external refunds.');
    });
  });

  describe('2. Currency Invariant Enforcement (Webhook & Verify Route)', () => {
    it('webhook rejects payment.captured when order currency does not match INR or payment currency', async () => {
      const secret = 'webhook_secret_currency_test';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_usd_test',
              order_id: 'order_usd_test',
              amount: 1500000,
              currency: 'USD', // Mismatched currency
              method: 'card',
            },
          },
        },
      });

      const signature = crypto
        .createHmac('sha256', secret)
        .update(rawPayload)
        .digest('hex');

      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_usd_test',
        amount: 1500000,
        currency: 'USD',
        notes: {},
      } as any);

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Currency mismatch');
    });

    it('webhook rejects payment.captured when order currency is missing (undefined)', async () => {
      const secret = 'webhook_secret_currency_missing';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_missing_order_curr',
              order_id: 'order_missing_curr',
              amount: 1500000,
              currency: 'INR',
              method: 'card',
            },
          },
        },
      });

      const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_missing_curr',
        amount: 1500000,
        // currency is undefined
        notes: {},
      } as any);

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Currency mismatch');
    });

    it('webhook rejects payment.captured when payment entity currency is empty string', async () => {
      const secret = 'webhook_secret_currency_empty';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_empty_curr',
              order_id: 'order_empty_curr',
              amount: 1500000,
              currency: '   ', // whitespace only
              method: 'card',
            },
          },
        },
      });

      const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_empty_curr',
        amount: 1500000,
        currency: 'INR',
        notes: {},
      } as any);

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Currency mismatch');
    });

    it('checkout verify-payment rejects when provider payment currency does not match order currency or is not INR', async () => {
      vi.mocked(verifyRazorpaySignature).mockReturnValue({ isValid: true });
      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_curr_1',
        amount: 1500000,
        currency: 'INR',
        notes: {
          userId: 'student_123',
        },
      } as any);
      vi.mocked(fetchPaymentDetails).mockResolvedValue({
        id: 'pay_curr_1',
        order_id: 'order_curr_1',
        amount: 1500000,
        currency: 'EUR', // Mismatched provider currency
        status: 'captured',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/payment/razorpay/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_payment_id: 'pay_curr_1',
          razorpay_order_id: 'order_curr_1',
          razorpay_signature: 'sig_valid',
          studentUid: 'student_123',
        }),
      });

      const res = await verifyPaymentPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Razorpay payment details do not match the order');
    });

    it('checkout verify-payment rejects when order currency is missing (undefined)', async () => {
      vi.mocked(verifyRazorpaySignature).mockReturnValue({ isValid: true });
      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_missing_1',
        amount: 1500000,
        // currency missing
        notes: { userId: 'student_123' },
      } as any);
      vi.mocked(fetchPaymentDetails).mockResolvedValue({
        id: 'pay_missing_1',
        order_id: 'order_missing_1',
        amount: 1500000,
        currency: 'INR',
        status: 'captured',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/payment/razorpay/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_payment_id: 'pay_missing_1',
          razorpay_order_id: 'order_missing_1',
          razorpay_signature: 'sig_valid',
          studentUid: 'student_123',
        }),
      });

      const res = await verifyPaymentPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Razorpay payment details do not match the order');
    });

    it('checkout verify-payment rejects when payment currency is empty string', async () => {
      vi.mocked(verifyRazorpaySignature).mockReturnValue({ isValid: true });
      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_empty_1',
        amount: 1500000,
        currency: 'INR',
        notes: { userId: 'student_123' },
      } as any);
      vi.mocked(fetchPaymentDetails).mockResolvedValue({
        id: 'pay_empty_1',
        order_id: 'order_empty_1',
        amount: 1500000,
        currency: '',
        status: 'captured',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/payment/razorpay/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_payment_id: 'pay_empty_1',
          razorpay_order_id: 'order_empty_1',
          razorpay_signature: 'sig_valid',
          studentUid: 'student_123',
        }),
      });

      const res = await verifyPaymentPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Razorpay payment details do not match the order');
    });

    it('checkout verify-payment rejects when both order and payment are non-INR (USD)', async () => {
      vi.mocked(verifyRazorpaySignature).mockReturnValue({ isValid: true });
      vi.mocked(fetchOrderDetails).mockResolvedValue({
        id: 'order_usd_1',
        amount: 1500000,
        currency: 'USD',
        notes: { userId: 'student_123' },
      } as any);
      vi.mocked(fetchPaymentDetails).mockResolvedValue({
        id: 'pay_usd_1',
        order_id: 'order_usd_1',
        amount: 1500000,
        currency: 'USD',
        status: 'captured',
      } as any);

      const req = new NextRequest('http://localhost:3000/api/payment/razorpay/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_payment_id: 'pay_usd_1',
          razorpay_order_id: 'order_usd_1',
          razorpay_signature: 'sig_valid',
          studentUid: 'student_123',
        }),
      });

      const res = await verifyPaymentPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Razorpay payment details do not match the order');
    });
  });

  describe('3. Webhook Durable Processing & Failure Error Propagation', () => {
    it('webhook refund.processed returns HTTP 500 when confirmManualRefundRecord fails', async () => {
      const secret = 'webhook_secret_fail_test';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_fail_test',
              payment_id: 'pay_db_error',
              amount: 1500000,
              status: 'processed',
            },
          },
        },
      });

      const signature = crypto
        .createHmac('sha256', secret)
        .update(rawPayload)
        .digest('hex');

      // Mock database returning payment in review, but refund RPC failing
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Database connection dropped during refund transition' },
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    payment_id: 'pay_db_error',
                    razorpay_payment_id: 'pay_db_error',
                    amount: 15000,
                    status: 'Duplicate_Pending_Refund',
                  },
                  error: null,
                }),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    payment_id: 'pay_db_error',
                    razorpay_payment_id: 'pay_db_error',
                    amount: 15000,
                    status: 'Duplicate_Pending_Refund',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      // Invariant: MUST return HTTP 500 so Razorpay retries the webhook!
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Database connection dropped');
    });

    it('webhook refund.failed records durable alert flag and actionable failure visibility', async () => {
      const secret = 'webhook_secret_alert_test';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'refund.failed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_failed_gateway',
              payment_id: 'pay_refund_failed',
              amount: 1500000,
              status: 'failed',
              error_code: 'GATEWAY_DECLINE',
              error_description: 'Beneficiary bank rejected credit transfer',
            },
          },
        },
      });

      const signature = crypto
        .createHmac('sha256', secret)
        .update(rawPayload)
        .digest('hex');

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [{ payment_id: 'pay_refund_failed' }], error: null }),
        }),
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    payment_id: 'pay_refund_failed',
                    razorpay_payment_id: 'pay_refund_failed',
                    amount: 15000,
                    status: 'Duplicate_Pending_Refund',
                    metadata: {},
                  },
                  error: null,
                }),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    payment_id: 'pay_refund_failed',
                    razorpay_payment_id: 'pay_refund_failed',
                    amount: 15000,
                    status: 'Duplicate_Pending_Refund',
                    metadata: {},
                  },
                  error: null,
                }),
              }),
            }),
            update: mockUpdate,
          };
        }
        return {};
      });

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('refund_failed_logged');

      // Verify actionable alerts recorded in metadata
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            last_refund_event: 'refund.failed',
            refund_failed_alert: true,
            requires_refund_review: true,
            latest_refund_error: {
              code: 'GATEWAY_DECLINE',
              description: 'Beneficiary bank rejected credit transfer',
              reason: 'unknown',
            },
          }),
        })
      );
    });

    it('webhook refund.processed succeeds on Completed payment and sets role: system', async () => {
      const secret = 'webhook_secret_comp_refund';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_comp_webhook_1',
              payment_id: 'pay_comp_web_1',
              amount: 1500000,
              status: 'processed',
            },
          },
        },
      });

      const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      const mockPayment = {
        payment_id: 'pay_comp_web_1',
        razorpay_payment_id: 'pay_comp_web_1',
        amount: 15000,
        currency: 'INR',
        status: 'Completed',
        metadata: {},
      };

      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: false,
          cumulative_refunded: 15000,
        },
        error: null,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockPayment, error: null }),
                single: vi.fn().mockResolvedValue({ data: mockPayment, error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('refund_processed');
      expect(json.isPartial).toBe(false);

      // Verify system actor identity is used in atomic RPC
      expect(mockRpc).toHaveBeenCalledWith(
        'process_payment_refund_atomic',
        expect.objectContaining({
          p_payment_id: 'pay_comp_web_1',
          p_refund_id: 'rfnd_comp_webhook_1',
          p_authorized_by: expect.objectContaining({
            userId: 'system:razorpay_webhook',
            role: 'system',
            type: 'system',
          }),
        })
      );
    });

    it('webhook refund.processed handles duplicate event idempotently returning HTTP 200', async () => {
      const secret = 'webhook_secret_dup_replay';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_already_seen',
              payment_id: 'pay_replay_test',
              amount: 500000,
              status: 'processed',
            },
          },
        },
      });

      const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      const mockPayment = {
        payment_id: 'pay_replay_test',
        razorpay_payment_id: 'pay_replay_test',
        amount: 15000,
        currency: 'INR',
        status: 'Completed',
        metadata: {
          refunded_amount: 5000,
          refund_history: [
            {
              refund_id: 'rfnd_already_seen',
              amount: 5000,
              status: 'processed',
              processed_at: '2026-10-10T00:00:00.000Z',
            },
          ],
        },
      };

      mockRpc.mockResolvedValue({
        data: {
          success: true,
          is_partial: false,
          cumulative_refunded: 5000,
          already_processed: true,
        },
        error: null,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockPayment, error: null }),
                single: vi.fn().mockResolvedValue({ data: mockPayment, error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('refund_processed');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.objectContaining({
        p_payment_id: 'pay_replay_test',
        p_refund_id: 'rfnd_already_seen',
      }));
    });

    it('webhook refund.failed returns HTTP 500 when failure alert persistence encounters database error', async () => {
      const secret = 'webhook_secret_alert_fail';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'refund.failed',
        payload: {
          refund: {
            entity: {
              id: 'rfnd_failed_err',
              payment_id: 'pay_alert_db_fail',
              amount: 1500000,
              status: 'failed',
              error_code: 'BANK_DOWN',
              error_description: 'Issuer system unavailable',
            },
          },
        },
      });

      const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      // Database update fails during alert persistence
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    payment_id: 'pay_alert_db_fail',
                    razorpay_payment_id: 'pay_alert_db_fail',
                    amount: 15000,
                    status: 'Duplicate_Pending_Refund',
                    metadata: {},
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Disk I/O error on secondary alert persistence' },
                }),
              }),
            }),
          };
        }
        return {};
      });

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      // Invariant: MUST return HTTP 500 so Razorpay retries the webhook!
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Failed to record refund failure');
    });
  });

  describe('4. Database Trigger protect_completed_payments Invariant Contract Verification', () => {
    // Pure function simulation representing the exact PostgreSQL PL/pgSQL protect_completed_payments() trigger logic
    function simulateProtectCompletedPaymentsTrigger(oldRow: any, newRow: any): void {
      // 1. DELETE check
      // 2. Financial & identity immutability
      if (['Completed', 'Duplicate_Pending_Refund', 'Captured_Pending_Review', 'Refunded', 'Refund_Denied', 'Rejected'].includes(oldRow.status)) {
        if (newRow.amount !== oldRow.amount) {
          throw new Error(`Cannot alter payment amount on finalized record ${oldRow.payment_id} (amount is immutable)`);
        }
        if (newRow.currency !== oldRow.currency) {
          throw new Error(`Cannot alter payment currency on finalized record ${oldRow.payment_id} (currency is immutable)`);
        }
        if (newRow.student_uid !== oldRow.student_uid) {
          throw new Error(`Cannot alter student identity on finalized record ${oldRow.payment_id} (student_uid is immutable)`);
        }
        if (newRow.razorpay_payment_id !== oldRow.razorpay_payment_id) {
          throw new Error(`Cannot alter razorpay_payment_id on finalized record ${oldRow.payment_id} (payment ID is immutable)`);
        }
      }

      // 3. Lifecycle transition constraints
      if (oldRow.status === 'Completed' && newRow.status !== oldRow.status) {
        if (newRow.status === 'Refunded') {
          if (!newRow.approved_by) {
            throw new Error(`Cannot transition Completed payment ${oldRow.payment_id} to Refunded without authorized actor (approved_by)`);
          }
          if (!newRow.approved_at) {
            throw new Error(`Cannot transition Completed payment ${oldRow.payment_id} to Refunded without refund timestamp (approved_at)`);
          }
          const hasRefundRef = Boolean(
            newRow.metadata?.refund_id ||
            newRow.metadata?.external_refund_ref ||
            newRow.metadata?.razorpay_refund_id
          );
          if (!hasRefundRef) {
            throw new Error(`Cannot transition Completed payment ${oldRow.payment_id} to Refunded without external refund reference in metadata`);
          }
          const cumulativeRefunded = Number(newRow.metadata?.refunded_amount || 0);
          if (cumulativeRefunded < (oldRow.amount - 0.01)) {
            throw new Error(`Cannot transition Completed payment ${oldRow.payment_id} to Refunded: cumulative refunded amount (${cumulativeRefunded}) must equal or exceed original captured amount (${oldRow.amount})`);
          }
        } else {
          throw new Error(`Cannot mutate status of Completed payment record ${oldRow.payment_id}: permitted transition is only to Refunded upon verified full refund (attempted: ${newRow.status})`);
        }
      }

      if (['Refunded', 'Refund_Denied', 'Rejected'].includes(oldRow.status) && newRow.status !== oldRow.status) {
        throw new Error(`Cannot mutate status of terminal payment record ${oldRow.payment_id} (status: ${oldRow.status})`);
      }
    }

    it('trigger contract: permits Completed -> Refunded when approved_by, approved_at, refund ref, and full amount are provided', () => {
      const oldRow = {
        payment_id: 'pay_comp_trig',
        amount: 15000,
        currency: 'INR',
        student_uid: 'stud_999',
        razorpay_payment_id: 'pay_rzp_999',
        status: 'Completed',
        metadata: {},
      };

      const newRow = {
        ...oldRow,
        status: 'Refunded',
        approved_by: { userId: 'admin_fin', role: 'admin' },
        approved_at: '2026-10-11T12:00:00.000Z',
        metadata: {
          refund_id: 'rfnd_full_trig',
          refunded_amount: 15000,
        },
      };

      expect(() => simulateProtectCompletedPaymentsTrigger(oldRow, newRow)).not.toThrow();
    });

    it('trigger contract: raises exception if Completed attempts transition to Refunded with cumulative refund less than original amount', () => {
      const oldRow = {
        payment_id: 'pay_comp_partial',
        amount: 15000,
        currency: 'INR',
        student_uid: 'stud_999',
        razorpay_payment_id: 'pay_rzp_999',
        status: 'Completed',
      };

      const newRow = {
        ...oldRow,
        status: 'Refunded',
        approved_by: { userId: 'admin_fin', role: 'admin' },
        approved_at: '2026-10-11T12:00:00.000Z',
        metadata: {
          refund_id: 'rfnd_partial',
          refunded_amount: 5000, // Partial! Less than 15000!
        },
      };

      expect(() => simulateProtectCompletedPaymentsTrigger(oldRow, newRow)).toThrow(
        /cumulative refunded amount \(5000\) must equal or exceed original captured amount \(15000\)/
      );
    });

    it('trigger contract: raises exception if Completed attempts transition to Refunded without approved_by', () => {
      const oldRow = {
        payment_id: 'pay_comp_no_actor',
        amount: 15000,
        currency: 'INR',
        student_uid: 'stud_999',
        razorpay_payment_id: 'pay_rzp_999',
        status: 'Completed',
      };

      const newRow = {
        ...oldRow,
        status: 'Refunded',
        approved_by: null, // Missing!
        approved_at: '2026-10-11T12:00:00.000Z',
        metadata: {
          refund_id: 'rfnd_valid',
          refunded_amount: 15000,
        },
      };

      expect(() => simulateProtectCompletedPaymentsTrigger(oldRow, newRow)).toThrow(
        /without authorized actor \(approved_by\)/
      );
    });

    it('trigger contract: raises exception if Completed attempts transition to Refunded without external refund reference', () => {
      const oldRow = {
        payment_id: 'pay_comp_no_ref',
        amount: 15000,
        currency: 'INR',
        student_uid: 'stud_999',
        razorpay_payment_id: 'pay_rzp_999',
        status: 'Completed',
      };

      const newRow = {
        ...oldRow,
        status: 'Refunded',
        approved_by: { userId: 'admin_fin', role: 'admin' },
        approved_at: '2026-10-11T12:00:00.000Z',
        metadata: {
          refunded_amount: 15000, // Missing refund_id / external_refund_ref!
        },
      };

      expect(() => simulateProtectCompletedPaymentsTrigger(oldRow, newRow)).toThrow(
        /without external refund reference in metadata/
      );
    });

    it('trigger contract: strictly raises exception if Completed attempts transition to arbitrary status like Pending', () => {
      const oldRow = {
        payment_id: 'pay_comp_arbitrary',
        amount: 15000,
        currency: 'INR',
        student_uid: 'stud_999',
        razorpay_payment_id: 'pay_rzp_999',
        status: 'Completed',
      };

      const newRow = {
        ...oldRow,
        status: 'Pending',
      };

      expect(() => simulateProtectCompletedPaymentsTrigger(oldRow, newRow)).toThrow(
        /permitted transition is only to Refunded upon verified full refund \(attempted: Pending\)/
      );
    });

    it('trigger contract: strictly raises exception if financial amount or currency is mutated on Completed payment', () => {
      const oldRow = {
        payment_id: 'pay_comp_amount_tamper',
        amount: 15000,
        currency: 'INR',
        student_uid: 'stud_999',
        razorpay_payment_id: 'pay_rzp_999',
        status: 'Completed',
      };

      const newRow = {
        ...oldRow,
        amount: 12000, // Mutating captured amount!
      };

      expect(() => simulateProtectCompletedPaymentsTrigger(oldRow, newRow)).toThrow(
        /Cannot alter payment amount on finalized record/
      );

      const currencyTamperRow = {
        ...oldRow,
        currency: 'USD',
      };
      expect(() => simulateProtectCompletedPaymentsTrigger(oldRow, currencyTamperRow)).toThrow(
        /Cannot alter payment currency on finalized record/
      );
    });
  });

  describe('5. payment.failed Webhook — Correct Order-ID Lookup Regression', () => {
    it('payment.failed finds Pending record by razorpay_order_id and records failure metadata', async () => {
      const secret = 'webhook_secret_pf_order_1';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_fail_attempt_1',
              order_id: 'order_pf_test_1',
              amount: 1500000,
              currency: 'INR',
              method: 'card',
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Card issuer declined the transaction',
              error_reason: 'payment_declined',
            },
          },
        },
      });

      const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      const pendingRecord = {
        payment_id: 'pay_pending_order_1',
        razorpay_order_id: 'order_pf_test_1',
        amount: 15000,
        currency: 'INR',
        status: 'Pending',
        metadata: {},
      };

      let metadataUpdateArg: Record<string, unknown> | null = null;
      const mockUpdate = vi.fn().mockImplementation((payload: any) => {
        metadataUpdateArg = payload;
        return {
          eq: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [{ payment_id: 'pay_pending_order_1' }],
                error: null,
              }),
            }),
            select: vi.fn().mockResolvedValue({
              data: [{ payment_id: 'pay_pending_order_1' }],
              error: null,
            }),
          }),
        };
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                // Simulate razorpay_order_id or payment_id lookup returning the pending record
                if (
                  (col === 'razorpay_order_id' && val === 'order_pf_test_1') ||
                  (col === 'payment_id' && val === 'pay_pending_order_1')
                ) {
                  return {
                    order: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    maybeSingle: vi.fn().mockResolvedValue({ data: pendingRecord, error: null }),
                    single: vi.fn().mockResolvedValue({ data: pendingRecord, error: null }),
                  };
                }
                // razorpay_payment_id lookup should not be needed if order ID succeeds
                return {
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                };
              }),
            }),
            update: mockUpdate,
          };
        }
        return {};
      });

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('payment_failed_logged');

      // Verify failure metadata was recorded against the Pending record
      expect(mockUpdate).toHaveBeenCalled();
      const updatePayload = metadataUpdateArg as any;
      expect(updatePayload?.metadata).toBeDefined();
      expect(updatePayload?.metadata?.gateway_error_code).toBe('BAD_REQUEST_ERROR');
      expect(updatePayload?.metadata?.requires_student_retry).toBe(true);
      expect(updatePayload?.metadata?.gateway_failed_payment_id).toBe('pay_fail_attempt_1');
    });

    it('payment.failed does NOT mutate a Completed payment status when order is already processed', async () => {
      const secret = 'webhook_secret_pf_completed';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const rawPayload = JSON.stringify({
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_late_failure',
              order_id: 'order_already_completed',
              amount: 1500000,
              currency: 'INR',
              method: 'card',
              error_code: 'TIMEOUT',
            },
          },
        },
      });

      const signature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      const completedRecord = {
        payment_id: 'pay_completed_already',
        razorpay_order_id: 'order_already_completed',
        amount: 15000,
        currency: 'INR',
        // Status is Completed — NOT Pending — so payment.failed guard must skip the update
        status: 'Completed',
        metadata: { entitlement_status: 'active' },
      };

      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: string) => {
                if (col === 'razorpay_order_id' && val === 'order_already_completed') {
                  return {
                    order: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    maybeSingle: vi.fn().mockResolvedValue({ data: completedRecord, error: null }),
                    single: vi.fn().mockResolvedValue({ data: completedRecord, error: null }),
                  };
                }
                return {
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockReturnThis(),
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                };
              }),
            }),
            update: mockUpdate,
          };
        }
        return {};
      });

      const req = new NextRequest('http://localhost:3000/api/payment/webhook/razorpay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': signature },
        body: rawPayload,
      });

      const res = await webhookPost(req);
      // INVARIANT: Always 200 for payment.failed (Razorpay expects 200 acknowledgement)
      expect(res.status).toBe(200);
      // INVARIANT: Database update must NOT have been called for a non-Pending record
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('6. confirmManualRefundRecord — RPC Error Fail-Closed Regression', () => {
    it('fails closed when the RPC returns 42883 (function does not exist) without executing client-side update or fallback', async () => {
      const mock42883Error = {
        message: 'function process_payment_refund_atomic(text, text, bigint, jsonb, text) does not exist',
        code: '42883',
        details: null,
        hint: null,
      };

      const mockRpc = vi.fn().mockResolvedValue({ data: null, error: mock42883Error });
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithRpc, 'supabase', {
        value: { from: mockFrom, rpc: mockRpc },
        configurable: true,
      });

      const result = await serviceWithRpc.confirmManualRefundRecord({
        paymentId: 'pay_42883_fail',
        refundReference: 'rfnd_42883_1',
        refundedAmount: 10000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Missing RPC migration must fail closed',
      });

      // INVARIANT: Must fail-closed; never fall through to client-side accounting in production
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the RPC returns PGRST202 (not in PostgREST schema cache) without executing client-side update or fallback', async () => {
      const mockPgrst202Error = {
        message: 'Could not find the function public.process_payment_refund_atomic in the schema cache',
        code: 'PGRST202',
        details: null,
        hint: null,
      };

      const mockRpc = vi.fn().mockResolvedValue({ data: null, error: mockPgrst202Error });
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithRpc, 'supabase', {
        value: { from: mockFrom, rpc: mockRpc },
        configurable: true,
      });

      const result = await serviceWithRpc.confirmManualRefundRecord({
        paymentId: 'pay_pgrst_fail',
        refundReference: 'rfnd_pgrst_1',
        refundedAmount: 5000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'PostgREST cache mismatch must fail closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not find the function');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the RPC returns 42501 (permission denied) without executing client-side update or fallback', async () => {
      const mock42501Error = {
        message: 'permission denied for function process_payment_refund_atomic',
        code: '42501',
        details: null,
        hint: null,
      };

      const mockRpc = vi.fn().mockResolvedValue({ data: null, error: mock42501Error });
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithRpc, 'supabase', {
        value: { from: mockFrom, rpc: mockRpc },
        configurable: true,
      });

      const result = await serviceWithRpc.confirmManualRefundRecord({
        paymentId: 'pay_perm_fail',
        refundReference: 'rfnd_perm_1',
        refundedAmount: 5000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Permission error must fail closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('permission denied');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the RPC returns 57P03 (connection pool exhausted / server unavailable) without executing client-side update or fallback', async () => {
      const mock57P03Error = {
        message: 'connection pool exhausted during refund atomic lock',
        code: '57P03',
        details: null,
        hint: null,
      };

      const mockRpc = vi.fn().mockResolvedValue({ data: null, error: mock57P03Error });
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithRpc, 'supabase', {
        value: { from: mockFrom, rpc: mockRpc },
        configurable: true,
      });

      const result = await serviceWithRpc.confirmManualRefundRecord({
        paymentId: 'pay_pool_fail',
        refundReference: 'rfnd_pool_1',
        refundedAmount: 5000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Connection failure must fail closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('connection pool exhausted');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the RPC throws an unhandled network or runtime exception without executing client-side update or fallback', async () => {
      const mockRpc = vi.fn().mockRejectedValue(new Error('Network socket disconnected during RPC'));
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithRpc, 'supabase', {
        value: { from: mockFrom, rpc: mockRpc },
        configurable: true,
      });

      const result = await serviceWithRpc.confirmManualRefundRecord({
        paymentId: 'pay_throw_fail',
        refundReference: 'rfnd_throw_1',
        refundedAmount: 5000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Exception must fail closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network socket disconnected');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when database RPC interface is unavailable/undefined (typeof this.supabase?.rpc !== function) without executing client-side update or fallback', async () => {
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithoutRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithoutRpc, 'supabase', {
        value: { from: mockFrom, rpc: undefined },
        configurable: true,
      });

      const result = await serviceWithoutRpc.confirmManualRefundRecord({
        paymentId: 'pay_no_rpc_interface',
        refundReference: 'rfnd_no_rpc_1',
        refundedAmount: 5000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Missing RPC interface on Supabase client must fail closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Atomic refund procedure unavailable: database RPC interface not configured');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the RPC returns null or unexpected malformed response without executing client-side update or fallback', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithRpc, 'supabase', {
        value: { from: mockFrom, rpc: mockRpc },
        configurable: true,
      });

      const result = await serviceWithRpc.confirmManualRefundRecord({
        paymentId: 'pay_malformed_fail',
        refundReference: 'rfnd_malformed_1',
        refundedAmount: 5000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'Empty response must fail closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected or empty response from atomic refund procedure');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when the RPC returns application-level error { success: false, error: ... } without executing client-side update or fallback', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: { success: false, error: 'Refund exceeds captured balance' },
        error: null,
      });
      const mockUpdate = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return { update: mockUpdate };
        }
        return {};
      });

      const serviceWithRpc = new PaymentsSupabaseService();
      Object.defineProperty(serviceWithRpc, 'supabase', {
        value: { from: mockFrom, rpc: mockRpc },
        configurable: true,
      });

      const result = await serviceWithRpc.confirmManualRefundRecord({
        paymentId: 'pay_biz_fail',
        refundReference: 'rfnd_biz_1',
        refundedAmount: 5000,
        authorizedBy: { userId: 'admin_1', name: 'Admin', role: 'admin' },
        reason: 'RPC business error must fail closed',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Refund exceeds captured balance');
      expect(mockRpc).toHaveBeenCalledWith('process_payment_refund_atomic', expect.anything());
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
