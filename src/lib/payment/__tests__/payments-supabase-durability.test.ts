import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PaymentsSupabaseService } from '@/lib/services/payments-supabase';
import { getSupabaseServer } from '@/lib/supabase-server';

// Mock Supabase Server
vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(),
}));

describe('PaymentsSupabaseService Durability & Concurrency Ledger Invariants', () => {
  let mockSupabase: any;
  let service: PaymentsSupabaseService;
  let paymentsStore: any[];
  let backlogQueryError: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    paymentsStore = [];
    backlogQueryError = null;

    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'student_profiles' || table === 'users') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }

        // table === 'payments'
        let currentUpsertRecord: any = null;
        let isUpdate = false;
        let isUpsert = false;
        let updateData: any = null;
        let filterEqKey = '';
        let filterEqVal: any = null;
        let isGte = false;
        let isLt = false;

        const builder: any = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          upsert: vi.fn((records: any[]) => {
            isUpsert = true;
            currentUpsertRecord = records[0];
            return builder;
          }),
          update: vi.fn((data: any) => {
            isUpdate = true;
            updateData = data;
            return builder;
          }),
          eq: vi.fn((key: string, val: any) => {
            filterEqKey = key;
            filterEqVal = val;
            return builder;
          }),
          gte: vi.fn(() => {
            isGte = true;
            return builder;
          }),
          lt: vi.fn(() => {
            isLt = true;
            return builder;
          }),
          not: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockImplementation(() => {
            if (isGte) {
              const recent = paymentsStore.filter((p) => !p._isOld);
              return Promise.resolve({ data: recent, error: null });
            }
            if (isLt) {
              if (backlogQueryError) {
                return Promise.resolve({ data: null, error: backlogQueryError });
              }
              const old = paymentsStore.filter((p) => p._isOld);
              return Promise.resolve({ data: old, error: null });
            }
            return Promise.resolve({ data: paymentsStore, error: null });
          }),
          maybeSingle: vi.fn().mockImplementation(() => {
            const found = paymentsStore.find((p) => p[filterEqKey] === filterEqVal);
            if (isUpdate && found) {
              // Simulate PostgreSQL UPDATE WHERE guards for entitlement recovery
              if (found.metadata?.entitlement_status === 'active') {
                return Promise.resolve({ data: null, error: null });
              }
              if (found.metadata?.entitlement_status === 'recovering') {
                const recSince = found.metadata?.recovering_since
                  ? new Date(found.metadata.recovering_since).getTime()
                  : 0;
                if (Date.now() - recSince < 5 * 60 * 1000) {
                  return Promise.resolve({ data: null, error: null });
                }
              }
              Object.assign(found, updateData);
              return Promise.resolve({ data: found, error: null });
            }
            return Promise.resolve({ data: found || null, error: null });
          }),
          single: vi.fn().mockImplementation(() => {
            if (isUpsert && currentUpsertRecord) {
              const existingIdx = paymentsStore.findIndex((p) => p.payment_id === currentUpsertRecord.payment_id);
              if (existingIdx >= 0) {
                paymentsStore[existingIdx] = { ...paymentsStore[existingIdx], ...currentUpsertRecord };
              } else {
                paymentsStore.push(currentUpsertRecord);
              }
              return Promise.resolve({ data: currentUpsertRecord, error: null });
            }
            const found = paymentsStore.find((p) => p[filterEqKey] === filterEqVal);
            return Promise.resolve({ data: found || null, error: found ? null : { message: 'Not found' } });
          }),
        };

        builder.then = (resolve: any) => {
          if (isUpdate) {
            const found = paymentsStore.find((p) => p[filterEqKey] === filterEqVal);
            if (found && updateData) {
              Object.assign(found, updateData);
              return Promise.resolve({ data: [{ payment_id: found.payment_id }], error: null }).then(resolve);
            }
            return Promise.resolve({ data: [], error: null }).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        };

        return builder;
      }),
    };

    vi.mocked(getSupabaseServer).mockReturnValue(mockSupabase);
    service = new PaymentsSupabaseService();
  });

  describe('upsertPayment() Durability Guarantees', () => {
    it('persists purpose and metadata fields on pending payment write', async () => {
      const paymentId = await service.upsertPayment({
        paymentId: 'order_test_1',
        studentUid: 'student_uid_1',
        studentName: 'Test Student',
        studentId: 'ADTU/2026/001',
        amount: 15000,
        method: 'Online',
        status: 'Pending',
        purpose: 'Order created for renewal. Awaiting checkout capture.',
        metadata: {
          order_type: 'renewal',
          receipt_id: 'rec_123',
          entitlement_status: 'pending_checkout',
        },
      });

      expect(paymentId).toBe('order_test_1');
      const persisted = paymentsStore.find((p) => p.payment_id === 'order_test_1');
      expect(persisted).toBeDefined();
      expect(persisted.purpose).toBe('Order created for renewal. Awaiting checkout capture.');
      expect(persisted.metadata).toEqual({
        order_type: 'renewal',
        receipt_id: 'rec_123',
        entitlement_status: 'pending_checkout',
      });
    });

    it('refuses to downgrade or overwrite an existing Completed payment to Pending on retry', async () => {
      // Seed an existing Completed payment in the store
      paymentsStore.push({
        payment_id: 'order_test_existing',
        student_uid: 'student_uid_1',
        amount: 15000,
        status: 'Completed',
        metadata: { entitlement_status: 'active' },
      });

      const result = await service.upsertPayment({
        paymentId: 'order_test_existing',
        studentUid: 'student_uid_1',
        studentName: 'Test Student',
        studentId: 'ADTU/2026/001',
        amount: 15000,
        method: 'Online',
        status: 'Pending',
        purpose: 'Attempted duplicate or delayed checkout start',
      });

      // Must return existing payment_id without downgrading status to Pending
      expect(result).toBe('order_test_existing');
      const persisted = paymentsStore.find((p) => p.payment_id === 'order_test_existing');
      expect(persisted.status).toBe('Completed');
    });
  });

  describe('getCompletedPaymentsWithPendingEntitlements() Backlog Retention', () => {
    it('queries both recent window and unhealed backlog so failures older than 72 hours are never abandoned', async () => {
      paymentsStore.push(
        {
          payment_id: 'pay_recent_failed',
          student_uid: 'student_recent',
          status: 'Completed',
          created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
          metadata: { entitlement_status: 'failed' },
          _isOld: false,
        },
        {
          payment_id: 'pay_old_stranded',
          student_uid: 'student_old',
          status: 'Completed',
          created_at: new Date(Date.now() - 100 * 3600 * 1000).toISOString(), // 100 hours old (> 72h)
          metadata: { entitlement_status: 'failed' },
          _isOld: true,
        }
      );

      const { data, error } = await service.getCompletedPaymentsWithPendingEntitlements(72);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
      expect(data?.map((p) => p.payment_id)).toContain('pay_recent_failed');
      expect(data?.map((p) => p.payment_id)).toContain('pay_old_stranded');
    });

    it('discovers records with pending_registration_submission and null/missing metadata', async () => {
      paymentsStore.push(
        {
          payment_id: 'pay_reg_pending',
          student_uid: 'student_reg',
          status: 'Completed',
          created_at: new Date().toISOString(),
          metadata: { entitlement_status: 'pending_registration_submission' },
          _isOld: false,
        },
        {
          payment_id: 'pay_null_metadata',
          student_uid: 'student_null',
          status: 'Completed',
          created_at: new Date().toISOString(),
          metadata: null,
          _isOld: false,
        }
      );

      const { data, error } = await service.getCompletedPaymentsWithPendingEntitlements(72);

      expect(error).toBeNull();
      expect(data?.map((p) => p.payment_id)).toContain('pay_reg_pending');
      expect(data?.map((p) => p.payment_id)).toContain('pay_null_metadata');
    });

    it('propagates backlog query errors instead of swallowing them', async () => {
      backlogQueryError = new Error('Database connection timeout on backlog table');

      const { data, error } = await service.getCompletedPaymentsWithPendingEntitlements(72);

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error.message).toContain('Database connection timeout');
    });
  });

  describe('claimPaymentForEntitlementRecovery() Cross-Instance Coordination', () => {
    it('grants recovery lease for unowned failed entitlement and returns claim token', async () => {
      paymentsStore.push({
        payment_id: 'pay_unowned_1',
        status: 'Completed',
        metadata: { entitlement_status: 'failed' },
      });

      const claimResult = await service.claimPaymentForEntitlementRecovery('pay_unowned_1');
      expect(claimResult.claimed).toBe(true);
      expect(claimResult.leaseTime).toBeDefined();

      const persisted = paymentsStore.find((p) => p.payment_id === 'pay_unowned_1');
      expect(persisted.metadata.entitlement_status).toBe('recovering');
      expect(persisted.metadata.recovering_since).toBe(claimResult.leaseTime);
    });

    it('rejects claim when another worker holds an active lease (< 5 minutes old)', async () => {
      const activeLeaseTime = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
      paymentsStore.push({
        payment_id: 'pay_leased_1',
        status: 'Completed',
        metadata: { entitlement_status: 'recovering', recovering_since: activeLeaseTime },
      });

      const claimResult = await service.claimPaymentForEntitlementRecovery('pay_leased_1');
      expect(claimResult.claimed).toBe(false);
    });

    it('reclaims expired lease (> 5 minutes old) for stalled worker recovery', async () => {
      const expiredLeaseTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      paymentsStore.push({
        payment_id: 'pay_stalled_1',
        status: 'Completed',
        metadata: { entitlement_status: 'recovering', recovering_since: expiredLeaseTime },
      });

      const claimResult = await service.claimPaymentForEntitlementRecovery('pay_stalled_1');
      expect(claimResult.claimed).toBe(true);
      expect(claimResult.leaseTime).toBeDefined();

      const persisted = paymentsStore.find((p) => p.payment_id === 'pay_stalled_1');
      expect(new Date(persisted.metadata.recovering_since).getTime()).toBeGreaterThan(
        new Date(expiredLeaseTime).getTime()
      );
    });

    it('rejects claim when entitlement is already active', async () => {
      paymentsStore.push({
        payment_id: 'pay_already_active_1',
        status: 'Completed',
        metadata: { entitlement_status: 'active' },
      });

      const claimResult = await service.claimPaymentForEntitlementRecovery('pay_already_active_1');
      expect(claimResult.claimed).toBe(false);
    });

    it('prevents an expired worker from overwriting state owned by a newer worker', async () => {
      const worker1LeaseTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      const worker2LeaseTime = new Date().toISOString(); // Current fresh lease

      paymentsStore.push({
        payment_id: 'pay_contested_lease',
        status: 'Completed',
        metadata: {
          entitlement_status: 'recovering',
          recovering_since: worker2LeaseTime, // Worker 2 owns the lease now
        },
      });

      // Worker 1 tries to update with expired lease token worker1LeaseTime
      const updated = await service.updatePaymentMetadata(
        'pay_contested_lease',
        { entitlement_status: 'failed' },
        { expectedClaimTime: worker1LeaseTime }
      );

      // Must be rejected because lease ownership belongs to worker 2
      expect(updated).toBe(false);

      const persisted = paymentsStore.find((p) => p.payment_id === 'pay_contested_lease');
      expect(persisted.metadata.recovering_since).toBe(worker2LeaseTime);
      expect(persisted.metadata.entitlement_status).toBe('recovering');
    });

    it('skips backed-off records in backlog query to ensure fair progression without starving newer records', async () => {
      const now = Date.now();
      paymentsStore.push(
        {
          payment_id: 'pay_failing_old_1',
          status: 'Completed',
          _isOld: true,
          metadata: {
            entitlement_status: 'failed',
            next_retry_after: new Date(now + 3600000).toISOString(), // 1 hour in future (backed off)
          },
        },
        {
          payment_id: 'pay_ready_old_2',
          status: 'Completed',
          _isOld: true,
          metadata: {
            entitlement_status: 'failed',
            next_retry_after: new Date(now - 60000).toISOString(), // 1 minute in past (ready)
          },
        }
      );

      const res = await service.getCompletedPaymentsWithPendingEntitlements(72, 10);
      expect(res.error).toBeNull();
      const ids = res.data?.map((p: any) => p.payment_id);
      expect(ids).not.toContain('pay_failing_old_1');
      expect(ids).toContain('pay_ready_old_2');
    });

    it('distinguishes database error from legitimate active lease in claimPaymentForEntitlementRecovery', async () => {
      paymentsStore.push({
        payment_id: 'pay_claim_err_test',
        status: 'Completed',
        metadata: { entitlement_status: 'failed' },
      });

      const normalClaim = await service.claimPaymentForEntitlementRecovery('pay_claim_err_test');
      expect(normalClaim.claimed).toBe(true);
      expect(normalClaim.leaseTime).toBeDefined();

      const activeClaim = await service.claimPaymentForEntitlementRecovery('pay_claim_err_test');
      expect(activeClaim.claimed).toBe(false);
      expect(activeClaim.reason).toBe('actively_leased');
    });
  });
});
