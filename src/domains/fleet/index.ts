// D6 Fleet — public surface. Only this file may be imported by other domains.
// Runtime owner: PostgreSQL (Supabase buses + driver_profiles tables).
// Firestore buses/drivers collections are no longer used.
export {
  createBus,
  getAllBuses,
  getBusById,
  getBusesByRouteId,
  unassignRoute,
  updateBus,
  removeBus,

  checkBusCapacity,
  incrementBusCapacity,
  decrementBusCapacity,
  onStudentDeleted,
  reassignStudentsAtomically,
} from './services/fleet.service';
export type { Bus, Driver } from './services/fleet.service';
