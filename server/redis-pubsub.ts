import type { PubSubAdapter } from '@/domains/realtime/pubsub';

// ponytail: Redis not yet provisioned; MemoryPubSub is used in dev
export class RedisPubSub implements PubSubAdapter {
  async publish(_channel: string, _message: string): Promise<void> {
    console.log('[RedisPubSub] publish skipped — no Redis connection');
  }

  async subscribe(_channel: string, _handler: (message: string) => void): Promise<void> {
    console.log('[RedisPubSub] subscribe skipped — no Redis connection');
  }

  async unsubscribe(_channel: string): Promise<void> {
    console.log('[RedisPubSub] unsubscribe skipped — no Redis connection');
  }
}

export const redisPubSub = new RedisPubSub();
