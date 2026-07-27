import {
	getActiveAssignmentByBusId,
	getActiveAssignmentByDriverUid,
	getAssignmentHistoryByBusId,
	getAssignmentHistoryByDriverUid,
	getBusIdByDriverUid,
	getDriverUidByBusId,
	listActiveAssignments,
	assignDriverToBus as repoAssignDriverToBus,
	unassignDriver as repoUnassignDriver,
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

export { getActiveAssignmentByBusId,getActiveAssignmentByDriverUid,getAssignmentHistoryByBusId,getAssignmentHistoryByDriverUid,getBusIdByDriverUid,getDriverUidByBusId,listActiveAssignments };
export type { DriverAssignment };
