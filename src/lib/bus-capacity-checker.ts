import { normalizeShift } from '@/lib/utils/shift-utils';

export interface BusCapacityInfo {
  busId: string;
  busNumber: string;
  capacity: number;
  currentMembers: number;
  availableSeats: number;
  isFull: boolean;
  routeId: string;
  routeName: string;
}

export interface CapacityCheckResult {
  selectedBus: BusCapacityInfo | null;
  isFull: boolean;
  alternativeBuses: BusCapacityInfo[];
  hasAlternatives: boolean;
  canProceed: boolean;
  message: string;
  requiresAdminNotification: boolean;
  needsCapacityReview: boolean;
  isNearCapacity: boolean;
  capacityPercentage: number;
  reassignmentReason?: 'bus_full_only_option' | 'bus_full_alternatives_exist' | 'no_issue';
}

/**
 * Checks if a specific bus has available capacity.
 * Calls GET /api/buses/capacity server-side (PostgreSQL).
 */
export async function checkBusCapacity(busId: string, shift?: string): Promise<BusCapacityInfo | null> {
  try {
    const params = new URLSearchParams({ busId });
    if (shift) params.set('shift', shift);

    const response = await fetch(`/api/buses/capacity?${params.toString()}`);
    if (!response.ok) {
      console.error('Capacity check failed:', response.statusText);
      return null;
    }

    const data = await response.json();

    return {
      busId: data.busId,
      busNumber: data.busNumber || busId,
      capacity: data.capacity,
      currentMembers: data.currentMembers,
      availableSeats: data.availableSeats,
      isFull: data.isFull,
      routeId: data.routeId || '',
      routeName: data.routeName || '',
    };
  } catch (error) {
    console.error('Error checking bus capacity:', error);
    return null;
  }
}

/**
 * Comprehensive capacity check for new application.
 * Calls POST /api/buses/capacity server-side (PostgreSQL).
 */
export async function checkCapacityForApplication(
  routeId: string,
  stopId: string,
  stopName: string,
  selectedBusId?: string,
  shift?: string
): Promise<CapacityCheckResult> {
  try {
    const response = await fetch('/api/buses/capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId, stopId, stopName, busId: selectedBusId, shift }),
    });

    if (!response.ok) {
      console.error('Capacity check failed:', response.statusText);
      return {
        selectedBus: null,
        isFull: false,
        alternativeBuses: [],
        hasAlternatives: false,
        canProceed: true,
        message: 'Unable to check bus capacity. Please proceed with application.',
        requiresAdminNotification: false,
        needsCapacityReview: false,
        isNearCapacity: false,
        capacityPercentage: 0,
      };
    }

    return await response.json();
  } catch (error) {
    console.error('Error in capacity check:', error);
    return {
      selectedBus: null,
      isFull: false,
      alternativeBuses: [],
      hasAlternatives: false,
      canProceed: true,
      message: 'Unable to check bus capacity. Please proceed with application.',
      requiresAdminNotification: false,
      needsCapacityReview: false,
      isNearCapacity: false,
      capacityPercentage: 0,
    };
  }
}

/**
 * Creates an admin notification for overloaded bus.
 */
export async function createOverloadNotification(
  studentName: string,
  enrollmentId: string,
  busInfo: BusCapacityInfo,
  stopName: string
): Promise<boolean> {
  try {
    const response = await fetch('/api/notifications/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'announcement',
        title: 'Bus Capacity Alert - Overloaded Bus Request',
        content: `**Student Application Alert**\n\n` +
          `**Student:** ${studentName} (${enrollmentId})\n` +
          `**Bus:** ${busInfo.busNumber} (${busInfo.busId})\n` +
          `**Stop:** ${stopName}\n` +
          `**Status:** Bus is currently at FULL capacity (${busInfo.currentMembers}/${busInfo.capacity})\n\n` +
          `**Action Required:** Please review capacity reallocation or consider adding additional bus service for this route.\n\n` +
          `[View Smart Allocation](/admin/smart-allocation)`,
        targetType: 'all_admins_moderators',
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error creating overload notification:', error);
    return false;
  }
}

/**
 * Creates an admin notification for near-capacity bus (>95%).
 */
export async function createNearCapacityNotification(
  studentName: string,
  enrollmentId: string,
  busInfo: BusCapacityInfo,
  stopName: string,
  currentPercentage: number,
  futurePercentage: number
): Promise<boolean> {
  try {
    const futureMembers = busInfo.currentMembers + 1;
    const futureAvailableSeats = busInfo.capacity - futureMembers;

    const response = await fetch('/api/notifications/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'announcement',
        title: 'Bus Near Capacity - High Utilization Alert',
        content: `**New Student Enrollment - Capacity Warning**\n\n` +
          `**Student:** ${studentName} (${enrollmentId})\n` +
          `**Bus:** ${busInfo.busNumber} (${busInfo.busId})\n` +
          `**Stop:** ${stopName}\n\n` +
          `**Current Capacity:**\n` +
          `• Occupancy: ${busInfo.currentMembers}/${busInfo.capacity} seats (${currentPercentage.toFixed(1)}%)\n` +
          `• Available: ${busInfo.availableSeats} seat(s)\n\n` +
          `**After Enrollment:**\n` +
          `• Occupancy: ${futureMembers}/${busInfo.capacity} seats (${futurePercentage.toFixed(1)}%)\n` +
          `• Available: ${futureAvailableSeats} seat(s)\n\n` +
          `**Recommended Action:** Review bus allocation and consider capacity expansion if trend continues.\n\n` +
          `[View Smart Allocation](/admin/smart-allocation)`,
        targetType: 'all_admins_moderators',
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error creating near-capacity notification:', error);
    return false;
  }
}
