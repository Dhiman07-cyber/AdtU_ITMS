'use client';

import { WebSocketClient } from '@/domains/realtime/ws-client';
import { useCallback,useEffect,useState } from 'react';

let globalClient: WebSocketClient | null = null;
let globalRefCount = 0;

function getOrCreateClient(token: string, getNewToken?: () => Promise<string>): WebSocketClient {
  if (!globalClient) {
    const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001`;
    globalClient = new WebSocketClient({ url, token, getNewToken });
    globalClient.connect();
  }
  return globalClient;
}

export function useWebSocket(token: string | null, getNewToken?: () => Promise<string>) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;
    const client = getOrCreateClient(token, getNewToken);
    globalRefCount++;
    const unsub = client.onStatus((status) => {
      setConnected(status === 'connected');
    });
    if (client.isConnected()) setConnected(true);
    return () => {
      unsub();
      globalRefCount--;
      if (globalRefCount <= 0 && globalClient) {
        globalClient.disconnect();
        globalClient = null;
      }
    };
  }, [token]);

  const getClient = useCallback((): WebSocketClient | null => {
    return globalClient;
  }, []);

  return { connected, getClient };
}
