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
  // Trip lifecycle events belong on trip-status only.
  // bus_location_ is location-data-only; mixing events there breaks its contract
  // and would send trip_started/trip_ended noise to any location consumer.
  const channel = `trip-status-${params.busId}`;

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

  await transport.broadcast(channel, params.event, payload);
}
