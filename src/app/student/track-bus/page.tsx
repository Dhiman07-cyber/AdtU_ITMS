"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MapPin,
  Bus,
  Navigation,
  Play,
  Square,
  Flag,
  XCircle,
  AlertCircle,
  Clock,
  X,
  AlertTriangle,
  CheckCircle
} from "lucide-react";
import {
  getStudentByUid,
  getBusById,
  getRouteById,
} from "@/lib/dataService";
import { supabase } from "@/lib/supabase-client";
import { useToast } from "@/contexts/toast-context";
import dynamic from "next/dynamic";
import { useBusLocation } from '@/hooks/useBusLocation';
import TransportEntitlementGuard from "@/components/transport/TransportEntitlementGuard";
import { formatIdForDisplay } from "@/lib/utils";
import ErrorBoundary from "@/components/ErrorBoundary";
import { PremiumPageLoader } from "@/components/LoadingSpinner";

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

function TrackBusLive() {
  const { currentUser, userData, loading } = useAuth();
  const router = useRouter();
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
  const waitFlagBroadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Calculate distance between two points (Haversine formula)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
  };

  const deg2rad = (deg: number): number => {
    return deg * (Math.PI / 180);
  };

  // Calculate ETA based on distance and speed
  const calculateETA = (distanceKm: number, speedKmh: number): string => {
    if (speedKmh <= 0) return "Unknown";

    const hours = distanceKm / speedKmh;
    const minutes = Math.round(hours * 60);

    if (minutes < 1) return "Arriving now";
    if (minutes < 60) return `${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hrs}h ${mins}m`;
  };

  // Get student's current location 
  useEffect(() => {
    // Start location tracking immediately to show distance to bus
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported");
      return;
    }

    console.log("Starting location tracking for student (HIGH ACCURACY)...");

    // Get initial position immediately
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const initial = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setStudentLocation(initial);
        console.log("Initial student location caught:", initial);
      },
      (err) => console.log("Initial location error:", err.message),
      { enableHighAccuracy: true }
    );



    // Watch position continuously when waiting
    locationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setStudentLocation(newLocation);
      },
      (error) => {
        console.debug("Location watch error:", error.message);
      },
      {
        enableHighAccuracy: true, // Use GPS for better accuracy
        timeout: 10000,
        maximumAge: 0,
      }
    );

    return () => {
      if (locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current);
        locationWatchIdRef.current = null;
      }
    };
  }, []); // Run once on mount

  // Cleanup wait flag broadcast channel on unmount
  useEffect(() => {
    return () => {
      if (waitFlagBroadcastChannelRef.current) {
        supabase.removeChannel(waitFlagBroadcastChannelRef.current);
        waitFlagBroadcastChannelRef.current = null;
      }
    };
  }, []);

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
        // Optimization: Use userData from context instead of re-fetching student doc
        const student = userData;
        setStudentData(student);

        // Run subsequent queries in parallel to significantly reduce waterfall loading
        const queries = [];

        let busPromise = Promise.resolve(null);
        if (student.busId) {
          busPromise = getBusById(student.busId).then(bus => {
            if (bus) setBusData(bus);
            return bus;
          });
          queries.push(busPromise);
        }

        let routePromise = Promise.resolve(null);
        if (student.routeId) {
          routePromise = getRouteById(student.routeId).then(route => {
            if (route) setRouteData(route);
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

  // Subscribe to acknowledgment channel for instant feedback
  useEffect(() => {
    if (!currentUser?.uid || !isWaiting) return;

    console.log("🔔 Subscribing to student acknowledgment channel");

    const channel = supabase
      .channel(`student_${currentUser.uid}`, {
        config: {
          broadcast: { self: false }
        }
      })
      .on("broadcast", { event: "flag_acknowledged" }, (payload) => {
        console.log("✅ Flag acknowledged by driver:", payload);

        // Clear waiting state
        setIsWaiting(false);
        setCurrentFlagId(null);

        // Show success notification
        addToast("🎉 Driver has acknowledged your flag! They're on the way!", "success");
      })
      .subscribe((status) => {
        console.log("📡 Student acknowledgment channel status:", status);
      });

    return () => {
      console.log("🧹 Cleaning up student acknowledgment channel");
      supabase.removeChannel(channel);
    };
  }, [currentUser?.uid, isWaiting, addToast]);

  // Use the optimized bus location hook
  const {
    currentLocation: hookBusLocation,
    loading: busLocationLoading
  } = useBusLocation(busData?.busId || studentData?.busId || studentData?.busId || '');


  // Update local busLocation state whenever hook location changes
  useEffect(() => {
    if (hookBusLocation) {
      setBusLocation(hookBusLocation);
    }
  }, [hookBusLocation]);

  // NO-OP: Removed redundant tripEndChannel hook (consolidated below)

  // Check for active trip with realtime subscription
  useEffect(() => {
    if (!busData?.busId) return;

    const checkActiveTrip = async () => {
      try {
        console.log('🔍 Checking trip status via API for bus:', busData.busId);

        // Use API endpoint with auth token
        const token = await currentUser?.getIdToken();
        const response = await fetch(`/api/student/trip-status?busId=${encodeURIComponent(busData.busId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });

        if (!response.ok) {
          console.warn('⚠️ Trip status API returned non-OK status:', response.status);
          return;
        }

        const result = await response.json();

        if (result.tripActive) {
          console.log('✅ Active trip found via API:', result.tripData);
          setTripActive(true);
        } else {
          console.log('ℹ️ No active trip found via API');
          setTripActive(false);
          setBusLocation(null); // Clear stale location if trip not active
        }
      } catch (error) {
        console.error("❌ Error checking active trip:", error);
      }
    };

    // Run the check immediately
    checkActiveTrip();

    // Subscribe to realtime changes on driver_status table
    const driverStatusChannel = supabase
      .channel(`driver_status_${busData.busId}`)
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to INSERT, UPDATE, DELETE
          schema: "public",
          table: "driver_status",
          filter: `bus_id=eq.${busData.busId}`
        },
        (payload) => {
          console.log("📡 Driver status change received:", payload);

          if (payload.eventType === "DELETE") {
            // Driver ended trip (deleted their status)
            setTripActive(false);
            setBusLocation(null);
            console.log("🛑 Trip ended - driver_status deleted");
          } else if (payload.new) {
            const newStatus = (payload.new as any).status;
            const isActive = newStatus === "on_trip" || newStatus === "enroute";
            setTripActive(isActive);
            console.log("🚀 Trip status updated via realtime:", isActive);
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("✅ Subscribed to driver_status changes for bus:", busData.busId);
        }
      });

    // Also subscribe to trip_started/ended broadcast (instant WebSocket notification)
    const tripNotificationChannel = supabase
      .channel(`trip-status-${busData.busId}`)
      .on("broadcast", { event: "trip_started" }, (payload) => {
        console.log("🚀 Trip started broadcast received:", payload);
        setTripActive(true);
        const routeName = payload.payload?.routeName || payload.payload?.routeId;
        addToast(`🚌 Trip started for ${formatIdForDisplay(routeName)}!`, "success");
      })
      .on("broadcast", { event: "trip_ended" }, (payload) => {
        console.log("🛑 Trip ended broadcast received:", payload);
        setTripActive(false);
        setBusLocation(null);
        setIsFullScreenMap(false);
        setIsWaiting(false);
        setCurrentFlagId(null);
        const busNum = payload.payload?.busNumber || payload.payload?.busId;
        addToast(`🏁 Trip for ${formatIdForDisplay(busNum)} has ended`, "success");
      })
      .subscribe();

    // Also set up periodic checks every 30 seconds as fallback
    const interval = setInterval(checkActiveTrip, 30000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(driverStatusChannel);
      supabase.removeChannel(tripNotificationChannel);
    };
  }, [busData?.busId, addToast]);

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

  // Subscribe to waiting flag changes for this student
  useEffect(() => {
    if (!currentUser?.uid || !busData?.busId) return;

    const waitingFlagChannel = supabase
      .channel(`waiting_flag_${currentUser.uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "waiting_flags",
          filter: `student_uid=eq.${currentUser.uid}`
        },
        (payload) => {
          console.log("📡 Waiting flag change received:", payload);

          if (payload.eventType === "DELETE" ||
            (payload.new && (payload.new as any).status === "boarded") ||
            (payload.new && (payload.new as any).status === "cancelled") ||
            (payload.new && (payload.new as any).status === "removed") ||
            (payload.new && (payload.new as any).status === "picked_up")) {
            // Flag was removed or marked as completed
            setIsWaiting(false);
            setCurrentFlagId(null);
            if (payload.eventType === "DELETE") {
              addToast("🎉 You've been picked up! Have a safe journey.", "success");
            }
          } else if (payload.new && (payload.new as any).status === "acknowledged") {
            addToast("👋 Driver has acknowledged your waiting flag!", "success");
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("✅ Subscribed to waiting flag changes for student:", currentUser.uid);
        }
      });

    return () => {
      supabase.removeChannel(waitingFlagChannel);
    };
  }, [currentUser?.uid, busData?.busId, addToast]);

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
        accuracy: position?.coords.accuracy || 50,
      };

      console.log("🚩 Raising waiting flag with data:", {
        busId: flagData.busId,
        routeId: flagData.routeId,
        lat: flagData.lat,
        lng: flagData.lng,
        accuracy: flagData.accuracy
      });

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

  // Remove waiting flag
  const handleRemoveWaitingFlag = async () => {
    if (!currentFlagId) return;

    try {
      setSubmittingFlag(true);

      // Delete from Supabase
      const { error } = await supabase
        .from("waiting_flags")
        .update({ status: 'cancelled' })
        .eq("id", currentFlagId);

      if (error) throw error;

      // Broadcast removal to driver
      const channel = supabase.channel(`waiting_flags_${busData.busId}`);
      waitFlagBroadcastChannelRef.current = channel;
      const broadcastResult = await channel.send({
        type: "broadcast",
        event: "waiting_flag_removed",
        payload: {
          flagId: currentFlagId,
          studentUid: currentUser?.uid,
        },
      });

      if (broadcastResult !== 'ok') {
        console.warn("Broadcast warning:", broadcastResult);
      }

      // Remove the one-shot broadcast channel so it doesn't leak on repeated cancels.
      supabase.removeChannel(channel);
      waitFlagBroadcastChannelRef.current = null;

      setIsWaiting(false);
      setCurrentFlagId(null);
      // NOTE: Do NOT clear busLocation or tripActive here.
      // The trip continues regardless of the student's waiting flag.
      setEta(null);
      setDistanceToBus(null);

      // Clear arrival notification flag
      sessionStorage.removeItem(`notified_arrival_${currentFlagId}`);

      addToast("Waiting flag removed", "success");

    } catch (error: any) {
      console.error("Error removing waiting flag:", error);
      addToast("Failed to remove waiting flag", "error");
    } finally {
      // Ensure broadcast channel is always cleaned up
      if (waitFlagBroadcastChannelRef.current) {
        supabase.removeChannel(waitFlagBroadcastChannelRef.current);
        waitFlagBroadcastChannelRef.current = null;
      }
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
                busId={busData?.busId || studentData?.busId || ''}
                busNumber={busData?.busNumber}
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
                        {eta || "--"}
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-[8px] font-bold text-slate-400 uppercase mb-1">Distance</p>
                      <div className="text-[10px] font-black text-slate-700 dark:text-slate-200">
                        {distanceToBus !== null ? `${distanceToBus.toFixed(1)}km` : "--"}
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
