"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Bus, 
  AlertCircle,
  CheckCircle,
  Route
} from "lucide-react";
import { getAllBuses, getAllRoutes, getRouteById } from "@/lib/dataService";
import { PremiumPageLoader } from "@/components/LoadingSpinner";

export default function BusSwapPage() {
  const { currentUser, userData } = useAuth();
  const router = useRouter();
  const [buses, setBuses] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [fromBusId, setFromBusId] = useState("");
  const [toBusId, setToBusId] = useState("");
  const [swapping, setSwapping] = useState(false);

  // Fetch buses and routes data
  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser?.uid) return;
      
      try {
        // Fetch buses and routes
        const [busesData, routesData] = await Promise.all([
          getAllBuses(),
          getAllRoutes()
        ]);
        
        setBuses(busesData);
        setRoutes(routesData);
      } catch (error) {
        console.error("Error fetching data:", error);
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [currentUser]);

  // Redirect if user is not an admin
  useEffect(() => {
    if (userData && userData.role !== "admin") {
      router.push(`/${userData.role}`);
    }
  }, [userData, router]);

  // Filter buses by selected route
  const routeBuses = buses.filter(bus => bus.routeId === selectedRouteId);

  const handleBusSwap = async () => {
    if (!selectedRouteId || !fromBusId || !toBusId || !currentUser) return;
    
    setSwapping(true);
    try {
      // Get Firebase ID token
      const token = await currentUser.getIdToken();
      
      // Perform bus swap via API
      const response = await fetch('/api/admin/swap-bus', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          routeId: selectedRouteId,
          fromBusId,
          toBusId,
          idToken: token
        }),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        // Show success message
        alert("Bus swap completed successfully!");
        // Reset form
        setFromBusId("");
        setToBusId("");
        // Refresh data
        const [busesData, routesData] = await Promise.all([
          getAllBuses(),
          getAllRoutes()
        ]);
        setBuses(busesData);
        setRoutes(routesData);
      } else {
        throw new Error(result.error || "Failed to swap buses");
      }
    } catch (error: any) {
      console.error("Error swapping buses:", error);
      setError(error.message || "Failed to swap buses");
    } finally {
      setSwapping(false);
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading Bus Swap System..." subMessage="Preparing fleet configuration..." />;
  }

  if (error) {
    return (
      <div className="mt-12 min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Bus Swap</CardTitle>
            <CardDescription>Error loading swap information</CardDescription>
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold dark:text-white">Bus Swap Management</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Swap buses for maintenance or operational purposes
        </p>
      </div>

      {/* Route Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Route</CardTitle>
          <CardDescription>
            Choose a route to view available buses for swapping
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {routes.map((route) => (
              <div 
                key={route.routeId} 
                className={`p-4 border rounded-lg cursor-pointer ${
                  selectedRouteId === route.routeId 
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => setSelectedRouteId(route.routeId)}
              >
                <div className="flex items-center space-x-3">
                  <div className="bg-blue-100 p-2 rounded-full">
                    <Route className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">{route.routeName}</p>
                    <p className="text-sm text-muted-foreground">
                      {route.totalStops} stops
                    </p>
                  </div>
                </div>
                {selectedRouteId === route.routeId && (
                  <CheckCircle className="h-5 w-5 text-blue-500 float-right mt-1" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Bus Selection */}
      {selectedRouteId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* From Bus */}
          <Card>
            <CardHeader>
              <CardTitle>Current Bus</CardTitle>
              <CardDescription>
                Select the bus to replace
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {routeBuses.filter(bus => bus.status === 'active').map((bus) => (
                  <div 
                    key={bus.busId} 
                    className={`p-4 border rounded-lg cursor-pointer ${
                      fromBusId === bus.busId 
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                        : "hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                    onClick={() => setFromBusId(bus.busId)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="bg-gray-100 p-2 rounded-full">
                          <Bus className="h-5 w-5 text-gray-600" />
                        </div>
                        <div>
                          <p className="font-medium">{bus.busNumber}</p>
                          <p className="text-sm text-muted-foreground">
                            {bus.model} • {bus.capacity} seats
                          </p>
                        </div>
                      </div>
                      <Badge variant="default">Active</Badge>
                    </div>
                    {fromBusId === bus.busId && (
                      <CheckCircle className="h-5 w-5 text-blue-500 float-right mt-1" />
                    )}
                  </div>
                ))}
                
                {routeBuses.filter(bus => bus.status === 'active').length === 0 && (
                  <p className="text-muted-foreground text-center py-4">
                    No active buses available for this route
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* To Bus */}
          <Card>
            <CardHeader>
              <CardTitle>Replacement Bus</CardTitle>
              <CardDescription>
                Select the bus to replace with
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {buses.filter(bus => bus.routeId !== selectedRouteId && bus.status === 'active').map((bus) => (
                  <div 
                    key={bus.busId} 
                    className={`p-4 border rounded-lg cursor-pointer ${
                      toBusId === bus.busId 
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                        : "hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                    onClick={() => setToBusId(bus.busId)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="bg-gray-100 p-2 rounded-full">
                          <Bus className="h-5 w-5 text-gray-600" />
                        </div>
                        <div>
                          <p className="font-medium">{bus.busNumber}</p>
                          <p className="text-sm text-muted-foreground">
                            {bus.model} • {bus.capacity} seats
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Route: {routes.find(r => r.routeId === bus.routeId)?.routeName || 'N/A'}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary">Available</Badge>
                    </div>
                    {toBusId === bus.busId && (
                      <CheckCircle className="h-5 w-5 text-blue-500 float-right mt-1" />
                    )}
                  </div>
                ))}
                
                {buses.filter(bus => bus.routeId !== selectedRouteId && bus.status === 'active').length === 0 && (
                  <p className="text-muted-foreground text-center py-4">
                    No available buses from other routes
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Swap Confirmation */}
      {selectedRouteId && fromBusId && toBusId && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm Bus Swap</CardTitle>
            <CardDescription>
              Review and confirm the bus swap
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                  <p className="font-medium">From Bus</p>
                  <p className="text-sm text-muted-foreground">
                    {buses.find(b => b.busId === fromBusId)?.busNumber}
                  </p>
                </div>
                <div className="text-center">
                  <Route className="h-6 w-6 mx-auto text-blue-500" />
                  <p className="text-sm text-muted-foreground">
                    {routes.find(r => r.routeId === selectedRouteId)?.routeName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">To Bus</p>
                  <p className="text-sm text-muted-foreground">
                    {buses.find(b => b.busId === toBusId)?.busNumber}
                  </p>
                </div>
              </div>
              
              <Button
                onClick={handleBusSwap}
                disabled={swapping}
                className="w-full"
              >
                {swapping ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Swapping Buses...
                  </>
                ) : (
                  "Confirm Bus Swap"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
