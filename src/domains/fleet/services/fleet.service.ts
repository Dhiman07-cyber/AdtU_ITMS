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
import type { Bus,Driver } from '@/lib/types';
import * as fleetRepository from '../repositories/fleet.repository';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const BUS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes TTL for fleet master data
let allBusesCache: CacheEntry<Bus[]> | null = null;
const busByIdCache = new Map<string, CacheEntry<Bus | null>>();

export function invalidateBusCache(id?: string): void {
  allBusesCache = null;
  if (id) {
    busByIdCache.delete(id);
  } else {
    busByIdCache.clear();
  }
}

export async function createBus(bus: Partial<Bus> & { id: string }): Promise<void> {
  await fleetRepository.upsertBus(bus);
  invalidateBusCache();
}

export async function getAllBuses(): Promise<Bus[]> {
  const now = Date.now();
  if (allBusesCache && now < allBusesCache.expiresAt) {
    return allBusesCache.data;
  }
  const buses = await fleetRepository.findAllBuses();
  allBusesCache = { data: buses, expiresAt: now + BUS_CACHE_TTL_MS };
  return buses;
}

export async function getBusById(id: string): Promise<Bus | null> {
  const now = Date.now();
  const cached = busByIdCache.get(id);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }
  const bus = await fleetRepository.findBusById(id);
  if (busByIdCache.size > 200) {
    busByIdCache.clear();
  }
  busByIdCache.set(id, { data: bus, expiresAt: now + BUS_CACHE_TTL_MS });
  return bus;
}

export async function getBusesByRouteId(routeId: string): Promise<Bus[]> {
  return fleetRepository.findBusesByRouteId(routeId);
}

export async function unassignRoute(routeId: string): Promise<boolean> {
  const res = await fleetRepository.unassignRoute(routeId);
  invalidateBusCache();
  return res;
}

export async function updateBus(id: string, data: Partial<Bus>): Promise<boolean> {
  const res = await fleetRepository.updateBusRecord(id, data);
  if (res) {
    invalidateBusCache(id);
  }
  return res;
}

export async function removeBus(id: string): Promise<boolean> {
  const res = await fleetRepository.removeBus(id);
  if (res) {
    invalidateBusCache(id);
  }
  return res;
}



// ─── Capacity Operations ────────────────────────────────────────────────────

export async function checkBusCapacity(busId: string, shift?: string) {
  return fleetRepository.checkBusCapacity(busId, shift);
}

export async function incrementBusCapacity(busId: string, shift?: string, enforceCapacity = true) {
  const res = await fleetRepository.incrementBusCapacity(busId, shift, enforceCapacity);
  invalidateBusCache(busId);
  return res;
}

export async function decrementBusCapacity(busId: string, shift?: string) {
  const res = await fleetRepository.decrementBusCapacity(busId, shift);
  invalidateBusCache(busId);
  return res;
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
  const res = await fleetRepository.reassignStudentsAtomically(plans);
  invalidateBusCache();
  return res;
}

export type { Bus,Driver };


