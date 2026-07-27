"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { useAuth } from '@/contexts/auth-context';
import { useToast } from "@/contexts/toast-context";
import AllStopsData from "@/data/All_stops.json";
import { signalCollectionRefresh } from "@/hooks/useEventDrivenRefresh";
import { getAllRoutes } from "@/lib/dataService";
import { ArrowDown,GripVertical,MapPin,Plus,RotateCcw,X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useRef,useState } from "react";

// Stop type definition
type Stop = {
  name: string;
  sequence: number;
  stop_name: string;
};

// Route form data type
type RouteFormData = {
  routeId: string;
  routeName: string;
  status: string;
};

import { PermissionDeniedCard } from "@/components/PermissionDeniedCard";
import { useModeratorPermissions } from "@/hooks/useModeratorPermissions";

export default function AddRoutePage() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { canRouteAdd, loading: permsLoading } = useModeratorPermissions();
  const router = useRouter();
  const { addToast } = useToast();

  const [routeData, setRouteData] = useState<RouteFormData>({
    routeId: "",
    routeName: "",
    status: "active"
  });

  const [stops, setStops] = useState<Stop[]>([]);
  const [currentStopInput, setCurrentStopInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const suggestionRef = useRef<HTMLDivElement>(null);
  const [defaultRouteId, setDefaultRouteId] = useState("");

  // Check authentication
  useEffect(() => {
    if (!authLoading && (!currentUser || !userData || userData.role !== 'moderator')) {
      router.push('/login');
      return;
    }

    // Fetch routes to determine next ID
    const fetchData = async () => {
      try {
        const routes = await getAllRoutes();
        const nextNum = routes.length + 1;
        // Display only number
        const displayId = nextNum.toString();
        setRouteData(prev => ({ ...prev, routeId: displayId, routeName: `Route-${displayId}` }));
        setDefaultRouteId(displayId);
      } catch (e) {
        console.error(e);
      }
    };

    if (currentUser) {
      fetchData();
    }
  }, [authLoading, currentUser, userData, router]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter suggestions based on input
  useEffect(() => {
    if (currentStopInput.length > 0) {
      const filtered = AllStopsData.bus_stops.filter(stop =>
        stop.toLowerCase().includes(currentStopInput.toLowerCase()) &&
        !stops.some(s => s.name === stop)
      );
      setFilteredSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setFilteredSuggestions([]);
      setShowSuggestions(false);
    }
  }, [currentStopInput, stops]);

  // Generate stop_name from stop name
  const generateStopId = (stop_name: string): string => {
    return stop_name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  };

  // Add stop to the list
  const addStop = (stop_name: string) => {
    if (!stop_name.trim()) return;

    const newStop: Stop = {
      name: stop_name,
      sequence: stops.length + 1,
      stop_name: generateStopId(stop_name)
    };

    setStops([...stops, newStop]);
    setCurrentStopInput("");
    setShowSuggestions(false);
  };

  // Remove stop from list
  const removeStop = (index: number) => {
    const newStops = stops.filter((_, i) => i !== index);
    // Recalculate sequence numbers
    const updatedStops = newStops.map((stop, i) => ({
      ...stop,
      sequence: i + 1
    }));
    setStops(updatedStops);
  };

  // Move stop up
  const moveStopUp = (index: number) => {
    if (index === 0) return;
    const newStops = [...stops];
    [newStops[index - 1], newStops[index]] = [newStops[index], newStops[index - 1]];
    // Recalculate sequence numbers
    const updatedStops = newStops.map((stop, i) => ({
      ...stop,
      sequence: i + 1
    }));
    setStops(updatedStops);
  };

  // Move stop down
  const moveStopDown = (index: number) => {
    if (index === stops.length - 1) return;
    const newStops = [...stops];
    [newStops[index], newStops[index + 1]] = [newStops[index + 1], newStops[index]];
    // Recalculate sequence numbers
    const updatedStops = newStops.map((stop, i) => ({
      ...stop,
      sequence: i + 1
    }));
    setStops(updatedStops);
  };

  const handleRestoreRouteId = () => {
    setRouteData(prev => ({ ...prev, routeId: defaultRouteId, routeName: `Route-${defaultRouteId}` }));
  };

  // Validate form
  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!routeData.routeName.trim()) {
      newErrors.routeName = "Route name is required";
    }

    if (stops.length < 2) {
      newErrors.stops = "At least 2 stops are required for a route";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      addToast('Please fix the errors in the form', 'error');
      return;
    }

    if (!currentUser) {
      addToast('You must be logged in to create a route', 'error');
      return;
    }

    setLoading(true);

    try {
      const idToken = await currentUser.getIdToken();

      const response = await fetch('/api/routes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          routeId: routeData.routeId.match(/^\d+$/) ? `route_${routeData.routeId}` : routeData.routeId,
          routeName: routeData.routeName,
          stops: stops,
          status: routeData.status
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create route');
      }

      addToast("Route created successfully!", 'success');
      signalCollectionRefresh('routes');

      setTimeout(() => {
        router.push("/moderator/routes");
      }, 2000);
    } catch (error) {
      console.error("Error creating route:", error);
      addToast(error instanceof Error ? error.message : "Failed to create route", 'error');
    } finally {
      setLoading(false);
    }
  };

  // Handle reset
  const handleReset = () => {
    setRouteData({
      routeId: "",
      routeName: "",
      status: "active"
    });
    setStops([]);
    setCurrentStopInput("");
    setErrors({});
    addToast('Form reset successfully', 'info');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!currentUser || !userData || userData.role !== 'moderator') {
    return null;
  }

  if (!permsLoading && !canRouteAdd) {
    return <PermissionDeniedCard title="Adding Route Restricted" actionName="Adding Routes" />;
  }

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen">
      {/* Header */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Add Route</h1>
            <p className="text-gray-400 text-xs">Create a new bus route with stops</p>
          </div>
          <Link
            href="/moderator/routes"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg backdrop-blur-sm"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] backdrop-blur-sm rounded-2xl shadow-2xl border border-white/10 p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-1">
                <Label htmlFor="routeId" className="block text-sm font-semibold text-gray-200 mb-2">
                  Route ID *
                </Label>
                <div className="relative">
                  <Input
                    id="routeId"
                    placeholder="e.g., 15"
                    value={routeData.routeId || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setRouteData(prev => {
                        const newData = { ...prev, routeId: value };
                        // Auto-fill Route Name
                        const numericPart = value.replace(/[^0-9]/g, '');
                        if (numericPart) {
                          newData.routeName = `Route-${numericPart}`;
                        } else if (!value) {
                          newData.routeName = "";
                        }
                        return newData;
                      });
                    }}
                    required
                    className="bg-white dark:bg-gray-800 border-2 border-gray-600 focus:border-purple-400 rounded-lg pr-10"
                  />
                  {routeData.routeId !== defaultRouteId && (
                    <button
                      type="button"
                      onClick={handleRestoreRouteId}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                      title="Restore Default ID"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="md:col-span-1">
                <Label htmlFor="routeName" className="block text-sm font-semibold text-gray-200 mb-2">
                  Route Name *
                </Label>
                <Input
                  id="routeName"
                  placeholder="e.g., Route-1"
                  value={routeData.routeName}
                  onChange={(e) => setRouteData(prev => ({ ...prev, routeName: e.target.value }))}
                  required
                  className="bg-white dark:bg-gray-800 border-2 border-gray-600 focus:border-purple-400 rounded-lg"
                />
                {errors.routeName && <p className="text-red-400 text-sm mt-1">{errors.routeName}</p>}
              </div>



              <div className="md:col-span-1">
                <Label htmlFor="status" className="block text-sm font-semibold text-gray-200 mb-2">
                  Status *
                </Label>
                <Select value={routeData.status} onValueChange={(value) => setRouteData(prev => ({ ...prev, status: value }))} required>
                  <SelectTrigger className="bg-white dark:bg-gray-800 border-2 border-gray-600 focus:border-purple-400 rounded-lg cursor-pointer">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                {errors.status && <p className="text-red-400 text-sm mt-1">{errors.status}</p>}
              </div>
            </div>

            {/* Stops Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-lg font-semibold text-gray-200">
                  <MapPin className="inline h-5 w-5 mr-2" />
                  Route Stops ({stops.length})
                </Label>
              </div>

              {/* Add Stop Input with Autocomplete */}
              <div className="relative" ref={suggestionRef}>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      placeholder="Type stop name (e.g., Ganeshguri, Panikhaiti)..."
                      value={currentStopInput}
                      onChange={(e) => setCurrentStopInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (currentStopInput.trim()) {
                            addStop(currentStopInput);
                          }
                        }
                      }}
                      className="bg-white dark:bg-gray-800 border-2 border-gray-600 focus:border-blue-400 rounded-lg"
                    />

                    {/* Autocomplete Suggestions */}
                    {showSuggestions && filteredSuggestions.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-gray-800 border-2 border-gray-600 rounded-lg shadow-2xl max-h-64 overflow-y-auto">
                        {filteredSuggestions.map((stop, index) => (
                          <div
                            key={index}
                            className="px-4 py-3 hover:bg-gray-700 cursor-pointer flex items-center transition-colors border-b border-gray-700 last:border-0"
                            onClick={() => addStop(stop)}
                          >
                            <MapPin className="h-4 w-4 mr-2 text-blue-400" />
                            <span className="text-gray-200">{stop}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    type="button"
                    onClick={() => {
                      if (currentStopInput.trim()) {
                        addStop(currentStopInput);
                      }
                    }}
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Stop
                  </Button>
                </div>
                {errors.stops && <p className="text-red-400 text-sm mt-1">{errors.stops}</p>}
              </div>

              {/* Selected Stops List */}
              {stops.length > 0 && (
                <div className="bg-gray-800/50 rounded-lg p-4 space-y-2 max-h-96 overflow-y-auto">
                  {stops.map((stop, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 bg-gray-700/50 p-3 rounded-lg hover:bg-gray-700 transition-colors group"
                    >
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveStopUp(index)}
                          disabled={index === 0}
                          className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown className="h-3 w-3 rotate-180" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStopDown(index)}
                          disabled={index === stops.length - 1}
                          className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 text-gray-400">
                        <GripVertical className="h-4 w-4" />
                        <span className="font-mono text-sm">{stop.sequence}</span>
                      </div>

                      <MapPin className="h-4 w-4 text-blue-400 flex-shrink-0" />

                      <div className="flex-1">
                        <p className="text-gray-200 font-medium">{stop.name}</p>
                        <p className="text-xs text-gray-500">ID: {stop.stop_name}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeStop(index)}
                        className="text-gray-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {stops.length === 0 && (
                <div className="text-center py-12 bg-gray-800/30 rounded-lg border-2 border-dashed border-gray-600">
                  <MapPin className="h-12 w-12 mx-auto text-gray-600 mb-3" />
                  <p className="text-gray-400">No stops added yet</p>
                  <p className="text-sm text-gray-500 mt-1">Start typing to add stops to your route</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 pt-6 border-t border-gray-700">
              <Button
                type="button"
                onClick={handleReset}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Reset
              </Button>
              <Link href="/moderator/routes">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {loading ? "Creating..." : "Create Route"}
              </Button>
            </div>
          </form>
        </div>
      </div >
    </div >
  );
}
