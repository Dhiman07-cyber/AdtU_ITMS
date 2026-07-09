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
  pgFindAllDrivers,
  pgFindDriverById,
  pgUpdateDriver,
  pgRemoveDriver,
  pgUpsertDriver,
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

export async function findAllDrivers(): Promise<Driver[]> {
  return pgFindAllDrivers();
}

export async function findDriverById(id: string): Promise<Driver | null> {
  return pgFindDriverById(id);
}

export async function updateDriverRecord(id: string, data: Partial<Driver>): Promise<boolean> {
  try {
    await pgUpdateDriver(id, data);
    return true;
  } catch {
    return false;
  }
}

export async function removeDriver(id: string): Promise<boolean> {
  try {
    await pgRemoveDriver(id);
    return true;
  } catch {
    return false;
  }
}

export async function upsertDriver(driver: Partial<Driver> & { uid: string }): Promise<void> {
  return pgUpsertDriver(driver);
}

export type { Bus, Driver };
