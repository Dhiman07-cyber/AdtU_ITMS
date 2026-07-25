/**
 * Input Validation Schemas for ADTU Bus Service
 * 
 * SECURITY: Server-side validation to prevent:
 * - Injection attacks
 * - Invalid data types
 * - Oversized payloads
 * - Malformed requests
 */

import { z } from 'zod';

export const UidOnlySchema = z.object({
    uid: z.string().min(1).max(128),
});

export const DeleteStudentSchema = z.object({
    uid: z.string().min(1).max(128),
});

export const UpdateStudentSchema = z.object({
    uid: z.string().min(1).max(128),
}).passthrough();

export const BusFeeQuerySchema = z.object({
    history: z.string().optional().transform(v => v === 'true'),
});

export const BusFeeUpdateSchema = z.object({
    amount: z.number().min(0).max(1000000),
});

export const InvalidTokensQuerySchema = z.object({
    olderThan: z.string().optional().transform(v => parseInt(v || '30')),
});

export const ReassignStudentsSchema = z.object({
    assignments: z.array(z.object({
        studentId: z.string().min(1).max(128),
        studentName: z.string().min(1).max(200),
        fromBusId: z.string().min(1).max(100),
        toBusId: z.string().min(1).max(100),
        toBusNumber: z.string().min(1).max(50),
        shift: z.enum(['Morning', 'Evening']),
        stop_name: z.string().max(200).optional(),
    })),
    sourceBusId: z.string().min(1).max(100),
    actorId: z.string().min(1).max(128).optional(),
    actorName: z.string().min(1).max(200).optional(),
});

export const UpdateProfilePhotoSchema = z.object({
    studentUid: z.string().min(1).max(128),
    newProfilePhotoUrl: z.string().url(),
});

export const CreateUserSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
    role: z.enum(['student', 'driver', 'moderator', 'admin']),
    phone: z.string().max(20).optional(),
    alternatePhone: z.string().max(20).optional(),
    profilePhotoUrl: z.string().url().optional().or(z.literal('')),
    enrollmentId: z.string().max(50).optional(),
    gender: z.string().max(20).optional(),
    faculty: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    semester: z.string().max(50).optional(),
    parentName: z.string().max(200).optional(),
    parentPhone: z.string().max(20).optional(),
    dob: z.string().max(50).optional(),
    licenseNumber: z.string().max(100).optional(),
    joiningDate: z.string().max(50).optional(),
    aadharNumber: z.string().max(20).optional(),
    driverId: z.string().max(100).optional(),
    employeeId: z.string().max(100).optional(),
    staffId: z.string().max(100).optional(),
    routeId: z.string().max(100).optional(),
    busId: z.string().max(100).optional(),
    address: z.string().max(500).optional(),
    bloodGroup: z.string().max(10).optional(),
    shift: z.string().max(100).optional(),
    durationYears: z.number().int().min(1).max(10).optional(),
    sessionDuration: z.union([z.string(), z.number()]).optional(),
    sessionStartYear: z.number().int().optional(),
    sessionEndYear: z.number().int().optional(),
    validUntil: z.string().optional(),
    pickupPoint: z.string().max(200).optional(),
    stop_name: z.string().max(100).optional(),
    status: z.string().max(50).optional(),
});

export const AckWaitingSchema = z.object({
    waitingFlagId: z.string().uuid(),
});

export const FirestoreCleanupSchema = z.object({
    cleanupType: z.enum(['active_trips', 'reassignment_logs', 'driver_location_updates', 'waiting_flags', 'all']),
    daysOld: z.number().int().min(1).max(3650).optional(),
});

export const DebugDriverBusLinkSchema = z.object({
    driverUID: z.string().min(1),
});

export const SaveFCMTokenSchema = z.object({
    userUid: z.string().min(1).max(128),
    token: z.string().min(100).max(512).regex(/^\S+$/, 'Token must not contain whitespace'),
    platform: z.enum(['web', 'android', 'ios']).default('web'),
});

export const SimulateDeadlinesSchema = z.object({
    simulatedDate: z.string(),
    dryRun: z.boolean().optional(),
    execute: z.boolean().optional(),
    manualMode: z.boolean().optional(),
    selectedForSoftBlock: z.array(z.string()).optional(),
    selectedForHardDelete: z.array(z.string()).optional(),
    customDeadlines: z.any().optional(),
    syncSessionYear: z.boolean().optional(),
});

// ============================================================================
// Common Validators
// ============================================================================

export const UIDSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid UID format');
export const EmailSchema = z.string().email().max(255);
export const PhoneSchema = z.string().regex(/^[+]?[0-9]{10,15}$/, 'Invalid phone number');
export const DateSchema = z.coerce.date();
export const ProxyORSSchema = z.object({
    action: z.enum(['directions', 'geocode']),
    coordinates: z.array(z.array(z.number())).optional(),
    profile: z.string().max(50).optional(),
    routeId: z.string().max(100).optional(),
    address: z.string().max(500).optional(),
    forceRefresh: z.boolean().optional(),
});
export const ShortStringSchema = z.string().max(200).transform(s => s.trim());

// ============================================================================
// Payment Schemas
// ============================================================================

export const CreateOrderSchema = z.object({
    amount: z.number().positive().max(1000000), // Max 10 lakh INR
    userId: z.string().optional(),
    userName: z.string().max(200).optional(),
    enrollmentId: z.string().max(100).optional(),
    purpose: z.enum(['renewal', 'new_registration', 'Bus Service Payment']).optional(),
    durationYears: z.number().int().min(1).max(5).optional(),
    notes: z.record(z.string(), z.string().max(500)).optional(),
});

export const VerifyPaymentSchema = z.object({
    razorpay_payment_id: z.string().min(1).max(100),
    razorpay_order_id: z.string().min(1).max(100),
    razorpay_signature: z.string().min(1).max(200),
    userId: z.string().optional(),
    purpose: z.string().optional(),
});

// ============================================================================
// Bus Pass Schemas
// ============================================================================

export const GenerateBusPassSchema = z.object({
    studentUid: UIDSchema,
    intendedBusId: z.string().max(50).optional(),
    deviceInfo: z.object({
        platform: z.string().max(50).optional(),
        model: z.string().max(100).optional(),
        osVersion: z.string().max(50).optional(),
    }).optional(),
    idToken: z.string().optional(), // Token can be in body or header
});

export const VerifyBusPassSchema = z.object({
    tokenId: z.string().min(1).max(200),
    scannerBusId: z.string().min(1).max(50),
});

export const VerifyReceiptSchema = z.object({
    receiptToken: z.string().min(8).max(2048),
    scanContext: z.object({
        busId: z.string().max(100).optional(),
        routeId: z.string().max(100).optional(),
        source: z.string().max(50).optional(),
    }).passthrough().optional(),
});

// ============================================================================
// Student Schemas
// ============================================================================

export const StudentUpdateSchema = z.object({
    fullName: z.string().max(200).optional(),
    phone: PhoneSchema.optional(),
    alternatePhone: PhoneSchema.optional(),
    address: z.string().max(500).optional(),
    profileImageUrl: z.string().url().max(500).optional(),
    // NOT allowed: validUntil, status, sessionStartYear, sessionEndYear, etc.
});

export const RenewalRequestSchema = z.object({
    studentId: UIDSchema,
    paymentMode: z.enum(['offline']),
    transactionId: z.string().max(100),
    amount: z.number().positive().max(100000),
    durationYears: z.number().int().min(1).max(5),
    notes: z.string().max(500).optional(),
    receiptImageUrl: z.string().url().max(500).optional(),
});

// ============================================================================
// Notification Schemas
// ============================================================================

export const NotificationCreateSchema = z.object({
    type: z.string().max(50).optional(),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(5000),
    targetType: z.enum(['all_users', 'all_role', 'shift_based', 'bus_based', 'route_based', 'specific_users']).optional(),
    targetRole: z.enum(['student', 'driver', 'moderator', 'admin']).optional(),
    targetShift: z.enum(['morning', 'evening', 'both']).optional(),
    targetBusIds: z.array(z.string().max(50)).max(50).optional(),
    targetRouteIds: z.array(z.string().max(50)).max(50).optional(),
    targetUserIds: z.array(UIDSchema).max(1000).optional(),
    expiryAt: z.number().optional(),
    sendToAllRoles: z.boolean().optional(),
});

// ============================================================================
// Waiting Flag Schemas
// ============================================================================

export const WaitingFlagSchema = z.object({
    studentUid: UIDSchema,
    studentName: z.string().max(200),
    busId: z.string().max(50),
    routeId: z.string().max(50),
    stop_name: z.string().max(200).optional(),
    stopLat: z.number().min(-90).max(90).optional(),
    stopLng: z.number().min(-180).max(180).optional(),
    message: z.string().max(500).optional(),
});

// ============================================================================
// Location Schemas
// ============================================================================

export const LocationUpdateSchema = z.object({
    busId: z.string().max(50),
    routeId: z.string().max(50),
    driverUid: UIDSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    speed: z.number().min(0).max(200).optional(), // km/h
    heading: z.number().min(0).max(360).optional(),
    accuracy: z.number().min(0).max(1000).optional(), // meters
    tripId: z.string().max(100).optional(),
});

// ============================================================================
// Driver Schemas
// ============================================================================



// ============================================================================
// Trip & Journey Schemas
// ============================================================================

export const StartTripSchema = z.object({
    busId: z.string().min(1).max(100),
    routeId: z.string().min(1).max(100),
    shift: z.enum(['morning', 'evening', 'both']).optional(),
});

export const NotifyStudentsSchema = z.object({
    busId: z.string().min(1).max(100),
    routeId: z.string().min(1).max(100),
    tripId: z.string().min(1).max(200),
});

export const EndTripSchema = z.object({
    busId: z.string().min(1).max(100),
    tripId: z.string().max(200).optional(),
});

export const HeartbeatSchema = z.object({
    tripId: z.string().min(1).max(200),
    busId: z.string().min(1).max(100),
});

// ============================================================================
// Device Session Schema
// ============================================================================

export const DeviceSessionSchema = z.object({
    action: z.enum(['check', 'register', 'heartbeat', 'release']),
    feature: z.string().min(1).max(100),
    deviceId: z.string().min(1).max(200),
});

// ============================================================================
// Driver Action Schemas (body-only, idToken stripped by wrapper)
// ============================================================================

export const MarkBoardedSchema = z.object({
    flagId: z.string().min(1).max(200),
});

export const BusIdSchema = z.object({
    busId: z.string().min(1).max(100),
});

export const EmptySchema = z.object({});



export const HandleProfileUpdateSchema = z.object({
    requestId: z.string().min(1).max(200),
    action: z.enum(['approve', 'reject']),
});

export const RequestProfileUpdateSchema = z.object({
    newImageUrl: z.string().url().min(1),
    fullName: z.string().max(200).optional(),
});

export const TripStatusQuerySchema = z.object({
    busId: z.string().min(1).max(100),
});

export const PaymentHistoryQuerySchema = z.object({
    uid: z.string().min(1).max(128).optional(),
    limit: z.string().optional().transform(v => Math.min(parseInt(v || '50'), 100)),
    offset: z.string().optional().transform(v => parseInt(v || '0')),
});

export const RenewApplicationSchema = z.object({
    studentId: z.string().min(1).max(128),
    duration: z.number().int().min(1).max(10),
    paymentMode: z.string().max(50).optional(),
    sessionInfo: z.any().optional(),
});

export const RenewServiceV2Schema = z.object({
    durationYears: z.number().int().min(1).max(10),
    paymentMode: z.enum(['online', 'offline']),
    transactionId: z.string().max(200).optional(),
    receiptImageUrl: z.string().url().optional().or(z.literal('')),
    paidAt: z.string().optional(), // ISO timestamp of when student claims payment was made (offline only)
});

export const NotifyDriverSchema = z.object({
    busId: z.string().min(1).max(100),
    studentName: z.string().min(1).max(200),
    message: z.string().max(500).optional(),
});

export const CheckPendingStatusSchema = z.object({
    requestId: z.string().min(1).max(200),
});

// ============================================================================
// Waiting Flag POST Schema (body-only)
// ============================================================================

export const WaitingFlagPostSchema = z.object({
    busId: z.string().min(1).max(100),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracy: z.number().min(0).max(10000).optional(),
    message: z.string().max(500).optional(),
    timestamp: z.number().optional(),
    routeId: z.string().max(100).optional(),
    stop_name: z.string().max(200).optional(),
    stopLat: z.number().min(-90).max(90).optional(),
    stopLng: z.number().min(-180).max(180).optional(),
});

export const WaitingFlagQuerySchema = z.object({
    studentUid: z.string().min(1).max(128),
});

export const WaitingFlagDeleteSchema = z.object({
    flagId: z.string().min(1).max(100),
    busId: z.string().min(1).max(100),
});

// ============================================================================
// Location Update Body Schema (body-only)
// ============================================================================

export const LocationUpdateBodySchema = z.object({
    busId: z.string().min(1).max(100),
    routeId: z.string().min(1).max(100),
    lat: z.union([z.number(), z.string().transform(Number)]).optional(),
    lng: z.union([z.number(), z.string().transform(Number)]).optional(),
    accuracy: z.union([z.number(), z.string().transform(Number)]).optional(),
    speed: z.union([z.number(), z.string().transform(Number)]).optional(),
    heading: z.union([z.number(), z.string().transform(Number)]).optional(),
    timestamp: z.union([z.number(), z.string()]).optional(),
    tripId: z.string().max(200).optional(),
});

// ============================================================================
// Admin/Moderator & Application Schemas
// ============================================================================

export const SubmitApplicationSchema = z.object({
    formData: z.record(z.string(), z.any()),
    needsCapacityReview: z.boolean().optional(),
    applicationId: z.string().optional(),
});

export const SaveDraftSchema = z.object({
    formData: z.record(z.string(), z.any()),
    applicationId: z.string().optional(),
});

export const AddModeratorSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
    phone: z.string().max(20).optional(),
    faculty: z.string().max(100).optional(),
    employeeId: z.string().max(100).optional(),
    role: z.literal('moderator').default('moderator'),
});

export const UpdateModeratorSchema = z.object({
    fullName: z.string().max(200).optional(),
    phone: z.string().max(20).optional(),
    profilePhotoUrl: z.string().url().nullable().optional(),
}).passthrough();

export const UpdatePermissionsSchema = z.object({
    permissions: z.object({
        students: z.object({ canView: z.boolean(), canAdd: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean(), canReassign: z.boolean() }),
        drivers: z.object({ canView: z.boolean(), canAdd: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean(), canReassign: z.boolean() }),
        buses: z.object({ canView: z.boolean(), canAdd: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean(), canReassign: z.boolean() }),
        routes: z.object({ canView: z.boolean(), canAdd: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean() }),
        applications: z.object({ canView: z.boolean(), canApprove: z.boolean(), canReject: z.boolean(), canGenerateVerificationCode: z.boolean(), canAppearInModeratorList: z.boolean() }),
        payments: z.object({ canApproveOfflinePayment: z.boolean(), canRejectOfflinePayment: z.boolean() }),
    }),
});

export const ApproveRenewalSchema = z.object({
    requestId: z.string().max(100),
    approverId: UIDSchema,
    approverName: z.string().max(200),
    approverRole: z.enum(['admin', 'moderator']),
    approverEmpId: z.string().max(50).optional(),
});

export const RejectRenewalSchema = z.object({
    requestId: z.string().max(100),
    rejectorId: UIDSchema,
    rejectorName: z.string().max(200),
    reason: z.string().max(500),
});

// ============================================================================
// Payment Approve/Reject Schemas
// ============================================================================

export const ApprovePaymentSchema = z.object({
    paymentId: z.string().min(1).max(200),
});

export const RejectPaymentSchema = z.object({
    paymentId: z.string().min(1).max(200),
});

export const RequestWaitSchema = z.object({
    busId: z.string().min(1).max(100),
    studentId: z.string().min(1).max(128),
    studentName: z.string().min(1).max(200).optional(),
    stop_name: z.string().min(1).max(200).optional(),
});

export const RespondWaitSchema = z.object({
    studentId: z.string().min(1).max(128),
    response: z.enum(['accepted', 'rejected']),
    busId: z.string().min(1).max(100),
});

// ============================================================================
// Validation Helper Function
// ============================================================================

export type ValidationResult<T> =
    | { success: true; data: T }
    | { success: false; error: string; details?: z.ZodError };

type ZodIssueLike = {
    path?: Array<string | number>;
    message?: string;
};

type ZodErrorLike = {
    name?: string;
    issues?: ZodIssueLike[];
};

/**
 * Validate input against a Zod schema
 * Returns typed data on success, or error message on failure
 */
export function validateInput<T>(
    schema: z.ZodSchema<T>,
    input: unknown
): ValidationResult<T> {
    try {
        const data = schema.parse(input);
        return { success: true, data };
    } catch (error: unknown) {
        const zodError = error instanceof z.ZodError ? error : null;
        const errorLike = error as ZodErrorLike;

        if (zodError || errorLike.name === 'ZodError') {
            const issues = zodError
                ? zodError.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`)
                : (errorLike.issues || []).map((i) => `${(i.path || []).join('.')}: ${i.message || 'Invalid value'}`);
            if (process.env.NODE_ENV !== 'test') {
                console.error('[validateInput] ❌ Validation failed:', issues);
            }
            return {
                success: false,
                error: `Validation failed: ${issues.join(', ')}`,
                details: zodError || undefined
            };
        }
        if (process.env.NODE_ENV !== 'test') {
            console.error('[validateInput] ❌ Non-Zod error:', error);
        }
        return { success: false, error: 'Invalid input' };
    }
}

/**
 * Sanitize string to prevent XSS
 * Removes potentially dangerous HTML/script content
 */
export function sanitizeHtml(input: string): string {
    return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .replace(/`/g, '&#x60;')
        .replace(/=/g, '&#x3D;');
}

/**
 * Safe string validation with XSS sanitization
 */
export const SanitizedStringSchema = z.string().max(5000).transform(sanitizeHtml);
