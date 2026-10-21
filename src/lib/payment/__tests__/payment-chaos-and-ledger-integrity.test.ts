import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── In-Memory Database State for Full Ledger Simulation ──────────────────────
interface MockPaymentRow {
  payment_id: string;
  student_uid: string;
  student_id?: string;
  student_name?: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  session_start_year: number | null;
  session_end_year: number | null;
  duration_years: number;
  valid_until?: string | null;
  transaction_date?: string;
  razorpay_payment_id?: string | null;
  razorpay_order_id?: string | null;
  offline_transaction_id?: string | null;
  approved_by?: any;
  approved_at?: string | null;
  metadata?: any;
  document_signature?: string | null;
  created_at?: string;
}

interface MockStudentProfile {
  uid: string;
  full_name: string;
  enrollment_id: string;
  bus_id: string | null;
  shift: string;
  status: string;
  valid_until: string | null;
  soft_block: string | null;
  hard_block: string | null;
  seat_released_at: string | null;
  session_start_year: number;
  session_end_year: number;
  duration_years: number;
}

interface MockBus {
  id: string;
  busNumber: string;
  capacity: number;
  morningLoad: number;
  eveningLoad: number;
  currentMembers: number;
}

const dbPayments = new Map<string, MockPaymentRow>();
const dbStudents = new Map<string, MockStudentProfile>();
const dbBuses = new Map<string, MockBus>();
const dbApplications = new Map<string, any>();
const cacheInvalidations: string[] = [];

// ── Mock Cache Invalidation ──────────────────────────────────────────────────
vi.mock('@/domains/student', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domains/student')>();
  return {
    ...actual,
    getByUid: vi.fn(async (uid: string) => {
      const s = dbStudents.get(uid);
      if (!s) return null;
      return {
        uid: s.uid,
        fullName: s.full_name,
        name: s.full_name,
        enrollmentId: s.enrollment_id,
        busId: s.bus_id,
        currentBusId: s.bus_id,
        shift: s.shift,
        status: s.status,
        validUntil: s.valid_until,
        softBlock: s.soft_block,
        hardBlock: s.hard_block,
        seatReleasedAt: s.seat_released_at,
        sessionStartYear: s.session_start_year,
        sessionEndYear: s.session_end_year,
        durationYears: s.duration_years,
      };
    }),
    invalidateStudentAssignment: vi.fn(async (uid: string) => {
      cacheInvalidations.push(uid);
    }),
    invalidateStudentAssignmentCache: vi.fn(async (uid: string) => {
      cacheInvalidations.push(uid);
    }),
  };
});

// ── Mock Bus Fee ─────────────────────────────────────────────────────────────
vi.mock('@/lib/bus-fee-service', () => ({
  getCurrentBusFee: vi.fn(async () => ({
    amount: 50000,
    updatedAt: new Date().toISOString(),
    updatedByUid: 'admin_sys',
  })),
}));

// ── Mock Deadline Config ─────────────────────────────────────────────────────
vi.mock('@/lib/deadline-config-service', () => ({
  getDeadlineConfig: vi.fn(async () => ({
    academicYear: { startYear: 2026, endYear: 2027, anchorMonth: 5, anchorDay: 30 },
    month: 5,
    day: 30,
    academicSessionStart: { month: 6, day: 1 },
    softBlock: { month: 6, day: 1 },
    hardDelete: { month: 7, day: 1 },
  })),
}));

// ── Mock Notification & Audit ────────────────────────────────────────────────
vi.mock('@/domains/notification', () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/audit', () => ({
  createAuditEvent: vi.fn().mockResolvedValue(undefined),
  SYSTEM_ACTOR: { id: 'system', name: 'System', role: 'admin' },
}));

// ── Mock Identity Domain ─────────────────────────────────────────────────────
vi.mock('@/domains/identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domains/identity')>();
  return {
    ...actual,
    getUsersByRole: vi.fn(async () => [{ uid: 'admin_1', id: 'admin_1', role: 'admin' }]),
    getUserById: vi.fn(async (uid: string) => ({ uid, name: 'Admin User', role: 'admin' })),
    getStudentById: vi.fn(async (uid: string) => {
      const s = dbStudents.get(uid);
      if (!s) return null;
      return {
        uid: s.uid,
        fullName: s.full_name,
        name: s.full_name,
        enrollmentId: s.enrollment_id,
        busId: s.bus_id,
        shift: s.shift,
        status: s.status,
        validUntil: s.valid_until,
        softBlock: s.soft_block,
        hardBlock: s.hard_block,
        seatReleasedAt: s.seat_released_at,
        sessionStartYear: s.session_start_year,
        sessionEndYear: s.session_end_year,
      };
    }),
    getSeatOccupyingStudents: vi.fn(async () => {
      const arr: any[] = [];
      for (const s of dbStudents.values()) {
        arr.push({
          uid: s.uid,
          busId: s.bus_id,
          shift: s.shift,
          status: s.status,
          seatReleasedAt: s.seat_released_at,
          seat_released_at: s.seat_released_at,
        });
      }
      return arr;
    }),
  };
});

// ── Mock Fleet Domain ────────────────────────────────────────────────────────
vi.mock('@/domains/fleet', () => ({
  getAllBuses: vi.fn(async () => Array.from(dbBuses.values())),
  getBusById: vi.fn(async (id: string) => dbBuses.get(id) || null),
  updateBus: vi.fn(async (id: string, updates: any) => {
    const b = dbBuses.get(id);
    if (b) {
      Object.assign(b, updates);
    }
    return b;
  }),
}));

// ── Mock Seat Domain ─────────────────────────────────────────────────────────
vi.mock('@/domains/seat', () => ({
  releaseSeat: vi.fn().mockResolvedValue({ success: true }),
  assignSeat: vi.fn().mockResolvedValue({ success: true }),
  getCapacity: vi.fn(async (busId: string) => {
    const bus = dbBuses.get(busId);
    if (!bus) return { totalCapacity: 50, occupiedMorning: 0, occupiedEvening: 0, availableMorning: 50, availableEvening: 50, isAvailable: true };
    return {
      totalCapacity: bus.capacity,
      occupiedMorning: bus.morningLoad,
      occupiedEvening: bus.eveningLoad,
      availableMorning: bus.capacity - bus.morningLoad,
      availableEvening: bus.capacity - bus.eveningLoad,
      isAvailable: bus.morningLoad < bus.capacity,
    };
  }),
  findAlternativeBuses: vi.fn().mockResolvedValue([]),
  validateAssignment: vi.fn().mockResolvedValue({ valid: true }),
}));

// ── Mock Supabase Server Database Layer ──────────────────────────────────────
vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    from: (table: string) => {
      const eqFilters: { col: string; val: any }[] = [];
      let orFilters: string | null = null;
      let statusFilter: string[] | null = null;

      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((col: string, val: any) => {
          eqFilters.push({ col, val });
          return builder;
        }),
        or: vi.fn((expr: string) => {
          orFilters = expr;
          return builder;
        }),
        in: vi.fn((col: string, vals: any[]) => {
          if (col === 'status') statusFilter = vals;
          return builder;
        }),
        ilike: vi.fn((col: string, val: any) => {
          eqFilters.push({ col, val });
          return builder;
        }),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => {
          if (table === 'payments') {
            for (const row of dbPayments.values()) {
              const matchesEq = eqFilters.every(f => {
                const rowVal = (row as any)[f.col];
                if (typeof f.val === 'string' && typeof rowVal === 'string') {
                  return rowVal.toLowerCase() === f.val.toLowerCase();
                }
                return rowVal === f.val;
              });
              if (!matchesEq) continue;

              if (statusFilter && !statusFilter.includes(row.status)) continue;

              if (orFilters) {
                const matchOr =
                  orFilters.includes(row.payment_id) ||
                  (row.razorpay_order_id && orFilters.includes(row.razorpay_order_id));
                if (!matchOr) continue;
              }
              return { data: { ...row }, error: null };
            }
            return { data: null, error: null };
          }
          if (table === 'applications') {
            const appId = eqFilters.find(f => f.col === 'application_id')?.val;
            const app = appId ? dbApplications.get(appId) : Array.from(dbApplications.values())[0];
            return { data: app ? { ...app } : null, error: null };
          }
          return { data: null, error: null };
        }),
        single: vi.fn(async () => {
          const res = await builder.maybeSingle();
          return res;
        }),
        then: (resolve: any, reject?: any) => {
          let results: any[] = [];
          if (table === 'payments') {
            for (const row of dbPayments.values()) {
              const matchesEq = eqFilters.every(f => {
                const rowVal = (row as any)[f.col];
                if (typeof f.val === 'string' && typeof rowVal === 'string') {
                  return rowVal.toLowerCase() === f.val.toLowerCase();
                }
                return rowVal === f.val;
              });
              if (!matchesEq) continue;

              if (statusFilter && !statusFilter.includes(row.status)) continue;

              if (orFilters) {
                const matchOr =
                  orFilters.includes(row.payment_id) ||
                  (row.razorpay_order_id && orFilters.includes(row.razorpay_order_id));
                if (!matchOr) continue;
              }
              results.push({ ...row });
            }
          } else if (table === 'applications') {
            for (const app of dbApplications.values()) {
              results.push({ ...app });
            }
          }
          return Promise.resolve({ data: results, error: null }).then(resolve, reject);
        },
        insert: vi.fn((rows: any) => {
          const rowArray = Array.isArray(rows) ? rows : [rows];
          let res: { data: any; error: any } = { data: rowArray[0], error: null };
          if (table === 'payments') {
            for (const r of rowArray) {
              // Unique index simulation
              if (r.offline_transaction_id) {
                for (const existing of dbPayments.values()) {
                  if (
                    existing.offline_transaction_id &&
                    existing.offline_transaction_id.toLowerCase() === r.offline_transaction_id.toLowerCase() &&
                    ['Completed', 'Pending'].includes(existing.status)
                  ) {
                    res = {
                      data: null,
                      error: { code: '23505', details: 'idx_payments_unique_offline_tx_id' },
                    };
                    break;
                  }
                }
              }
              if (res.error) break;

              if (dbPayments.has(r.payment_id)) {
                res = {
                  data: null,
                  error: { code: '23505', details: 'payments_payment_id_key' },
                };
                break;
              }
              // Check session duplicate completed
              if (r.status === 'Completed' && r.student_uid && r.session_start_year && r.session_end_year) {
                for (const existing of dbPayments.values()) {
                  if (
                    existing.status === 'Completed' &&
                    existing.student_uid === r.student_uid &&
                    existing.session_start_year === r.session_start_year &&
                    existing.session_end_year === r.session_end_year &&
                    existing.payment_id !== r.payment_id
                  ) {
                    res = {
                      data: null,
                      error: { code: '23505', details: 'idx_payments_one_completed_per_session' },
                    };
                    break;
                  }
                }
              }
              if (res.error) break;

              dbPayments.set(r.payment_id, { ...r, created_at: new Date().toISOString() });
            }
          }

          const promise = Promise.resolve(res);
          return Object.assign(promise, {
            select: vi.fn(() => ({
              single: vi.fn(async () => res),
              maybeSingle: vi.fn(async () => res),
            })),
          });
        }),
        update: vi.fn((updates: any) => {
          const filters: { col: string; val: any }[] = [];
          const applyUpdate = () => {
            const updatedRows: any[] = [];
            if (table === 'payments') {
              for (const [k, row] of Array.from(dbPayments.entries())) {
                const match = filters.every(f => (row as any)[f.col] === f.val);
                if (match) {
                  const merged = { ...row, ...updates };
                  if (updates.payment_id && updates.payment_id !== k) {
                    dbPayments.delete(k);
                    dbPayments.set(updates.payment_id, merged);
                  } else {
                    dbPayments.set(k, merged);
                  }
                  updatedRows.push(merged);
                }
              }
            }
            return updatedRows;
          };

          const updateBuilder: any = {
            eq: vi.fn((col: string, val: any) => {
              filters.push({ col, val });
              return updateBuilder;
            }),
            or: vi.fn().mockReturnThis(),
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => {
                const rows = applyUpdate();
                return { data: rows[0] || null, error: null };
              }),
              single: vi.fn(async () => {
                const rows = applyUpdate();
                return { data: rows[0] || null, error: null };
              }),
              then: (resolve: any, reject?: any) => {
                const rows = applyUpdate();
                return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
              },
            })),
            then: (resolve: any, reject?: any) => {
              const rows = applyUpdate();
              return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            },
          };
          return updateBuilder;
        }),
        upsert: vi.fn((rows: any) => {
          const rowArray = Array.isArray(rows) ? rows : [rows];
          if (table === 'payments') {
            for (const r of rowArray) {
              dbPayments.set(r.payment_id, { ...r, created_at: new Date().toISOString() });
            }
          } else if (table === 'applications') {
            for (const r of rowArray) {
              dbApplications.set(r.application_id, { ...r, updated_at: new Date().toISOString() });
            }
          }
          const res = { data: rowArray[0], error: null };
          const promise = Promise.resolve(res);
          return Object.assign(promise, {
            select: vi.fn(() => ({
              single: vi.fn(async () => res),
              maybeSingle: vi.fn(async () => res),
            })),
          });
        }),
      };
      return builder;
    },
    rpc: vi.fn(async (rpcName: string, args: any) => {
      if (rpcName === 'approve_application') {
        const app = dbApplications.get(args.p_application_id);
        if (!app) return { data: { success: false, error: 'Application not found', status: 404 }, error: null };
        return { data: { success: true, application: app }, error: null };
      }
      if (rpcName === 'approve_renewal_with_seat') {
        // Enforce canonical signature contracts
        expect(args.p_application_id).toBeDefined();
        expect(args.p_student_uid).toBeDefined();
        expect(args.p_bus_id).toBeDefined();
        expect(typeof args.p_session_duration).toBe('string');

        const bus = dbBuses.get(args.p_bus_id);
        if (!bus) return { data: { success: false, error: 'Bus not found' }, error: null };
        if (bus.morningLoad >= bus.capacity || bus.eveningLoad >= bus.capacity) {
          return { data: { success: false, error: 'CAPACITY_FULL' }, error: null };
        }

        // Increment load
        bus.morningLoad += 1;
        bus.eveningLoad += 1;
        bus.currentMembers += 1;

        // Update student profile
        const student = dbStudents.get(args.p_student_uid);
        if (student) {
          student.status = 'active';
          student.seat_released_at = null;
          student.valid_until = args.p_valid_until;
          student.session_end_year = args.p_session_end_year;
          student.bus_id = args.p_bus_id;
        }

        // Update application
        const app = dbApplications.get(args.p_application_id);
        if (app) {
          app.state = 'approved';
          app.approved_by = args.p_approver_uid || args.p_approved_by;
          app.approved_at = new Date().toISOString();
        }

        return { data: { success: true }, error: null };
      }
      if (rpcName === 'release_application_lock') {
        return { data: { success: true }, error: null };
      }
      if (rpcName === 'process_payment_refund_atomic') {
        const payment = dbPayments.get(args.p_payment_id);
        if (!payment) return { data: { success: false, error: 'Payment not found' }, error: null };

        const priorStatus = payment.status;
        const isPartial = args.p_amount_paise < payment.amount * 100;
        if (!isPartial) {
          payment.status = 'Refunded';
        }

        // Revoke entitlement if sole completed payment
        if (priorStatus === 'Completed' && !isPartial) {
          const student = dbStudents.get(payment.student_uid);
          if (student) {
            student.status = 'soft_blocked';
            student.seat_released_at = new Date().toISOString();
            const bus = student.bus_id ? dbBuses.get(student.bus_id) : null;
            if (bus) {
              bus.morningLoad = Math.max(0, bus.morningLoad - 1);
              bus.eveningLoad = Math.max(0, bus.eveningLoad - 1);
              bus.currentMembers = Math.max(0, bus.currentMembers - 1);
            }
          }
        }

        return {
          data: {
            success: true,
            is_partial: isPartial,
            cumulative_refunded_paise: args.p_amount_paise,
            cumulative_refunded: args.p_amount_paise / 100,
            prior_status: priorStatus,
            student_uid: payment.student_uid,
          },
          error: null,
        };
      }
      return { data: { success: true }, error: null };
    }),
  })),
}));

// Import modules under test after mocks are registered
import { paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { processCapturedPayment } from '@/lib/payment/payment.service';
import * as Application from '@/domains/application';
import { adminReconcileBusLoads } from '@/lib/services/admin-reconcile-bus-loads';

describe('Payment Chaos, Concurrency & Financial Integrity Verification Suite', () => {
  beforeEach(() => {
    dbPayments.clear();
    dbStudents.clear();
    dbBuses.clear();
    dbApplications.clear();
    cacheInvalidations.length = 0;
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Millisecond Dual-Path Webhook + Verify-Payment Race & Promotion
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 1: Pre-checkout Pending order is atomically promoted to Completed on concurrent capture without orphaned rows', async () => {
    // 1. Create student profile
    dbStudents.set('student_101', {
      uid: 'student_101',
      full_name: 'Rahul Sharma',
      enrollment_id: 'ADTU/2026/101',
      bus_id: 'bus_01',
      shift: 'Morning',
      status: 'active',
      valid_until: '2026-06-30T23:59:59.999Z',
      soft_block: null,
      hard_block: null,
      seat_released_at: null,
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    // 2. Pre-checkout: create-order writes Pending row (payment_id = order_101)
    await paymentsSupabaseService.upsertPayment({
      paymentId: 'order_101',
      studentUid: 'student_101',
      studentId: 'ADTU/2026/101',
      studentName: 'Rahul Sharma',
      amount: 50000,
      method: 'Online',
      status: 'Pending',
      sessionStartYear: 2026,
      sessionEndYear: 2027,
      durationYears: 1,
      razorpayOrderId: 'order_101',
      purpose: 'Order created for renewal. Awaiting checkout capture.',
    });

    expect(dbPayments.has('order_101')).toBe(true);
    expect(dbPayments.get('order_101')?.status).toBe('Pending');

    // 3. Fire dual-path capture: Webhook (Worker A) and verify-payment (Worker B) concurrently
    const [resA, resB] = await Promise.all([
      processCapturedPayment({
        paymentId: 'pay_101',
        orderId: 'order_101',
        amount: 50000,
        method: 'Online',
        notes: {
          userId: 'student_101',
          studentId: 'ADTU/2026/101',
          sessionStartYear: '2026',
          sessionEndYear: '2027',
          durationYears: '1',
          purpose: 'renewal',
        },
        source: 'webhook',
      }),
      processCapturedPayment({
        paymentId: 'pay_101',
        orderId: 'order_101',
        amount: 50000,
        method: 'Online',
        notes: {
          userId: 'student_101',
          studentId: 'ADTU/2026/101',
          sessionStartYear: '2026',
          sessionEndYear: '2027',
          durationYears: '1',
          purpose: 'renewal',
        },
        source: 'verify_payment',
      }),
    ]);

    // Both callers receive success
    expect(['success', 'already_processed']).toContain(resA.status);
    expect(['success', 'already_processed']).toContain(resB.status);

    // Assert that the pre-checkout Pending row was promoted to Completed
    expect(dbPayments.has('pay_101')).toBe(true);
    const completedRow = dbPayments.get('pay_101')!;
    expect(completedRow.status).toBe('Completed');
    expect(completedRow.session_start_year).toBe(2026);
    expect(completedRow.session_end_year).toBe(2027);

    // ZERO orphaned Pending rows remain!
    expect(dbPayments.has('order_101')).toBe(false);
    expect(Array.from(dbPayments.values()).filter((p) => p.status === 'Pending')).toHaveLength(0);

    // Exactly 1 Completed ledger record exists in public.payments
    expect(Array.from(dbPayments.values()).filter((p) => p.status === 'Completed')).toHaveLength(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Concurrent Distinct Payments for Same Session -> Duplicate Refund
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 2: Concurrent distinct payments for same session routes secondary payment cleanly to Duplicate_Pending_Refund', async () => {
    dbStudents.set('student_102', {
      uid: 'student_102',
      full_name: 'Priya Das',
      enrollment_id: 'ADTU/2026/102',
      bus_id: 'bus_01',
      shift: 'Morning',
      status: 'active',
      valid_until: '2026-06-30T23:59:59.999Z',
      soft_block: null,
      hard_block: null,
      seat_released_at: null,
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    // First payment pay_A completes for 2026-2027
    const resA = await processCapturedPayment({
      paymentId: 'pay_A',
      orderId: 'order_A',
      amount: 50000,
      method: 'Online',
      notes: {
        userId: 'student_102',
        sessionStartYear: '2026',
        sessionEndYear: '2027',
        durationYears: '1',
        purpose: 'renewal',
      },
    });
    expect(resA.status).toBe('success');
    expect(dbPayments.get('pay_A')?.status).toBe('Completed');

    // Second distinct payment pay_B for the same student and session (accidentally paid twice)
    const resB = await processCapturedPayment({
      paymentId: 'pay_B',
      orderId: 'order_B',
      amount: 50000,
      method: 'Online',
      notes: {
        userId: 'student_102',
        sessionStartYear: '2026',
        sessionEndYear: '2027',
        durationYears: '1',
        purpose: 'renewal',
      },
    });

    // Secondary payment is caught and recorded as duplicate_pending_refund
    expect(resB.status).toBe('already_paid_for_session');
    expect(dbPayments.has('pay_B')).toBe(true);
    const dupRow = dbPayments.get('pay_B')!;
    expect(dupRow.status).toBe('Duplicate_Pending_Refund');
    expect(dupRow.metadata.duplicate_session_capture).toBe(true);

    // Verify only ONE Completed payment exists for this session
    const completed = Array.from(dbPayments.values()).filter(
      (p) => p.student_uid === 'student_102' && p.status === 'Completed'
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].payment_id).toBe('pay_A');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: approve_renewal_with_seat Full Contract & CAPACITY_FULL Override
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 3: approve_renewal_with_seat executes canonical parameters, handles CAPACITY_FULL with 409, and succeeds with bus override', async () => {
    // Setup full bus (50/50) and overflow bus (10/50)
    dbBuses.set('bus_full', {
      id: 'bus_full',
      busNumber: 'AS-01-FULL',
      capacity: 50,
      morningLoad: 50,
      eveningLoad: 50,
      currentMembers: 100,
    });
    dbBuses.set('bus_overflow', {
      id: 'bus_overflow',
      busNumber: 'AS-01-OVER',
      capacity: 50,
      morningLoad: 10,
      eveningLoad: 10,
      currentMembers: 20,
    });

    // Student soft-blocked whose seat was released
    dbStudents.set('student_103', {
      uid: 'student_103',
      full_name: 'Anupam Barman',
      enrollment_id: 'ADTU/2026/103',
      bus_id: 'bus_full',
      shift: 'Morning',
      status: 'soft_blocked',
      valid_until: '2026-06-30T23:59:59.999Z',
      soft_block: '2026-07-01T00:00:00Z',
      hard_block: '2026-08-01T00:00:00Z',
      seat_released_at: '2026-07-01T00:00:00Z',
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    dbApplications.set('app_renewal_103', {
      application_id: 'app_renewal_103',
      applicant_uid: 'student_103',
      application_type: 'renewal_after_soft_block',
      state: 'submitted',
      bus_id: 'bus_full',
      shift: 'Morning',
      form_data: { durationYears: 1, totalFee: 50000, paymentMode: 'online', paymentId: 'pay_103' },
    });

    // 1. Attempt approval on full bus without override -> returns 409 Conflict
    const resultFull = await Application.approve('app_renewal_103', {
      uid: 'admin_approver',
      name: 'Admin Officer',
      role: 'admin',
    });

    expect(resultFull.success).toBe(false);
    expect(resultFull.status).toBe(409);
    expect((resultFull as any).needsCapacityReview).toBe(true);
    expect(resultFull.error).toContain('CAPACITY_FULL');

    // 2. Re-attempt approval providing overrideBusId: 'bus_overflow' -> succeeds!
    const resultOverride = await Application.approve(
      'app_renewal_103',
      { uid: 'admin_approver', name: 'Admin Officer', role: 'admin' },
      undefined,
      { busId: 'bus_overflow' }
    );

    expect(resultOverride.success).toBe(true);

    // Verify student reassigned and reclaimed capacity on bus_overflow
    const studentAfter = dbStudents.get('student_103')!;
    expect(studentAfter.status).toBe('active');
    expect(studentAfter.seat_released_at).toBeNull();
    expect(studentAfter.bus_id).toBe('bus_overflow');

    const overflowBus = dbBuses.get('bus_overflow')!;
    expect(overflowBus.morningLoad).toBe(11); // incremented!
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: Offline Bank Reference Anti-Replay & Guaranteed Ledger Entry
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 4: Rejects duplicate offline transaction references with 409 Conflict and guarantees financial ledger entry', async () => {
    // Insert an existing payment with bank reference UTR123456789
    dbPayments.set('pay_offline_existing', {
      payment_id: 'pay_offline_existing',
      student_uid: 'student_prior',
      amount: 50000,
      currency: 'INR',
      method: 'Bank Transfer',
      status: 'Completed',
      session_start_year: 2026,
      session_end_year: 2027,
      duration_years: 1,
      offline_transaction_id: 'UTR123456789',
    });

    // Attempt to submit a new application with the same UTR123456789
    const submitResult = await Application.submitFinal(
      'student_104',
      'student104@adtu.in',
      {
        fullName: 'Bikash Kalita',
        phone: '9876543210',
        busId: 'bus_01',
        shift: 'Morning',
        paymentMode: 'offline',
        transactionId: 'utr123456789 ', // case and whitespace variant
        totalFee: 50000,
      },
      { applicationType: 'new' }
    );

    expect(submitResult.success).toBe(false);
    expect(submitResult.error).toContain('This bank transaction reference ID has already been used');
    expect((submitResult as any).status).toBe(409);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: Full Refund Entitlement Revocation vs Duplicate Refund Preservation
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 5: Full refund on Duplicate_Pending_Refund preserves student entitlement; full refund on active Completed revokes seat and soft-blocks', async () => {
    // 1. Student has an active Completed pass and a duplicate payment
    dbBuses.set('bus_01', {
      id: 'bus_01',
      busNumber: 'AS-01-0001',
      capacity: 50,
      morningLoad: 10,
      eveningLoad: 10,
      currentMembers: 20,
    });

    dbStudents.set('student_105', {
      uid: 'student_105',
      full_name: 'Dhruba Jyoti',
      enrollment_id: 'ADTU/2026/105',
      bus_id: 'bus_01',
      shift: 'Morning',
      status: 'active',
      valid_until: '2027-06-30T23:59:59.999Z',
      soft_block: null,
      hard_block: null,
      seat_released_at: null,
      session_start_year: 2026,
      session_end_year: 2027,
      duration_years: 1,
    });

    dbPayments.set('pay_primary', {
      payment_id: 'pay_primary',
      student_uid: 'student_105',
      amount: 50000,
      currency: 'INR',
      method: 'Online',
      status: 'Completed',
      session_start_year: 2026,
      session_end_year: 2027,
      duration_years: 1,
    });

    dbPayments.set('pay_duplicate', {
      payment_id: 'pay_duplicate',
      student_uid: 'student_105',
      amount: 50000,
      currency: 'INR',
      method: 'Online',
      status: 'Duplicate_Pending_Refund',
      session_start_year: 2026,
      session_end_year: 2027,
      duration_years: 1,
    });

    // Case A: Full refund on Duplicate_Pending_Refund -> student remains active and retains seat
    const refundDupResult = await paymentsSupabaseService.confirmManualRefundRecord({
      paymentId: 'pay_duplicate',
      refundReference: 'RFND_DUP_105',
      refundedAmount: 50000,
      authorizedBy: { userId: 'admin_fin', name: 'Finance Admin', role: 'admin' },
      reason: 'Refund accidental double payment',
    });

    expect(refundDupResult.success).toBe(true);
    expect(dbPayments.get('pay_duplicate')?.status).toBe('Refunded');

    // Student profile and bus load remain active and untouched!
    const studentMid = dbStudents.get('student_105')!;
    expect(studentMid.status).toBe('active');
    expect(studentMid.seat_released_at).toBeNull();
    expect(dbBuses.get('bus_01')?.morningLoad).toBe(10);

    // Case B: Full refund on the sole active Completed payment -> revokes entitlement and decrements capacity
    const refundPrimaryResult = await paymentsSupabaseService.confirmManualRefundRecord({
      paymentId: 'pay_primary',
      refundReference: 'RFND_PRIM_105',
      refundedAmount: 50000,
      authorizedBy: { userId: 'admin_fin', name: 'Finance Admin', role: 'admin' },
      reason: 'Student withdrew registration',
    });

    expect(refundPrimaryResult.success).toBe(true);
    expect(dbPayments.get('pay_primary')?.status).toBe('Refunded');

    // Student is soft-blocked, seat is released, and bus capacity is decremented!
    const studentFinal = dbStudents.get('student_105')!;
    expect(studentFinal.status).toBe('soft_blocked');
    expect(studentFinal.seat_released_at).not.toBeNull();
    expect(dbBuses.get('bus_01')?.morningLoad).toBe(9); // decremented!
    expect(cacheInvalidations).toContain('student_105');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SCENARIO 6: Bus Load Reconciliation Parity with 'Both' Shift
  // ────────────────────────────────────────────────────────────────────────────
  it('Scenario 6: adminReconcileBusLoads accurately reconciles Morning, Evening, and Both shifts while ignoring released seats', async () => {
    dbBuses.set('bus_test', {
      id: 'bus_test',
      busNumber: 'AS-01-TEST',
      capacity: 50,
      morningLoad: 99, // intentionally corrupted / drifted load
      eveningLoad: 99,
      currentMembers: 198,
    });

    // S1: Morning active
    dbStudents.set('s1', {
      uid: 's1',
      full_name: 'Student One',
      enrollment_id: 'E1',
      bus_id: 'bus_test',
      shift: 'Morning',
      status: 'active',
      valid_until: '2026-06-30',
      soft_block: null,
      hard_block: null,
      seat_released_at: null,
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    // S2: Evening active
    dbStudents.set('s2', {
      uid: 's2',
      full_name: 'Student Two',
      enrollment_id: 'E2',
      bus_id: 'bus_test',
      shift: 'Evening',
      status: 'active',
      valid_until: '2026-06-30',
      soft_block: null,
      hard_block: null,
      seat_released_at: null,
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    // S3: Both shifts active (+1 morning, +1 evening)
    dbStudents.set('s3', {
      uid: 's3',
      full_name: 'Student Three',
      enrollment_id: 'E3',
      bus_id: 'bus_test',
      shift: 'Both',
      status: 'active',
      valid_until: '2026-06-30',
      soft_block: null,
      hard_block: null,
      seat_released_at: null,
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    // S4: Soft blocked whose seat WAS released -> must NOT count
    dbStudents.set('s4', {
      uid: 's4',
      full_name: 'Student Four',
      enrollment_id: 'E4',
      bus_id: 'bus_test',
      shift: 'Morning',
      status: 'soft_blocked',
      valid_until: '2026-06-30',
      soft_block: '2026-07-01',
      hard_block: '2026-08-01',
      seat_released_at: '2026-07-01T00:00:00Z',
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    // S5: Soft blocked whose seat was NOT yet released -> counts toward Evening
    dbStudents.set('s5', {
      uid: 's5',
      full_name: 'Student Five',
      enrollment_id: 'E5',
      bus_id: 'bus_test',
      shift: 'Evening',
      status: 'soft_blocked',
      valid_until: '2026-06-30',
      soft_block: '2026-07-01',
      hard_block: '2026-08-01',
      seat_released_at: null,
      session_start_year: 2025,
      session_end_year: 2026,
      duration_years: 1,
    });

    const summary = await adminReconcileBusLoads({
      busIds: ['bus_test'],
      dryRun: false,
    });

    expect(summary.busesCorrected).toBe(1);

    const reconciledBus = dbBuses.get('bus_test')!;
    // Morning: S1 (Morning) + S3 (Both) = 2
    expect(reconciledBus.morningLoad).toBe(2);
    // Evening: S2 (Evening) + S3 (Both) + S5 (Evening unreleased) = 3
    expect(reconciledBus.eveningLoad).toBe(3);
    // Canonical total: morningLoad + eveningLoad = 5
    expect(reconciledBus.currentMembers).toBe(5);
  });
});
