/**
 * Application System Types
 * Defines the complete bus service application workflow
 */

// Application States (State Machine)
//
// Lifecycle for a "fresh" (current-session) application:
//   draft → awaiting_verification → verified → submitted → (approved | rejected)
//
// Lifecycle for a "future" (next-session) application:
//   draft → ... → submitted → verified_upcoming → (activated by cron) → student created
//                                              ↘ (capacity full) → pending_seat_allocation
//
// 'verified_upcoming': admin has reviewed and approved the application BEFORE the
//   academic-session activation date. No student doc, no seat, no entitlement.
//   The daily session-activation cron (and matching admin manual trigger) runs the
//   canonical approval pipeline on these once the new academic session begins.
//
// 'pending_seat_allocation': activation reached this application but no seat was
//   available on the target bus. Payment remains valid in Supabase; the student is
//   notified; the application is surfaced for manual seat allocation by an admin.
//   The same canonical approval pipeline can be retried from this state.
export type ApplicationState =
  | 'noDoc'                  // User logged in but no user doc found
  | 'draft'                  // User started/saved application
  | 'awaiting_verification'  // Verification code sent to moderator
  | 'verified'               // Moderator verified & student entered correct code
  | 'submitted'              // Application submitted to admin queue
  | 'verified_upcoming'      // Future-session application approved by admin, awaiting activation
  | 'pending_seat_allocation'// Future-session application activated but seat unavailable
  | 'approved'               // Admin/moderator approved (legacy; current pipeline deletes on approve)
  | 'rejected'               // Admin/moderator rejected
  | 'cancelled'              // User cancelled
  | 'expired';               // Application expired

// Application Type discriminator (Phase 2)
// A single `applications` collection holds all three categories. Behaviour at
// approval time keys off this field:
//   - 'fresh'   : new applicant for the current session  → create student now
//   - 'renewal' : soft-blocked student re-entering (before seat released) → reactivate existing student
//   - 'renewal_after_soft_block' : soft-blocked student renewing after seat was released → reactivate + reclaim seat
//   - 'future'  : applicant for the NEXT session          → not approvable until eligibleApproval
export type ApplicationType = 'fresh' | 'renewal' | 'renewal_after_soft_block' | 'future';

// The academic session an application targets.
export interface TargetSession {
  startYear: number; // session start year (e.g. 2027 for the 2027-2028 session)
  endYear: number;   // session end year   (e.g. 2028)
}

// Payment Modes
export type PaymentMode = 'offline' | 'upi' | 'bank' | 'card';

// Payment Information
export interface PaymentInfo {
  paymentMode: PaymentMode | 'online';
  amountPaid: number; // Total amount paid for the selected duration

  // Offline Payment Fields (only for offline payments)
  paymentReference?: string; // UPI Transaction ID / Payment Reference (offline only)
  paymentEvidenceUrl?: string; // Receipt image URL (offline only)
  paymentEvidenceProvided: boolean; // True if receipt uploaded
  paidAt?: string; // ISO timestamp of when student claims payment was made (offline only)

  // Online Payment Transaction Details (Razorpay - only for online payments)
  razorpayPaymentId?: string; // Razorpay payment ID
  razorpayOrderId?: string; // Razorpay order ID
  paymentStatus?: string; // 'success' | 'failed' | 'pending' (online only)
  paymentMethod?: string; // 'card' | 'upi' | 'netbanking' (online only)
  paymentTime?: string; // ISO timestamp (online only)
}

// Session Information
export interface SessionInfo {
  sessionStartYear: number;
  durationYears: number;
  sessionEndYear: number;
  validUntil?: string; // ISO timestamp
  feeEstimate: number;
}

// Audit Log Entry
export interface AuditLogEntry {
  actorId: string;
  actorRole: 'student' | 'moderator' | 'admin' | 'system';
  action: string;
  timestamp: string;
  notes?: string;
  metadata?: Record<string, any>;
}

// Application Form Data
export interface ApplicationFormData {
  assignedBusId: any;
  // Personal Info
  fullName: string;
  email: string;
  phoneNumber: string;
  alternatePhone?: string;
  enrollmentId: string;
  gender: string;
  dob: string;
  age?: string;
  profilePhotoUrl?: string;

  // Academic Info
  faculty: string;
  department: string;
  semester: string;

  // Contact Info
  address: string;
  parentName: string;
  parentPhone: string;

  // Medical Info
  bloodGroup: string;

  // Service Selection
  routeId?: string;
  busId?: string;
  busAssigned?: string;
  stopId?: string;
  shift?: string;

  // Session & Payment
  sessionInfo: SessionInfo;
  paymentInfo: PaymentInfo;

  // Declarations
  declarationAccepted: boolean;

  // Supabase Ledger tracking
  paymentId?: string;
}

// Moderator Profile
export interface ModeratorProfile {
  moderatorUid: string;
  name: string;
  empId: string;
  email: string;
  role: 'moderator';
  assignedOffice?: string;
  active: boolean;
  createdAt: string;
}

// Application Document (Firestore)
export interface Application {
  // Identity
  applicationId: string;
  applicantUid: string;
  applicantEmail?: string; // Legacy field
  email?: string;          // New standardized field

  // Form Data
  formData: ApplicationFormData;

  // State & Flow
  state: ApplicationState;
  stateHistory?: Array<{ state: ApplicationState; timestamp: string; actor?: string }>;

  // Verification
  pendingVerifier?: string; // {Name} {EMPID}
  verificationAttempts: number;
  verifiedAt?: string;
  verifiedBy?: string; // {Name} {EMPID}
  verifiedById?: string; // moderatorUid for audit

  // Submission
  submittedAt?: string;
  submittedBy?: string;

  // Approval/Rejection
  approvedAt?: string;
  approvedBy?: string; // {Name} {EMPID} - REQUIRED field
  approvedById?: string; // admin/moderator uid for audit

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;

  // Version
  applicationVersion?: number;

  // Capacity/Reassignment Review Fields
  // When bus is overloaded, these fields indicate the student needs reassignment
  needsCapacityReview?: boolean;
  /**
   * Reassignment reason codes:
   * - 'bus_full_only_option': The selected bus is full and only serves the stop (Case 1)
   * - 'bus_full_alternatives_exist': The selected bus is full but other buses also serve it (Case 2)
   * - 'no_issue': The selected bus has seats available (Case 3 - no action needed)
   */
  reassignmentReason?: 'bus_full_only_option' | 'bus_full_alternatives_exist' | 'no_issue';
  hasAlternativeBuses?: boolean;

  // Supabase Ledger tracking
  paymentId?: string;

  // ── Phase 2: application categorisation & future-session eligibility ──
  /**
   * Discriminator for the unified applications queue. Absent on legacy docs,
   * which must be treated as 'fresh' (see resolveApplicationType()).
   */
  applicationType?: ApplicationType;
  /**
   * The academic session this application is for. For 'future' applications this
   * is the NEXT session; for 'fresh'/'renewal' it is the current session.
   */
  targetSession?: TargetSession;
  /**
   * The earliest moment this application may be approved, as an ISO timestamp,
   * COMPUTED AND FROZEN AT CREATION TIME.
   *
   * Rule (locked): eligibleApproval = softBlock(targetSession.startYear) + 1 day.
   * The seats a future application waits for are released when the outgoing
   * session's students are soft-blocked. Storing the resolved date at creation
   * makes eligibility deterministic and immune to later deadline-config changes.
   *
   * For 'fresh'/'renewal' applications this is the creation time (immediately
   * eligible). Absent on legacy docs → treated as immediately eligible.
   */
  eligibleApproval?: string;
  /**
   * For 'renewal' applications: the uid of the existing (soft-blocked) student
   * document to reactivate at approval, instead of creating a new student.
   */
  linkedStudentUid?: string;
}

// Student User Profile (post-approval)
export interface StudentUser {
  uid: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  enrollmentId: string;
  department: string;
  semester: string;
  role: 'student';

  // Session Info
  sessionStartYear: number;
  durationYears: number;
  sessionEndYear: number;
  validUntil: string;
  status: 'active' | 'soft_blocked' | 'pending_deletion' | 'expired' | 'suspended' | 'inactive';

  /**
   * Phase 1 seat-ownership marker. ISO timestamp set at SOFT BLOCK when the seat
   * is released (bus capacity decremented), and cleared to `null` when a late
   * renewal reclaims the seat. PRESENCE is the single authoritative signal that
   * this student's bus counter was already decremented — used by all delete paths
   * (dedup, no double-decrement) and late renewal (conditional re-increment).
   * Absent on legacy docs, which correctly means "seat never released by new code".
   * See src/lib/config/capacity-flags.ts.
   */
  seatReleasedAt?: string | null;

  // Approval Info
  approvedBy: string; // {Name} {EMPID} - REQUIRED
  verifiedById: string;

  // Payment
  paymentInfo: PaymentInfo;

  // History
  sessionHistory?: Array<{
    start: number;
    end: number;
    approvedBy: string;
    approvedAt: string;
  }>;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

// Notification Types for Application Flow
export type ApplicationNotificationType =
  | 'VerificationRequested'
  | 'CodeSent'
  | 'VerificationSuccess'
  | 'Submitted'
  | 'Approved'
  | 'ExpiryReminder'
  | 'RemindersForPending';

// API Request/Response Types
export interface GenerateCodeRequest {
  applicationId: string;
  moderatorUid: string;
  moderatorName: string;
}

export interface GenerateCodeResponse {
  success: boolean;
  codeId: string;
  expiresAt: string;
  message: string;
}

export interface VerifyCodeRequest {
  applicationId: string;
  code: string;
}

export interface VerifyCodeResponse {
  success: boolean;
  message: string;
  verified: boolean;
}

export interface SubmitApplicationRequest {
  applicationId: string;
}

export interface SubmitApplicationResponse {
  success: boolean;
  message: string;
  applicationId: string;
}

export interface ApproveApplicationRequest {
  applicationId: string;
  approverName: string; // {Name} {EMPID}
  approverId: string;
  notes?: string;
}

export interface RejectApplicationRequest {
  applicationId: string;
  rejectorName: string;
  rejectorId: string;
}

