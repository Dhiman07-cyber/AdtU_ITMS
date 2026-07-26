import { metricsService } from './metrics-service';

const MAX_QUEUE_SIZE = parseInt(process.env.OFFLINE_QUEUE_MAX || '500', 10);

interface QueuedMessage {
  channel: string;
  event: string;
  payload: Record<string, unknown>;
  queuedAt: number;
}

const queues = new Map<string, QueuedMessage[]>();

export function enqueueOffline(socketId: string, channel: string, event: string, payload: Record<string, unknown>): void {
  if (!queues.has(socketId)) queues.set(socketId, []);
  const q = queues.get(socketId)!;
  if (q.length >= MAX_QUEUE_SIZE) {
    q.shift();
    metricsService.inc('queueDropped');
  }
  q.push({ channel, event, payload, queuedAt: Date.now() });
}

export function drainQueue(socketId: string, send: (channel: string, event: string, payload: Record<string, unknown>) => void): void {
  const q = queues.get(socketId);
  if (!q) return;
  for (const msg of q) {
    send(msg.channel, msg.event, msg.payload);
  }
  queues.delete(socketId);
}

export function clearQueue(socketId: string): void {
  queues.delete(socketId);
}

export function getQueueSize(socketId: string): number {
  return queues.get(socketId)?.length || 0;
}
