import type WebSocket from 'ws';
import type { Session } from './session-manager';

const connections = new Map<string, { ws: WebSocket; session: Session }>();

export class ConnectionRegistry {
  register(socketId: string, ws: WebSocket, session: Session): void {
    connections.set(socketId, { ws, session });
  }

  get(socketId: string): { ws: WebSocket; session: Session } | undefined {
    return connections.get(socketId);
  }

  unregister(socketId: string): void {
    connections.delete(socketId);
  }

  get size(): number {
    return connections.size;
  }

  getAll(): Map<string, { ws: WebSocket; session: Session }> {
    return new Map(connections);
  }
}

export const connectionRegistry = new ConnectionRegistry();
