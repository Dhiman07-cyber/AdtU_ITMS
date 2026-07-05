/**
 * Assignment Service
 * Handles atomic Firestore transactions for driver and route assignments
 * Implements all validations and concurrency checks
 */

import { db } from "@/lib/firebase";
import {
    doc,
    runTransaction,
    serverTimestamp,
    Timestamp,
    writeBatch,
    collection,
    addDoc,
} from "firebase/firestore";
import { generatePrefixedId } from '@/lib/security/random-id';


// ============================================
// TYPES
// ============================================

export interface DriverAssignmentOperation {
    type: "driverAssign";
    driverId: string;
    driverName: string;
    newBusId: string;
    newBusNumber: string;
    oldBusId?: string | null;
    oldBusNumber?: string | null;
    adminOverride?: boolean;
}

export interface RouteAssignmentOperation {
    type: "routeAssign";
    busId: string;
    busNumber: string;
    newRouteId: string;
    newRouteName: string;
    oldRouteId?: string | null;
    oldRouteName?: string | null;
    adminOverride?: boolean;
}

export type AssignmentOperation = DriverAssignmentOperation | RouteAssignmentOperation;

export interface StagedDriverAssignment {
    id: string; // unique staging ID
    driverId: string;
    driverName: string;
    driverCode: string; // DB-##
    newBusId: string;
    newBusNumber: string;
    newRouteId?: string;
    newRouteName?: string;
    oldBusId?: string | null;
    oldBusNumber?: string | null;
    // New fields for enhanced staging table
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
    id: string; // unique staging ID
    busId: string;
    busNumber: string;
    busCode: string; // bus_##
    newRouteId: string;
    newRouteName: string;
    newStopCount: number;
    oldRouteId?: string | null;
    oldRouteName?: string | null;
    status: "pending" | "success" | "error";
    errorMessage?: string;
}

export interface CommitResult {
    success: boolean;
    totalOperations: number;
    successCount: number;
    failureCount: number;
    results: Array<{
        index: number;
        operationType: string;
        status: "success" | "error";
        message?: string;
    }>;
}

export interface ValidationResult {
    isValid: boolean;
    warnings: string[];
    errors: string[];
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validates driver assignment preconditions
 */
export async function validateDriverAssignment(
    driverId: string,
    newBusId: string,
    adminOverride: boolean = false
): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    return await runTransaction(db, async (transaction) => {
        // Read documents
        const driverRef = doc(db, "drivers", driverId);
        const busRef = doc(db, "buses", newBusId);

        const driverSnap = await transaction.get(driverRef);
        const busSnap = await transaction.get(busRef);

        if (!driverSnap.exists()) {
            errors.push(`Driver ${driverId} not found`);
            return { isValid: false, warnings, errors };
        }

        if (!busSnap.exists()) {
            errors.push(`Bus ${newBusId} not found`);
            return { isValid: false, warnings, errors };
        }

        const driver = driverSnap.data();
        const bus = busSnap.data();

        // Check driver status
        if (driver.status === "deleted" || driver.status === "inactive") {
            errors.push(`Driver ${driver.fullName || driver.name} is ${driver.status}`);
        }

        // Check bus status
        if (bus.status === "deleted" || bus.status === "Inactive") {
            errors.push(`Bus ${bus.busNumber} is ${bus.status}`);
        }

        // Check active trip
        if (bus.activeTripId && !adminOverride) {
            errors.push(`Bus ${bus.busNumber} has an active trip. Override required.`);
        } else if (bus.activeTripId && adminOverride) {
            warnings.push(`Bus ${bus.busNumber} has an active trip. Proceeding with override.`);
        }

        // Check if bus already has a different driver
        const currentDriverId = bus.activeDriverId || bus.assignedDriverId;
        if (currentDriverId && currentDriverId !== driverId) {
            warnings.push(`Bus ${bus.busNumber} is currently assigned to another driver. They will be unassigned.`);
        }

        // Shift compatibility check using canonical shift-utils
        const { normalizeShift, areShiftsCompatible } = await import('@/lib/utils/shift-utils');
        const driverShift = normalizeShift(driver.shift || '');
        const busShift = normalizeShift(bus.shift || 'Both');

        if (!areShiftsCompatible(driverShift, busShift)) {
            warnings.push(`Driver prefers ${driverShift} shift but bus operates ${busShift} only.`);
        }

        return { isValid: errors.length === 0, warnings, errors };
    });
}

/**
 * Validates route assignment preconditions
 */
export async function validateRouteAssignment(
    busId: string,
    newRouteId: string,
    adminOverride: boolean = false
): Promise<ValidationResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    return await runTransaction(db, async (transaction) => {
        const busRef = doc(db, "buses", busId);
        const routeRef = doc(db, "routes", newRouteId);

        const busSnap = await transaction.get(busRef);
        const routeSnap = await transaction.get(routeRef);

        if (!busSnap.exists()) {
            errors.push(`Bus ${busId} not found`);
            return { isValid: false, warnings, errors };
        }

        if (!routeSnap.exists()) {
            errors.push(`Route ${newRouteId} not found`);
            return { isValid: false, warnings, errors };
        }

        const bus = busSnap.data();
        const route = routeSnap.data();

        // Check bus status
        if (bus.status === "deleted" || bus.status === "Inactive") {
            errors.push(`Bus ${bus.busNumber} is ${bus.status}`);
        }

        // Check route status
        if (route.status === "deleted" || route.active === false) {
            errors.push(`Route ${route.routeName} is not active`);
        }

        // Check active trip
        if (bus.activeTripId && !adminOverride) {
            errors.push(`Bus ${bus.busNumber} has an active trip. Override required.`);
        } else if (bus.activeTripId && adminOverride) {
            warnings.push(`Bus ${bus.busNumber} has an active trip. Proceeding with override.`);
        }

        // Check route has stops
        if (!route.stops || route.stops.length === 0) {
            warnings.push(`Route ${route.routeName} has no stops defined.`);
        }

        // Check if changing routes
        const currentRouteId = bus.routeId;
        if (currentRouteId && currentRouteId !== newRouteId) {
            warnings.push(`Bus will be moved from current route to ${route.routeName}.`);
        }

        return { isValid: errors.length === 0, warnings, errors };
    });
}

// ============================================
// COMMIT FUNCTIONS
// ============================================

/**
 * Commits a single driver assignment atomically
 */
export async function commitDriverAssignment(
    operation: DriverAssignmentOperation,
    adminUid: string
): Promise<{ success: boolean; message?: string }> {
    try {
        await runTransaction(db, async (transaction) => {
            const driverRef = doc(db, "drivers", operation.driverId);
            const newBusRef = doc(db, "buses", operation.newBusId);

            const driverSnap = await transaction.get(driverRef);
            const newBusSnap = await transaction.get(newBusRef);

            if (!driverSnap.exists()) {
                throw new Error(`Driver ${operation.driverId} not found`);
            }
            if (!newBusSnap.exists()) {
                throw new Error(`Bus ${operation.newBusId} not found`);
            }

            const driver = driverSnap.data();
            const newBus = newBusSnap.data();

            // Re-validate preconditions inside transaction
            if (driver.status === "deleted") {
                throw new Error(`Driver is deleted`);
            }
            if (newBus.activeTripId && !operation.adminOverride) {
                throw new Error(`Bus has active trip`);
            }

            // Get old bus if exists
            const oldBusId = driver.assignedBusId || driver.busId;

            // Update driver document
            transaction.update(driverRef, {
                assignedBusId: operation.newBusId,
                busId: operation.newBusId, // Keep both for compatibility
                assignedRouteId: newBus.routeId || null,
                routeId: newBus.routeId || null,
                status: "active", // Set driver status to active when assigned
                updatedAt: serverTimestamp(),
                updatedBy: adminUid,
            });

            // Update new bus document
            transaction.update(newBusRef, {
                assignedDriverId: operation.driverId,
                activeDriverId: operation.driverId,
                updatedAt: serverTimestamp(),
                updatedBy: adminUid,
            });

            // Clear old bus assignment if different
            if (oldBusId && oldBusId !== operation.newBusId) {
                const oldBusRef = doc(db, "buses", oldBusId);
                const oldBusSnap = await transaction.get(oldBusRef);

                if (oldBusSnap.exists()) {
                    const oldBus = oldBusSnap.data();
                    // Only clear if this driver was assigned
                    if (oldBus.assignedDriverId === operation.driverId ||
                        oldBus.activeDriverId === operation.driverId) {
                        transaction.update(oldBusRef, {
                            assignedDriverId: null,
                            activeDriverId: null,
                            updatedAt: serverTimestamp(),
                            updatedBy: adminUid,
                        });
                    }
                }
            }

            // Clear any other driver from the new bus (set to reserved)
            const existingDriverId = newBus.assignedDriverId || newBus.activeDriverId;
            if (existingDriverId && existingDriverId !== operation.driverId) {
                const existingDriverRef = doc(db, "drivers", existingDriverId);
                const existingDriverSnap = await transaction.get(existingDriverRef);

                if (existingDriverSnap.exists()) {
                    transaction.update(existingDriverRef, {
                        assignedBusId: null,
                        busId: null,
                        assignedRouteId: null,
                        routeId: null,
                        status: "reserved", // Set to reserved when displaced
                        updatedAt: serverTimestamp(),
                        updatedBy: adminUid,
                    });
                }
            }
        });

        console.log(`✅ Driver ${operation.driverName} assigned to ${operation.newBusNumber}`);
        return { success: true };
    } catch (error: any) {
        console.error(`❌ Failed to assign driver:`, error);
        return { success: false, message: error.message };
    }
}

/**
 * Commits a single route assignment atomically
 */
export async function commitRouteAssignment(
    operation: RouteAssignmentOperation,
    adminUid: string
): Promise<{ success: boolean; message?: string }> {
    try {
        await runTransaction(db, async (transaction) => {
            const busRef = doc(db, "buses", operation.busId);
            const newRouteRef = doc(db, "routes", operation.newRouteId);

            const busSnap = await transaction.get(busRef);
            const newRouteSnap = await transaction.get(newRouteRef);

            if (!busSnap.exists()) {
                throw new Error(`Bus ${operation.busId} not found`);
            }
            if (!newRouteSnap.exists()) {
                throw new Error(`Route ${operation.newRouteId} not found`);
            }

            const bus = busSnap.data();
            const newRoute = newRouteSnap.data();

            // Re-validate preconditions inside transaction
            if (bus.activeTripId && !operation.adminOverride) {
                throw new Error(`Bus has active trip`);
            }
            if (newRoute.active === false) {
                throw new Error(`Route is not active`);
            }

            // Update bus document with new route
            transaction.update(busRef, {
                routeId: operation.newRouteId,
                routeRef: doc(db, "routes", operation.newRouteId),
                routeName: newRoute.routeName || null,
                totalStops: newRoute.totalStops || newRoute.stops?.length || 0,
                updatedAt: serverTimestamp(),
                updatedBy: adminUid,
            });

            // Note: We don't update assigned driver's routeId here
            // as that's managed through driver assignment
        });

        console.log(`✅ Bus ${operation.busNumber} assigned to ${operation.newRouteName}`);
        return { success: true };
    } catch (error: any) {
        console.error(`❌ Failed to assign route:`, error);
        return { success: false, message: error.message };
    }
}

/**
 * Normalizes driver assignment operations to detect and remove no-ops
 * For example, if Driver-A is assigned to Bus-X and Driver-B is assigned to Bus-Y,
 * but then Driver-B is assigned to Bus-X and Driver-A to Bus-Y (double swap),
 * and the final result is same as the original state, both operations are removed.
 * 
 * Returns the filtered operations that actually result in changes.
 */
export function normalizeDriverAssignments(
    operations: DriverAssignmentOperation[]
): { normalized: DriverAssignmentOperation[]; removedCount: number; removedInfo: string[] } {
    const removedInfo: string[] = [];

    // Create a map to track final bus assignments for each driver
    // Key: driverId, Value: newBusId
    const driverToBus = new Map<string, string>();

    // Track initial states (what was the driver's previous bus)
    const driverInitialBus = new Map<string, string | null>();

    // Process operations in order to get final state
    for (const op of operations) {
        if (!driverInitialBus.has(op.driverId)) {
            driverInitialBus.set(op.driverId, op.oldBusId || null);
        }
        driverToBus.set(op.driverId, op.newBusId);
    }

    // Now check which operations actually result in a change from initial state
    const effectiveOperations: DriverAssignmentOperation[] = [];
    const processedDrivers = new Set<string>();

    for (const op of operations) {
        // Skip if already processed this driver
        if (processedDrivers.has(op.driverId)) continue;
        processedDrivers.add(op.driverId);

        const initialBus = driverInitialBus.get(op.driverId);
        const finalBus = driverToBus.get(op.driverId);

        // If initial bus equals final bus, this is a no-op
        if (initialBus === finalBus) {
            removedInfo.push(`Driver ${op.driverName}: no net change (started and ended on ${op.newBusNumber || 'Reserved'})`);
            continue;
        }

        // Find the last operation for this driver (final state)
        const lastOp = [...operations].reverse().find(o => o.driverId === op.driverId);
        if (lastOp) {
            effectiveOperations.push(lastOp);
        }
    }

    return {
        normalized: effectiveOperations,
        removedCount: operations.length - effectiveOperations.length,
        removedInfo
    };
}

/**
 * Normalizes route assignment operations to detect and remove no-ops
 * Similar to driver assignments, if a bus is assigned to Route-A, then to Route-B,
 * then back to Route-A, and the initial state was Route-A, it's a no-op.
 */
export function normalizeRouteAssignments(
    operations: RouteAssignmentOperation[]
): { normalized: RouteAssignmentOperation[]; removedCount: number; removedInfo: string[] } {
    const removedInfo: string[] = [];

    // Track final route for each bus
    const busToRoute = new Map<string, string>();

    // Track initial states
    const busInitialRoute = new Map<string, string | null>();

    // Process operations to get final state
    for (const op of operations) {
        if (!busInitialRoute.has(op.busId)) {
            busInitialRoute.set(op.busId, op.oldRouteId || null);
        }
        busToRoute.set(op.busId, op.newRouteId);
    }

    // Check which operations actually result in a change
    const effectiveOperations: RouteAssignmentOperation[] = [];
    const processedBuses = new Set<string>();

    for (const op of operations) {
        if (processedBuses.has(op.busId)) continue;
        processedBuses.add(op.busId);

        const initialRoute = busInitialRoute.get(op.busId);
        const finalRoute = busToRoute.get(op.busId);

        // If initial route equals final route, this is a no-op
        if (initialRoute === finalRoute) {
            removedInfo.push(`Bus ${op.busNumber}: no net change (started and ended on ${op.newRouteName || 'No Route'})`);
            continue;
        }

        // Find the last operation for this bus (final state)
        const lastOp = [...operations].reverse().find(o => o.busId === op.busId);
        if (lastOp) {
            effectiveOperations.push(lastOp);
        }
    }

    return {
        normalized: effectiveOperations,
        removedCount: operations.length - effectiveOperations.length,
        removedInfo
    };
}

/**
 * Commits multiple operations in batches
 * Returns per-row status for partial failure handling
 */
export async function commitAssignments(
    operations: AssignmentOperation[],
    adminUid: string
): Promise<CommitResult> {
    const results: CommitResult["results"] = [];
    let successCount = 0;
    let failureCount = 0;

    // Optimization: Parallelize assignment commits where possible
    // Note: Since these are independent transactions in the current design,
    // we can use Promise.all to run them in parallel.
    const commitPromises = operations.map(async (op, i) => {
        let result: { success: boolean; message?: string };
        if (op.type === "driverAssign") {
            result = await commitDriverAssignment(op as DriverAssignmentOperation, adminUid);
        } else {
            result = await commitRouteAssignment(op as RouteAssignmentOperation, adminUid);
        }

        return {
            index: i,
            operationType: op.type,
            status: result.success ? "success" : "error",
            message: result.message
        };
    });

    const commitResults = await Promise.all(commitPromises);

    commitResults.forEach(res => {
        results.push({
            index: res.index,
            operationType: res.operationType,
            status: res.status as "success" | "error",
            message: res.message
        });
        if (res.status === "success") successCount++;
        else failureCount++;
    });

    // Optional: Write minimal audit log with TTL
    if (successCount > 0) {
        try {
            await writeAuditLog(adminUid, operations.length, successCount, failureCount);
        } catch (e) {
            console.warn("Audit log write failed (non-critical):", e);
        }
    }

    return {
        success: failureCount === 0,
        totalOperations: operations.length,
        successCount,
        failureCount,
        results,
    };
}

/**
 * Writes a minimal audit log entry with 30-day TTL
 */
async function writeAuditLog(
    adminUid: string,
    totalOps: number,
    successCount: number,
    failureCount: number
): Promise<void> {
    const ttlDate = new Date();
    ttlDate.setDate(ttlDate.getDate() + 30); // 30-day TTL

    try {
        const auditLogsRef = collection(db, 'audit_logs');
        const docId = generatePrefixedId('aud_');
        await addDoc(auditLogsRef, {
            auditId: docId,
            createdAt: serverTimestamp(),
            expiresAt: Timestamp.fromDate(ttlDate),
            category: 'reassignments',
            action: 'assignment_commit',
            summary: `Committed ${successCount}/${totalOps} assignments`,
            description: '',
            severity: 'low',
            performedBy: adminUid,
            performedByName: 'Admin',
            performedByRole: 'admin',
            performedAt: serverTimestamp(),
            targetType: 'bus',
            targetId: adminUid,
            targetName: '',
            metadata: { rowsAffected: successCount, totalOps },
            ipAddress: '',
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : ''
        });
    } catch (err) {
        console.error('Failed to write client-side audit log:', err);
    }
}

// ============================================
// HELPER FUNCTIONS
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
 * Formats bus code from busNumber (e.g., "AS-01-PC-9094")
 */
export function formatBusCode(busId: string, busNumber: string): string {
    return busNumber || busId;
}

/**
 * Gets driver assignment status label
 */
export function getDriverStatus(driver: any): "Assigned" | "Reserved" | "Unassigned" {
    const hasBus = driver.assignedBusId || driver.busId;
    if (hasBus) return "Assigned";
    if (driver.status === "reserved" || driver.isReserved) return "Reserved";
    return "Reserved"; // Default to Reserved instead of Unassigned per spec
}

/**
 * Gets bus assignment status label
 */
export function getBusStatus(bus: any): "Assigned" | "Occupied" | "Available" {
    const hasDriver = bus.assignedDriverId || bus.activeDriverId;
    if (hasDriver) return "Occupied";
    if (bus.routeId) return "Assigned";
    return "Available";
}
