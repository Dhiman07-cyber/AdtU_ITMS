import { getAuth } from 'firebase/auth';

import type {
  Student,
  Driver,
  Moderator,
  Bus,
  Route,
} from '@/lib/types';

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

// Enhanced function to get student data from students collection with all details
// Helper: Format Firestore timestamps consistently
const formatTimestamp = (timestamp: any) => {
  if (!timestamp) return null;
  if (timestamp.toDate) return timestamp.toDate().toISOString();
  if (timestamp instanceof Date) return timestamp.toISOString();
  return timestamp;
};

// Helper: Resolve approver name from moderator/admin collections
const resolveApproverName = async (data: any): Promise<string> => {
  let approverName = data.approvedBy || '';
  if (data.approvedById) {
    const moderator = await getModeratorById(data.approvedById);
    if (moderator) {
      approverName = moderator.fullName || moderator.name || approverName;
    } else {
      const admin = await getAdminByIdInternal(data.approvedById);
      if (admin) {
        approverName = admin.fullName || admin.name || approverName;
      }
    }
  }
  return approverName;
};

// Helper: Normalize raw Firestore student document into a consistent shape
const formatStudentData = async (docId: string, data: any) => {
  const approverName = await resolveApproverName(data);
  return {
    uid: docId,
    ...data,
    createdAt: formatTimestamp(data.createdAt),
    updatedAt: formatTimestamp(data.updatedAt),
    approvedAt: formatTimestamp(data.approvedAt),
    validUntil: formatTimestamp(data.validUntil),
    paymentInfo: data.paymentInfo || {},
    sessionHistory: data.sessionHistory || [],
    phoneNumber: data.phoneNumber || data.phone || '',
    fullName: data.fullName || data.name || '',
    email: data.email || data.emailAddress || '',
    address: data.address || data.location || '',
    stopId: data.stopId || data.stopName || '',
    busId: data.busId || data.assignedBusId || '',
    routeId: data.routeId || data.assignedRouteId || '',
    shift: data.shift || 'Not Set',
    status: data.status || 'pending',
    enrollmentId: data.enrollmentId || '',
    faculty: data.faculty || '',
    department: data.department || '',
    semester: data.semester || '',
    gender: data.gender || '',
    bloodGroup: data.bloodGroup || '',
    dob: data.dob || '',
    parentName: data.parentName || '',
    parentPhone: data.parentPhone || '',
    sessionStartYear: data.sessionStartYear || '',
    sessionEndYear: data.sessionEndYear || '',
    paymentAmount: data.paymentAmount || data.paymentInfo?.amountPaid || data.amountPaid || 0,
    paymentVerified: data.paymentInfo?.paymentVerified || data.paymentVerified || false,
    paid_on: data.paid_on,
    approvedBy: approverName,
  };
};

// Enhanced function to get student data from students collection with all details
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


// Students collection functions
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
    // Get current user for authentication
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      console.error('No authenticated user found');
      return false;
    }

    // Get ID token for authentication
    const idToken = await currentUser.getIdToken();

    // Call the comprehensive delete API
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
    console.log('Student deleted successfully:', result);
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
    // Get current user for authentication
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      console.error('No authenticated user found');
      return false;
    }

    // Get ID token for authentication
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

// Drivers — compatibility façade. Runtime owner: D6 Fleet → PostgreSQL.
export const getAllDrivers = async (): Promise<Driver[]> => {
  try {
    const { getAllDrivers: svcGetAll } = await import('@/domains/identity');
    const data = await svcGetAll();
    return data as Driver[];
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return [];
  }
};

export const getDriverById = async (id: string): Promise<any | null> => {
  try {
    const { getDriverById: svcGetById } = await import('@/domains/identity');
    return svcGetById(id);
  } catch (error) {
    console.error('Error fetching driver:', error);
    return null;
  }
};

export const deleteDriver = async (id: string): Promise<boolean> => {
  try {
    const { deleteDriver: svcDelete } = await import('@/domains/identity');
    await svcDelete(id);
    return true;
  } catch (error) {
    console.error('Error deleting driver:', error);
    return false;
  }
};

export const updateDriver = async (id: string, data: Partial<Driver>): Promise<boolean> => {
  try {
    const { updateDriver: svcUpdate } = await import('@/domains/identity');
    await svcUpdate(id, data);
    return true;
  } catch (error) {
    console.error('Error updating driver:', error);
    return false;
  }
};

// Moderators collection functions
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

const getAdminByIdInternal = async (id: string): Promise<any | null> => {
  const cacheKey = `admin_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const { getAdminById: pgGetAdmin } = await import('@/domains/identity');
    const data = await pgGetAdmin(id);
    if (data) setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching admin:', error);
    return null;
  }
};

export const deleteModerator = async (id: string): Promise<boolean> => {
  try {
    // Get current user for authentication
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      console.error('No authenticated user found');
      return false;
    }

    // Get ID token for authentication
    const idToken = await currentUser.getIdToken();

    // Call the comprehensive delete API
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
    console.log('Moderator deleted successfully:', result);
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

// Buses — compatibility façade. Runtime owner: D6 Fleet → PostgreSQL.
export const getAllBuses = async (): Promise<Bus[]> => {
  try {
    const { getAllBuses: svcGetAll } = await import('@/domains/fleet/services/fleet.service');
    return svcGetAll();
  } catch (error) {
    console.error('Error fetching buses:', error);
    return [];
  }
};

export const getBusById = async (id: string): Promise<Bus | null> => {
  try {
    const { getBusById: svcGetById } = await import('@/domains/fleet/services/fleet.service');
    return svcGetById(id);
  } catch (error) {
    console.error('Error fetching bus:', error);
    return null;
  }
};

// Get buses by route ID — compatibility façade delegating to D6 Fleet
export const getBusesByRouteId = async (routeId: string): Promise<Bus[]> => {
  try {
    const { getBusesByRouteId: svcGetByRoute } = await import('@/domains/fleet/services/fleet.service');
    return svcGetByRoute(routeId);
  } catch (error) {
    console.error('Error fetching buses by route ID:', error);
    return [];
  }
};

export const deleteBus = async (id: string): Promise<boolean> => {
  try {
    const { removeBus } = await import('@/domains/fleet/services/fleet.service');
    return removeBus(id);
  } catch (error) {
    console.error('Error deleting bus:', error);
    return false;
  }
};

export const updateBus = async (id: string, data: Partial<Bus>): Promise<boolean> => {
  try {
    const { updateBus: svcUpdate } = await import('@/domains/fleet/services/fleet.service');
    return svcUpdate(id, data);
  } catch (error) {
    console.error('Error updating bus:', error);
    return false;
  }
};

// Routes collection functions
export const getAllRoutes = async (): Promise<Route[]> => {
  const cacheKey = 'all_routes';
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const routeService = await import('@/domains/route');
    const data = await routeService.getAll();
    const mappedData = data.map(r => ({
      ...r,
      active: r.status === 'active'
    }));
    setCachedData(cacheKey, mappedData);
    return mappedData;
  } catch (error) {
    console.error('Error fetching routes from Route Service:', error);
    return [];
  }
};

export const getRouteById = async (id: string): Promise<Route | null> => {
  const cacheKey = `route_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const routeService = await import('@/domains/route');
    const route = await routeService.getById(id);
    if (!route) return null;
    const mappedRoute = {
      ...route,
      active: route.status === 'active'
    };
    setCachedData(cacheKey, mappedRoute);
    return mappedRoute;
  } catch (error) {
    console.error('Error fetching route from Route Service:', error);
    return null;
  }
};

export const deleteRoute = async (id: string): Promise<boolean> => {
  try {
    const routeService = await import('@/domains/route');
    const success = await routeService.remove(id);
    invalidateCache(`route_${id}`);
    invalidateCache('all_routes');
    return success;
  } catch (error) {
    console.error('Error deleting route from Route Service:', error);
    return false;
  }
};

export const updateRoute = async (id: string, data: Partial<Route>): Promise<boolean> => {
  try {
    const routeService = await import('@/domains/route');
    const cleanData = { ...data };
    delete cleanData.updatedBy;
    delete cleanData.active;
    if (data.active !== undefined) {
      cleanData.status = data.active ? 'active' : 'inactive';
    }
    const success = await routeService.update(id, cleanData);
    invalidateCache(`route_${id}`);
    invalidateCache('all_routes');
    return success;
  } catch (error) {
    console.error('Error updating route from Route Service:', error);
    return false;
  }
};

// Applications collection functions moved to D4 Application domain (PostgreSQL)

export const addRoute = async (routeData: Omit<Route, 'id'>): Promise<string | null> => {
  try {
    const routeService = await import('@/domains/route');
    const cleanData = { ...routeData };
    delete cleanData.active;
    if (routeData.active !== undefined) {
      cleanData.status = routeData.active ? 'active' : 'inactive';
    }
    const id = await routeService.create(cleanData);
    invalidateCache('all_routes');
    return id;
  } catch (error) {
    console.error('Error creating route from Route Service:', error);
    return null;
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



/**
 * Fetches all payments associated with a specific student UID from Supabase
 * @param uid The unique identifier (Firestore UID) of the student
 * @returns Array of payment documents
 */
export const getPaymentsByStudentUid = async (uid: string, enrollmentId?: string): Promise<any[]> => {
  const cacheKey = `payments_${uid}_${enrollmentId || ''}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    // Get current user for authentication
    const { getAuth } = await import('firebase/auth');
    const auth = getAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      console.warn('getPaymentsByStudentUid: No authenticated user found');
      return [];
    }

    const idToken = await currentUser.getIdToken();

    // Fetch from the API which queries Supabase
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

// Re-export Route type for convenience
export type { Route } from '@/lib/types';
