import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.hoisted(() => vi.fn());
const mockRpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

vi.mock('@/lib/security/encryption', () => ({
  encryptData: (val: string) => `enc_${val}`,
  decryptData: (val: string) => (val?.startsWith('enc_') ? val.slice(4) : val),
}));

vi.mock('@/lib/security/document-crypto', () => ({
  DocumentCryptoService: {
    signDocumentPayload: vi.fn(() => 'sig_123'),
  },
  buildDocumentPayloadFromPayment: vi.fn(() => ({})),
}));

import { PaymentsSupabaseService } from '../payments-supabase';

describe('PaymentsSupabaseService — Final Adversarial Verification', () => {
  let service: PaymentsSupabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PaymentsSupabaseService();
  });

  describe('Area 2: Academic Session Attribution & Validation', () => {
    it('throws INVALID_SESSION_YEARS when creating Completed payment with missing sessionStartYear', async () => {
      await expect(
        service.createPayment({
          paymentId: 'pay_no_start',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionEndYear: 2027,
          durationYears: 1,
        })
      ).rejects.toThrow(/INVALID_SESSION_YEARS/);
    });

    it('throws INVALID_SESSION_YEARS when creating Completed payment with missing sessionEndYear', async () => {
      await expect(
        service.createPayment({
          paymentId: 'pay_no_end',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: 2026,
          durationYears: 1,
        })
      ).rejects.toThrow(/INVALID_SESSION_YEARS/);
    });

    it('throws INVALID_SESSION_YEARS when sessionStartYear >= sessionEndYear', async () => {
      await expect(
        service.createPayment({
          paymentId: 'pay_invalid_order',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: 2027,
          sessionEndYear: 2026,
          durationYears: 1,
        })
      ).rejects.toThrow(/INVALID_SESSION_YEARS/);
    });

    it('preserves null session years in duplicate payment record without fabricating current year', async () => {
      let insertedPayload: any = null;
      mockFrom.mockReturnValue({
        insert: vi.fn((rows: any[]) => {
          insertedPayload = rows[0];
          return {
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { payment_id: 'dup_1' }, error: null }),
            })),
          };
        }),
      });

      const res = await service.createDuplicatePaymentRecord({
        paymentId: 'dup_1',
        studentUid: 'stud_1',
        amount: 5000,
      });

      expect(res).toBe('dup_1');
      expect(insertedPayload.session_start_year).toBeNull();
      expect(insertedPayload.session_end_year).toBeNull();
    });
  });

  describe('Area 4: 23505 Conflict Classification', () => {
    it('classifies idx_payments_unique_razorpay_payment_id as ALREADY_PROCESSED', async () => {
      const chain: any = {};
      chain.insert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "idx_payments_unique_razorpay_payment_id"',
            },
          }),
        })),
      }));
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.then = vi.fn((resolve: any) => resolve({ data: [], error: null }));
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

      mockFrom.mockReturnValue(chain);

      await expect(
        service.createPayment({
          paymentId: 'pay_dup_rzp',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
          razorpayPaymentId: 'rzp_already_there',
        })
      ).rejects.toThrow('ALREADY_PROCESSED');
    });

    it('classifies payments_pkey as ALREADY_PROCESSED', async () => {
      const chain: any = {};
      chain.insert = vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "payments_pkey"',
            },
          }),
        })),
      }));
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.then = vi.fn((resolve: any) => resolve({ data: [], error: null }));
      chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

      mockFrom.mockReturnValue(chain);

      await expect(
        service.createPayment({
          paymentId: 'pay_existing_pk',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
        })
      ).rejects.toThrow('ALREADY_PROCESSED');
    });

    it('classifies idx_payments_one_completed_per_session as DUPLICATE_SESSION_PAYMENT for distinct capture', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "idx_payments_one_completed_per_session"',
                  },
                }),
              })),
            })),
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              // Query for existing Completed returns an earlier completed payment with different payment ID
              then: vi.fn((resolve: any) =>
                resolve({
                  data: [{ payment_id: 'original_completed_pay', razorpay_payment_id: 'rzp_original' }],
                  error: null,
                })
              ),
            })),
          };
        }
        return { select: vi.fn() };
      });

      await expect(
        service.createPayment({
          paymentId: 'new_distinct_pay',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
          razorpayPaymentId: 'rzp_new_capture',
        })
      ).rejects.toThrow('DUPLICATE_SESSION_PAYMENT');
    });

    it('throws PAYMENT_LOOKUP_FAILED when session query errors during 23505 handling', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "idx_payments_one_completed_per_session"',
                  },
                }),
              })),
            })),
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              then: vi.fn((resolve: any) =>
                resolve({
                  data: null,
                  error: { message: 'connection timeout to database cluster' },
                })
              ),
            })),
          };
        }
        return { select: vi.fn() };
      });

      await expect(
        service.createPayment({
          paymentId: 'pay_lookup_err',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
        })
      ).rejects.toThrow(/PAYMENT_LOOKUP_FAILED/);
    });

    it('throws UNIQUE_CONSTRAINT_VIOLATION when an unrelated unique constraint is violated and not found in lookups', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "unrelated_custom_uq"',
                  },
                }),
              })),
            })),
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              // All lookups return empty
              then: vi.fn((resolve: any) => resolve({ data: [], error: null })),
            })),
          };
        }
        return { select: vi.fn() };
      });

      await expect(
        service.createPayment({
          paymentId: 'pay_unrelated_conflict',
          studentUid: 'stud_1',
          amount: 5000,
          method: 'Online',
          status: 'Completed',
          sessionStartYear: 2026,
          sessionEndYear: 2027,
          razorpayPaymentId: 'rzp_unrelated',
        })
      ).rejects.toThrow('UNIQUE_CONSTRAINT_VIOLATION');
    });

    it('returns existing payment ID idempotently when createDuplicatePaymentRecord hits 23505', async () => {
      mockFrom.mockReturnValue({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key' },
            }),
          })),
        })),
      });

      const res = await service.createDuplicatePaymentRecord({
        paymentId: 'pay_already_in_dup_ledger',
        studentUid: 'stud_1',
        amount: 5000,
      });

      expect(res).toBe('pay_already_in_dup_ledger');
    });
  });

  describe('Area 3: Payment Statistics, Scalability & Aggregation', () => {
    it('uses get_payment_analytics_aggregates RPC when available', async () => {
      mockRpc.mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            total_payments: '2500',
            completed_payments: '2000',
            pending_payments: '425',
            duplicate_refund_count: '50',
            unresolved_review_count: '25',
            total_revenue: '10000000',
            online_payments: '1500',
            offline_payments: '500',
          },
          error: null,
        }),
      });

      const stats = await service.getPaymentStats();

      expect(mockRpc).toHaveBeenCalledWith('get_payment_analytics_aggregates');
      expect(stats.totalPayments).toBe(2500);
      expect(stats.completedPayments).toBe(2000);
      expect(stats.duplicateRefundCount).toBe(50);
      expect(stats.unresolvedReviewCount).toBe(25);
      expect(stats.totalRevenue).toBe(10000000);
      expect(stats.onlinePayments).toBe(1500);
      expect(stats.offlinePayments).toBe(500);
    });

    it('paginates across multiple chunks (>1000 rows) with stable created_at ordering and isolates review revenue on RPC fallback', async () => {
      // RPC returns error (e.g. function not found), triggering chunked pagination
      mockRpc.mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'function not found' } }),
      });

      // Page 1: 1,000 Completed rows at 5,000 INR
      const page1 = Array.from({ length: 1000 }, () => ({
        status: 'Completed',
        amount: 5000,
        method: 'Online',
      }));

      // Page 2: 550 rows (200 Completed at 5,000, 100 Duplicate_Pending_Refund at 5,000, 50 Captured_Pending_Review at 5,000, 200 Pending)
      const page2 = [
        ...Array.from({ length: 200 }, () => ({ status: 'Completed', amount: 5000, method: 'Offline' })),
        ...Array.from({ length: 100 }, () => ({ status: 'Duplicate_Pending_Refund', amount: 5000, method: 'Online' })),
        ...Array.from({ length: 50 }, () => ({ status: 'Captured_Pending_Review', amount: 5000, method: 'Online' })),
        ...Array.from({ length: 200 }, () => ({ status: 'Pending', amount: 5000, method: 'Online' })),
      ];

      const mockOrder = vi.fn(() => ({
        range: vi.fn((from: number, to: number) => {
          if (from === 0) return Promise.resolve({ data: page1, error: null });
          if (from === 1000) return Promise.resolve({ data: page2, error: null });
          return Promise.resolve({ data: [], error: null });
        }),
      }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn(() => ({
              order: mockOrder,
            })),
          };
        }
        return { select: vi.fn() };
      });

      const stats = await service.getPaymentStats();

      // Ensure stable created_at ordering was called for deterministic offset pagination
      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });

      // Total payments: 1,000 + 550 = 1,550
      expect(stats.totalPayments).toBe(1550);
      // Completed: 1,000 + 200 = 1,200
      expect(stats.completedPayments).toBe(1200);
      // Revenue includes ONLY Completed (1,200 * 5,000 = 6,000,000)
      // Duplicate_Pending_Refund and Captured_Pending_Review are NOT added to totalRevenue!
      expect(stats.totalRevenue).toBe(6000000);
      // Duplicate captures and unresolved captures counted completely:
      expect(stats.duplicateRefundCount).toBe(100);
      expect(stats.unresolvedReviewCount).toBe(50);
      expect(stats.pendingPayments).toBe(200);
      expect(stats.onlinePayments).toBe(1000);
      expect(stats.offlinePayments).toBe(200);
    });

    it('fails closed and throws error when a pagination chunk query fails', async () => {
      mockRpc.mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC not available' } }),
      });

      mockFrom.mockReturnValue({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database query timeout at offset 0' },
            }),
          })),
        })),
      });

      await expect(service.getPaymentStats()).rejects.toThrow(/Failed to fetch payment stats at offset 0/);
    });
  });
});
