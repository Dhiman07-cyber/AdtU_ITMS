import { invalidateConfigCache } from '@/domains/admin';
import { invalidateActiveConfigCache } from '@/domains/calendar';
import { invalidateStudentAssignmentCache } from '@/domains/student';
import { getUserById } from '@/domains/identity';
import { getDeadlineConfig, updateDeadlineConfig } from '@/lib/deadline-config-service';
import { adminAuth } from '@/lib/firebase-admin';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { stripUnsafeObjectKeys } from '@/lib/security/object-safety';
import { checkRateLimit, createRateLimitId, RateLimits } from '@/lib/security/rate-limiter';
import { getSupabaseServer } from '@/lib/supabase-server';
import { DeadlineConfig } from '@/lib/types/deadline-config';
import { deriveAcademicLifecycle } from '@/lib/utils/deadline-computation';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Check if dependent lifecycle records exist in the system (PostgreSQL)
 */
async function checkDependencies(): Promise<boolean> {
    try {
        const supabase = getSupabaseServer();

        // Check if any student profiles or pending/upcoming applications exist in parallel
        const [studentRes, upcomingRes, pendingSeatRes] = await Promise.all([
            supabase
                .from('student_profiles')
                .select('uid', { count: 'exact', head: true })
                .limit(1),
            supabase
                .from('applications')
                .select('application_id', { count: 'exact', head: true })
                .eq('state', 'verified_upcoming')
                .limit(1),
            supabase
                .from('applications')
                .select('application_id', { count: 'exact', head: true })
                .eq('state', 'pending_seat_allocation')
                .limit(1),
        ]);

        if (
            (studentRes.count && studentRes.count > 0) ||
            (upcomingRes.count && upcomingRes.count > 0) ||
            (pendingSeatRes.count && pendingSeatRes.count > 0)
        ) {
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
        const [config, hasDependencies] = await Promise.all([
            getDeadlineConfig(),
            checkDependencies(),
        ]);
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
 * POST: Update deadline config and cascade recalculation to students and applications
 */
export async function POST(req: NextRequest) {
    try {
        const auth = await verifyApiAuth(req, ['admin']);
        if (!auth.authenticated) return auth.response;

        const uid = auth.uid;

        // Rate limiting: RateLimits.UPDATE
        const rateLimitId = createRateLimitId(uid, 'deadline-config');
        const rateCheck = checkRateLimit(rateLimitId, RateLimits.UPDATE.maxRequests, RateLimits.UPDATE.windowMs);
        if (!rateCheck.allowed) {
            return NextResponse.json(
                { message: 'Too many requests. Please wait before updating deadline configuration.' },
                {
                    status: 429,
                    headers: { 'Retry-After': String(Math.ceil(rateCheck.resetIn / 1000)) },
                }
            );
        }

        const { config: rawConfig } = await req.json();
        const config = stripUnsafeObjectKeys(rawConfig);

        if (!config) {
            return NextResponse.json(
                { message: 'Invalid configuration data' },
                { status: 400 }
            );
        }

        // Validate date fields
        const validationError = validateDateConfig(config);
        if (validationError) {
            return NextResponse.json(
                { message: validationError },
                { status: 400 }
            );
        }

        // 1. Update Deadline Config in PostgreSQL system_settings
        await updateDeadlineConfig(config, uid);

        // 2. Cascade recalculation to student_profiles and applications
        await syncSystemConfigDates(config as DeadlineConfig, uid);

        // 3. Invalidate active config cache, config cache, and all student assignments
        invalidateActiveConfigCache();
        invalidateConfigCache('deadline');
        invalidateConfigCache('config');
        invalidateConfigCache();
        await invalidateStudentAssignmentCache('*');

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
 * Syncs the abstract rules from DeadlineConfig to concrete dates in student_profiles & applications
 */
export async function syncSystemConfigDates(deadlineConfig: DeadlineConfig, uid: string) {
    const startMonth = deadlineConfig.academicSessionStart?.month ?? 6;
    const startDay = deadlineConfig.academicSessionStart?.day ?? 1;

    const supabase = getSupabaseServer();

    // 1. Try atomic PL/pgSQL RPC first
    try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('recalculate_academic_lifecycle_dates', {
            p_start_month: startMonth,
            p_start_day: startDay,
        });

        if (!rpcError && rpcData?.success) {
            console.log(`[deadline-config] recalculate_academic_lifecycle_dates RPC executed successfully:`, rpcData);
            await invalidateStudentAssignmentCache('*');
            return;
        }
        if (rpcError) {
            console.warn('[deadline-config] RPC recalculate_academic_lifecycle_dates unavailable, running TypeScript fallback:', rpcError.message);
        }
    } catch (err: any) {
        console.warn('[deadline-config] Error invoking recalculate_academic_lifecycle_dates RPC, using TypeScript fallback:', err?.message || err);
    }

    // 2. TypeScript Fallback
    try {
        // A. Update student_profiles (Batched by session_end_year to eliminate N+1 waterfall)
        const { data: students, error: studErr } = await supabase
            .from('student_profiles')
            .select('session_end_year')
            .gt('session_end_year', 2000)
            .in('status', ['active', 'soft_blocked']);

        if (!studErr && students && students.length > 0) {
            const nowMs = Date.now();
            const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
            const uniqueYears = [...new Set(students.map((s) => s.session_end_year).filter(Boolean))];

            for (const year of uniqueYears) {
                const lifecycle = deriveAcademicLifecycle(startMonth, startDay, year);
                const newExpiry = lifecycle.expiry;
                const newSoftBlock = lifecycle.softBlock;
                const newHardBlock = lifecycle.hardDelete;
                const resetReminders = newExpiry.getTime() > nowMs + ninetyDaysMs;

                const updatePayload: Record<string, any> = {
                    valid_until: newExpiry.toISOString(),
                    soft_block: newSoftBlock.toISOString(),
                    hard_block: newHardBlock.toISOString(),
                    updated_at: new Date().toISOString(),
                };

                if (resetReminders) {
                    updatePayload.expiry_reminder_count = 0;
                    updatePayload.last_expiry_reminder_sent_at = null;
                }

                await supabase
                    .from('student_profiles')
                    .update(updatePayload)
                    .eq('session_end_year', year)
                    .in('status', ['active', 'soft_blocked']);
            }
        }

        // B. Update applications (Batched by targetYear to eliminate N+1 waterfall)
        const { data: apps, error: appErr } = await supabase
            .from('applications')
            .select('application_id, session_start_year, target_session, form_data')
            .in('state', ['submitted', 'verified_upcoming', 'pending_seat_allocation']);

        if (!appErr && apps && apps.length > 0) {
            const appIdsByYear = new Map<number, string[]>();
            for (const app of apps) {
                const targetYear = app.session_start_year ||
                    (app.target_session as any)?.startYear ||
                    (app.target_session as any)?.start_year ||
                    (app.form_data as any)?.sessionStartYear ||
                    (app.form_data as any)?.startYear ||
                    (app.form_data as any)?.sessionInfo?.sessionStartYear ||
                    (app.form_data as any)?.sessionInfo?.startYear;

                const yearNum = Number(targetYear);
                if (yearNum > 2000) {
                    const list = appIdsByYear.get(yearNum) || [];
                    list.push(app.application_id);
                    appIdsByYear.set(yearNum, list);
                }
            }

            for (const [targetYear, appIds] of appIdsByYear.entries()) {
                const lifecycle = deriveAcademicLifecycle(startMonth, startDay, targetYear);
                const newEligible = new Date(lifecycle.softBlock.getTime() + 24 * 60 * 60 * 1000);

                // Update in batches of 100
                for (let i = 0; i < appIds.length; i += 100) {
                    const batchIds = appIds.slice(i, i + 100);
                    await supabase
                        .from('applications')
                        .update({
                            eligible_approval: newEligible.toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .in('application_id', batchIds);
                }
            }
        }

        await invalidateStudentAssignmentCache('*');
    } catch (fallbackErr: any) {
        console.error('[deadline-config] TypeScript fallback recalculation failed:', fallbackErr);
    }
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
