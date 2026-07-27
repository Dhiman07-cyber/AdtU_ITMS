import { adminAuth } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * Health Check API — Phase 05
 *
 * GET /api/health
 *
 * Returns: { status, version, commit, uptime, timestamp, latency_ms, checks }
 *
 * Checks:
 *   - app: always ok (process alive)
 *   - supabase: live DB round-trip with latency
 *   - firebase: admin SDK initialized check
 *   - environment: required env vars present
 *   - memory: heap usage in MB
 *
 * HTTP Status:
 *   200 — healthy or degraded (check individual statuses)
 *   503 — at least one check is 'error'
 */

const startTime = Date.now();

export async function GET() {
    const requestStart = Date.now();

    const checks: Record<string, { status: 'ok' | 'degraded' | 'error'; latency_ms?: number; message?: string; detail?: unknown }> = {};

    // ── app: process liveness ──────────────────────────────────────────────────
    checks['app'] = { status: 'ok' };

    // ── supabase: live round-trip ──────────────────────────────────────────────
    try {
        const supabase = getSupabaseServer();
        if (!supabase) {
            checks['supabase'] = { status: 'error', message: 'Client not initialized' };
        } else {
            const t0 = Date.now();
            const { error } = await supabase.from('realtime_driver_locations').select('id').limit(1);
            const latency_ms = Date.now() - t0;
            if (error && !error.message.includes('Results contain 0 rows')) {
                checks['supabase'] = { status: 'error', latency_ms, message: 'Database connectivity error' };
            } else {
                checks['supabase'] = { status: latency_ms > 3000 ? 'degraded' : 'ok', latency_ms };
            }
        }
    } catch {
        checks['supabase'] = { status: 'error', message: 'Database connection failed' };
    }

    // ── firebase: admin SDK initialization ────────────────────────────────────
    checks['firebase'] = adminAuth
        ? { status: 'ok' }
        : { status: 'degraded', message: 'Firebase Admin SDK not initialized (missing credentials)' };

    // ── environment: required public env vars ─────────────────────────────────
    const requiredEnvVars = [
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ];
    const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
    checks['environment'] = missingEnvVars.length > 0
        ? { status: 'degraded', message: `Missing: ${missingEnvVars.join(', ')}` }
        : { status: 'ok' };

    // ── memory: heap usage ─────────────────────────────────────────────────────
    try {
        const mem = process.memoryUsage();
        const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
        const rssMB = Math.round(mem.rss / 1024 / 1024);
        const heapStatus: 'ok' | 'degraded' | 'error' =
            heapUsedMB > 1024 ? 'error' :
            heapUsedMB > 512  ? 'degraded' : 'ok';
        checks['memory'] = {
            status: heapStatus,
            detail: { heapUsedMB, rssMB, heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024) },
        };
    } catch {
        checks['memory'] = { status: 'degraded', message: 'Unable to read memory' };
    }

    // ── overall status ─────────────────────────────────────────────────────────
    const hasError = Object.values(checks).some(c => c.status === 'error');
    const hasDegraded = Object.values(checks).some(c => c.status === 'degraded');
    const overallStatus = hasError ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy';

    return NextResponse.json(
        {
            status: overallStatus,
            version: process.env.npm_package_version || '1.0.0',
            commit: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'unknown',
            uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
            timestamp: new Date().toISOString(),
            latency_ms: Date.now() - requestStart,
            checks,
        },
        { status: hasError ? 503 : 200 }
    );
}
