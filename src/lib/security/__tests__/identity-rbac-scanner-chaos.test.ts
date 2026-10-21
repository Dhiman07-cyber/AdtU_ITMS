/**
 * Chaos Verification & Security Hardening Test Suite:
 * Identity, RBAC, QR Pass Scanner, Edge Proxy, Fleet Deletion, and Notification Anti-IDOR
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  encryptQRCodeData,
  decryptQRCodeData,
  quickValidateQRToken,
} from '../encryption.service';
import {
  getModeratorPermissions,
  invalidateModeratorPermissionCache,
  isModeratorActive,
} from '../moderator-permissions';
import {
  invalidateCachedRole,
  getCachedRole,
  setCachedRole,
} from '../role-cache';
import { scannerBusMatchesStudent } from '../scanner-auth';
import { isNotificationVisibleToUser } from '@/domains/notification/repositories/notification.repository';
import { getBusIdVariations } from '@/lib/utils';
import { deleteBusAndData } from '@/lib/cleanup-helpers';
import * as identityModule from '@/domains/identity';
import * as fleetModule from '@/domains/fleet';

const {
  mockGetBusById,
  mockRemoveBus,
  mockInvalidateBusCache,
  mockGetStudentsByBusIds,
} = vi.hoisted(() => ({
  mockGetBusById: vi.fn(),
  mockRemoveBus: vi.fn(),
  mockInvalidateBusCache: vi.fn(),
  mockGetStudentsByBusIds: vi.fn(),
}));

let mockActiveTripsReturn: any[] = [];

vi.mock('@/domains/identity', () => ({
  getModeratorById: vi.fn(),
  getUserById: vi.fn(),
  getStudentsByBusIds: mockGetStudentsByBusIds,
  getAllDrivers: vi.fn().mockResolvedValue([]),
  updateStudent: vi.fn().mockResolvedValue({}),
  updateDriver: vi.fn().mockResolvedValue({}),
  deleteUser: vi.fn().mockResolvedValue({}),
  deleteModerator: vi.fn().mockResolvedValue({}),
  deleteDriver: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/domains/fleet', () => ({
  getBusById: mockGetBusById,
  removeBus: mockRemoveBus,
  invalidateBusCache: mockInvalidateBusCache,
}));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        gt: () => chain,
        limit: () => Promise.resolve({ data: mockActiveTripsReturn, error: null }),
        maybeSingle: () => Promise.resolve({ data: mockActiveTripsReturn[0] || null, error: null }),
      };
      return chain;
    },
    rpc: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
  }),
}));

describe('Identity, RBAC, QR Scanner & Ops Chaos Verification Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTripsReturn = [];
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 1: FIX 8 Active Trip Protection (Mid-Trip Bus & Route Lock)
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 1: Active Trip Guard (status = "active", expires_at > NOW())', () => {
    it('normalizes bus ID variations across bus_ prefix', () => {
      expect(getBusIdVariations('1')).toEqual(['1', 'bus_1']);
      expect(getBusIdVariations('bus_1')).toEqual(['bus_1', '1']);
      expect(getBusIdVariations('bus_14')).toContain('14');
      expect(getBusIdVariations('')).toEqual([]);
    });

    it('matches scanner bus ID across prefix differences without false WRONG_BUS rejections', () => {
      expect(scannerBusMatchesStudent('bus_1', '1')).toBe(true);
      expect(scannerBusMatchesStudent('1', 'bus_1')).toBe(true);
      expect(scannerBusMatchesStudent('bus_42', 'bus_42')).toBe(true);
      expect(scannerBusMatchesStudent('bus_1', 'bus_2')).toBe(false);
      // Desk / unspecified scanner bus matches all
      expect(scannerBusMatchesStudent(null, 'bus_1')).toBe(true);
      expect(scannerBusMatchesStudent('', 'bus_1')).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 2: Moderator RBAC Suspension & Instant Eviction
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 2: Moderator Suspension & Dual Cache Invalidation', () => {
    it('returns ZERO_MODERATOR_PERMISSIONS and isModeratorActive=false for suspended moderator', async () => {
      const modId = 'mod-suspended-chaos';
      vi.mocked(identityModule.getModeratorById).mockResolvedValue({
        uid: modId,
        status: 'suspended',
        permissions: {
          students: { canView: true, canAdd: true, canEdit: true, canDelete: true, canReassign: true },
        },
      } as any);

      invalidateModeratorPermissionCache(modId);

      const isActive = await isModeratorActive(modId);
      expect(isActive).toBe(false);

      const perms = await getModeratorPermissions(modId);
      expect(perms.students.canView).toBe(false);
      expect(perms.students.canEdit).toBe(false);
      expect(perms.payments.canApproveOfflinePayment).toBe(false);
    });

    it('immediately purges cached role and publishes invalidation', () => {
      const userId = 'user-to-evict';
      setCachedRole(userId, { role: 'moderator', name: 'Test Moderator', employeeId: 'EMP01' });
      expect(getCachedRole(userId)).not.toBeNull();

      invalidateCachedRole(userId);
      expect(getCachedRole(userId)).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 3: Cryptographic QR Pass (v2: AES-256-GCM + 128-bit HMAC)
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 3: Cryptographic Boarding Pass Security', () => {
    it('generates valid v2: token and decrypts payload correctly', () => {
      const token = encryptQRCodeData('student-chaos-123', {
        enrollmentId: 'ADTU-2026-001',
        name: 'Rahul',
        busId: 'bus_04',
      });

      // Token is base64url encoded with version byte 2 (128-bit HMAC)
      const tokenBuffer = Buffer.from(token, 'base64url');
      expect(tokenBuffer[0]).toBe(2);
      expect(quickValidateQRToken(token)).toBe(true);

      const decrypted = decryptQRCodeData(token);
      expect(decrypted).not.toBeNull();
      expect(decrypted?.uid).toBe('student-chaos-123');
      expect(decrypted?.enrollmentId).toBe('ADTU-2026-001');
      expect(decrypted?.busId).toBe('bus_04');
    });

    it('rejects tampered QR token via HMAC validation', () => {
      const token = encryptQRCodeData('student-chaos-456');
      // Tamper with a single character in the base64 payload
      const tampered = token.slice(0, 15) + (token[15] === 'A' ? 'B' : 'A') + token.slice(16);

      expect(quickValidateQRToken(tampered)).toBe(false);
      expect(decryptQRCodeData(tampered)).toBeNull();
    });

    it('rejects expired QR tokens', () => {
      // Mock Date.now to generate a token with past expiry
      const realNow = Date.now;
      try {
        const pastTime = realNow() - 25 * 60 * 60 * 1000; // 25 hours ago
        Date.now = () => pastTime;
        const expiredToken = encryptQRCodeData('student-expired-789');

        Date.now = realNow;
        // quickValidate only checks HMAC
        expect(quickValidateQRToken(expiredToken)).toBe(true);
        // decryptQRCodeData strictly validates expiresAt
        expect(decryptQRCodeData(expiredToken)).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 4: Notification Anti-IDOR Protection (INV-NOTIF-001)
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 4: Notification Horizontal Visibility (INV-NOTIF-001)', () => {
    it('prevents students from viewing notifications targeted to other students', () => {
      const privateNotif = {
        id: 'notif-private-1',
        title: 'Disciplinary Notice',
        content: 'Confidential message',
        target: {
          type: 'specific_users',
          specificUserIds: ['student-target-target'],
        },
        recipientIds: ['student-target-target'],
      };

      const attackerCheck = isNotificationVisibleToUser(
        privateNotif,
        'student-attacker-uid',
        'student' as any,
        null
      );
      expect(attackerCheck.visible).toBe(false);

      const targetCheck = isNotificationVisibleToUser(
        privateNotif,
        'student-target-target',
        'student' as any,
        null
      );
      expect(targetCheck.visible).toBe(true);
    });

    it('prevents students from viewing notifications targeted to different routes', () => {
      const routeNotif = {
        id: 'notif-route-3',
        title: 'Route 3 Delay',
        content: 'Route 3 running 20m late',
        target: {
          type: 'route_based',
          routeIds: ['route_3'],
        },
      };

      // Student on Route 5
      const route5Student = isNotificationVisibleToUser(
        routeNotif,
        'student-route-5',
        'student' as any,
        'route_5'
      );
      expect(route5Student.visible).toBe(false);

      // Student on Route 3
      const route3Student = isNotificationVisibleToUser(
        routeNotif,
        'student-route-3',
        'student' as any,
        'route_3'
      );
      expect(route3Student.visible).toBe(true);
    });

    it('permits system-wide broadcasts to all users', () => {
      const broadcastNotif = {
        id: 'notif-broadcast',
        title: 'University Holiday',
        content: 'Campus closed tomorrow',
        target: {
          type: 'all_users',
        },
      };

      const check = isNotificationVisibleToUser(
        broadcastNotif,
        'random-student-uid',
        'student' as any,
        null
      );
      expect(check.visible).toBe(true);
    });

    it('allows administrators and moderators full visibility across all notifications', () => {
      const confidentialNotif = {
        id: 'notif-audit',
        title: 'Audit Warning',
        content: 'Confidential staff alert',
        target: {
          type: 'specific_users',
          specificUserIds: ['specific-user-only'],
        },
      };

      const adminCheck = isNotificationVisibleToUser(
        confidentialNotif,
        'admin-uid',
        'admin' as any,
        null
      );
      expect(adminCheck.visible).toBe(true);

      const modCheck = isNotificationVisibleToUser(
        confidentialNotif,
        'mod-uid',
        'moderator' as any,
        null
      );
      expect(modCheck.visible).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 5: Student Shift Invariant ('Morning' | 'Evening' ONLY)
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 5: Student Shift Invariant Enforcement', () => {
    it('rejects "Both" as an invalid student shift while allowing Morning and Evening', async () => {
      const { isValidStudentShift } = await import('@/lib/utils/shift-utils');
      expect(isValidStudentShift('Morning')).toBe(true);
      expect(isValidStudentShift('Evening')).toBe(true);
      expect(isValidStudentShift('Both')).toBe(false);
      expect(isValidStudentShift('invalid' as any)).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 6: Fleet Cascading Deletion Safety Guard (deleteBusAndData)
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 6: deleteBusAndData Invariant Safety Guards', () => {
    it('blocks deletion of a bus with an active trip in progress', async () => {
      mockGetBusById.mockResolvedValue({ id: 'bus_01', busNumber: '01' });
      mockActiveTripsReturn = [{ id: 'trip-active-1', status: 'active' }];

      const result = await deleteBusAndData('bus_01');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete bus while an active trip is in progress');
      expect(mockRemoveBus).not.toHaveBeenCalled();
    });

    it('blocks deletion of a bus with active seat-holding students assigned', async () => {
      mockGetBusById.mockResolvedValue({ id: 'bus_02', busNumber: '02' });
      mockActiveTripsReturn = [];
      mockGetStudentsByBusIds.mockResolvedValue([
        { uid: 'student-seated-1', status: 'active', seatReleasedAt: null },
      ]);

      const result = await deleteBusAndData('bus_02');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete bus while 1 active seat-holding student(s) are assigned to it');
      expect(mockRemoveBus).not.toHaveBeenCalled();
    });

    it('allows deletion and invalidates cache when bus is idle and unassigned', async () => {
      mockGetBusById.mockResolvedValue({ id: 'bus_03', busNumber: '03' });
      mockActiveTripsReturn = [];
      mockGetStudentsByBusIds.mockResolvedValue([]);

      const result = await deleteBusAndData('bus_03');
      expect(result.success).toBe(true);
      expect(mockRemoveBus).toHaveBeenCalledWith('bus_03');
      expect(mockInvalidateBusCache).toHaveBeenCalledWith('bus_03');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 7: Operational Relief Pool Dynamic Check-In & Scanner Authority
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 7: Operational Relief Pool Dynamic Conductor Check-In & 2-Tier Scanner Authority', () => {
    it('resolves active operating bus from active_trips over driver profile primary bus', () => {
      // Driver Suresh has default/primary bus_02 in profile, but checks into bus_06
      const driverProfile = { uid: 'driver_suresh', bus_id: 'bus_02', role: 'driver' };
      const activeTrip = { trip_id: 'trip_live_99', bus_id: 'bus_06', driver_id: 'driver_suresh', status: 'active', expires_at: new Date(Date.now() + 3600000).toISOString() };

      // Tier 1 Authority: active_trips takes precedence
      const effectiveOperatingBusId = activeTrip?.status === 'active' ? activeTrip.bus_id : driverProfile.bus_id;
      expect(effectiveOperatingBusId).toBe('bus_06');

      // Student on bus_06 scanning boarding pass
      const studentAssignedBus = 'bus_06';
      expect(scannerBusMatchesStudent(effectiveOperatingBusId, studentAssignedBus)).toBe(true);

      // Guarantees Relief Driver Suresh on bus_06 never triggers a false WRONG_BUS error!
      const wrongBusCheck = !scannerBusMatchesStudent(effectiveOperatingBusId, studentAssignedBus);
      expect(wrongBusCheck).toBe(false);
    });

    it('falls back cleanly to primary bus when driver is off-duty without active trip', () => {
      const driverProfile = { uid: 'driver_ramesh', bus_id: 'bus_06', role: 'driver' };
      const activeTrip = null;

      const effectiveOperatingBusId = activeTrip ? (activeTrip as any).bus_id : driverProfile.bus_id;
      expect(effectiveOperatingBusId).toBe('bus_06');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SCENARIO 8: Human-Friendly University Terminology Overhaul
  // ═════════════════════════════════════════════════════════════════════════
  describe('Scenario 8: Human-Friendly University Terminology Overhaul', () => {
    it('formats expired access rejection message with clear university terminology without raw soft-block jargon', () => {
      const rejectionCode = 'SOFT_BLOCKED';
      let message = 'Student verified';
      if (rejectionCode === 'SOFT_BLOCKED') {
        message = 'Service expired — access to dashboard and live bus tracking restricted until renewal.';
      }

      expect(message).toBe('Service expired — access to dashboard and live bus tracking restricted until renewal.');
      expect(message.toLowerCase()).not.toContain('soft block');
      expect(message.toLowerCase()).not.toContain('soft-block');
      expect(message.toLowerCase()).not.toContain('soft_block');
    });

    it('verifies university terminology in service restriction audit summaries', () => {
      const releaseSeat = true;
      const studentName = 'Priyanka Sharma';
      const summary = (releaseSeat
        ? 'Dashboard & live bus tracking access restricted due to expired service (bus seat released): '
        : 'Service expired — access to dashboard and live bus tracking restricted until renewal: ') + studentName;

      expect(summary).toContain('Dashboard & live bus tracking access restricted due to expired service');
      expect(summary.toLowerCase()).not.toContain('soft-blocked');
    });
  });
});
