import type { RealtimeTransport } from './contracts/transport';
import { WebSocketTransport } from './transport/websocket';

let activeTransport: RealtimeTransport = new WebSocketTransport();

export async function initializeTransport(): Promise<void> {
  if (activeTransport.name === 'websocket') {
    await (activeTransport as WebSocketTransport).connect();
  }
}

export function setActiveTransport(t: RealtimeTransport): void {
  activeTransport = t;
}

export function getActiveTransport(): RealtimeTransport {
  return activeTransport;
}

export async function broadcastViaManager(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
  await activeTransport.broadcast(channel, event, payload);
}
