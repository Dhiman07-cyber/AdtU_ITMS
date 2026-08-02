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

  const isTripActiveRef = useRef(true);
  const lastTimestampRef = useRef<number>(0);

  const applyIncomingLocation = useCallback((newLocation: BusLocation) => {
    if (!isValidLatLng(newLocation.lat, newLocation.lng)) return;
    if (!isTripActiveRef.current) return;

    // Monotonic timestamp check: reject stale/older updates
    const incomingTs = new Date(newLocation.timestamp).getTime();
    if (Number.isFinite(incomingTs) && incomingTs > 0 && incomingTs <= lastTimestampRef.current) {
      return;
    }
    if (Number.isFinite(incomingTs) && incomingTs > 0) {
      lastTimestampRef.current = incomingTs;
    }

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
    lastTimestampRef.current = 0;
    if (!busId) {
      setCurrentLocation(null); setHistory([]); setLoading(false);
      return;
    }
    setCurrentLocation(null); setHistory([]); setLoading(true);

    let isSubscribed = true;
    fetch(`/api/student/trip-status?busId=${encodeURIComponent(busId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!isSubscribed) return;
        if (data?.tripActive) {
          isTripActiveRef.current = true;
          const loc = data.tripData?.current_location;
          if (loc && loc.lat && loc.lng) {
            handleBusLocationUpdate({
              busId: loc.busId || busId,
              driverUid: loc.driverUid || data.tripData.driverUid || '',
              lat: Number(loc.lat),
              lng: Number(loc.lng),
              speed: loc.speed || 0,
              heading: loc.heading || 0,
              accuracy: loc.accuracy,
              timestamp: loc.timestamp || new Date().toISOString(),
            });
          }
        } else if (data && !data.tripActive) {
          isTripActiveRef.current = false;
        }
        setLoading(false);
      })
      .catch(err => {
        console.warn('[useBusLocation] Failed to fetch initial location:', err);
        if (isSubscribed) setLoading(false);
      });

    return () => { isMountedRef.current = false; isSubscribed = false; };
  }, [busId, token, handleBusLocationUpdate]);

  useEffect(() => {
    if (!busId) return;

    const busVariations = Array.from(new Set([
      busId,
      busId.startsWith('bus_') ? busId.replace('bus_', '') : `bus_${busId}`
    ]));

    if (externalClient) {
      const unsubs = busVariations.map(id =>
        externalClient.subscribe(`bus_location_${id}`, (payload: any) => {
          handleBusLocationUpdate(payload.payload || payload);
        })
      );
      return () => { unsubs.forEach(unsub => unsub()); };
    }

    if (!token) return;
    const url = process.env.NEXT_PUBLIC_WS_URL || `ws://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3001/ws`;
    const client = new WebSocketClient({ url, token });
    clientRef.current = client;
    client.connect();

    const unsubs = busVariations.map(id =>
      client.subscribe(`bus_location_${id}`, (payload: any) => {
        handleBusLocationUpdate(payload.payload || payload);
      })
    );

    return () => {
      unsubs.forEach(unsub => unsub());
      client.disconnect();
      clientRef.current = null;
    };
  }, [busId, token, externalClient, handleBusLocationUpdate]);

  return { currentLocation, history, loading, error };
};
