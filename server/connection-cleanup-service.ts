import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { subscriptionManager } from './subscription-manager';
import { clearQueue } from './offline-queue';

export class ConnectionCleanupService {
  cleanup(socketId: string): void {
    const session = sessionManager.get(socketId);
    if (session) {
      subscriptionManager.unsubscribeAll(socketId, session);
    }
    sessionManager.delete(socketId);
    connectionRegistry.unregister(socketId);
    // Immediately free offline queue memory — don't wait for 5-min TTL
    clearQueue(socketId);
  }

  cleanupAll(): void {
    for (const [socketId] of connectionRegistry.getAll()) {
      this.cleanup(socketId);
    }
  }
}

export const connectionCleanupService = new ConnectionCleanupService();
