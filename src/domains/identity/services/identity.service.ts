/**
 * D1 IdentityService — canonical public API.
 *
 * Naming convention:
 *   get*       — single-item or filtered-list lookups
 *   create*    — insert new entity
 *   update*    — modify existing entity
 *   delete*    — remove entity
 *   check*     — boolean permission/authorization guard
 *
 * All persistence delegated to identity.repository.
 * Permission checks delegated to lib/security/moderator-permissions.
 */
import { getModeratorPermissions as getModPerms,requireModeratorPermission } from '@/lib/security/moderator-permissions';
import type { ModeratorPermissions } from '@/lib/types/moderator-permissions';
import type { UserRole } from '@/lib/user-service';
import {
	findAdminById as repoFindAdminById,
	findAllDrivers as repoFindAllDrivers,
	findAllDriversPaginated as repoFindAllDriversPaginated,
	findAllModerators as repoFindAllModerators,
	findAllStudents as repoFindAllStudents,
	findAllUnauthUsers as repoFindAllUnauthUsers,
	findAllUsers as repoFindAllUsers,
	findDriverById as repoFindDriverById,
	findDriversByBusId as repoFindDriversByBusId,
	findDriversByStatus as repoFindDriversByStatus,
	findModeratorById as repoFindModeratorById,
	findModeratorsByStatus as repoFindModeratorsByStatus,
	findSeatOccupyingStudents as repoFindSeatOccupyingStudents,
	findStudentById as repoFindStudentById,
	findStudentsByBusIds as repoFindStudentsByBusIds,
	findStudentsByRouteIds as repoFindStudentsByRouteIds,
	findStudentsByShift as repoFindStudentsByShift,
	findStudentsByStatus as repoFindStudentsByStatus,
	findStudentsByStatuses as repoFindStudentsByStatuses,
	findUnauthUserById as repoFindUnauthUserById,
	findUserByEmail as repoFindUserByEmail,
	findUserById as repoFindUserById,
	findUsersByRole as repoFindUsersByRole,
	getBusOccupancyStats as repoGetBusOccupancyStats,
	insertAdmin as repoInsertAdmin,
	insertDriver as repoInsertDriver,
	insertModerator as repoInsertModerator,
	insertStudent as repoInsertStudent,
	insertUnauthUser as repoInsertUnauthUser,
	insertUser as repoInsertUser,
	removeAdmin as repoRemoveAdmin,
	removeDriver as repoRemoveDriver,
	removeModerator as repoRemoveModerator,
	removeStudent as repoRemoveStudent,
	removeUnauthUser as repoRemoveUnauthUser,
	removeUser as repoRemoveUser,
	updateAdmin as repoUpdateAdmin,
	updateDriver as repoUpdateDriver,
	updateModerator as repoUpdateModerator,
	updateModeratorPermissions as repoUpdateModeratorPermissions,
	updateStudent as repoUpdateStudent,
	updateUnauthUser as repoUpdateUnauthUser,
	updateUser as repoUpdateUser,
	type User,
} from '../repositories/identity.repository';

// ─── Users ──────────────────────────────────────────────────────────────────

export async function getUserById(uid: string): Promise<User | null> {
  return repoFindUserById(uid);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  return repoFindUserByEmail(email);
}

export async function getUsersByRole(role: UserRole): Promise<User[]> {
  return repoFindUsersByRole(role);
}

export async function getAllUsers(): Promise<User[]> {
  return repoFindAllUsers();
}

export async function createUser(user: Record<string, any>): Promise<void> {
  return repoInsertUser(user as User);
}

export async function updateUser(uid: string, data: Partial<User>) {
  return repoUpdateUser(uid, data);
}

export async function deleteUser(uid: string) {
  return repoRemoveUser(uid);
}

// ─── Student Profiles ───────────────────────────────────────────────────────

export async function getStudentById(uid: string): Promise<Record<string, any> | null> {
  return repoFindStudentById(uid);
}

export async function getStudentsByStatus(status: string): Promise<Record<string, any>[]> {
  return repoFindStudentsByStatus(status);
}

export async function getStudentsByStatuses(statuses: string[]): Promise<Record<string, any>[]> {
  return repoFindStudentsByStatuses(statuses);
}

export async function getSeatOccupyingStudents(): Promise<Record<string, any>[]> {
  return repoFindSeatOccupyingStudents();
}

export async function getBusOccupancyStats(): Promise<{
  occupancy: Record<string, { total: number; morning: number; evening: number }>;
  stops: Record<string, Record<string, number>>;
}> {
  return repoGetBusOccupancyStats();
}

export async function getStudentsByShift(shift: string): Promise<Record<string, any>[]> {
  return repoFindStudentsByShift(shift);
}

export async function getStudentsByBusIds(busIds: string[]): Promise<Record<string, any>[]> {
  return repoFindStudentsByBusIds(busIds);
}

export async function getStudentsByRouteIds(routeIds: string[]): Promise<Record<string, any>[]> {
  return repoFindStudentsByRouteIds(routeIds);
}

export async function getAllStudents(): Promise<Record<string, any>[]> {
  return repoFindAllStudents();
}

export async function createStudent(student: Record<string, any>): Promise<void> {
  return repoInsertStudent(student);
}

export async function updateStudent(uid: string, data: Record<string, any>): Promise<void> {
  return repoUpdateStudent(uid, data);
}

export async function deleteStudent(uid: string): Promise<void> {
  return repoRemoveStudent(uid);
}

// ─── Driver Profiles ────────────────────────────────────────────────────────

export async function getDriverById(uid: string): Promise<Record<string, any> | null> {
  const driver = await repoFindDriverById(uid);
  if (driver) return driver;

  // Fallback: If profile row is missing in driver_profiles, check users table
  try {
    const user = await repoFindUserById(uid);
    if (user && user.role === 'driver') {
      const fallbackDriver = {
        uid: user.uid,
        email: user.email || '',
        fullName: user.name || 'Driver',
        shift: 'Both',
        status: 'active',
      };
      // Auto-insert into driver_profiles so it exists permanently
      await repoInsertDriver(fallbackDriver).catch(() => {});
      return fallbackDriver;
    }
  } catch (err) {
    console.error('[getDriverById] Fallback resolution failed:', err);
  }

  return null;
}

export async function getDriversByStatus(status: string): Promise<Record<string, any>[]> {
  return repoFindDriversByStatus(status);
}

export async function getAllDrivers(): Promise<Record<string, any>[]> {
  return repoFindAllDrivers();
}

export async function getAllDriversPaginated(limit: number, offset: number): Promise<Record<string, any>[]> {
  return repoFindAllDriversPaginated(limit, offset);
}

export async function createDriver(driver: Record<string, any>): Promise<void> {
  return repoInsertDriver(driver);
}

export async function updateDriver(uid: string, data: Record<string, any>): Promise<void> {
  return repoUpdateDriver(uid, data);
}

export async function deleteDriver(uid: string): Promise<void> {
  return repoRemoveDriver(uid);
}

export async function getDriversByBusId(busId: string): Promise<Record<string, any>[]> {
  return repoFindDriversByBusId(busId);
}

// ─── Moderator Profiles ─────────────────────────────────────────────────────

export async function getModeratorById(uid: string): Promise<Record<string, any> | null> {
  return repoFindModeratorById(uid);
}

export async function getModeratorsByStatus(status: string): Promise<Record<string, any>[]> {
  return repoFindModeratorsByStatus(status);
}

export async function getAllModerators(): Promise<Record<string, any>[]> {
  return repoFindAllModerators();
}

export async function createModerator(moderator: Record<string, any>): Promise<void> {
  return repoInsertModerator(moderator);
}

export async function updateModerator(uid: string, data: Record<string, any>): Promise<void> {
  return repoUpdateModerator(uid, data);
}

export async function updateModeratorPermissions(
  uid: string,
  permissions: ModeratorPermissions,
  updatedBy: string
): Promise<void> {
  return repoUpdateModeratorPermissions(uid, permissions as Record<string, any>, updatedBy);
}

export async function deleteModerator(uid: string): Promise<void> {
  return repoRemoveModerator(uid);
}

// ─── Moderator Permissions ──────────────────────────────────────────────────

export async function getModeratorPermissions(uid: string): Promise<ModeratorPermissions> {
  return getModPerms(uid);
}

// ─── Admin Profiles ─────────────────────────────────────────────────────────

export async function getAdminById(uid: string): Promise<Record<string, any> | null> {
  return repoFindAdminById(uid);
}

export async function createAdmin(admin: Record<string, any>): Promise<void> {
  return repoInsertAdmin(admin);
}

export async function updateAdmin(uid: string, data: Record<string, any>): Promise<void> {
  return repoUpdateAdmin(uid, data);
}

export async function deleteAdmin(uid: string): Promise<void> {
  return repoRemoveAdmin(uid);
}

// ─── Unauth Users ───────────────────────────────────────────────────────────

export async function getUnauthUserById(uid: string): Promise<Record<string, any> | null> {
  return repoFindUnauthUserById(uid);
}

export async function createUnauthUser(user: Record<string, any>): Promise<void> {
  return repoInsertUnauthUser(user);
}

export async function updateUnauthUser(uid: string, data: Record<string, any>): Promise<void> {
  return repoUpdateUnauthUser(uid, data);
}

export async function deleteUnauthUser(uid: string): Promise<void> {
  return repoRemoveUnauthUser(uid);
}

export async function getAllUnauthUsers(): Promise<Record<string, any>[]> {
  return repoFindAllUnauthUsers();
}

// ─── FCM Tokens ──────────────────────────────────────────────────────────────

import {
	cleanupStaleTokens as repoCleanupStaleTokens,
	deleteToken as repoDeleteToken,
	getValidTokensForUsers as repoGetValidTokensForUsers,
	hashToken as repoHashToken,
	upsertToken as repoUpsertToken,
} from '../repositories/fcm-token.repository.pg';

export async function saveFcmToken(
  userId: string,
  token: string,
  platform: string = 'web'
): Promise<{ success: boolean; error?: string }> {
  return repoUpsertToken(userId, token, platform);
}

export async function deleteFcmToken(userId: string, tokenHash: string): Promise<void> {
  return repoDeleteToken(userId, tokenHash);
}

export async function getValidFcmTokensForUsers(userIds: string[]) {
  return repoGetValidTokensForUsers(userIds);
}

export async function cleanupStaleFcmTokens(maxAgeDays: number = 30) {
  return repoCleanupStaleTokens(maxAgeDays);
}

export function hashFcmToken(token: string): string {
  return repoHashToken(token);
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export { requireModeratorPermission };
export type { ModeratorPermissions,User,UserRole };
