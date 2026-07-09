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

export async function getAllDrivers(): Promise<Driver[]> {
  return fleetRepository.findAllDrivers();
}

export async function getDriverById(id: string): Promise<Driver | null> {
  return fleetRepository.findDriverById(id);
}

export async function updateDriver(id: string, data: Partial<Driver>): Promise<boolean> {
  return fleetRepository.updateDriverRecord(id, data);
}

export async function removeDriver(id: string): Promise<boolean> {
  return fleetRepository.removeDriver(id);
}

export type { Bus, Driver };
