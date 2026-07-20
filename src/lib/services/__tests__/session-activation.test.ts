import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockGetDeadlineConfig = vi.fn();
const mockSendBusFullAlert = vi.fn();
const mockComputeBlockDates = vi.fn();
const mockWriteAudit = vi.fn();
const mockPgUpsertUser = vi.fn();
const mockPgUpsertStudent = vi.fn();
const mockFindAlternatives = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/deadline-config-service', () => ({
  getDeadlineConfig: () => mockGetDeadlineConfig(),
}));

vi.mock('@/lib/busCapacityService', () => ({
  buildCapacityDelta: (...args: any[]) => ({ updates: {}, oldMembers: 0, newMembers: 0, capacity: 55, oldShiftLoad: 0, newShiftLoad: 0 }),
  sendBusFullAlert: (...args: any[]) => mockSendBusFullAlert(...args),
}));

vi.mock('@/lib/utils/deadline-computation', () => ({
  computeBlockDatesFromValidUntil: (...args: any[]) => mockComputeBlockDates(...args),
}));

vi.mock('@/domains/audit', () => ({
  createAuditEvent: (...args: any[]) => mockWriteAudit(...args),
  SYSTEM_ACTOR: { id: 'system', name: 'System (automated)', role: 'system' },
  queryAuditEvents: vi.fn().mockResolvedValue({ events: [], total: 0 }),
}));

vi.mock('@/domains/identity', () => ({
  createUser: (...args: any[]) => mockPgUpsertUser(...args),
  createStudent: (...args: any[]) => mockPgUpsertStudent(...args),
  getUsersByRole: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/domains/seat/repositories/seat.repository', () => ({
  findAlternatives: (...args: any[]) => mockFindAlternatives(...args),
}));

const mockGetAllByState = vi.fn().mockResolvedValue([]);
vi.mock('@/domains/application', () => ({
  getAllByState: (...args: any[]) => mockGetAllByState(...args),
  getById: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/domains/notification', () => ({
  createNotification: vi.fn().mockResolvedValue('notif-id'),
}));

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (...args: any[]) => ({
      doc: (docId: string) => ({
        path: `${args[0]}/${docId}`,
        get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        set: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      }),
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ docs: [], empty: true, size: 0 }),
          })),
        })),
        limit: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ docs: [], empty: true, size: 0 }),
        })),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          startAfter: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({ docs: [], empty: true, size: 0 }),
          })),
          get: vi.fn().mockResolvedValue({ docs: [], empty: true, size: 0 }),
        })),
      })),
      get: vi.fn().mockResolvedValue({ docs: [], empty: true, size: 0 }),
    }),
    batch: () => ({
      commit: vi.fn().mockResolvedValue(undefined),
    }),
  },
  adminAuth: {
    getUser: vi.fn().mockRejectedValue(new Error('not found')),
    deleteUser: vi.fn().mockResolvedValue(undefined),
  },
}));

// Fleet service mocks
const mockCheckBusCapacity = vi.fn();
const mockIncrementBusCapacity = vi.fn();
const mockDecrementBusCapacity = vi.fn();
const mockGetAllBuses = vi.fn().mockResolvedValue([]);
const mockGetBusById = vi.fn().mockResolvedValue(null);

vi.mock('@/domains/fleet/services/fleet.service', () => ({
  checkBusCapacity: (...args: any[]) => mockCheckBusCapacity(...args),
  incrementBusCapacity: (...args: any[]) => mockIncrementBusCapacity(...args),
  decrementBusCapacity: (...args: any[]) => mockDecrementBusCapacity(...args),
  getAllBuses: (...args: any[]) => mockGetAllBuses(...args),
  getBusById: (...args: any[]) => mockGetBusById(...args),
}));

// Supabase mock
const mockSupabaseResult = vi.fn().mockResolvedValue({ data: null, error: null });
const mockSupabaseChain = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    rpc: (...args: any[]) => mockRpc(...args),
    from: (table: string) => {
      const chain: Record<string, any> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.maybeSingle = mockSupabaseResult;
      chain.delete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      chain.update = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });
      chain.upsert = vi.fn().mockResolvedValue({ error: null });
      mockSupabaseChain(table, chain);
      return chain;
    },
  }),
}));

import { getSupabaseServer } from '@/lib/supabase-server';
import {
  getCurrentSessionStartYear,
  activateUpcomingSessionApplications,
} from '../session-activation.service';
import { DeadlineConfig } from '@/lib/types/deadline-config';

describe('Session Activation Service', () => {
  const dummyConfig: DeadlineConfig = {
    description: '',
    version: '1',
    lastUpdated: '',
    academicSessionStart: { month: 6, day: 1 },
    academicYear: {
      description: '',
      anchorMonth: 5,
      anchorMonthName: 'June',
      anchorDay: 30,
      anchorDayOrdinal: '30th',
    },
    renewalNotification: {} as any,
    renewalDeadline: {} as any,
    softBlock: {} as any,
    hardDelete: {} as any,
    urgentWarningThreshold: {} as any,
    contactInfo: {} as any,
    timeline: {} as any,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDeadlineConfig.mockResolvedValue(dummyConfig);
    mockComputeBlockDates.mockReturnValue({
      softBlock: '2026-07-15T00:00:00.000Z',
      hardBlock: '2026-08-15T00:00:00.000Z',
    });
    mockSendBusFullAlert.mockReset();
    mockWriteAudit.mockReset();
    mockPgUpsertUser.mockReset();
    mockPgUpsertStudent.mockReset();
    mockPgUpsertUser.mockResolvedValue(undefined);
    mockPgUpsertStudent.mockResolvedValue(undefined);
    mockCheckBusCapacity.mockReset();
    mockIncrementBusCapacity.mockReset();
    mockGetAllBuses.mockReset();
    mockGetBusById.mockReset();
    mockSupabaseResult.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Date Arithmetic and Leap Year Rollover', () => {
    it('correctly shifts June 30 by 1 day to July 1', () => {
      const year = 2026;
      const anchorMonth = 5;
      const anchorDay = 30;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(6);
      expect(activationDate.getDate()).toBe(1);
    });

    it('correctly handles February 28 to March 1 in non-leap year', () => {
      const year = 2026;
      const anchorMonth = 1;
      const anchorDay = 28;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(2);
      expect(activationDate.getDate()).toBe(1);
    });

    it('correctly handles February 28 to February 29 in leap year', () => {
      const year = 2024;
      const anchorMonth = 1;
      const anchorDay = 28;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(1);
      expect(activationDate.getDate()).toBe(29);
    });

    it('correctly handles February 29 to March 1 in leap year', () => {
      const year = 2024;
      const anchorMonth = 1;
      const anchorDay = 29;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(2);
      expect(activationDate.getDate()).toBe(1);
    });

    it('correctly handles December 31 to January 1 year rollover', () => {
      const year = 2026;
      const anchorMonth = 11;
      const anchorDay = 31;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getFullYear()).toBe(2027);
      expect(activationDate.getMonth()).toBe(0);
      expect(activationDate.getDate()).toBe(1);
    });
  });

  describe('getCurrentSessionStartYear', () => {
    it('returns this year if date is on or after the anchor date', () => {
      const now = new Date(Date.UTC(2026, 6, 1));
      const startYear = getCurrentSessionStartYear(dummyConfig, now);
      expect(startYear).toBe(2026);
    });

    it('returns last year if date is before the anchor date', () => {
      const now = new Date(Date.UTC(2026, 5, 29));
      const startYear = getCurrentSessionStartYear(dummyConfig, now);
      expect(startYear).toBe(2025);
    });
  });

  describe('activateUpcomingSessionApplications Gate Checks', () => {
    it('exits early if today is before the activation date', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 5, 30, 12, 0, 0)));

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });
      expect(summary.activationReached).toBe(false);
      expect(summary.scanned).toBe(0);
    });

    it('exits early if the marker for the current session already exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 2, 12, 0, 0)));

      mockSupabaseResult.mockResolvedValue({ data: { marker_key: 'activation_2026', marker_data: {} }, error: null });

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });
      expect(summary.activationReached).toBe(false);
      expect(summary.scanned).toBe(0);
    });

    it('exits early if the soft block completion marker is missing', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 2, 12, 0, 0)));

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });
      expect(summary.activationReached).toBe(false);
      expect(summary.scanned).toBe(0);
    });
  });

  describe('Deterministic Alternative Seat Allocation (PG-backed)', () => {
    it('sorts and assigns alternative buses via Fleet PG', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 12, 0, 0)));

      // findMarker returns: soft_block_completed_2026 exists, activation_2026 not found
      // Then PG app lookup returns verified_upcoming
      let maybeSingleCallCount = 0;
      mockSupabaseResult.mockImplementation(async () => {
        maybeSingleCallCount++;
        if (maybeSingleCallCount === 1) return { data: { marker_key: 'soft_block_completed_2026', marker_data: {} }, error: null };
        if (maybeSingleCallCount === 2) return { data: null, error: null };
        // PG app state check
        return { data: { state: 'verified_upcoming', application_id: 'app_1' }, error: null };
      });

      const mockBuses = [
        {
          id: 'bus_01', busId: 'bus_01', routeId: 'route_01', shift: 'Morning',
          currentMembers: 50, morningLoad: 50, eveningLoad: 0, capacity: 55,
          load: { morningCount: 50, eveningCount: 0 },
        },
        {
          id: 'bus_02', busId: 'bus_02', routeId: 'route_02', shift: 'Morning',
          currentMembers: 40, morningLoad: 40, eveningLoad: 0, capacity: 55,
          load: { morningCount: 40, eveningCount: 0 },
        },
        {
          id: 'bus_03', busId: 'bus_03', routeId: 'route_03', shift: 'Morning',
          currentMembers: 30, morningLoad: 30, eveningLoad: 0, capacity: 55,
          load: { morningCount: 30, eveningCount: 0 },
        },
        {
          id: 'bus_requested', busId: 'bus_requested', routeId: 'route_requested', shift: 'Morning',
          currentMembers: 55, morningLoad: 55, eveningLoad: 0, capacity: 55,
          load: { morningCount: 55, eveningCount: 0 },
        },
      ];

      mockGetAllBuses.mockResolvedValue(mockBuses);

      const mockApp = {
        applicationId: 'app_1',
        applicantUid: 'student_1',
        email: 'john@example.com',
        state: 'verified_upcoming',
        targetSession: { startYear: 2026, endYear: 2027 },
        formData: {
          fullName: 'John Doe',
          routeId: 'route_requested',
          stopId: 'stop_A',
          shift: 'Morning',
          enrollmentId: '123',
          email: 'john@example.com',
        },
      } as any;

      mockGetAllByState.mockImplementation(async (state: string) => {
        if (state === 'verified_upcoming') return [mockApp];
        return [];
      });

      // PG app lookup returns the app for state verification
      // (already configured in the maybeSingle mock above)

      // Requested bus is full → CapacityFullError; alternative bus_03 has capacity
      mockCheckBusCapacity
        .mockResolvedValueOnce({ available: false, shiftLoad: 55, capacity: 55, currentMembers: 55 })
        .mockResolvedValueOnce({ available: true, shiftLoad: 30, capacity: 55, currentMembers: 30 });

      // Only the alternative bus reaches increment (requested bus fails at checkBusCapacity)
      mockIncrementBusCapacity
        .mockResolvedValueOnce({ success: true, newShiftLoad: 31, capacity: 55, oldShiftLoad: 30 });

      mockFindAlternatives.mockResolvedValue({
        success: true,
        alternativeBuses: [
          {
            busId: 'bus_03',
            routeId: 'route_03',
            shift: 'Morning',
            currentMembers: 30,
            capacity: 55,
          },
        ],
      });

      mockGetBusById.mockResolvedValue({ busId: 'bus_03', busNumber: 'B03', routeId: 'route_03' });

      mockRpc.mockResolvedValue({ data: { success: true, processed: 1 }, error: null });

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });

      expect(summary.activated).toBe(1);
      expect(summary.failed).toBe(0);
      expect(mockRpc).toHaveBeenCalledWith('activate_session_batch', {
        p_session_year: 2026,
      });
    });
  });
});
