import type { PubSubAdapter } from '../src/domains/realtime/pubsub';
import { redisClient } from './redis-client';
import { logger } from './structured-logger';

export class RedisPubSub implements PubSubAdapter {
  async publish(channel: string, message: string): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.publish(channel, message);
    } else {
      logger.debug('redis_pubsub_publish_fallback_local', { channel });
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.subscribe(channel, handler);
    } else {
      logger.debug('redis_pubsub_subscribe_fallback_local', { channel });
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    if (redisClient.isReady()) {
      await redisClient.unsubscribe(channel);
    } else {
      logger.debug('redis_pubsub_unsubscribe_fallback_local', { channel });
    }
  }
}

export const redisPubSub = new RedisPubSub();
