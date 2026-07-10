/**
 * Shared Firestore collection name constants.
 *
 * Every service and API route that references a Firestore collection
 * MUST import the name from here to prevent silent drift.
 */

// ── User / Entity collections ──────────────────────────────────
export const USERS_COLLECTION = 'users';
export const STUDENTS_COLLECTION = 'students';
export const DRIVERS_COLLECTION = 'drivers';
export const MODERATORS_COLLECTION = 'moderators';
export const ADMINS_COLLECTION = 'admins';
export const BUSES_COLLECTION = 'buses';
export const ROUTES_COLLECTION = 'routes';
export const APPLICATIONS_COLLECTION = 'applications';
export const NOTIFICATIONS_COLLECTION = 'notifications';

// ── Operational collections ─────────────────────────────────────
export const ACTIVITY_LOGS_COLLECTION = 'activity_logs';
export const AUDIT_LOGS_COLLECTION = 'audit_logs';
export const DRIVER_SWAP_REQUESTS_COLLECTION = 'driver_swap_requests';
export const DRIVER_SWAP_AUDIT_COLLECTION = 'driver_swap_audit';

// ── Settings ───────────────────────────────────────────────────
export const SETTINGS_COLLECTION = 'settings';
