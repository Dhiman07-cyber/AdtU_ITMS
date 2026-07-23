/**
 * D6 FleetService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: bus lookup/CRUD, driver lookup/CRUD (master-data only).
 *
 * Bus/driver *assignment* lifecycle (DriverAssignment, BusRouteAssignment)
 * remains in src/lib/services/assignment-service.ts per the frozen domain
 * boundary. This service covers master-data only.
 *
 * Delegates entirely to fleet.repository → fleet.repository.pg → PostgreSQL.
 * Zero Firestore reads/writes.
 */
import * as fleetRepository from '../repositories/fleet.repository';
import type { Bus, Driver } from '@/lib/types';

export async function createBus(bus: Partial<Bus> & { id: string }): Promise<void> {
  return fleetRepository.upsertBus(bus);
}

export async function getAllBuses(): Promise<Bus[]> {
  return fleetRepository.findAllBuses();
}

export async function getBusById(id: string): Promise<Bus | null> {
  return fleetRepository.findBusById(id);
}

export async function getBusesByRouteId(routeId: string): Promise<Bus[]> {
  return fleetRepository.findBusesByRouteId(routeId);
}

export async function unassignRoute(routeId: string): Promise<boolean> {
  return fleetRepository.unassignRoute(routeId);
}


export async function updateBus(id: string, data: Partial<Bus>): Promise<boolean> {
  return fleetRepository.updateBusRecord(id, data);
}

export async function removeBus(id: string): Promise<boolean> {
  return fleetRepository.removeBus(id);
}



// ─── Capacity Operations ────────────────────────────────────────────────────

export async function checkBusCapacity(busId: string, shift?: string) {
  return fleetRepository.checkBusCapacity(busId, shift);
}

export async function incrementBusCapacity(busId: string, shift?: string) {
  return fleetRepository.incrementBusCapacity(busId, shift);
}

export async function decrementBusCapacity(busId: string, shift?: string) {
  return fleetRepository.decrementBusCapacity(busId, shift);
}

export async function onStudentDeleted(event: {
  studentUid: string;
  busId: string;
  shift?: string;
}): Promise<void> {
  // Encapsulate capacity update within the Fleet domain
  await decrementBusCapacity(event.busId, event.shift);
}

export async function reassignStudentsAtomically(plans: Array<{
  studentId: string;
  fromBusId: string;
  toBusId: string;
  studentShift?: string;
  stopName?: string;
}>) {
  return fleetRepository.reassignStudentsAtomically(plans);
}

export type { Bus, Driver };

