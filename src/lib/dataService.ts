import { getAuth } from 'firebase/auth';

import type {
  Student,
  Driver,
  Moderator,
  Bus,
  Route,
} from '@/lib/types';

// Re-export domain-specific client functions
export * from './clients/driver.client';
export * from './clients/fleet.client';
export * from './clients/route.client';

// ============================================================================
// IN-MEMORY CACHE - Prevents redundant reads within the same session
// ============================================================================
const CACHE_TTL = 60 * 1000; // 1 minute default TTL
const dataCache = new Map<string, { data: any, timestamp: number }>();

const getCachedData = (key: string) => {
  const entry = dataCache.get(key);
  if (entry && (Date.now() - entry.timestamp < CACHE_TTL)) {
    return entry.data;
  }
  return null;
};

const setCachedData = (key: string, data: any) => {
  dataCache.set(key, { data, timestamp: Date.now() });
};

export const invalidateCache = (key?: string) => {
  if (key) {
    dataCache.delete(key);
  } else {
    dataCache.clear();
  }
};

// ============================================================================
// Students collection functions
// ============================================================================
export const getStudentByUid = async (uid: string): Promise<any | null> => {
  const cacheKey = `student_uid_${uid}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`/api/students/${uid}`);
    if (!response.ok) return null;
    const data = await response.json();
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching student by UID:', error);
    return null;
  }
};

export const getAllStudents = async (): Promise<Student[]> => {
  const cacheKey = 'all_students';
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch('/api/students');
    if (!response.ok) return [];
    const data = await response.json();
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching students:', error);
    return [];
  }
};

export const getStudentById = async (id: string): Promise<any | null> => {
  const cacheKey = `student_id_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`/api/students/${id}`);
    if (!response.ok) return null;
    const data = await response.json();
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching student:', error);
    return null;
  }
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
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch('/api/moderators');
    if (!response.ok) return [];
    const data = await response.json();
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching moderators:', error);
    return [];
  }
};

export const getModeratorById = async (id: string): Promise<Moderator | null> => {
  const cacheKey = `moderator_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`/api/moderators/${id}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (data) setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching moderator:', error);
    return null;
  }
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
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`/api/students?busId=${encodeURIComponent(busId)}`);
    if (!response.ok) return [];
    const data = await response.json();
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching students by bus ID:', error);
    return [];
  }
};

export const getPaymentsByStudentUid = async (uid: string, enrollmentId?: string): Promise<any[]> => {
  const cacheKey = `payments_${uid}_${enrollmentId || ''}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn('getPaymentsByStudentUid: No authenticated user found');
      return [];
    }
    const idToken = await currentUser.getIdToken();

    let url = `/api/payment/transactions?studentUid=${uid}`;
    if (enrollmentId) {
      url += `&studentId=${enrollmentId}`;
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
    const transactions = data.transactions || [];
    setCachedData(cacheKey, transactions);
    return transactions;
  } catch (error) {
    console.error('Error fetching student payments from Supabase API:', error);
    return [];
  }
};

export type { Route } from '@/lib/types';
