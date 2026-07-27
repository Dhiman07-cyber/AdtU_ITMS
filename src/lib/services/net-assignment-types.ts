/**
 * Net Assignment Types & Algorithm
 *
 * Extracted from net-assignment-service.ts to decouple type definitions
 * and the pure computeNetAssignments algorithm from the legacy Firestore
 * commit functions (which are now dead code).
 *
 * All exports here are pure types or pure functions with zero
 * Firestore SDK dependencies.
 */

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
    swapDriverId?: string | null;
    swapDriverName?: string | null;
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
    busLabel: string;
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
    busAffected: string;
    initially: string;
    initialDriverImpact: string;
    finally: string;
    finalDriverImpact: string;
    status: "pending" | "error";
    infoTooltip: string;
}

export interface ComputeNetAssignmentsResult {
    netChanges: Map<string, NetBusChange>;
    driverFinalState: Map<string, DriverFinalState>;
    confirmationRows: ConfirmationTableRow[];
    hasChanges: boolean;
    removedNoOpCount: number;
    removedNoOpInfo: string[];
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
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
    if (!driverId) return "ZZZ999";
    const driver = drivers.find(d => d.id === driverId);
    return driver?.employeeId || "ZZZ999";
}

// ============================================
// CORE ALGORITHM: computeNetAssignments
// ============================================

/**
 * Computes the net assignments from staged operations.
 * Eliminates no-ops and double-swaps, returning only the minimal set of changes needed.
 */
export function computeNetAssignments(
    stagedOperations: StagedOperation[],
    dbSnapshot: DbSnapshot
): ComputeNetAssignmentsResult {
    const { drivers, buses } = dbSnapshot;
    const removedNoOpInfo: string[] = [];

    // Build initial mappings from database snapshot
    const initialDriverBus = new Map<string, string | null>();
    const initialBusDriver = new Map<string, string | null>();

    for (const driver of drivers) {
        initialDriverBus.set(driver.id, driver.busId);
    }
    for (const bus of buses) {
        initialBusDriver.set(bus.id, bus.assignedDriverId || bus.activeDriverId);
    }

    // Process staged operations to compute final state
    const driverFinalBus = new Map<string, string | null>();
    const busFinalDriver = new Map<string, string | null>();
    const confirmationRows: ConfirmationTableRow[] = [];
    const netChanges = new Map<string, NetBusChange>();
    const driverFinalState = new Map<string, DriverFinalState>();
    const removedNoOps: string[] = [];

    let slNo = 1;

    for (const op of stagedOperations) {
        if (op.type === "markReserved") {
            // Mark driver as reserved — remove from bus
            const currentBusId = driverFinalBus.get(op.driverId) ?? initialDriverBus.get(op.driverId) ?? null;

            driverFinalBus.set(op.driverId, null);

            if (currentBusId) {
                const currentDriver = busFinalDriver.get(currentBusId) ?? initialBusDriver.get(currentBusId);
                if (currentDriver === op.driverId) {
                    busFinalDriver.set(currentBusId, null);
                }
            }

            // Check if this is a no-op
            const initialBus = initialDriverBus.get(op.driverId) ?? null;
            if (initialBus === null) {
                removedNoOpInfo.push(`Driver ${op.driverName}: already reserved`);
                removedNoOps.push(op.id);
                continue;
            }

            const bus = buses.find(b => b.id === currentBusId);
            const busLabel = bus ? `Bus-${(currentBusId || '').replace(/[^0-9]/g, '') || '?'} (${bus.busNumber})` : currentBusId || 'Unknown';

            confirmationRows.push({
                slNo: slNo++,
                busAffected: busLabel || 'N/A',
                initially: `Operated by ${op.driverName} (${op.driverCode})`,
                initialDriverImpact: `${busLabel} → Reserved`,
                finally: 'Reserved',
                finalDriverImpact: 'No driver impact',
                status: 'pending',
                infoTooltip: `${op.driverName} marked as reserved`,
            });

            continue;
        }

        if (op.type === "swap") {
            const swapDriverId = op.swapDriverId;
            if (!swapDriverId) continue;

            const driverCurrentBus = driverFinalBus.get(op.driverId) ?? initialDriverBus.get(op.driverId) ?? null;
            const swapDriverCurrentBus = driverFinalBus.get(swapDriverId) ?? initialDriverBus.get(swapDriverId) ?? null;

            // Only swap if they're on different buses
            if (driverCurrentBus === swapDriverCurrentBus) {
                removedNoOpInfo.push(`Swap ${op.driverName} ↔ ${op.swapDriverName}: same bus, no-op`);
                removedNoOps.push(op.id);
                continue;
            }

            driverFinalBus.set(op.driverId, swapDriverCurrentBus);
            driverFinalBus.set(swapDriverId, driverCurrentBus);

            if (driverCurrentBus) busFinalDriver.set(driverCurrentBus, swapDriverId);
            if (swapDriverCurrentBus) busFinalDriver.set(swapDriverCurrentBus, op.driverId);

            const bus1 = buses.find(b => b.id === driverCurrentBus);
            const bus2 = buses.find(b => b.id === swapDriverCurrentBus);
            const busLabel1 = bus1 ? `Bus-${(driverCurrentBus || '').replace(/[^0-9]/g, '') || '?'} (${bus1.busNumber})` : driverCurrentBus || 'N/A';
            const busLabel2 = bus2 ? `Bus-${(swapDriverCurrentBus || '').replace(/[^0-9]/g, '') || '?'} (${bus2.busNumber})` : swapDriverCurrentBus || 'N/A';

            confirmationRows.push({
                slNo: slNo++,
                busAffected: `${busLabel1} ↔ ${busLabel2}`,
                initially: `${op.driverName} (${op.driverCode}) on ${busLabel1}`,
                initialDriverImpact: `${busLabel1} → ${busLabel2}`,
                finally: `${op.swapDriverName} on ${busLabel2}`,
                finalDriverImpact: `${busLabel2} → ${busLabel1}`,
                status: 'pending',
                infoTooltip: `Swap: ${op.driverName} ↔ ${op.swapDriverName}`,
            });

            continue;
        }

        // Regular assign
        const targetBusId = op.busId || null;
        const currentBusId = driverFinalBus.get(op.driverId) ?? initialDriverBus.get(op.driverId) ?? null;

        // No-op check: driver already on target bus
        if (currentBusId === targetBusId) {
            removedNoOpInfo.push(`Driver ${op.driverName}: already on ${op.busNumber || 'Reserved'}`);
            removedNoOps.push(op.id);
            continue;
        }

        // Clear old bus
        if (currentBusId) {
            const oldDriver = busFinalDriver.get(currentBusId) ?? initialBusDriver.get(currentBusId);
            if (oldDriver === op.driverId) {
                busFinalDriver.set(currentBusId, null);
            }
        }

        // Assign new bus
        driverFinalBus.set(op.driverId, targetBusId);
        if (targetBusId) {
            busFinalDriver.set(targetBusId, op.driverId);
        }

        const oldBus = buses.find(b => b.id === currentBusId);
        const newBus = buses.find(b => b.id === targetBusId);
        const oldBusLabel = oldBus ? `Bus-${(currentBusId || '').replace(/[^0-9]/g, '') || '?'} (${oldBus.busNumber})` : currentBusId || 'Reserved';
        const newBusLabel = newBus ? `Bus-${(targetBusId || '').replace(/[^0-9]/g, '') || '?'} (${newBus.busNumber})` : targetBusId || 'Reserved';

        confirmationRows.push({
            slNo: slNo++,
            busAffected: newBusLabel,
            initially: currentBusId ? `Operated by ${op.driverName} (${op.driverCode}) on ${oldBusLabel}` : 'Vacant',
            initialDriverImpact: `${oldBusLabel} → ${newBusLabel}`,
            finally: `Operated by ${op.driverName} (${op.driverCode})`,
            finalDriverImpact: `${oldBusLabel} → ${newBusLabel}`,
            status: 'pending',
            infoTooltip: `${op.driverName} assigned to ${newBusLabel}`,
        });
    }

    // Build netChanges and driverFinalState
    const allAffectedBusIds = new Set<string>();
    for (const [driverId, finalBusId] of driverFinalBus) {
        const initialBusId = initialDriverBus.get(driverId) ?? null;
        if (finalBusId !== initialBusId) {
            allAffectedBusIds.add(finalBusId || '__vacant__');
            if (initialBusId) allAffectedBusIds.add(initialBusId);
        }
    }

    for (const busId of allAffectedBusIds) {
        if (busId === '__vacant__') continue;
        const prevDriver = initialBusDriver.get(busId) || null;
        const newDriver = busFinalDriver.get(busId) ?? initialBusDriver.get(busId) ?? null;
        if (prevDriver !== newDriver) {
            const bus = buses.find(b => b.id === busId);
            const busNum = busId.replace(/[^0-9]/g, '') || '?';
            const busLabel = bus ? `Bus-${busNum} (${bus.busNumber})` : busId;
            const prevDriverObj = drivers.find(d => d.id === prevDriver);
            const newDriverObj = drivers.find(d => d.id === newDriver);

            netChanges.set(busId, {
                busId,
                busLabel,
                prevAssignedDriverId: prevDriver,
                prevAssignedDriverName: prevDriverObj?.name || null,
                newAssignedDriverId: newDriver,
                newAssignedDriverName: newDriverObj?.name || null,
            });
        }
    }

    for (const [driverId, finalBusId] of driverFinalBus) {
        const initialBusId = initialDriverBus.get(driverId) ?? null;
        if (finalBusId !== initialBusId) {
            const driver = drivers.find(d => d.id === driverId);
            const initialBus = buses.find(b => b.id === initialBusId);
            const finalBus = buses.find(b => b.id === finalBusId);
            const driverCode = driver?.employeeId
                ? `DB-${driver.employeeId.replace(/\D/g, '').padStart(2, '0')}`
                : 'DB-??';

            driverFinalState.set(driverId, {
                driverId,
                driverName: driver?.name || 'Unknown',
                driverCode,
                initialBusId,
                initialBusLabel: initialBus ? `Bus-${(initialBusId || '').replace(/[^0-9]/g, '') || '?'} (${initialBus.busNumber})` : null,
                finalBusId,
                finalBusLabel: finalBus ? `Bus-${(finalBusId || '').replace(/[^0-9]/g, '') || '?'} (${finalBus.busNumber})` : null,
                initialRouteId: initialBus?.routeId,
                finalRouteId: finalBus?.routeId,
                isReserved: !finalBusId,
            });
        }
    }

    return {
        netChanges,
        driverFinalState,
        confirmationRows,
        hasChanges: netChanges.size > 0,
        removedNoOpCount: removedNoOps.length,
        removedNoOpInfo: removedNoOpInfo,
    };
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

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
            const driverName = getDriverName(driverId, drivers);
            warnings.push(`Driver ${driverName} has multiple staged assignments. Only the last one will apply.`);
        }
    });

    for (const op of stagedOperations) {
        if (op.type === "assign" && op.busId) {
            const driver = drivers.find(d => d.id === op.driverId);
            const bus = buses.find(b => b.id === op.busId);
            if (driver && bus) {
                // Shift compatibility checks can be added here
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}
