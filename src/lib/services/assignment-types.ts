/**
 * Assignment Types & Utilities
 *
 * Extracted from assignment-service.ts to decouple type definitions
 * from the legacy Firestore implementation (which is now dead code).
 *
 * All exports here are pure types or pure functions with zero
 * Firestore SDK dependencies.
 */

import { generatePrefixedId } from '@/lib/security/random-id';

// ============================================
// TYPES
// ============================================

export interface StagedDriverAssignment {
    id: string;
    driverId: string;
    driverName: string;
    driverCode: string;
    newBusId: string;
    newBusNumber: string;
    newRouteId?: string;
    newRouteName?: string;
    oldBusId?: string | null;
    oldBusNumber?: string | null;
    previousOperatorId?: string | null;
    previousOperatorName?: string | null;
    previousOperatorCode?: string | null;
    affectOnPreviousOperator?: "reserved" | "swapped" | "none";
    swappedToBusId?: string | null;
    swappedToBusNumber?: string | null;
    driverPreviousState?: "reserved" | "assigned";
    driverPreviousBusId?: string | null;
    driverPreviousBusNumber?: string | null;
    status: "pending" | "error";
    errorMessage?: string;
}

export interface StagedRouteAssignment {
    id: string;
    busId: string;
    busNumber: string;
    busCode: string;
    newRouteId: string;
    newRouteName: string;
    newStopCount: number;
    oldRouteId?: string | null;
    oldRouteName?: string | null;
    status: "pending" | "success" | "error";
    errorMessage?: string;
}

// ============================================
// PURE UTILITY FUNCTIONS
// ============================================

/**
 * Generates a unique staging ID
 */
export function generateStagingId(): string {
    return generatePrefixedId('staged_');
}

/**
 * Formats driver code from ID (e.g., "driver_1" -> "DB-01")
 */
export function formatDriverCode(driverId: string): string {
    const num = driverId.replace(/\D/g, "");
    return `DB-${num.padStart(2, "0")}`;
}

/**
 * Gets driver assignment status label
 */
export function getDriverStatus(driver: any): "Assigned" | "Reserved" | "Unassigned" {
    const hasBus = driver.busId || driver.busId;
    if (hasBus) return "Assigned";
    if (driver.status === "reserved" || driver.isReserved) return "Reserved";
    return "Reserved";
}
