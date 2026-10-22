import type { Route } from '@/lib/types';
import { getAuth } from 'firebase/auth';
import { dataCache, invalidateCollectionCache } from '@/hooks/usePaginatedCollection';

const inFlightRouteFetches = new Map<string, Promise<any>>();
const ROUTE_CACHE_TTL = 60 * 1000; // 1 minute

export const getAllRoutes = async (): Promise<Route[]> => {
  const cacheKey = 'routes:all';
  const entry = dataCache.get(cacheKey);
  if (entry && (Date.now() - entry.timestamp < ROUTE_CACHE_TTL)) {
    return entry.data;
  }
  if (inFlightRouteFetches.has(cacheKey)) {
    return inFlightRouteFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/routes', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) return [];
      const routes = await response.json();
      dataCache.set(cacheKey, { data: routes, timestamp: Date.now() });
      return routes;
    } catch (error) {
      console.error('Error fetching routes:', error);
      return [];
    } finally {
      inFlightRouteFetches.delete(cacheKey);
    }
  })();

  inFlightRouteFetches.set(cacheKey, promise);
  return promise;
};

export const getRouteById = async (id: string): Promise<Route | null> => {
  const cacheKey = `routes:id:${id}`;
  const entry = dataCache.get(cacheKey);
  if (entry && (Date.now() - entry.timestamp < ROUTE_CACHE_TTL)) {
    return entry.data as any as Route;
  }
  if (inFlightRouteFetches.has(cacheKey)) {
    return inFlightRouteFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`/api/routes/${encodeURIComponent(id)}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) return null;
      const route = await response.json();
      if (route) {
        dataCache.set(cacheKey, { data: route, timestamp: Date.now() });
      }
      return route;
    } catch (error) {
      console.error('Error fetching route:', error);
      return null;
    } finally {
      inFlightRouteFetches.delete(cacheKey);
    }
  })();

  inFlightRouteFetches.set(cacheKey, promise);
  return promise;
};

export const deleteRoute = async (id: string): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(`/api/routes/${id}/delete`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });
    if (response.ok) {
      invalidateCollectionCache('routes');
      dataCache.delete('routes:all');
      dataCache.delete(`routes:id:${id}`);
    }
    return response.ok;
  } catch (error) {
    console.error('Error deleting route:', error);
    return false;
  }
};

export const updateRoute = async (id: string, data: Partial<Route>): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    const idToken = await currentUser.getIdToken();

    const cleanData = { ...data };
    delete cleanData.updatedBy;
    delete cleanData.active;
    if (data.active !== undefined) {
      cleanData.status = data.active ? 'active' : 'inactive';
    }

    const response = await fetch(`/api/routes/${id}/update`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(cleanData)
    });
    if (response.ok) {
      invalidateCollectionCache('routes');
      dataCache.delete('routes:all');
      dataCache.delete(`routes:id:${id}`);
    }
    return response.ok;
  } catch (error) {
    console.error('Error updating route:', error);
    return false;
  }
};

export const addRoute = async (routeData: Omit<Route, 'id'>): Promise<string | null> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const idToken = await currentUser.getIdToken();

    const cleanData = { ...routeData };
    delete cleanData.active;
    if (routeData.active !== undefined) {
      cleanData.status = routeData.active ? 'active' : 'inactive';
    }

    const response = await fetch('/api/routes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(cleanData)
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.id) {
      invalidateCollectionCache('routes');
      dataCache.delete('routes:all');
    }
    return data.id || null;
  } catch (error) {
    console.error('Error creating route:', error);
    return null;
  }
};
