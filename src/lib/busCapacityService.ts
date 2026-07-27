/**
 * Bus Capacity Management Service
 * Handles intelligent seat allocation, capacity tracking, and smart bus suggestions
 *
 * DELEGATION LAYER — all Firestore operations replaced with:
 *   - D6 Fleet domain (PostgreSQL buses table) for capacity CRUD
 *   - D1 Identity domain (PostgreSQL users table) for admin/moderator lookups
 *   - D10 Notification domain (PostgreSQL notifications table) for alerts
 *
 * Pure functions (buildCapacityDelta) remain here as a convenience re-export.
 */

import * as fleetService from '@/domains/fleet/services/fleet.service';
import * as identityService from '@/domains/identity/services/identity.service';
import { pgInsertNotification } from '@/domains/notification/repositories/notification.repository.pg';
import { calculateCapacityDelta, getShiftLoad, normalizeShift, areShiftsCompatible } from '@/lib/utils/shift-utils';

export interface BusCapacity {
  busId: string;
  busNumber: string;
  capacity: number;
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

export interface CapacityDelta {
  updates: Record<string, unknown>;
  oldMembers: number;
  newMembers: number;
  capacity: number;
  oldShiftLoad: number;
  newShiftLoad: number;
}

/**
 * Pure & side-effect free: it does NOT read or write any database.
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
 * Reads from PostgreSQL via D6 Fleet domain.
 */
export async function checkBusCapacity(busId: string, shift?: string): Promise<{
  available: boolean;
  currentMembers: number;
  shiftLoad: number;
  capacity: number;
}> {
  try {
    const result = await fleetService.checkBusCapacity(busId, shift);

    console.log(`🔍 Bus ${busId} capacity check:`, {
      shift: shift || 'unspecified',
      shiftLoad: result.shiftLoad,
      currentMembers: result.currentMembers,
      capacity: result.capacity,
      available: result.available,
      display: `${result.shiftLoad}/${result.capacity} (${normalizeShift(shift)} trip)`
    });

    return {
      available: result.available,
      currentMembers: result.currentMembers,
      shiftLoad: result.shiftLoad,
      capacity: result.capacity,
    };
  } catch (error) {
    console.error(`Error checking bus capacity for ${busId}:`, error);
    throw error;
  }
}

/**
 * Increment bus capacity when student is added.
 * Atomic write via PostgreSQL RPC through D6 Fleet domain.
 */
export async function incrementBusCapacity(busId: string, studentUid: string, shift?: string): Promise<void> {
  try {
    const result = await fleetService.incrementBusCapacity(busId, shift);

    if (!result.success) {
      throw new Error(result.error || `Failed to increment capacity for bus ${busId}`);
    }

    console.log(`✅ Bus ${busId} capacity incremented:`, {
      oldDisplay: `${result.oldShiftLoad}/${result.capacity}`,
      newDisplay: `${result.newShiftLoad}/${result.capacity}`,
      studentAdded: studentUid,
      shift: shift || 'not provided'
    });

    if (result.newShiftLoad >= result.capacity) {
      const bus = await fleetService.getBusById(busId);
      await sendBusFullAlert(busId, bus?.busNumber || '', bus?.routeId || '');
    }
  } catch (error) {
    console.error(`Error incrementing bus capacity for ${busId}:`, error);
    throw error;
  }
}

/**
 * Decrement bus capacity when student is removed/expired.
 * Atomic write via PostgreSQL RPC through D6 Fleet domain.
 */
export async function decrementBusCapacity(busId: string, studentUid: string, shift?: string): Promise<void> {
  try {
    const result = await fleetService.decrementBusCapacity(busId, shift);

    if (!result.success) {
      throw new Error(result.error || `Failed to decrement capacity for bus ${busId}`);
    }

    console.log(`✅ Bus ${busId} capacity decremented:`, {
      oldDisplay: `${result.oldShiftLoad}/${result.capacity}`,
      newDisplay: `${result.newShiftLoad}/${result.capacity}`,
      studentRemoved: studentUid,
      shift: shift || 'not provided'
    });
  } catch (error) {
    console.error(`Error decrementing bus capacity for ${busId}:`, error);
    throw error;
  }
}

/**
 * Find alternative buses for a given stop/route.
 * Reads from PostgreSQL via D6 Fleet + D7 Route domains.
 */
export async function findAlternativeBuses(
  stop_name: string,
  routeId: string,
  shift: string
): Promise<AlternativeBusResult> {
  try {
    console.log(`🔍 Finding alternative buses for stop: ${stop_name}, route: ${routeId}, shift: ${shift}`);

    const allBuses = await fleetService.getAllBuses();
    const alternativeBuses: BusCapacity[] = [];

    for (const bus of allBuses) {
      if (bus.routeId === routeId) continue;

      const busShift = bus.shift || 'Both';
      const requestedShift = shift || 'Morning';
      const shiftMatch = areShiftsCompatible(requestedShift, busShift);

      if (!shiftMatch) continue;

      const shiftLoad = getShiftLoad(bus, requestedShift);
      const capacity = bus.capacity || 55;
      const available = shiftLoad < capacity;

      if (available) {
        alternativeBuses.push({
          busId: bus.busId || bus.id || '',
          busNumber: bus.busNumber,
          capacity,
          currentMembers: shiftLoad,
          routeId: bus.routeId || '',
          shift: bus.shift || 'Both',
          isFull: false,
        });
      }
    }

    if (alternativeBuses.length > 0) {
      alternativeBuses.sort((a, b) =>
        (b.capacity - b.currentMembers) - (a.capacity - a.currentMembers)
      );

      return {
        success: true,
        alternativeBuses,
        message: `Found ${alternativeBuses.length} alternative bus(es) that pass through your stop with available seats.`
      };
    }

    console.warn(`⚠️ No alternative buses found for stop ${stop_name}`);
    await sendHighDemandAlert(routeId, stop_name);

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
 * Get admin and moderator UIDs via D1 Identity domain (PostgreSQL users table).
 */
async function getStaffUIDs(): Promise<string[]> {
  const [admins, moderators] = await Promise.all([
    identityService.getUsersByRole('admin'),
    identityService.getUsersByRole('moderator'),
  ]);
  return Array.from(new Set([
    ...admins.map((u: any) => u.uid || u.id),
    ...moderators.map((u: any) => u.uid || u.id),
  ]));
}

/**
 * Send alert to admins when bus is full.
 * Admin/moderator UIDs sourced from D1 Identity domain (PostgreSQL).
 */
export async function sendBusFullAlert(busId: string, busNumber: string, routeId: string): Promise<void> {
  try {
    const recipientUIDs = await getStaffUIDs();
    if (recipientUIDs.length === 0) return;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 1);
    expiryDate.setHours(23, 59, 59, 999);

    const busNum = busId.replace(/[^0-9]/g, '');
    const formattedBus = `Bus-${busNum || busId} (${busNumber})`;
    const routeNum = routeId.replace(/[^0-9]/g, '');
    const formattedRoute = `Route-${routeNum || routeId}`;

    if (recipientUIDs.length > 0) {
      await pgInsertNotification({
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
          specificUserIds: recipientUIDs
        },
        recipientIds: recipientUIDs,
        autoInjectedRecipientIds: [],
        readByUserIds: [],
        expiresAt: expiryDate.toISOString(),
        metadata: {
          busId,
          routeId,
          action: '/admin/buses',
          priority: 'high'
        }
      });
    }

    console.log(`📢 Bus full alert sent to ${recipientUIDs.length} user(s) for bus ${busId}`);
  } catch (error) {
    console.error('Error sending bus full alert:', error);
  }
}

/**
 * Send high-demand alert to admins when no alternatives exist.
 * Admin/moderator UIDs sourced from D1 Identity domain (PostgreSQL).
 */
async function sendHighDemandAlert(routeId: string, stop_name: string): Promise<void> {
  try {
    const allStaffUIDs = await getStaffUIDs();
    if (allStaffUIDs.length === 0) return;

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 1);
    expiryDate.setHours(23, 59, 59, 999);

    await pgInsertNotification({
      title: 'High Demand Alert',
      content: `All buses serving ${stop_name} (${routeId}) are at full capacity. Students are unable to register. Action required: Increase capacity or add buses to this route.`,
      type: 'emergency',
      sender: {
        userId: 'system',
        userName: 'System',
        userRole: 'admin'
      },
      target: {
        type: 'specific_users',
        specificUserIds: allStaffUIDs
      },
      recipientIds: allStaffUIDs,
      autoInjectedRecipientIds: [],
      readByUserIds: [],
      expiresAt: expiryDate.toISOString(),
      metadata: {
        routeId,
        stop_name,
        action: '/admin/buses',
        priority: 'critical'
      }
    });

    console.log(`📢 High-demand alert sent to ${allStaffUIDs.length} staff member(s)`);
  } catch (error) {
    console.error('Error sending high-demand alert:', error);
  }
}

/**
 * Validate and suggest bus for student.
 * Main entry point for smart bus allocation.
 */
export async function validateAndSuggestBus(params: {
  routeId: string;
  stop_name: string;
  shift: string;
}): Promise<{
  canAssign: boolean;
  busId?: string;
  message: string;
  alternatives?: BusCapacity[];
  requiresAdminAttention?: boolean;
}> {
  try {
    const { routeId, stop_name, shift } = params;
    const busId = routeId.replace('route_', 'bus_');

    const capacityCheck = await checkBusCapacity(busId, shift);

    if (capacityCheck.available) {
      return {
        canAssign: true,
        busId,
        message: `Seat available on Bus ${busId} (${capacityCheck.shiftLoad}/${capacityCheck.capacity} on ${normalizeShift(shift)} trip)`
      };
    }

    console.log(`🔄 Primary bus ${busId} is full for ${normalizeShift(shift)} (${capacityCheck.shiftLoad}/${capacityCheck.capacity}), searching alternatives...`);

    const alternativeResult = await findAlternativeBuses(stop_name, routeId, shift);

    if (alternativeResult.success && alternativeResult.alternativeBuses && alternativeResult.alternativeBuses.length > 0) {
      return {
        canAssign: false,
        message: `Bus ${busId} is full for the ${normalizeShift(shift)} trip (${capacityCheck.shiftLoad}/${capacityCheck.capacity}). However, ${alternativeResult.message}`,
        alternatives: alternativeResult.alternativeBuses
      };
    }

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
