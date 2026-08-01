"use client";

import ErrorBoundary from "@/components/ErrorBoundary";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import LocationPermissionModal from "@/components/LocationPermissionModal";
import TransportEntitlementGuard from "@/components/transport/TransportEntitlementGuard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import WaitingFlagModal from "@/components/WaitingFlagModal";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/contexts/toast-context";
import { useFCMToken } from "@/hooks/useFCMToken";
import { useGeolocation } from "@/hooks/useGeolocation";
import { authApiFetch } from "@/lib/secure-api-client";
import { supabase } from "@/lib/supabase-client";
import {
	AlertCircle,
	Bell,
	Bus,
	CheckCircle,
	Flag,
	MapPin,
	Navigation,
	User,
	Users,
	XCircle
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback,useEffect,useState } from "react";

const DynamicStudentMap = dynamic(() => import('@/components/DynamicStudentMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[450px] md:h-[calc(100vh-20rem)] md:min-h-[600px] bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-900 dark:to-gray-800 rounded-3xl animate-pulse flex items-center justify-center">
      <div className="text-center space-y-2">
        <Bus className="h-8 w-8 mx-auto text-blue-500 animate-bounce" />
        <p className="text-xs text-gray-500 font-medium">Loading live map...</p>
      </div>
    </div>
  )
});

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

  // Fetch student data and related information in parallel
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser?.uid) {
        setLoading(false);
        return;
      }

      try {
        const dashRes = await authApiFetch(currentUser, '/api/student/dashboard-data');

        if (dashRes.ok) {
          const result = await dashRes.json();
          if (result.student) setStudentData(result.student);
          if (result.bus) setBusData(result.bus);
          if (result.route) {
            setRouteData(result.route);
            setStops(result.route.stops || []);
            if (result.route.stops && result.route.stops.length > 0) {
              setSelectedStop(result.route.stops[0].stop_name);
            }
          }
          setTripActive(!!result.tripActive);
          if (result.activeWaitingFlag) {
            setWaiting(true);
            setWaitingFlagId(result.activeWaitingFlag.id);
          }
        }
      } catch (error) {
        console.error("Error fetching student bus page data:", error);
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

  // ponytail: trip-status-{busId} subscription owned by DynamicStudentMap
  // to avoid duplicate WS connections. The page receives trip state via the
  // onWaitingFlagCreate/onWaitingFlagRemove callbacks.

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
              busId={studentData.busId || studentData.bus_id}
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
              onTripStateChange={(active) => setTripActive(active)}
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
 * active_trips / waiting_flags subscriptions) mounts. Ineligible students see
 * the lifecycle/renewal screen and open no transport subscriptions.
 */
export default function StudentBusPage() {
  return (
    <TransportEntitlementGuard>
      <StudentBusLive />
    </TransportEntitlementGuard>
  );
}
