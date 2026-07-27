import { getByUid } from '@/domains/student';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { PaymentHistoryQuerySchema } from '@/lib/security/validation-schemas';
import { PaymentRecord,paymentsSupabaseService } from '@/lib/services/payments-supabase';
import { NextResponse } from 'next/server';

/**
 * GET /api/student/payment-history
 * 
 * Fetches paginated payment history for a student.
 */
export const GET = withSecurity(
    async (request, { auth, body }) => {
        // withSecurity for GET puts searchParams in 'body' after validation
        const { uid, limit, offset } = body as any;
        const requesterUid = auth.uid;
        const requesterRole = (auth as any).role; // withSecurity attaches role to auth context

        let targetStudentUid = uid || requesterUid;

        // 1. Authorization: Students can only fetch THEIR OWN history
        if (requesterRole === 'student' && targetStudentUid !== requesterUid) {
            return NextResponse.json(
                { error: 'Forbidden: You can only view your own payment history' },
                { status: 403 }
            );
        }

        // 2. Fetch payment history using paymentsSupabaseService
        // ✅ This properly decrypts sensitive fields (student_name, offline_transaction_id)
        const payments = await paymentsSupabaseService.getPaymentsByStudentUid(
            targetStudentUid,
            { limit, offset }
        );

        // 3. Transform payments for response (already decrypted by paymentsSupabaseService)
        const paymentHistory = payments.map((p: PaymentRecord) => ({
            paymentId: p.payment_id,
            amount: p.amount || 0,
            currency: p.currency || 'INR',
            method: p.method,
            status: p.status,
            sessionStartYear: p.session_start_year,
            sessionEndYear: p.session_end_year,
            durationYears: p.duration_years,
            validUntil: p.valid_until,
            transactionDate: p.transaction_date,
            razorpayPaymentId: p.razorpay_payment_id,
            razorpayOrderId: p.razorpay_order_id,
            offlineTransactionId: p.offline_transaction_id,
            approvedBy: p.approved_by,
            approvedAt: p.approved_at,
            createdAt: p.created_at,
        }));

        // 4. Calculate total count for pagination (approximate)
        const totalCount = paymentHistory.length === limit ? limit + offset + 1 : paymentHistory.length + offset;

        // 5. Calculate current validity from most recent completed payment
        let currentValidity: string | null = null;
        const completedPayments = payments.filter((p: PaymentRecord) => p.status === 'Completed');
        if (completedPayments.length > 0) {
            const sorted = [...completedPayments].sort((a: PaymentRecord, b: PaymentRecord) =>
                new Date(b.transaction_date || 0).getTime() - new Date(a.transaction_date || 0).getTime()
            );
            currentValidity = sorted[0].valid_until || null;
        }

        // 6. Get student basic info from PostgreSQL
        let studentName = 'Unknown';
        let studentId = null;
        try {
            const studentData = await getByUid(targetStudentUid) as Record<string, any> | null;
            if (studentData) {
                studentName = studentData.name || studentData.fullName || 'Unknown';
                studentId = studentData.enrollmentId || studentData.id || null;
            }
        } catch (err) {
            console.warn('Could not fetch student info:', err);
        }

        return NextResponse.json({
            success: true,
            studentUid: targetStudentUid,
            studentName,
            studentId,
            paymentHistory,
            pagination: {
                total: totalCount,
                limit,
                offset,
                hasMore: paymentHistory.length === limit,
            },
            currentValidity,
            source: 'supabase',
        });
    },
    {
        requiredRoles: ['student', 'admin', 'moderator'],
        schema: PaymentHistoryQuerySchema,
        rateLimit: RateLimits.READ
    }
);
