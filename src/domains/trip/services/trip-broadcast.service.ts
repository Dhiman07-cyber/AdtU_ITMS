import { getActiveTransport, initializeTransport } from '@/domains/realtime/transport-manager';
import type { RealtimeTransport } from '@/domains/realtime/contracts/transport';

let transportOverride: RealtimeTransport | null = null;

export function setBroadcastTransport(t: RealtimeTransport) {
  transportOverride = t;
}

async function getTransport(): Promise<RealtimeTransport> {
  if (transportOverride) return transportOverride;
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
    `bus_${params.busId}_students`,
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

  for (const channelName of channels) {
    await transport.broadcast(channelName, params.event, payload);
  }
}
