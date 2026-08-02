import { sessionManager } from './session-manager';
import { connectionRegistry } from './connection-registry';
import { subscriptionManager } from './subscription-manager';
import { heartbeatService } from './heartbeat-service';

export class ConnectionCleanupService {
  cleanup(socketId: string): void {
    const session = sessionManager.get(socketId);
    if (session) {
      subscriptionManager.unsubscribeAll(socketId, session);
    }
    heartbeatService.cleanup(socketId);
    sessionManager.delete(socketId);
    connectionRegistry.unregister(socketId);
  }

  cleanupAll(): void {
    for (const [socketId] of connectionRegistry.getAll()) {
      this.cleanup(socketId);
    }
  }
}

export const connectionCleanupService = new ConnectionCleanupService();
