/**
 * Net Assignment Service
 * Implements the computeNetAssignments algorithm as specified in the Smart Driver Assignment spec.
 * This service computes the minimal set of bus-driver updates required, eliminating redundant/no-op operations.
 * 
 * Integrates with Supabase reassignment_logs for:
 * - Full audit trail with before/after snapshots
 * - Rollback support
 * - Per-type filtering (driver/student/route)
 */

import { db } from "@/lib/firebase";
import {
    doc,
    runTransaction,
    serverTimestamp,
} from "firebase/firestore";
import type { ChangeRecord } from './reassignment-logs-supabase';
import { generatePrefixedId } from '@/lib/security/random-id';

// ============================================
// HELPER: Write to Supabase via API route
// ============================================

import { writeToSupabaseViaAPI } from './reassignment-log-writer';

// ============================================
// TYPES
// ============================================

export interface StagedOperation {
    id: string;
    type: "assign" | "swap" | "markReserved";
    driverId: string;
    driverName: string;
    driverCode: string;
    busId?: string | null;
    busNumber?: string | null;
    oldBusNumber?: string | null;
    // For swaps, the other driver
    swapDriverId?: string | null;
    swapDriverName?: string | null;
    // Original staging timestamp
    stagedAt: number;
}

export interface DriverSnapshot {
    id: string;
    name: string;
    employeeId: string;
    busId: string | null;
    isReserved: boolean;
}

export interface BusSnapshot {
    id: string;
    busNumber: string;
    registrationNumber: string;
    assignedDriverId: string | null;
    activeDriverId: string | null;
    routeId?: string | null;
}

export interface DbSnapshot {
    drivers: DriverSnapshot[];
    buses: BusSnapshot[];
}

export interface NetBusChange {
    busId: string;
    busLabel: string; // e.g., "Bus-1 (AS-01-PC-9094)"
    prevAssignedDriverId: string | null;
    prevAssignedDriverName: string | null;
    newAssignedDriverId: string | null;
    newAssignedDriverName: string | null;
}

export interface DriverFinalState {
    driverId: string;
    driverName: string;
    driverCode: string;
    initialBusId: string | null;
    initialBusLabel: string | null;
    finalBusId: string | null;
    finalBusLabel: string | null;
    initialRouteId?: string | null;
    finalRouteId?: string | null;
    isReserved: boolean;
}

export interface ConfirmationTableRow {
    slNo: number;
    busAffected: string; // "Bus-X (AS-01-PC-XXXX)"
    initially: string; // "Operated by <Name> (DB-XX)" or "No operator (Vacant)"
    initialDriverImpact: string; // Transition for initial operator: "Bus → Dest"
    finally: string; // "Operated by <Name> (DB-XX)" or "No operator (Vacant)"
    finalDriverImpact: string; // Transition for final operator: "Origin → Bus"
    status: "pending" | "error";
    infoTooltip: string; // Refined professional summary
}

export interface ComputeNetAssignmentsResult {
    netChanges: Map<string, NetBusChange>;
    driverFinalState: Map<string, DriverFinalState>;
    confirmationRows: ConfirmationTableRow[];
    hasChanges: boolean;
    removedNoOpCount: number;
    removedNoOpInfo: string[];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Creates a bus label in format "Bus-X (REGISTRATION)"
 */
export function createBusLabel(busId: string | null, busNumber: string | null | undefined, buses: BusSnapshot[]): string {
    if (!busId) return "Reserved";

    const bus = buses.find(b => b.id === busId);
    if (!bus) return busId;

    // Extract bus number from busId (e.g., "bus_1" -> "1")
    const busNum = busId.replace(/[^0-9]/g, '') || '?';
    return `Bus-${busNum} (${bus.busNumber || bus.registrationNumber || 'N/A'})`;
}

/**
 * Gets driver name by ID from snapshot
 */
export function getDriverName(driverId: string | null, drivers: DriverSnapshot[]): string {
    if (!driverId) return "None";
    const driver = drivers.find(d => d.id === driverId);
    return driver?.name || "Unknown";
}

/**
 * Gets driver employeeId for sorting
 */
export function getDriverEmployeeId(driverId: string | null, drivers: DriverSnapshot[]): string {
    if (!driverId) return "ZZZ999"; // Sort last
    const driver = drivers.find(d => d.id === driverId);
    return driver?.employeeId || "ZZZ999";
}

// ============================================
// CORE ALGORITHM: computeNetAssignments
// ============================================

/**
 * Computes the net assignments from staged operations.
 * Eliminates no-ops and double-swaps, returning only the minimal set of changes needed.
 * 
 * @param stagedOperations - Array of staged operations in chronological order
 * @param dbSnapshot - Current state snapshot from Firestore
 * @returns ComputeNetAssignmentsResult with netChanges, driverFinalState, and confirmationRows
 */
export function computeNetAssignments(
    stagedOperations: StagedOperation[],
    dbSnapshot: DbSnapshot
): ComputeNetAssignmentsResult {
    const { drivers, buses } = dbSnapshot;
    const removedNoOpInfo: string[] = [];

    // Build initial mappings from database snapshot
    const initialDriverBus = new Map<string, string | null>(); // driverId -> busId | null
    const initialBusOwner = new Map<string, string | null>();  // busId -> driverId | null

    for (const bus of buses) {
        initialBusOwner.set(bus.id, bus.assignedDriverId || bus.activeDriverId || null);
    }

    for (const driver of drivers) {
        initialDriverBus.set(driver.id, driver.busId || (driver as any).assignedBusId || null);
    }

    // Working copies for applying staged operations
    const workingDriverBus = new Map(initialDriverBus);
    const workingBusOwner = new Map(initialBusOwner);
    const workingDriverReserved = new Map<string, boolean>();

    // Initialize reserved status
    for (const driver of drivers) {
        workingDriverReserved.set(driver.id, driver.isReserved || !driver.busId);
    }

    // Apply staged operations in order
    for (const op of stagedOperations) {
        if (op.type === "assign" && op.busId) {
            const { driverId, busId } = op;

            // Free driver's previous bus
            const prevBus = workingDriverBus.get(driverId);
            if (prevBus) {
                workingBusOwner.set(prevBus, null);
            }

            // If bus had an owner, detach them (they become reserved)
            const prevOwner = workingBusOwner.get(busId);
            if (prevOwner && prevOwner !== driverId) {
                workingDriverBus.set(prevOwner, null);
                workingDriverReserved.set(prevOwner, true);
            }

            // Assign driver to bus
            workingDriverBus.set(driverId, busId);
            workingBusOwner.set(busId, driverId);
            workingDriverReserved.set(driverId, false);
        }
        else if (op.type === "swap" && op.swapDriverId) {
            const { driverId: driverA, swapDriverId: driverB } = op;

            const busA = workingDriverBus.get(driverA);
            const busB = workingDriverBus.get(driverB);

            // Swap bus assignments
            workingDriverBus.set(driverA, busB || null);
            workingDriverBus.set(driverB, busA || null);

            // Update bus owners
            if (busA) workingBusOwner.set(busA, driverB);
            if (busB) workingBusOwner.set(busB, driverA);

            // Update reserved status
            workingDriverReserved.set(driverA, !busB);
            workingDriverReserved.set(driverB, !busA);
        }
        else if (op.type === "markReserved") {
            const { driverId } = op;

            // Free driver's bus
            const prevBus = workingDriverBus.get(driverId);
            if (prevBus) {
                workingBusOwner.set(prevBus, null);
            }

            workingDriverBus.set(driverId, null);
            workingDriverReserved.set(driverId, true);
        }
    }

    // Compute net changes by comparing working vs initial state
    const netChanges = new Map<string, NetBusChange>();

    // Check all buses for changes
    for (const bus of buses) {
        const initialOwner = initialBusOwner.get(bus.id) || null;
        const workingOwner = workingBusOwner.get(bus.id) || null;

        if (initialOwner !== workingOwner) {
            netChanges.set(bus.id, {
                busId: bus.id,
                busLabel: createBusLabel(bus.id, bus.busNumber, buses),
                prevAssignedDriverId: initialOwner,
                prevAssignedDriverName: getDriverName(initialOwner, drivers),
                newAssignedDriverId: workingOwner,
                newAssignedDriverName: getDriverName(workingOwner, drivers),
            });
        }
    }

    // Compute driver final states
    const driverFinalState = new Map<string, DriverFinalState>();

    for (const driver of drivers) {
        const initialBus = initialDriverBus.get(driver.id);
        const finalBus = workingDriverBus.get(driver.id);

        // Only track drivers that changed
        if (initialBus !== finalBus) {
            // Lookup route IDs
            const initialBusObj = initialBus ? buses.find(b => b.id === initialBus) : null;
            const finalBusObj = finalBus ? buses.find(b => b.id === finalBus) : null;

            driverFinalState.set(driver.id, {
                driverId: driver.id,
                driverName: driver.name,
                driverCode: formatDriverCode(driver.employeeId),
                initialBusId: initialBus || null,
                initialBusLabel: createBusLabel(initialBus || null, null, buses),
                finalBusId: finalBus || null,
                finalBusLabel: createBusLabel(finalBus || null, null, buses),
                initialRouteId: initialBusObj?.routeId || null,
                finalRouteId: finalBusObj?.routeId || null,
                isReserved: workingDriverReserved.get(driver.id) || false,
            });
        }
    }

    // Eliminate trivial cycles / double-swaps
    // For each driver, if final state equals initial state, it's a no-op
    const driversToRemove: string[] = [];

    Array.from(driverFinalState.entries()).forEach(([driverId, state]) => {
        if (state.initialBusId === state.finalBusId) {
            const driverName = getDriverName(driverId, drivers);
            removedNoOpInfo.push(`Driver ${driverName}: no net change (returned to original assignment)`);
            driversToRemove.push(driverId);
        }
    });

    // Remove no-op drivers
    for (const driverId of driversToRemove) {
        driverFinalState.delete(driverId);
    }

    // Remove bus changes that now have unchanged owners
    const busesToRemove: string[] = [];
    Array.from(netChanges.entries()).forEach(([busId, change]) => {
        // Check if both prev and new drivers are now unchanged
        const prevDriverUnchanged = change.prevAssignedDriverId ?
            driversToRemove.includes(change.prevAssignedDriverId) : false;
        const newDriverUnchanged = change.newAssignedDriverId ?
            driversToRemove.includes(change.newAssignedDriverId) : false;

        // If the bus change only involves unchanged drivers, remove it
        if (prevDriverUnchanged && newDriverUnchanged) {
            busesToRemove.push(busId);
        }
    });

    for (const busId of busesToRemove) {
        netChanges.delete(busId);
    }

    // Generate confirmation table rows sorted by final driver employeeId
    const confirmationRows: ConfirmationTableRow[] = [];
    let slNo = 1;

    // Convert netChanges to array and sort by final driver employeeId
    const sortedChanges = Array.from(netChanges.values()).sort((a, b) => {
        const empIdA = getDriverEmployeeId(a.newAssignedDriverId, drivers);
        const empIdB = getDriverEmployeeId(b.newAssignedDriverId, drivers);
        return empIdA.localeCompare(empIdB, undefined, { numeric: true });
    });

    for (const change of sortedChanges) {
        // Get initial and final driver states
        const prevDriverState = change.prevAssignedDriverId ?
            driverFinalState.get(change.prevAssignedDriverId) : null;
        const newDriverState = change.newAssignedDriverId ?
            driverFinalState.get(change.newAssignedDriverId) : null;

        // Build Driver Impact using exact phrasing templates
        // Templates:
        // - Detach to reserved: "Captain America (DB-01): Bus-6 (AS-01-SC-1392) → Reserved Pool"
        // - Assign from reserved: "Thor (DB-02): Reserved Pool → Bus-4 (AS-01-PC-9095)"
        // - Swap: "Rajesh Das (DB-01) ↔ Suresh Gupta (DB-02): Bus-1 ↔ Bus-2"
        // - Assign new driver: "Anil Nath (DB-09): Bus-3 (AS-01-LC-5321) → Bus-6 (AS-01-SC-1392)"

        let initialDriverImpact = "Bus vacant";
        let finalDriverImpact = "Bus vacant";

        const prevName = change.prevAssignedDriverName;
        const prevCode = prevDriverState?.driverCode || formatDriverCode(null);
        const newName = change.newAssignedDriverName;
        const newCode = newDriverState?.driverCode || formatDriverCode(null);

        // Calculate Initial Driver Impact (where the previous driver went)
        if (prevName && prevName !== "None") {
            const prevDestination = prevDriverState?.finalBusLabel || "Reserved Pool";
            initialDriverImpact = `${change.busLabel} → ${prevDestination}`;
        }

        // Calculate Final Driver Impact (where the new driver came from)
        if (newName && newName !== "None") {
            const newOrigin = newDriverState?.initialBusLabel || "Reserved Pool";
            finalDriverImpact = `${newOrigin} → ${change.busLabel}`;
        }

        // Build refined tooltip info (JSON-like before/after snapshot)
        // Build refined professional tooltip info
        let infoTooltip = "";
        if (prevName && prevName !== "None") {
            infoTooltip = `Currently, ${change.busLabel} is operated by ${prevName} (${prevCode}). `;
            if (prevDriverState?.isReserved) {
                infoTooltip += `In the staged update, ${prevName} will be moved to the Reserved Pool. `;
            } else if (prevDriverState?.finalBusId) {
                infoTooltip += `In the staged update, ${prevName} will be reassigned to ${prevDriverState.finalBusLabel}. `;
            }
        } else {
            infoTooltip = `${change.busLabel} is currently vacant. `;
        }

        if (newName && newName !== "None") {
            infoTooltip += `Finally, ${newName} (${newCode}) will be assigned to operate ${change.busLabel}.`;
        } else {
            infoTooltip += `Finally, ${change.busLabel} will become vacant.`;
        }

        // Build Initially and Finally strings with exact format
        const initiallyStr = prevName && prevName !== "None"
            ? `Operated by ${prevName} (${prevCode})`
            : "No operator (Vacant)";

        const finallyStr = newName && newName !== "None"
            ? `Operated by ${newName} (${newCode})`
            : "No operator (Vacant)";

        confirmationRows.push({
            slNo: slNo++,
            busAffected: change.busLabel,
            initially: initiallyStr,
            initialDriverImpact,
            finally: finallyStr,
            finalDriverImpact,
            status: "pending",
            infoTooltip,
        });
    }

    return {
        netChanges,
        driverFinalState,
        confirmationRows,
        hasChanges: netChanges.size > 0,
        removedNoOpCount: removedNoOpInfo.length,
        removedNoOpInfo,
    };
}

/**
 * Helper to find a driver's previous bus label
 */
function findDriverPreviousBus(
    driverId: string,
    initialDriverBus: Map<string, string | null>,
    buses: BusSnapshot[]
): string {
    const busId = initialDriverBus.get(driverId);
    if (!busId) return "Reserved";
    return createBusLabel(busId, null, buses);
}

/**
 * Formats driver code from employeeId (e.g., "DB-01")
 */
export function formatDriverCode(employeeId: string | undefined | null): string {
    if (!employeeId) return "DB-??";
    const num = employeeId.replace(/\D/g, "");
    return num ? `DB-${num.padStart(2, "0")}` : employeeId;
}

// ============================================
// FIRESTORE COMMIT FUNCTION
// ============================================

export interface CommitNetChangesResult {
    success: boolean;
    message?: string;
    conflictDetails?: string;
    updatedBuses: string[];
    updatedDrivers: string[];
}

/**
 * Commits net changes to Firestore using a transaction with optimistic concurrency.
 * Returns success or failure with conflict details.
 */
export async function commitNetChanges(
    netChanges: Map<string, NetBusChange>,
    driverFinalState: Map<string, DriverFinalState>,
    stagingSnapshot: StagedOperation[],
    adminUid: string,
    actorInfo?: { name: string; role: string; label?: string }
): Promise<CommitNetChangesResult> {
    const updatedBuses: string[] = [];
    const updatedDrivers: string[] = [];

    try {

        // Validate actor
        if (!adminUid) {
            throw new Error("No admin UID provided for commit");
        }
        await runTransaction(db, async (transaction) => {
            // Step 1: Read all affected documents and validate
            const busReads: { ref: ReturnType<typeof doc>; expected: NetBusChange }[] = [];
            const driverReads: { ref: ReturnType<typeof doc>; state: DriverFinalState }[] = [];

            // Read buses
            Array.from(netChanges.entries()).forEach(([busId, change]) => {
                const busRef = doc(db, "buses", busId);
                busReads.push({ ref: busRef, expected: change });
            });

            // Read drivers
            Array.from(driverFinalState.entries()).forEach(([driverId, state]) => {
                const driverRef = doc(db, "drivers", driverId);
                driverReads.push({ ref: driverRef, state });
            });

            // Validate buses (optimistic concurrency check)
            for (const { ref, expected } of busReads) {
                const busDoc = await transaction.get(ref);
                if (!busDoc.exists()) {
                    throw new Error(`Bus ${expected.busLabel} has been deleted`);
                }

                const currentData = busDoc.data();
                const currentOwner = currentData.assignedDriverId || currentData.activeDriverId || null;

                // Check if current state matches expected previous state
                if (currentOwner !== expected.prevAssignedDriverId) {
                    const currentOwnerName = currentOwner ?
                        `Driver ID: ${currentOwner}` : "No driver";
                    const expectedName = expected.prevAssignedDriverName || "No driver";
                    throw new Error(
                        `Conflict: ${expected.busLabel} is now assigned to ${currentOwnerName} ` +
                        `(expected: ${expectedName}). Data changed externally.`
                    );
                }
            }

            // Validate drivers exist
            for (const { ref, state } of driverReads) {
                const driverDoc = await transaction.get(ref);
                if (!driverDoc.exists()) {
                    throw new Error(`Driver ${state.driverName} has been deleted`);
                }
            }

            // Step 2: Apply updates
            // Update buses
            for (const { ref, expected } of busReads) {
                transaction.update(ref, {
                    assignedDriverId: expected.newAssignedDriverId || null,
                    activeDriverId: expected.newAssignedDriverId || null,
                    updatedAt: serverTimestamp(),
                    updatedBy: adminUid,
                });
                updatedBuses.push(expected.busId);
            }

            // Update drivers
            for (const { ref, state } of driverReads) {
                transaction.update(ref, {
                    busId: state.finalBusId || null,
                    assignedBusId: state.finalBusId || null,
                    routeId: state.finalRouteId || null, // NEW: Update routeId
                    assignedRouteId: state.finalRouteId || null, // NEW: Update assignedRouteId
                    isReserved: state.isReserved,
                    status: state.isReserved ? "reserved" : "active",
                    updatedAt: serverTimestamp(),
                    updatedBy: adminUid,
                });
                updatedDrivers.push(state.driverId);
            }
        });

        // Write audit log (outside transaction for performance)
        try {
            await writeAssignmentAuditLog(
                adminUid,
                updatedBuses,
                updatedDrivers,
                Array.from(netChanges.values()),
                Array.from(driverFinalState.values()),
                stagingSnapshot,
                actorInfo
            );
        } catch (auditError) {
            console.error('🔴 [commitNetChanges] Audit log write failed:', auditError);
        }

        return {
            success: true,
            updatedBuses,
            updatedDrivers,
        };
    } catch (error: any) {
        console.error("❌ commitNetChanges failed:", error);
        return {
            success: false,
            message: error.message || "Transaction failed",
            conflictDetails: error.message?.includes("Conflict") ? error.message : undefined,
            updatedBuses: [],
            updatedDrivers: [],
        };
    }
}

/**
 * Writes an audit log entry for the assignment operation.
 * Writes to Supabase reassignment_logs.
 */
async function writeAssignmentAuditLog(
    adminUid: string,
    updatedBuses: string[],
    updatedDrivers: string[],
    busChanges: NetBusChange[],
    driverChanges: DriverFinalState[],
    stagingSnapshot?: StagedOperation[],
    actorInfo?: { name: string; role: string; label?: string }
): Promise<void> {

    // Write to Supabase reassignment_logs with full change records for rollback
    try {
        // Build change records with before/after for rollback support
        const supabaseChanges: ChangeRecord[] = [];

        // Add bus changes
        for (const busChange of busChanges) {
            supabaseChanges.push({
                docPath: `buses/${busChange.busId}`,
                collection: 'buses',
                docId: busChange.busId,
                before: {
                    assignedDriverId: busChange.prevAssignedDriverId,
                    activeDriverId: busChange.prevAssignedDriverId,
                },
                after: {
                    assignedDriverId: busChange.newAssignedDriverId,
                    activeDriverId: busChange.newAssignedDriverId,
                },
            });
        }

        // Add driver changes
        for (const driverChange of driverChanges) {
            supabaseChanges.push({
                docPath: `drivers/${driverChange.driverId}`,
                collection: 'drivers',
                docId: driverChange.driverId,
                before: {
                    busId: driverChange.initialBusId,
                    assignedBusId: driverChange.initialBusId,
                    routeId: driverChange.initialRouteId || null,
                    assignedRouteId: driverChange.initialRouteId || null,
                    isReserved: !driverChange.initialBusId, // Consistent with status
                    status: driverChange.initialBusId ? 'active' : 'reserved',
                },
                after: {
                    busId: driverChange.finalBusId,
                    assignedBusId: driverChange.finalBusId,
                    routeId: driverChange.finalRouteId || null,
                    assignedRouteId: driverChange.finalRouteId || null,
                    isReserved: driverChange.isReserved,
                    status: driverChange.isReserved ? 'reserved' : 'active',
                },
            });
        }

        // Generate operation ID
        const operationId = generatePrefixedId('driver_reassignment_', 8);

        // Generate actor label
        let actorLabel = actorInfo?.label;
        if (!actorLabel) {
            if (actorInfo?.name) {
                const roleSuffix = actorInfo.role === 'moderator' ? '(Moderator)' : '(Admin)';
                actorLabel = `${actorInfo.name} ${roleSuffix}`;
            } else {
                actorLabel = `Admin (${adminUid.substring(0, 8)}...)`;
            }
        }

        // Generate descriptive summary
        let summary = `Committed ${updatedDrivers.length} driver assignment(s) affecting ${updatedBuses.length} bus(es)`;
        if (busChanges.length === 1) {
            const bc = busChanges[0];
            const prev = bc.prevAssignedDriverName && bc.prevAssignedDriverName !== 'None' ? bc.prevAssignedDriverName : 'Vacant';
            const next = bc.newAssignedDriverName && bc.newAssignedDriverName !== 'None' ? bc.newAssignedDriverName : 'Vacant';
            summary = `Reassigned ${bc.busLabel}: ${prev} → ${next}`;
        }

        // Write to Supabase via API route (works from client side)
        const writeResult = await writeToSupabaseViaAPI({
            operationId,
            type: 'driver_reassignment',
            actorId: adminUid,
            actorLabel,
            status: 'committed',
            summary,
            changes: supabaseChanges,
            meta: {
                busesAffected: updatedBuses,
                driversAffected: updatedDrivers,
                stagingSnapshot: stagingSnapshot || [],
            },
        });
        if (writeResult) {
        } else {
            console.error('❌ [writeAssignmentAuditLog] Supabase write FAILED');
        }
    } catch (supabaseError) {
        // Don't fail the operation if Supabase write fails
        console.error('❌ [writeAssignmentAuditLog] Supabase error:', supabaseError);
    }

}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validates staging before opening confirmation modal
 */
export function validateStagingPreCheck(
    stagedOperations: StagedOperation[],
    dbSnapshot: DbSnapshot
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { drivers, buses } = dbSnapshot;

    // Check: No driver is assigned to more than one bus in working state
    const driverBusAssignments = new Map<string, string[]>();

    for (const op of stagedOperations) {
        if (op.type === "assign" && op.busId) {
            const existing = driverBusAssignments.get(op.driverId) || [];
            existing.push(op.busId);
            driverBusAssignments.set(op.driverId, existing);
        }
    }

    Array.from(driverBusAssignments.entries()).forEach(([driverId, assignments]) => {
        if (assignments.length > 1) {
            // This is okay - later assignments override earlier ones
            // Just warn
            const driverName = getDriverName(driverId, drivers);
            warnings.push(`Driver ${driverName} has multiple staged assignments. Only the last one will apply.`);
        }
    });

    // Check shift compatibility (simplified - can be enhanced)
    for (const op of stagedOperations) {
        if (op.type === "assign" && op.busId) {
            const driver = drivers.find(d => d.id === op.driverId);
            const bus = buses.find(b => b.id === op.busId);

            if (driver && bus) {
                // Add shift compatibility checks here if needed
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Pre-check for conflicts before proceeding to finalize
 */
export async function preCheckConflicts(
    netChanges: Map<string, NetBusChange>
): Promise<{ hasConflicts: boolean; conflicts: string[] }> {
    const conflicts: string[] = [];

    try {
        await runTransaction(db, async (transaction) => {
            const netChangesArray = Array.from(netChanges.entries());
            for (let i = 0; i < netChangesArray.length; i++) {
                const [busId, change] = netChangesArray[i];
                const busRef = doc(db, "buses", busId);
                const busDoc = await transaction.get(busRef);

                if (!busDoc.exists()) {
                    conflicts.push(`${change.busLabel} has been deleted`);
                    continue;
                }

                const currentData = busDoc.data();
                const currentOwner = currentData.assignedDriverId || currentData.activeDriverId || null;

                if (currentOwner !== change.prevAssignedDriverId) {
                    const currentOwnerName = currentOwner || "None";
                    conflicts.push(
                        `${change.busLabel}: Expected driver "${change.prevAssignedDriverName}" but found "${currentOwnerName}"`
                    );
                }
            }
        });
    } catch (error: any) {
        conflicts.push(`Error checking conflicts: ${error.message}`);
    }

    return {
        hasConflicts: conflicts.length > 0,
        conflicts,
    };
}
