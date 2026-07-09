// D6 Fleet — public surface. Only this file may be imported by other domains.
// Runtime owner: PostgreSQL (Supabase buses + driver_profiles tables).
// Firestore buses/drivers collections are no longer used.
export {
  getAllBuses,
  getBusById,
  getBusesByRouteId,
  unassignRoute,
  updateBus,
  removeBus,
  getAllDrivers,
  getDriverById,
  updateDriver,
  removeDriver,
} from './services/fleet.service';
export type { Bus, Driver } from './services/fleet.service';
