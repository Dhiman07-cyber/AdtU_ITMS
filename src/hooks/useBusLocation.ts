import { WebSocketClient } from '@/domains/realtime/ws-client';
import { isValidLatLng } from '@/lib/maps/location-display-guards';
import { supabase } from '@/lib/supabase-client';
import { useCallback,useEffect,useRef,useState } from 'react';

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

export const useBusLocation = (busId: string, token?: string | null, externalClient?: WebSocketClient | null) => {
  const [currentLocation, setCurrentLocation] = useState<BusLocation | null>(null);
  const [history, setHistory] = useState<BusLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const clientRef = useRef<WebSocketClient | null>(null);

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
    (locationData: any) => {
      const newLocation: BusLocation = {
        busId: locationData.busId || busId,
        driverUid: locationData.driverUid || '',
        lat: locationData.lat,
        lng: locationData.lng,
        speed: locationData.speed || 0,
        heading: locationData.heading || 0,
        accuracy: locationData.accuracy,
        timestamp: locationData.ts || locationData.timestamp || new Date().toISOString(),
      };
      applyIncomingLocation(newLocation);
    },
    [applyIncomingLocation, busId]
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (!busId) {
      setCurrentLocation(null); setHistory([]); setLoading(false);
      return;
    }
    setCurrentLocation(null); setHistory([]);

    const fetchInitialLocation = async () => {
      if (!supabase || !busId) { if (isMountedRef.current) setLoading(false); return; }
      if (isMountedRef.current) setLoading(true);
      try {
        const { data: locations } = await supabase
          .from('bus_locations')
          .select('*')
          .eq('bus_id', busId)
          .neq('lat', 0).neq('lng', 0)
          .order('timestamp', { ascending: false })
          .limit(1);
        if (locations && locations.length > 0) {
          const loc = locations[0];
          const bl: BusLocation = {
            busId: loc.bus_id, driverUid: loc.driver_uid,
            lat: loc.lat, lng: loc.lng,
            speed: loc.speed || 0, heading: loc.heading || 0,
            accuracy: loc.accuracy, timestamp: loc.timestamp,
          };
          if (isValidLatLng(bl.lat, bl.lng)) applyIncomingLocation(bl);
        }
      } catch { if (isMountedRef.current) setError('Failed to fetch bus location'); }
      finally { if (isMountedRef.current) setLoading(false); }
    };
    fetchInitialLocation();
    return () => { isMountedRef.current = false; };
  }, [busId, applyIncomingLocation]);

  useEffect(() => {
    if (!busId) return;

    if (externalClient) {
      const unsub = externalClient.subscribe(`bus_location_${busId}`, (payload: any) => {
        handleBusLocationUpdate(payload.payload || payload);
      });
      return () => { unsub(); };
    }

    if (!token) return;
    const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001/ws`;
    const client = new WebSocketClient({ url, token });
    clientRef.current = client;
    client.connect();

    const unsub = client.subscribe(`bus_location_${busId}`, (payload: any) => {
      handleBusLocationUpdate(payload.payload || payload);
    });

    return () => {
      unsub();
      client.disconnect();
      clientRef.current = null;
    };
  }, [busId, token, externalClient, handleBusLocationUpdate]);

  return { currentLocation, history, loading, error };
};
