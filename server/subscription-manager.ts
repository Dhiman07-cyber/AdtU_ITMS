import { connectionRegistry } from './connection-registry';
import { sendToSocket } from './socket-router';
import type WebSocket from 'ws';
import type { Session } from './session-manager';

const channelSubscriptions = new Map<string, Set<string>>();

export class SubscriptionManager {
  subscribe(socketId: string, channel: string, ws: WebSocket, session: Session): void {
    session.subscriptions.add(channel);
    if (!channelSubscriptions.has(channel)) {
      channelSubscriptions.set(channel, new Set());
    }
    channelSubscriptions.get(channel)!.add(socketId);
  }

  unsubscribe(socketId: string, channel: string, session: Session): void {
    session.subscriptions.delete(channel);
    channelSubscriptions.get(channel)?.delete(socketId);
    if (channelSubscriptions.get(channel)?.size === 0) {
      channelSubscriptions.delete(channel);
    }
  }

  unsubscribeAll(socketId: string, session: Session): void {
    for (const channel of session.subscriptions) {
      channelSubscriptions.get(channel)?.delete(socketId);
    }
    session.subscriptions.clear();
  }

  getSubscribers(channel: string): string[] {
    return Array.from(channelSubscriptions.get(channel) || []);
  }

  getChannelCount(): number {
    return channelSubscriptions.size;
  }
}

export const subscriptionManager = new SubscriptionManager();
