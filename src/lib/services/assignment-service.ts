/**
 * @deprecated This module is a re-export shim. Import directly from
 * `@/lib/services/assignment-types` for new code.
 *
 * The original Firestore implementation (validateDriverAssignment,
 * commitDriverAssignment, commitAssignments, etc.) has been deleted.
 * All types and pure functions now live in assignment-types.ts.
 */

export type {
    StagedDriverAssignment,
    StagedRouteAssignment,
} from './assignment-types';

export {
    generateStagingId,
    formatDriverCode,
    getDriverStatus,
} from './assignment-types';
