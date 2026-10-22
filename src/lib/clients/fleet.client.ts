import type { Bus } from '@/lib/types';
import { getAuth } from 'firebase/auth';
import { dataCache, invalidateCollectionCache } from '@/hooks/usePaginatedCollection';

const inFlightFleetFetches = new Map<string, Promise<any>>();
const FLEET_CACHE_TTL = 60 * 1000; // 1 minute

export const getAllBuses = async (): Promise<Bus[]> => {
  const cacheKey = 'buses:all';
  const entry = dataCache.get(cacheKey);
  if (entry && (Date.now() - entry.timestamp < FLEET_CACHE_TTL)) {
    return entry.data;
  }
  if (inFlightFleetFetches.has(cacheKey)) {
    return inFlightFleetFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/buses', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) return [];
      const data = await response.json();
      const buses = data.buses || [];
      dataCache.set(cacheKey, { data: buses, timestamp: Date.now() });
      return buses;
    } catch (error) {
      console.error('Error fetching buses:', error);
      return [];
    } finally {
      inFlightFleetFetches.delete(cacheKey);
    }
  })();

  inFlightFleetFetches.set(cacheKey, promise);
  return promise;
};

export const getBusById = async (id: string): Promise<Bus | null> => {
  const cacheKey = `buses:id:${id}`;
  const entry = dataCache.get(cacheKey);
  if (entry && (Date.now() - entry.timestamp < FLEET_CACHE_TTL)) {
    return entry.data as any as Bus;
  }
  if (inFlightFleetFetches.has(cacheKey)) {
    return inFlightFleetFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`/api/buses/${encodeURIComponent(id)}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) return null;
      const bus = await response.json();
      if (bus) {
        dataCache.set(cacheKey, { data: bus, timestamp: Date.now() });
      }
      return bus;
    } catch (error) {
      console.error('Error fetching bus:', error);
      return null;
    } finally {
      inFlightFleetFetches.delete(cacheKey);
    }
  })();

  inFlightFleetFetches.set(cacheKey, promise);
  return promise;
};

export const getBusesByRouteId = async (routeId: string): Promise<Bus[]> => {
  const cacheKey = `buses:route:${routeId}`;
  const entry = dataCache.get(cacheKey);
  if (entry && (Date.now() - entry.timestamp < FLEET_CACHE_TTL)) {
    return entry.data;
  }
  if (inFlightFleetFetches.has(cacheKey)) {
    return inFlightFleetFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`/api/buses?routeId=${encodeURIComponent(routeId)}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) return [];
      const data = await response.json();
      const buses = data.buses || [];
      dataCache.set(cacheKey, { data: buses, timestamp: Date.now() });
      return buses;
    } catch (error) {
      console.error('Error fetching buses by route ID:', error);
      return [];
    } finally {
      inFlightFleetFetches.delete(cacheKey);
    }
  })();

  inFlightFleetFetches.set(cacheKey, promise);
  return promise;
};

export const deleteBus = async (id: string): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(`/api/buses/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });
    if (response.ok) {
      invalidateCollectionCache('buses');
      dataCache.delete('buses:all');
      dataCache.delete(`buses:id:${id}`);
    }
    return response.ok;
  } catch (error) {
    console.error('Error deleting bus:', error);
    return false;
  }
};

export const updateBus = async (id: string, data: Partial<Bus>): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(`/api/buses/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      invalidateCollectionCache('buses');
      dataCache.delete('buses:all');
      dataCache.delete(`buses:id:${id}`);
    }
    return response.ok;
  } catch (error) {
    console.error('Error updating bus:', error);
    return false;
  }
};
