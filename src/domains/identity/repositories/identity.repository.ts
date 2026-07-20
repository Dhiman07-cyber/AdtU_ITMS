/**
 * D1 Identity Repository — abstraction boundary.
 *
 * Architecture:
 *   Service → Repository (this file) → Repository.pg → PostgreSQL
 *
 * This layer exists so the service never knows whether storage is
 * PostgreSQL, Firestore, MongoDB, or Redis.
 *
 * All persistence functions delegate to identity.repository.pg.
 * Naming convention: pg* prefixes are stripped for clean domain names.
 */
import {
  pgFindUserById,
  pgFindUserByEmail,
  pgFindUsersByRole,
  pgFindAllUsers,
  pgInsertUser,
  pgUpdateUser,
  pgRemoveUser,
  pgFindStudentById,
  pgFindStudentsByStatus,
  pgFindStudentsByStatuses,
  pgFindSeatOccupyingStudents,
  pgGetBusOccupancyStats,
  pgFindStudentsByShift,
  pgFindStudentsByBusId,
  pgFindStudentsByBusIds,
  pgFindStudentsByRouteId,
  pgFindStudentsByRouteIds,
  pgInsertStudent,
  pgUpdateStudent,
  pgRemoveStudent,
  pgFindAllStudents,
  pgFindDriverById,
  pgFindDriversByStatus,
  pgFindAllDrivers,
  pgFindAllDriversPaginated,
  pgInsertDriver,
  pgUpdateDriver,
  pgRemoveDriver,
  pgFindDriversByBusId,
  pgFindModeratorById,
  pgFindModeratorsByStatus,
  pgInsertModerator,
  pgUpdateModerator,
  pgUpdateModeratorPermissions,
  pgRemoveModerator,
  pgFindAdminById,
  pgInsertAdmin,
  pgUpdateAdmin,
  pgRemoveAdmin,
  pgFindUnauthUserById,
  pgInsertUnauthUser,
  pgUpdateUnauthUser,
  pgRemoveUnauthUser,
  pgFindAllUnauthUsers,
  type IdentityUser,
} from './identity.repository.pg';
import type { UserRole } from '@/lib/user-service';

// ─── Types ───────────────────────────────────────────────────────────────────

export type User = IdentityUser;
export type { UserRole };

// ─── Users ──────────────────────────────────────────────────────────────────

export async function findUserById(uid: string): Promise<User | null> {
  return pgFindUserById(uid);
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return pgFindUserByEmail(email);
}

export async function findUsersByRole(role: UserRole): Promise<User[]> {
  return pgFindUsersByRole(role);
}

export async function findAllUsers(): Promise<User[]> {
  return pgFindAllUsers();
}

export async function insertUser(user: IdentityUser): Promise<void> {
  return pgInsertUser(user);
}

export async function updateUser(uid: string, data: Partial<User>): Promise<void> {
  return pgUpdateUser(uid, data);
}

export async function removeUser(uid: string): Promise<void> {
  return pgRemoveUser(uid);
}

// ─── Student Profiles ───────────────────────────────────────────────────────

export async function findStudentById(uid: string): Promise<Record<string, any> | null> {
  return pgFindStudentById(uid);
}

export async function findStudentsByStatus(status: string): Promise<Record<string, any>[]> {
  return pgFindStudentsByStatus(status);
}

export async function findStudentsByStatuses(statuses: string[]): Promise<Record<string, any>[]> {
  return pgFindStudentsByStatuses(statuses);
}

export async function findSeatOccupyingStudents(): Promise<Record<string, any>[]> {
  return pgFindSeatOccupyingStudents();
}

export async function getBusOccupancyStats(): Promise<{
  occupancy: Record<string, { total: number; morning: number; evening: number }>;
  stops: Record<string, Record<string, number>>;
}> {
  return pgGetBusOccupancyStats();
}

export async function findStudentsByShift(shift: string): Promise<Record<string, any>[]> {
  return pgFindStudentsByShift(shift);
}

export async function findStudentsByBusIds(busIds: string[]): Promise<Record<string, any>[]> {
  return pgFindStudentsByBusIds(busIds);
}

export async function findStudentsByRouteIds(routeIds: string[]): Promise<Record<string, any>[]> {
  return pgFindStudentsByRouteIds(routeIds);
}

export async function findAllStudents(): Promise<Record<string, any>[]> {
  return pgFindAllStudents();
}

export async function insertStudent(student: Record<string, any>): Promise<void> {
  return pgInsertStudent(student);
}

export async function updateStudent(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateStudent(uid, data);
}

export async function removeStudent(uid: string): Promise<void> {
  return pgRemoveStudent(uid);
}

// ─── Driver Profiles ────────────────────────────────────────────────────────

export async function findDriverById(uid: string): Promise<Record<string, any> | null> {
  return pgFindDriverById(uid);
}

export async function findDriversByStatus(status: string): Promise<Record<string, any>[]> {
  return pgFindDriversByStatus(status);
}

export async function findAllDrivers(): Promise<Record<string, any>[]> {
  return pgFindAllDrivers();
}

export async function findAllDriversPaginated(limit: number, offset: number): Promise<Record<string, any>[]> {
  return pgFindAllDriversPaginated(limit, offset);
}

export async function insertDriver(driver: Record<string, any>): Promise<void> {
  return pgInsertDriver(driver);
}

export async function updateDriver(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateDriver(uid, data);
}

export async function removeDriver(uid: string): Promise<void> {
  return pgRemoveDriver(uid);
}

export async function findDriversByBusId(busId: string): Promise<Record<string, any>[]> {
  return pgFindDriversByBusId(busId);
}

// ─── Moderator Profiles ─────────────────────────────────────────────────────

export async function findModeratorById(uid: string): Promise<Record<string, any> | null> {
  return pgFindModeratorById(uid);
}

export async function findModeratorsByStatus(status: string): Promise<Record<string, any>[]> {
  return pgFindModeratorsByStatus(status);
}

export async function insertModerator(moderator: Record<string, any>): Promise<void> {
  return pgInsertModerator(moderator);
}

export async function updateModerator(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateModerator(uid, data);
}

export async function updateModeratorPermissions(
  uid: string,
  permissions: Record<string, any>,
  updatedBy: string
): Promise<void> {
  return pgUpdateModeratorPermissions(uid, permissions, updatedBy);
}

export async function removeModerator(uid: string): Promise<void> {
  return pgRemoveModerator(uid);
}

// ─── Admin Profiles ─────────────────────────────────────────────────────────

export async function findAdminById(uid: string): Promise<Record<string, any> | null> {
  return pgFindAdminById(uid);
}

export async function insertAdmin(admin: Record<string, any>): Promise<void> {
  return pgInsertAdmin(admin);
}

export async function updateAdmin(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateAdmin(uid, data);
}

export async function removeAdmin(uid: string): Promise<void> {
  return pgRemoveAdmin(uid);
}

// ─── Unauth Users ───────────────────────────────────────────────────────────

export async function findUnauthUserById(uid: string): Promise<Record<string, any> | null> {
  return pgFindUnauthUserById(uid);
}

export async function insertUnauthUser(user: Record<string, any>): Promise<void> {
  return pgInsertUnauthUser(user);
}

export async function updateUnauthUser(uid: string, data: Record<string, any>): Promise<void> {
  return pgUpdateUnauthUser(uid, data);
}

export async function removeUnauthUser(uid: string): Promise<void> {
  return pgRemoveUnauthUser(uid);
}

export async function findAllUnauthUsers(): Promise<Record<string, any>[]> {
  return pgFindAllUnauthUsers();
}
