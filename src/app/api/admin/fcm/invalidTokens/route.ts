import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { withSecurity } from '@/lib/security/api-security';
import { InvalidTokensQuerySchema } from '@/lib/security/validation-schemas';
import { RateLimits } from '@/lib/security/rate-limiter';
import { getAllStudents } from '@/domains/identity';

export const GET = withSecurity(
    async (request, { body }) => {
        const olderThanDays = body.olderThan || 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);

        // Scan students for stale tokens
        const students = await getAllStudents();
        const staleTokens: Array<{
            studentId: string;
            tokenHash: string;
            platform: string;
            lastSeen: string;
            valid: boolean;
        }> = [];

        let totalTokens = 0;
        let validTokens = 0;

        for (const student of students) {
            const tokensSnap = await adminDb!.collection('students').doc(student.uid).collection('tokens').get();
            for (const tokenDoc of tokensSnap.docs) {
                totalTokens++;
                const data = tokenDoc.data();
                if (data?.valid) validTokens++;

                let lastSeenDate: Date | null = null;
                if (data?.lastSeen?.toDate) {
                    lastSeenDate = data.lastSeen.toDate();
                } else if (data?.lastSeen && typeof data.lastSeen === 'string') {
                    lastSeenDate = new Date(data.lastSeen);
                }

                const isStale = lastSeenDate && lastSeenDate < cutoff;
                const isInvalid = data?.valid === false;

                if (isStale || isInvalid) {
                    staleTokens.push({
                        studentId: student.uid,
                        tokenHash: tokenDoc.id,
                        platform: data?.platform || 'unknown',
                        lastSeen: lastSeenDate?.toISOString() || 'unknown',
                        valid: data?.valid ?? false,
                    });
                }
            }
        }

        // Also check for legacy fcmToken fields that aren't in subcollection
        let legacyTokenCount = 0;
        for (const student of students) {
            if (student.fcmToken && typeof student.fcmToken === 'string') {
                legacyTokenCount++;
            }
        }

        return NextResponse.json({
            summary: {
                totalStudents: students.length,
                totalTokens,
                validTokens,
                staleOrInvalidTokens: staleTokens.length,
                legacyTokensNotMigrated: legacyTokenCount,
                olderThanDays,
            },
            staleTokens: staleTokens.slice(0, 100), // Cap at 100 for response size
        });
    },
    {
        requiredRoles: ['admin'],
        schema: InvalidTokensQuerySchema,
        rateLimit: RateLimits.READ
    }
);

