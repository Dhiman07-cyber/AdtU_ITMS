import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockClaimForActivation,
  mockReleaseActivationClaim,
  mockRemove,
  mockUpdate,
  mockCheckBusCapacity,
  mockIncrementBusCapacity,
  mockDecrementBusCapacity,
  mockCreateUser,
  mockCreateStudent,
  mockActivateStudentWithCapacity,
  mockCreateNotification,
  mockCreateAuditEvent,
} = vi.hoisted(() => ({
  mockClaimForActivation: vi.fn(),
  mockReleaseActivationClaim: vi.fn(),
  mockRemove: vi.fn(),
  mockUpdate: vi.fn(),
  mockCheckBusCapacity: vi.fn(),
  mockIncrementBusCapacity: vi.fn(),
  mockDecrementBusCapacity: vi.fn(),
  mockCreateUser: vi.fn(),
  mockCreateStudent: vi.fn(),
  mockActivateStudentWithCapacity: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockCreateAuditEvent: vi.fn(),
}));

vi.mock('@/domains/application/repositories/application.repository', () => ({
  findByApplicationId: vi.fn(),
  claimForActivation: mockClaimForActivation,
  releaseActivationClaim: mockReleaseActivationClaim,
  remove: mockRemove,
  update: mockUpdate,
}));

vi.mock('@/domains/fleet/services/fleet.service', () => ({
  getAllBuses: vi.fn().mockResolvedValue([]),
  getBusById: vi.fn().mockResolvedValue({ busId: 'bus-1', busNumber: 'BUS-01', routeId: 'route-1' }),
  checkBusCapacity: mockCheckBusCapacity,
  incrementBusCapacity: mockIncrementBusCapacity,
  decrementBusCapacity: mockDecrementBusCapacity,
  invalidateBusCache: vi.fn(),
}));

vi.mock('@/domains/route', () => ({
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn().mockResolvedValue({ id: 'route-1' }),
}));

vi.mock('@/domains/identity', () => ({
  createUser: mockCreateUser,
  createStudent: mockCreateStudent,
  activateStudentWithCapacity: mockActivateStudentWithCapacity,
  getUsersByRole: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/domains/notification', () => ({
  createNotification: mockCreateNotification,
}));

vi.mock('@/domains/audit', () => ({
  createAuditEvent: mockCreateAuditEvent,
  SYSTEM_ACTOR: { id: 'system', name: 'System', role: 'admin' },
}));

vi.mock('@/domains/seat/repositories/seat.repository', () => ({
  findAlternatives: vi.fn().mockResolvedValue({ success: true, alternativeBuses: [] }),
}));

vi.mock('@/lib/busCapacityService', () => ({
  sendBusFullAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/deadline-config-service', () => ({
  getDeadlineConfig: vi.fn().mockResolvedValue({
    academicYear: { anchorMonth: 5, anchorDay: 30 },
    academicSessionStart: { month: 5, day: 1 },
    softBlock: { month: 6, day: 15 },
    hardDelete: { month: 7, day: 1 },
  }),
}));

vi.mock('@/domains/admin', () => ({
  findMarker: vi.fn().mockResolvedValue(null),
  upsertMarker: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/domains/application', () => ({
  getAllByState: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByApplicantUid: vi.fn(),
}));

import { activateSingleApplication } from '../session-activation.service';
import * as applicationDomain from '@/domains/application';
import * as applicationRepo from '@/domains/application/repositories/application.repository';

describe('Session Activation — Concurrency & Capacity Invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseActivationClaim.mockResolvedValue(true);
    mockCreateUser.mockResolvedValue({ success: true });
    mockCreateStudent.mockResolvedValue({ success: true });
    mockActivateStudentWithCapacity.mockResolvedValue({
      success: true,
      capacity: 50,
      morningLoad: 21,
      eveningLoad: 20,
      currentMembers: 41,
    });
    mockRemove.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('proves exactly one runner claims and activates when two concurrent callers race on the same application', async () => {
    const mockApp = {
      applicationId: 'app-concurrent-1',
      applicantUid: 'student-concurrent-1',
      state: 'verified_upcoming',
      targetSession: { startYear: 2026, endYear: 2027 },
      formData: {
        fullName: 'Test Student',
        email: 'test@example.com',
        routeId: 'route-1',
        busId: 'bus-1',
        stop_name: 'Main Gate',
        shift: 'Morning',
      },
    };

    (applicationDomain.getById as any).mockResolvedValue(mockApp);
    (applicationRepo.findByApplicationId as any).mockResolvedValue(mockApp);

    // Atomic claim RPC simulation: first claim acquires lease, second claim returns null
    let claimCount = 0;
    mockClaimForActivation.mockImplementation(async () => {
      claimCount++;
      if (claimCount === 1) {
        return { ...mockApp, processingLock: 'activation_admin_1' };
      }
      return null; // Concurrently locked by runner 1
    });

    mockActivateStudentWithCapacity.mockResolvedValue({
      success: true,
      capacity: 50,
      morningLoad: 21,
      eveningLoad: 20,
      currentMembers: 41,
    });

    // Race both callers simultaneously
    const [result1, result2] = await Promise.all([
      activateSingleApplication('app-concurrent-1', 'admin'),
      activateSingleApplication('app-concurrent-1', 'admin'),
    ]);

    // Exactly one must activate; the other must be safely skipped without double work
    const activatedCount = (result1.activated || 0) + (result2.activated || 0);
    const skippedCount = (result1.skipped || 0) + (result2.skipped || 0);

    expect(activatedCount).toBe(1);
    expect(skippedCount).toBe(1);

    // Invariants:
    // 1. Bus capacity & student profile activated atomically exactly ONCE
    expect(mockActivateStudentWithCapacity).toHaveBeenCalledTimes(1);
    // 2. Application consumed (deleted) exactly ONCE
    expect(mockRemove).toHaveBeenCalledTimes(1);
  }, 30000);

  it('enforces capacity bound C under N concurrent activations', async () => {
    const CAPACITY = 3;
    let currentLoad = 0;

    mockActivateStudentWithCapacity.mockImplementation(async () => {
      if (currentLoad >= CAPACITY) {
        return { success: false, error: 'Bus is at full capacity (3/3)' };
      }
      currentLoad++;
      return {
        success: true,
        capacity: CAPACITY,
        morningLoad: currentLoad,
        eveningLoad: 0,
        currentMembers: currentLoad,
      };
    });

    // 6 distinct applications racing for 3 seats
    const N = 6;
    const apps = Array.from({ length: N }, (_, i) => ({
      applicationId: `app-${i}`,
      applicantUid: `uid-${i}`,
      state: 'verified_upcoming',
      targetSession: { startYear: 2026, endYear: 2027 },
      formData: {
        fullName: `Student ${i}`,
        email: `student${i}@example.com`,
        routeId: 'route-1',
        busId: 'bus-1',
        stop_name: 'Main Gate',
        shift: 'Morning',
      },
    }));

    (applicationDomain.getById as any).mockImplementation(async (id: string) => {
      return apps.find((a) => a.applicationId === id) || null;
    });

    (applicationRepo.findByApplicationId as any).mockImplementation(async (id: string) => {
      return apps.find((a) => a.applicationId === id) || null;
    });

    // Each app gets claimed by its worker
    mockClaimForActivation.mockImplementation(async (id: string) => {
      const found = apps.find((a) => a.applicationId === id);
      return found ? { ...found } : null;
    });

    const results = await Promise.all(
      apps.map((app) => activateSingleApplication(app.applicationId, 'admin'))
    );

    const totalActivated = results.reduce((sum, r) => sum + (r.activated || 0), 0);
    const totalPending = results.reduce((sum, r) => sum + (r.pendingSeatAllocation || 0), 0);

    // Invariants:
    // 1. Exactly CAPACITY activations succeeded
    expect(totalActivated).toBe(CAPACITY);
    // 2. Remaining N - CAPACITY safely moved to pending_seat_allocation
    expect(totalPending).toBe(N - CAPACITY);
    // 3. Final load never exceeded CAPACITY
    expect(currentLoad).toBeLessThanOrEqual(CAPACITY);
    // 4. Claims were released for all pending applications
    expect(mockReleaseActivationClaim).toHaveBeenCalledTimes(N - CAPACITY);
  }, 30000);
});
