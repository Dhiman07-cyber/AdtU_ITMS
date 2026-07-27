/**
 * Production push notifications for trip events.
 *
 * Route trip notifications use FCM topics so starting/ending a bus journey does
 * not require fetching and batching every student token during the trip request.
 *
 * D9: FCM notification lock moved from Firestore buses.activeTripLock to
 * PostgreSQL active_trips via acquire_fcm_lock RPC. Driver/bus verification
 * moved to Supabase. Student queries moved to Supabase.
 */

import { messaging } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { getDriverUidByBusId } from '@/domains/fleet/repositories/driver-assignment.repository';

export type TripEventType = 'TRIP_STARTED' | 'TRIP_ENDED';
export type RouteTopicEventType = TripEventType | 'BUS_CHANGED';

export interface NotifyRouteResult {
  success: boolean;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  batchCount: number;
  invalidTokensRemoved: number;
  error?: string;
}

async function acquireNotificationLock(busId: string, tripId: string, eventType: TripEventType): Promise<void> {
  // D9: Use PostgreSQL RPC instead of Firestore transaction
  const supabase = getSupabaseServer();
  const lockType = eventType === 'TRIP_ENDED' ? 'end' : 'start';

  const { data: result, error } = await supabase
    .rpc('acquire_fcm_lock', {
      p_trip_id: tripId,
      p_bus_id: busId,
      p_lock_type: lockType,
    });

  if (error) {
    console.error('FCM lock RPC error:', error);
    throw new Error('FCM_LOCK_ERROR');
  }

  // acquired=false means already sent (idempotent)
  if (result && !result.acquired) {
    throw new Error('NOTIFICATION_ALREADY_SENT');
  }
}

export async function verifyDriverRouteBinding(
  driverId: string,
  _routeId: string,
  busId: string
): Promise<{ authorized: boolean; reason?: string }> {
  try {
    const supabase = getSupabaseServer();

    // 1. Check active_trips for active assignment
    const { data: activeTrip } = await supabase
      .from('active_trips')
      .select('bus_id, driver_id')
      .eq('driver_id', driverId)
      .eq('status', 'active')
      .maybeSingle();

    if (activeTrip?.bus_id === busId) return { authorized: true };

    // 2. Check canonical driver_assignments table
    const assignedDriverUid = await getDriverUidByBusId(busId);
    if (assignedDriverUid === driverId) return { authorized: true };

    // 3. Check buses table (driver_uid)
    const { data: bus } = await supabase
      .from('buses')
      .select('driver_uid')
      .eq('id', busId)
      .maybeSingle();

    if (bus?.driver_uid === driverId) return { authorized: true };

    // 4. Check driver_profiles table (bus_id)
    const { data: driverProfile } = await supabase
      .from('driver_profiles')
      .select('bus_id')
      .eq('uid', driverId)
      .maybeSingle();

    if (driverProfile?.bus_id === busId) return { authorized: true };

    return { authorized: false, reason: 'Driver is not assigned to this bus' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Driver authorization failed';
    console.error('Error verifying driver-route binding:', message);
    return { authorized: false, reason: message };
  }
}

export async function notifyRoute(params: {
  routeId: string;
  tripId: string;
  routeName: string;
  busId: string;
  eventType?: TripEventType;
  skipIdempotencyCheck?: boolean;
}): Promise<NotifyRouteResult> {
  const { routeId, tripId, routeName, busId, skipIdempotencyCheck } = params;
  const eventType: TripEventType = params.eventType || 'TRIP_STARTED';

  if (!skipIdempotencyCheck) {
    try {
      await acquireNotificationLock(busId, tripId, eventType);
    } catch (error) {
      console.warn(`[notifyRoute] Skipping push notification for trip ${tripId} (${eventType}):`, error instanceof Error ? error.message : error);
      return {
        success: true,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        batchCount: 0,
        invalidTokensRemoved: 0,
        error: error instanceof Error ? error.message : 'already_sent',
      };
    }
  }

  const topicResult = await notifyRouteTopic({ routeId, tripId, routeName, busId, eventType });



  return {
    success: topicResult.success,
    successCount: topicResult.success ? 1 : 0,
    failureCount: topicResult.success ? 0 : 1,
    totalTokens: 0,
    batchCount: 1,
    invalidTokensRemoved: 0,
    error: topicResult.error,
  };
}

export async function notifyRouteTopic(params: {
  routeId: string;
  tripId?: string;
  routeName?: string;
  busId?: string;
  eventType?: RouteTopicEventType;
  title?: string;
  body?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  link?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!messaging) return { success: false, error: 'Firebase Admin Messaging not initialized' };

  const { routeId, tripId, routeName, busId } = params;
  const eventType: RouteTopicEventType = params.eventType || 'TRIP_STARTED';
  const isStart = eventType === 'TRIP_STARTED';
  const defaultTitle =
    eventType === 'BUS_CHANGED'
      ? 'Bus Changed'
      : isStart
        ? 'Bus Journey Started!'
        : 'Trip Ended';
  const defaultBody =
    eventType === 'BUS_CHANGED'
      ? 'Your route bus assignment has changed.'
      : isStart
        ? `Your bus for ${routeName || 'your route'} has started its journey. Track it live now!`
        : `Your bus trip for ${routeName || 'your route'} has ended.`;
  const link = params.link || (isStart ? '/student/track-bus' : '/student');

  const data: Record<string, string> = {
    type: eventType,
    routeId,
    timestamp: new Date().toISOString(),
  };

  if (tripId) data.tripId = tripId;
  if (busId) data.busId = busId;
  if (routeName) data.routeName = routeName;

  for (const [key, value] of Object.entries(params.data || {})) {
    if (value !== undefined && value !== null) {
      data[key] = String(value);
    }
  }

  try {
    const messageId = await messaging.send({
      topic: `route_${routeId}`,
      notification: {
        title: params.title || defaultTitle,
        body: params.body || defaultBody,
      },
      data,
      android: {
        priority: 'high',
        notification: { channelId: 'bus_alerts', sound: 'default' },
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title: params.title || defaultTitle,
          body: params.body || defaultBody,
        },
        fcmOptions: { link },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            alert: { title: params.title || defaultTitle, body: params.body || defaultBody },
            sound: 'default',
          },
        },
      },
    });

    return { success: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Topic notification failed';
    console.error(`Topic notification failed for route_${routeId}:`, message);
    return { success: false, error: message };
  }
}

export async function notifyAllUsers(params: {
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!messaging) return { success: false, error: 'Firebase Admin Messaging not initialized' };

  try {
    const messageId = await messaging.send({
      topic: 'all_users',
      notification: { title: params.title, body: params.body },
      data: params.data || {},
      android: { priority: 'high', notification: { channelId: 'announcements', sound: 'default' } },
      webpush: {
        headers: { Urgency: 'high' },
        notification: { title: params.title, body: params.body },
        fcmOptions: { link: '/dashboard' },
      },
    });

    return { success: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Global notification failed';
    console.error('Global notification failed:', message);
    return { success: false, error: message };
  }
}
