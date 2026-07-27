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
	cleanupStaleFcmTokens,createAdmin,createDriver,createModerator,createStudent,createUnauthUser,createUser,deleteAdmin,deleteDriver,deleteFcmToken,deleteModerator,deleteStudent,deleteUnauthUser,deleteUser,
	// Admin Profiles
	getAdminById,getAllDrivers,
	getAllDriversPaginated,getAllModerators,getAllStudents,getAllUnauthUsers,getAllUsers,getBusOccupancyStats,
	// Driver Profiles
	getDriverById,getDriversByBusId,getDriversByStatus,
	// Moderator Profiles
	getModeratorById,
	// Moderator Permissions
	getModeratorPermissions,getModeratorsByStatus,getSeatOccupyingStudents,
	// Student Profiles
	getStudentById,getStudentsByBusIds,
	getStudentsByRouteIds,getStudentsByShift,getStudentsByStatus,
	getStudentsByStatuses,
	// Unauth Users
	getUnauthUserById,getUserByEmail,
	// Users
	getUserById,getUsersByRole,getValidFcmTokensForUsers,hashFcmToken,requireModeratorPermission,
	// FCM Tokens
	saveFcmToken,updateAdmin,updateDriver,updateModerator,
	updateModeratorPermissions,updateStudent,updateUnauthUser,updateUser
} from './services/identity.service';
export type { ModeratorPermissions,User,UserRole } from './services/identity.service';
