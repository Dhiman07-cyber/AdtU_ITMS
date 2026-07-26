import type { PubSubAdapter } from './index';

const subscriptions = new Map<string, Set<(msg: string) => void>>();

export class MemoryPubSub implements PubSubAdapter {
  async publish(channel: string, message: string): Promise<void> {
    const handlers = subscriptions.get(channel);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(message); } catch (e) { console.warn('MemoryPubSub handler error:', e); }
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (!subscriptions.has(channel)) subscriptions.set(channel, new Set());
    subscriptions.get(channel)!.add(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    subscriptions.delete(channel);
  }
}

export const memoryPubSub = new MemoryPubSub();
