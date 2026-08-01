import { getActiveTransport,initializeTransport } from '@/domains/realtime/transport-manager';

async function getTransport() {
  await initializeTransport();
  return getActiveTransport();
}

export async function broadcastTripEvent(params: {
  busId: string;
  tripId: string;
  event: 'trip_started' | 'trip_ended';
  driverId?: string;
  routeId?: string;
  shift?: string;
  routeName?: string;
  busNumber?: string;
}) {
  const transport = await getTransport();
  const channels = [
    `trip-status-${params.busId}`,
    `bus_location_${params.busId}`,
  ];

  const payload: Record<string, string> = {
    busId: params.busId,
    tripId: params.tripId,
    event: params.event,
    timestamp: new Date().toISOString(),
  };

  if (params.driverId) payload.driverUid = params.driverId;
  if (params.routeId) payload.routeId = params.routeId;
  if (params.shift) payload.shift = params.shift;
  if (params.routeName) payload.routeName = params.routeName;
  if (params.busNumber) payload.busNumber = params.busNumber;

  // Broadcast to both channels concurrently — they are independent SSE streams
  await Promise.all(
    channels.map(channelName => transport.broadcast(channelName, params.event, payload))
  );
}
