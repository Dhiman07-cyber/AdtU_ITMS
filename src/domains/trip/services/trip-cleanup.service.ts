import { clearHistory } from '@/domains/gps';
import { getSupabaseServer } from '@/lib/supabase-server';

export async function cleanupTrip(params: {
  driverId: string;
  busId: string;
  tripId: string;
}) {
  const supabase = getSupabaseServer();

  const cleanupPromises = [
    supabase.from('driver_status').delete().eq('driver_uid', params.driverId).eq('bus_id', params.busId),
    supabase.from('bus_locations').delete().eq('bus_id', params.busId).eq('trip_id', params.tripId),
    supabase.from('waiting_flags').delete().eq('bus_id', params.busId).eq('trip_id', params.tripId),
    supabase.from('driver_location_updates').delete().eq('driver_uid', params.driverId).eq('bus_id', params.busId),
    supabase.from('device_sessions').delete().eq('user_id', params.driverId),
    supabase.from('driver_status').update({ status: 'idle', trip_id: null }).eq('driver_uid', params.driverId),
  ];

  const results = await Promise.allSettled(cleanupPromises);
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      console.warn(`Cleanup task ${i} failed:`, (results[i] as PromiseRejectedResult).reason);
    }
  }

  clearHistory(params.driverId);
}
