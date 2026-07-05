import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  deleteDoc,
  Timestamp,
  arrayUnion,
  arrayRemove,
  orderBy
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

import type {
  User,
  Student,
  Driver,
  Moderator,
  Bus,
  Route,
  Application,
  Invitation
} from '@/lib/types';
import CryptoJS from 'crypto-js';
import { createRandomId } from '@/lib/security/random-id';

// Add proper typing for db
import { Firestore } from 'firebase/firestore';

// Helper function to get current timestamp
const getCurrentTimestamp = () => {
  return Timestamp.now();
};

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

// Determine which database to use based on environment
const getDatabase = async () => {
  // Always use Firebase client SDK for these functions because they depend on 
  // Client-SDK specific operator functions (doc, collection, getDoc, etc.)
  // imported from 'firebase/firestore'. These will work in Node.js environment
  // as long as the apps are initialized via fireabse.ts
  const { db: clientDb } = await import('@/lib/firebase');
  return clientDb;
};

// Helper to check if we can make authenticated calls on client
const checkClientAuth = (): boolean => {
  if (typeof window !== 'undefined') {
    const auth = getAuth();
    if (!auth.currentUser) return false;
  }
  return true;
};

// Helper function to create an updatedBy entry with current user's name
// Simplified version - uses email to avoid async database lookups during updates
// Note: Client-side updates use 'Client' as identifier. Server-side updates have proper Admin/Employee-ID
const createUpdatedByEntryClient = (): string => {
  try {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (!currentUser) return `Unknown ( Client : ${new Date().toISOString()} )`;

    // Use displayName if available, otherwise email
    const name = currentUser.displayName || currentUser.email || 'Unknown';
    return `${name} ( Client : ${new Date().toISOString()} )`;
  } catch (error) {
    console.error('Error getting user name for updatedBy:', error);
    return `Unknown ( Client : ${new Date().toISOString()} )`;
  }
};

// Get all unique stops from all routes
export const getAllStops = async (): Promise<string[]> => {
  const routes = await getAllRoutes();
  const allStops = routes.flatMap(route => route.stops.map((stop: any) => stop.name));
  return [...new Set(allStops)];
};

// Get all unique bus numbers
export const getAllBusNumbers = async (): Promise<string[]> => {
  const buses = await getAllBuses();
  return buses.map(bus => bus.busNumber);
};

// Get all route names
export const getAllRouteNames = async (): Promise<string[]> => {
  const routes = await getAllRoutes();
  return routes.map(route => route.routeName);
};

// Users collection functions
export const getUserByUid = async (uid: string): Promise<User | null> => {
  const cacheKey = `user_${uid}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();
    const userDoc = await getDoc(doc(db as Firestore, 'users', uid));
    const data = userDoc.exists() ? { uid: userDoc.id, ...userDoc.data() } as User : null;
    if (data) setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
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
      const admin = await getAdminById(data.approvedById);
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
    const db = await getDatabase();

    // Strategy 1: Direct document fetch by UID as document ID (most common, fastest)
    const studentDoc = await getDoc(doc(db as Firestore, 'students', uid));
    if (studentDoc.exists()) {
      const data = await formatStudentData(studentDoc.id, studentDoc.data());
      setCachedData(cacheKey, data);
      return data;
    }

    // Strategy 2: Query by UID field in document
    const studentsQuery = query(collection(db as Firestore, 'students'), where('uid', '==', uid));
    const studentsSnapshot = await getDocs(studentsQuery);
    if (!studentsSnapshot.empty) {
      const matched = studentsSnapshot.docs[0];
      const data = await formatStudentData(matched.id, matched.data());
      setCachedData(cacheKey, data);
      return data;
    }

    // Strategy 3: Query by email (for cases where UID doesn't match)
    const userDoc = await getDoc(doc(db as Firestore, 'users', uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      const emailQuery = query(collection(db as Firestore, 'students'), where('email', '==', userData.email));
      const emailSnapshot = await getDocs(emailQuery);
      if (!emailSnapshot.empty) {
        const matched = emailSnapshot.docs[0];
        const data = await formatStudentData(matched.id, matched.data());
        setCachedData(cacheKey, data);
        return data;
      }
    }

    return null;
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
    const db = await getDatabase();
    const studentsCol = collection(db as Firestore, 'students');
    const studentSnapshot = await getDocs(studentsCol);
    const data = studentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
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
    const db = await getDatabase();
    const studentDoc = await getDoc(doc(db as Firestore, 'students', id));

    if (studentDoc.exists()) {
      const data = studentDoc.data();

      // Handle Firestore Timestamps
      const result = {
        id: studentDoc.id,
        uid: studentDoc.id,
        ...data,
        // Robust field mapping
        phoneNumber: data.phoneNumber || data.phone || '',
        phone: data.phone || data.phoneNumber || '',
        fullName: data.fullName || data.name || '',
        name: data.name || data.fullName || '',
        email: data.email || data.emailAddress || '',
        address: data.address || data.location || '',
        busId: data.busId || data.assignedBusId || data.busAssigned || '',
        busAssigned: data.busAssigned || data.busId || data.assignedBusId || '',
        routeId: data.routeId || data.assignedRouteId || '',
        assignedRouteId: data.assignedRouteId || data.routeId || '',
        enrollmentId: data.enrollmentId || '',
        pickupPoint: data.pickupPoint || data.stopName || data.stopId || '',
        validUntil: formatTimestamp(data.validUntil),
        createdAt: formatTimestamp(data.createdAt),
        updatedAt: formatTimestamp(data.updatedAt)
      };
      setCachedData(cacheKey, result);
      return result;
    }
    return null;
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

// Drivers collection functions
export const getAllDrivers = async (): Promise<Driver[]> => {
  const cacheKey = 'all_drivers';
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();
    const driversCol = collection(db as Firestore, 'drivers');
    const driverSnapshot = await getDocs(driversCol);
    const data = driverSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Driver));
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return [];
  }
};

export const getDriverById = async (id: string): Promise<any | null> => {
  const cacheKey = `driver_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();
    const driverDoc = await getDoc(doc(db as Firestore, 'drivers', id));

    if (driverDoc.exists()) {
      const data = driverDoc.data();
      const result = {
        id: driverDoc.id,
        uid: driverDoc.id,
        ...data,
        // Robust field mapping
        fullName: data.fullName || data.name || '',
        name: data.name || data.fullName || '',
        phone: data.phone || data.phoneNumber || '',
        email: data.email || data.emailAddress || '',
        routeId: data.routeId || data.assignedRouteId || '',
        assignedRouteId: data.assignedRouteId || data.routeId || '',
        busId: data.busId || data.assignedBusId || '',
        assignedBusId: data.assignedBusId || data.busId || '',
        shift: (() => {
          const { normalizeShift } = require('@/lib/utils/shift-utils');
          const raw = data.shift || data.assignedShift || '';
          if (!raw) return '';
          return normalizeShift(raw);
        })(),
        employeeId: data.employeeId || data.driverId || ''
      };
      setCachedData(cacheKey, result);
      return result;
    }
    return null;
  } catch (error) {
    console.error('Error fetching driver:', error);
    return null;
  }
};

export const deleteDriver = async (id: string): Promise<boolean> => {
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
      console.error('Delete driver API error:', errorData);
      return false;
    }

    const result = await response.json();
    console.log('Driver deleted successfully:', result);
    if (result.success) {
      invalidateCache(`driver_${id}`);
      invalidateCache('all_drivers');
    }
    return result.success;
  } catch (error) {
    console.error('Error deleting driver:', error);
    return false;
  }
};

export const updateDriver = async (id: string, data: Partial<Driver>): Promise<boolean> => {
  try {
    const db = await getDatabase();
    const updatedByEntry = createUpdatedByEntryClient();
    await updateDoc(doc(db as Firestore, 'drivers', id), {
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: arrayUnion(updatedByEntry)
    } as any);
    invalidateCache(`driver_${id}`);
    invalidateCache('all_drivers');
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
    const db = await getDatabase();
    const moderatorsCol = collection(db as Firestore, 'moderators');
    const moderatorSnapshot = await getDocs(moderatorsCol);
    const data = moderatorSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Moderator));
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
    const db = await getDatabase();
    const moderatorDoc = await getDoc(doc(db as Firestore, 'moderators', id));
    const data = moderatorDoc.exists() ? { id: moderatorDoc.id, ...moderatorDoc.data() } as Moderator : null;
    if (data) setCachedData(cacheKey, data);
    return data;
  } catch (error: any) {
    // Suppress permission-denied errors (expected for students who can't read moderator profiles)
    if (error?.code !== 'permission-denied') {
      console.error('Error fetching moderator:', error);
    }
    return null;
  }
};

export const getAdminById = async (id: string): Promise<any | null> => {
  const cacheKey = `admin_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();
    const adminDoc = await getDoc(doc(db as Firestore, 'admins', id));
    const data = adminDoc.exists() ? { id: adminDoc.id, ...adminDoc.data() } : null;
    if (data) setCachedData(cacheKey, data);
    return data;
  } catch (error: any) {
    // Suppress permission-denied errors
    if (error?.code !== 'permission-denied') {
      console.error('Error fetching admin:', error);
    }
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
    const db = await getDatabase();
    const updatedByEntry = await createUpdatedByEntryClient();
    await updateDoc(doc(db as Firestore, 'moderators', id), {
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: arrayUnion(updatedByEntry)
    } as any);
    return true;
  } catch (error) {
    console.error('Error updating moderator:', error);
    return false;
  }
};

// Buses collection functions
export const getAllBuses = async (): Promise<Bus[]> => {
  const cacheKey = 'all_buses';
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    if (!checkClientAuth()) return [];

    const db = await getDatabase();
    const busesCol = collection(db as Firestore, 'buses');
    const busSnapshot = await getDocs(busesCol);
    const data = busSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bus));
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching buses:', error);
    return [];
  }
};

export const getBusById = async (id: string): Promise<Bus | null> => {
  const cacheKey = `bus_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();
    const busDoc = await getDoc(doc(db as Firestore, 'buses', id));
    const data = busDoc.exists() ? { id: busDoc.id, ...busDoc.data() } as Bus : null;
    if (data) setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching bus:', error);
    return null;
  }
};

// Get buses by route ID
export const getBusesByRouteId = async (routeId: string): Promise<Bus[]> => {
  const cacheKey = `buses_route_${routeId}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();
    const busesCol = collection(db as Firestore, 'buses');
    const q = query(busesCol, where('routeId', '==', routeId));
    const busSnapshot = await getDocs(q);
    const data = busSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bus));
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching buses by route ID:', error);
    return [];
  }
};

export const deleteBus = async (id: string): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await deleteDoc(doc(db as Firestore, 'buses', id));
    invalidateCache(`bus_${id}`);
    invalidateCache('all_buses');
    return true;
  } catch (error) {
    console.error('Error deleting bus:', error);
    return false;
  }
};

export const updateBus = async (id: string, data: Partial<Bus>): Promise<boolean> => {
  try {
    const db = await getDatabase();
    const updatedByEntry = await createUpdatedByEntryClient();
    await updateDoc(doc(db as Firestore, 'buses', id), {
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: arrayUnion(updatedByEntry)
    } as any);
    invalidateCache(`bus_${id}`);
    invalidateCache('all_buses');
    return true;
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
    if (!checkClientAuth()) return [];

    const db = await getDatabase();

    // Fetch from routes collection
    const routesCol = collection(db as Firestore, 'routes');
    // Optional: Sort by routeId or createdAt
    const routeSnapshot = await getDocs(routesCol);

    const data = routeSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Route));
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching routes:', error);
    return [];
  }
};

export const getRouteById = async (id: string): Promise<Route | null> => {
  const cacheKey = `route_${id}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();

    // First, try fetching from routes collection
    const routeDoc = await getDoc(doc(db as Firestore, 'routes', id));
    if (routeDoc.exists()) {
      const data = { id: routeDoc.id, ...routeDoc.data() } as Route;
      setCachedData(cacheKey, data);
      return data;
    }

    // If not found, return null (Routes should be in routes collection)
    return null;
  } catch (error) {
    console.error('Error fetching route:', error);
    return null;
  }
};

export const deleteRoute = async (id: string): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await deleteDoc(doc(db as Firestore, 'routes', id));
    invalidateCache(`route_${id}`);
    invalidateCache('all_routes');
    return true;
  } catch (error) {
    console.error('Error deleting route:', error);
    return false;
  }
};

export const updateRoute = async (id: string, data: Partial<Route>): Promise<boolean> => {
  try {
    const db = await getDatabase();
    const updatedByEntry = await createUpdatedByEntryClient();
    await updateDoc(doc(db as Firestore, 'routes', id), {
      ...data,
      updatedAt: new Date().toISOString(),
      updatedBy: arrayUnion(updatedByEntry)
    } as any);
    invalidateCache(`route_${id}`);
    invalidateCache('all_routes');
    return true;
  } catch (error) {
    console.error('Error updating route:', error);
    return false;
  }
};

// Applications collection functions  
export const getAllApplications = async (): Promise<Application[]> => {
  try {
    const db = await getDatabase();
    const applicationsCol = collection(db as Firestore, 'applications');
    const applicationSnapshot = await getDocs(applicationsCol);
    return applicationSnapshot.docs.map(doc => ({ applicationId: doc.id, ...doc.data() } as Application));
  } catch (error) {
    console.error('Error fetching applications:', error);
    return [];
  }
};

export const getApplicationById = async (id: string): Promise<Application | null> => {
  try {
    const db = await getDatabase();
    const applicationDoc = await getDoc(doc(db as Firestore, 'applications', id));
    return applicationDoc.exists() ? { applicationId: applicationDoc.id, ...applicationDoc.data() } as Application : null;
  } catch (error) {
    console.error('Error fetching application:', error);
    return null;
  }
};

export const updateApplication = async (id: string, data: Partial<Application>): Promise<boolean> => {
  try {
    const db = await getDatabase();
    await updateDoc(doc(db as Firestore, 'applications', id), data as any);
    return true;
  } catch (error) {
    console.error('Error updating application:', error);
    return false;
  }
};

export const approveStudentApplication = async (applicationId: string, approvedBy: string): Promise<boolean> => {
  try {
    // Get current user for authentication
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user');
      return false;
    }

    const token = await currentUser.getIdToken();

    // Call the API endpoint which handles image deletion
    const response = await fetch('/api/applications/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        applicationId,
        approverName: currentUser.displayName || currentUser.email || 'Admin',
        approverId: approvedBy,
        notes: 'Application approved via admin panel'
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error approving application:', errorData.error);
      return false;
    }

    const result = await response.json();
    console.log('Application approved successfully:', result);
    return true;
  } catch (error: any) {
    console.error('Error approving application:', error.message || error);
    return false;
  }
};

export const rejectStudentApplication = async (applicationId: string, rejectedBy: string, reason: string): Promise<boolean> => {
  try {
    // Get current user for authentication
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user');
      return false;
    }

    const token = await currentUser.getIdToken();

    // Call the API endpoint
    const response = await fetch('/api/applications/reject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        applicationId,
        rejectorName: currentUser.displayName || currentUser.email || 'Admin',
        rejectorId: rejectedBy,
        reason
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error rejecting application:', errorData.error);
      return false;
    }

    const result = await response.json();
    console.log('Application rejected successfully:', result);
    return true;
  } catch (error: any) {
    console.error('Error rejecting application:', error.message || error);
    return false;
  }
};

export const createApplication = async (applicationData: Omit<Application, 'applicationId'>): Promise<string | null> => {
  try {
    const db = await getDatabase();
    const applicationId = createRandomId();
    await setDoc(doc(db as Firestore, 'applications', applicationId), {
      ...applicationData,
      applicationId,
      createdAt: getCurrentTimestamp()
    });
    return applicationId;
  } catch (error) {
    console.error('Error creating application:', error);
    return null;
  }
};

export const getApplicationsByApplicantUID = async (applicantUID: string): Promise<Application[]> => {
  const cacheKey = `apps_uid_${applicantUID}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const db = await getDatabase();
    const applicationsCol = collection(db as Firestore, 'applications');
    const q = query(applicationsCol, where('applicantUID', '==', applicantUID));
    const applicationSnapshot = await getDocs(q);
    const data = applicationSnapshot.docs.map(doc => ({ applicationId: doc.id, ...doc.data() } as Application));
    setCachedData(cacheKey, data);
    return data;
  } catch (error) {
    console.error('Error fetching applications by applicant UID:', error);
    return [];
  }
};

// Add missing functions
export const addRoute = async (routeData: Omit<Route, 'id'>): Promise<string | null> => {
  try {
    const db = await getDatabase();
    const routeId = routeData.routeId || createRandomId();
    await setDoc(doc(db as Firestore, 'routes', routeId), {
      ...routeData,
      routeId,
      createdAt: getCurrentTimestamp()
    });
    return routeId;
  } catch (error) {
    console.error('Error creating route:', error);
    return null;
  }
};



export const getStudentsByBusId = async (busId: string): Promise<Student[]> => {
  const cacheKey = `students_bus_${busId}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    console.log('🔍 getStudentsByBusId called with busId:', busId);
    const db = await getDatabase();
    const studentsCol = collection(db as Firestore, 'students');

    // Try multiple field names for bus assignment
    const queries = [
      query(studentsCol, where('busId', '==', busId)),
      query(studentsCol, where('assignedBusId', '==', busId)),
      query(studentsCol, where('assignedBus', '==', busId)),
      query(studentsCol, where('currentBusId', '==', busId))
    ];

    let allStudents: any[] = [];

    for (const q of queries) {
      try {
        const studentSnapshot = await getDocs(q);
        const students = studentSnapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            uid: doc.id,
            ...data,
            // Ensure profile picture fields are properly mapped
            profilePicture: data.profilePicture || data.profilePhotoUrl,
            profilePhotoUrl: data.profilePhotoUrl || data.profilePicture,
            // Map other fields properly
            fullName: data.fullName || data.name,
            email: data.email || data.emailAddress,
            phone: data.phone || data.phoneNumber,
            enrollmentId: data.enrollmentId || data.studentId
          } as Student;
        });

        allStudents = [...allStudents, ...students];
      } catch (error) {
        console.warn('Query failed for one of the bus ID fields:', error);
      }
    }

    // Remove duplicates based on document ID
    const uniqueStudents = allStudents.filter((student, index, self) =>
      index === self.findIndex(s => s.id === student.id)
    );

    setCachedData(cacheKey, uniqueStudents);
    return uniqueStudents;
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
