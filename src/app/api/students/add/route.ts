import { createStudent,createUser } from '@/domains/identity';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { checkRateLimit,createRateLimitId,RateLimits } from '@/lib/security/rate-limiter';
import { computeBlockDatesFromValidUntil } from '@/lib/utils/deadline-computation';
import { calculateRenewalDate } from '@/lib/utils/renewal-utils';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require admin or moderator authentication
    const auth = await verifyApiAuth(request, ['admin', 'moderator']);
    if (!auth.authenticated) return auth.response;

    // SECURITY: Rate limit
    const rateLimitId = createRateLimitId(auth.uid, 'students-add');
    const rateCheck = checkRateLimit(rateLimitId, RateLimits.CREATE.maxRequests, RateLimits.CREATE.windowMs);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait.' },
        { status: 429 }
      );
    }

    const newStudentData = await request.json();

    // SECURITY: Validate required fields
    if (!newStudentData.name || !newStudentData.email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    // SECURITY: Sanitize - prevent role injection
    delete newStudentData.role;
    delete newStudentData.uid;

    const studentId = crypto.randomUUID();
    
    // CRITICAL: Extract session information from application data
    let sessionEndYear: number;
    let sessionStartYear: number;
    let validUntil: string;
    
    const config = await getDeadlineConfig();

    if (newStudentData.sessionInfo) {
      sessionStartYear = newStudentData.sessionInfo.sessionStartYear;
      sessionEndYear = newStudentData.sessionInfo.sessionEndYear;
      validUntil = newStudentData.sessionInfo.validUntil;
      console.log(`📅 Creating student with session: ${sessionStartYear}-${sessionEndYear}, validUntil: ${validUntil}`);
    } else {
      console.warn('⚠️ No sessionInfo provided in student data - computing dynamically from Firestore deadline config');
      const currentYear = new Date().getFullYear();
      sessionStartYear = currentYear;
      sessionEndYear = currentYear;
      const renewalResult = calculateRenewalDate(null, 1, config);
      validUntil = renewalResult.newValidUntil;
    }

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
