import type { Driver } from '@/lib/types';
import { getAuth } from 'firebase/auth';
import { dataCache, invalidateCollectionCache } from '@/hooks/usePaginatedCollection';

const inFlightDriverFetches = new Map<string, Promise<any>>();
const DRIVER_CACHE_TTL = 60 * 1000; // 1 minute

export const getAllDrivers = async (): Promise<Driver[]> => {
  const cacheKey = 'drivers:all';
  const entry = dataCache.get(cacheKey);
  if (entry && (Date.now() - entry.timestamp < DRIVER_CACHE_TTL)) {
    return entry.data;
  }
  if (inFlightDriverFetches.has(cacheKey)) {
    return inFlightDriverFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return [];
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/drivers', {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) return [];
      const drivers = await response.json();
      dataCache.set(cacheKey, { data: drivers, timestamp: Date.now() });
      return drivers;
    } catch (error) {
      console.error('Error fetching drivers:', error);
      return [];
    } finally {
      inFlightDriverFetches.delete(cacheKey);
    }
  })();

  inFlightDriverFetches.set(cacheKey, promise);
  return promise;
};

export const getDriverById = async (id: string): Promise<any | null> => {
  const cacheKey = `drivers:id:${id}`;
  const entry = dataCache.get(cacheKey);
  if (entry && (Date.now() - entry.timestamp < DRIVER_CACHE_TTL)) {
    return entry.data;
  }
  if (inFlightDriverFetches.has(cacheKey)) {
    return inFlightDriverFetches.get(cacheKey)!;
  }

  const promise = (async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return null;
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`/api/drivers/${encodeURIComponent(id)}`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      if (!response.ok) return null;
      const data = await response.json();
      const driver = data.driver || null;
      if (driver) {
        dataCache.set(cacheKey, { data: driver, timestamp: Date.now() });
      }
      return driver;
    } catch (error) {
      console.error('Error fetching driver:', error);
      return null;
    } finally {
      inFlightDriverFetches.delete(cacheKey);
    }
  })();

  inFlightDriverFetches.set(cacheKey, promise);
  return promise;
};

export const deleteDriver = async (id: string): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(`/api/drivers/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });
    if (response.ok) {
      invalidateCollectionCache('drivers');
      dataCache.delete('drivers:all');
      dataCache.delete(`drivers:id:${id}`);
    }
    return response.ok;
  } catch (error) {
    console.error('Error deleting driver:', error);
    return false;
  }
};

export const updateDriver = async (id: string, data: Partial<Driver>): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return false;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(`/api/drivers/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      invalidateCollectionCache('drivers');
      dataCache.delete('drivers:all');
      dataCache.delete(`drivers:id:${id}`);
    }
    return response.ok;
  } catch (error) {
    console.error('Error updating driver:', error);
    return false;
  }
};
