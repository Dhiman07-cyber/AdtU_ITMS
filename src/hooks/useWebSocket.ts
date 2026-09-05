'use client';

import { WebSocketClient } from '@/domains/realtime/ws-client';
import { getClientWsUrl } from '@/domains/realtime';
import { auth } from '@/lib/firebase';
import { useEffect,useState } from 'react';

let globalClient: WebSocketClient | null = null;
let globalRefCount = 0;

const defaultGetNewToken = async (): Promise<string> => {
  const user = auth.currentUser;
  if (user) {
    return await user.getIdToken(true);
  }
  throw new Error('No user signed in');
};

function getOrCreateClient(token: string, getNewToken?: () => Promise<string>): WebSocketClient {
  if (!globalClient) {
    const url = getClientWsUrl();
    globalClient = new WebSocketClient({ url, token, getNewToken: getNewToken || defaultGetNewToken });
    globalClient.connect();
  }
  return globalClient;
}

export function useWebSocket(token: string | null, getNewToken?: () => Promise<string>) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token) return;
    const client = getOrCreateClient(token, getNewToken || defaultGetNewToken);
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

  const getClient = (): WebSocketClient | null => {
    return globalClient;
  };

  return { connected, getClient };
}
