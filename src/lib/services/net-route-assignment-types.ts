/**
 * Net Route Assignment Types & Algorithm
 *
 * Extracted from net-route-assignment-service.ts to decouple type definitions
 * and the pure computeNetRouteAssignments algorithm from the legacy Firestore
 * commit functions (which are now dead code).
 *
 * All exports here are pure types or pure functions with zero
 * Firestore SDK dependencies.
 */

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
    busLabel: string;
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
    change: number;
}

export interface RouteConfirmationTableRow {
    slNo: number;
    busAffected: string;
    busCode: string;
    previousRoute: string;
    newRoute: string;
    stops: string;
    impact: string;
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

export interface RouteValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
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
 */
export function computeNetRouteAssignments(
    stagedOperations: StagedRouteOperation[],
    dbSnapshot: DbRouteSnapshot
): ComputeNetRouteAssignmentsResult {
    const { buses, routes } = dbSnapshot;
    const removedNoOpInfo: string[] = [];

    const initialBusRoute = new Map<string, string | null>();
    const initialRouteBusCount = new Map<string, number>();

    for (const route of routes) {
        initialRouteBusCount.set(route.id, 0);
        if (route.routeId) {
            initialRouteBusCount.set(route.routeId, 0);
        }
    }

    for (const bus of buses) {
        initialBusRoute.set(bus.id, bus.routeId);
        if (bus.routeId) {
            const count = initialRouteBusCount.get(bus.routeId) || 0;
            initialRouteBusCount.set(bus.routeId, count + 1);
        }
    }

    const busFinalRoute = new Map<string, string>();
    const routeBusCount = new Map(initialRouteBusCount);
    const confirmationRows: RouteConfirmationTableRow[] = [];
    const netChanges = new Map<string, NetRouteChange>();
    const removedNoOps: string[] = [];
    let slNo = 1;

    for (const op of stagedOperations) {
        const currentRoute = busFinalRoute.get(op.busId) ?? initialBusRoute.get(op.busId) ?? null;

        if (currentRoute === op.newRouteId) {
            removedNoOpInfo.push(`Bus ${op.busNumber}: already on ${op.newRouteName}`);
            removedNoOps.push(op.id);
            continue;
        }

        // Decrement old route count
        if (currentRoute && routeBusCount.has(currentRoute)) {
            routeBusCount.set(currentRoute, (routeBusCount.get(currentRoute) || 1) - 1);
        }

        // Set new route
        busFinalRoute.set(op.busId, op.newRouteId);
        routeBusCount.set(op.newRouteId, (routeBusCount.get(op.newRouteId) || 0) + 1);

        const oldRouteName = getRouteName(currentRoute, routes);
        const prevCount = initialRouteBusCount.get(currentRoute) || 0;
        const newCount = routeBusCount.get(op.newRouteId) || 0;

        const busNum = op.busId.replace(/[^0-9]/g, '') || '?';
        const busLabel = `Bus-${busNum} (${op.busNumber})`;

        confirmationRows.push({
            slNo: slNo++,
            busAffected: busLabel,
            busCode: op.busCode,
            previousRoute: oldRouteName,
            newRoute: op.newRouteName,
            stops: `${op.newStopCount} stops`,
            impact: `${op.newRouteName}: ${newCount} bus(es)`,
            status: 'pending',
            infoTooltip: `${busLabel}: ${oldRouteName} → ${op.newRouteName}`,
        });
    }

    // Build netChanges
    for (const [busId, newRouteId] of busFinalRoute) {
        const prevRouteId = initialBusRoute.get(busId) ?? null;
        if (prevRouteId !== newRouteId) {
            const bus = buses.find(b => b.id === busId);
            const busNum = busId.replace(/[^0-9]/g, '') || '?';
            const busLabel = bus ? `${bus.busNumber}` : busId;
            const prevRoute = routes.find(r => r.id === prevRouteId || r.routeId === prevRouteId);
            const newRoute = routes.find(r => r.id === newRouteId || r.routeId === newRouteId);
            const op = stagedOperations.find(o => o.busId === busId);

            netChanges.set(busId, {
                busId,
                busLabel,
                busCode: op?.busCode || busId,
                prevRouteId,
                prevRouteName: prevRoute?.routeName || null,
                newRouteId,
                newRouteName: newRoute?.routeName || 'Unknown',
                newStopCount: op?.newStopCount || 0,
            });
        }
    }

    // Compute route impacts
    const routeImpacts = new Map<string, RouteImpact>();
    for (const [routeId, newCount] of routeBusCount) {
        const prevCount = initialRouteBusCount.get(routeId) || 0;
        if (newCount !== prevCount) {
            const route = routes.find(r => r.id === routeId || r.routeId === routeId);
            routeImpacts.set(routeId, {
                routeId,
                routeName: route?.routeName || 'Unknown',
                previousBusCount: prevCount,
                newBusCount: newCount,
                change: newCount - prevCount,
            });
        }
    }

    return {
        netChanges,
        routeImpacts,
        confirmationRows,
        hasChanges: netChanges.size > 0,
        removedNoOpCount: removedNoOps.length,
        removedNoOpInfo,
    };
}

// ============================================
// VALIDATION FUNCTIONS
// ============================================

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
