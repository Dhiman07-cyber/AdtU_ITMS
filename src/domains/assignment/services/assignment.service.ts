import {
  assignDriverToBus as repoAssignDriverToBus,
  unassignDriver as repoUnassignDriver,
  getActiveAssignmentByBusId,
  getActiveAssignmentByDriverUid,
  getDriverUidByBusId,
  getBusIdByDriverUid,
  listActiveAssignments,
  getAssignmentHistoryByBusId,
  getAssignmentHistoryByDriverUid,
} from '@/domains/fleet/repositories/driver-assignment.repository';
import type { DriverAssignment } from '@/lib/types';

export async function assignDriverToBus(
  driverUid: string,
  busId: string,
  options?: {
    routeId?: string;
    assignedBy?: string;
    reason?: DriverAssignment['reason'];
    metadata?: Record<string, any>;
  },
): Promise<DriverAssignment | null> {
  return repoAssignDriverToBus(driverUid, busId, options);
}

export async function unassignDriver(driverUid: string, reason?: string): Promise<boolean> {
  return repoUnassignDriver(driverUid, reason);
}

export { getActiveAssignmentByBusId, getActiveAssignmentByDriverUid, getDriverUidByBusId, getBusIdByDriverUid, listActiveAssignments, getAssignmentHistoryByBusId, getAssignmentHistoryByDriverUid };
export type { DriverAssignment };
