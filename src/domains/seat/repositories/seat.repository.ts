/**
 * D8 Seat Repository (capacity + reassignment persistence)
 *
 * Persistence only — no business logic.
 *
 * Capacity operations delegate to D6 Fleet domain (PostgreSQL buses table).
 * Route stop matching delegates to D7 Route domain (PostgreSQL routes table).
 * Zero Firestore reads.
 */
import * as fleetService from '@/domains/fleet';
import * as routeService from '@/domains/route';
import { areShiftsCompatible,getShiftLoad } from '@/lib/utils/shift-utils';

export async function getBusCapacity(busId: string, shift?: string) {
  const result = await fleetService.checkBusCapacity(busId, shift);
  return {
    available: result.available,
    currentMembers: result.shiftLoad,
    shiftLoad: result.shiftLoad,
    capacity: result.capacity,
  };
}

export async function incrementCapacity(busId: string, _studentUid: string, shift?: string): Promise<void> {
  await fleetService.incrementBusCapacity(busId, shift);
}

export async function decrementCapacity(busId: string, _studentUid: string, shift?: string): Promise<void> {
  await fleetService.decrementBusCapacity(busId, shift);
}

export async function findAlternatives(
  stop_name: string,
  routeId: string,
  shift: string,
  preFetchedBuses?: any[],
  preFetchedRoutes?: any[]
) {
  // ponytail: Use pre-fetched data if available to avoid N+1 database roundtrips
  const allBuses = preFetchedBuses || await fleetService.getAllBuses();
  const allRoutes = preFetchedRoutes || await routeService.getAll();

  const matchingRouteIds = allRoutes
    .filter(route => {
      const stops = route.stops || [];
      return stops.some((stop: any) => {
        const id = (stop.stop_name || stop.id || stop.name || '').toLowerCase().trim();
        const name = (stop.name || '').toLowerCase().trim();
        return id === stop_name.toLowerCase().trim() || name === stop_name.toLowerCase().trim();
      });
    })
    .map(route => route.routeId || route.id)
    .filter(Boolean);

  const alternativeBuses = allBuses
    .filter(bus => {
      if (bus.routeId === routeId) return false;
      if (!matchingRouteIds.includes(bus.routeId || '')) return false;
      const busShift = bus.shift || 'Both';
      if (!areShiftsCompatible(shift, busShift)) return false;
      const shiftLoad = getShiftLoad(bus, shift);
      return shiftLoad < bus.capacity;
    })
    .map(bus => ({
      busId: bus.busId || bus.id || '',
      busNumber: bus.busNumber,
      capacity: bus.capacity,
      currentMembers: getShiftLoad(bus, shift),
      routeId: bus.routeId || '',
      shift: bus.shift || 'Both',
      isFull: false,
    }))
    .sort((a, b) => (b.capacity - b.currentMembers) - (a.capacity - a.currentMembers));

  if (alternativeBuses.length > 0) {
    return {
      success: true,
      alternativeBuses,
      message: `Found ${alternativeBuses.length} alternative bus(es) that pass through your stop with available seats.`,
    };
  }

  return {
    success: false,
    message: 'All buses serving your area are currently full. An administrator has been notified and will assist you shortly.',
    adminAlert: true,
  };
}

export async function validateAssignment(params: { routeId: string; stop_name: string; shift: string }) {
  const { routeId, stop_name, shift } = params;

  const buses = await fleetService.getBusesByRouteId(routeId);
  const busId = buses[0]?.id || buses[0]?.busId;
  if (!busId) {
    return {
      canAssign: false,
      message: `No bus assigned to route ${routeId}`,
      requiresAdminAttention: true,
    };
  }

  const capacityCheck = await fleetService.checkBusCapacity(busId, shift);

  if (capacityCheck.available) {
    return {
      canAssign: true,
      busId,
      message: `Seat available on Bus ${busId} (${capacityCheck.shiftLoad}/${capacityCheck.capacity})`,
    };
  }

  const alternativeResult = await findAlternatives(stop_name, routeId, shift);

  if (alternativeResult.success && alternativeResult.alternativeBuses && alternativeResult.alternativeBuses.length > 0) {
    return {
      canAssign: false,
      message: `Bus ${busId} is full. ${alternativeResult.message}`,
      alternatives: alternativeResult.alternativeBuses,
    };
  }

  return {
    canAssign: false,
    message: alternativeResult.message,
    requiresAdminAttention: true,
  };
}
