import { getStudentById,getUserById } from '@/domains/identity';
import { getDeadlineConfig } from '@/lib/deadline-config-service';
import { adminAuth } from '@/lib/firebase-admin';
import {
	formatDateWithOrdinal,
	generateDatePreview
} from '@/lib/utils/deadline-computation';
import { NextRequest,NextResponse } from 'next/server';

/**
 * POST /api/settings/deadline-preview
 * 
 * Preview the effect of deadline configuration on specific students.
 * Used by admin UI to show what dates would be computed for students
 * before saving configuration changes.
 * 
 * Request body:
 * {
 *   studentIds: string[];  // Student IDs to preview (max 10)
 *   config?: object;       // Optional config override to preview
 *   simulationMode?: { enabled: boolean; customYear: number }
 * }
 * 
 * Response:
 * {
 *   previews: DatePreviewResult[];
 *   summary: {
 *     totalStudents: number;
 *     wouldSoftBlock: number;
 *     wouldHardDelete: number;
 *   }
 * }
 */
export async function POST(req: NextRequest) {
    try {
        // Verify admin authentication
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { message: 'Unauthorized' },
                { status: 401 }
            );
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        // Check if user is admin or moderator via PostgreSQL (canonical source of truth)
        const user = await getUserById(uid);
        if (!user || !['admin', 'moderator'].includes(user.role)) {
            return NextResponse.json(
                { message: 'Access denied. Admin or moderator only.' },
                { status: 403 }
            );
        }

        const body = await req.json();
        const { studentIds, config: configOverride, simulationMode } = body;

        // Validate input
        if (!studentIds || !Array.isArray(studentIds)) {
            return NextResponse.json(
                { message: 'studentIds must be an array' },
                { status: 400 }
            );
        }

        if (studentIds.length > 10) {
            return NextResponse.json(
                { message: 'Maximum 10 students can be previewed at once' },
                { status: 400 }
            );
        }

        // Use provided config or fetch dynamic database config
        const dbConfig = await getDeadlineConfig();
        const config = configOverride || dbConfig;
        const simMode = simulationMode || { enabled: (config as any).testingMode?.enabled, customYear: (config as any).testingMode?.customYear };

        // Fetch students
        const previews: any[] = [];
        const today = new Date();
        let wouldSoftBlock = 0;
        let wouldHardDelete = 0;

        for (const studentId of studentIds) {
            try {
                // Fetch student from PostgreSQL (canonical source of truth)
                const studentData = await getStudentById(studentId);

                if (!studentData) {
                    previews.push({
                        studentId,
                        error: 'Student not found',
                        exists: false
                    });
                    continue;
                }

                if (!studentData.sessionEndYear) {
                    previews.push({
                        studentId,
                        studentName: studentData.fullName || studentData.name || 'Unknown',
                        studentEmail: studentData.email,
                        error: 'Student missing sessionEndYear',
                        exists: true,
                        hasSessionEndYear: false
                    });
                    continue;
                }

                // Compute preview
                const preview = generateDatePreview(
                    {
                        id: studentId,
                        name: studentData.name,
                        fullName: studentData.fullName,
                        email: studentData.email,
                        sessionEndYear: studentData.sessionEndYear,
                        status: studentData.status
                    },
                    config,
                    simMode
                );

                if (preview) {
                    previews.push({
                        ...preview,
                        exists: true,
                        hasSessionEndYear: true,
                        // Add formatted dates for display
                        formattedDates: {
                            serviceExpiry: formatDateWithOrdinal(new Date(preview.computedDates.serviceExpiryDate)),
                            renewalNotification: formatDateWithOrdinal(new Date(preview.computedDates.renewalNotificationDate)),
                            renewalDeadline: formatDateWithOrdinal(new Date(preview.computedDates.renewalDeadlineDate)),
                            softBlock: formatDateWithOrdinal(new Date(preview.computedDates.softBlockDate)),
                            hardDelete: formatDateWithOrdinal(new Date(preview.computedDates.hardDeleteDate)),
                            urgentWarning: formatDateWithOrdinal(new Date(preview.computedDates.urgentWarningDate))
                        },
                        validUntil: studentData.validUntil,
                        currentStatus: studentData.status || 'active'
                    });

                    // Count actions
                    if (preview.todayActions.wouldSoftBlock) wouldSoftBlock++;
                    if (preview.todayActions.wouldHardDelete) wouldHardDelete++;
                }
            } catch (error: any) {
                previews.push({
                    studentId,
                    error: 'An unexpected error occurred',
                    exists: false
                });
            }
        }

        return NextResponse.json({
            previews,
            summary: {
                totalStudents: studentIds.length,
                successfulPreviews: previews.filter(p => !p.error).length,
                wouldSoftBlock,
                wouldHardDelete,
                previewDate: today.toISOString(),
                 configVersion: config.version || dbConfig.version,
                 simulationMode: simMode.enabled,
                 simulationYear: simMode.enabled ? simMode.customYear : null
             },
             // Configuration used for preview
             configUsed: {
                 academicYear: {
                     anchorMonth: config.academicYear?.anchorMonth ?? dbConfig.academicYear.anchorMonth,
                     anchorDay: config.academicYear?.anchorDay ?? dbConfig.academicYear.anchorDay
                 },
                 softBlock: {
                     month: config.softBlock?.month ?? dbConfig.softBlock.month,
                     day: config.softBlock?.day ?? dbConfig.softBlock.day
                 },
                 hardDelete: {
                     month: config.hardDelete?.month ?? dbConfig.hardDelete.month,
                     day: config.hardDelete?.day ?? dbConfig.hardDelete.day,
                     note: 'Hard delete always occurs in sessionEndYear + 1'
                 },
                 urgentWarningDays: config.urgentWarningThreshold?.days ?? dbConfig.urgentWarningThreshold.days
             }
        });

    } catch (error: any) {
        console.error('Error in deadline preview:', error);
        return NextResponse.json(
            { message: 'Failed to generate preview' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/settings/deadline-preview?studentId=xxx
 * 
 * Quick preview for a single student using current config.
 * Useful for the student view popup in admin.
 */
export async function GET(req: NextRequest) {
    try {
        // Verify authentication
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { message: 'Unauthorized' },
                { status: 401 }
            );
        }

        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await adminAuth.verifyIdToken(token);
        const uid = decodedToken.uid;

        // Check if user is admin or moderator via PostgreSQL (canonical source of truth)
        const user = await getUserById(uid);
        if (!user || !['admin', 'moderator'].includes(user.role)) {
            return NextResponse.json(
                { message: 'Access denied' },
                { status: 403 }
            );
        }

        const url = new URL(req.url);
        const studentId = url.searchParams.get('studentId');

        if (!studentId) {
            return NextResponse.json(
                { message: 'studentId is required' },
                { status: 400 }
            );
        }

        // Fetch student from PostgreSQL (canonical source of truth)
        const studentData = await getStudentById(studentId);

        if (!studentData) {
            return NextResponse.json(
                { message: 'Student not found' },
                { status: 404 }
            );
        }

        if (!studentData.sessionEndYear) {
            return NextResponse.json({
                studentId,
                studentName: studentData.fullName || studentData.name || 'Unknown',
                error: 'Student missing sessionEndYear - cannot compute dates',
                recommendation: 'Please set the sessionEndYear field for this student'
            });
        }

        const dbConfig = await getDeadlineConfig();
        // Use current config with simulation mode if enabled
        const simMode = (dbConfig as any).testingMode?.enabled
            ? { enabled: true, customYear: (dbConfig as any).testingMode.customYear }
            : undefined;

        const preview = generateDatePreview(
            {
                id: studentId,
                name: studentData.name,
                fullName: studentData.fullName,
                email: studentData.email,
                sessionEndYear: studentData.sessionEndYear,
                status: studentData.status
            },
            dbConfig,
            simMode
        );

        if (!preview) {
            return NextResponse.json(
                { message: 'Could not generate preview' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            ...preview,
            formattedDates: {
                serviceExpiry: formatDateWithOrdinal(new Date(preview.computedDates.serviceExpiryDate)),
                renewalDeadline: formatDateWithOrdinal(new Date(preview.computedDates.renewalDeadlineDate)),
                softBlock: formatDateWithOrdinal(new Date(preview.computedDates.softBlockDate)),
                hardDelete: formatDateWithOrdinal(new Date(preview.computedDates.hardDeleteDate)),
                urgentWarning: formatDateWithOrdinal(new Date(preview.computedDates.urgentWarningDate))
            },
            validUntil: studentData.validUntil,
            configVersion: dbConfig.version,
            note: 'Hard delete occurs in the NEXT academic cycle (sessionEndYear + 1)'
        });

    } catch (error: any) {
        console.error('Error in deadline preview:', error);
        return NextResponse.json(
            { message: 'Failed to generate preview' },
            { status: 500 }
        );
    }
}
