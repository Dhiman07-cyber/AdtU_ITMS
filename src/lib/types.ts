import { Timestamp } from 'firebase/firestore';

// Base User type
export interface User {
  uid: string;
  email: string;
  role: 'student' | 'driver' | 'moderator' | 'admin';
  createdAt: Timestamp | string;
  [key: string]: any;
}

// Student type
export interface Student {
  id: string;
  uid?: string;
  name: string;
  fullName?: string;
  email: string;
  phone?: string;
  parentPhone?: string;
  faculty?: string;
  department?: string;
  gender?: string;
  dob?: string;
  enrollmentId?: string;
  bloodGroup?: string;
  address?: string;
  busId?: string;
  routeId?: string;
  stopName?: string;
  shift?: 'Morning' | 'Evening';
  status?: 'active' | 'inactive' | 'suspended' | 'soft_blocked' | 'pending_deletion';
  profilePhotoUrl?: string;
  photoURL?: string;
  avatar?: string;
  profilePicture?: string;
  courseDetails?: string;
  joiningDate?: string;
  // Bus Session System Fields
  sessionDuration?: number | string;
  sessionStartYear?: number;
  sessionEndYear?: number;
  validUntil?: string;
  pickupPoint?: string;

  // Per-Student Computed Deadline Fields (populated by scheduler)
  // These are computed from sessionEndYear + config and stored for efficient querying
  computed?: {
    serviceExpiryDate?: string;      // ISO string - when service expires
    renewalDeadlineDate?: string;    // ISO string - renewal deadline
    softBlockDate?: string;          // ISO string - when access blocks
    hardDeleteDate?: string;         // ISO string - ALWAYS in sessionEndYear + 1
    urgentWarningDate?: string;      // ISO string - when urgent warnings start
    computedAt?: string;             // When these were last calculated
    configVersion?: string;          // Which config version was used
  };

  // Deadline Enforcement Status Tracking
  softBlockedAt?: string;            // Timestamp when soft block was applied
  hardDeleteScheduledAt?: string;    // Timestamp when hard delete was scheduled

  // Additional fields for consistency
  approvedBy?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  [key: string]: any;
}

// Driver type
export interface Driver {
  id: string;
  uid?: string;
  name: string;
  fullName?: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  licenseNumber?: string;
  assignedBusId?: string;
  assignedRouteId?: string;
  busId?: string;
  routeId?: string;
  busAssigned?: string;
  driverId?: string;
  joiningDate?: string;
  shift?: 'Morning' | 'Evening' | 'Both' | string;
  status?: 'active' | 'inactive' | 'suspended';
  profilePhotoUrl?: string;
  tripActive?: boolean;
  activeTripId?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  [key: string]: any;
}

// Moderator type
export interface Moderator {
  id: string;
  uid?: string;
  name: string;
  fullName?: string;
  email: string;
  phone?: string;
  employeeId?: string;
  staffId?: string;
  managingTeam?: string;
  teamName?: string;
  status?: 'active' | 'inactive' | 'suspended';
  profilePhotoUrl?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  [key: string]: any;
}

// Bus type
export interface Bus {
  id?: string;
  busId: string;
  busNumber: string;
  model?: string;
  year?: string;
  capacity: number;
  driverUID?: string;
  driverName?: string;
  routeId?: string;
  routeRef?: any; // Reference to the route document
  routeName?: string; // Legacy/Display
  status: 'active' | 'inactive' | 'maintenance' | 'enroute' | 'idle' | 'Active' | 'Inactive' | 'Maintenance';
  currentStudents?: string[];
  currentPassengerCount?: number;
  lastStartedAt?: Timestamp | string;
  lastEndedAt?: Timestamp | string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  [key: string]: any;
}

// Route type with stops
export interface Route {
  id?: string;
  routeId: string;
  routeName: string;
  route?: string;
  numberOfBuses?: number;

  status: 'active' | 'inactive';
  stops: Array<{
    stopId?: string;
    name: string;
    sequence?: number;
    lat: number;
    lng: number;
  }>;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
  [key: string]: any;
}

// Application Status type
export type ApplicationStatus =
  | 'draft'
  | 'awaiting_verification'
  | 'verified'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled';

// Application type
export interface Application {
  applicationId: string;
  applicantUID: string;
  applicantEmail?: string;
  status: ApplicationStatus;

  // Form data
  formData: {
    fullName: string;
    faculty: string;
    department: string;
    gender: string;
    dob: string;
    phone: string;
    altPhone?: string;
    parentName: string;
    parentPhone: string;
    enrollmentId: string;
    bloodGroup: string;
    address: string;
    routeId?: string;
    stopName?: string;
    [key: string]: any;
  };

  // Payment evidence (moderator verified in person)
  paymentEvidenceProvided: boolean;

  // Verification details
  verification?: {
    method: 'moderator_code';
    moderatorUID: string;
    moderatorName?: string;
    moderatorEMPID?: string;
    pendingVerifier?: string; // Format: "{Name} {EMPID}"
    codeId?: string;
    codeHash?: string;
    codeStatus?: 'pending' | 'verified' | 'expired' | 'failed';
    verifiedAt?: Timestamp | string;
    codeGeneratedAt?: Timestamp | string;
    codeExpiresAt?: Timestamp | string;
    attempts?: number;
    maxAttempts?: number;
  };

  // Approval
  approvedBy?: string;
  approvedAt?: Timestamp | string;

  // Audit trail
  auditLog?: Array<{
    action: string;
    actorId: string;
    actorName?: string;
    timestamp: Timestamp | string;
    metadata?: Record<string, any>;
  }>;

  // Timestamps
  createdAt: Timestamp | string;
  updatedAt?: Timestamp | string;
  submittedAt?: Timestamp | string;

  [key: string]: any;
}

// Invitation type
export interface Invitation {
  id: string;
  email: string;
  role: 'student' | 'driver' | 'moderator';
  status: 'pending' | 'accepted' | 'expired';
  invitedBy: string;
  createdAt: Timestamp | string;
  expiresAt?: Timestamp | string;
  acceptedAt?: Timestamp | string;
  [key: string]: any;
}

// Trip type
export interface Trip {
  id: string;
  driverUID: string;
  driverName?: string;
  busId: string;
  routeId: string;
  routeName?: string;
  shift: 'morning' | 'evening';
  status: 'active' | 'completed' | 'cancelled';
  startTime: Timestamp | string;
  endTime?: Timestamp | string;
  studentCount?: number;
  students?: string[];
  locations?: Array<{
    timestamp: Timestamp | string;
  }>;
  createdAt: Timestamp | string;
  [key: string]: any;
}

// FCM Token type
export interface FCMToken {
  id?: string;
  uid: string;
  token: string;
  deviceId?: string;
  platform?: 'web' | 'android' | 'ios';
  createdAt: Timestamp | string;
  updatedAt?: Timestamp | string;
  [key: string]: any;
}

// Bus Pass Token type
export interface BusPassToken {
  tokenId: string;
  studentUid: string;
  issuedAt: Timestamp | string;
  expiresAt: Timestamp | string;
  intendedBusId?: string;
  singleUse: boolean;
  used: boolean;
  usedAt?: Timestamp | string;
  usedBy?: string;
  scanCount: number;
  createdByDevice?: {
    os?: string;
    appVersion?: string;
  };
  deleted: boolean;
  [key: string]: any;
}

// Bus Pass Verification Result type
export interface BusPassVerificationResult {
  status: 'success' | 'expired' | 'used' | 'invalid' | 'not_assigned' | 'session_expired';
  message: string;
  studentData?: {
    routeId: any;
    uid: string;
    fullName: string;
    enrollmentId: string;
    phone: string;
    phoneNumber?: string;
    mobileNumber?: string;
    parentPhone: string;
    dob?: string;
    gender?: string;
    profilePhotoUrl: string;
    assignedBus: string;
    assignedRoute: string;
    assignedShift: string;
    busId?: string;
    shift?: string;
    routeName?: string;
    sessionStart?: string;
    sessionEnd?: string;
    validUntil?: string;
    serviceDurationYears?: number;
    status: string;
  };
  isAssigned?: boolean;
  sessionActive?: boolean;
}

// Rate Limit Entry type
export interface RateLimitEntry {
  uid: string;
  type: 'token_generation' | 'token_verification';
  count: number;
  windowStart: Timestamp | string;
  lastAction: Timestamp | string;
  [key: string]: any;
}

// Driver Swap Request type
export interface DriverSwapRequest {
  id: string;
  fromDriverUID: string;
  fromDriverName?: string;
  toDriverUID: string;
  toDriverName?: string;
  busId: string;
  busNumber?: string;
  routeId: string;
  routeName?: string;
  fromBusNumber?: string;
  toBusNumber?: string;
  // Swap type: 'assignment' (to reserved driver) or 'swap' (between two active drivers)
  swapType?: 'assignment' | 'swap';
  // Secondary bus info for true swap scenarios
  secondaryBusId?: string | null;
  secondaryBusNumber?: string | null;
  secondaryRouteId?: string | null;
  secondaryRouteName?: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  timePeriod?: {
    type: 'first_trip' | 'one_day' | 'two_days' | 'custom';
    duration?: number; // in hours for custom
    startTime?: string;
    endTime?: string;
  };
  reason?: string;
  actor?: string; // who accepted/rejected
  createdAt: Timestamp | string;
  updatedAt?: Timestamp | string;
  expiresAt: Timestamp | string;
  acceptedAt?: Timestamp | string;
  rejectedAt?: Timestamp | string;
  cancelledAt?: Timestamp | string;
  auditMeta?: Record<string, any>;
}

// Driver Swap Audit type
export interface DriverSwapAudit {
  id: string;
  requestId: string;
  busId: string;
  action: 'created' | 'accepted' | 'rejected' | 'expired' | 'reverted' | 'cancelled';
  actorUID: string;
  actorName?: string;
  actorRole?: string;
  fromDriverUID: string;
  toDriverUID?: string;
  beforeSnapshot?: Record<string, any>;
  afterSnapshot?: Record<string, any>;
  revertToken?: string;
  timestamp: Timestamp | string;
  metadata?: Record<string, any>;
}

// Enhanced Bus type with activeDriverId
export interface EnhancedBus extends Bus {
  assignedDriverId?: string; // Permanent/scheduled driver
  activeDriverId?: string; // Currently active driver (after swap)
}

// Types are exported inline above with 'export interface' and 'export type'
