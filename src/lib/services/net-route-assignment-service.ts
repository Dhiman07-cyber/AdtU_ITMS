/**
 * @deprecated This module is a re-export shim. Import directly from
 * `@/lib/services/net-route-assignment-types` for new code.
 *
 * The original Firestore implementation (commitNetRouteChanges,
 * writeRouteAssignmentAuditLog, etc.) has been deleted.
 * All types, algorithms, and pure functions now live in net-route-assignment-types.ts.
 */

export type {
	BusSnapshot,ComputeNetRouteAssignmentsResult,DbRouteSnapshot,
	NetRouteChange,RouteConfirmationTableRow,RouteImpact,RouteSnapshot,RouteValidationResult,StagedRouteOperation
} from './net-route-assignment-types';

export {
	computeNetRouteAssignments,formatBusLabel,getRoute,getRouteName,validateRouteStagingPreCheck
} from './net-route-assignment-types';
