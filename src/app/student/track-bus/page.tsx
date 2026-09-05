"use client";

import ErrorBoundary from "@/components/ErrorBoundary";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import TransportEntitlementGuard from "@/components/transport/TransportEntitlementGuard";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/contexts/toast-context";
import { WebSocketClient } from '@/domains/realtime/ws-client';
import { getClientWsUrl } from '@/domains/realtime';
import { parseTimestampMs } from '@/domains/realtime/location-packet-guard';
import { useBusLocation } from '@/hooks/useBusLocation';
import {
	getBusById,
	getRouteById
} from "@/lib/dataService";
import { formatIdForDisplay, isShiftCompatible } from "@/lib/utils";
import {
	AlertCircle,
	Bus,
	Clock,
	Flag,
	Navigation,
	X,
	XCircle
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect,useRef,useState } from "react";

const LiveTrackingBusMap = dynamic(() => import("@/components/maps/LiveTrackingBusMap"), {
  ssr: false,
  loading: () => <div className="h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 rounded-3xl animate-pulse" />
});

// Dynamically import QRCodeCanvas for inline QR display
const QRCodeCanvas = dynamic(
  () => import('qrcode.react').then((mod) => mod.QRCodeCanvas),
  { ssr: false }
);

// Default map center for Guwahati (Panikhaiti / ADTU campus)
const DEFAULT_CENTER: [number, number] = [
  parseFloat(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LAT || "26.1440"),
  parseFloat(process.env.NEXT_PUBLIC_DEFAULT_MAP_CENTER_LNG || "91.7360")
];

import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';

function TrackBusLive() {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();

  // Prevent screen auto-off while tracking bus map
  useScreenWakeLock(true);
  const { addToast } = useToast();

  const [studentData, setStudentData] = useState<any>(null);
  const [busData, setBusData] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [busLocation, setBusLocation] = useState<any>(null);
  const [studentLocation, setStudentLocation] = useState<any>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [dataLoading, setDataLoading] = useState(true);
  const [submittingFlag, setSubmittingFlag] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [currentFlagId, setCurrentFlagId] = useState<string | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [distanceToBus, setDistanceToBus] = useState<number | null>(null);
  const [tripActive, setTripActive] = useState(false);
  const [wsClientReady, setWsClientReady] = useState(false);

  const [showManualLocation, setShowManualLocation] = useState(false);
  const [isFullScreenMap, setIsFullScreenMap] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false); // Show student's QR code

  // New state for the 10s countdown
  const [pendingRaise, setPendingRaise] = useState(false);
  const [countdown, setCountdown] = useState(5);

  const handleRaiseWaitingFlagRef = useRef<(() => Promise<void>) | null>(null);

  // Exit full screen mode automatically when trip ends
  useEffect(() => {
    if (!tripActive && isFullScreenMap) {
      setIsFullScreenMap(false);
    }
  }, [tripActive, isFullScreenMap]);

  // Handle countdown timer - using ref to avoid dependency on handleRaiseWaitingFlag
  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    if (pendingRaise && countdown > 0) {
      interval = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (pendingRaise && countdown === 0) {
      // Countdown finished, trigger the actual raise using ref
      if (handleRaiseWaitingFlagRef.current) {
        handleRaiseWaitingFlagRef.current();
      }
      setPendingRaise(false);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pendingRaise, countdown]);

  const locationWatchIdRef = useRef<number | null>(null);
  const hasShownLocationErrorRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasShownArrivalToastRef = useRef(false); // Track if 100m arrival toast shown
  const wsClientRef = useRef<WebSocketClient | null>(null);
  // wsClient is a STATE mirror of wsClientRef so effects that depend on the
  // client re-run when it becomes available. Refs are not reactive — passing
  // wsClientRef.current to useBusLocation always gives null on first render.
  const [wsClient, setWsClient] = useState<WebSocketClient | null>(null);




  // Get student's current location with low-accuracy fallback
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported");
      return;
    }

    console.log("Starting location tracking for student...");

    const handleLocationSuccess = (position: GeolocationPosition) => {
      const locationData = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      setStudentLocation(locationData);
    };

    const handleLocationError = (err: GeolocationPositionError) => {
      console.warn("High-accuracy location failed, falling back to low-accuracy:", err.message);
      navigator.geolocation.getCurrentPosition(
        handleLocationSuccess,
        (fallbackErr) => {
          console.warn("Low-accuracy location failed:", fallbackErr.message);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    };

    // Get initial position with 5s timeout fallback
    navigator.geolocation.getCurrentPosition(
      handleLocationSuccess,
      handleLocationError,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
    );

    // Watch position continuously
    locationWatchIdRef.current = navigator.geolocation.watchPosition(
      handleLocationSuccess,
      (error) => {
        console.debug("Location watch error:", error.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 10000,
      }
    );

    return () => {
      if (locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current);
        locationWatchIdRef.current = null;
      }
    };
  }, []); // Run once on mount

  // Fallback to assigned bus stop location or AdtU Campus if device GPS is unavailable
  useEffect(() => {
    if (studentLocation) return;

    if (studentData?.stop_lat && studentData?.stop_lng) {
      setStudentLocation({
        lat: Number(studentData.stop_lat),
        lng: Number(studentData.stop_lng),
        accuracy: 100,
      });
      return;
    }

    const stopName = (studentData?.stop_name || studentData?.assignedStop || studentData?.stopName || studentData?.pickupPoint || studentData?.pickup_stop || '').toLowerCase();

    if (routeData?.stops && Array.isArray(routeData.stops) && stopName) {
      const matchedStop = routeData.stops.find((s: any) =>
        (s.name && s.name.toLowerCase().includes(stopName)) ||
        (s.stop_name && s.stop_name.toLowerCase().includes(stopName)) ||
        (s.id && s.id.toLowerCase().includes(stopName))
      );
      if (matchedStop && (matchedStop.lat || matchedStop.stop_lat) && (matchedStop.lng || matchedStop.stop_lng)) {
        setStudentLocation({
          lat: Number(matchedStop.lat || matchedStop.stop_lat),
          lng: Number(matchedStop.lng || matchedStop.stop_lng),
          accuracy: 100,
        });
        return;
      }
    }

    // Default Fallback: AdtU Campus coordinates (26.2019, 91.8615) if no stop coordinates found
    if (!studentLocation && studentData) {
      setStudentLocation({
        lat: 26.2019,
        lng: 91.8615,
        accuracy: 100,
      });
    }
  }, [studentLocation, studentData, routeData]);



  // Fetch student data
  useEffect(() => {
    const fetchData = async () => {
      // Wait for auth to finish loading before checking
      if (loading) {
        console.log("⏳ Auth still loading, waiting...");
        return; // Still loading, don't redirect yet
      }

      // Now check if user is authenticated and is a student
      if (!currentUser?.uid || userData?.role !== "student") {
        console.log("🚫 Not authenticated or not a student, redirecting to login");
        router.push("/login");
        return;
      }

      try {
        // Optimization: Use userData from context + dashboard-data fallback
        const student = userData;
        setStudentData(student);

        const targetBusId = student?.busId || student?.bus_id;
        const targetRouteId = student?.routeId || student?.route_id;

        const queries = [];

        let fetchedBus: any = null;
        let fetchedRoute: any = null;

        if (targetBusId) {
          const busPromise = getBusById(targetBusId).then(bus => {
            if (bus) {
              fetchedBus = bus;
              setBusData(bus);
            }
            return bus;
          });
          queries.push(busPromise);
        }

        if (targetRouteId) {
          const routePromise = getRouteById(targetRouteId).then(route => {
            if (route) {
              fetchedRoute = route;
              setRouteData(route);
            }
            return route;
          });
          queries.push(routePromise);
        }

        // Check for existing waiting flag
        const idToken = await currentUser.getIdToken();
        const waitingFlagPromise = fetch(`/api/student/waiting-flag?studentUid=${currentUser.uid}`, {
          headers: {
            'Authorization': `Bearer ${idToken}`
          }
        })
          .then(res => res.json())
          .then((result) => {
            const existingFlags = result.data;
            if (existingFlags) {
              setIsWaiting(true);
              setCurrentFlagId(existingFlags.id);
              if (existingFlags && existingFlags.stop_lat && existingFlags.stop_lng) {
                setStudentLocation({ lat: existingFlags.stop_lat, lng: existingFlags.stop_lng, accuracy: 50 });
              }
              console.log("✅ Existing waiting flag found:", existingFlags);
            }
          })
          .catch(err => {
            console.error("Error fetching wait flag via api:", err);
          });
        queries.push(waitingFlagPromise);

        // Fetch all independently
        await Promise.all(queries);

        // Fallback: If bus or route is still missing, fetch comprehensive dashboard data from Supabase API
        if (!fetchedBus || !fetchedRoute) {
          try {
            const dashRes = await fetch('/api/student/dashboard-data', {
              headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (dashRes.ok) {
              const dash = await dashRes.json();
              if (dash.student) setStudentData(dash.student);
              if (dash.bus) setBusData(dash.bus);
              if (dash.route) setRouteData(dash.route);
            }
          } catch (dashErr) {
            console.error("Dashboard data fallback error:", dashErr);
          }
        }

        setDataLoading(false);
      } catch (error) {
        console.error("Error fetching data:", error);
        addToast("Failed to load tracking data", "error");
        setDataLoading(false);
      }
    };

    fetchData();

    // Re-fetch data on window focus to handle bus reassignments
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loading, currentUser, userData, router, addToast]);

  // Create shared WebSocket client (single connection owner for all subscriptions)
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await currentUser.getIdToken();
        if (cancelled) return;
        const url = getClientWsUrl();
        const client = new WebSocketClient({ url, token });
        wsClientRef.current = client;
        // Connect FIRST so the WS handshake starts, then expose the client
        // to React state so dependent effects (useBusLocation, subscription
        // effects) receive a real connected client instead of null.
        client.connect();
        if (!cancelled) {
          setWsClient(client);
          setWsClientReady(true);
        }
      } catch (err) {
        console.warn('[TrackBus] Failed to create WS client:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
      setWsClient(null);
      setWsClientReady(false);
    };
  }, [currentUser]);

  const [wsConnected, setWsConnected] = useState(false);

  // Track live WebSocket connection health to dynamically tune HTTP fallback polling
  useEffect(() => {
    if (!wsClient) {
      setWsConnected(false);
      return;
    }
    setWsConnected(wsClient.isConnected());
    const unsub = wsClient.onStatus((status) => {
      setWsConnected(status === 'connected');
    });
    return () => {
      unsub();
    };
  }, [wsClient]);


  // Subscribe to per-student events (ack broadcasts, trip-end teardown)
  useEffect(() => {
    if (!currentUser?.uid) return;
    const client = wsClientRef.current;
    if (!client) return;

    const unsub = client.subscribe(`student_${currentUser.uid}`, (payload: any) => {
      const evt = payload.event;

      if (evt === 'wait_response') {
        const msg = payload.response === 'accepted' ? 'Driver will wait for you!' : 'Driver could not wait. Please proceed to the stop.';
        addToast(msg, payload.response === 'accepted' ? 'success' : 'info');
        return;
      }

      if (evt === 'flag_acknowledged') {
        // Driver acknowledged the flag — toast only, do NOT clear isWaiting yet
        addToast("👋 Driver has acknowledged your waiting flag!", "success");
        return;
      }

      if (evt === 'waiting_flag_removed' || payload.status === 'cancelled' || payload.status === 'boarded') {
        setIsWaiting(false);
        setCurrentFlagId(null);
        addToast("🎉 You've been picked up! Have a safe journey.", "success");
        return;
      }
    });

    return () => { unsub(); };
  }, [currentUser?.uid, wsClientReady, addToast]);


  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser) {
      currentUser.getIdToken().then(t => setAuthToken(t)).catch(() => {});
    } else {
      setAuthToken(null);
    }
  }, [currentUser?.uid]);

  const targetBusId = busData?.id || busData?.busId || busData?.bus_id || studentData?.bus_id || studentData?.busId || '';

  // useBusLocation receives the reactive wsClient state (not the ref snapshot).
  // When wsClient is null on first render, the hook defers its WS subscription.
  // When wsClient becomes available (after connect), the hook re-runs its effect
  // and subscribes to bus_location_${busId} — this is now the single authoritative
  // location producer for the student UI.
  const {
    currentLocation: hookBusLocation,
    loading: busLocationLoading
  } = useBusLocation(targetBusId, authToken || undefined, wsClient);


  // Update local busLocation state whenever hook location changes (monotonic guard)
  useEffect(() => {
    if (!hookBusLocation) return;
    setBusLocation((prev: any) => {
      if (!prev) return hookBusLocation;
      const prevTs = parseTimestampMs(prev.timestamp);
      const hookTs = parseTimestampMs(hookBusLocation.timestamp);
      if (hookTs >= prevTs) return hookBusLocation;
      return prev;
    });
  }, [hookBusLocation]);

  // useBusLocation (above) is the single authoritative bus-location producer.
  // It handles both the initial HTTP snapshot AND live WS updates via the
  // reactive wsClient state. The hook's applyIncomingLocation has a monotonic
  // timestamp guard so out-of-order packets are rejected.
  //
  // DO NOT add a second bus_location_* WS subscription here — two subscribers
  // on the same channel would race each other and could deliver duplicate or
  // out-of-order state updates to setBusLocation.

  // Subscribe to trip status events via WebSocket
  useEffect(() => {
    if (!targetBusId || !wsClient) return;

    const unsub = wsClient.subscribe(`trip-status-${targetBusId}`, (payload: any) => {
      console.log("🚦 Trip status broadcast:", payload);
      const data = payload.payload || payload;
      const eventType = data.event || payload.event;
      if (eventType === "trip_started" || data.status === "active") {
        const studentShift = studentData?.shift || studentData?.student_shift;
        if (data.shift && studentShift && !isShiftCompatible(studentShift, data.shift)) {
          console.log(`ℹ️ Ignoring trip_started broadcast for bus ${targetBusId} due to shift mismatch (student: ${studentShift}, trip: ${data.shift})`);
          return;
        }
        setTripActive(true);
        addToast(`🚌 Trip started for ${formatIdForDisplay(data.routeId || data.busId || targetBusId)}!`, "success");
      } else if (eventType === "trip_ended" || data.status === "ended") {
        setTripActive(false);
        setBusLocation(null);
        setIsFullScreenMap(false);
        setIsWaiting(false);
        setCurrentFlagId(null);
        if (typeof window !== 'undefined') {
          (window as any).__itmsLastBusLocation = null;
          (window as any).__itmsMarkerPosition = null;
        }
        addToast(`🏁 Trip for ${formatIdForDisplay(data.busNumber || data.busId || targetBusId)} has ended`, "success");
      }
    });

    return () => {
      unsub();
    };
  }, [targetBusId, wsClient, studentData, addToast]);

  // Adaptive HTTP fallback polling:
  // - WebSocket healthy (wsConnected === true): relaxes to 25s check.
  // - WebSocket disconnected/reconnecting (wsConnected === false): 5s fast recovery poll.
  // Guarantees: inFlight guard prevents overlapping polls; cleanup prevents timer leaks;
  // monotonic timestamp guard accepts only newer snapshots.
  useEffect(() => {
    if (!targetBusId) return;

    let isMounted = true;
    let timerId: NodeJS.Timeout | null = null;
    let inFlight = false;

    const pollIntervalMs = wsConnected ? 25000 : 5000;

    const checkActiveTrip = async () => {
      if (!isMounted || inFlight) return;
      inFlight = true;

      try {
        const token = authToken || await currentUser?.getIdToken();
        const response = await fetch(`/api/student/trip-status?busId=${encodeURIComponent(targetBusId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });

        if (!response.ok || !isMounted) return;

        const result = await response.json();
        if (!isMounted) return;

        if (result.tripActive) {
          setTripActive(true);
          if (result.tripData?.current_location) {
            const loc = result.tripData.current_location;
            if (loc && loc.lat && loc.lng) {
              const newLoc = {
                busId: loc.busId || targetBusId,
                driverUid: loc.driverUid || result.tripData.driverUid || '',
                lat: Number(loc.lat),
                lng: Number(loc.lng),
                speed: loc.speed !== undefined ? Number(loc.speed) : 0,
                heading: loc.heading !== undefined ? Number(loc.heading) : 0,
                accuracy: loc.accuracy,
                timestamp: loc.timestamp || new Date().toISOString(),
              };

              setBusLocation((prev: any) => {
                if (!prev) return newLoc;
                const prevTs = parseTimestampMs(prev.timestamp);
                const newTs = parseTimestampMs(newLoc.timestamp);
                if (newTs > prevTs) return newLoc;
                return prev;
              });

              if (typeof window !== 'undefined') {
                const prev = (window as any).__itmsLastBusLocation;
                const prevTs = prev ? parseTimestampMs(prev.timestamp) : 0;
                const newTs = parseTimestampMs(newLoc.timestamp);
                if (newTs > prevTs) {
                  (window as any).__itmsLastBusLocation = { ...newLoc, appliedAtMs: Date.now() };
                }
              }
            }
          }
        } else {
          setTripActive(false);
          setBusLocation(null);
          if (typeof window !== 'undefined') {
            (window as any).__itmsLastBusLocation = null;
            (window as any).__itmsMarkerPosition = null;
          }
        }
      } catch (error) {
        console.error("❌ Error checking active trip:", error);
      } finally {
        inFlight = false;
        if (isMounted) {
          timerId = setTimeout(checkActiveTrip, pollIntervalMs);
        }
      }
    };

    // Immediate initial check
    checkActiveTrip();

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [targetBusId, wsConnected, authToken, currentUser]);

  // Calculate distance and ETA between bus and student
  useEffect(() => {
    if (!busLocation || !studentLocation) {
      setDistanceToBus(null);
      setEta(null);
      return;
    }

    // Haversine formula to calculate distance between two lat/lng points
    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c; // Distance in km
    };

    const busLat = busLocation.lat;
    const busLng = busLocation.lng;
    const studentLat = studentLocation.lat;
    const studentLng = studentLocation.lng;

    if (busLat && busLng && studentLat && studentLng) {
      const distance = calculateDistance(busLat, busLng, studentLat, studentLng);
      setDistanceToBus(distance);

      // Calculate ETA assuming average speed of 25 km/h in city traffic
      const avgSpeedKmh = busLocation.speed && busLocation.speed > 5 ? busLocation.speed * 3.6 : 25; // Convert m/s to km/h or use default
      const timeHours = distance / avgSpeedKmh;
      const timeMinutes = Math.round(timeHours * 60);

      if (timeMinutes < 1) {
        setEta("< 1 min");
      } else if (timeMinutes === 1) {
        setEta("1 min");
      } else if (timeMinutes < 60) {
        setEta(`${timeMinutes} mins`);
      } else {
        const hours = Math.floor(timeMinutes / 60);
        const mins = timeMinutes % 60;
        setEta(`${hours}h ${mins}m`);
      }

      // Show toast when bus is within 100m (0.1 km)
      if (distance <= 0.1 && !hasShownArrivalToastRef.current && tripActive) {
        hasShownArrivalToastRef.current = true;
        addToast("🚌 Your bus is about to arrive! Be ready at the stop.", "success");
      }

      // Reset the toast flag when bus is more than 500m away (so it can show again on next approach)
      if (distance > 0.5) {
        hasShownArrivalToastRef.current = false;
      }
    }
  }, [busLocation, studentLocation, tripActive, addToast]);

  // Subscribe to waiting flag changes via WebSocket (bus-level channel)
  useEffect(() => {
    if (!currentUser?.uid || !targetBusId) return;
    const client = wsClientRef.current;
    if (!client) return;

    const unsub = client.subscribe(`waiting_flags_${targetBusId}`, (payload: any) => {
      const flagStudentUid = payload.student_uid || payload.studentUid;
      if (flagStudentUid !== currentUser.uid) return;
      console.log("📡 Waiting flag change received:", payload);

      const evt = payload.event;

      if (
        evt === 'waiting_flag_removed' ||
        payload.status === 'boarded' ||
        payload.status === 'cancelled' ||
        payload.status === 'picked_up'
      ) {
        setIsWaiting(false);
        setCurrentFlagId(null);
        const reason = payload.reason;
        if (reason === 'trip_ended') {
          addToast("🚌 Trip has ended. Your waiting flag was cleared.", "info");
        } else if (evt === 'waiting_flag_removed' || payload.status === 'boarded' || payload.status === 'picked_up') {
          addToast("🎉 You've been picked up! Have a safe journey.", "success");
        } else {
          addToast("Your waiting flag has been cleared.", "info");
        }
      } else if (payload.status === "acknowledged" || evt === 'waiting_flag_acknowledged') {
        addToast("👋 Driver has acknowledged your waiting flag!", "success");
      }
    });

    return () => { unsub(); };
  }, [currentUser?.uid, targetBusId, wsClientReady, addToast]);


  // Screen Wake Lock API
  useEffect(() => {
    let wakeLock: any = null;

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
          console.log('💡 Screen Wake Lock active');
        }
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') { // Ignore NotAllowedError from background tabs
          console.error(`❌ Wake Lock error: ${err.name}, ${err.message}`);
        }
      }
    };

    // Request wake lock when trip is active or tracking or map is full screen
    if (tripActive || isWaiting || busLocation || isFullScreenMap) {
      requestWakeLock();
    }

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && (tripActive || isWaiting || busLocation || isFullScreenMap)) {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) {
        wakeLock.release().catch(() => { });
        wakeLock = null;
      }
    };
  }, [tripActive, isWaiting, busLocation, isFullScreenMap]);

  // Raise waiting flag
  const handleRaiseWaitingFlag = async () => {
    if (!currentUser || !busData) {
      addToast("Unable to raise flag - missing data", "error");
      return;
    }

    // Check if there's an active trip
    if (!tripActive) {
      addToast("Cannot raise waiting flag - no active trip. Please wait for the driver to start the trip.", "error");
      return;
    }

    setSubmittingFlag(true);

    try {
      // Get current position with multiple fallback attempts
      let position = null;
      if (navigator.geolocation) {
        try {
          console.log("🌍 Attempting to get current position...");

          // Try with network-based location first (faster and more reliable)
          position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                console.log("✅ Location obtained:", {
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  accuracy: pos.coords.accuracy
                });
                resolve(pos);
              },
              reject,
              {
                enableHighAccuracy: false, // Network/WiFi location (faster, less battery)
                timeout: 15000, // 15 second timeout
                maximumAge: 300000 // Allow 5 minute cached position (very lenient)
              }
            );
          });
        } catch (geoError: any) {
          console.error("Geolocation error details:", {
            code: geoError?.code,
            message: geoError?.message || "No message",
            name: geoError?.name,
          });

          // Handle specific geolocation errors with helpful messages
          if (geoError.code === 1) { // PERMISSION_DENIED
            addToast("📍 Location permission denied. Please enable location in your browser settings.", "error");
            setShowManualLocation(true);
            setSubmittingFlag(false);
            return;
          } else if (geoError.code === 2) { // POSITION_UNAVAILABLE
            addToast("📍 Location unavailable. Please ensure location services are enabled on your device.", "warning");
            setShowManualLocation(true);
            setSubmittingFlag(false);
            return;
          } else if (geoError.code === 3) { // TIMEOUT
            addToast("📍 Location request timed out. Please try again.", "warning");
            setSubmittingFlag(false);
            return;
          } else {
            addToast("📍 Unable to get your location. Please check your device settings.", "error");
            setShowManualLocation(true);
            setSubmittingFlag(false);
            return;
          }
        }
      } else {
        addToast("Geolocation is not supported by your browser.", "error");
        setSubmittingFlag(false);
        return;
      }

      const currentLocation = position ? {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      } : null;

      if (currentLocation) {
        setStudentLocation(currentLocation);
        setMapCenter([position.coords.latitude, position.coords.longitude]);
      }

      // Ensure we have location before proceeding
      if (!currentLocation || !currentLocation.lat || !currentLocation.lng) {
        addToast("Unable to get your location. Please ensure location services are enabled.", "error");
        setSubmittingFlag(false);
        return;
      }

      // Get Firebase ID token
      const idToken = await currentUser.getIdToken();

      // Prepare flag data with location
      const flagData: any = {
        idToken,
        busId: busData.busId,
        routeId: routeData?.routeId || studentData?.routeId,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        // stopLat/stopLng: explicit coordinate fields for the student marker on the driver map.
        // The server also accepts lat/lng as fallback, but we send both for clarity.
        stopLat: currentLocation.lat,
        stopLng: currentLocation.lng,
        accuracy: position?.coords.accuracy || 50,
      };



      // Call API to raise waiting flag
      const response = await fetch('/api/student/waiting-flag', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify(flagData)
      });

      let result;
      try {
        const text = await response.text();
        result = text ? JSON.parse(text) : {};
      } catch (e) {
        console.warn("Failed to parse response as JSON", e);
        result = {};
      }

      if (response.ok && result.success) {
        setIsWaiting(true);
        setCurrentFlagId(result.flagId);
        addToast("✅ Waiting flag raised! Driver has been notified.", "success");
      } else if (response.status === 409 && result.existingFlagId) {
        // Handle existing flag (conflict) gracefully - restore state
        console.log("⚠️ Flag already exists, restoring state:", result);
        setIsWaiting(true);
        setCurrentFlagId(result.existingFlagId);
        addToast("You already have an active waiting flag for this bus.", "info");
      } else {
        console.error("❌ Error raising waiting flag:", result);
        addToast(result.error || result.message || `Failed to raise waiting flag (${response.status})`, "error");
      }
    } catch (error: any) {
      console.error("❌ Error raising waiting flag:", error);
      console.error("❌ Error details:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        statusCode: error.statusCode
      });

      if (error.code === 1) {
        addToast("Location permission denied. Please enable location access.", "error");
      } else if (error.code === 2) {
        addToast("Location unavailable. Please check your GPS settings.", "error");
      } else if (error.code === 3) {
        addToast("Location request timed out. Please try again.", "error");
      } else if (error.message) {
        addToast("Failed to raise waiting flag: " + error.message, "error");
      } else {
        addToast("Failed to raise waiting flag. Please try again.", "error");
      }
    } finally {
      setSubmittingFlag(false);
    }
  };

  // Keep ref in sync with the latest handleRaiseWaitingFlag
  useEffect(() => {
    handleRaiseWaitingFlagRef.current = handleRaiseWaitingFlag;
  }, [currentUser, busData, routeData, studentData, tripActive, addToast]);

  // Remove waiting flag via API
  const handleRemoveWaitingFlag = async () => {
    if (!currentFlagId || !currentUser) return;

    try {
      setSubmittingFlag(true);
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/student/waiting-flag', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token, flagId: currentFlagId, busId: busData?.busId }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Failed to cancel waiting flag (${response.status})`);
      }

      setIsWaiting(false);
      setCurrentFlagId(null);
      setEta(null);
      setDistanceToBus(null);
      sessionStorage.removeItem(`notified_arrival_${currentFlagId}`);
      addToast("Waiting flag removed", "success");

    } catch (error: any) {
      console.error("Error removing waiting flag:", error);
      addToast("Failed to remove waiting flag", "error");
    } finally {
      setSubmittingFlag(false);
    }
  };

  // Toggle waiting flag
  const handleToggleWaitingFlag = () => {
    if (isWaiting) {
      // If actually waiting, button is disabled per requirement, so this shouldn't be reached usually.
      return;
    } else if (pendingRaise) {
      // If pending (in 10s window), cancel the countdown
      setPendingRaise(false);
      setCountdown(5);
      addToast("Waiting flag request cancelled", "info");
    } else {
      // Start the countdown
      setPendingRaise(true);
      setCountdown(5);
    }
  };


  // Show loading while auth is loading
  if (loading) {
    return <PremiumPageLoader message="Loading Bus Tracker" subMessage="Preparing tracking interface..." />;
  }

  // NOTE (Phase 3): the soft-block / entitlement gate that used to live here has
  // moved UP to <TransportEntitlementGuard> (see default export). This component
  // only ever mounts for students who currently own transport access, so all the
  // realtime subscriptions above are guaranteed to run only for entitled students.

  if (dataLoading) {
    return <PremiumPageLoader message="Loading Bus Tracker" subMessage="Initializing maps and fetching real-time location..." />;
  }

  if (!busData || !routeData) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>No Bus Assigned</CardTitle>
          </CardHeader>
          <CardContent>
            <p>You haven't been assigned to a bus yet. Please contact your admin.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/20 dark:from-gray-950 dark:via-blue-950/20 dark:to-purple-950/10">
      <div className="container mx-auto px-4 pb-4 pt-20 md:px-6 md:pb-6 md:pt-24 space-y-6">
        {/* Optimized Header */}
        <div className="group relative overflow-hidden rounded-3xl md:rounded-[2rem] p-[2px] bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 shadow-xl">
          {/* Simplified gradient border background */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-75 group-hover:opacity-100 transition-opacity duration-300" />

          {/* Optimized card container */}
          <div className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-3xl md:rounded-[2rem] p-4 md:p-5">
            <div className="flex flex-col md:flex-row items-center justify-between gap-5">
              <div className="space-y-3 w-full">
                {/* Title Section */}
                <div className="flex items-center gap-4">
                  <div className="relative p-2.5 md:p-3 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 shadow-lg">
                    <Navigation className="h-5 md:h-6 w-5 md:w-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-xl md:text-2xl lg:text-3xl font-extrabold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 dark:from-blue-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent leading-none">
                      Live Bus Tracker
                    </h1>
                    <p className="text-[9px] md:text-[10px] text-gray-600 dark:text-gray-400 mt-1 font-bold uppercase tracking-wider opacity-80">
                      Real-time location • Instant updates • Smart ETA
                    </p>
                  </div>
                </div>

                {/* Optimized Status Indicators & Bus Info Grid - Explicit 2-Column Side-by-Side */}
                <div className="grid grid-cols-2 gap-x-4 md:gap-x-12 gap-y-3 items-stretch">
                  {/* Column 1: Status Badges (Trip Status & ETA) */}
                  <div className="flex flex-col gap-3">
                    <div className={`group/badge flex-1 flex items-center relative overflow-hidden px-4 md:px-6 py-3 md:py-3.5 rounded-xl md:rounded-2xl font-black text-[9px] md:text-[13px] shadow-lg transition-all duration-300 hover:scale-[1.02] ${tripActive
                      ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-green-500/30'
                      : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-amber-500/30'
                      }`}>
                      <div className="flex items-center gap-2 md:gap-3 w-full">
                        <span className={`w-1.5 md:w-2.5 h-1.5 md:h-2.5 rounded-full ${tripActive ? 'bg-white animate-pulse' : 'bg-white/60'}`} />
                        <span className="relative z-10 tracking-tight md:tracking-wide uppercase truncate">{tripActive ? 'Trip Active' : 'Trip Inactive'}</span>
                      </div>
                    </div>

                    <div className="flex-1 flex items-center relative overflow-hidden px-4 md:px-6 py-3 md:py-3.5 rounded-xl md:rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-black text-[9px] md:text-[13px] shadow-lg shadow-blue-500/30 transition-all duration-300 hover:scale-[1.02]">
                      <div className="flex items-center gap-2 md:gap-3 w-full">
                        <Clock className="h-3.5 w-3.5 md:h-4 md:w-4" />
                        <span className="relative z-10 tracking-tight md:tracking-wide uppercase truncate">ETA: {eta || '--'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Column 2: Bus & Route Information */}
                  <div className="flex flex-col gap-3">
                    <div className="flex-1 bg-slate-50 dark:bg-white/5 rounded-xl md:rounded-2xl px-4 md:px-6 py-2 md:py-2.5 border border-slate-100 dark:border-white/10 flex flex-col justify-center transition-all duration-300 hover:border-blue-500/30">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="w-1 md:w-1.5 h-1 md:h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                        <span className="text-[7.5px] md:text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Bus</span>
                      </div>
                      <h3 className="text-[10px] md:text-lg font-black text-slate-800 dark:text-white uppercase leading-tight truncate">
                        {busData.busNumber}
                      </h3>
                    </div>

                    <div className="flex-1 bg-slate-50 dark:bg-white/5 rounded-xl md:rounded-2xl px-4 md:px-6 py-2 md:py-2.5 border border-slate-100 dark:border-white/10 flex flex-col justify-center transition-all duration-300 hover:border-purple-500/30">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="w-1 md:w-1.5 h-1 md:h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                        <span className="text-[7.5px] md:text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Route</span>
                      </div>
                      <h3 className="text-[10px] md:text-lg font-black text-slate-700 dark:text-slate-300 leading-tight truncate">
                        {routeData.routeName}
                      </h3>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>


        {/* Optimized Map Layout */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Dimmer for Full Screen Mode */}
          {isFullScreenMap && (
            <div className="fixed inset-0 bg-black/80 z-40 backdrop-blur-sm transition-opacity duration-300 pointer-events-none" />
          )}

          {/* Map Section */}
          <div className={`transition-all duration-300 ${isFullScreenMap ? "fixed inset-0 z-[10000] p-0" : "flex-1"}`}>
            <div className={`relative overflow-hidden shadow-xl ring-1 ring-black/5 dark:ring-white/10 transition-all duration-300 ${isFullScreenMap
              ? "h-[100dvh] w-screen rounded-none"
              : "h-[420px] md:h-[550px] lg:h-full rounded-3xl md:rounded-[2rem]"
              }`}>
              <LiveTrackingBusMap
                busId={targetBusId}
                busNumber={busData?.busNumber || busData?.bus_number || targetBusId}
                journeyActive={tripActive}
                isFullScreen={isFullScreenMap}
                onToggleFullScreen={() => setIsFullScreenMap(!isFullScreenMap)}
                showStatsOnMobile={isFullScreenMap}
                studentLocation={studentLocation}
                onShowQrCode={() => setShowQrCode(true)}
                currentLocation={busLocation}
                loading={busLocationLoading}
                route_stops={routeData?.stops?.map((s: { name: string; lat: number; lng: number; sequence?: number }) => ({
                  name: s.name,
                  lat: s.lat,
                  lng: s.lng,
                  sequence: s.sequence,
                }))}
                primaryActionLabel={
                  submittingFlag
                    ? "Processing..."
                    : isWaiting
                      ? "Waiting flag already raised"

                      : pendingRaise
                        ? `Cancel (${countdown}s)`
                        : !tripActive
                          ? "Trip not active"

                          : "Raise waiting flag"


                }
                primaryActionColor={isWaiting ? 'yellow' : !tripActive ? 'blue' : 'orange'}
                primaryActionDisabled={isWaiting || submittingFlag}
                onPrimaryAction={(!tripActive && !isWaiting) ? undefined : (isWaiting ? undefined : handleToggleWaitingFlag)}
              />
            </div>
          </div>

          {/* Optimized Info Sidebar */}
          <div className="w-full lg:w-96 space-y-5">
            {/* Bus Info Card - Hidden on Mobile */}
            <div className="hidden lg:block group relative overflow-hidden rounded-2xl p-[1px] bg-gradient-to-br from-blue-400 via-cyan-400 to-teal-400 shadow-lg hover:scale-[1.02] transition-transform duration-300">

              <Card className="relative bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-0">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg transition-transform duration-200">
                      <Bus className="h-5 w-5 text-white" />
                    </div>
                    <span className="bg-gradient-to-r from-blue-600 to-cyan-600 dark:from-blue-400 dark:to-cyan-400 bg-clip-text text-transparent font-bold">
                      Bus Information
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-100 dark:border-slate-700/50">
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Bus Number</p>
                      <p className="font-bold text-lg text-slate-800 dark:text-white">{busData.busNumber}</p>
                    </div>
                    <div className="w-[1px] bg-slate-200 dark:bg-slate-700 mx-4" />
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Route</p>
                      <p className="font-bold text-lg text-slate-800 dark:text-white">{routeData.routeName}</p>
                    </div>
                  </div>
                </CardContent>

              </Card>
            </div>

            {/* Waiting Flag Card */}
            <div className="group relative overflow-hidden rounded-2xl p-[1px] bg-gradient-to-br from-orange-400 via-red-400 to-pink-400 shadow-lg hover:scale-[1.02] transition-transform duration-300">

              <Card className="relative bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-0">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-500 to-pink-500 shadow-lg transition-transform duration-200">
                      <Flag className="h-5 w-5 text-white" />
                    </div>
                    <span className="bg-gradient-to-r from-orange-600 to-pink-600 dark:from-orange-400 dark:to-pink-400 bg-clip-text text-transparent font-bold">
                      Waiting Status
                    </span>
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-4 pt-2">
                  {/* Real-time Quick Stats Row */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-100 dark:border-slate-700/50">
                    <div className="text-center">
                      <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Trip</p>
                      <div className={`text-[10px] font-black ${tripActive ? 'text-emerald-500' : 'text-slate-400'}`}>
                        {tripActive ? "ACTIVE" : "OFFLINE"}
                      </div>
                    </div>
                    <div className="text-center border-x border-slate-200 dark:border-slate-700">
                      <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">ETA</p>
                      <div className="text-[10px] font-black text-blue-500">
                        {eta || "Unavailable"}
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Distance</p>
                      <div className="text-[10px] font-black text-slate-700 dark:text-slate-200">
                        {distanceToBus !== null ? `${distanceToBus.toFixed(1)}km` : "Unavailable"}
                      </div>
                    </div>
                  </div>


                  {isWaiting && (
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-bold flex items-center gap-2">
                        <Flag className="h-3 w-3" />
                        Driver Notified (Flag Active)
                      </p>
                    </div>
                  )}




                  {/* How it works section */}
                  <div className="relative overflow-hidden bg-gradient-to-br from-indigo-50 via-blue-50 to-cyan-50 dark:from-indigo-950/30 dark:via-blue-950/20 dark:to-cyan-950/30 rounded-xl p-5 border border-indigo-100 dark:border-indigo-900">
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500">
                        <AlertCircle className="h-4 w-4 text-white" />
                      </div>
                      How it Works
                    </h4>
                    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300 font-medium">
                      <p className="flex items-start gap-2">
                        <span className="text-indigo-600 dark:text-indigo-400 mt-0.5">1️⃣</span>
                        <span>Click "Raise Waiting Flag" when ready</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <span className="text-indigo-600 dark:text-indigo-400 mt-0.5">2️⃣</span>
                        <span>Your driver will be notified instantly</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <span className="text-indigo-600 dark:text-indigo-400 mt-0.5">3️⃣</span>
                        <span>Driver will come to your location</span>
                      </p>
                      <p className="flex items-start gap-2">
                        <span className="text-indigo-600 dark:text-indigo-400 mt-0.5">4️⃣</span>
                        <span>Flag expires automatically in 20 minutes</span>
                      </p>
                    </div>
                  </div>
                  {/* Action Button - Raise Waiting Flag */}
                  <div className="pt-2">
                    <Button
                      onClick={handleToggleWaitingFlag}
                      className={`
                        relative w-full py-6 md:py-7 text-sm md:text-base font-bold shadow-lg overflow-hidden
                        transition-shadow duration-200 active:scale-[0.98]
                        disabled:opacity-70 disabled:cursor-not-allowed
                        ${isWaiting
                          ? 'bg-gray-500 text-white cursor-not-allowed'
                          : pendingRaise
                            ? 'bg-gradient-to-r from-red-500 via-pink-500 to-red-500 text-white shadow-red-500/50'
                            : tripActive
                              ? 'bg-gradient-to-r from-orange-500 via-pink-500 to-orange-500 text-white shadow-orange-500/50'
                              : 'bg-gray-400 text-gray-700'
                        }
                      `}
                      size="lg"
                      disabled={submittingFlag || (!tripActive && !isWaiting) || (isWaiting && !pendingRaise)}
                    >
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        {submittingFlag ? (
                          <>
                            <div className="h-5 w-5 animate-spin rounded-full border-[3px] border-current border-t-transparent"></div>
                            <span>{pendingRaise ? "Cancelling..." : "Processing..."}</span>
                          </>
                        ) : isWaiting ? (
                          <>
                            <Flag className="h-5 w-5" />
                            <span>Flag Raised</span>
                          </>
                        ) : pendingRaise ? (
                          <>
                            <XCircle className="h-5 w-5" />
                            <span>Cancel ({countdown}s)</span>
                          </>
                        ) : !tripActive ? (
                          <>
                            <AlertCircle className="h-5 w-5" />
                            <span>No Trip</span>
                          </>
                        ) : (
                          <>
                            <Flag className="h-5 w-5 animate-pulse" />
                            <span>Raise Waiting Flag</span>
                          </>
                        )}
                      </span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

          </div>
        </div>



        {/* Fullscreen QR Code Overlay - Shows on map when QR button is clicked */}
        {
          showQrCode && isFullScreenMap && studentData && (
            <>
              {/* Blur overlay - clickable to close */}
              <div
                className="fixed inset-0 z-[10001] bg-black/70 backdrop-blur-md"
                onClick={() => setShowQrCode(false)}
              />

              {/* Premium QR Code Card - Centered on screen */}
              <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4 pointer-events-none">
                <div className="pointer-events-auto w-full max-w-[340px] bg-[#0a0b14] rounded-[28px] overflow-hidden shadow-2xl border border-white/10 animate-in zoom-in-95 fade-in duration-200">
                  {/* Header with university branding */}
                  <div className="relative px-5 py-4 bg-gradient-to-r from-[#1a1b2e] to-[#0f1019] border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <Image src="/adtu-new-logo.svg" alt="AdtU" width={112} height={28} className="h-7 w-auto" style={{ width: 'auto', height: 'auto' }} />
                      <div>
                        <span className="text-xs font-bold text-white/80 block">Assam down town University</span>
                        <span className="text-[10px] font-medium text-white/40">Digital Bus Pass</span>
                      </div>
                    </div>
                    {/* Close button */}
                    <button
                      onClick={() => setShowQrCode(false)}
                      className="absolute top-3 right-3 w-8 h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-all"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Student Info */}
                  <div className="px-5 pt-4 pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest block mb-0.5">Student</span>
                        <h3 className="text-lg font-black text-white tracking-tight">{studentData.fullName || 'Student'}</h3>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[10px] font-bold ${studentData.status === 'active'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                        {studentData.status === 'active' ? 'ACTIVE' : 'INACTIVE'}
                      </div>
                    </div>
                  </div>

                  {/* QR Code */}
                  <div className="flex justify-center py-5">
                    <div className="relative p-4 bg-white rounded-2xl shadow-xl">
                      <QRCodeCanvas
                        value={currentUser?.uid || ''}
                        size={160}
                        level="H"
                        includeMargin={false}
                      />
                      {/* Corner accents */}
                      <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-blue-500 rounded-tl-lg" />
                      <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-blue-500 rounded-tr-lg" />
                      <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-blue-500 rounded-bl-lg" />
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-blue-500 rounded-br-lg" />
                    </div>
                  </div>

                  {/* Enrollment ID */}
                  <div className="mx-5 mb-5 bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="flex flex-col items-center">
                      <span className="text-[8px] font-bold text-white/30 uppercase tracking-[0.2em] mb-1">Enrollment ID</span>
                      <span className="text-base font-bold text-blue-400 tracking-widest font-mono">
                        {studentData.enrollmentId || 'N/A'}
                      </span>
                    </div>
                  </div>

                  {/* Bus Info Bar */}
                  <div className="mx-5 mb-5 flex items-center justify-between bg-[#1a1b2e] rounded-xl px-4 py-2.5 border border-white/5">
                    <div className="flex items-center gap-2">
                      <Bus className="w-4 h-4 text-blue-400" />
                      <span className="text-sm font-bold text-white">Bus-{busData?.busNumber?.replace('bus_', '') || 'N/A'}</span>
                    </div>
                    <div className="text-xs text-white/50">
                      Route: {routeData?.routeName || busData?.busNumber?.replace('bus_', '') || 'N/A'}
                    </div>
                  </div>

                  {/* Footer instruction */}
                  <div className="px-5 pb-5 text-center">
                    <p className="text-[10px] text-white/30">Show this QR code to the driver for verification</p>
                  </div>
                </div>
              </div>
            </>
          )
        }
      </div>
    </div>
    </ErrorBoundary>
  );
}

/**
 * Phase 3 — entitlement is decided BEFORE the live tracking UI mounts.
 * `TrackBusLive` (which holds every Supabase channel, Firestore listener, and
 * geolocation watcher) is rendered only when the canonical guard confirms the
 * student currently owns transport access. Ineligible students never open a
 * single transport subscription.
 */
export default function StudentTrackBusPage() {
  return (
    <TransportEntitlementGuard>
      <TrackBusLive />
    </TransportEntitlementGuard>
  );
}
