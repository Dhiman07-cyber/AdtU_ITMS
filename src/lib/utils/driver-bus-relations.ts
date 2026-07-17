/**
 * Driver-Bus Relationship Helpers
 * 
 * Canonical helpers for resolving driver↔bus relationships.
 * Eliminates duplicated logic across components and API routes.
 * 
 * Canonical field mapping (PostgreSQL):
 * - Bus: driverUID (assigned), activeDriverId (temporary swap), assignedDriverId (permanent)
 * - Driver: assignedBusId, busId, busAssigned
 */

import { getBusById, getAllBuses } from '@/domains/fleet';
import { getDriverById } from '@/domains/identity';

/**
 * Get the effective driver for a bus.
 * Checks activeDriverId first (temporary swap), then assignedDriverId (permanent), then driverUID.
 * 
 * @param busData - Bus document/object data
 * @returns Driver UID or null if no driver assigned
 */
export function getEffectiveDriverId(busData: { assignedDriverId?: string; activeDriverId?: string; driverUID?: string } | null | undefined): string | null {
    if (!busData) return null;
    return busData.activeDriverId || busData.assignedDriverId || busData.driverUID || null;
}

/**
 * Get the effective bus for a driver.
 * Checks assignedBusId (canonical), falls back to busId or busAssigned.
 * 
 * @param driverData - Driver document/object data
 * @returns Bus ID or null if no bus assigned
 */
export function getEffectiveBusId(driverData: { assignedBusId?: string; busId?: string; busAssigned?: string; assignedBusIds?: string[] } | null | undefined): string | null {
    if (!driverData) return null;
    return driverData.assignedBusId || driverData.busId || driverData.busAssigned || (driverData.assignedBusIds?.[0] || null) || null;
}

/**
 * Check if a driver is assigned to a bus (permanent or temporary).
 * 
 * @param driverId - Driver UID
 * @param busId - Bus ID
 * @param busData - Optional bus object data (avoids extra read if already fetched)
 * @returns True if driver is assigned to bus
 */
export async function isDriverAssignedToBus(
    driverId: string,
    busId: string,
    busData?: { assignedDriverId?: string; activeDriverId?: string; driverUID?: string } | null
): Promise<boolean> {
    if (!busData) {
        busData = await getBusById(busId);
        if (!busData) return false;
    }
    const effectiveDriverId = getEffectiveDriverId(busData);
    return effectiveDriverId === driverId;
}

/**
 * Check if a bus is assigned to a driver (permanent or temporary).
 * 
 * @param busId - Bus ID
 * @param driverId - Driver UID
 * @param driverData - Optional driver object data (avoids extra read if already fetched)
 * @returns True if bus is assigned to driver
 */
export async function isBusAssignedToDriver(
    busId: string,
    driverId: string,
    driverData?: { assignedBusId?: string; busId?: string; busAssigned?: string; assignedBusIds?: string[] } | null
): Promise<boolean> {
    if (!driverData) {
        driverData = await getDriverById(driverId);
        if (!driverData) return false;
    }
    const effectiveBusId = getEffectiveBusId(driverData);
    return effectiveBusId === busId;
}

/**
 * Verify driver-bus binding for authorization.
 * Used in trip start, location updates, and other driver operations.
 * 
 * @param driverId - Driver UID
 * @param busId - Bus ID
 * @returns { authorized: boolean; reason?: string }
 */
export async function verifyDriverBusBinding(
    driverId: string,
    busId: string
): Promise<{ authorized: boolean; reason?: string }> {
    try {
        // Check bus for driver assignment
        const busData = await getBusById(busId);
        if (!busData) return { authorized: false, reason: 'Bus not found' };

        const effectiveDriverId = getEffectiveDriverId(busData);
        if (effectiveDriverId === driverId) return { authorized: true };

        // Fallback: check driver for bus assignment
        const driverData = await getDriverById(driverId);
        if (!driverData) return { authorized: false, reason: 'Driver not found' };

        const effectiveBusId = getEffectiveBusId(driverData);
        if (effectiveBusId === busId) return { authorized: true };

        return { authorized: false, reason: 'Driver is not assigned to this bus' };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Driver authorization failed';
        console.error('Error verifying driver-bus binding:', message);
        return { authorized: false, reason: message };
    }
}

/**
 * Get all buses where a driver is the effective driver (permanent or temporary).
 * Used for driver dashboards and assignment views.
 * 
 * @param driverId - Driver UID
 * @returns Array of bus IDs
 */
export async function getBusesForDriver(driverId: string): Promise<string[]> {
    try {
        const buses = await getAllBuses();
        const busIds = new Set<string>();
        for (const bus of buses) {
            if (bus.driverUID === driverId || (bus as any).assignedDriverId === driverId || (bus as any).activeDriverId === driverId) {
                busIds.add(bus.id);
            }
        }
        return Array.from(busIds);
    } catch (error) {
        console.error('Error getting buses for driver:', error);
        return [];
    }
}

// Re-export canonical shift utilities from shift-utils.ts
export { normalizeShift, areShiftsCompatible } from '@/lib/utils/shift-utils';