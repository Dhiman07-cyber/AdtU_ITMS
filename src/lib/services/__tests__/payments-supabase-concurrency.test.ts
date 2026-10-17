import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock Supabase Server
const mockFrom = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Mock encryption service
vi.mock('@/lib/security/encryption.service', () => ({
  encryptData: vi.fn((data) => `enc:${data}`),
  decryptData: vi.fn((data) => data?.replace(/^enc:/, '') || data),
}));

// Mock document crypto service
vi.mock('@/lib/security/document-crypto.service', () => ({
  DocumentCryptoService: {
    signDocumentPayload: vi.fn(() => 'sig_mock_123'),
  },
  buildDocumentPayloadFromPayment: vi.fn(() => ({})),
}));

function createChainableQuery(resultData: any) {
  const queryObj: any = {};
  queryObj.eq = vi.fn().mockReturnValue(queryObj);
  queryObj.select = vi.fn().mockReturnValue(queryObj);
  queryObj.single = vi.fn().mockResolvedValue({ data: resultData, error: null });
  queryObj.maybeSingle = vi.fn().mockResolvedValue({ data: resultData, error: null });
  queryObj.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: resultData, error: null }).then(resolve, reject);
  return queryObj;
}

describe('paymentsSupabaseService — Database Concurrency & 23505 Invariants', () => {
  let paymentsSupabaseService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/lib/services/payments-supabase');
    paymentsSupabaseService = mod.paymentsSupabaseService;
  });

  it('1. Throws ALREADY_PROCESSED (not DUPLICATE_SESSION_PAYMENT) when razorpay_payment_id conflict occurs', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'student_profiles' || table === 'users') {
        return createChainableQuery(null);
      }
      if (table === 'payments') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint idx_payments_unique_razorpay_payment_id' },
              }),
            }),
          }),
          select: vi.fn().mockImplementation((fields: string) => {
            const query: any = {};
            query.eq = vi.fn().mockImplementation((col: string, val: any) => {
              if (col === 'razorpay_payment_id') {
                return createChainableQuery([
                  { payment_id: 'pay_original', razorpay_payment_id: 'pay_AAA', status: 'Duplicate_Pending_Refund' }
                ]);
              }
              return createChainableQuery([]);
            });
            return query;
          }),
        };
      }
      return createChainableQuery(null);
    });

    await expect(
      paymentsSupabaseService.createPayment({
        paymentId: 'pay_retry',
        studentUid: 'stud_123',
        amount: 15000,
        status: 'Completed',
        sessionStartYear: 2026,
        sessionEndYear: 2027,
        razorpayPaymentId: 'pay_AAA',
      })
    ).rejects.toThrow('ALREADY_PROCESSED');
  });

  it('2. Throws DUPLICATE_SESSION_PAYMENT when conflict is on completed session index with a DIFFERENT payment ID', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'student_profiles' || table === 'users') {
        return createChainableQuery(null);
      }
      if (table === 'payments') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint idx_payments_one_completed_per_session' },
              }),
            }),
          }),
          select: vi.fn().mockImplementation((fields: string) => {
            const query: any = {};
            query.eq = vi.fn().mockImplementation((col: string, val: any) => {
              if (col === 'razorpay_payment_id' || col === 'payment_id') {
                return createChainableQuery([]);
              }
              if (col === 'status' && val === 'Completed') {
                return createChainableQuery([
                  { payment_id: 'pay_first', razorpay_payment_id: 'pay_first_provider', status: 'Completed' }
                ]);
              }
              return createChainableQuery([]);
            });
            return query;
          }),
        };
      }
      return createChainableQuery(null);
    });

    await expect(
      paymentsSupabaseService.createPayment({
        paymentId: 'pay_second',
        studentUid: 'stud_123',
        amount: 15000,
        status: 'Completed',
        sessionStartYear: 2026,
        sessionEndYear: 2027,
        razorpayPaymentId: 'pay_second_provider',
      })
    ).rejects.toThrow('DUPLICATE_SESSION_PAYMENT');
  });

  it('3. Guarantees non-null session start and end years when status is Completed', async () => {
    let capturedRecord: any = null;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'student_profiles' || table === 'users') {
        return createChainableQuery(null);
      }
      if (table === 'payments') {
        return {
          insert: vi.fn().mockImplementation(([record]: any[]) => {
            capturedRecord = record;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { payment_id: 'pay_new' },
                  error: null,
                }),
              }),
            };
          }),
          select: vi.fn().mockReturnValue(createChainableQuery([])),
        };
      }
      return createChainableQuery(null);
    });

    // 1. Omitted session years for Completed payment must NOT be defaulted to arbitrary integers
    await expect(
      paymentsSupabaseService.createPayment({
        paymentId: 'pay_new',
        studentUid: 'stud_123',
        amount: 15000,
        status: 'Completed',
      })
    ).rejects.toThrow(/INVALID_SESSION_YEARS/);

    // 2. Verified session years must be strictly preserved
    const result = await paymentsSupabaseService.createPayment({
      paymentId: 'pay_new',
      studentUid: 'stud_123',
      amount: 15000,
      status: 'Completed',
      sessionStartYear: 2026,
      sessionEndYear: 2027,
    });

    expect(result).toBe('pay_new');
    expect(capturedRecord).toBeDefined();
    expect(capturedRecord.session_start_year).toBe(2026);
    expect(capturedRecord.session_end_year).toBe(2027);
  });

  it('4. upsertPayment prevents downgrade of Duplicate_Pending_Refund or Captured_Pending_Review to Pending', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'student_profiles' || table === 'users') {
        return createChainableQuery(null);
      }
      if (table === 'payments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { payment_id: 'pay_duplicate_123', status: 'Duplicate_Pending_Refund', metadata: { some: 'val' } },
                error: null,
              }),
            }),
          }),
          upsert: vi.fn(),
        };
      }
      return createChainableQuery(null);
    });

    const result = await paymentsSupabaseService.upsertPayment({
      paymentId: 'pay_duplicate_123',
      studentUid: 'stud_123',
      amount: 15000,
      method: 'Online',
      status: 'Pending',
    });

    // Must return existing payment_id without writing a status downgrade
    expect(result).toBe('pay_duplicate_123');
  });

  it('5. claimPaymentForEntitlementRecovery issues sound PostgREST .or() filter handling NULL metadata', async () => {
    let capturedOrPredicate: string | null = null;
    let updateInvoked = false;

    mockFrom.mockImplementation((table: string) => {
      if (table === 'payments') {
        const queryObj: any = {};
        queryObj.eq = vi.fn().mockReturnValue(queryObj);
        queryObj.select = vi.fn().mockReturnValue(queryObj);
        queryObj.maybeSingle = vi.fn().mockImplementation(() => {
          if (updateInvoked) {
            return Promise.resolve({ data: { payment_id: 'pay_null_meta' }, error: null });
          }
          return Promise.resolve({
            data: { payment_id: 'pay_null_meta', metadata: null, status: 'Completed' },
            error: null,
          });
        });
        queryObj.single = queryObj.maybeSingle;
        queryObj.or = vi.fn().mockImplementation((predicate: string) => {
          capturedOrPredicate = predicate;
          return queryObj;
        });

        return {
          select: vi.fn().mockReturnValue(queryObj),
          update: vi.fn().mockImplementation(() => {
            updateInvoked = true;
            return queryObj;
          }),
        };
      }
      return createChainableQuery(null);
    });

    const result = await paymentsSupabaseService.claimPaymentForEntitlementRecovery('pay_null_meta');

    expect(result.claimed).toBe(true);
    expect(capturedOrPredicate).toContain('metadata.is.null');
    expect(capturedOrPredicate).toContain('metadata->>entitlement_status.is.null');
    expect(capturedOrPredicate).toContain('metadata->>recovering_since.lt');
  });
});

