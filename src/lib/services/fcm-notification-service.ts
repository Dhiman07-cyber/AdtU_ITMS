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
import { getValidTokensForBusAndShift, getValidTokensForRoute } from '@/lib/services/fcm-token-service';

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

    // 2. Check buses table for assigned driver
    const { data: busData } = await supabase
      .from('buses')
      .select('driver_id, driver_uid')
      .eq('id', busId)
      .maybeSingle();

    if (busData && (busData.driver_id === driverId || busData.driver_uid === driverId)) {
      return { authorized: true };
    }

    // 3. Check driver profile status (dynamic QR scan system support)
    const { data: driverProfile } = await supabase
      .from('driver_profiles')
      .select('id, user_id, status')
      .or(`id.eq.${driverId},user_id.eq.${driverId}`)
      .maybeSingle();

    if (driverProfile && driverProfile.status !== 'suspended' && driverProfile.status !== 'inactive') {
      return { authorized: true };
    }

    return { authorized: false, reason: 'No active trip or valid active driver found for this bus' };
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
  shift?: string;
  eventType?: TripEventType;
  skipIdempotencyCheck?: boolean;
}): Promise<NotifyRouteResult> {
  const { routeId, tripId, routeName, busId, shift, skipIdempotencyCheck } = params;
  const eventType: TripEventType = params.eventType || 'TRIP_STARTED';
  const logCtx = { routeId, tripId, busId, shift, eventType };

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

  // Dispatch strategy: Direct token multicast targets registered student tokens in fcm_tokens.
  // If direct tokens exist, we notify them directly to prevent duplicate sends.
  // If 0 direct tokens exist, we fall back to topic push (route/bus topics).
  let directTokensCount = 0;
  let topicResult: { success: boolean; messageId?: string; error?: string } = { success: false };

  if (messaging) {
    try {
      let tokensWithMeta = busId
        ? await getValidTokensForBusAndShift(busId, shift)
        : await getValidTokensForRoute(routeId);

      // Fallback: If busId lookup yielded 0 tokens, search by routeId
      if (tokensWithMeta.length === 0 && routeId && busId) {
        console.log(`[notifyRoute] 0 tokens found for bus ${busId}, falling back to route ${routeId} tokens`);
        tokensWithMeta = await getValidTokensForRoute(routeId);
      }

      if (tokensWithMeta.length > 0) {
        const tokens = Array.from(new Set(tokensWithMeta.map(t => t.token)));
        console.log(`[notifyRoute] Direct multicast: sending to ${tokens.length} token(s)`, logCtx);

        const displayRouteName = routeName || routeId;
        const isStart = eventType === 'TRIP_STARTED';
        const title = isStart ? 'Bus Journey Started!' : 'Trip Ended';
        const body = isStart
          ? `Your bus for ${displayRouteName} has started its journey. Track it live now!`
          : `Your bus trip for ${displayRouteName} has ended.`;
        const link = isStart ? '/student/track-bus' : '/student';

        let totalInvalid = 0;
        for (let i = 0; i < tokens.length; i += 500) {
          const batch = tokens.slice(i, i + 500);
          const batchResponse = await messaging.sendEachForMulticast({
            tokens: batch,
            notification: { title, body },
            data: { type: eventType, routeId, busId, tripId, timestamp: new Date().toISOString() },
            android: { priority: 'high', notification: { channelId: 'bus_alerts', sound: 'default' } },
            webpush: {
              headers: { Urgency: 'high' },
              notification: {
                title,
                body,
                icon: '/icons/icon-192x192.png',
                badge: '/icons/icon-72x72.png',
              },
              fcmOptions: { link },
            },
          });
          const batchInvalid = batchResponse.responses.filter(r => !r.success).length;
          totalInvalid += batchInvalid;
          console.log(`[notifyRoute] Batch ${Math.floor(i / 500) + 1}: ${batchResponse.successCount} sent, ${batchInvalid} failed`);
        }

        directTokensCount = tokens.length;
        console.log(`[notifyRoute] Direct multicast complete: ${tokens.length} tokens, ${totalInvalid} invalid`, logCtx);
      }
    } catch (directErr) {
      console.error('[notifyRoute] Direct token multicast threw an error:', directErr, logCtx);
    }
  }

  // Fallback to topic push ONLY if direct token multicast was not sent / yielded 0 tokens
  if (directTokensCount === 0) {
    console.log('[notifyRoute] 0 direct tokens notified — executing topic push fallback', logCtx);
    topicResult = await notifyRouteTopic({ routeId, tripId, routeName, busId, shift, eventType });
  }

  const totalSuccess = (topicResult.success ? 1 : 0) + directTokensCount;
  const batchCount = (topicResult.success ? 1 : 0) + (directTokensCount > 0 ? 1 : 0);

  console.log(`[notifyRoute] Dispatch complete for trip ${tripId} (${eventType}): topic=${topicResult.success}, directTokens=${directTokensCount}`, logCtx);

  return {
    success: totalSuccess > 0,
    successCount: totalSuccess,
    failureCount: topicResult.success || directTokensCount > 0 ? 0 : 1,
    totalTokens: directTokensCount,
    batchCount,
    invalidTokensRemoved: 0,
    error: topicResult.error,
  };
}

export async function notifyRouteTopic(params: {
  routeId: string;
  tripId?: string;
  routeName?: string;
  busId?: string;
  shift?: string;
  eventType?: RouteTopicEventType;
  title?: string;
  body?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  link?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!messaging) return { success: false, error: 'Firebase Admin Messaging not initialized' };

  const { routeId, tripId, routeName, busId, shift } = params;
  const eventType: RouteTopicEventType = params.eventType || 'TRIP_STARTED';
  const isStart = eventType === 'TRIP_STARTED';
  const displayRouteName = routeName || routeId;
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
        ? `Your bus for ${displayRouteName} has started its journey. Track it live now!`
        : `Your bus trip for ${displayRouteName} has ended.`;
  const link = params.link || (isStart ? '/student/track-bus' : '/student');

  const data: Record<string, string> = {
    type: eventType,
    routeId,
    timestamp: new Date().toISOString(),
  };

  if (tripId) data.tripId = tripId;
  if (busId) data.busId = busId;
  if (routeName) data.routeName = routeName;
  if (shift) data.shift = shift;

  for (const [key, value] of Object.entries(params.data || {})) {
    if (value !== undefined && value !== null) {
      data[key] = String(value);
    }
  }

  const targetTopic = (shift && shift.toLowerCase() !== 'both')
    ? `route_${routeId}_${shift.toLowerCase()}`
    : `route_${routeId}`;

  try {
    const messageId = await messaging.send({
      topic: targetTopic,
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
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
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
        notification: {
          title: params.title,
          body: params.body,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
        },
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
