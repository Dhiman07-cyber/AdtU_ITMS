/**
 * Net Route Assignment Service
 * Implements the computeNetRouteAssignments algorithm for Smart Route Allocation.
 * Computes the minimal set of bus-route updates required, eliminating redundant/no-op operations.
 * 
 * Integrates with Supabase reassignment_logs for:
 * - Full audit trail with before/after snapshots
 * - Rollback support
 */

import { db } from "@/lib/firebase";
import {
    doc,
    runTransaction,
    serverTimestamp,
} from "firebase/firestore";
import { type ChangeRecord } from "./reassignment-logs-supabase";
import { generatePrefixedId } from '@/lib/security/random-id';

// ============================================
// HELPER: Write to Supabase via API route
// ============================================

import { writeToSupabaseViaAPI } from './reassignment-log-writer';
// ============================================
// TYPES
// ============================================

export interface StagedRouteOperation {
    id: string;
    busId: string;
    busNumber: string;
    busCode: string;
    newRouteId: string;
    newRouteName: string;
    newStopCount: number;
    oldRouteId?: string | null;
    oldRouteName?: string | null;
    stagedAt: number;
}

export interface BusSnapshot {
    id: string;
    busNumber: string;
    busId: string;
    routeId: string | null;
    capacity?: number;
    currentMembers?: number;
}

export interface RouteSnapshot {
    id: string;
    routeId: string;
    routeName: string;
    totalStops: number;
    stops?: Array<{ name: string; sequence: number }>;
}

export interface DbRouteSnapshot {
    buses: BusSnapshot[];
    routes: RouteSnapshot[];
}

export interface NetRouteChange {
    busId: string;
    busLabel: string; // e.g., "AS-01-PC-9094"
    busCode: string;
    prevRouteId: string | null;
    prevRouteName: string | null;
    newRouteId: string;
    newRouteName: string;
    newStopCount: number;
}

export interface RouteImpact {
    routeId: string;
    routeName: string;
    previousBusCount: number;
    newBusCount: number;
    change: number; // +1, -1, 0
}

export interface RouteConfirmationTableRow {
    slNo: number;
    busAffected: string; // "AS-01-PC-9094"
    busCode: string; // "bus_1"
    previousRoute: string; // "Route-1" or "None"
    newRoute: string; // "Route-2"
    stops: string; // "9 stops"
    impact: string; // "Route-2: +1 bus (was 3 → will be 4)"
    status: "pending" | "success" | "error";
    infoTooltip: string;
}

export interface ComputeNetRouteAssignmentsResult {
    netChanges: Map<string, NetRouteChange>;
    routeImpacts: Map<string, RouteImpact>;
    confirmationRows: RouteConfirmationTableRow[];
    hasChanges: boolean;
    removedNoOpCount: number;
    removedNoOpInfo: string[];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Gets route name by ID from snapshot
 */
export function getRouteName(routeId: string | null, routes: RouteSnapshot[]): string {
    if (!routeId) return "None";
    const route = routes.find(r => r.id === routeId || r.routeId === routeId);
    return route?.routeName || "Unknown";
}

/**
 * Gets route by ID
 */
export function getRoute(routeId: string | null, routes: RouteSnapshot[]): RouteSnapshot | null {
    if (!routeId) return null;
    return routes.find(r => r.id === routeId || r.routeId === routeId) || null;
}

/**
 * Format bus label (e.g., "Bus-1 (AS-01-PC-9094)")
 */
export function formatBusLabel(bus: BusSnapshot): string {
    const busNum = (bus.busId || bus.id).replace(/[^0-9]/g, '') || '?';
    return `Bus-${busNum} (${bus.busNumber})`;
}

// ============================================
// CORE ALGORITHM: computeNetRouteAssignments
// ============================================

/**
 * Computes the net route assignments from staged operations.
 * Eliminates no-ops, returning only the minimal set of changes needed.
 * 
 * @param stagedOperations - Array of staged operations in chronological order
 * @param dbSnapshot - Current state snapshot from Firestore
 * @returns ComputeNetRouteAssignmentsResult with netChanges, routeImpacts, and confirmationRows
 */
export function computeNetRouteAssignments(
    stagedOperations: StagedRouteOperation[],
    dbSnapshot: DbRouteSnapshot
): ComputeNetRouteAssignmentsResult {
    const { buses, routes } = dbSnapshot;
    const removedNoOpInfo: string[] = [];

    // Build initial mappings from database snapshot
    const initialBusRoute = new Map<string, string | null>(); // busId -> routeId | null
    const initialRouteBusCount = new Map<string, number>(); // routeId -> bus count

    // Initialize route bus counts
    for (const route of routes) {
        initialRouteBusCount.set(route.id, 0);
        if (route.routeId) {
            initialRouteBusCount.set(route.routeId, 0);
        }
    }

    for (const bus of buses) {
        initialBusRoute.set(bus.id, bus.routeId || null);

        // Count buses per route
        if (bus.routeId) {
            const currentCount = initialRouteBusCount.get(bus.routeId) || 0;
            initialRouteBusCount.set(bus.routeId, currentCount + 1);
        }
    }

    // Working copy for applying staged operations
    const workingBusRoute = new Map(initialBusRoute);

    // Collapse duplicates: if a bus appears multiple times, keep last change
    const latestOperations = new Map<string, StagedRouteOperation>();
    for (const op of stagedOperations) {
        latestOperations.set(op.busId, op);
    }

    // Apply latest operations
    Array.from(latestOperations.values()).forEach(op => {
        workingBusRoute.set(op.busId, op.newRouteId);
    });

    // Compute net changes by comparing working vs initial state
    const netChanges = new Map<string, NetRouteChange>();

    Array.from(latestOperations.values()).forEach(op => {
        const bus = buses.find(b => b.id === op.busId);
        if (!bus) return;

        const initialRoute = initialBusRoute.get(op.busId);
        const finalRoute = workingBusRoute.get(op.busId);

        // Check if this is a no-op (same route)
        if (initialRoute === finalRoute) {
            removedNoOpInfo.push(`Bus ${op.busNumber}: no net change (returned to original route)`);
            return;
        }

        // Also check if initially assigned route matches new route via routeId
        const initialRouteObj = getRoute(initialRoute || null, routes);
        const finalRouteObj = getRoute(finalRoute || null, routes);

        if (initialRouteObj && finalRouteObj) {
            if (initialRouteObj.id === finalRouteObj.id ||
                initialRouteObj.routeId === finalRouteObj.routeId) {
                removedNoOpInfo.push(`Bus ${op.busNumber}: no net change (same route)`);
                return;
            }
        }

        netChanges.set(op.busId, {
            busId: op.busId,
            busLabel: op.busNumber,
            busCode: op.busCode,
            prevRouteId: initialRoute || null,
            prevRouteName: getRouteName(initialRoute || null, routes),
            newRouteId: op.newRouteId,
            newRouteName: op.newRouteName,
            newStopCount: op.newStopCount,
        });
    });

    // Compute route impacts (how many buses each route gains/loses)
    const routeImpacts = new Map<string, RouteImpact>();
    const workingRouteBusCount = new Map(initialRouteBusCount);

    // Calculate impact on routes
    Array.from(netChanges.values()).forEach(change => {
        // Decrease count for old route
        if (change.prevRouteId) {
            const prevCount = workingRouteBusCount.get(change.prevRouteId) || 0;
            workingRouteBusCount.set(change.prevRouteId, Math.max(0, prevCount - 1));
        }

        // Increase count for new route
        if (change.newRouteId) {
            const newCount = workingRouteBusCount.get(change.newRouteId) || 0;
            workingRouteBusCount.set(change.newRouteId, newCount + 1);
        }
    });

    // Build route impact entries
    for (const route of routes) {
        const routeKey = route.id;
        const prevCount = initialRouteBusCount.get(routeKey) || 0;
        const newCount = workingRouteBusCount.get(routeKey) || 0;

        if (prevCount !== newCount) {
            routeImpacts.set(routeKey, {
                routeId: routeKey,
                routeName: route.routeName,
                previousBusCount: prevCount,
                newBusCount: newCount,
                change: newCount - prevCount,
            });
        }
    }

    // Generate confirmation table rows sorted by bus ID
    const confirmationRows: RouteConfirmationTableRow[] = [];
    let slNo = 1;

    // Sort by bus code/ID numerically
    const sortedChanges = Array.from(netChanges.values()).sort((a, b) => {
        const numA = parseInt((a.busCode || a.busId).replace(/\D/g, "") || "999");
        const numB = parseInt((b.busCode || b.busId).replace(/\D/g, "") || "999");
        return numA - numB;
    });

    for (const change of sortedChanges) {
        // Build impact string for new route
        const newRouteImpact = routeImpacts.get(change.newRouteId);
        let impactStr = "None";
        if (newRouteImpact) {
            const sign = newRouteImpact.change > 0 ? "+" : "";
            impactStr = `${change.newRouteName}: ${sign}${newRouteImpact.change} bus (was ${newRouteImpact.previousBusCount} → will be ${newRouteImpact.newBusCount})`;
        }

        // Build tooltip
        const tooltipParts: string[] = [];
        if (change.prevRouteName && change.prevRouteName !== "None") {
            tooltipParts.push(`Bus was on ${change.prevRouteName}`);
        } else {
            tooltipParts.push("Bus was not assigned to any route");
        }
        tooltipParts.push(`Will now operate on ${change.newRouteName} with ${change.newStopCount} stops`);

        confirmationRows.push({
            slNo: slNo++,
            busAffected: change.busLabel,
            busCode: change.busCode,
            previousRoute: change.prevRouteName || "None",
            newRoute: change.newRouteName,
            stops: `${change.newStopCount} stops`,
            impact: impactStr,
            status: "pending",
            infoTooltip: tooltipParts.join(". ") + ".",
        });
    }

    return {
        netChanges,
        routeImpacts,
        confirmationRows,
        hasChanges: netChanges.size > 0,
        removedNoOpCount: removedNoOpInfo.length,
        removedNoOpInfo,
    };
}

// ============================================
// FIRESTORE COMMIT FUNCTION
// ============================================

export interface CommitNetRouteChangesResult {
    success: boolean;
    message?: string;
    conflictDetails?: string;
    updatedBuses: string[];
}

/**
 * Commits net route changes to Firestore using a transaction with optimistic concurrency.
 */
export async function commitNetRouteChanges(
    netChanges: Map<string, NetRouteChange>,
    adminUid: string,
    stagingSnapshot?: StagedRouteOperation[],
    actorInfo?: { name: string; role: string; label?: string }
): Promise<CommitNetRouteChangesResult> {
    const updatedBuses: string[] = [];

    try {
        await runTransaction(db, async (transaction) => {
            // Step 1: Read all affected bus documents and validate
            const busReads: { ref: ReturnType<typeof doc>; expected: NetRouteChange }[] = [];

            // Read buses
            Array.from(netChanges.entries()).forEach(([busId, change]) => {
                const busRef = doc(db, "buses", busId);
                busReads.push({ ref: busRef, expected: change });
            });

            // Validate buses (optimistic concurrency check)
            for (const { ref, expected } of busReads) {
                const busDoc = await transaction.get(ref);
                if (!busDoc.exists()) {
                    throw new Error(`Bus ${expected.busLabel} has been deleted`);
                }

                const currentData = busDoc.data();
                const currentRoute = currentData.routeId || null;

                // Check if current state matches expected previous state
                if (currentRoute !== expected.prevRouteId) {
                    const currentRouteName = currentRoute || "None";
                    const expectedName = expected.prevRouteName || "None";
                    throw new Error(
                        `Conflict: ${expected.busLabel} is now on route "${currentRouteName}" ` +
                        `(expected: "${expectedName}"). Data changed externally.`
                    );
                }
            }

            // Step 2: Apply updates
            for (const { ref, expected } of busReads) {
                const routeRef = doc(db, "routes", expected.newRouteId);

                transaction.update(ref, {
                    routeId: expected.newRouteId,
                    routeRef: routeRef,
                    routeName: expected.newRouteName,
                    updatedAt: serverTimestamp(),
                    updatedBy: adminUid,
                });
                updatedBuses.push(expected.busId);
            }
        });

        // Write to Supabase reassignment_logs (outside transaction for performance)
        try {
            await writeRouteAssignmentAuditLog(
                adminUid,
                Array.from(netChanges.values()),
                stagingSnapshot,
                actorInfo
            );
        } catch (auditError) {
            console.warn("Supabase reassignment_logs write failed (non-critical):", auditError);
        }

        return {
            success: true,
            updatedBuses,
        };
    } catch (error: any) {
        console.error("❌ commitNetRouteChanges failed:", error);
        return {
            success: false,
            message: error.message || "Transaction failed",
            conflictDetails: error.message?.includes("Conflict") ? error.message : undefined,
            updatedBuses: [],
        };
    }
}

/**
 * Writes to Supabase reassignment_logs with full change records for rollback.
 */
async function writeRouteAssignmentAuditLog(
    adminUid: string,
    busChanges: NetRouteChange[],
    stagingSnapshot?: StagedRouteOperation[],
    actorInfo?: { name: string; role: string; label?: string }
): Promise<void> {
    const updatedBuses = busChanges.map(c => c.busId);

    // Write to Supabase reassignment_logs with full change records for rollback
    try {
        // Build change records with before/after for rollback support
        const supabaseChanges: ChangeRecord[] = [];

        // Add bus changes with full before/after snapshots
        for (const busChange of busChanges) {
            supabaseChanges.push({
                docPath: `buses/${busChange.busId}`,
                collection: 'buses',
                docId: busChange.busId,
                before: {
                    routeId: busChange.prevRouteId,
                    routeName: busChange.prevRouteName,
                },
                after: {
                    routeId: busChange.newRouteId,
                    routeName: busChange.newRouteName,
                },
            });
        }

        // Generate operation ID
        const operationId = generatePrefixedId('route_reassignment_', 8);

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
        let summary = `Committed ${updatedBuses.length} route assignment(s)`;
        if (busChanges.length === 1) {
            const bc = busChanges[0];
            const prev = bc.prevRouteName && bc.prevRouteName !== 'None' ? bc.prevRouteName : 'No Route';
            const next = bc.newRouteName && bc.newRouteName !== 'None' ? bc.newRouteName : 'No Route';
            summary = `Reassigned ${bc.busLabel}: ${prev} → ${next}`;
        }

        // Write to Supabase via API route (works from client side)
        await writeToSupabaseViaAPI({
            operationId,
            type: 'route_reassignment',
            actorId: adminUid,
            actorLabel,
            status: 'committed',
            summary,
            changes: supabaseChanges,
            meta: {
                busesAffected: updatedBuses,
                busChanges: busChanges.map(c => ({
                    busId: c.busId,
                    busLabel: c.busLabel,
                    fromRoute: c.prevRouteName,
                    toRoute: c.newRouteName,
                })),
                stagingSnapshot: stagingSnapshot || [],
            },
        });
    } catch (supabaseError) {
        // Don't fail the operation if Supabase write fails
        console.warn('⚠️ Supabase reassignment_logs write failed (non-critical):', supabaseError);
    }
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

export interface RouteValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validates staging before opening confirmation modal
 */
export function validateRouteStagingPreCheck(
    stagedOperations: StagedRouteOperation[],
    dbSnapshot: DbRouteSnapshot
): RouteValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { buses, routes } = dbSnapshot;

    // Check: No bus is assigned to more than one route in final state
    const busRouteAssignments = new Map<string, string[]>();

    for (const op of stagedOperations) {
        const existing = busRouteAssignments.get(op.busId) || [];
        existing.push(op.newRouteId);
        busRouteAssignments.set(op.busId, existing);
    }

    Array.from(busRouteAssignments.entries()).forEach(([busId, assignments]) => {
        if (assignments.length > 1) {
            const bus = buses.find(b => b.id === busId);
            const busLabel = bus?.busNumber || busId;
            warnings.push(`Bus ${busLabel} has multiple staged assignments. Only the last one will apply.`);
        }
    });

    // Check: Routes exist
    for (const op of stagedOperations) {
        const route = routes.find(r => r.id === op.newRouteId || r.routeId === op.newRouteId);
        if (!route) {
            errors.push(`Route ${op.newRouteName} (${op.newRouteId}) not found`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}
