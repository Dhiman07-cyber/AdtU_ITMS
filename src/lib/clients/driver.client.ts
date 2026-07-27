import { getAuth } from 'firebase/auth';
import type { Driver } from '@/lib/types';

export const getAllDrivers = async (): Promise<Driver[]> => {
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
    return await response.json();
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return [];
  }
};

export const getDriverById = async (id: string): Promise<any | null> => {
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
    return data.driver || null;
  } catch (error) {
    console.error('Error fetching driver:', error);
    return null;
  }
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
    return response.ok;
  } catch (error) {
    console.error('Error updating driver:', error);
    return false;
  }
};
