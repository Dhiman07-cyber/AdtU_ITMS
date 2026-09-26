import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  requireModeratorPermission,
  requireAdminPermission,
  getModeratorPermissions,
  invalidateModeratorPermissionCache,
} from '../moderator-permissions';
import * as identityModule from '@/domains/identity';

vi.mock('@/domains/identity', () => ({
  getModeratorById: vi.fn(),
}));

describe('Moderator Permission Boundary & Fail-Closed Enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateModeratorPermissionCache('mod-zero-perm');
    invalidateModeratorPermissionCache('mod-custom-perm');
  });

  describe('Role-based access boundaries', () => {
    it('grants full administrative access unconditionally to admin role', async () => {
      const adminAuth = { uid: 'admin-1', role: 'admin' as const, email: 'admin@adtu.edu.in', name: 'Admin 1' };

      const resStudents = await requireModeratorPermission(adminAuth, 'students', 'canAdd');
      expect(resStudents).toBeNull();

      const resRoutes = await requireModeratorPermission(adminAuth, 'routes', 'canDelete');
      expect(resRoutes).toBeNull();

      const resPayments = await requireModeratorPermission(adminAuth, 'payments', 'canApproveOfflinePayment');
      expect(resPayments).toBeNull();

      const resAdmin = await requireAdminPermission(adminAuth);
      expect(resAdmin).toBeNull();
    });

    it('rejects student role from calling moderator endpoints with HTTP 403', async () => {
      const studentAuth = { uid: 'stu-1', role: 'student' as const, email: 'stu@adtu.edu.in', name: 'Student 1' };

      const res = await requireModeratorPermission(studentAuth, 'students', 'canView');
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
      const json = await res?.json();
      expect(json.error).toBe('Insufficient permissions');
    });

    it('rejects driver role from calling moderator endpoints with HTTP 403', async () => {
      const driverAuth = { uid: 'drv-1', role: 'driver' as const, email: 'drv@adtu.edu.in', name: 'Driver 1' };

      const res = await requireModeratorPermission(driverAuth, 'buses', 'canView');
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
      const json = await res?.json();
      expect(json.error).toBe('Insufficient permissions');
    });

    it('rejects moderator from pure admin endpoints with HTTP 403', async () => {
      const modAuth = { uid: 'mod-1', role: 'moderator' as const, email: 'mod@adtu.edu.in', name: 'Mod 1' };

      const res = await requireAdminPermission(modAuth);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(403);
      const json = await res?.json();
      expect(json.error).toBe('Insufficient permissions');
    });
  });

  describe('Zero-Permission Moderator (Default State)', () => {
    it('denies all write, approve, edit, delete, and reassign actions when moderator has default permissions', async () => {
      // Mock moderator profile with no extra permissions granted
      vi.mocked(identityModule.getModeratorById).mockResolvedValue({
        uid: 'mod-zero-perm',
        email: 'mod@adtu.edu.in',
        name: 'Zero Perm Mod',
        permissions: {},
      } as any);

      const modAuth = { uid: 'mod-zero-perm', role: 'moderator' as const, email: 'mod@adtu.edu.in', name: 'Zero Perm Mod' };

      // student operations
      const addStudent = await requireModeratorPermission(modAuth, 'students', 'canAdd');
      expect(addStudent?.status).toBe(403);
      expect((await addStudent?.json()).error).toBe('Moderator permission not granted');

      const editStudent = await requireModeratorPermission(modAuth, 'students', 'canEdit');
      expect(editStudent?.status).toBe(403);

      const deleteStudent = await requireModeratorPermission(modAuth, 'students', 'canDelete');
      expect(deleteStudent?.status).toBe(403);

      // route operations
      const editRoute = await requireModeratorPermission(modAuth, 'routes', 'canEdit');
      expect(editRoute?.status).toBe(403);

      const deleteRoute = await requireModeratorPermission(modAuth, 'routes', 'canDelete');
      expect(deleteRoute?.status).toBe(403);

      // application approvals
      const approveApp = await requireModeratorPermission(modAuth, 'applications', 'canApprove');
      expect(approveApp?.status).toBe(403);

      const rejectApp = await requireModeratorPermission(modAuth, 'applications', 'canReject');
      expect(rejectApp?.status).toBe(403);

      // payment approvals
      const approvePayment = await requireModeratorPermission(modAuth, 'payments', 'canApproveOfflinePayment');
      expect(approvePayment?.status).toBe(403);

      // fleet reassignment
      const reassignDriver = await requireModeratorPermission(modAuth, 'drivers', 'canReassign');
      expect(reassignDriver?.status).toBe(403);

      const reassignBus = await requireModeratorPermission(modAuth, 'buses', 'canReassign');
      expect(reassignBus?.status).toBe(403);
    });

    it('allows read-only views for default moderator (canView: true)', async () => {
      vi.mocked(identityModule.getModeratorById).mockResolvedValue({
        uid: 'mod-zero-perm',
        email: 'mod@adtu.edu.in',
        name: 'Zero Perm Mod',
        permissions: {},
      } as any);

      const modAuth = { uid: 'mod-zero-perm', role: 'moderator' as const, email: 'mod@adtu.edu.in', name: 'Zero Perm Mod' };

      expect(await requireModeratorPermission(modAuth, 'students', 'canView')).toBeNull();
      expect(await requireModeratorPermission(modAuth, 'drivers', 'canView')).toBeNull();
      expect(await requireModeratorPermission(modAuth, 'buses', 'canView')).toBeNull();
      expect(await requireModeratorPermission(modAuth, 'routes', 'canView')).toBeNull();
      expect(await requireModeratorPermission(modAuth, 'applications', 'canView')).toBeNull();
    });
  });

  describe('Explicit Permission Grant & Invalidation', () => {
    it('strictly isolates granted permissions to the configured scope only', async () => {
      // Moderator has ONLY students.canAdd granted
      vi.mocked(identityModule.getModeratorById).mockResolvedValue({
        uid: 'mod-custom-perm',
        email: 'mod@adtu.edu.in',
        name: 'Custom Mod',
        permissions: {
          students: { canAdd: true },
        },
      } as any);

      const modAuth = { uid: 'mod-custom-perm', role: 'moderator' as const, email: 'mod@adtu.edu.in', name: 'Custom Mod' };

      // Granted action succeeds
      const allowedAdd = await requireModeratorPermission(modAuth, 'students', 'canAdd');
      expect(allowedAdd).toBeNull();

      // Non-granted actions on SAME resource fail
      const deniedEdit = await requireModeratorPermission(modAuth, 'students', 'canEdit');
      expect(deniedEdit?.status).toBe(403);

      const deniedDelete = await requireModeratorPermission(modAuth, 'students', 'canDelete');
      expect(deniedDelete?.status).toBe(403);

      // Non-granted actions on OTHER resources fail
      const deniedApprove = await requireModeratorPermission(modAuth, 'applications', 'canApprove');
      expect(deniedApprove?.status).toBe(403);
    });

    it('respects cache invalidation when permissions are dynamically updated', async () => {
      const getModSpy = vi.mocked(identityModule.getModeratorById);
      getModSpy.mockResolvedValueOnce({
        uid: 'mod-custom-perm',
        email: 'mod@adtu.edu.in',
        name: 'Custom Mod',
        permissions: { students: { canAdd: false } },
      } as any);

      const modAuth = { uid: 'mod-custom-perm', role: 'moderator' as const, email: 'mod@adtu.edu.in', name: 'Custom Mod' };

      // First check: denied
      const check1 = await requireModeratorPermission(modAuth, 'students', 'canAdd');
      expect(check1?.status).toBe(403);
      expect(getModSpy).toHaveBeenCalledTimes(1);

      // Second check: cached
      const check2 = await requireModeratorPermission(modAuth, 'students', 'canAdd');
      expect(check2?.status).toBe(403);
      expect(getModSpy).toHaveBeenCalledTimes(1);

      // Invalidate cache and update mock
      invalidateModeratorPermissionCache('mod-custom-perm');
      getModSpy.mockResolvedValueOnce({
        uid: 'mod-custom-perm',
        email: 'mod@adtu.edu.in',
        name: 'Custom Mod',
        permissions: { students: { canAdd: true } },
      } as any);

      // Third check: fresh fetch and granted
      const check3 = await requireModeratorPermission(modAuth, 'students', 'canAdd');
      expect(check3).toBeNull();
      expect(getModSpy).toHaveBeenCalledTimes(2);
    });

    it('immediately denies all permissions when moderator status is suspended or inactive', async () => {
      invalidateModeratorPermissionCache('mod-suspended');
      const getModSpy = vi.mocked(identityModule.getModeratorById);
      getModSpy.mockResolvedValue({
        uid: 'mod-suspended',
        email: 'suspended@adtu.edu.in',
        name: 'Suspended Mod',
        status: 'suspended',
        permissions: { students: { canView: true, canAdd: true } },
      } as any);

      const modAuth = { uid: 'mod-suspended', role: 'moderator' as const, email: 'suspended@adtu.edu.in', name: 'Suspended Mod' };

      // Both view and add must be denied because account status is suspended
      const viewCheck = await requireModeratorPermission(modAuth, 'students', 'canView');
      expect(viewCheck?.status).toBe(403);

      const addCheck = await requireModeratorPermission(modAuth, 'students', 'canAdd');
      expect(addCheck?.status).toBe(403);
    });
  });
});
