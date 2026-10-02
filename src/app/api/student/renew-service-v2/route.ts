import * as Application from '@/domains/application';
import { getUsersByRole } from '@/domains/identity';
import { createNotification } from '@/domains/notification';
import { getById } from '@/domains/student';
import { getCurrentBusFee } from '@/lib/bus-fee-service';
import { createRazorpayOrder } from '@/lib/payment/razorpay.service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { RenewServiceV2Schema } from '@/lib/security/validation-schemas';
import { NextResponse } from 'next/server';

type RenewServiceBody = {
  durationYears: number;
  paymentMode: 'online' | 'offline';
  transactionId?: string;
  receiptImageUrl?: string;
  paidAt?: string; // ISO timestamp of when student claims payment was made (offline only)
};

export const POST = withSecurity<RenewServiceBody>(
  async (_request, { auth, body }) => {
    const userId = auth.uid;
    const { durationYears, paymentMode, transactionId, receiptImageUrl, paidAt } = body;

    const [student, busFeeData] = await Promise.all([
      getById(userId),
      getCurrentBusFee(),
    ]);

    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const enrollmentId = student.enrollmentId || '';
    const studentName = student.fullName || student.name || auth.name || 'Student';

    const currentBusFee = Number(busFeeData.amount || 0);
    const totalFee = currentBusFee * durationYears;

    if (!currentBusFee || totalFee <= 0) {
      return NextResponse.json({ error: 'Bus fee is not configured' }, { status: 500 });
    }

    if (paymentMode === 'online') {
      const receipt = `renewal_${enrollmentId || userId}_${Date.now()}`;
      const order = await createRazorpayOrder(totalFee, receipt, {
        userId,
        studentId: userId,
        enrollmentId,
        studentName,
        durationYears: durationYears.toString(),
        type: 'renewal',
      });

      return NextResponse.json({
        success: true,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
      });
    }

    if (paymentMode === 'offline') {
      // D8: Insert renewal application into PostgreSQL instead of Firestore.
      // Deterministic ID for deduplication: same student + same day = same ID.
      const dailyBucket = new Date().toISOString().slice(0, 10);
      const applicationId = `renewal_${userId}_${dailyBucket}`;

      // Check for existing pending renewal (deduplication)
      const existing = await Application.getById(applicationId);
      if (existing && existing.state === 'submitted') {
        return NextResponse.json(
          { error: 'A pending renewal request already exists. Please wait for it to be reviewed.' },
          { status: 409 }
        );
      }

      try {
        await Application.submitFinal(
          userId,
          student.email || '',
          {
            studentId: userId,
            enrollmentId,
            studentName,
            durationYears,
            totalFee,
            transactionId: transactionId || '',
            receiptImageUrl: receiptImageUrl || '',
            paidAt: paidAt || '',
            paymentMode: 'offline',
            phoneNumber: (student as any).phone || '',
            // FIX-10 (APP-01): Pass the correct session_start_year for the renewal.
            //
            // The unique index is: (applicant_uid, session_start_year) WHERE state NOT IN
            // ('rejected', 'cancelled', 'expired'). Without a sessionStartYear, submitFinal
            // defaults to 0 — every renewal from the same student collides on (uid, 0) the
            // moment a previous renewal reaches 'approved' state.
            //
            // WHY sessionEndYear, not sessionStartYear:
            //   A renewal extends service into the NEXT academic period. The student's current
            //   session ends at sessionEndYear (e.g. 2025). The renewal starts from 2025 and
            //   covers durationYears (e.g. 1 year → ends 2026). Subsequent renewals would
            //   start from 2026, 2027, etc. Each is a distinct (uid, year) pair — no collision.
            //
            //   Using sessionStartYear (e.g. 2024) would collide with the still-active fresh
            //   application that has (uid, 2024) in the approved state.
            busId: student.busId || '',
            routeId: student.routeId || '',
            stop_name: student.stop_name || '',
            shift: student.shift || 'Morning',
            sessionStartYear: (student as any).sessionEndYear
              || ((student as any).sessionStartYear ? (student as any).sessionStartYear + durationYears : new Date().getFullYear()),
          },
          {
            applicationId,
            applicationType: 'renewal',
            busId: student.busId || '',
            routeId: student.routeId || '',
            stop_name: student.stop_name || '',
            shift: student.shift || 'Morning',
          }
        );
      } catch (err: any) {
        console.error('Failed to create renewal application:', err);
        return NextResponse.json(
          { error: 'Failed to create renewal request. Please retry.' },
          { status: 503 }
        );
      }

      // OFFLINE PAYMENT: No Supabase payment row is created at submission time.
      // Financial ledger records are created ONLY after admin/moderator verification
      // and approval. The student's submitted payment details (transactionId,
      // receiptImageUrl) are stored in the application form_data for review.

      // Notify staff via domain API
      try {
        const [admins, moderators] = await Promise.all([
          getUsersByRole('admin'),
          getUsersByRole('moderator'),
        ]);
        const allStaffIds = [
          ...admins.map((u: any) => u.id || u.uid),
          ...moderators.map((u: any) => u.id || u.uid),
        ].filter(Boolean);
        if (allStaffIds.length > 0) {
          await createNotification(
            { userId, userName: studentName, userRole: 'student' },
            { type: 'specific_users', specificUserIds: allStaffIds },
            `${studentName} (${enrollmentId}) has submitted an offline renewal request for ${durationYears} year(s).`,
            'New Renewal Request',
          );
        }
      } catch (notifyErr) {
        console.error('Failed to send renewal notification to staff:', notifyErr);
      }

      return NextResponse.json({
        success: true,
        message: 'Offline renewal request submitted successfully',
        requestId: applicationId,
      });
    }

    return NextResponse.json({ error: 'Invalid payment mode' }, { status: 400 });
  },
  {
    requiredRoles: ['student'],
    schema: RenewServiceV2Schema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);
