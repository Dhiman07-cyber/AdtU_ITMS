/**
 * Bus Capacity Management Service
 * Handles intelligent seat allocation, capacity tracking, and smart bus suggestions
 */

import { adminDb } from './firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { calculateCapacityDelta, getShiftDeltas, getShiftLoad, normalizeShift, areShiftsCompatible } from '@/lib/utils/shift-utils';

export interface BusCapacity {
  busId: string;
  busNumber: string;
  capacity: number; // Max seats/capacity
  currentMembers: number;
  routeId: string;
  shift: string;
  isFull: boolean;
}

export interface AlternativeBusResult {
  success: boolean;
  alternativeBuses?: BusCapacity[];
  message: string;
  adminAlert?: boolean;
}

/**
 * Result of computing a single-student capacity mutation against a bus document.
 */
export interface CapacityDelta {
  /** Field-path updates to apply to the bus document (caller writes inside its own transaction). */
  updates: Record<string, unknown>;
  /** currentMembers before the mutation (derived statistic — NOT a capacity gate). */
  oldMembers: number;
  /** currentMembers after the mutation (derived statistic — NOT a capacity gate). */
  newMembers: number;
  /** The bus capacity ceiling (seats in ONE trip). */
  capacity: number;
  /** Per-shift occupancy of the affected trip BEFORE the mutation. Gate on this. */
  oldShiftLoad: number;
  /** Per-shift occupancy of the affected trip AFTER the mutation. */
  newShiftLoad: number;
}

/**
 * SINGLE SOURCE OF TRUTH for how adding/removing ONE student maps onto a bus
 * document's counters. Every admin-SDK capacity mutation — approval, admin-create,
 * soft block, hard delete, manual delete, late renewal — must derive its bus
 * writes from this function so the count math can never diverge across flows.
 *
 * `sign = 1` adds a student (increment), `sign = -1` removes one (decrement).
 *
 * Pure & side-effect free: it does NOT read or write Firestore. Callers fetch the
 * bus inside a transaction, pass `busDoc.data()` here, and apply `updates`.
 *
 * CANONICAL CAPACITY MODEL (per-shift): capacity gates the affected trip only.
 * Callers MUST gate on `oldShiftLoad >= capacity` (add) — NOT on `oldMembers`.
 * `currentMembers` remains a derived statistic kept in sync here.
 *
 * Invariant produced: currentMembers === morningCount + eveningCount, and a single-shift
 * student moves exactly one of morningCount/eveningCount.
 *
 * Delegates to the canonical calculateCapacityDelta from shift-utils.ts.
 */
export function buildCapacityDelta(
  busData: Record<string, any> | undefined,
  shift: string | undefined,
  sign: 1 | -1
): CapacityDelta {
  const result = calculateCapacityDelta(busData, shift, sign);
  const oldMembers = busData?.currentMembers || 0;

  return {
    updates: result.updates,
    oldMembers,
    newMembers: result.newMembers,
    capacity: result.capacity,
    oldShiftLoad: result.oldShiftLoad,
    newShiftLoad: result.newShiftLoad,
  };
}

/**
 * Check if a bus has an available seat for the given shift's trip.
 *
 * Per-shift capacity model: availability is gated on the affected trip's counter
 * (morningCount or eveningCount) against capacity — NOT on currentMembers.
 * `currentMembers` in the return is the derived total statistic (for display).
 *
 * @param busId - Bus document id
 * @param shift - Student's shift; when omitted, falls back to the larger trip load
 *                so a bus is only "available" if BOTH trips have room.
 */
export async function checkBusCapacity(busId: string, shift?: string): Promise<{
  available: boolean;
  currentMembers: number;
  shiftLoad: number;
  capacity: number;
}> {
  try {
    const busDoc = await adminDb.collection('buses').doc(busId).get();

    if (!busDoc.exists) {
      throw new Error(`Bus ${busId} not found`);
    }

    const busData = busDoc.data();
    const currentMembers = busData?.currentMembers || 0;
    const capacity = busData?.capacity || 55;

    // Gate on the affected trip only (per-shift model).
    const shiftLoad = getShiftLoad(busData, shift);
    const available = shiftLoad < capacity;

    console.log(`🔍 Bus ${busId} capacity check:`, {
      shift: shift || 'unspecified',
      shiftLoad,
      currentMembers,
      capacity,
      available,
      display: `${shiftLoad}/${capacity} (${normalizeShift(shift)} trip)`
    });

    return {
      available,
      currentMembers,
      shiftLoad,
      capacity
    };
  } catch (error) {
    console.error(`Error checking bus capacity for ${busId}:`, error);
    throw error;
  }
}

/**
 * Increment bus capacity when student is added
 */
export async function incrementBusCapacity(busId: string, studentUid: string, shift?: string): Promise<void> {
  try {
    const busRef = adminDb.collection('buses').doc(busId);

    let oldMembers = 0;
    let newMembers = 0;
    let newShiftLoad = 0;
    let capacity = 55;
    let busNumber: string | undefined;
    let routeId: string | undefined;

    // Atomic read-modify-write inside a transaction eliminates the lost-update
    // race between concurrent approvals/additions on the same bus.
    await adminDb.runTransaction(async (transaction) => {
      const busDoc = await transaction.get(busRef);
      if (!busDoc.exists) {
        throw new Error(`Bus ${busId} not found`);
      }

      const busData = busDoc.data();
      const delta = buildCapacityDelta(busData, shift, 1);
      oldMembers = delta.oldMembers;
      newMembers = delta.newMembers;
      newShiftLoad = delta.newShiftLoad;
      capacity = delta.capacity;
      busNumber = busData?.busNumber;
      routeId = busData?.routeId;

      transaction.update(busRef, delta.updates);
    });

    console.log(`✅ Bus ${busId} capacity incremented:`, {
      oldDisplay: `${oldMembers}/${capacity}`,
      newDisplay: `${newMembers}/${capacity}`,
      studentAdded: studentUid,
      shift: shift || 'not provided'
    });

    // Send admin alert once the affected shift's trip fills (per-shift model).
    if (newShiftLoad >= capacity) {
      await sendBusFullAlert(busId, busNumber || '', routeId || '');
    }
  } catch (error) {
    console.error(`Error incrementing bus capacity for ${busId}:`, error);
    throw error;
  }
}

/**
 * Decrement bus capacity when student is removed/expired
 */
export async function decrementBusCapacity(busId: string, studentUid: string, shift?: string): Promise<void> {
  try {
    const busRef = adminDb.collection('buses').doc(busId);

    let oldMembers = 0;
    let newMembers = 0;
    let capacity = 55;

    // Atomic read-modify-write inside a transaction eliminates the lost-update
    // race between concurrent removals (soft block / hard delete / manual delete).
    await adminDb.runTransaction(async (transaction) => {
      const busDoc = await transaction.get(busRef);
      if (!busDoc.exists) {
        throw new Error(`Bus ${busId} not found`);
      }

      const busData = busDoc.data();
      const delta = buildCapacityDelta(busData, shift, -1);
      oldMembers = delta.oldMembers;
      newMembers = delta.newMembers;
      capacity = delta.capacity;

      transaction.update(busRef, delta.updates);
    });

    console.log(`✅ Bus ${busId} capacity decremented:`, {
      oldDisplay: `${oldMembers}/${capacity}`,
      newDisplay: `${newMembers}/${capacity}`,
      studentRemoved: studentUid,
      shift: shift || 'not provided'
    });
  } catch (error) {
    console.error(`Error decrementing bus capacity for ${busId}:`, error);
    throw error;
  }
}

/**
 * Find alternative buses for a given stop/route
 */
export async function findAlternativeBuses(
  stopId: string,
  routeId: string,
  shift: string
): Promise<AlternativeBusResult> {
  try {
    console.log(`🔍 Finding alternative buses for stop: ${stopId}, route: ${routeId}, shift: ${shift}`);

    // Get all buses from Firestore
    const busesSnapshot = await adminDb.collection('buses').get();
    const allBuses = busesSnapshot.docs.map((doc: any) => ({
      busId: doc.id,
      ...doc.data()
    }));

    // Filter buses that pass through this stop and have available seats
    const alternativeBuses: BusCapacity[] = [];

    for (const bus of allBuses) {
      // Skip the originally requested route's bus
      if (bus.routeId === routeId) continue;

      // Check shift compatibility using canonical shift-utils
      const busShift = bus.shift || 'Both';
      const requestedShift = shift || 'Morning';
      const shiftMatch = areShiftsCompatible(requestedShift, busShift);

      if (!shiftMatch) continue;

      // Check if bus route passes through the requested stop
      const route = bus.route;
      if (!route || !route.stops) continue;

      const passesThrough = route.stops.some((stop: any) =>
        stop.stopId === stopId || stop.name === stopId
      );

      if (!passesThrough) continue;

      // Check capacity for the requested shift's trip only (per-shift model).
      const shiftLoad = getShiftLoad(bus, requestedShift);
      const capacity = bus.capacity || 55;
      const available = shiftLoad < capacity;

      if (available) {
        alternativeBuses.push({
          busId: bus.busId,
          busNumber: bus.busNumber,
          capacity: capacity,
          currentMembers: shiftLoad,
          routeId: bus.routeId,
          shift: bus.shift,
          isFull: false
        });
      }
    }

    // If alternative buses found
    if (alternativeBuses.length > 0) {
      // Sort by most available seats on the requested trip
      alternativeBuses.sort((a, b) =>
        (b.capacity - b.currentMembers) - (a.capacity - a.currentMembers)
      );

      return {
        success: true,
        alternativeBuses,
        message: `Found ${alternativeBuses.length} alternative bus(es) that pass through your stop with available seats.`
      };
    }

    // No alternatives found - this is critical, trigger admin alert
    console.warn(`⚠️ No alternative buses found for stop ${stopId}`);

    // Send high-demand alert to admins
    await sendHighDemandAlert(routeId, stopId);

    return {
      success: false,
      message: 'All buses serving your area are currently full. An administrator has been notified and will assist you shortly.',
      adminAlert: true
    };
  } catch (error) {
    console.error('Error finding alternative buses:', error);
    return {
      success: false,
      message: 'Unable to find alternative buses at this time. Please contact support.'
    };
  }
}

/**
 * Send alert to admins when bus is full.
 * Exported so callers that mutate capacity inside their own transaction can fire
 * this post-commit (it performs its own batched notification write and must never
 * run inside a capacity transaction).
 */
export async function sendBusFullAlert(busId: string, busNumber: string, routeId: string): Promise<void> {
  try {
    // Get all admins and moderators
    const [adminsSnapshot, moderatorsSnapshot] = await Promise.all([
      adminDb.collection('admins').get(),
      adminDb.collection('moderators').get()
    ]);

    const adminUIDs = adminsSnapshot.docs.map((doc: any) => doc.id);
    const moderatorUIDs = moderatorsSnapshot.docs.map((doc: any) => doc.id);
    const recipientUIDs = Array.from(new Set([...adminUIDs, ...moderatorUIDs]));

    if (recipientUIDs.length === 0) return;

    // Calculate expiry (1 day from now)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 1);
    expiryDate.setHours(23, 59, 59, 999);

    // Format bus and route nicely: Bus-X (AS-01-...) on Route-X
    const busNum = busId.replace(/[^0-9]/g, '');
    const formattedBus = `Bus-${busNum || busId} (${busNumber})`;
    const routeNum = routeId.replace(/[^0-9]/g, '');
    const formattedRoute = `Route-${routeNum || routeId}`;

    // Send notification to all admins and moderators (chunk batches to avoid >500 limit)
    for (let i = 0; i < recipientUIDs.length; i += 490) {
      const chunk = recipientUIDs.slice(i, i + 490);
      const batch = adminDb.batch();
      chunk.forEach((userId) => {
        const notifRef = adminDb.collection('notifications').doc();
        batch.set(notifRef, {
          title: 'Bus Capacity Full',
          content: `${formattedBus} on ${formattedRoute} has reached full capacity. Consider increasing capacity or adding another bus.`,
          type: 'info',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [userId]
          },
          recipientIds: [userId],
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          isEdited: false,
          isDeletedGlobally: false,
          hiddenForUserIds: [],
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: expiryDate.toISOString(),
          metadata: {
            busId,
            routeId,
            action: '/admin/buses',
            priority: 'high'
          }
        });
      });
      await batch.commit();
    }

    console.log(`📢 Bus full alert sent to ${recipientUIDs.length} user(s) (admins & moderators) for bus ${busId}`);
  } catch (error) {
    console.error('Error sending bus full alert:', error);
  }
}

/**
 * Send high-demand alert to admins when no alternatives exist
 */
async function sendHighDemandAlert(routeId: string, stopId: string): Promise<void> {
  try {
    // Get all admins and moderators
    const adminsSnapshot = await adminDb.collection('admins').get();
    const moderatorsSnapshot = await adminDb.collection('moderators').get();

    const allStaffUIDs = [
      ...adminsSnapshot.docs.map((doc: any) => doc.id),
      ...moderatorsSnapshot.docs.map((doc: any) => doc.id)
    ];

    if (allStaffUIDs.length === 0) return;

    // Calculate expiry (1 day from now)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 1);
    expiryDate.setHours(23, 59, 59, 999);

    // Send to all admins and moderators (chunk batches to avoid >500 limit)
    for (let i = 0; i < allStaffUIDs.length; i += 490) {
      const chunk = allStaffUIDs.slice(i, i + 490);
      const batch = adminDb.batch();
      chunk.forEach((staffId) => {
        const notifRef = adminDb.collection('notifications').doc();
        batch.set(notifRef, {
          title: 'High Demand Alert',
          content: `All buses serving ${stopId} (${routeId}) are at full capacity. Students are unable to register. Action required: Increase capacity or add buses to this route.`,
          type: 'emergency',
          sender: {
            userId: 'system',
            userName: 'System',
            userRole: 'admin'
          },
          target: {
            type: 'specific_users',
            specificUserIds: [staffId]
          },
          recipientIds: [staffId],
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          isEdited: false,
          isDeletedGlobally: false,
          hiddenForUserIds: [],
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: expiryDate.toISOString(),
          metadata: {
            routeId,
            stopId,
            action: '/admin/buses',
            priority: 'critical'
          }
        });
      });
      await batch.commit();
    }

    console.log(`📢 High-demand alert sent to ${allStaffUIDs.length} staff member(s)`);
  } catch (error) {
    console.error('Error sending high-demand alert:', error);
  }
}

/**
 * Validate and suggest bus for student
 * Main entry point for smart bus allocation
 */
export async function validateAndSuggestBus(params: {
  routeId: string;
  stopId: string;
  shift: string;
}): Promise<{
  canAssign: boolean;
  busId?: string;
  message: string;
  alternatives?: BusCapacity[];
  requiresAdminAttention?: boolean;
}> {
  try {
    const { routeId, stopId, shift } = params;

    // Derive busId from routeId (route_X → bus_X)
    const busId = routeId.replace('route_', 'bus_');

    // Check if primary bus has capacity on the requested shift's trip
    const capacityCheck = await checkBusCapacity(busId, shift);

    if (capacityCheck.available) {
      return {
        canAssign: true,
        busId,
        message: `Seat available on Bus ${busId} (${capacityCheck.shiftLoad}/${capacityCheck.capacity} on ${normalizeShift(shift)} trip)`
      };
    }

    // Primary bus full for this shift, find alternatives
    console.log(`🔄 Primary bus ${busId} is full for ${normalizeShift(shift)} (${capacityCheck.shiftLoad}/${capacityCheck.capacity}), searching alternatives...`);

    const alternativeResult = await findAlternativeBuses(stopId, routeId, shift);

    if (alternativeResult.success && alternativeResult.alternativeBuses && alternativeResult.alternativeBuses.length > 0) {
      return {
        canAssign: false, // Don't auto-assign, let user choose
        message: `Bus ${busId} is full for the ${normalizeShift(shift)} trip (${capacityCheck.shiftLoad}/${capacityCheck.capacity}). However, ${alternativeResult.message}`,
        alternatives: alternativeResult.alternativeBuses
      };
    }

    // No alternatives found - critical situation
    return {
      canAssign: false,
      message: alternativeResult.message,
      requiresAdminAttention: true
    };
  } catch (error) {
    console.error('Error in validateAndSuggestBus:', error);
    return {
      canAssign: false,
      message: 'Unable to validate bus capacity. Please try again or contact support.'
    };
  }
}
