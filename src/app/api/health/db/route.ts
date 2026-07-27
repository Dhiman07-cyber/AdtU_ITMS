import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

/**
 * Database Health Check API Endpoint
 * Detailed database connectivity and latency check
 * 
 * GET /api/health/db
 * Returns: { status, supabase, firebase }
 */
export async function GET() {
    const startTime = Date.now();

    const results: Record<string, {
        status: 'ok' | 'error';
        latency_ms: number;
        message?: string;
    }> = {};

    // Check Supabase
    try {
        const supabase = getSupabaseServer();
        if (!supabase) {
            results['supabase'] = {
                status: 'error',
                latency_ms: 0,
                message: 'Server configuration error'
            };
        } else {
            const supabaseStart = Date.now();

            // Test read operation
            const { error: readError } = await supabase
                .from('realtime_driver_locations')
                .select('id')
                .limit(1);

            const supabaseLatency = Date.now() - supabaseStart;

            if (readError && !readError.message.includes('Results contain 0 rows')) {
                results['supabase'] = {
                    status: 'error',
                    latency_ms: supabaseLatency,
                    message: 'Database read error'
                };
            } else {
                results['supabase'] = {
                    status: 'ok',
                    latency_ms: supabaseLatency
                };
            }
        }
    } catch (e) {
        results['supabase'] = {
            status: 'error',
            latency_ms: Date.now() - startTime,
            message: 'Database connection error'
        };
    }

    // Note: Firebase Admin SDK check would go here if initialized server-side
    // For now, we just verify the configuration exists
    const hasFirebaseConfig = !!(
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
        process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    );

    results['firebase_config'] = {
        status: hasFirebaseConfig ? 'ok' : 'error',
        latency_ms: 0,
        message: hasFirebaseConfig ? undefined : 'Firebase configuration missing'
    };

    const hasError = Object.values(results).some(r => r.status === 'error');
    const totalLatency = Date.now() - startTime;

    return NextResponse.json({
        status: hasError ? 'unhealthy' : 'healthy',
        timestamp: new Date().toISOString(),
        total_latency_ms: totalLatency,
        checks: results
    }, {
        status: hasError ? 503 : 200
    });
}
