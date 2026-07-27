/**
 * @deprecated This module is a re-export shim. Import directly from
 * `@/lib/services/net-assignment-types` for new code.
 *
 * The original Firestore implementation (commitNetChanges, preCheckConflicts,
 * writeAssignmentAuditLog, etc.) has been deleted.
 * All types, algorithms, and pure functions now live in net-assignment-types.ts.
 */

export type {
	BusSnapshot,ComputeNetAssignmentsResult,ConfirmationTableRow,DbSnapshot,DriverFinalState,DriverSnapshot,NetBusChange,StagedOperation,ValidationResult
} from './net-assignment-types';

export {
	computeNetAssignments,createBusLabel,getDriverEmployeeId,getDriverName,validateStagingPreCheck
} from './net-assignment-types';
