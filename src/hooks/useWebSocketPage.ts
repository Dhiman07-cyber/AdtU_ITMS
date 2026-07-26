'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { WebSocketClient } from '@/domains/realtime/ws-client';

type EventHandler = (payload: any) => void;

export function useWebSocketPage(
  channelSubscriptions: Record<string, EventHandler>,
  deps: any[] = [],
) {
  const { currentUser } = useAuth();
  const clientRef = useRef<WebSocketClient | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  const getNewToken = useCallback(async (): Promise<string> => {
    if (!currentUser) throw new Error('No user');
    return currentUser.getIdToken();
  }, [currentUser]);

  const subscribe = useCallback((channels: Record<string, EventHandler>, client: WebSocketClient) => {
    unsubsRef.current.forEach(fn => fn());
    unsubsRef.current = [];
    for (const [channel, handler] of Object.entries(channels)) {
      const unsub = client.subscribe(channel, handler);
      unsubsRef.current.push(unsub);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let client = clientRef.current;

    const init = async () => {
      const token = await currentUser.getIdToken();
      const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001`;
      if (!client) {
        client = new WebSocketClient({ url, token, getNewToken });
        clientRef.current = client;
        client.connect();
      } else {
        client.setToken(token);
      }
      subscribe(channelSubscriptions, client);
    };

    init();

    return () => {
      unsubsRef.current.forEach(fn => fn());
      unsubsRef.current = [];
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [currentUser, ...deps]);

  return { client: clientRef.current };
}
