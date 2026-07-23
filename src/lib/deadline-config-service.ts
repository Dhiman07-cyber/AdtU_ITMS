/**
 * deadline-config-service.ts — Compatibility Façade
 *
 * This file is a ZERO-LOGIC compatibility layer.
 * It exists only to preserve the existing import path used by 20+ callers
 * across API routes, shared services, and other domains.
 *
 * ─── CALL CHAIN ──────────────────────────────────────────────────────────────
 *
 *   Legacy caller (any file importing this module)
 *       ↓
 *   deadline-config-service  (this file — façade only)
 *       ↓
 *   CalendarService          (D2 domain business layer)
 *       ↓
 *   CalendarRepository       (D2 domain persistence layer)
 *       ↓
 *   Firestore                (settings/deadline document)
 *
 * ─── WHAT WAS REMOVED ────────────────────────────────────────────────────────
 *   • adminDb import and all Firestore reads/writes
 *   • SETTINGS_COLLECTION / DOC_ID constants
 *   • MONTH_NAMES / getOrdinal helpers (live in calendar.repository.pg.ts)
 *   • deriveAcademicLifecycle call (delegated to repository layer)
 *   • All inline DeadlineConfig construction logic
 *
 * ─── WHAT MUST NOT CHANGE ─────────────────────────────────────────────────────
 *   The exported function signatures are frozen.
 *   No caller may be required to change its import.
 */
import type { DeadlineConfig } from './types/deadline-config';
import { getActiveConfig, updateConfig } from '@/domains/calendar';

/**
 * Returns the fully-populated DeadlineConfig from PostgreSQL.
 * All lifecycle dates are derived in-memory inside the Calendar domain.
 *
 * @deprecated Prefer importing from `@/domains/calendar` directly
 *   when refactoring a caller. This façade will be removed once all
 *   callers have been migrated to the domain import.
 */
export async function getDeadlineConfig(): Promise<DeadlineConfig> {
    return getActiveConfig();
}

/**
 * Persists an updated DeadlineConfig to PostgreSQL via the Calendar domain.
 *
 * @deprecated Prefer importing from `@/domains/calendar` directly
 *   when refactoring a caller.
 */
export async function updateDeadlineConfig(config: DeadlineConfig, uid?: string): Promise<void> {
    return updateConfig(config, uid);
}

