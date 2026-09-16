import { getByApplicantUid } from '@/domains/application';
import { getUserByEmail, getUserById } from '@/domains/identity';
import { getByUid as getStudentByUid } from '@/domains/student';
import { getAllPayments, getPaymentsByStudent } from '@/lib/payment/payment.service';
import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { NextResponse } from 'next/server';

export const GET = withSecurity(
  async (request, { auth }) => {
    try {
      const userId = auth.uid;
      const userRole = auth.role;

      const { searchParams } = new URL(request.url);
      const studentId = searchParams.get('studentId');
      const studentUid = searchParams.get('studentUid');
      const year = searchParams.get('year');
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '50');
      const paymentMethod = searchParams.get('paymentMethod') as 'Online' | 'Offline' | null;

      // Helper to map Firestore documents to frontend-expected format
      const userCache = new Map<string, string>(); // Request-scope cache for user lookups

      const prefetchApprovers = async (paymentsList: any[]) => {
        const userIdsToFetch = new Set<string>();
        const emailsToFetch = new Set<string>();

        for (const p of paymentsList) {
          const approver = p?.approvedBy || p?.approved_by;
          if (approver) {
            if (typeof approver === 'object') {
              if (['Manual', 'admin', 'moderator'].includes(approver.type)) {
                if (approver.userId && !userCache.has(approver.userId)) {
                  userIdsToFetch.add(approver.userId);
                } else if (approver.name && approver.name.includes('@') && !userCache.has(approver.name)) {
                  emailsToFetch.add(approver.name);
                }
              }
            } else {
              const strValue = String(approver);
              const emailMatch = strValue.match(/^(.+?) \((.+?)\)$/);
              if (emailMatch && emailMatch[1].includes('@') && !userCache.has(emailMatch[1])) {
                emailsToFetch.add(emailMatch[1]);
              }
            }
          }
        }

        if (userIdsToFetch.size === 0 && emailsToFetch.size === 0) return;

        await Promise.all([
          ...Array.from(userIdsToFetch).map(async (uid) => {
            try {
              const user = await getUserById(uid);
              if (user) {
                userCache.set(uid, (user as any).fullName || (user as any).name || uid);
              }
            } catch (e) {
              console.warn('Failed to pre-fetch user by ID', e);
            }
          }),
          ...Array.from(emailsToFetch).map(async (email) => {
            try {
              const user = await getUserByEmail(email);
              if (user) {
                userCache.set(email, (user as any).fullName || (user as any).name || email);
              }
            } catch (e) {
              console.warn('Failed to pre-fetch user by email', e);
            }
          }),
        ]);
      };

      const mapToFrontend = async (p: any) => {
        if (!p) return null;

        // Helper to resolve name from user ID or email
        const resolveName = async (uid: string | undefined, emailOrName: string) => {
          if (!emailOrName || !emailOrName.includes('@')) return emailOrName;

          const cacheKey = uid || emailOrName;
          if (userCache.has(cacheKey)) return userCache.get(cacheKey)!;

          try {
            let resolvedUser = null;
            if (uid) {
              resolvedUser = await getUserById(uid);
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
            console.warn('Failed to resolve user name for payment', e);
          }
          return emailOrName;
        };

        // Map approvedBy object to string if it exists
        let approvedByStr = undefined;
        const approver = p?.approvedBy || p?.approved_by;
        if (approver) {
          if (typeof approver === 'object') {
            if (['Manual', 'admin', 'moderator'].includes(approver.type)) {
              const name = await resolveName(approver.userId, approver.name);
              const role = approver.role || approver.type || 'moderator';
              const suffix = role.toLowerCase() === 'admin' ? '(ADMIN)' : `(${approver.empId || 'STAFF'})`;
              approvedByStr = `${name} ${suffix}`;
            } else if (approver.type === 'SYSTEM') {
              approvedByStr = 'System-Approved';
            }
          } else {
            const strValue = String(approver);
            approvedByStr = (strValue === 'AdtU ITMS System' || strValue === 'System Verified') ? 'System-Approved' : strValue;

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
          approvedBy: approvedByStr || (p.method?.toLowerCase() === 'online' ? 'System-Approved' : '-'),
          timestamp: getTimestamp(p.createdAt || p.timestamp),
          validUntil: p.validUntil ? getTimestamp(p.validUntil) : 'N/A'
        };
      };

      // For students, they can only view their own transactions
      if (userRole === 'student') {
        let enrollmentId: string | undefined;

        try {
          const student = await getStudentByUid(userId);
          if (student) {
            enrollmentId = (student as any).enrollmentId;
          }
        } catch (e) {
          console.warn('Failed to fetch student profile for enrollment ID', e);
        }

        const { payments, total } = await getPaymentsByStudent(userId, enrollmentId, page, limit);
        await prefetchApprovers(payments);

        const pendingRenewalApp = await getByApplicantUid(userId);

        let pendingRequests: any[] = [];
        if (
          pendingRenewalApp &&
          pendingRenewalApp.state === 'submitted' &&
          (pendingRenewalApp.applicationType === 'renewal' || pendingRenewalApp.applicationType === 'renewal_after_soft_block')
        ) {
          const formAny = (pendingRenewalApp.formData || {}) as any;
          const targetSession = pendingRenewalApp.targetSession;
          const sessionLabel = targetSession
            ? (typeof targetSession === 'object' && 'startYear' in targetSession
                ? `${targetSession.startYear}-${targetSession.endYear}`
                : String(targetSession))
            : 'Upcoming Session';

          pendingRequests = [{
            id: pendingRenewalApp.applicationId,
            amount: formAny.paymentDetails?.amount || formAny.paymentInfo?.amountPaid || formAny.paymentInfo?.amount || 0,
            paymentMethod: 'offline',
            status: 'pending',
            timestamp: pendingRenewalApp.createdAt,
            validUntil: 'Pending Approval',
            approvedBy: 'Pending Verification',
            academicSession: sessionLabel,
            receiptImageUrl: formAny.paymentDetails?.receiptImageUrl || formAny.paymentInfo?.paymentEvidenceUrl,
            offlineTransactionId: formAny.paymentDetails?.transactionId || formAny.paymentInfo?.paymentReference,
            type: 'Renewal Application'
          }];
        }

        const transactions = [
          ...pendingRequests,
          ...(await Promise.all(payments.map(mapToFrontend)))
        ];

        return NextResponse.json({
          success: true,
          transactions,
          total: total + pendingRequests.length,
          page,
          limit
        });
      }

      // For admin/moderator, allow viewing all transactions with filters
      if (['admin', 'moderator'].includes(userRole)) {
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

        await prefetchApprovers(result.payments);

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
  },
  {
    requiredRoles: ['admin', 'moderator', 'student'],
    rateLimit: RateLimits.READ,
  }
);
