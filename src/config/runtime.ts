/**
 * Runtime Configuration for Firestore Safety
 * 
 * This module provides runtime configuration for controlling Firestore realtime listeners.
 * It relies on environment variables for control.
 * 
 * @module config/runtime
 * @version 1.0.0
 * @since 2026-01-02
 * @updated 2026-01-31
 */



// ============================================================================
// CORE CONFIGURATION FLAGS
// ============================================================================

/**
 * Master toggle for Firestore realtime listeners.
 * When false, all realtime listeners MUST fall back to polling/getDocs.
 * 
 * Set via environment variable NEXT_PUBLIC_ENABLE_FIRESTORE_REALTIME=true
 * Default: false (safe mode)
 */
export const ENABLE_FIRESTORE_REALTIME =
    process.env.NEXT_PUBLIC_ENABLE_FIRESTORE_REALTIME === 'true';

/**
 * Maximum documents allowed per query (enforced at code level)
 * Firestore rules also enforce this at the database level
 */
export const MAX_QUERY_LIMIT = 50;

/**
 * Default page size for paginated queries
 */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Polling interval for non-realtime fallback mode (in milliseconds)
 */
export const POLLING_INTERVAL_MS = 86_400_000; // 24 hours (effectively off, rely on manual refresh)

/**
 * Fast polling interval for notifications (in milliseconds)
 */
export const NOTIFICATION_POLLING_INTERVAL_MS = 120_000; // 2 minutes (custom logic for notifications)

/**
 * Debounce time for visibility-based listener reattach (in milliseconds)
 */
export const VISIBILITY_DEBOUNCE_MS = 3_000; // 3 seconds

/**
 * Debounce time for coalescing rapid document updates (in milliseconds)
 */
export const UPDATE_DEBOUNCE_MS = 2_000; // 2 seconds

/**
 * Synchronous check for realtime enabled status.
 * Uses cached value if available, otherwise returns env flag.
 */
export function isRealtimeEnabledSync(): boolean {
    return ENABLE_FIRESTORE_REALTIME;
}

// ============================================================================
// QUOTA SAFETY CONSTANTS
// ============================================================================

/**
 * Spark plan daily read quota
 */
export const SPARK_DAILY_READ_QUOTA = 50_000;

/**
 * Safety margin (target is 40k to leave 10k buffer)
 */
export const SAFETY_MARGIN_READS = 40_000;

/**
 * Estimated reads per admin page refresh (50 docs paginated)
 */
export const READS_PER_ADMIN_REFRESH = 50;

/**
 * Estimated reads per student single-doc listener mount
 */
export const READS_PER_STUDENT_MOUNT = 1;

/**
 * Estimated daily reconnects per client (conservative)
 */
export const ESTIMATED_DAILY_RECONNECTS = 10;

// ============================================================================
// BUSINESS CONSTANTS
// ============================================================================

/**
 * Default bus fee amount (INR) used as fallback when system config is unavailable.
 * The authoritative value is in Firestore `config/system` → busFee.amount.
 */
export const DEFAULT_BUS_FEE = 10_000;

/**
 * Static application name constant.
 */
export const APP_NAME = "AdtU Bus Services";
