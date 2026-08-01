import * as Application from '@/domains/application';
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
          },
          {
            applicationId,
            applicationType: 'renewal',
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
        const { getUsersByRole } = await import('@/domains/identity');
        const [admins, moderators] = await Promise.all([
          getUsersByRole('admin'),
          getUsersByRole('moderator'),
        ]);
        const allStaffIds = [
          ...admins.map((u: any) => u.id || u.uid),
          ...moderators.map((u: any) => u.id || u.uid),
        ].filter(Boolean);
        if (allStaffIds.length > 0) {
          const { createNotification } = await import('@/domains/notification');
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
