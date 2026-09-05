import { WebSocketClient } from '@/domains/realtime/ws-client';
import { getClientWsUrl } from '@/domains/realtime';
import { decideLocationPacket, parseTimestampMs } from '@/domains/realtime/location-packet-guard';
import { isValidLatLng } from '@/lib/maps/location-display-guards';
import { useEffect, useRef, useState } from 'react';

interface BusLocation {
  busId: string;
  driverUid: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy?: number;
  timestamp: string;
  tripId?: string;
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
  // Tracks the authoritative tripId for the current tracking session.
  // Packets from a different tripId are rejected to prevent stale-data resurrection.
  const activeTripIdRef = useRef<string | null>(null);
  // tripId of the most recently *ended* trip. Packets claiming this tripId are
  // dead forever — they must never resurrect a location after trip_ended.
  const endedTripIdRef = useRef<string | null>(null);

  const applyIncomingLocation = (newLocation: BusLocation) => {
    if (!isMountedRef.current) return;
    const lat = Number(newLocation.lat);
    const lng = Number(newLocation.lng);
    if (!isValidLatLng(lat, lng)) return;

    const decision = decideLocationPacket(
      { tripId: newLocation.tripId, timestamp: newLocation.timestamp },
      {
        isTripActive: isTripActiveRef.current,
        activeTripId: activeTripIdRef.current,
        endedTripId: endedTripIdRef.current,
        lastTimestampMs: lastTimestampRef.current,
      }
    );

    if (!decision.apply) {
      console.warn('[useBusLocation] Rejected packet:', decision.rejectReason, {
        received: newLocation.tripId,
      });
      return;
    }

    isTripActiveRef.current = decision.isTripActive;
    activeTripIdRef.current = decision.activeTripId;
    endedTripIdRef.current = decision.endedTripId;
    lastTimestampRef.current = decision.lastTimestampMs;

    const cleanLocation: BusLocation = {
      ...newLocation,
      lat,
      lng,
      speed: Number(newLocation.speed || 0),
      heading: Number(newLocation.heading || 0),
      timestamp: new Date(decision.incomingTsMs).toISOString(),
    };

    setCurrentLocation(cleanLocation);
    setHistory((prev) => {
      const next = [...prev, cleanLocation];
      return next.slice(-50);
    });
    setLoading(false);
    // E2E observability hook (dev only): mirrors the post-guard state the map
    // effect consumes, so automated tests can assert the marker would move.
    if (typeof window !== 'undefined') {
      (window as any).__itmsLastBusLocation = { ...cleanLocation, appliedAtMs: Date.now() };
      (window as any).__itmsBusLocationHistory = ((window as any).__itmsBusLocationHistory || []).concat([cleanLocation]).slice(-50);
    }
  };

  const handleBusLocationUpdate = (locationData: any) => {
    if (!locationData || !isMountedRef.current) return;

    const data = locationData.payload || locationData;
    const eventType = data.event || locationData.event || data.type || locationData.type;

    if (eventType === 'trip_started' || eventType === 'TRIP_STARTED' || data.status === 'active') {
      isTripActiveRef.current = true;
      endedTripIdRef.current = null;
      activeTripIdRef.current = data.tripId || data.trip_id || null;
      lastTimestampRef.current = 0;
      return;
    }

    if (eventType === 'trip_ended' || eventType === 'TRIP_ENDED' || data.status === 'ended') {
      isTripActiveRef.current = false;
      // Tombstone the ended trip: any later packet still carrying this tripId
      // is stale and must be rejected.
      endedTripIdRef.current = data.tripId || data.trip_id || activeTripIdRef.current || null;
      activeTripIdRef.current = null;
      lastTimestampRef.current = 0;
      setCurrentLocation(null);
      if (typeof window !== 'undefined') {
        (window as any).__itmsLastBusLocation = null;
        (window as any).__itmsMarkerPosition = null;
      }
      return;
    }

    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

    const newLocation: BusLocation = {
      busId: data.busId || busId,
      driverUid: data.driverUid || '',
      lat,
      lng,
      speed: data.speed !== undefined ? Number(data.speed) : 0,
      heading: data.heading !== undefined ? Number(data.heading) : 0,
      accuracy: data.accuracy !== undefined ? Number(data.accuracy) : undefined,
      timestamp: data.ts || data.timestamp || new Date().toISOString(),
      tripId: data.tripId || data.trip_id || undefined,
    };
    applyIncomingLocation(newLocation);
  };

  useEffect(() => {
    isMountedRef.current = true;
    lastTimestampRef.current = 0;
    activeTripIdRef.current = null;
    endedTripIdRef.current = null;

    if (!busId) {
      setCurrentLocation(null);
      setHistory([]);
      setLoading(false);
      return;
    }
    setCurrentLocation(null);
    setHistory([]);
    setLoading(true);

    let isSubscribed = true;

    fetch(`/api/student/trip-status?busId=${encodeURIComponent(busId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isSubscribed) return;

        if (data?.tripActive) {
          isTripActiveRef.current = true;
          const tripId = data.tripData?.tripId || data.tripData?.trip_id || null;
          if (tripId) activeTripIdRef.current = tripId;

          const loc = data.tripData?.current_location;
          if (loc && loc.lat && loc.lng) {
            handleBusLocationUpdate({
              busId: loc.busId || busId,
              driverUid: loc.driverUid || data.tripData?.driverUid || '',
              lat: Number(loc.lat),
              lng: Number(loc.lng),
              speed: loc.speed || 0,
              heading: loc.heading || 0,
              accuracy: loc.accuracy,
              timestamp: loc.timestamp || new Date().toISOString(),
              tripId: tripId ?? undefined,
            });
          }
        } else if (data && !data.tripActive) {
          isTripActiveRef.current = false;
          activeTripIdRef.current = null;
          // HTTP fallback: clear location globals if trip is confirmed ended.
          // The WS trip_ended event is the primary path, but if it is delayed
          // or missed the HTTP poll must act as the safety net.
          setCurrentLocation(null);
          if (typeof window !== 'undefined') {
            (window as any).__itmsLastBusLocation = null;
            (window as any).__itmsMarkerPosition = null;
          }
        }

        if (isSubscribed) setLoading(false);
      })
      .catch((err) => {
        console.warn('[useBusLocation] Failed to fetch initial location:', err);
        if (isSubscribed) setLoading(false);
      });

    return () => {
      isMountedRef.current = false;
      isSubscribed = false;
    };
  }, [busId, token]);

  useEffect(() => {
    if (!busId) return;

    const setupSubscriptions = (ws: WebSocketClient) => {
      const unsubs: (() => void)[] = [];

      // Queue presence BEFORE subscribing — the server requires busId to be
      // set (via presence) before a student/driver can subscribe to bus channels.
      ws.setPresence({ busId });

      // Subscribe to live location updates on the dedicated bus_location_* channel
      unsubs.push(
        ws.subscribe(`bus_location_${busId}`, (payload: any) => {
          handleBusLocationUpdate(payload);
        })
      );
      // Subscribe to trip status events (trip_started, trip_ended)
      unsubs.push(
        ws.subscribe(`trip-status-${busId}`, (payload: any) => {
          handleBusLocationUpdate(payload);
        })
      );

      return () => {
        unsubs.forEach((unsub) => unsub());
      };
    };

    // Build a handleResume function that re-syncs position from DB whenever
    // the screen wakes up, the network comes back online, or the WS reconnects.
    // This is registered for BOTH the externalClient and self-managed-client
    // paths — the previous code skipped it for externalClient, which meant
    // any screen-off/on or network blip left the student's marker frozen.
    const handleResume = () => {
      if (document.visibilityState === 'visible' && busId) {
        console.log('[useBusLocation] Screen awake / app resumed — re-syncing bus location');

        const activeClient = externalClient || clientRef.current;
        if (activeClient) {
          // Re-queue presence before reconnecting — server needs busId
          // before bus-channel subscriptions are accepted.
          activeClient.setPresence({ busId });
          try { activeClient.connect(); } catch (_) {}
        }

        // Do NOT reset lastTimestampRef — that would disarm the monotonic
        // guard and allow an older DB snapshot to overwrite newer GPS state.

        fetch(`/api/student/trip-status?busId=${encodeURIComponent(busId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!isMountedRef.current) return;
            if (data?.tripActive) {
              // Update trip state metadata (authoritative regardless of timestamp).
              isTripActiveRef.current = true;
              const resumeTripId = data.tripData?.tripId || data.tripData?.trip_id || null;
              if (resumeTripId) activeTripIdRef.current = resumeTripId;

              // Only apply location if it is newer than what we already know.
              // This prevents a DB snapshot (which lags the GPS pipeline) from
              // regressing the client's known position.
              const loc = data.tripData?.current_location;
              if (loc && loc.lat && loc.lng) {
                const snapshotTs = parseTimestampMs(loc.timestamp);
                if (snapshotTs > lastTimestampRef.current) {
                  handleBusLocationUpdate({
                    busId: loc.busId || busId,
                    driverUid: loc.driverUid || data.tripData?.driverUid || '',
                    lat: Number(loc.lat),
                    lng: Number(loc.lng),
                    speed: loc.speed || 0,
                    heading: loc.heading || 0,
                    accuracy: loc.accuracy,
                    timestamp: loc.timestamp || new Date().toISOString(),
                    tripId: resumeTripId ?? undefined,
                  });
                }
              }
            } else {
              // Trip is no longer active — update metadata and clear location.
              isTripActiveRef.current = false;
              activeTripIdRef.current = null;
              setCurrentLocation(null);
              if (typeof window !== 'undefined') {
                (window as any).__itmsLastBusLocation = null;
                (window as any).__itmsMarkerPosition = null;
              }
            }
          })
          .catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('online', handleResume);

    if (externalClient) {
      // externalClient is owned by the parent — don't disconnect it on cleanup.
      const unsub = setupSubscriptions(externalClient);
      return () => {
        document.removeEventListener('visibilitychange', handleResume);
        window.removeEventListener('online', handleResume);
        unsub();
      };
    }

    if (!token) {
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('online', handleResume);
      return;
    }

    const url = getClientWsUrl();
    const client = new WebSocketClient({ url, token });
    clientRef.current = client;
    client.connect();

    const unsub = setupSubscriptions(client);

    return () => {
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('online', handleResume);
      unsub();
      client.disconnect();
      clientRef.current = null;
    };
  }, [busId, token, externalClient]);

  return { currentLocation, history, loading, error };
};
