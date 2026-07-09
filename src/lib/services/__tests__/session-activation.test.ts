import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockGetDeadlineConfig = vi.fn();
const mockBuildCapacityDelta = vi.fn();
const mockSendBusFullAlert = vi.fn();
const mockComputeBlockDates = vi.fn();
const mockWriteAudit = vi.fn();
const mockPgUpsertUser = vi.fn();
const mockPgUpsertStudent = vi.fn();

vi.mock('@/lib/deadline-config-service', () => ({
  getDeadlineConfig: () => mockGetDeadlineConfig(),
}));

vi.mock('@/lib/busCapacityService', () => ({
  buildCapacityDelta: (...args: any[]) => mockBuildCapacityDelta(...args),
  sendBusFullAlert: (...args: any[]) => mockSendBusFullAlert(...args),
}));

vi.mock('@/lib/utils/deadline-computation', () => ({
  computeBlockDatesFromValidUntil: (...args: any[]) => mockComputeBlockDates(...args),
}));

vi.mock('@/lib/audit/audit-service', () => ({
  writeAuditInTransaction: (...args: any[]) => mockWriteAudit(...args),
  SYSTEM_ACTOR: 'system',
}));

vi.mock('@/domains/identity', () => ({
  createUser: (...args: any[]) => mockPgUpsertUser(...args),
  createStudent: (...args: any[]) => mockPgUpsertStudent(...args),
}));

// Mock adminDb
const mockGetDoc = vi.fn();
const mockQueryGet = vi.fn();
const mockSet = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockRunTransaction = vi.fn();
const mockCollection = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (...args: any[]) => mockCollection(...args),
    runTransaction: (fn: any) => mockRunTransaction(fn),
    batch: () => ({
      commit: vi.fn().mockResolvedValue(undefined),
    }),
  },
  FieldValue: {
    serverTimestamp: () => 'timestamp',
  },
}));

import {
  getCurrentSessionStartYear,
  activateUpcomingSessionApplications,
  activateSingleApplication,
} from '../session-activation.service';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { CapacityFullError } from '@/lib/errors/sentinel-errors';

describe('Session Activation Service', () => {
  const dummyConfig: DeadlineConfig = {
    description: '',
    version: '1',
    lastUpdated: '',
    academicSessionStart: { month: 6, day: 1 }, // July 1st
    academicYear: {
      description: '',
      anchorMonth: 5, // June (0-indexed)
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
    mockPgUpsertUser.mockResolvedValue(undefined);
    mockPgUpsertStudent.mockResolvedValue(undefined);

    mockGetDoc.mockResolvedValue({ exists: false, data: () => ({}) });
    mockQueryGet.mockResolvedValue({ docs: [], empty: true, size: 0 });

    mockCollection.mockImplementation((colName) => {
      const chain = {
        doc: (docId: string) => ({
          path: `${colName}/${docId}`,
          get: mockGetDoc,
          set: mockSet,
          update: mockUpdate,
          delete: mockDelete,
        }),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        get: mockQueryGet,
      };
      return chain;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Date Arithmetic and Leap Year Rollover', () => {
    it('correctly shifts June 30 by 1 day to July 1', () => {
      const year = 2026;
      const anchorMonth = 5; // June
      const anchorDay = 30;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(6); // July
      expect(activationDate.getDate()).toBe(1);
    });

    it('correctly handles February 28 to March 1 in non-leap year', () => {
      const year = 2026; // non-leap
      const anchorMonth = 1; // Feb
      const anchorDay = 28;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(2); // March
      expect(activationDate.getDate()).toBe(1);
    });

    it('correctly handles February 28 to February 29 in leap year', () => {
      const year = 2024; // leap year
      const anchorMonth = 1; // Feb
      const anchorDay = 28;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(1); // Feb
      expect(activationDate.getDate()).toBe(29);
    });

    it('correctly handles February 29 to March 1 in leap year', () => {
      const year = 2024; // leap year
      const anchorMonth = 1; // Feb
      const anchorDay = 29;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getMonth()).toBe(2); // March
      expect(activationDate.getDate()).toBe(1);
    });

    it('correctly handles December 31 to January 1 year rollover', () => {
      const year = 2026;
      const anchorMonth = 11; // December
      const anchorDay = 31;
      const sessionStartDate = new Date(year, anchorMonth, anchorDay, 0, 0, 0, 0);
      const activationDate = new Date(sessionStartDate);
      activationDate.setDate(activationDate.getDate() + 1);

      expect(activationDate.getFullYear()).toBe(2027);
      expect(activationDate.getMonth()).toBe(0); // January
      expect(activationDate.getDate()).toBe(1);
    });
  });

  describe('getCurrentSessionStartYear', () => {
    it('returns this year if date is on or after the anchor date', () => {
      const now = new Date(Date.UTC(2026, 6, 1)); // July 1, 2026 UTC
      const startYear = getCurrentSessionStartYear(dummyConfig, now);
      expect(startYear).toBe(2026);
    });

    it('returns last year if date is before the anchor date', () => {
      const now = new Date(Date.UTC(2026, 5, 29)); // June 29, 2026 UTC
      const startYear = getCurrentSessionStartYear(dummyConfig, now);
      expect(startYear).toBe(2025);
    });
  });

  describe('activateUpcomingSessionApplications Gate Checks', () => {
    it('exits early if today is before the activation date', async () => {
      // June 30, 2026 is the day before activation (July 1, 2026) for the 2026 session.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 5, 30, 12, 0, 0)));

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });
      expect(summary.activationReached).toBe(false);
      expect(summary.scanned).toBe(0);
    });

    it('exits early if the marker for the current session already exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 2, 12, 0, 0)));

      mockGetDoc.mockResolvedValue({ exists: true, data: () => ({}) });

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });
      expect(summary.activationReached).toBe(false);
      expect(summary.scanned).toBe(0);
    });

    it('exits early if the soft block completion marker is missing', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 2, 12, 0, 0)));

      mockGetDoc.mockResolvedValue({ exists: false, data: () => ({}) });

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });
      expect(summary.activationReached).toBe(false);
      expect(summary.scanned).toBe(0);
    });
  });

  describe('Deterministic Alternative Seat Allocation', () => {
    it('sorts and assigns alternative buses based on the deterministic rules', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.UTC(2026, 6, 1, 12, 0, 0)));

      const mockBuses = [
        {
          id: 'bus_01',
          busId: 'bus_01',
          routeId: 'route_01',
          shift: 'Morning',
          currentMembers: 50,
          capacity: 55,
          load: { morningCount: 50, eveningCount: 0 },
          route: {
            stops: [{ stopId: 'stop_A', name: 'Stop A' }],
          },
        },
        {
          id: 'bus_02',
          busId: 'bus_02',
          routeId: 'route_02',
          shift: 'Morning',
          currentMembers: 40,
          capacity: 55,
          load: { morningCount: 40, eveningCount: 0 },
          route: {
            stops: [{ stopId: 'stop_A', name: 'Stop A' }],
          },
        },
        {
          id: 'bus_03',
          busId: 'bus_03',
          routeId: 'route_03',
          shift: 'Morning',
          currentMembers: 30,
          capacity: 55,
          load: { morningCount: 30, eveningCount: 0 },
          route: {
            stops: [{ stopId: 'stop_A', name: 'Stop A' }],
          },
        },
        {
          id: 'bus_04',
          busId: 'bus_requested',
          routeId: 'route_requested',
          shift: 'Morning',
          currentMembers: 55,
          capacity: 55,
          load: { morningCount: 55, eveningCount: 0 },
          route: {
            stops: [{ stopId: 'stop_A', name: 'Stop A' }],
          },
        },
      ];

      const mockApp = {
        id: 'app_1',
        exists: true,
        ref: { path: 'applications/app_1' },
        data: () => ({
          applicantUid: 'student_1',
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
        }),
      };

      // Set query mock to return the application on first check, empty on second check, and empty on re-query check
      mockQueryGet
        .mockResolvedValueOnce({ docs: [mockApp], empty: false, size: 1 }) // First fetch in loop
        .mockResolvedValueOnce({ docs: [], empty: true, size: 0 }) // Second fetch in loop (empty)
        .mockResolvedValueOnce({ docs: [], empty: true, size: 0 }); // Re-query at end of run for marker check

      // Setup mock doc gets for marker checks and buses
      mockCollection.mockImplementation((colName) => {
        const chain = {
          doc: (docId: string) => ({
            path: `${colName}/${docId}`,
            get: vi.fn().mockImplementation(async () => {
              if (colName === 'settings') {
                if (docId.startsWith('soft_block_completed_')) {
                  return { exists: true, data: () => ({}) };
                }
                return { exists: false, data: () => ({}) };
              }
              if (colName === 'buses') {
                return { exists: true, data: () => mockBuses.find(b => b.id === docId) };
              }
              if (colName === 'applications') {
                return mockApp;
              }
              return { exists: false, data: () => ({}) };
            }),
            set: mockSet,
            update: mockUpdate,
            delete: mockDelete,
          }),
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          get: vi.fn().mockImplementation(async () => {
            if (colName === 'buses') {
              return {
                docs: mockBuses.map((b) => ({
                  id: b.id,
                  data: () => b,
                })),
                empty: false,
                size: mockBuses.length,
              };
            }
            return mockQueryGet();
          }),
        };
        return chain;
      });

      // Mock capacity delta updates
      mockBuildCapacityDelta.mockImplementation((busData, shift, change) => {
        if (busData.id === 'bus_requested' || busData.routeId === 'route_requested') {
          return { oldMembers: 55, oldShiftLoad: 55, newShiftLoad: 56, capacity: 55, updates: {} }; // full
        }
        const shiftLoad = busData.load?.morningCount || 0;
        return {
          oldMembers: busData.currentMembers,
          oldShiftLoad: shiftLoad,
          newShiftLoad: shiftLoad + 1,
          newMembers: busData.currentMembers + 1,
          capacity: busData.capacity,
          updates: { currentMembers: busData.currentMembers + 1 },
        };
      });

      // Mock transactions:
      // First transaction call (for requested bus) will throw CapacityFullError
      mockRunTransaction.mockImplementationOnce(async (fn: any) => {
        await fn({
          get: vi.fn().mockImplementation(async (ref) => {
            if (ref.path.includes('applications')) return mockApp;
            return { exists: true, data: () => mockBuses.find(b => b.busId === 'bus_requested' || b.routeId === 'route_requested') };
          }),
        });
      });

      // Second transaction call (for alternative bus 'bus_03') should succeed
      mockRunTransaction.mockImplementationOnce(async (fn: any) => {
        await fn({
          get: vi.fn().mockImplementation(async (ref) => {
            if (ref.path.includes('applications')) return mockApp;
            return { exists: true, data: () => mockBuses.find(b => b.id === 'bus_03') };
          }),
          set: mockSet,
          update: mockUpdate,
          delete: mockDelete,
        });
      });

      const summary = await activateUpcomingSessionApplications({ trigger: 'cron' });
      
      expect(summary.activated).toBe(1);
      expect(summary.failed).toBe(0);
      expect(mockRunTransaction).toHaveBeenCalledTimes(2);
    });
  });
});
