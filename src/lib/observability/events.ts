/**
 * Canonical Event Taxonomy Framework
 */

import { CanonicalEvent, EventActor, EventName, EventTarget } from './types';
import { generateUUID, getRequestContext } from './context';
import { observabilityConfig } from './config';

export function createCanonicalEvent<T extends Record<string, unknown>>(
  eventName: EventName,
  payload: T,
  options?: {
    actor?: EventActor;
    target?: EventTarget;
    origin?: string;
    version?: string;
    reliabilityExpectation?: CanonicalEvent['reliabilityExpectation'];
  }
): CanonicalEvent<T> {
  const ctx = getRequestContext();

  return {
    eventId: generateUUID(),
    eventName,
    version: options?.version || '1.0.0',
    timestamp: new Date().toISOString(),
    correlationId: ctx?.correlationId || generateUUID(),
    traceId: ctx?.traceContext?.traceId || generateUUID(),
    origin: options?.origin || ctx?.component || observabilityConfig.serviceName,
    actor: options?.actor || {
      id: ctx?.userId,
      role: ctx?.userRole,
    },
    target: options?.target,
    payload,
    reliabilityExpectation: options?.reliabilityExpectation || 'AT_LEAST_ONCE',
  };
}

export type EventHandler<T = Record<string, unknown>> = (event: CanonicalEvent<T>) => void | Promise<void>;

class EventBus {
  private handlers = new Map<EventName, Set<EventHandler<any>>>();

  subscribe<T = Record<string, unknown>>(eventName: EventName, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    const set = this.handlers.get(eventName)!;
    set.add(handler);

    return () => {
      set.delete(handler);
    };
  }

  async publish<T extends Record<string, unknown>>(event: CanonicalEvent<T>): Promise<void> {
    const set = this.handlers.get(event.eventName);
    if (!set || set.size === 0) return;

    const promises = Array.from(set).map(async (handler) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(`[EventBus] Error handling event ${event.eventName}:`, err);
      }
    });

    await Promise.all(promises);
  }
}

export const canonicalEventBus = new EventBus();
