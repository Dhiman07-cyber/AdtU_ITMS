/**
 * RouteService
 *
 * Responsibilities: route/stop lookup, CRUD. BusRouteAssignment lifecycle
 * is managed by net-route-assignment-service.ts; this service covers
 * route and stop master data.
 *
 * Delegates to routeRepository and production dataService methods.
 */
import type { Route } from '../repositories/route.repository';
import * as routeRepository from '../repositories/route.repository';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL for stable route metadata
let allRoutesCache: CacheEntry<Route[]> | null = null;
const routeByIdCache = new Map<string, CacheEntry<Route | null>>();

export function invalidateRouteCache(id?: string): void {
  allRoutesCache = null;
  if (id) {
    routeByIdCache.delete(id);
  } else {
    routeByIdCache.clear();
  }
}

export async function getAll(): Promise<Route[]> {
  const now = Date.now();
  if (allRoutesCache && now < allRoutesCache.expiresAt) {
    return allRoutesCache.data;
  }
  const routes = await routeRepository.findAll();
  allRoutesCache = { data: routes, expiresAt: now + CACHE_TTL_MS };
  return routes;
}

export async function getById(id: string): Promise<Route | null> {
  const now = Date.now();
  const cached = routeByIdCache.get(id);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }
  const route = await routeRepository.findById(id);
  if (routeByIdCache.size > 200) {
    routeByIdCache.clear();
  }
  routeByIdCache.set(id, { data: route, expiresAt: now + CACHE_TTL_MS });
  return route;
}

export async function update(id: string, data: Partial<Route>): Promise<boolean> {
  const result = await routeRepository.update(id, data);
  if (result) {
    invalidateRouteCache(id);
  }
  return result;
}

export async function remove(id: string): Promise<boolean> {
  const result = await routeRepository.remove(id);
  if (result) {
    invalidateRouteCache(id);
  }
  return result;
}

export async function create(data: Omit<Route, 'id'>): Promise<string | null> {
  const result = await routeRepository.create(data);
  if (result) {
    invalidateRouteCache();
  }
  return result;
}

export async function getAllNames(): Promise<string[]> {
  return routeRepository.findAllNames();
}

export async function upsert(data: Route): Promise<void> {
  await routeRepository.upsert(data);
  invalidateRouteCache(data.id);
}

export async function count(): Promise<number> {
  return routeRepository.count();
}

export type { Route };

