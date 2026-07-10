import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, adminDb } from '@/lib/firebase-admin';
import { getAllPayments, getPaymentsByStudent } from '@/lib/payment/payment.service';
import { getByUid as getStudentByUid } from '@/domains/student';
import { getUserById, getUserByEmail } from '@/domains/identity';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decodedToken = await verifyToken(token);
    const userId = decodedToken.uid;

    // Get user data via Identity domain API
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = user as any;

    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const studentUid = searchParams.get('studentUid');
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const paymentMethod = searchParams.get('paymentMethod') as 'Online' | 'Offline' | null;

    // Helper to map Firestore documents to frontend-expected format
    const userCache = new Map<string, string>(); // Optimized: Request-scope cache for user lookups

    const mapToFrontend = async (p: any) => {
      if (!p) return null;

      // Helper to resolve name from user ID or email
      const resolveName = async (userId: string | undefined, emailOrName: string) => {
        if (!emailOrName || !emailOrName.includes('@')) return emailOrName;

        // Check cache first
        const cacheKey = userId || emailOrName;
        if (userCache.has(cacheKey)) return userCache.get(cacheKey)!;

        try {
          let resolvedUser = null;
          if (userId) {
            resolvedUser = await getUserById(userId);
          }

          if (!resolvedUser && emailOrName.includes('@')) {
            resolvedUser = await getUserByEmail(emailOrName);
          }

          if (resolvedUser) {
            const resolvedName = (resolvedUser as any).fullName || (resolvedUser as any).name || emailOrName;
            userCache.set(cacheKey, resolvedName);
            return resolvedName;
          }
        } catch (e) {
          console.error('Error resolving name:', e);
        }
        return emailOrName;
      };

      // Map approvedBy object to string if it exists
      let approvedByStr = undefined;
      if (p.approvedBy) {
        if (typeof p.approvedBy === 'object') {
          if (['Manual', 'admin', 'moderator'].includes(p.approvedBy.type)) {
            const name = await resolveName(p.approvedBy.userId, p.approvedBy.name);
            const role = p.approvedBy.role || p.approvedBy.type || 'moderator';
            const suffix = role.toLowerCase() === 'admin' ? '(ADMIN)' : `(${p.approvedBy.empId || 'STAFF'})`;
            approvedByStr = `${name} ${suffix}`;
          } else if (p.approvedBy.type === 'SYSTEM') {
            approvedByStr = 'System Verified';
          }
        } else {
          // Handle string case
          const strValue = String(p.approvedBy);
          approvedByStr = strValue;

          // Check if it's the specific "email (ID)" format (e.g. "shivdj519@gmail.com (MB-01)")
          const emailMatch = strValue.match(/^(.+?) \((.+?)\)$/);
          if (emailMatch) {
            const email = emailMatch[1];
            const idPart = emailMatch[2];

            if (email.includes('@')) {
              const name = await resolveName(undefined, email);
              if (name !== email) {
                approvedByStr = `${name} (${idPart})`;
              }
            }
          }
        }
      }

      // Robust timestamp extraction
      const getTimestamp = (val: any) => {
        if (!val) return new Date().toISOString();
        if (typeof val.toDate === 'function') return val.toDate().toISOString();
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'string') return val;
        return new Date().toISOString();
      };

      return {
        ...p,
        paymentMethod: p.method?.toLowerCase() || 'online',
        status: p.status?.toLowerCase() || 'completed',
        approvedBy: approvedByStr,
        timestamp: getTimestamp(p.createdAt || p.timestamp),
        validUntil: p.validUntil ? getTimestamp(p.validUntil) : 'N/A'
      };
    };

    // For students, they can only view their own transactions
    if (userData.role === 'student') {
      // Get enrollment ID via Student domain API
      let enrollmentId = userData.enrollmentId;

      if (!enrollmentId) {
        try {
          const student = await getStudentByUid(userId);
          if (student) {
            enrollmentId = (student as any).enrollmentId;
          }
        } catch (e) {
          console.warn('Failed to fetch student profile for enrollment ID', e);
        }
      }

      const payments = await getPaymentsByStudent(userId, enrollmentId);

      // D8: Fetch pending renewal application from PostgreSQL instead of Firestore
      const pendingRenewalApp = await import('@/domains/application').then(m => m.getByApplicantUid(userId));

      const pendingRequests = (pendingRenewalApp &&
        pendingRenewalApp.state === 'submitted' &&
        (pendingRenewalApp.applicationType === 'renewal' || pendingRenewalApp.applicationType === 'renewal_after_soft_block')
      ) ? [{
          paymentId: pendingRenewalApp.applicationId,
          studentId: (pendingRenewalApp.formData as any)?.enrollmentId || '',
          studentName: (pendingRenewalApp.formData as any)?.studentName || '',
          amount: (pendingRenewalApp.formData as any)?.totalFee || 0,
          paymentMethod: 'offline',
          method: 'Offline',
          status: 'pending',
          durationYears: (pendingRenewalApp.formData as any)?.durationYears || 0,
          timestamp: pendingRenewalApp.createdAt || new Date().toISOString(),
          validUntil: 'Pending Approval',
          isRequest: true
        }] : [];

      const processedPayments = await Promise.all(payments.map(mapToFrontend));

      const transactions = [
        ...pendingRequests,
        ...processedPayments.filter(Boolean)
      ].sort((a: any, b: any) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      return NextResponse.json({
        success: true,
        transactions,
        total: transactions.length
      });
    }

    // For admin/moderator, allow viewing all transactions with filters
    if (['admin', 'moderator'].includes(userData.role)) {
      const result = await getAllPayments(
        {
          year: year ? parseInt(year) : undefined,
          studentId: studentId || undefined,
          studentUid: studentUid || undefined,
          method: paymentMethod || undefined
        },
        page,
        limit
      );

      return NextResponse.json({
        success: true,
        transactions: await Promise.all(result.payments.map(mapToFrontend)),
        total: result.total,
        page: result.page,
        totalPages: result.totalPages
      });
    }

    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
