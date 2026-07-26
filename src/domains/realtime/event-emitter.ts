import { getActiveTransport, initializeTransport } from './transport-manager';

let initialized = false;

export async function ensureTransport(): Promise<void> {
  if (!initialized) {
    await initializeTransport();
    initialized = true;
  }
}

export async function emitEvent(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
  await ensureTransport();
  const transport = getActiveTransport();
  await transport.broadcast(channel, event, payload);
}

export async function emitTripEvent(
  busId: string,
  tripId: string,
  event: 'trip_started' | 'trip_ended',
  extra?: Record<string, string | undefined>,
): Promise<void> {
  const channels = [
    `trip-status-${busId}`,
    `bus_${busId}_students`,
    `bus_location_${busId}`,
  ];
  const payload: Record<string, string> = {
    busId,
    tripId,
    event,
    timestamp: new Date().toISOString(),
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) payload[k] = v;
    }
  }
  for (const channel of channels) {
    await emitEvent(channel, event, payload);
  }
}

export async function emitWaitingFlagEvent(
  channel: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await emitEvent(channel, event, payload);
}
