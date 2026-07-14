import { NextResponse, NextRequest } from 'next/server';
import { createRazorpayOrder, generateReceiptId } from '@/lib/payment/razorpay.service';
import { withSecurity } from '@/lib/security/api-security';
import { CreateOrderSchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getSystemConfig } from '@/domains/admin';
import { z } from 'zod';
import { getByUid as getStudentByUid } from '@/domains/student';

type CreateOrderBody = z.infer<typeof CreateOrderSchema>;

function amountsMatch(clientAmount: number, expectedAmount: number): boolean {
    return Math.round(clientAmount * 100) === Math.round(expectedAmount * 100);
}

export const POST = withSecurity<CreateOrderBody>(
    async (_request, { auth, body }) => {
        const { amount, notes, userName, purpose, enrollmentId, durationYears } = body;
        const trustedUserId = auth.uid;
        const trustedDurationYears = durationYears || Number(notes?.duration || 1);
        const systemConfig = await getSystemConfig();
        const busFeeAmount = Number(systemConfig.busFee?.amount || 0);
        const expectedAmount = busFeeAmount * trustedDurationYears;

        if (!busFeeAmount || !amountsMatch(amount, expectedAmount)) {
            return NextResponse.json(
                { success: false, error: 'Payment amount does not match the official bus fee' },
                { status: 400 }
            );
        }

        const student = await getStudentByUid(trustedUserId).catch(() => null);
        const studentData = student as any;
        const trustedEnrollmentId = studentData?.enrollmentId || enrollmentId || notes?.enrollmentId || '';
        const trustedStudentName = studentData?.fullName || studentData?.name || userName || auth.name || 'Unknown';

        // Generate unique receipt ID
        const receipt = generateReceiptId('ADTU_BUS');

        // Create order notes - IMPORTANT: These are used by webhook/verification
        // SECURITY: Use trustedUserId (from auth) instead of client-supplied userId
        const orderNotes = {
            ...notes,
            userId: trustedUserId || 'unknown',
            enrollmentId: trustedEnrollmentId,
            studentId: trustedEnrollmentId || trustedUserId || '',
            studentName: trustedStudentName,
            userName: trustedStudentName,
            durationYears: trustedDurationYears.toString(),
            purpose: purpose || 'Bus Service Payment',
            type: purpose === 'renewal' ? 'renewal' : 'new_registration',
            timestamp: new Date().toISOString(),
        };

        // Create Razorpay order
        const order = await createRazorpayOrder(expectedAmount, receipt, orderNotes);

        console.log('📝 Order created:', {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt,
        });

        return NextResponse.json({
            success: true,
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency,
                receipt: order.receipt,
                status: order.status,
                notes: order.notes,
            },
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        });
    },
    {
        requiredRoles: [], // Any authenticated user can create an order
        schema: CreateOrderSchema,
        rateLimit: RateLimits.PAYMENT_CREATE,
        allowBodyToken: true
    }
);

// OPTIONS method for CORS - Production safe
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin') || '';

  // SECURITY: Define allowed origins
  const allowedOrigins: string[] = [
    'https://adtu-bus.vercel.app',
    'https://adtu-bus-xq.vercel.app',
    process.env.NEXT_PUBLIC_APP_URL || '',
  ].filter(Boolean);

  // Check if origin is allowed (includes Vercel preview deployments)
  const isVercelPreview = /^https:\/\/.*\.vercel\.app$/.test(origin);
  const isLocalhost = process.env.NODE_ENV === 'development' &&
    (origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000');
  const isAllowed = allowedOrigins.includes(origin) || isVercelPreview || isLocalhost;

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': isAllowed ? origin : (allowedOrigins[0] || ''),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', // 24 hours
    },
  });
}
