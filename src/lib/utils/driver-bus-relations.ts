/**
 * Driver-Bus Relationship Helpers
 * 
 * Canonical helpers for resolving driver↔bus relationships.
 * Eliminates duplicated logic across components and API routes.
 * 
 * Canonical field mapping (Firestore):
 * - Bus document: assignedDriverId (permanent), activeDriverId (temporary swap)
 * - Driver document: assignedBusId (permanent), busId (legacy alias)
 * 
 * These helpers use the canonical fields and provide fallbacks for legacy data.
 */

import { adminDb } from '@/lib/firebase-admin';

/**
 * Get the effective driver for a bus.
 * Checks activeDriverId first (temporary swap), then assignedDriverId (permanent).
 * 
 * @param busData - Bus document data
 * @returns Driver UID or null if no driver assigned
 */
export function getEffectiveDriverId(busData: { assignedDriverId?: string; activeDriverId?: string; driverUID?: string } | null | undefined): string | null {
    if (!busData) return null;
    // activeDriverId takes precedence (temporary assignment from swap)
    return busData.activeDriverId || busData.assignedDriverId || busData.driverUID || null;
}

/**
 * Get the effective bus for a driver.
 * Checks assignedBusId (canonical), falls back to busId (legacy).
 * 
 * @param driverData - Driver document data
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
 * @param busData - Optional bus document data (avoids extra read if already fetched)
 * @returns True if driver is assigned to bus
 */
export async function isDriverAssignedToBus(
    driverId: string,
    busId: string,
    busData?: { assignedDriverId?: string; activeDriverId?: string; driverUID?: string } | null
): Promise<boolean> {
    if (!busData && adminDb) {
        const busDoc = await adminDb.collection('buses').doc(busId).get();
        if (!busDoc.exists) return false;
        busData = busDoc.data() as any;
    }
    const effectiveDriverId = getEffectiveDriverId(busData);
    return effectiveDriverId === driverId;
}

/**
 * Check if a bus is assigned to a driver (permanent or temporary).
 * 
 * @param busId - Bus ID
 * @param driverId - Driver UID
 * @param driverData - Optional driver document data (avoids extra read if already fetched)
 * @returns True if bus is assigned to driver
 */
export async function isBusAssignedToDriver(
    busId: string,
    driverId: string,
    driverData?: { assignedBusId?: string; busId?: string; busAssigned?: string; assignedBusIds?: string[] } | null
): Promise<boolean> {
    if (!driverData && adminDb) {
        const driverDoc = await adminDb.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) return false;
        driverData = driverDoc.data() as any;
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
    if (!adminDb) return { authorized: false, reason: 'Firebase Admin not initialized' };

    try {
        // Check bus document for driver assignment
        const busDoc = await adminDb.collection('buses').doc(busId).get();
        if (!busDoc.exists) return { authorized: false, reason: 'Bus not found' };

        const busData = busDoc.data();
        const effectiveDriverId = getEffectiveDriverId(busData);
        
        if (effectiveDriverId === driverId) return { authorized: true };

        // Fallback: check driver document for bus assignment
        const driverDoc = await adminDb.collection('drivers').doc(driverId).get();
        if (!driverDoc.exists) return { authorized: false, reason: 'Driver not found' };

        const driverData = driverDoc.data();
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
    if (!adminDb) return [];

    // Check for temporary assignments (activeDriverId)
    const tempBusesSnap = await adminDb.collection('buses')
        .where('activeDriverId', '==', driverId)
        .get();

    // Check for permanent assignments (assignedDriverId)
    const permBusesSnap = await adminDb.collection('buses')
        .where('assignedDriverId', '==', driverId)
        .get();

    const busIds = new Set<string>();
    tempBusesSnap.docs.forEach(doc => busIds.add(doc.id));
    permBusesSnap.docs.forEach(doc => busIds.add(doc.id));

    return Array.from(busIds);
}

// Re-export canonical shift utilities from shift-utils.ts
export { normalizeShift, areShiftsCompatible } from '@/lib/utils/shift-utils';