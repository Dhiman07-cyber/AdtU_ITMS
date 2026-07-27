'use client';

import { WebSocketClient } from '@/domains/realtime/ws-client';
import { useEffect,useRef } from 'react';

type EventHandler = (payload: any) => void;

export function useWebSocketChannel(
  client: WebSocketClient | null,
  channel: string | null,
  handler: EventHandler | null,
) {
  const handlerRef = useRef<EventHandler | null>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client || !channel || !handlerRef.current) return;
    const unsub = client.subscribe(channel, (payload: any) => {
      handlerRef.current?.(payload);
    });
    return unsub;
  }, [client, channel]);
}
