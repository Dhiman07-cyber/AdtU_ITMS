/**
 * D7 Route Repository (Route + Stop master data)
 *
 * Persistence only — no business logic. Wraps the existing Firestore-backed
 * route CRUD.
 *
 * ponytail: src/lib/dataService.ts already implements this — wrapped by
 * reference, not reimplemented. BusRouteAssignment lifecycle stays out of
 * scope here — owned by src/lib/services/net-route-assignment-service.ts
 * per the frozen architecture, this repository only covers route/stop
 * master data.
 */
import {
  pgFindAll,
  pgFindById,
  pgUpdate,
  pgRemove,
  pgInsert,
  pgUpsert,
  pgFindAllNames,
  pgCount,
} from './route.repository.pg';
import type { Route } from '@/lib/types';

export async function findAll(): Promise<Route[]> {
  return pgFindAll();
}

export async function findById(id: string): Promise<Route | null> {
  return pgFindById(id);
}

export async function update(id: string, data: Partial<Route>): Promise<boolean> {
  return pgUpdate(id, data);
}

export async function remove(id: string): Promise<boolean> {
  return pgRemove(id);
}

export async function create(data: Omit<Route, 'id'>): Promise<string | null> {
  return pgInsert(data);
}

export async function upsert(data: Route): Promise<void> {
  return pgUpsert(data);
}

export async function count(): Promise<number> {
  return pgCount();
}

export async function findAllNames(): Promise<string[]> {
  return pgFindAllNames();
}

export type { Route };

