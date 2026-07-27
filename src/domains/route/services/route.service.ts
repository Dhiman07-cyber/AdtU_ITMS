/**
 * D7 RouteService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: route/stop lookup, CRUD. BusRouteAssignment lifecycle
 * (net-route-assignment-service.ts) is out of scope here per domain
 * boundary — this service covers route/stop master data only.
 *
 * ponytail: delegates entirely to existing production logic in
 * src/lib/dataService.ts — zero behavior change.
 */
import type { Route } from '../repositories/route.repository';
import * as routeRepository from '../repositories/route.repository';

export async function getAll(): Promise<Route[]> {
  return routeRepository.findAll();
}

export async function getById(id: string): Promise<Route | null> {
  return routeRepository.findById(id);
}

export async function update(id: string, data: Partial<Route>): Promise<boolean> {
  return routeRepository.update(id, data);
}

export async function remove(id: string): Promise<boolean> {
  return routeRepository.remove(id);
}

export async function create(data: Omit<Route, 'id'>): Promise<string | null> {
  return routeRepository.create(data);
}

export async function getAllNames(): Promise<string[]> {
  return routeRepository.findAllNames();
}

export async function upsert(data: Route): Promise<void> {
  return routeRepository.upsert(data);
}

export async function count(): Promise<number> {
  return routeRepository.count();
}

export type { Route };

