/**
 * @deprecated This module is a re-export shim. Import directly from
 * `@/lib/services/net-route-assignment-types` for new code.
 *
 * The original Firestore implementation (commitNetRouteChanges,
 * writeRouteAssignmentAuditLog, etc.) has been deleted.
 * All types, algorithms, and pure functions now live in net-route-assignment-types.ts.
 */

export type {
    StagedRouteOperation,
    BusSnapshot,
    RouteSnapshot,
    DbRouteSnapshot,
    NetRouteChange,
    RouteImpact,
    RouteConfirmationTableRow,
    ComputeNetRouteAssignmentsResult,
    RouteValidationResult,
} from './net-route-assignment-types';

export {
    getRouteName,
    getRoute,
    formatBusLabel,
    computeNetRouteAssignments,
    validateRouteStagingPreCheck,
} from './net-route-assignment-types';
