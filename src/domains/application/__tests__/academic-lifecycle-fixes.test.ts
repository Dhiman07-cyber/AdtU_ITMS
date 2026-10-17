import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted Mocks ─────────────────────────────────────────────────────────────
const {
  mockRpc,
  mockCreateAuditEvent,
  mockSendApplicationRejectedNotification,
  mockRejectApplicationPayment,
  mockGetStudentById,
  mockGetUserById,
  mockFindByApplicantUid,
  mockReleaseSeat,
  mockOrder,
  mockEq,
  mockSelect,
  mockFrom,
} = vi.hoisted(() => {
  const mockOrderFn = vi.fn().mockReturnThis();
  const mockLimitFn = vi.fn().mockReturnThis();
  const mockMaybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockEqFn = vi.fn().mockReturnValue({
    order: mockOrderFn,
    limit: mockLimitFn,
    maybeSingle: mockMaybeSingleFn,
  });
  mockOrderFn.mockReturnValue({
    limit: mockLimitFn,
    maybeSingle: mockMaybeSingleFn,
  });
  const mockSelectFn = vi.fn().mockReturnValue({
    eq: mockEqFn,
  });
  const mockFromFn = vi.fn().mockReturnValue({
    select: mockSelectFn,
  });

  return {
    mockRpc: vi.fn(),
    mockCreateAuditEvent: vi.fn(),
    mockSendApplicationRejectedNotification: vi.fn(),
    mockRejectApplicationPayment: vi.fn(),
    mockGetStudentById: vi.fn(),
    mockGetUserById: vi.fn(),
    mockFindByApplicantUid: vi.fn(),
    mockReleaseSeat: vi.fn().mockResolvedValue({ success: true }),
    mockOrder: mockOrderFn,
    mockEq: mockEqFn,
    mockSelect: mockSelectFn,
    mockFrom: mockFromFn,
  };
});

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

vi.mock('@/domains/audit', () => ({
  createAuditEvent: mockCreateAuditEvent,
}));

vi.mock('@/domains/payment', () => ({
  rejectApplicationPayment: mockRejectApplicationPayment,
}));

vi.mock('@/domains/identity', () => ({
  getStudentById: mockGetStudentById,
  getUserById: mockGetUserById,
  deleteUnauthUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/seat', () => ({
  releaseSeat: mockReleaseSeat,
  assignSeat: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../repositories/application.repository', () => ({
  findByApplicantUid: mockFindByApplicantUid,
  findAll: vi.fn().mockResolvedValue([]),
  findByApplicationId: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  upsert: vi.fn(),
  count: vi.fn(),
}));

vi.mock('@/lib/services/admin-email.service', () => ({
  sendApplicationRejectedNotification: mockSendApplicationRejectedNotification,
}));

import { approve, getMyStatus, reject } from '../services/application.service';
import { pgFindByApplicantUid } from '../repositories/application.repository.pg';
import { isUpcomingApplication, resolveApplicationType } from '@/lib/utils/application-eligibility';

describe('Academic Lifecycle Verified Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ACAD-004: Name heuristic removal in eligibility', () => {
    it('does not classify a student named "Futureena Das" as a future application when session year is current', () => {
      const currentYear = new Date().getFullYear();
      const app = {
        formData: {
          fullName: 'Futureena Das',
          startYear: currentYear,
        },
      };

      expect(resolveApplicationType(app)).toBe('fresh');
      expect(isUpcomingApplication(app)).toBe(false);
    });

    it('does not classify a student with explicit application_type "fresh" and name "Mr Future Khan" as upcoming', () => {
      const app = {
        applicationType: 'fresh' as const,
        applicantName: 'Mr Future Khan',
        formData: {
          fullName: 'Mr Future Khan',
        },
      };

      expect(resolveApplicationType(app)).toBe('fresh');
      expect(isUpcomingApplication(app)).toBe(false);
    });

    it('correctly classifies genuine future-session applications when target startYear is greater than current year', () => {
      const futureYear = new Date().getFullYear() + 1;
      const app = {
        targetSession: { startYear: futureYear, endYear: futureYear + 1 },
      };

      expect(resolveApplicationType(app)).toBe('future');
      expect(isUpcomingApplication(app)).toBe(true);
    });
  });

  describe('REJ-001 & REJ-002: Rejection finalization ordering and RPC error handling', () => {
    it('surfaces RPC error when reject_application fails and does not proceed to finalize or email', async () => {
      mockRpc.mockImplementation((rpcName: string) => {
        if (rpcName === 'reject_application') {
          return Promise.resolve({ data: null, error: { message: 'Database connection failed' } });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await reject('app-1', { uid: 'mod-1', name: 'Moderator', role: 'moderator' }, 'Invalid docs');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(mockSendApplicationRejectedNotification).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalledWith('finalize_application_rejection', expect.anything());
    });

    it('does NOT send rejection email if finalize_application_rejection fails', async () => {
      mockRpc.mockImplementation((rpcName: string) => {
        if (rpcName === 'reject_application') {
          return Promise.resolve({
            data: {
              success: true,
              application: {
                applicant_uid: 'stud-1',
                email: 'student@example.com',
                full_name: 'Test Student',
              },
            },
            error: null,
          });
        }
        if (rpcName === 'finalize_application_rejection') {
          return Promise.resolve({
            data: { success: false, error: 'Failed to commit final deletion' },
            error: null,
          });
        }
        if (rpcName === 'release_application_lock') {
          return Promise.resolve({ data: { success: true }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await reject('app-1', { uid: 'mod-1', name: 'Moderator', role: 'moderator' }, 'Invalid docs');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to commit final deletion');
      // Invariant: Email must NEVER be sent if the database transaction did not commit
      expect(mockSendApplicationRejectedNotification).not.toHaveBeenCalled();
      // Lock released safely
      expect(mockRpc).toHaveBeenCalledWith('release_application_lock', { p_application_id: 'app-1' });
    });

    it('commits finalization in database before dispatching notification email and payment cleanup', async () => {
      const callSequence: string[] = [];

      mockRpc.mockImplementation((rpcName: string) => {
        if (rpcName === 'reject_application') {
          callSequence.push('reject_application');
          return Promise.resolve({
            data: {
              success: true,
              application: {
                applicant_uid: 'stud-1',
                email: 'student@example.com',
                full_name: 'Test Student',
                payment_id: 'pay-123',
              },
            },
            error: null,
          });
        }
        if (rpcName === 'finalize_application_rejection') {
          callSequence.push('finalize_application_rejection');
          return Promise.resolve({
            data: { success: true },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      mockRejectApplicationPayment.mockImplementation(async () => {
        callSequence.push('rejectApplicationPayment');
      });

      mockSendApplicationRejectedNotification.mockImplementation(async () => {
        callSequence.push('sendApplicationRejectedNotification');
      });

      const result = await reject('app-1', { uid: 'mod-1', name: 'Moderator', role: 'moderator' }, 'Invalid docs');

      expect(result.success).toBe(true);
      expect(callSequence).toEqual([
        'reject_application',
        'finalize_application_rejection',
        'rejectApplicationPayment',
        'sendApplicationRejectedNotification',
      ]);
    });
  });

  describe('ACAD-019: getMyStatus state consistency and false approval prevention', () => {
    it('returns approved when student profile is active', async () => {
      mockGetStudentById.mockResolvedValueOnce({
        uid: 'stud-active',
        status: 'active',
        busId: 'bus-1',
      });
      mockFindByApplicantUid.mockResolvedValueOnce(null);

      const status = await getMyStatus('stud-active');

      expect(status.status).toBe('approved');
      expect(status.message).toContain('approved');
    });

    it('returns renewal_required when student profile is soft_blocked', async () => {
      mockGetStudentById.mockResolvedValueOnce({
        uid: 'stud-sb',
        status: 'soft_blocked',
        busId: 'bus-1',
      });
      mockFindByApplicantUid.mockResolvedValueOnce(null);

      const status = await getMyStatus('stud-sb');

      expect(status.status).toBe('renewal_required');
      expect(status.message).toContain('requires renewal');
    });

    it('does NOT return approved if user exists in auth table but has no active student profile', async () => {
      // Student profile not found
      mockGetStudentById.mockResolvedValueOnce(null);
      // No application found
      mockFindByApplicantUid.mockResolvedValueOnce(null);

      const status = await getMyStatus('new-user-123');

      expect(status.status).toBe('no_application');
      expect(status.message).toBe('No application found');
    });

    it('returns draft status when application is in draft state', async () => {
      mockGetStudentById.mockResolvedValueOnce(null);
      mockFindByApplicantUid.mockResolvedValueOnce({
        applicationId: 'app-draft',
        applicantUid: 'user-draft',
        state: 'draft',
      });

      const status = await getMyStatus('user-draft');

      expect(status.status).toBe('draft');
      expect(status.message).toBe('Draft application saved');
    });

    it('returns pending status when application is submitted', async () => {
      mockGetStudentById.mockResolvedValueOnce(null);
      mockFindByApplicantUid.mockResolvedValueOnce({
        applicationId: 'app-sub',
        applicantUid: 'user-sub',
        state: 'submitted',
      });

      const status = await getMyStatus('user-sub');

      expect(status.status).toBe('pending');
      expect(status.message).toContain('Waiting for approval');
    });
  });

  describe('ACAD-001: pgFindByApplicantUid NULLS FIRST trap elimination', () => {
    it('orders applications by created_at DESC to guarantee strictly monotonic ordering', async () => {
      await pgFindByApplicantUid('applicant-uid-1');

      expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    });
  });

  describe('ACAD-008: Seat compensation during failed approval finalization', () => {
    it('triggers compensating seat release if finalize_application_approval fails after capacity increment', async () => {
      mockRpc.mockImplementation((rpcName: string, args: any) => {
        if (rpcName === 'approve_application') {
          return Promise.resolve({
            data: {
              success: true,
              application: {
                id: 'app-comp-1',
                applicant_uid: 'applicant-comp',
                applicant_email: 'comp@example.com',
                state: 'submitted',
                bus_id: 'bus-10',
                shift: 'Morning',
                form_data: {
                  fullName: 'Comp Student',
                  busId: 'bus-10',
                  shift: 'Morning',
                },
              },
            },
            error: null,
          });
        }
        if (rpcName === 'identity_activate_student_with_capacity') {
          // Increment and activation succeeded
          return Promise.resolve({
            data: { success: true },
            error: null,
          });
        }
        if (rpcName === 'finalize_application_approval') {
          // Final commit failed
          return Promise.resolve({
            data: null,
            error: { message: 'Database disk full or constraint violation' },
          });
        }
        if (rpcName === 'release_application_lock') {
          return Promise.resolve({ data: { success: true }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const result = await approve(
        'app-comp-1',
        { uid: 'admin-1', name: 'Admin', role: 'admin' },
        undefined,
        { busId: 'bus-10' }
      );

      expect(result.success).toBe(false);
      expect(mockReleaseSeat).toHaveBeenCalledWith('bus-10', 'applicant-comp', 'Morning');
    });
  });
});
