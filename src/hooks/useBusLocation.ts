import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase-client';
import { isValidLatLng } from '@/lib/maps/location-display-guards';

interface BusLocation {
  busId: string;
  driverUid: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy?: number;
  timestamp: string;
}

export const useBusLocation = (busId: string) => {
  const [currentLocation, setCurrentLocation] = useState<BusLocation | null>(null);
  const [history, setHistory] = useState<BusLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const isMountedChannelRef = useRef(true);

  const applyIncomingLocation = useCallback((newLocation: BusLocation) => {
    if (!isValidLatLng(newLocation.lat, newLocation.lng)) return;

    setCurrentLocation(newLocation);
    setHistory((prev) => {
      const next = [...prev, newLocation];
      return next.slice(-50);
    });
    setLoading(false);
  }, []);

  const handleBusLocationUpdate = useCallback(
    (payload: any) => {
      const locationData = payload.payload;
      const newLocation: BusLocation = {
        busId: locationData.busId,
        driverUid: locationData.driverUid,
        lat: locationData.lat,
        lng: locationData.lng,
        speed: locationData.speed || 0,
        heading: locationData.heading || 0,
        accuracy: locationData.accuracy,
        timestamp: locationData.ts || locationData.timestamp || new Date().toISOString(),
      };
      applyIncomingLocation(newLocation);
    },
    [applyIncomingLocation]
  );

  useEffect(() => {
    isMountedRef.current = true;

    if (!busId) {
      setCurrentLocation(null);
      setHistory([]);
      setLoading(false);
      return;
    }

    // Always start fresh - no cache
    setCurrentLocation(null);
    setHistory([]);

    const fetchInitialLocation = async () => {
      if (!supabase || !busId) {
        if (isMountedRef.current) setLoading(false);
        return;
      }

      if (isMountedRef.current) setLoading(true);

      try {
        const { data: locations, error: qErr } = await supabase
          .from('bus_locations')
          .select('*')
          .eq('bus_id', busId)
          .neq('lat', 0)
          .neq('lng', 0)
          .order('timestamp', { ascending: false })
          .limit(1);

        if (!qErr && locations && locations.length > 0) {
          const location = locations[0];
          const busLocation: BusLocation = {
            busId: location.bus_id,
            driverUid: location.driver_uid,
            lat: location.lat,
            lng: location.lng,
            speed: location.speed || 0,
            heading: location.heading || 0,
            accuracy: location.accuracy,
            timestamp: location.timestamp || new Date().toISOString(),
          };
          if (isValidLatLng(busLocation.lat, busLocation.lng)) {
            applyIncomingLocation(busLocation);
          }
        }
      } catch (err) {
        console.error('Error fetching initial bus location:', err);
        if (isMountedRef.current) setError('Failed to fetch bus location');
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };

    fetchInitialLocation();

    return () => {
      isMountedRef.current = false;
    };
  }, [busId, applyIncomingLocation]);

  useEffect(() => {
    if (!supabase || !busId) return;

    isMountedChannelRef.current = true;
    const channelName = `bus_location_${busId}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: {
          self: false,
        },
      },
    });

    channel.on('broadcast', { event: 'bus_location_update' }, handleBusLocationUpdate);

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'bus_locations',
        filter: `bus_id=eq.${busId}`,
      },
      (payload) => {
        const newLoc = payload.new;
        handleBusLocationUpdate({
          payload: {
            busId: newLoc.bus_id,
            driverUid: newLoc.driver_uid,
            lat: newLoc.lat,
            lng: newLoc.lng,
            speed: newLoc.speed || 0,
            heading: newLoc.heading || 0,
            accuracy: newLoc.accuracy,
            ts: newLoc.timestamp,
          },
        });
      }
    );

    channel.subscribe((status: string, err: any) => {
      if (!isMountedChannelRef.current) return;
      if (status === 'SUBSCRIBED') {
        setLoading(false);
      } else if (status === 'CHANNEL_ERROR') {
        console.error('Bus location channel error:', err);
        setError('Realtime connection failed');
        setLoading(false);
      } else if (status === 'TIMED_OUT') {
        console.error('Bus location channel timed out');
        setError('Realtime connection timed out');
        setLoading(false);
      }
    });

    return () => {
      isMountedChannelRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [busId, handleBusLocationUpdate]);

  return {
    currentLocation,
    history,
    loading,
    error,
  };
};
