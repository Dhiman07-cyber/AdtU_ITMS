// D1 Identity — canonical public surface.
// Only this file may be imported by other domains.
//
// Naming convention:
//   get*       — single-item or filtered-list lookups
//   create*    — insert new entity
//   update*    — modify existing entity
//   delete*    — remove entity
//   check*     — boolean permission/authorization guard
export {
  // Users
  getUserById,
  getUserByEmail,
  getUsersByRole,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  // Student Profiles
  getStudentById,
  getStudentsByStatus,
  getStudentsByShift,
  getStudentsByBusIds,
  getStudentsByRouteIds,
  getAllStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  // Driver Profiles
  getDriverById,
  getDriversByStatus,
  createDriver,
  updateDriver,
  deleteDriver,
  // Moderator Profiles
  getModeratorById,
  getModeratorsByStatus,
  createModerator,
  updateModerator,
  updateModeratorPermissions,
  deleteModerator,
  // Moderator Permissions
  getModeratorPermissions,
  requireModeratorPermission,
  // Admin Profiles
  getAdminById,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  // Unauth Users
  getUnauthUserById,
  createUnauthUser,
  updateUnauthUser,
  deleteUnauthUser,
} from './services/identity.service';
export type { User, UserRole, ModeratorPermissions } from './services/identity.service';
