/**
 * Centralized Profile Data Service
 * Fetches and normalizes user profile data with reference resolution
 */

import { getById as getRouteById } from '@/domains/route';
import { getAdminById } from '@/domains/identity';

export type UserRole = 'student' | 'driver' | 'moderator' | 'admin';

export interface BaseProfile {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  profilePhotoUrl?: string;
  role: UserRole;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface StudentProfile extends BaseProfile {
  role: 'student';
  enrollmentId?: string;
  faculty?: string;
  department?: string;
  semester?: string | number;
  dob?: Date | null;
  gender?: string;
  bloodGroup?: string;
  parentName?: string;
  parentPhone?: string;
  address?: string;
  routeId?: string;
  routeName?: string;
  routeStops?: string[];
  stopId?: string;
  busId?: string;
  busNumber?: string;
  busCapacity?: string;
  assignedShift?: string;
  sessionStartYear?: number;
  sessionEndYear?: number;
  validUntil?: Date | null;
  durationYears?: number;
  paymentAmount?: number;
  paymentVerified?: boolean;
  paymentCurrency?: string;
  status?: string;
  approvedBy?: string;
  approvedAt?: Date | null;
  sessionHistory?: SessionRecord[];
}

export interface DriverProfile extends BaseProfile {
  approvedBy: string;
  role: 'driver';
  licenseNumber?: string;
  busId?: string | string[];
  assignedBusIds?: string[];
  busNumbers?: string[];
  assignedRouteId?: string | string[];
  assignedRouteIds?: string[];
  routeNames?: string[];
  shift?: string;
  joiningDate?: Date | null;
  yearsOfService?: string;
  altPhone?: string;
  dob?: Date | null;
  driverId?: string;
  employeeId?: string;
  aadharNumber?: string;
}

export interface ModeratorProfile extends BaseProfile {
  role: 'moderator';
  employeeId?: string;
  joiningDate?: Date | null;
  assignedFaculty?: string;
  yearsOfService?: string;
  altPhone?: string;
  dob?: Date | null;
  recentActions?: ActionLog[];
}

export interface AdminProfile extends BaseProfile {
  role: 'admin';
  employeeId?: string;
  joiningDate?: Date | null;
  assignedFaculty?: string;
  yearsOfService?: string;
  altPhone?: string;
  dob?: Date | null;
  recentActions?: ActionLog[];
}

export interface SessionRecord {
  year: string;
  approvedBy?: string;
  approvedAt?: Date | null;
}

export interface ActionLog {
  action: string;
  timestamp: Date;
  target?: string;
}

export type Profile = StudentProfile | DriverProfile | ModeratorProfile | AdminProfile;

interface FetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
}

/**
 * Convert Firestore Timestamp to Date
 */
function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate && typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/**
 * Calculate years of service from joining date
 */
function calculateYearsOfService(joiningDate: Date | null): string {
  if (!joiningDate) return 'Not available';
  
  const now = new Date();
  const diff = now.getTime() - joiningDate.getTime();
  const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365));
  const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365)) / (1000 * 60 * 60 * 24 * 30));
  
  if (years === 0) {
    return `${months} month${months !== 1 ? 's' : ''}`;
  }
  if (months === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  }
  return `${years} year${years !== 1 ? 's' : ''} ${months} month${months !== 1 ? 's' : ''}`;
}

/**
 * Resolve Bus document by ID with in-memory caching
 */
const busCache = new Map<string, { data: any, timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute

async function resolveBus(busId: string): Promise<any | null> {
  if (!busId) return null;
  
  const now = Date.now();
  const cached = busCache.get(busId);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  try {
    // Clean up busId - handle different formats
    let cleanBusId = busId;
    
    // If busId looks like "Bus-8 (AS-01-KC-0757)", extract the Bus-8 part
    if (busId.includes(' (')) {
      cleanBusId = busId.split(' (')[0]; // Gets "Bus-8" from "Bus-8 (AS-01-KC-0757)"
    }
    
    // If busId is like "bus_6", convert to "Bus-6"
    if (cleanBusId.startsWith('bus_')) {
      const number = cleanBusId.replace('bus_', '');
      cleanBusId = `Bus-${number}`;
    }
    
    // Try to fetch the bus via API
    const res = await fetch(`/api/buses/${encodeURIComponent(cleanBusId)}`);
    if (res.ok) {
      const busData = await res.json();
      const result = { id: busData.id || cleanBusId, ...busData };
      busCache.set(busId, { data: result, timestamp: now });
      return result;
    }
    
    // If not found, try with the original busId
    if (cleanBusId !== busId) {
      const originalRes = await fetch(`/api/buses/${encodeURIComponent(busId)}`);
      if (originalRes.ok) {
        const busData = await originalRes.json();
        const result = { id: busData.id || busId, ...busData };
        busCache.set(busId, { data: result, timestamp: now });
        return result;
      }
    }
    
    const result = null;
    busCache.set(busId, { data: result, timestamp: now });
    return result;
  } catch (error) {
    console.error('Error resolving bus:', error);
    return null;
  }
}

/**
 * Resolve Route document by ID with in-memory caching
 */
const routeCache = new Map<string, { data: any, timestamp: number }>();

export function clearRouteCache(routeId?: string): void {
  if (routeId) {
    routeCache.delete(routeId);
  } else {
    routeCache.clear();
  }
}

async function resolveRoute(routeId: string): Promise<any | null> {
  if (!routeId) return null;

  const now = Date.now();
  const cached = routeCache.get(routeId);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }

  try {
    // Clean up routeId - handle different formats
    let cleanRouteId = routeId;
    
    // If routeId is like "route_6", convert to "Route-6"
    if (cleanRouteId.startsWith('route_')) {
      const number = cleanRouteId.replace('route_', '');
      cleanRouteId = `Route-${number}`;
    }
    
    // Try to fetch the route document via dataService (Postgres)
    const routeData = await getRouteById(cleanRouteId);
    if (routeData) {
      routeCache.set(routeId, { data: routeData, timestamp: now });
      return routeData;
    }
    
    // If not found, try with the original routeId
    if (cleanRouteId !== routeId) {
      const originalData = await getRouteById(routeId);
      if (originalData) {
        routeCache.set(routeId, { data: originalData, timestamp: now });
        return originalData;
      }
    }
    
    const result = null;
    routeCache.set(routeId, { data: result, timestamp: now });
    return result;
  } catch (error) {
    console.error('Error resolving route:', error);
    return null;
  }
}

/**
 * Get session history for a student
 */
async function getSessionHistory(uid: string): Promise<SessionRecord[]> {
  // This would fetch from a sessionHistory subcollection or field
  // For now, return empty array - implement based on your schema
  return [];
}

/**
 * Get recent actions for admin/moderator
 */
async function getRecentActions(uid: string, limit: number = 10): Promise<ActionLog[]> {
  // This would fetch from an actions/logs collection
  // For now, return empty array - implement based on your schema
  return [];
}

/**
 * Fetch Student Profile with all references resolved
 *
 * Migration status: COMPLETED — reads student data from PostgreSQL
 * (student_profiles table via D3 Student domain).
 * Bus/route references still resolved from Firestore (separate domains).
 */
async function fetchStudentProfile(uid: string): Promise<StudentProfile | null> {
  try {
    let student: any = null;

    if (typeof window !== 'undefined') {
      const res = await fetch(`/api/students/${uid}`);
      if (!res.ok) return null;
      student = await res.json();
      student.fullName = student.name;
    } else {
      const { getByUid } = await import('@/domains/student');
      student = await getByUid(uid);
    }

    if (!student) return null;

    // Resolve bus reference (bus domain still in Firestore)
    let busNumber: string | undefined;
    let busCapacity: string | undefined;
    const targetBusId = student.busId || student.assignedBusId;
    if (targetBusId) {
      const bus = await resolveBus(targetBusId);
      if (bus) {
        busNumber = bus.busNumber || bus.id;
        if (bus.capacity) {
          busCapacity = typeof bus.capacity === 'string' ? bus.capacity : `${bus.currentMembers || 0}/${bus.totalCapacity || bus.capacity}`;
        }
      }
    }

    // Resolve route reference (route domain still in Firestore)
    let routeName: string | undefined;
    let routeStops: string[] | undefined;
    const targetRouteId = student.routeId || student.assignedRouteId;
    if (targetRouteId) {
      const route = await resolveRoute(targetRouteId);
      if (route) {
        routeName = route.routeName || route.routeNumber || route.id;
        routeStops = route.stops || [];
      }
    }

    // Get session history
    const sessionHistory = await getSessionHistory(uid);

    const dob = toDate(student.dob);

    return {
      uid,
      role: 'student',
      fullName: student.fullName || student.name || 'Unknown',
      email: student.email || '',
      phone: student.phone || '',
      profilePhotoUrl: student.profilePhotoUrl,
      createdAt: toDate(student.createdAt),
      updatedAt: toDate(student.updatedAt),
      enrollmentId: student.enrollmentId,
      faculty: student.faculty,
      department: student.department,
      semester: student.semester,
      dob,
      gender: student.gender,
      bloodGroup: student.bloodGroup,
      parentName: student.parentName,
      parentPhone: student.parentPhone,
      address: student.address,
      routeId: student.routeId || student.assignedRouteId,
      routeName,
      routeStops,
      stopId: student.stopId,
      busId: student.busId || student.assignedBusId,
      busNumber,
      busCapacity,
      assignedShift: student.shift,
      sessionStartYear: student.sessionStartYear,
      sessionEndYear: student.sessionEndYear,
      validUntil: toDate(student.validUntil),
      durationYears: typeof student.sessionDuration === 'string' ? Number(student.sessionDuration) || undefined : student.sessionDuration,
      paymentAmount: student.paymentAmount,
      paymentVerified: student.paymentVerified || false,
      paymentCurrency: student.paymentCurrency || 'INR',
      status: student.status,
      approvedBy: student.approvedBy,
      approvedAt: toDate(student.approvedAt),
      sessionHistory,
    };
  } catch (error) {
    console.error('Error fetching student profile:', error);
    return null;
  }
}

/**
 * Fetch Driver Profile with all references resolved
 */
async function fetchDriverProfile(uid: string): Promise<DriverProfile | null> {
  try {
    const res = await fetch(`/api/drivers/${uid}`);
    if (!res.ok) return null;

    const { driver: data } = await res.json();
    if (!data) return null;
    
    // Debug log to see what data is being fetched
    console.log('Driver profile data from API:', data);
    console.log('Approved by field:', data.approvedBy);

    // Resolve bus references - handle multiple fields but deduplicate
    const busIds: string[] = [];
    
    // Collect all possible bus IDs from different fields
    if (data.assignedBusIds && Array.isArray(data.assignedBusIds)) {
      busIds.push(...data.assignedBusIds);
    }
    if (data.busId && !busIds.includes(data.busId)) {
      busIds.push(data.busId);
    }
    if (data.assignedBusId && !busIds.includes(data.assignedBusId)) {
      busIds.push(data.assignedBusId);
    }
    
    // Resolve bus numbers from bus documents and deduplicate
    const busNumbers: string[] = [];
    const processedBusNumbers = new Set<string>();
    
    for (const busId of busIds) {
      const bus = await resolveBus(busId);
      if (bus) {
        const busNumber = bus.busNumber || bus.id;
        // Extract actual bus number if it's in format "Bus-X (AS-01-FC-7132)"
        const actualBusNumber = busNumber.includes('(') ? 
          busNumber.match(/\(([^)]+)\)/)?.[1] || busNumber : 
          busNumber;
        
        if (!processedBusNumbers.has(actualBusNumber)) {
          busNumbers.push(actualBusNumber);
          processedBusNumbers.add(actualBusNumber);
        }
      } else if (busId.includes('(') && busId.includes(')')) {
        // If busId contains bus number in parentheses, extract it
        const match = busId.match(/\(([^)]+)\)/);
        if (match && !processedBusNumbers.has(match[1])) {
          busNumbers.push(match[1]);
          processedBusNumbers.add(match[1]);
        }
      }
    }

    // Resolve route references - handle multiple fields but deduplicate
    const routeIds: string[] = [];
    
    // Collect all possible route IDs from different fields
    if (data.assignedRouteIds && Array.isArray(data.assignedRouteIds)) {
      routeIds.push(...data.assignedRouteIds);
    }
    if (data.routeId && !routeIds.includes(data.routeId)) {
      routeIds.push(data.routeId);
    }
    if (data.assignedRouteId && !routeIds.includes(data.assignedRouteId)) {
      routeIds.push(data.assignedRouteId);
    }

    // Resolve route names from route documents and deduplicate
    const routeNames: string[] = [];
    const processedRouteNames = new Set<string>();
    
    for (const routeId of routeIds) {
      const route = await resolveRoute(routeId);
      if (route) {
        const routeName = route.routeName || route.routeNumber || route.id;
        if (!processedRouteNames.has(routeName)) {
          routeNames.push(routeName);
          processedRouteNames.add(routeName);
        }
      }
    }
    
    // Also check if bus has embedded route data
    if (busNumbers.length > 0) {
      for (const busId of busIds) {
        const bus = await resolveBus(busId);
        if (bus?.route?.routeName && !routeNames.includes(bus.route.routeName)) {
          routeNames.push(bus.route.routeName);
        }
      }
    }

    const joiningDate = toDate(data.joiningDate);
    const yearsOfService = calculateYearsOfService(joiningDate);

    return {
      uid,
      role: 'driver',
      fullName: data.fullName || data.name || 'Unknown',
      email: data.email || '',
      phone: data.phoneNumber || data.phone || '',
      profilePhotoUrl: data.profilePhotoUrl || data.profilePicture,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      approvedBy: data.approvedBy || 'Not available',
      licenseNumber: data.licenseNumber,
      busId: busIds.length > 0 ? busIds[0] : undefined,
      assignedBusIds: busIds,
      busNumbers,
      assignedRouteId: routeIds.length > 0 ? routeIds[0] : undefined,
      assignedRouteIds: routeIds,
      routeNames,
      shift: data.shift,
      joiningDate,
      yearsOfService,
      altPhone: data.altPhone || data.alternatePhone,
      dob: toDate(data.dob),
      driverId: data.driverId || data.employeeId,
      aadharNumber: data.aadharNumber,
    };
  } catch (error) {
    console.error('Error fetching driver profile:', error);
    return null;
  }
}

/**
 * Fetch Moderator Profile
 */
async function fetchModeratorProfile(uid: string): Promise<ModeratorProfile | null> {
  try {
    const res = await fetch(`/api/moderators/${uid}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data) return null;
    const joiningDate = toDate(data.joiningDate);
    const yearsOfService = calculateYearsOfService(joiningDate);
    const recentActions = await getRecentActions(uid);

    return {
      uid,
      role: 'moderator',
      fullName: data.fullName || data.name || 'Unknown',
      email: data.email || '',
      phone: data.phoneNumber || data.phone || '',
      profilePhotoUrl: data.profilePhotoUrl || data.profilePicture,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      employeeId: data.employeeId,
      joiningDate,
      assignedFaculty: data.assignedFaculty || data.faculty,
      yearsOfService,
      altPhone: data.altPhone || data.alternatePhone,
      dob: toDate(data.dob),
      recentActions,
    };
  } catch (error) {
    console.error('Error fetching moderator profile:', error);
    return null;
  }
}

/**
 * Fetch Admin Profile
 */
async function fetchAdminProfile(uid: string): Promise<AdminProfile | null> {
  try {
    const data = await getAdminById(uid);
    if (!data) return null;
    const joiningDate = toDate(data.joiningDate);
    const yearsOfService = calculateYearsOfService(joiningDate);
    const recentActions = await getRecentActions(uid);

    return {
      uid,
      role: 'admin',
      fullName: data.fullName || data.name || 'Unknown',
      email: data.email || '',
      phone: data.phoneNumber || data.phone || '',
      profilePhotoUrl: data.profilePhotoUrl || data.profilePicture,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
      employeeId: data.employeeId,
      joiningDate,
      assignedFaculty: data.assignedFaculty || data.faculty,
      yearsOfService,
      altPhone: data.altPhone || data.alternatePhone,
      dob: toDate(data.dob),
      recentActions,
    };
  } catch (error) {
    console.error('Error fetching admin profile:', error);
    return null;
  }
}

/**
 * Main function to get user profile by UID and role
 */
export async function getUserProfile(uid: string, role: UserRole): Promise<Profile | null> {
  switch (role) {
    case 'student':
      return fetchStudentProfile(uid);
    case 'driver':
      return fetchDriverProfile(uid);
    case 'moderator':
      return fetchModeratorProfile(uid);
    case 'admin':
      return fetchAdminProfile(uid);
    default:
      return null;
  }
}

/**
 * Format date to DD MMM YYYY
 */
export function formatDate(date: Date | null | undefined): string {
  if (!date) return 'Not provided';
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = date.getDate();
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  
  return `${d} ${m} ${y}`;
}

/**
 * Check if session is expired
 */
export function isSessionExpired(validUntil: Date | null | undefined): boolean {
  if (!validUntil) return false;
  return validUntil.getTime() < Date.now();
}

/**
 * Format currency
 */
export function formatCurrency(amount: number | undefined, currency: string = 'INR'): string {
  if (amount === undefined || amount === null) return 'Not provided';
  
  const symbol = currency === 'INR' ? '₹' : '$';
  return `${symbol}${amount.toLocaleString()}`;
}
