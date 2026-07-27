import { getUserById } from '@/domains/identity';
import { getByUid as getStudentByUid } from '@/domains/student';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { getModeratorPermissions } from '@/lib/security/moderator-permissions';
import { checkRateLimit,createRateLimitId } from '@/lib/security/rate-limiter';
import { paymentsSupabaseService,type PaymentRecord } from '@/lib/services/payments-supabase';
import { generateReceiptPdf } from '@/lib/services/receipt.service';
import { NextRequest,NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

function safeFilenamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Student';
}

function getApprovedByDisplay(payment: PaymentRecord): string {
  if (payment.method !== 'Offline') {
    return 'ADTU Integrated Transit Management System (ITMS)';
  }

  const approvedBy = payment.approved_by;
  if (!approvedBy) return 'ADTU ITMS System';

  if (typeof approvedBy === 'object') {
    const name = approvedBy.name || 'Staff';
    const role = approvedBy.role || 'Moderator';
    const empId = approvedBy.empId || approvedBy.userId || role;
    return `${name} (${empId})`;
  }

  return String(approvedBy);
}

function getPaymentReference(payment: PaymentRecord): string | undefined {
  return payment.razorpay_payment_id || payment.razorpay_order_id || payment.offline_transaction_id;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asOptionalStringOrNumber(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

async function canModeratorDownloadReceipt(uid: string): Promise<boolean> {
  const permissions = await getModeratorPermissions(uid);
  return Boolean(
    permissions.payments.canApproveOfflinePayment
    || permissions.payments.canRejectOfflinePayment
  );
}

async function getStudentEnrollment(uid: string): Promise<string> {
  const [student, user] = await Promise.all([
    getStudentByUid(uid),
    getUserById(uid),
  ]);

  return (
    (student as any)?.enrollmentId
    || (user as any)?.enrollmentId
    || ''
  );
}

function getReceiptDisplayData(payment: PaymentRecord): {
  studentName: string;
  enrollmentId: string;
  faculty?: string;
} {
  return {
    studentName: payment.student_name || 'Student',
    enrollmentId: payment.student_id || '',
    faculty: asOptionalString(payment.metadata?.faculty),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params;

  if (!paymentId || paymentId.length > 128) {
    return NextResponse.json({ error: 'Invalid payment id' }, { status: 400 });
  }

  const auth = await verifyApiAuth(request, ['student', 'admin', 'moderator']);
  if (!auth.authenticated) return auth.response;

  const rateLimitId = createRateLimitId(auth.uid, 'receipt-download');
  const rateCheck = checkRateLimit(rateLimitId, 20, 60_000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many receipt download requests. Please wait.' },
      { status: 429 }
    );
  }

  const payment = await paymentsSupabaseService.getPaymentById(paymentId);
  if (!payment) {
    return NextResponse.json({ error: 'Payment record not found' }, { status: 404 });
  }

  if (payment.status !== 'Completed') {
    return NextResponse.json(
      { error: 'Receipt is available only after payment approval' },
      { status: 403 }
    );
  }

  const display = getReceiptDisplayData(payment);

  if (auth.role === 'student') {
    const enrollmentId = display.enrollmentId || payment.student_id || '';
    const userEnrollmentId = enrollmentId ? await getStudentEnrollment(auth.uid) : '';
    const ownsReceipt = payment.student_uid === auth.uid
      || (Boolean(enrollmentId) && enrollmentId === userEnrollmentId);

    if (!ownsReceipt) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  if (auth.role === 'moderator' && !(await canModeratorDownloadReceipt(auth.uid))) {
    return NextResponse.json({ error: 'Moderator payment permission not granted' }, { status: 403 });
  }

  const pdfBuffer = await generateReceiptPdf(paymentId);
  if (!pdfBuffer) {
    return NextResponse.json({ error: 'Failed to generate receipt' }, { status: 500 });
  }

  const safeFilename = `Receipt_${safeFilenamePart(display.studentName)}_${safeFilenamePart(paymentId)}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
    },
  });
}
