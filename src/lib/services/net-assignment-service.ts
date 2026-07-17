/**
 * @deprecated This module is a re-export shim. Import directly from
 * `@/lib/services/net-assignment-types` for new code.
 *
 * The original Firestore implementation (commitNetChanges, preCheckConflicts,
 * writeAssignmentAuditLog, etc.) has been deleted.
 * All types, algorithms, and pure functions now live in net-assignment-types.ts.
 */

export type {
    StagedOperation,
    DriverSnapshot,
    BusSnapshot,
    DbSnapshot,
    NetBusChange,
    DriverFinalState,
    ConfirmationTableRow,
    ComputeNetAssignmentsResult,
    ValidationResult,
} from './net-assignment-types';

export {
    createBusLabel,
    getDriverName,
    getDriverEmployeeId,
    computeNetAssignments,
    validateStagingPreCheck,
} from './net-assignment-types';
