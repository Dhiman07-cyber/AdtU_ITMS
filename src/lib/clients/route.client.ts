import { getAuth } from 'firebase/auth';
import type { Route } from '@/lib/types';

export const getAllRoutes = async (): Promise<Route[]> => {
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
    return await response.json();
  } catch (error) {
    console.error('Error fetching routes:', error);
    return [];
  }
};

export const getRouteById = async (id: string): Promise<Route | null> => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(`/api/routes/${id}`, {
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Error fetching route:', error);
    return null;
  }
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
    return data.id || null;
  } catch (error) {
    console.error('Error creating route:', error);
    return null;
  }
};
