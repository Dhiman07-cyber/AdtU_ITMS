// D5 Assignment — canonical public surface for driver↔bus ownership.
// Only this file may be imported by other domains.
//
// OWNERSHIP
// ──────────────────────────────────────────────────────────────────────────────
// D5 Assignment owns:
//   - driver_assignments (PostgreSQL) — driver↔bus ownership, active & history
//
// D5 Assignment does NOT own:
//   - bus master data (capacity, status) — owned by Fleet domain (D6)
//   - driver master data (profile, contact) — owned by Identity domain (D1)
//   - trip lifecycle — owned by Trip domain (D9)
//
// Cross-domain reads:
//   - Assignment reads Bus (bus validation) via Fleet domain API
//   - Assignment reads Driver (driver validation) via Identity domain API
export {
  assignDriverToBus,
  unassignDriver,
  getActiveAssignmentByBusId,
  getActiveAssignmentByDriverUid,
  getDriverUidByBusId,
  getBusIdByDriverUid,
  listActiveAssignments,
  getAssignmentHistoryByBusId,
  getAssignmentHistoryByDriverUid,
} from './services/assignment.service';
export type { DriverAssignment } from './services/assignment.service';
