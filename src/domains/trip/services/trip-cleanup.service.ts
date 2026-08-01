import { clearHistory } from '@/domains/gps';
import { clearTripBreadcrumbCache } from '@/lib/services/location-write-throttle';
import { getSupabaseServer } from '@/lib/supabase-server';

export async function cleanupTrip(params: {
  driverId: string;
  busId: string;
  tripId: string;
}) {
  const supabase = getSupabaseServer();

  const cleanupPromises = [
    supabase.from('waiting_flags').delete().eq('bus_id', params.busId).eq('trip_id', params.tripId),
    supabase.from('device_sessions').delete().eq('user_id', params.driverId),
  ];

  const results = await Promise.allSettled(cleanupPromises);
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      console.warn(`Cleanup task ${i} failed:`, (results[i] as PromiseRejectedResult).reason);
    }
  }

  clearHistory(params.driverId);
  clearTripBreadcrumbCache(params.tripId);
}

