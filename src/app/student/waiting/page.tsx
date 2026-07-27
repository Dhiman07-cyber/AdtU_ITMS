"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Flag,
  Clock,
  MapPin,
  CheckCircle,
  AlertCircle
} from "lucide-react";
import { getStudentByUid, getBusById, getRouteById, getBusesByRouteId } from "@/lib/dataService";
import dynamic from "next/dynamic";

// Dynamic import for live-location map (student)
const BusMap = dynamic(() => import("@/components/maps/LiveTrackingBusMap"), { ssr: false });
import { PremiumPageLoader } from "@/components/LoadingSpinner";

export default function StudentWaitingPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const [waitingFlag, setWaitingFlagState] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [studentData, setStudentData] = useState<any>(null);
  const [busData, setBusData] = useState<any>(null);
  const [routeData, setRouteData] = useState<any>(null);
  const [error, setError] = useState("");
  const [waitingFlagId, setWaitingFlagId] = useState<string | null>(null);

  // Fetch student data and current waiting flag status
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser?.uid) return;

      try {
        // Fetch student data
        const student = await getStudentByUid(currentUser.uid);
        if (student) {
          setStudentData(student);
          console.log('Student data fetched in waiting page:', student);

          // Fetch route data first
          const routeId = student.routeId || student.routeId;
          if (routeId) {
            console.log('Fetching route data for routeId:', routeId);
            const route = await getRouteById(routeId);
            if (route) {
              setRouteData(route);
              console.log('Route data fetched:', route);

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
        }
      } catch (error: any) {
        console.error("Error fetching data:", error);
        setError("Failed to load data: " + error.message);
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

  const toggleWaitingFlag = async () => {
    if (!currentUser || !studentData) return;

    setLoading(true);
    const newStatus = !waitingFlag;

    try {
      if (newStatus) {
        // Get current location first
        let position = null;
        if (navigator.geolocation) {
          position = await new Promise<GeolocationPosition | null>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve(pos),
              (error) => {
                console.error('Error getting location:', error);
                // Don't fail completely if location is not available
                resolve(null);
              }
            );
          });
        }

        // Set waiting flag through backend API
        const token = await currentUser.getIdToken();

        const response = await fetch('/api/student/waiting-flag', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            busId: studentData.busId || "",
            routeId: studentData.routeId || "",
            stop_name: routeData?.stops?.[0]?.name || "Unknown Stop",
            lat: position?.coords.latitude || null,
            lng: position?.coords.longitude || null
          }),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          setWaitingFlagState(true);
          setWaitingFlagId(result.flagId);
          const updateTime = new Date().toLocaleTimeString();
          setLastUpdated(updateTime);
        } else {
          throw new Error(result.error || "Failed to create waiting flag");
        }
      } else {
        // Remove waiting flag through backend API using student UID
        const token = await currentUser.getIdToken();
        const response = await fetch(`/api/student/waiting-flag?idToken=${token}`, {
          method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
          setWaitingFlagState(false);
          setWaitingFlagId(null);
          setLastUpdated(null);
        } else {
          throw new Error(result.error || "Failed to remove waiting flag");
        }
      }
    } catch (error: any) {
      console.error("Error toggling waiting flag:", error);
      setError("Failed to update waiting flag: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading Waiting Status..." subMessage="Fetching flag information..." />;
  }

  if (error) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Waiting Flag</CardTitle>
            <CardDescription>Error loading data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2 text-red-500">
              <AlertCircle className="h-5 w-5" />
              <p>{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!studentData) {
    return (
      <div className="flex-1 min-h-[calc(100dvh-120px)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Waiting Flag</CardTitle>
            <CardDescription>Student data not found</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-center text-muted-foreground">
              Student data not found. Please contact your administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold dark:text-white">Waiting Flag</h1>
        <p className="text-muted-foreground">
          Set your waiting status for the bus pickup
        </p>
      </div>

      {/* Waiting Flag Status */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>Waiting Status</CardTitle>
              <CardDescription>
                Indicate when you're waiting at the bus stop
              </CardDescription>
            </div>
            <Badge
              variant={waitingFlag ? "default" : "secondary"}
              className="text-lg py-1 px-3"
            >
              {waitingFlag ? "Waiting" : "Not Waiting"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 space-y-6">
            <div className={`p-6 rounded-full ${waitingFlag ? "bg-blue-100 dark:bg-blue-900/30" : "bg-muted"
              }`}>
              <Flag className={`h-16 w-16 ${waitingFlag ? "text-blue-600 dark:text-blue-400" : "text-gray-400"
                }`} />
            </div>

            <div className="text-center">
              <h3 className="text-xl font-semibold">
                {waitingFlag ? "You're Waiting" : "You're Not Waiting"}
              </h3>
              <p className="text-muted-foreground mt-2">
                {waitingFlag
                  ? "The driver has been notified that you're waiting at the bus stop."
                  : "Set your waiting flag when you arrive at the bus stop."}
              </p>
            </div>

            <Button
              size="lg"
              className="w-full md:w-auto"
              onClick={toggleWaitingFlag}
              disabled={loading}
            >
              {loading ? (
                "Updating..."
              ) : waitingFlag ? (
                <>
                  <CheckCircle className="mr-2 h-5 w-5" />
                  Mark as Not Waiting
                </>
              ) : (
                <>
                  <Flag className="mr-2 h-5 w-5" />
                  Mark as Waiting
                </>
              )}
            </Button>

            {lastUpdated && (
              <p className="text-sm text-muted-foreground">
                Last updated: {lastUpdated}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Live Map */}
      {studentData.routeId && (
        <Card>
          <CardHeader>
            <CardTitle>Live Tracking</CardTitle>
            <CardDescription>
              Real-time location of your bus
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BusMap
              busId={studentData.busId || studentData.busId}
              busNumber={busData?.busNumber}
              journeyActive={true}
            />
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
          <CardDescription>
            Understanding the waiting flag system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start space-x-3">
            <div className="mt-1 bg-blue-100 p-2 rounded-full">
              <Flag className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="font-medium">Set Your Flag</p>
              <p className="text-sm text-muted-foreground">
                When you arrive at your designated bus stop, set your waiting flag to "Waiting".
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="mt-1 bg-green-100 p-2 rounded-full">
              <CheckCircle className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="font-medium">Driver Notification</p>
              <p className="text-sm text-muted-foreground">
                The driver will be notified in real-time that you're waiting and will pick you up.
              </p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="mt-1 bg-orange-100 p-2 rounded-full">
              <AlertCircle className="h-4 w-4 text-orange-600" />
            </div>
            <div>
              <p className="font-medium">Reset After Pickup</p>
              <p className="text-sm text-muted-foreground">
                Your waiting flag will automatically reset after the driver marks you as picked up.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Location Information */}
      <Card>
        <CardHeader>
          <CardTitle>Your Bus Stop</CardTitle>
          <CardDescription>
            Information about your designated pickup location
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-3">
            <div className="bg-blue-100 p-3 rounded-full">
              <MapPin className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="font-medium">
                {routeData?.stops?.[0]?.name || "Not assigned"}
              </p>
              <p className="text-sm text-muted-foreground">
                Your designated pickup location for {routeData?.routeName || "your route"}
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center space-x-3">
            <div className="bg-gray-100 p-3 rounded-full">
              <Clock className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <p className="font-medium">Scheduled Pickup Time</p>
              <p className="text-sm text-muted-foreground">
                {routeData?.stops?.[0]?.time || "Not scheduled"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
