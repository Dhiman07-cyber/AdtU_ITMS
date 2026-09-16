/**
 * Monthly Driver Trip History Retention Worker
 *
 * Cron job endpoint that purges completed driver trip history records older than 12 months.
 * Should be scheduled to run monthly (e.g. 0 0 1 * *) via Vercel Cron or external scheduler.
 *
 * Retention rule:
 * Permanently deletes records in public.driver_trip_history where end_time < NOW() - INTERVAL '1 year'.
 */

import { verifyCronAuth } from '@/lib/security/cron-auth';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabase = getSupabaseServer();

    // Call database RPC cleanup function (uses native SQL end_time < NOW() - INTERVAL '1 year')
    const { data: deletedCount, error } = await supabase.rpc('cleanup_old_trip_history');

    if (error) {
      console.error('Error in monthly driver_trip_history cleanup:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ Monthly driver_trip_history cleanup complete: ${deletedCount || 0} records purged`);

    return NextResponse.json({
      success: true,
      message: 'Monthly 12-month driver trip history cleanup completed successfully',
      deletedCount: deletedCount || 0,
      processingTimeMs: Date.now() - startTime,
    });
  } catch (err: any) {
    console.error('Fatal error in cleanup-trip-history worker:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
