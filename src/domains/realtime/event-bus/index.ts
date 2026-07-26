import type { RealtimeEvent } from '../contracts/events';

type EventHandler = (event: RealtimeEvent) => void;

const listeners = new Map<string, Set<EventHandler>>();

export class EventBus {
  emit(event: RealtimeEvent): void {
    const handlers = listeners.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(event); } catch (e) { console.warn('EventBus handler error:', e); }
    }
  }

  on(eventType: string, handler: EventHandler): () => void {
    if (!listeners.has(eventType)) listeners.set(eventType, new Set());
    listeners.get(eventType)!.add(handler);
    return () => listeners.get(eventType)?.delete(handler);
  }

  off(eventType: string, handler: EventHandler): void {
    listeners.get(eventType)?.delete(handler);
  }

  clear(): void {
    listeners.clear();
  }
}

export const eventBus = new EventBus();
