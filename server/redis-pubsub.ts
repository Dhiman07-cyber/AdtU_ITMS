import type { PubSubAdapter } from '../src/domains/realtime/pubsub';
import { redisClient } from './redis-client';

export class RedisPubSub implements PubSubAdapter {
  async publish(channel: string, message: string): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.publish(channel, message);
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.subscribe(channel, handler);
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.unsubscribe(channel);
    }
  }
}

export const redisPubSub = new RedisPubSub();
