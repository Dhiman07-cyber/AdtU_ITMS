import { WebSocketTransport } from './transport/websocket';

let activeTransport: WebSocketTransport = new WebSocketTransport();

export async function initializeTransport(): Promise<void> {
  await activeTransport.connect();
}

export function getActiveTransport(): WebSocketTransport {
  return activeTransport;
}


