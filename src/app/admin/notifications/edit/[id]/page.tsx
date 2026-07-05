"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { Info } from "lucide-react";
import { getAllRoutes } from "@/lib/dataService";
import { Route } from "@/lib/types";
import { useToast } from "@/contexts/toast-context";
import { PremiumPageLoader } from "@/components/LoadingSpinner";

export default function EditNotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  // Unwrap the params promise using React's use function
  const { id } = use(params);
  const [notification, setNotification] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState("Information");
  const [audience, setAudience] = useState("ALL");
  const [status, setStatus] = useState("Draft");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [specificRoute, setSpecificRoute] = useState("");
  const [specificBus, setSpecificBus] = useState("");
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);

  // Fetch routes for the audience dropdown
  useEffect(() => {
    const fetchRoutes = async () => {
      try {
        const routesData = await getAllRoutes();
        setRoutes(routesData);
      } catch (error) {
        console.error('Error fetching routes:', error);
        addToast('Failed to load routes', 'error');
      }
    };

    fetchRoutes();
  }, [addToast]);

  useEffect(() => {
    // Fetch the notification data
    const fetchNotification = async () => {
      try {
        const response = await fetch(`/api/notifications/${id}`);
        if (response.ok) {
          const foundNotification = await response.json();
          if (foundNotification) {
            setNotification(foundNotification);
            setTitle(foundNotification.title);
            setMessage(foundNotification.message || foundNotification.title);
            setType(foundNotification.type);
            setAudience(foundNotification.audience);
            setStatus(foundNotification.status);
            
            // Set specific route or bus if applicable
            if (foundNotification.audience.startsWith("Route")) {
              setSpecificRoute(foundNotification.audience);
            } else if (foundNotification.audience.startsWith("Bus")) {
              setSpecificBus(foundNotification.audience);
            }
          }
        } else {
          addToast('Failed to load notification data', 'error');
        }
      } catch (error) {
        console.error('Error fetching notification:', error);
        addToast('Failed to load notification data', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchNotification();
  }, [id, addToast]);

  // Format route display text - Show first, fourth, second-last, and last stops
  const formatRouteDisplay = (route: Route) => {
    if (!route.stops || route.stops.length === 0) return `${route.routeName} (No stops)`;
    if (route.stops.length <= 4) {
      return `${route.routeName} → ${route.stops.map((stop: any) => stop.name || stop).join(', ')}`;
    }
    
    // Get first, fourth, second-last, and last stops
    const first = route.stops[0];
    const fourth = route.stops[3];
    const secondLast = route.stops[route.stops.length - 2];
    const last = route.stops[route.stops.length - 1];
    
    return `${route.routeName} → ${first.name || first}, ${fourth.name || fourth}, ${secondLast.name || secondLast}, ${last.name || last}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!title.trim()) {
      addToast("Title is required", 'error');
      return;
    }

    if (title.length > 100) {
      addToast("Title must be 100 characters or less", 'error');
      return;
    }

    if (!message.trim()) {
      addToast("Message is required", 'error');
      return;
    }

    if (message.length > 500) {
      addToast("Message must be 500 characters or less", 'error');
      return;
    }

    if (!type) {
      addToast("Type is required", 'error');
      return;
    }

    if (!audience) {
      addToast("Audience is required", 'error');
      return;
    }

    if (!status) {
      addToast("Status is required", 'error');
      return;
    }
    
    try {
      // Determine the final audience value
      let finalAudience = audience;
      if (audience === "Specific Route" && specificRoute) {
        finalAudience = specificRoute;
      } else if (audience === "Specific Bus" && specificBus) {
        finalAudience = specificBus;
      }
      
      // Update the notification
      const response = await fetch(`/api/notifications/${id}/update`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          message,
          type,
          audience: finalAudience,
          status
        }),
      });
      
      if (response.ok) {
        console.log("Updating notification:", { 
          id,
          title, 
          message,
          type, 
          audience: finalAudience,
          status
        });
        
        // Show success message
        addToast("Notification updated successfully!", 'success');
        
        // Redirect back to notifications page
        setTimeout(() => {
          router.push("/admin/notifications");
        }, 2000);
      } else {
        throw new Error("Failed to update notification");
      }
    } catch (error) {
      console.error("Error updating notification:", error);
      addToast("Failed to update notification", 'error');
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading notification details..." subMessage="Preparing editing tools..." />;
  }

  if (!notification) {
    return (
      <div className="mt-15 min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Notification not found</h1>
          <Link href="/admin/notifications" className="text-blue-500 hover:text-blue-700 mt-4 inline-block">
            ← Back to Notifications
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Notification</h1>
          <Link 
            href="/admin/notifications" 
            className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Back to Notifications
          </Link>
        </div>
      </div>

      {/* Main Content - Removed Card container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Edit Notification</h2>
            <p className="text-gray-600 dark:text-gray-400">
              Update notification details
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-sm font-medium">Title</Label>
              <Input
                id="title"
                placeholder="Enter notification title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message" className="text-sm font-medium">Message</Label>
              <Textarea
                id="message"
                placeholder="Enter notification message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="type" className="text-sm font-medium">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start">
                    <SelectItem value="Information">Information</SelectItem>
                    <SelectItem value="Alert">Alert</SelectItem>
                    <SelectItem value="Emergency">Emergency</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="audience" className="text-sm font-medium">Audience</Label>
                <Select value={audience} onValueChange={setAudience}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select audience" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start">
                    <SelectItem value="ALL">ALL</SelectItem>
                    <SelectItem value="Specific Route">Specific Route</SelectItem>
                    <SelectItem value="Specific Bus">Specific Bus</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {audience === "Specific Route" && (
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="specificRoute" className="text-sm font-medium">Select Route</Label>
                  <div className="relative">
                    <Select value={specificRoute} onValueChange={setSpecificRoute}>
                      <SelectTrigger className="w-full md:w-[400px] pr-10">
                        <SelectValue placeholder="Select a route" />
                      </SelectTrigger>
                      <SelectContent position="popper" side="bottom" align="start">
                        {routes.map((routeOption) => (
                          <SelectItem key={routeOption.routeId} value={routeOption.routeName}>
                            {formatRouteDisplay(routeOption)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Info 
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 cursor-help"
                      onMouseEnter={() => {
                        const selectedRoute = routes.find(r => r.routeName === specificRoute);
                        if (selectedRoute) setHoveredRoute(selectedRoute.routeId);
                      }}
                      onMouseLeave={() => {
                        // Add a small delay to allow moving to the tooltip
                        setTimeout(() => {
                          setHoveredRoute(null);
                        }, 600);
                      }}
                    />
                    {hoveredRoute && (
                      <div 
                        className="absolute z-10 mt-1 w-64 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg right-0"
                        onMouseEnter={() => {
                          const selectedRoute = routes.find(r => r.routeName === specificRoute);
                          if (selectedRoute) setHoveredRoute(selectedRoute.routeId);
                        }}
                        onMouseLeave={() => setHoveredRoute(null)}
                      >
                        <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                          {routes.find(r => r.routeId === hoveredRoute)?.routeName} Stops:
                        </h4>
                        <ul className="text-sm text-gray-600 dark:text-gray-300 max-h-40 overflow-y-auto">
                          {routes.find(r => r.routeId === hoveredRoute)?.stops.map((stop: any, index: number) => (
                            <li key={index} className="py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
                              {index + 1}. {stop.name || stop}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {audience === "Specific Bus" && (
                <div className="space-y-2">
                  <Label htmlFor="specificBus" className="text-sm font-medium">Bus Number</Label>
                  <Input
                    id="specificBus"
                    placeholder="Enter bus number"
                    value={specificBus}
                    onChange={(e) => setSpecificBus(e.target.value)}
                  />
                </div>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="status" className="text-sm font-medium">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start">
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Sent">Sent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3">
              <Link href="/admin/notifications">
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" className="cursor-pointer">
                Update Notification
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}