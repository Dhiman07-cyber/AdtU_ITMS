import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase-client';
import { WebSocketClient } from '@/domains/realtime/ws-client';

interface WaitingFlag {
  id: string;
  studentUid: string;
  studentName: string;
  busId: string;
  routeId: string;
  stop_name: string;
  stopLat: number;
  stopLng: number;
  status: 'raised' | 'acknowledged' | 'boarded' | 'expired';
  createdAt: string;
  expiresAt: string;
  ackByDriverUid?: string;
}

export const useWaitingFlags = (busId: string, getToken: () => Promise<string | null>) => {
  const [flags, setFlags] = useState<WaitingFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // Subscribe to waiting flag events via WebSocket
  useEffect(() => {
    if (!busId) {
      setLoading(false);
      return;
    }

    console.log(`[useWaitingFlags] Subscribing to waiting_flags_${busId} via WS`);

    // Fetch initial flags via supabase (ponytail: one-time query, add dedicated API endpoint if needed)
    const fetchInitial = async () => {
      try {
        const { data, error } = await supabase
          .from('waiting_flags')
          .select('*')
          .eq('bus_id', busId)
          .in('status', ['raised', 'waiting', 'acknowledged'])
          .order('created_at', { ascending: false });

        if (!isMountedRef.current) return;

        if (error) throw new Error(error.message);

        const formatted: WaitingFlag[] = (data || []).map((f: any) => ({
          id: f.id,
          studentUid: f.student_uid,
          studentName: f.student_name || 'Unknown Student',
          busId: f.bus_id,
          routeId: f.route_id,
          stop_name: f.stop_name,
          stopLat: f.stop_lat,
          stopLng: f.stop_lng,
          status: f.status,
          createdAt: f.created_at,
          expiresAt: f.expires_at || new Date(new Date(f.created_at).getTime() + 20 * 60 * 1000).toISOString(),
        }));

        setFlags(formatted);
      } catch (err: any) {
        console.error('[useWaitingFlags] Error fetching initial flags:', err);
        if (isMountedRef.current) setError(err.message || 'Failed to fetch waiting flags');
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };

    fetchInitial();

    let wsClient: WebSocketClient | null = null;
    const initWs = async () => {
      const token = await getToken();
      if (!token) return;
      const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001`;
      wsClient = new WebSocketClient({ url, token });
      wsClient.connect();
      wsClient.subscribe(`waiting_flags_${busId}`, (payload: any) => {
        if (!isMountedRef.current) return;
        if (payload.event === 'waiting_flag_created') {
          setFlags(prev => {
            if (prev.some(f => f.id === payload.id)) return prev;
            return [{
              id: payload.id,
              studentUid: payload.student_uid || payload.studentUid,
              studentName: payload.student_name || payload.studentName || 'Unknown Student',
              busId: payload.bus_id || payload.busId,
              routeId: payload.route_id || payload.routeId,
              stop_name: payload.stop_name,
              stopLat: payload.stop_lat || payload.stopLat,
              stopLng: payload.stop_lng || payload.stopLng,
              status: 'raised',
              createdAt: payload.created_at || payload.createdAt || new Date().toISOString(),
              expiresAt: payload.expires_at || payload.expiresAt || new Date(Date.now() + 20 * 60 * 1000).toISOString(),
            }, ...prev];
          });
          setLoading(false);
        } else if (payload.event === 'waiting_flag_removed' || payload.event === 'waiting_flag_boarded' || payload.event === 'waiting_flag_cancelled') {
          setFlags(prev => prev.filter(f => f.id !== (payload.flagId || payload.id)));
        } else if (payload.event === 'waiting_flag_acknowledged') {
          setFlags(prev => prev.map(f =>
            f.id === payload.flagId ? { ...f, status: 'acknowledged', ackByDriverUid: payload.driverUid } : f
          ));
        }
      });
    };
    initWs();

    return () => {
      isMountedRef.current = false;
      if (wsClient) wsClient.disconnect();
    };
  }, [busId, getToken]);

  // Acknowledge a waiting flag
  const acknowledgeFlag = useCallback(async (flagId: string, driverUid: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = await getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/driver/ack-flag', {
        method: 'POST',
        headers,
        body: JSON.stringify({ flagId }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to acknowledge flag');

      setFlags(prev => prev.map(flag =>
        flag.id === flagId ? { ...flag, status: 'acknowledged', ackByDriverUid: driverUid } : flag
      ));

      return { success: true };
    } catch (err: any) {
      console.error('Error acknowledging flag:', err);
      return { success: false, error: err.message || 'Unknown error' };
    }
  }, [getToken]);

  // Mark a student as boarded
  const markAsBoarded = useCallback(async (flagId: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = await getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/driver/mark-boarded', {
        method: 'POST',
        headers,
        body: JSON.stringify({ flagId }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to mark student as boarded');

      setFlags(prev => prev.filter(f => f.id !== flagId));
      return { success: true };
    } catch (err: any) {
      console.error('Error marking as boarded:', err);
      return { success: false, error: err.message || 'Unknown error' };
    }
  }, [getToken]);

  return {
    flags,
    loading,
    error,
    acknowledgeFlag,
    markAsBoarded
  };
};
