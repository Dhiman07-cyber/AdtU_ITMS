import { getAuth } from 'firebase/auth';
import { getSafeIdToken } from './user-service';

import type {
	Moderator,
	Student
} from '@/lib/types';

import { dataCache as sharedDataCache, invalidateCollectionCache as sharedInvalidateCollectionCache } from '@/hooks/usePaginatedCollection';

// Re-export domain-specific client functions
export * from './clients/driver.client';
export * from './clients/fleet.client';
export * from './clients/route.client';

// ============================================================================
// SHARED IN-MEMORY CACHE & IN-FLIGHT PROMISE DEDUPLICATION (Fix 142)
// ============================================================================
const CACHE_TTL = 60 * 1000; // 1 minute default TTL
const inFlightDataServiceFetches = new Map<string, Promise<any>>();

const getCachedData = <T = any>(key: string): T | null => {
  const entry = sharedDataCache.get(key);
  if (entry && (Date.now() - entry.timestamp < CACHE_TTL)) {
    return entry.data as T;
  }
  return null;
};

const setCachedData = (key: string, data: any) => {
  sharedDataCache.set(key, { data, timestamp: Date.now() });
};

export const invalidateCache = (key?: string) => {
  if (key) {
    sharedDataCache.delete(key);
    inFlightDataServiceFetches.delete(key);
  } else {
    sharedDataCache.clear();
    inFlightDataServiceFetches.clear();
  }
};

async function dedupedFetch<T>(cacheKey: string, fetchFn: () => Promise<T>): Promise<T> {
  const cached = getCachedData<T>(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  if (inFlightDataServiceFetches.has(cacheKey)) {
    return inFlightDataServiceFetches.get(cacheKey) as Promise<T>;
  }

  const promise = (async () => {
    try {
      const data = await fetchFn();
      if (data !== null && data !== undefined) {
        setCachedData(cacheKey, data);
      }
      return data;
    } finally {
      inFlightDataServiceFetches.delete(cacheKey);
    }
  })();

  inFlightDataServiceFetches.set(cacheKey, promise);
  return promise;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (currentUser) {
      const idToken = await getSafeIdToken(currentUser);
      return { Authorization: `Bearer ${idToken}` };
    }
  } catch (err) {
    console.error('Error getting auth headers:', err);
  }
  return {};
}

// ============================================================================
// Students collection functions
// ============================================================================
export const getStudentByUid = async (uid: string): Promise<any | null> => {
  const cacheKey = `student_uid_${uid}`;
  return dedupedFetch(cacheKey, async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/students/${encodeURIComponent(uid)}`, { headers });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('Error fetching student by UID:', error);
      return null;
    }
  });
};

export const getAllStudents = async (): Promise<Student[]> => {
  const cacheKey = 'all_students';
  return dedupedFetch(cacheKey, async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/students', { headers });
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      console.error('Error fetching students:', error);
      return [];
    }
  });
};

export const getStudentById = async (id: string): Promise<any | null> => {
  const cacheKey = `student_id_${id}`;
  return dedupedFetch(cacheKey, async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/students/${encodeURIComponent(id)}`, { headers });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('Error fetching student:', error);
      return null;
    }
  });
};

export const deleteStudent = async (id: string): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user found');
      return false;
    }
    const idToken = await currentUser.getIdToken();

    const response = await fetch('/api/delete-user', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        uid: id,
        idToken: idToken
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Delete student API error:', errorData);
      return false;
    }

    const result = await response.json();
    if (result.success) {
      invalidateCache(`student_id_${id}`);
      invalidateCache(`student_uid_${id}`);
      invalidateCache('all_students');
    }
    return result.success;
  } catch (error) {
    console.error('Error deleting student:', error);
    return false;
  }
};

export const updateStudent = async (id: string, data: Partial<Student>): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user found');
      return false;
    }
    const idToken = await currentUser.getIdToken();

    const response = await fetch('/api/admin/update-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        uid: id,
        ...data
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Update student API error:', errorData);
      return false;
    }

    invalidateCache(`student_id_${id}`);
    invalidateCache(`student_uid_${id}`);
    invalidateCache('all_students');
    return true;
  } catch (error) {
    console.error('Error updating student:', error);
    return false;
  }
};

// ============================================================================
// Moderators collection functions
// ============================================================================
export const getAllModerators = async (): Promise<Moderator[]> => {
  const cacheKey = 'all_moderators';
  return dedupedFetch(cacheKey, async () => {
    try {
      const response = await fetch('/api/moderators');
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      console.error('Error fetching moderators:', error);
      return [];
    }
  });
};

export const getModeratorById = async (id: string): Promise<Moderator | null> => {
  const cacheKey = `moderator_${id}`;
  return dedupedFetch(cacheKey, async () => {
    try {
      const response = await fetch(`/api/moderators/${id}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data || null;
    } catch (error) {
      console.error('Error fetching moderator:', error);
      return null;
    }
  });
};

export const deleteModerator = async (id: string): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user found');
      return false;
    }
    const idToken = await currentUser.getIdToken();

    const response = await fetch('/api/delete-user', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        uid: id,
        idToken: idToken
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Delete moderator API error:', errorData);
      return false;
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error('Error deleting moderator:', error);
    return false;
  }
};

export const updateModerator = async (id: string, data: Partial<Moderator>): Promise<boolean> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user found');
      return false;
    }
    const idToken = await currentUser.getIdToken();
    const response = await fetch(`/api/moderators/${id}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) {
      console.error('Update moderator API error:', response.status);
      return false;
    }
    invalidateCache(`moderator_${id}`);
    invalidateCache('all_moderators');
    return true;
  } catch (error) {
    console.error('Error updating moderator:', error);
    return false;
  }
};

export const getStudentsByBusId = async (busId: string): Promise<Student[]> => {
  const cacheKey = `students_bus_${busId}`;
  return dedupedFetch(cacheKey, async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/students?busId=${encodeURIComponent(busId)}`, { headers });
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      console.error('Error fetching students by bus ID:', error);
      return [];
    }
  });
};

export const getPaymentsByStudentUid = async (uid: string, enrollmentId?: string): Promise<any[]> => {
  const cacheKey = `payments_${uid}_${enrollmentId || ''}`;
  return dedupedFetch(cacheKey, async () => {
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.warn('getPaymentsByStudentUid: No authenticated user found');
        return [];
      }
      const idToken = await currentUser.getIdToken();

      let url = `/api/payment/transactions?studentUid=${encodeURIComponent(uid)}`;
      if (enrollmentId) {
        url += `&studentId=${encodeURIComponent(enrollmentId)}`;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });

      if (!response.ok) {
        console.error('getPaymentsByStudentUid: API error', response.status);
        return [];
      }

      const data = await response.json();
      return data.transactions || [];
    } catch (error) {
      console.error('Error fetching student payments from Supabase API:', error);
      return [];
    }
  });
};

export type { Route } from '@/lib/types';
