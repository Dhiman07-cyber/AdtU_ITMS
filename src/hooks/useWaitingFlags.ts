import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase-client';

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

export const useWaitingFlags = (routeId: string, getIdToken?: () => Promise<string | null>) => {
  const [flags, setFlags] = useState<WaitingFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  // Handle waiting flag raised event (optimized)
  const handleWaitingFlagRaised = useCallback((payload: any) => {
    const flagData = payload.payload;
    
    // Use requestAnimationFrame to avoid blocking the main thread
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!isMountedRef.current) return;
      console.log('Received waiting flag raised event:', flagData);
      
      setFlags(prev => {
      // Check if flag already exists
      const existingIndex = prev.findIndex(f => f.id === flagData.id);
      if (existingIndex >= 0) {
        // Update existing flag
        const updated = [...prev];
        updated[existingIndex] = {
          id: flagData.id,
          studentUid: flagData.studentUid,
          studentName: flagData.studentName || 'Unknown Student',
          busId: flagData.busId,
          routeId: flagData.routeId,
          stop_name: flagData.stop_name,
          stopLat: flagData.stopLat,
          stopLng: flagData.stopLng,
          status: 'raised',
          createdAt: flagData.createdAt || new Date().toISOString(),
          expiresAt: flagData.expiresAt || new Date(Date.now() + 20 * 60 * 1000).toISOString()
        };
        return updated;
      } else {
        // Add new flag
        return [...prev, {
          id: flagData.id,
          studentUid: flagData.studentUid,
          studentName: flagData.studentName || 'Unknown Student',
          busId: flagData.busId,
          routeId: flagData.routeId,
          stop_name: flagData.stop_name,
          stopLat: flagData.stopLat,
          stopLng: flagData.stopLng,
          status: 'raised',
          createdAt: flagData.createdAt || new Date().toISOString(),
          expiresAt: flagData.expiresAt || new Date(Date.now() + 20 * 60 * 1000).toISOString()
        }];
      }
      });
      
      setLoading(false);
    });
  }, []);

  // Handle waiting flag acknowledged event
  const handleWaitingFlagAcknowledged = useCallback((payload: any) => {
    const ackData = payload.payload;
    
    console.log('Received waiting flag acknowledged event:', ackData);
    
    setFlags(prev => 
      prev.map(flag => 
        flag.id === ackData.id 
          ? { 
              ...flag, 
              status: 'acknowledged',
              ackByDriverUid: ackData.driverUid
            } 
          : flag
      )
    );
  }, []);

  // Handle waiting flag removed event
  const handleWaitingFlagRemoved = useCallback((payload: any) => {
    const removeData = payload.payload;
    
    console.log('Received waiting flag removed event:', removeData);
    
    setFlags(prev => {
      if (removeData.status === 'boarded' || removeData.status === 'cancelled') {
        // Remove flag from list
        return prev.filter(f => f.id !== removeData.id);
      } else {
        // Update flag status
        return prev.map(f => 
          f.id === removeData.id
            ? { ...f, status: removeData.status }
            : f
        );
      }
    });
  }, []);

  // Subscribe to realtime channel - use postgres_changes for reliable updates
  useEffect(() => {
    if (!supabase || !routeId) {
      console.log('[useWaitingFlags] Supabase client or routeId not available');
      setLoading(false);
      return;
    }

    // Create channel - listen to postgres changes on waiting_flags table
    const channelName = `waiting_flags_${routeId}_${Date.now()}`;
    console.log(`Creating Supabase channel: ${channelName} for route: ${routeId}`);
    
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: {
          self: false
        },
        presence: {
          key: ''
        }
      }
    });
    
    // Subscribe to INSERT events on waiting_flags table filtered by route_id
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'waiting_flags',
        filter: `route_id=eq.${routeId}`
      },
      (payload: any) => {
        console.log('🚩 Received waiting flag INSERT event:', payload);
        
        const flagData = payload.new;
        const formattedPayload = {
          payload: {
            id: flagData.id,
            studentUid: flagData.student_uid,
            studentName: flagData.student_name,
            busId: flagData.bus_id,
            routeId: flagData.route_id,
            stop_name: flagData.stop_name,
            stopLat: flagData.stop_lat,
            stopLng: flagData.stop_lng,
            createdAt: flagData.created_at,
            expiresAt: flagData.expires_at
          }
        };
        
        handleWaitingFlagRaised(formattedPayload);
      }
    );
    
    // Subscribe to UPDATE events on waiting_flags table
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'waiting_flags',
        filter: `route_id=eq.${routeId}`
      },
      (payload: any) => {
        console.log('🔄 Received waiting flag UPDATE event:', payload);
        
        const flagData = payload.new;
        
        if (flagData.status === 'acknowledged') {
          handleWaitingFlagAcknowledged({
            payload: {
              id: flagData.id,
              driverUid: flagData.ack_by_driver_uid
            }
          });
        } else if (flagData.status === 'boarded' || flagData.status === 'cancelled' || flagData.status === 'expired') {
          handleWaitingFlagRemoved({
            payload: {
              id: flagData.id,
              status: flagData.status
            }
          });
        }
      }
    );

    // Subscribe to the channel
    channel.subscribe((status: string, error: any) => {
      if (status === 'SUBSCRIBED') {
        console.log(`✅ Successfully subscribed to postgres changes for waiting flags on route ${routeId}`);
        setLoading(false);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`❌ Error subscribing to channel:`, error);
        setError(`Error subscribing to channel: ${error?.message || 'Unknown error'}`);
        setLoading(false);
      } else if (status === 'TIMED_OUT') {
        console.error(`⏱️ Timeout subscribing to channel`);
        setError('Timeout subscribing to channel');
        setLoading(false);
      } else {
        console.log(`Channel status: ${status}`, error);
      }
    });

    channelRef.current = channel;

    // Cleanup function
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (channelRef.current) {
        console.log(`Unsubscribing from ${channelName} channel`);
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [routeId, handleWaitingFlagRaised, handleWaitingFlagAcknowledged, handleWaitingFlagRemoved]);

  // Fetch initial waiting flags
  useEffect(() => {
    isMountedRef.current = true;

    const fetchInitialFlags = async () => {
      if (!supabase || !routeId) return;
      
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('waiting_flags')
          .select('*')
          .eq('route_id', routeId)
          .eq('status', 'raised')
          .order('created_at', { ascending: false });
        
        if (!isMountedRef.current) return;
        
        if (error) {
          throw new Error(error.message);
        }
        
        const formattedFlags: WaitingFlag[] = data.map((flag: any) => ({
          id: flag.id,
          studentUid: flag.student_uid,
          studentName: flag.student_name || 'Unknown Student',
          busId: flag.bus_id,
          routeId: flag.route_id,
          stop_name: flag.stop_name,
          stopLat: flag.stop_lat,
          stopLng: flag.stop_lng,
          status: flag.status,
          createdAt: flag.created_at,
          expiresAt: flag.expires_at || new Date(new Date(flag.created_at).getTime() + 20 * 60 * 1000).toISOString()
        }));
        
        setFlags(formattedFlags);
      } catch (err: any) {
        console.error('Error fetching initial waiting flags:', err);
        if (isMountedRef.current) {
          setError(err.message || 'Failed to fetch waiting flags');
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };
    
    fetchInitialFlags();

    return () => {
      isMountedRef.current = false;
    };
  }, [routeId]);

  // Fallback timeout for loading state
  useEffect(() => {
    if (loading) {
      const timeout = setTimeout(() => {
        console.log('No realtime flag updates received, stopping loading state');
        setLoading(false);
      }, 10000);

      return () => clearTimeout(timeout);
    }
  }, [loading]);

  // Acknowledge a waiting flag
  const acknowledgeFlag = useCallback(async (flagId: string, driverUid: string) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (getIdToken) {
        const token = await getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      // Call backend API to acknowledge flag
      const response = await fetch('/api/driver/ack-flag', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          flagId
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to acknowledge flag');
      }
      
      // Update local state immediately for better UX
      setFlags(prev => 
        prev.map(flag => 
          flag.id === flagId 
            ? { 
                ...flag, 
                status: 'acknowledged',
                ackByDriverUid: driverUid
              } 
            : flag
        )
      );
      
      return { success: true };
    } catch (err: any) {
      console.error('Error acknowledging flag:', err);
      return { success: false, error: err.message || 'Unknown error' };
    }
  }, [getIdToken]);

  // Mark a student as boarded
  const markAsBoarded = useCallback(async (studentUid: string, busId: string, flagId: string) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (getIdToken) {
        const token = await getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      // Call backend API to mark student as boarded
      const response = await fetch('/api/driver/mark-boarded', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          flagId
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to mark student as boarded');
      }
      
      // Update local state immediately for better UX
      setFlags(prev => 
        prev.filter(f => f.id !== flagId)
      );
      
      return { success: true };
    } catch (err: any) {
      console.error('Error marking as boarded:', err);
      return { success: false, error: err.message || 'Unknown error' };
    }
  }, [getIdToken]);

  return {
    flags,
    loading,
    error,
    acknowledgeFlag,
    markAsBoarded
  };
};