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

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes TTL for stable route metadata
let allRoutesCache: CacheEntry<Route[]> | null = null;
let inFlightAllRoutesPromise: Promise<Route[]> | null = null;
let allRouteNamesCache: CacheEntry<string[]> | null = null;
const routeByIdCache = new Map<string, CacheEntry<Route | null>>();

export function invalidateRouteCache(id?: string): void {
  allRoutesCache = null;
  allRouteNamesCache = null;
  inFlightAllRoutesPromise = null;
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
  if (inFlightAllRoutesPromise) {
    return inFlightAllRoutesPromise;
  }
  inFlightAllRoutesPromise = (async () => {
    try {
      const routes = await routeRepository.findAll();
      allRoutesCache = { data: routes, expiresAt: Date.now() + CACHE_TTL_MS };
      return routes;
    } finally {
      inFlightAllRoutesPromise = null;
    }
  })();
  return inFlightAllRoutesPromise;
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
  const now = Date.now();
  if (allRouteNamesCache && now < allRouteNamesCache.expiresAt) {
    return allRouteNamesCache.data;
  }
  const names = await routeRepository.findAllNames();
  allRouteNamesCache = { data: names, expiresAt: now + CACHE_TTL_MS };
  return names;
}

export async function upsert(data: Route): Promise<void> {
  await routeRepository.upsert(data);
  invalidateRouteCache(data.id);
}

export async function count(): Promise<number> {
  return routeRepository.count();
}

/**
 * Regional coordinate bounds for Assam / Northeast India corridor:
 * Latitude: 25.0°N to 28.5°N
 * Longitude: 89.5°E to 96.5°E
 */
export function validateRouteStops(stops: any[]): { valid: boolean; error?: string } {
  if (!Array.isArray(stops) || stops.length < 2) {
    return { valid: false, error: 'At least 2 stops are required' };
  }

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const seq = stop.sequence ?? stop.order ?? stop.stopOrder ?? (i + 1);
    if (i > 0) {
      const prevSeq = stops[i - 1].sequence ?? stops[i - 1].order ?? stops[i - 1].stopOrder ?? i;
      if (typeof seq === 'number' && typeof prevSeq === 'number' && seq <= prevSeq) {
        return {
          valid: false,
          error: `Stop sequence must be strictly monotonic: stop at index ${i} has sequence ${seq} <= previous ${prevSeq}`,
        };
      }
    }

    const lat = stop.lat ?? stop.latitude ?? stop.location?.lat ?? stop.coordinates?.lat;
    const lng = stop.lng ?? stop.longitude ?? stop.location?.lng ?? stop.coordinates?.lng;

    if (lat != null && lng != null) {
      const numLat = Number(lat);
      const numLng = Number(lng);
      if (isNaN(numLat) || isNaN(numLng)) {
        return { valid: false, error: `Invalid coordinate numbers at stop index ${i}` };
      }
      if (numLat < 25.0 || numLat > 28.5 || numLng < 89.5 || numLng > 96.5) {
        return {
          valid: false,
          error: `Coordinates (${numLat}, ${numLng}) at stop "${stop.name || stop.stopName || i}" fall outside Assam regional bounds (25.0°N–28.5°N, 89.5°E–96.5°E)`,
        };
      }
    }
  }

  return { valid: true };
}

export type { Route };

