"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bus,
  MapPin,
  Navigation,
  Clock,
  User,
  Users,
  CheckCircle,
  XCircle,
  AlertCircle,
  Flag,
  Bell
} from "lucide-react";
import { getBusById, getRouteById, getStudentByUid, getBusesByRouteId } from "@/lib/dataService";
import { supabase } from "@/lib/supabase-client";
import DynamicStudentMap from "@/components/DynamicStudentMap";
import { useGeolocation } from "@/hooks/useGeolocation";
import LocationPermissionModal from "@/components/LocationPermissionModal";
import WaitingFlagModal from "@/components/WaitingFlagModal";
import { useToast } from "@/contexts/toast-context";
import { useFCMToken } from "@/hooks/useFCMToken";
import TransportEntitlementGuard from "@/components/transport/TransportEntitlementGuard";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import ErrorBoundary from "@/components/ErrorBoundary";

function StudentBusLive() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();

  const [studentData, setStudentData] = useState<any>(null);
  const [busData, setBusData] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [waitingFlagId, setWaitingFlagId] = useState<string | null>(null);
  const [stops, setStops] = useState<any[]>([]);
  const [selectedStop, setSelectedStop] = useState<string>("");
  const [showWaitingFlagModal, setShowWaitingFlagModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [raisingFlag, setRaisingFlag] = useState(false);
  const [tripActive, setTripActive] = useState(false);

  // FCM Token management
  const { fcmToken, loading: fcmLoading, error: fcmError, requestPermission } = useFCMToken();

  // Geolocation hook - single fetch for centering map
  const {
    position,
    error: locationError,
    permissionDenied,
    retryTracking
  } = useGeolocation({
    watch: false, // Students don't need continuous tracking
    enabled: false // Only enable when needed for map centering
  });

  // Fetch student data and related information
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser?.uid) {
        setLoading(false);
        return;
      }

      try {
        // Fetch student data
        const student = await getStudentByUid(currentUser.uid);
        if (student) {
          setStudentData(student);
          console.log('Student data fetched in bus page:', student);

          // Fetch route data first
          const routeId = student.routeId || student.routeId;
          if (routeId) {
            console.log('Fetching route data for routeId:', routeId);
            const route = await getRouteById(routeId);
            if (route) {
              setRouteData(route);
              setStops(route.stops || []);
              console.log('Route data fetched:', route);

              // Set default selected stop to the first stop
              if (route.stops && route.stops.length > 0) {
                setSelectedStop(route.stops[0].stop_name);
              }

              // Fetch buses for this route
              const buses = await getBusesByRouteId(routeId);
              if (buses.length > 0) {
                // Use the first bus or find the one matching student's shift
                const assignedBus = buses.find(bus =>
                  bus.shift === student.shift ||
                  bus.shift === 'both' ||
                  !bus.shift
                ) || buses[0];
                setBusData(assignedBus);
                console.log('Bus data fetched:', assignedBus);
              }
            }
          }

          // Also try direct bus ID if available (fallback)
          const busId = student.busId || student.busId;
          if (busId && !busData) {
            console.log('Fetching direct bus data for busId:', busId);
            const bus = await getBusById(busId);
            if (bus) {
              setBusData(bus);
              console.log('Direct bus data fetched:', bus);
            }
          }

          // Check if student has an active waiting flag
          const { data: flags, error: flagError } = await supabase
            .from('waiting_flags')
            .select('*')
            .eq('student_uid', currentUser.uid)
            .in('status', ['raised', 'acknowledged', 'waiting']); // Check multiple statuses

          if (!flagError && flags && flags.length > 0) {
            setWaiting(true);
            setWaitingFlagId(flags[0].id);
          }

          // Check if there's an active trip for this bus by querying Firestore
          try {
            // Note: We can't directly access Firestore from client, so we check driver_status in Supabase
            // which is updated when trips start/end
            const { data: driverStatus } = await supabase
              .from('driver_status')
              .select('*')
              .eq('bus_id', student.busId)
              .in('status', ['on_trip', 'enroute'])
              .maybeSingle();

            setTripActive(!!driverStatus);
            console.log('🚌 Active trip check:', { active: !!driverStatus, status: driverStatus?.status });
          } catch (error) {
            console.error('Error checking active trip:', error);
            setTripActive(false);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser]);

  // Redirect if user is not a student
  useEffect(() => {
    if (userData && userData.role !== "student") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  // Subscribe to driver_status changes to update tripActive in realtime
  useEffect(() => {
    if (!studentData?.busId) return;

    console.log('📡 Subscribing to driver_status for bus:', studentData.busId);

    const channel = supabase
      .channel(`driver_status_${studentData.busId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'driver_status',
          filter: `bus_id=eq.${studentData.busId}`
        },
        (payload) => {
          console.log('🚌 Driver status changed:', payload);
          if (payload.eventType === 'DELETE') {
            setTripActive(false);
          } else if (payload.new) {
            const newStatus = (payload.new as any).status;
            setTripActive(newStatus === 'on_trip' || newStatus === 'enroute');
          }
        }
      )
      .subscribe();

    return () => {
      console.log('🔌 Unsubscribing from driver_status');
      supabase.removeChannel(channel);
    };
  }, [studentData?.busId]);

  // Show location modal if permission denied
  useEffect(() => {
    if (permissionDenied) {
      setShowLocationModal(true);
    }
  }, [permissionDenied]);

  // Handle raising waiting flag
  const handleRaiseFlag = useCallback(async (stop_name: string) => {
    if (raisingFlag) return;
    if (!currentUser || !studentData?.busId || !studentData?.routeId) return;

    setRaisingFlag(true);

    try {
      const token = await currentUser.getIdToken();

      // Find stop details
      const stop = stops.find(s => s.stop_name === stop_name);
      if (!stop) {
        addToast("Stop not found", "error");
        return;
      }

      // Call API to raise waiting flag
      const response = await fetch('/api/student/waiting-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken: token,
          busId: studentData.busId,
          routeId: studentData.routeId,
          stop_name: stop_name
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setWaiting(true);
        setWaitingFlagId(result.flagId);
        setShowWaitingFlagModal(false);
        addToast(`🚩 Waiting flag raised at ${stop_name}! Driver has been notified.`, "success");
      } else {
        addToast(result.error || "Failed to raise waiting flag", "error");
      }
    } catch (error) {
      console.error('Error raising waiting flag:', error);
      addToast("Network error. Please try again.", "error");
    } finally {
      setRaisingFlag(false);
    }
  }, [currentUser, studentData, stops, addToast]);

  // Remove waiting flag
  const removeWaitingFlag = useCallback(async () => {
    if (!waitingFlagId || !currentUser) return;

    try {
      const token = await currentUser.getIdToken();

      const response = await fetch('/api/student/waiting-flag', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken: token,
          flagId: waitingFlagId
        })
      });

      if (response.ok) {
        setWaiting(false);
        setWaitingFlagId(null);
        addToast("Waiting flag cancelled successfully", "success");
      }
    } catch (error) {
      console.error("Error removing waiting flag:", error);
    }
  }, [waitingFlagId, currentUser, addToast]);

  if (loading) {
    return <PremiumPageLoader message="Loading Bus Details..." subMessage="Fetching bus status and schedule..." />;
  }

  if (!studentData) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Student Data Not Found</CardTitle>
            <CardDescription>
              Please contact support if you believe this is an error.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold dark:text-white">My Bus</h1>
          <p className="text-muted-foreground">
            Track your assigned bus and set waiting flags
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {waiting ? (
            <Button onClick={removeWaitingFlag} variant="destructive">
              <XCircle className="mr-2 h-4 w-4" />
              Cancel Waiting
            </Button>
          ) : (
            <Button onClick={() => setShowWaitingFlagModal(true)} variant="default" disabled={!studentData?.busId || !selectedStop || !tripActive}>
              <Navigation className="mr-2 h-4 w-4" />
              I'm Waiting
            </Button>
          )}
        </div>
      </div>

      {/* Student and Bus Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Student Information</CardTitle>
            <CardDescription>
              Your profile details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="bg-blue-100 p-2 rounded-full">
                <User className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{studentData.fullName || "Unknown Student"}</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <div className="bg-green-100 p-2 rounded-full">
                <Bus className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Assigned Bus</p>
                <p className="font-medium">{studentData.busId || "Not Assigned"}</p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <div className="bg-purple-100 p-2 rounded-full">
                <MapPin className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Assigned Route</p>
                <p className="font-medium">{studentData.routeId || "Not Assigned"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bus Information</CardTitle>
            <CardDescription>
              Details of your assigned bus
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {busData ? (
              <>
                <div className="flex items-center space-x-2">
                  <div className="bg-orange-100 p-2 rounded-full">
                    <Bus className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Bus Number</p>
                    <p className="font-medium">{busData.busNumber || "N/A"}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="bg-yellow-100 p-2 rounded-full">
                    <Users className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Current Passengers</p>
                    <p className="font-medium">{busData.currentMembers || 0} passengers</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <div className={`p-2 rounded-full ${busData.status === 'active' || busData.status === 'enroute'
                      ? 'bg-green-100 dark:bg-green-900/30'
                      : 'bg-gray-100 dark:bg-gray-800'
                    }`}>
                    <CheckCircle className={`h-5 w-5 ${busData.status === 'active' || busData.status === 'enroute'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-600 dark:text-gray-400'
                      }`} />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge variant={busData.status === 'active' || busData.status === 'enroute' ? 'default' : 'secondary'}>
                      {busData.status === 'enroute' ? 'On Trip' : busData.status || "Unknown"}
                    </Badge>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">No bus assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Waiting Flag Section - Only show when trip is active */}
      {tripActive && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting Flag</CardTitle>
            <CardDescription>
              Let the driver know you're waiting at a stop
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center space-x-2">
                <Flag className={`h-5 w-5 ${waiting ? "text-blue-500" : "text-gray-400"}`} />
                <span className="font-medium">
                  {waiting ? "You're Waiting" : "You're Not Waiting"}
                </span>
                <Badge variant={waiting ? "default" : "secondary"}>
                  {waiting ? "Active" : "Inactive"}
                </Badge>
              </div>

              {waiting && (
                <div className="flex items-center space-x-2">
                  <span className="flex h-3 w-3">
                    <span className="animate-ping absolute h-3 w-3 rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative h-3 w-3 rounded-full bg-green-500 dark:bg-green-400"></span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Driver notified
                  </span>
                </div>
              )}
            </div>

            <div className="pt-4">
              <Button
                onClick={waiting ? removeWaitingFlag : () => setShowWaitingFlagModal(true)}
                className="w-full md:w-auto cursor-pointer py-6 text-base font-semibold shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-[1.02]"
                size="lg"
                disabled={!studentData?.busId || !stops.length || !tripActive || raisingFlag}
                variant={waiting ? "destructive" : "default"}
              >
                {raisingFlag ? (
                  <>
                    <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
                    Raising Waiting Flag.. Please wait
                  </>
                ) : waiting ? (
                  <>
                    <XCircle className="mr-3 h-5 w-5" />
                    Cancel Waiting Flag
                  </>
                ) : (
                  <>
                    <Flag className="mr-3 h-5 w-5" />
                    🚩 Raise Waiting Flag
                  </>
                )}
              </Button>
            </div>

            <div className="text-sm text-muted-foreground pt-2">
              <p>
                {waiting
                  ? "Your waiting flag is visible to the bus driver. They will pick you up at your stop."
                  : "Raise your flag when you're ready at a bus stop. The driver will be notified instantly."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!tripActive && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-3 text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              <div className="text-center">
                <p className="font-medium">Waiting Flag Unavailable</p>
                <p className="text-sm">Waiting flags can only be raised when the driver has started the journey.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Map - Shows after Waiting Status */}
      {studentData?.busId && (
        <Card>
          <CardHeader>
            <CardTitle>Live Map</CardTitle>
            <CardDescription>
              Track your bus location in real-time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DynamicStudentMap
              busId={studentData.busId || studentData.busId}
              routeId={studentData.routeId}
              journeyActive={tripActive}
              studentLocation={position ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy } : undefined}
              onWaitingFlagCreate={(flagId) => {
                setWaitingFlagId(flagId);
                setWaiting(true);
                addToast('Waiting flag created successfully!', 'success');
              }}
              onWaitingFlagRemove={(flagId) => {
                setWaitingFlagId(null);
                setWaiting(false);
                addToast('Waiting flag removed', 'info');
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Notification Permission Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>
            Get notified when your bus starts its journey
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fcmToken ? (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span>Notifications enabled</span>
            </div>
          ) : fcmError ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-red-600">
                <XCircle className="h-5 w-5" />
                <span>Notifications disabled</span>
              </div>
              <p className="text-sm text-muted-foreground">{fcmError}</p>
              <Button onClick={requestPermission} disabled={fcmLoading} size="sm">
                {fcmLoading ? "Requesting..." : "Enable Notifications"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-yellow-600">
                <AlertCircle className="h-5 w-5" />
                <span>Notifications not enabled</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Enable notifications to get alerts when your bus starts its journey.
              </p>
              <Button onClick={requestPermission} disabled={fcmLoading} size="sm">
                {fcmLoading ? "Requesting..." : "Enable Notifications"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Waiting Flag Modal */}
      <WaitingFlagModal
        isOpen={showWaitingFlagModal}
        onClose={() => setShowWaitingFlagModal(false)}
        onConfirm={handleRaiseFlag}
        stops={stops}
        loading={raisingFlag}
      />

      {/* Location Permission Modal */}
      <LocationPermissionModal
        isOpen={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onRetry={retryTracking}
        errorMessage={locationError?.userFriendlyMessage}
      />
    </div>
    </ErrorBoundary>
  );
}

/**
 * Phase 3 — entitlement decided before the live bus page (and its Supabase
 * driver_status / waiting_flags subscriptions) mounts. Ineligible students see
 * the lifecycle/renewal screen and open no transport subscriptions.
 */
export default function StudentBusPage() {
  return (
    <TransportEntitlementGuard>
      <StudentBusLive />
    </TransportEntitlementGuard>
  );
}
