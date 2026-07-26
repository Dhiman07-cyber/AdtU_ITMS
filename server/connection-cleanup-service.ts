import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { subscriptionManager } from './subscription-manager';
import type WebSocket from 'ws';

export class ConnectionCleanupService {
  cleanup(socketId: string): void {
    const session = sessionManager.get(socketId);
    if (session) {
      subscriptionManager.unsubscribeAll(socketId, session);
    }
    sessionManager.delete(socketId);
    connectionRegistry.unregister(socketId);
  }

  cleanupAll(): void {
    for (const [socketId] of connectionRegistry.getAll()) {
      this.cleanup(socketId);
    }
  }

  setupCloseHandler(ws: WebSocket, socketId: string): void {
    ws.on('close', () => this.cleanup(socketId));
    ws.on('error', () => this.cleanup(socketId));
  }
}

export const connectionCleanupService = new ConnectionCleanupService();
