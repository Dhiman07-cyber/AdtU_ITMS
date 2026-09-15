import { createStudent,createUser } from '@/domains/identity';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { requireModeratorPermission } from '@/lib/security/moderator-permissions';
import { checkRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { calculateRenewalDate } from '@/lib/utils/renewal-utils';
import { NextRequest,NextResponse } from 'next/server';

// Explicit allowlist of client-writable fields. Server-authoritative fields
// (uid, role, status, busId, routeId, shift, validity, blocks, entitlement
// flags) are NEVER taken from client input.
const ALLOWED_FIELDS = new Set([
  'name', 'fullName', 'email', 'phone', 'phoneNumber', 'alternatePhone', 'altPhone',
  'enrollmentId', 'gender', 'faculty', 'department', 'semester', 'parentName',
  'parentPhone', 'dob', 'address', 'bloodGroup', 'profilePhotoUrl', 'stop_name',
  'pickupPoint', 'sessionDuration',
]);

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require admin or moderator authentication
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // SECURITY: Moderators need explicit student-creation permission
    if (auth.role === 'moderator') {
      const permissionDenied = await requireModeratorPermission(auth, 'students', 'canAdd');
      if (permissionDenied) return permissionDenied;
    }

    // SECURITY: Rate limit
    const rateLimitId = createRateLimitId(auth.uid, 'students-add');
    const rateCheck = checkRateLimit(rateLimitId, RateLimits.CREATE.maxRequests, RateLimits.CREATE.windowMs);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait.' },
        { status: 429 }
      );
    }

    const rawStudentData = await request.json();

    // SECURITY: Validate required fields
    if (!rawStudentData.name && !rawStudentData.fullName) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }
    if (!rawStudentData.email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // SECURITY: Allowlist — drop every non-listed key (role, uid, status,
    // busId, routeId, shift, validUntil, blocks, feesStatus, ...).
    const newStudentData: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawStudentData)) {
      if (ALLOWED_FIELDS.has(key)) {
        newStudentData[key] = value;
      }
    }

    const studentId = crypto.randomUUID();
    
    // CRITICAL: Extract session information from application data
    let sessionEndYear: number;
    let sessionStartYear: number;
    let validUntil: string;
    
    const config = await getDeadlineConfig();

    // Session is always computed server-side from the deadline config.
    // Client-supplied sessionInfo/session years are ignored (allowlisted out).
    const currentYear = new Date().getFullYear();
    sessionStartYear = currentYear;
    sessionEndYear = currentYear;
    const renewalResult = calculateRenewalDate(null, 1, config);
    validUntil = renewalResult.newValidUntil;

    const blockDates = computeBlockDatesFromValidUntil(validUntil, config);
    
    const newStudent = {
      ...newStudentData,
      id: studentId,
      sessionStartYear,
      sessionEndYear,
      validUntil,
      softBlock: blockDates.softBlock,
      hardBlock: blockDates.hardBlock
    };

    const createdAt = new Date().toISOString();

    // Write user to PostgreSQL (canonical source of truth) — before transaction
    await createUser({
      uid: studentId,
      email: newStudentData.email,
      name: newStudentData.name || newStudentData.fullName,
      role: 'student',
      createdAt,
    });

    // Write student to PostgreSQL (canonical source of truth) — before transaction
    await createStudent({
      uid: studentId,
      email: newStudentData.email,
      fullName: newStudentData.name || newStudentData.fullName,
      role: 'student',
      status: 'active',
      createdAt,
      ...newStudentData,
      sessionStartYear,
      sessionEndYear,
      validUntil,
      softBlock: blockDates.softBlock,
      hardBlock: blockDates.hardBlock,
    });

    // Canonical: PostgreSQL only. Firestore removed (D1 Identity freeze).

    return NextResponse.json(newStudent, { status: 201 });
  } catch (error) {
    console.error('Error adding student:', error);
    return NextResponse.json({ error: 'Failed to add student' }, { status: 500 });
  }
}
