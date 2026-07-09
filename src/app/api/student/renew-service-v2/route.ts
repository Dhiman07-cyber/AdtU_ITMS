import { NextResponse } from 'next/server';
import { db as adminDb, FieldValue } from '@/lib/firebase-admin';
import { createRazorpayOrder } from '@/lib/payment/razorpay.service';
import { getCurrentBusFee } from '@/lib/bus-fee-service';
import { withSecurity } from '@/lib/security/api-security';
import { RenewServiceV2Schema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getById } from '@/domains/student';

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

    const student = await getById(userId);
    if (!student) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }

    const enrollmentId = student.enrollmentId || '';
    const studentName = student.fullName || student.name || auth.name || 'Student';

    const busFeeData = await getCurrentBusFee();
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
      // ATOMIC duplicate guard: use a deterministic document ID derived from
      // studentId + a daily bucket so concurrent requests cannot both pass the
      // pending-check and create duplicate renewal requests. The transaction
      // re-reads the doc to guarantee exactly one winner.
      const dailyBucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const dedupeDocId = `renewal_${userId}_${dailyBucket}`;

      try {
        await adminDb.runTransaction(async (transaction) => {
          const dedupeRef = adminDb.collection('renewal_requests').doc(dedupeDocId);
          const existingDoc = await transaction.get(dedupeRef);

          if (existingDoc.exists) {
            const existing = existingDoc.data();
            if (existing?.status === 'pending') {
              throw new Error('DUPLICATE_PENDING');
            }
          }

          transaction.set(dedupeRef, {
            studentId: userId,
            enrollmentId,
            studentName,
            durationYears,
            totalFee,
            transactionId: transactionId || '',
            receiptImageUrl: receiptImageUrl || '',
            paidAt: paidAt || '',
            paymentMode: 'offline',
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (txErr: any) {
        if (txErr?.message === 'DUPLICATE_PENDING') {
          return NextResponse.json(
            { error: 'A pending renewal request already exists. Please wait for it to be reviewed.' },
            { status: 409 }
          );
        }
        console.error('Failed to create renewal request:', txErr);
        return NextResponse.json(
          { error: 'Failed to create renewal request. Please retry.' },
          { status: 503 }
        );
      }

      // OFFLINE PAYMENT: No Supabase payment row is created at submission time.
      // Financial ledger records are created ONLY after admin/moderator verification
      // and approval. The student's submitted payment details (transactionId,
      // receiptImageUrl) are stored in the renewal request for review.

      const [adminsSnapshot, moderatorsSnapshot] = await Promise.all([
        adminDb.collection('admins').get(),
        adminDb.collection('moderators').get(),
      ]);

      const allStaffIds = [
        ...adminsSnapshot.docs.map(doc => doc.id),
        ...moderatorsSnapshot.docs.map(doc => doc.id),
      ];

      if (allStaffIds.length > 0) {
        const expiryDate = new Date();
        expiryDate.setHours(23, 59, 59, 999);

        await adminDb.collection('notifications').add({
          title: 'New Renewal Request',
          content: `${studentName} (${enrollmentId}) has submitted an offline renewal request for ${durationYears} year(s).`,
          sender: {
            userId,
            userName: studentName,
            userRole: 'student',
            enrollmentId,
          },
          target: {
            type: 'specific_users',
            specificUserIds: allStaffIds,
          },
          recipientIds: allStaffIds,
          autoInjectedRecipientIds: [],
          readByUserIds: [],
          isEdited: false,
          isDeletedGlobally: false,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: expiryDate.toISOString(),
        }).catch(err => console.error('Failed to send renewal notification to staff:', err));
      }

      return NextResponse.json({
        success: true,
        message: 'Offline renewal request submitted successfully',
        requestId: dedupeDocId,
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
