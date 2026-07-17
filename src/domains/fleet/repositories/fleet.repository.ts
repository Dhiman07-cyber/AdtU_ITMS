/**
 * D6 Fleet Repository — abstraction boundary.
 *
 * Architecture:
 *   Service → Repository (this file) → Repository.pg → PostgreSQL
 *
 * This layer exists so the service never knows whether storage is
 * PostgreSQL, Firestore, MongoDB, or Redis.
 *
 * Migration status: COMPLETED — D6 Fleet reads and writes from
 * PostgreSQL (Supabase buses + driver_profiles tables).
 * Firestore (buses/drivers collections) is no longer used by this domain.
 *
 * Thin delegation wrapper. Public function signatures are unchanged so
 * FleetService requires zero modification.
 */
import {
  pgFindAllBuses,
  pgFindBusById,
  pgFindBusesByRouteId,
  pgUpdateBus,
  pgRemoveBus,
  pgUpsertBus,
  pgUnassignRoute,
  pgCheckBusCapacity,
  pgIncrementBusCapacity,
  pgDecrementBusCapacity,
  pgFindBusesWithAvailableCapacity,
} from './fleet.repository.pg';
import type { Bus, Driver } from '@/lib/types';

export async function findAllBuses(): Promise<Bus[]> {
  return pgFindAllBuses();
}

export async function findBusById(id: string): Promise<Bus | null> {
  return pgFindBusById(id);
}

export async function findBusesByRouteId(routeId: string): Promise<Bus[]> {
  return pgFindBusesByRouteId(routeId);
}

export async function unassignRoute(routeId: string): Promise<boolean> {
  try {
    await pgUnassignRoute(routeId);
    return true;
  } catch {
    return false;
  }
}


export async function updateBusRecord(id: string, data: Partial<Bus>): Promise<boolean> {
  try {
    await pgUpdateBus(id, data);
    return true;
  } catch {
    return false;
  }
}

export async function removeBus(id: string): Promise<boolean> {
  try {
    await pgRemoveBus(id);
    return true;
  } catch {
    return false;
  }
}

export async function upsertBus(bus: Partial<Bus> & { id: string }): Promise<void> {
  return pgUpsertBus(bus);
}



// ─── Capacity Operations ────────────────────────────────────────────────────

export type { CapacityCheckResult, CapacityMutationResult } from './fleet.repository.pg';

export async function checkBusCapacity(busId: string, shift?: string) {
  return pgCheckBusCapacity(busId, shift);
}

export async function incrementBusCapacity(busId: string, shift?: string) {
  return pgIncrementBusCapacity(busId, shift);
}

export async function decrementBusCapacity(busId: string, shift?: string) {
  return pgDecrementBusCapacity(busId, shift);
}

export async function findBusesWithAvailableCapacity(shift?: string) {
  return pgFindBusesWithAvailableCapacity(shift);
}

export type { Bus, Driver };
