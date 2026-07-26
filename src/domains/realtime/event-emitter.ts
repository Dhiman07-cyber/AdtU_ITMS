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
