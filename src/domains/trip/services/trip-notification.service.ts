import { notifyRoute } from '@/lib/services/fcm-notification-service';

export async function dispatchTripNotification(params: {
  routeId: string;
  tripId: string;
  routeName: string;
  busId: string;
  shift?: string;
  eventType: 'TRIP_STARTED' | 'TRIP_ENDED';
}) {
  try {
    await notifyRoute(params);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('FCM notification error:', msg);
  }
}
