import { getAuth } from 'firebase/auth';
import type { Bus } from '@/lib/types';

export const getAllBuses = async (): Promise<Bus[]> => {
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
    return data.buses || [];
  } catch (error) {
    console.error('Error fetching buses:', error);
    return [];
  }
};

export const getBusById = async (id: string): Promise<Bus | null> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(`/api/buses/${id}`, {
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Error fetching bus:', error);
    return null;
  }
};

export const getBusesByRouteId = async (routeId: string): Promise<Bus[]> => {
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
    return data.buses || [];
  } catch (error) {
    console.error('Error fetching buses by route ID:', error);
    return [];
  }
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
    return response.ok;
  } catch (error) {
    console.error('Error updating bus:', error);
    return false;
  }
};
