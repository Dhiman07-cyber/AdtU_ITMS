import { metricsService } from './metrics-service';

const MAX_QUEUE_SIZE = parseInt(process.env.OFFLINE_QUEUE_MAX || '500', 10);
const QUEUE_TTL = parseInt(process.env.OFFLINE_QUEUE_TTL_MS || '300000', 10);

interface QueuedMessage {
  channel: string;
  event: string;
  payload: Record<string, unknown>;
  queuedAt: number;
}

const queues = new Map<string, QueuedMessage[]>();
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [uid, messages] of queues) {
    if (messages.length > 0 && now - messages[0].queuedAt > QUEUE_TTL) {
      queues.delete(uid);
    }
  }
}, 60000);
if (cleanupTimer && typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

export function stopOfflineQueue(): void {
  clearInterval(cleanupTimer);
}

export function enqueueOffline(uid: string, channel: string, event: string, payload: Record<string, unknown>): void {
  if (!uid) return;
  if (!queues.has(uid)) queues.set(uid, []);
  const q = queues.get(uid)!;
  if (q.length >= MAX_QUEUE_SIZE) {
    q.shift();
    metricsService.inc('queueDropped');
  }
  q.push({ channel, event, payload, queuedAt: Date.now() });
}

export function drainQueue(uid: string, send: (channel: string, event: string, payload: Record<string, unknown>) => void): void {
  if (!uid) return;
  const q = queues.get(uid);
  if (!q) return;
  for (const msg of q) {
    send(msg.channel, msg.event, msg.payload);
  }
  queues.delete(uid);
}

export function clearQueue(uid: string): void {
  if (uid) queues.delete(uid);
}

export function getQueueSize(uid: string): number {
  return queues.get(uid)?.length || 0;
}
