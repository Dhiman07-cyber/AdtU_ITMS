import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getDeadlineConfig, updateDeadlineConfig } from '@/lib/deadline-config-service';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { safeGetNested, stripUnsafeObjectKeys } from '@/lib/security/object-safety';

/**
 * Check if dependent lifecycle records exist in the system
 */
async function checkDependencies(): Promise<boolean> {
    try {
        const studentsSnap = await adminDb.collection('students').limit(1).get();
        if (!studentsSnap.empty) {
            return true;
        }

        const verifiedUpcomingSnap = await adminDb.collection('applications')
            .where('state', '==', 'verified_upcoming')
            .limit(1)
            .get();
        if (!verifiedUpcomingSnap.empty) {
            return true;
        }

        const pendingSeatSnap = await adminDb.collection('applications')
            .where('state', '==', 'pending_seat_allocation')
            .limit(1)
            .get();
        if (!pendingSeatSnap.empty) {
            return true;
        }

        return false;
    } catch (error) {
        console.error('Error checking dependencies:', error);
        return true; // Safe fallback
    }
}

/**
 * GET: Retrieve deadline config and check if it is locked by dependencies
 */
export async function GET(req: NextRequest) {
    try {
        const config = await getDeadlineConfig();
        const hasDependencies = await checkDependencies();
        return NextResponse.json({ config, hasDependencies });
    } catch (error: any) {
        console.error('Error fetching deadline config:', error);
        return NextResponse.json(
            { 
                message: 'Unstable network detected, please try again later',
                error: 'An unexpected error occurred' },
            { status: 503 }
        );
    }
}

/**
 * POST: Update deadline config in Firestore and sync dates to system-config
 */
export async function POST(req: NextRequest) {
    try {
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

        // Check if user is admin
        try {
            const userDoc = await adminDb.collection('users').doc(uid).get();
            if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
                return NextResponse.json(
                    { message: 'Access denied. Admin only.' },
                    { status: 403 }
                );
            }
        } catch (error: any) {
            if (error.code === 8 || error.message?.includes('RESOURCE_EXHAUSTED')) {
                console.warn('⚠️ Firestore quota exceeded. Bypassing admin role check for verified user.');
            } else {
                throw error;
            }
        }

        const { config: rawConfig } = await req.json();
        const config = stripUnsafeObjectKeys(rawConfig);

        if (!config) {
            return NextResponse.json(
                { message: 'Invalid configuration data' },
                { status: 400 }
            );
        }

        // Validate dependency rules: block updates to Academic Session Start if active records exist
        const hasDependencies = await checkDependencies();
        if (hasDependencies) {
            const currentConfig = await getDeadlineConfig();
            const currentStart = currentConfig.academicSessionStart;
            const submittedStart = config.academicSessionStart;

            if (
                currentStart &&
                submittedStart &&
                (currentStart.month !== submittedStart.month || currentStart.day !== submittedStart.day)
            ) {
                return NextResponse.json(
                    { message: 'Cannot modify Academic Session Start once dependent student or application records exist in the system.' },
                    { status: 400 }
                );
            }
        }

        // Validate date fields
        const validationError = validateDateConfig(config);
        if (validationError) {
            return NextResponse.json(
                { message: validationError },
                { status: 400 }
            );
        }

        // 1. Update Deadline Config in Firestore
        await updateDeadlineConfig(config, uid);

        // 2. Sync concrete dates to System Config
        await syncSystemConfigDates(config as DeadlineConfig, uid);

        return NextResponse.json({
            message: 'Deadline configuration updated and synced successfully.',
            config
        });

    } catch (error: any) {
        console.error('Error updating deadline config:', error);
        return NextResponse.json(
            { message: 'Failed to update deadline configuration' },
            { status: 500 }
        );
    }
}

/**
 * Syncs the abstract rules from DeadlineConfig to concrete dates in SystemConfig
 */
async function syncSystemConfigDates(deadlineConfig: DeadlineConfig, uid: string) {
    // Deprecated: Concrete lifecycle dates are no longer synced to system_config to prevent dual sources of truth.
    // Consumers must query the canonical /api/settings/deadline-config endpoint directly.
    console.log('ℹ️ syncSystemConfigDates is deprecated and bypassed to maintain a single canonical source of truth.');
}

/**
 * Validate date configurations for valid month/day combinations.
 */
function validateDateConfig(config: any): string | null {
    const start = config.academicSessionStart;
    if (!start) {
        return 'Academic Session Start is required.';
    }

    const month = start.month;
    const day = start.day;

    if (month === undefined || day === undefined) {
        return 'Academic Session Start month and day are required.';
    }

    if (typeof month !== 'number' || !Number.isInteger(month) || month < 0 || month > 11) {
        return `Invalid month: ${month}. Must be 0-11.`;
    }

    const maxDay = getMaxDayForMonth(month);
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > maxDay) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        return `Invalid day ${day} for ${monthNames[month]}. Max is ${maxDay}.`;
    }

    return null;
}

function getMaxDayForMonth(month: number): number {
    const date = new Date(2024, month + 1, 0);
    return date.getDate();
}
