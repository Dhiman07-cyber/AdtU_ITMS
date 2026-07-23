"use client";

import { useState, useEffect, useRef, use } from "react";
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { useToast } from "@/contexts/toast-context";
import { Plus, X, MapPin, GripVertical } from "lucide-react";
import AllStopsData from "@/data/All_stops.json";
import { getRouteById } from "@/lib/dataService";
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';

type Stop = {
  name: string;
  sequence: number;
  stop_name: string;
};

type RouteFormData = {
  routeId: string;
  routeName: string;
  status: string;
};

export default function EditRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();
  const { id } = use(params);

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
  const [fetchingRoute, setFetchingRoute] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const suggestionRef = useRef<HTMLDivElement>(null);

  // Drag State
  const [draggedStopIndex, setDraggedStopIndex] = useState<number | null>(null);

  const fetchRouteData = async () => {
    try {
      setFetchingRoute(true);
      const foundRoute = await getRouteById(id);
      if (foundRoute) {
        let displayId = foundRoute.routeId || id;
        if (displayId.startsWith('route_')) displayId = displayId.replace('route_', '');

        setRouteData({
          routeId: displayId,
          routeName: foundRoute.routeName || "",
          status: foundRoute.status || "active"
        });

        if (foundRoute.stops && Array.isArray(foundRoute.stops)) {
          const convertedStops: Stop[] = foundRoute.stops.map((stop: any, index: number) => ({
            name: typeof stop === 'string' ? stop : stop.name || stop.toString(),
            sequence: stop.sequence || index + 1,
            stop_name: stop.stop_name || (typeof stop === 'string' ? stop.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') : `stop_${index}`)
          }));
          setStops(convertedStops);
        }
      } else {
        addToast('Route not found', 'error');
        router.push('/admin/routes');
      }
    } catch (error) {
      console.error('Error fetching route:', error);
      addToast('Failed to load route data', 'error');
    } finally {
      setFetchingRoute(false);
    }
  };

  useEffect(() => {
    if (!authLoading && (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role))) {
      router.push('/login');
      return;
    }

    if (currentUser) fetchRouteData();
  }, [id, authLoading, currentUser, userData, router]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const generateStopId = (stop_name: string): string => {
    return stop_name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  };

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

  const removeStop = (index: number) => {
    const newStops = stops.filter((_, i) => i !== index);
    setStops(newStops.map((stop, i) => ({ ...stop, sequence: i + 1 })));
  };

  // Drag Handlers
  const handleDragStart = (index: number) => {
    setDraggedStopIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedStopIndex === null || draggedStopIndex === index) return;

    // Swap logic
    const newStops = [...stops];
    const draggedItem = newStops[draggedStopIndex];
    newStops.splice(draggedStopIndex, 1);
    newStops.splice(index, 0, draggedItem);

    // Update sequences
    const updatedStops = newStops.map((s, i) => ({ ...s, sequence: i + 1 }));
    setStops(updatedStops);
    setDraggedStopIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedStopIndex(null);
  };

  const handleInputChange = (field: keyof RouteFormData, value: string) => {
    setRouteData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const n = { ...prev };
        delete n[field];
        return n;
      });
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!routeData.routeName.trim()) newErrors.routeName = "Required";
    if (stops.length < 2) newErrors.stops = "At least 2 stops required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast('Please fix the errors in the form', 'error');
      return;
    }
    setLoading(true);

    try {
      const idToken = await currentUser?.getIdToken();
      const response = await fetch(`/api/routes/${id}/update`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          routeName: routeData.routeName,
          stops: stops,
          status: routeData.status
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update route');

      addToast("Route updated successfully!", 'success');

      // Signal the routes list page to refresh when it's rendered
      signalCollectionRefresh('routes');

      router.push("/admin/routes");
    } catch (error: any) {
      console.error(error);
      addToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    if (currentUser) {
      fetchRouteData();
    }
    addToast('Form reset successfully', 'info');
  };

  if (authLoading || fetchingRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#010717]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role)) return null;

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen text-white">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Edit Route</h1>
            <p className="text-gray-400 text-xs">Manage route name, distance and sequence of stops</p>
          </div>
          <Link
            href="/admin/routes"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 overflow-hidden">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-2xl border border-white/10 p-4 sm:p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <Label htmlFor="routeId" className="block text-xs font-medium text-gray-300 mb-1">Route ID</Label>
                <Input
                  id="routeId"
                  value={routeData.routeId}
                  onChange={(e) => handleInputChange('routeId', e.target.value)}
                  className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              <div>
                <Label htmlFor="routeName" className="block text-xs font-medium text-gray-300 mb-1">Route Name <span className="text-red-500">*</span></Label>
                <Input
                  id="routeName"
                  value={routeData.routeName}
                  onChange={(e) => handleInputChange('routeName', e.target.value)}
                  className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                {errors.routeName && <p className="text-red-500 text-[10px] mt-0.5">{errors.routeName}</p>}
              </div>

              <div>
                <Label htmlFor="status" className="block text-xs font-medium text-gray-300 mb-1">Status <span className="text-red-500">*</span></Label>
                <Select value={routeData.status} onValueChange={(val) => handleInputChange('status', val)}>
                  <SelectTrigger className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4 pt-6 border-t border-white/10">
              <Label className="text-lg font-semibold text-white flex items-center mb-4">
                <MapPin className="inline h-5 w-5 mr-2 text-blue-400" />
                Route Stops ({stops.length})
              </Label>

              <div className="relative" ref={suggestionRef}>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      placeholder="Search or type new stop name..."
                      value={currentStopInput}
                      onChange={(e) => setCurrentStopInput(e.target.value)}
                      onKeyPress={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStop(currentStopInput); } }}
                      className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    />
                    {showSuggestions && filteredSuggestions.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-[#1A1B23] border border-white/10 rounded-xl shadow-2xl max-h-60 overflow-y-auto">
                        {filteredSuggestions.map((stop, i) => (
                          <div
                            key={i}
                            className="px-4 py-2.5 hover:bg-white/5 cursor-pointer text-gray-200 text-sm transition-colors border-b border-white/5 last:border-0"
                            onClick={() => addStop(stop)}
                          >
                            {stop}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="button" onClick={() => addStop(currentStopInput)} className="bg-blue-600 hover:bg-blue-700 text-white">
                    <Plus className="h-4 w-4 mr-2" />
                    Add
                  </Button>
                </div>
                {errors.stops && <p className="text-red-500 text-[10px] mt-1">{errors.stops}</p>}
              </div>

              {stops.length > 0 && (
                <div className="bg-white/5 rounded-2xl p-4 space-y-2 max-h-96 overflow-y-auto border border-white/10 custom-scrollbar">
                  {stops.map((stop, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-4 bg-[#1A1B23]/80 p-3 rounded-xl border border-white/5 cursor-grab active:cursor-grabbing transition-all hover:border-white/20 group ${draggedStopIndex === i ? 'opacity-30 scale-95' : 'opacity-100'}`}
                    >
                      <GripVertical className="h-5 w-5 text-gray-600 group-hover:text-gray-400 transition-colors" />
                      <div className="bg-blue-500/20 text-blue-400 font-bold w-8 h-8 flex items-center justify-center rounded-lg text-sm border border-blue-500/20">{stop.sequence}</div>
                      <div className="flex-1">
                        <div className="text-white font-medium text-sm">{stop.name}</div>
                        <div className="text-[10px] text-gray-500 font-mono italic">ID: {stop.stop_name}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStop(i)}
                        className="text-gray-500 hover:text-red-400 p-2 hover:bg-red-500/10 rounded-full transition-all"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <div className="text-[10px] text-gray-500 italic text-center pt-2">Drag stops to reorder sequence</div>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-6 border-t border-white/10">
              <Button
                type="button"
                onClick={handleReset}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[80px]"
              >
                Reset
              </Button>
              <Link href="/admin/routes">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white min-w-[80px]">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 text-white min-w-[140px]"
              >
                {loading ? (
                  <div className="flex items-center space-x-2">
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Updating...</span>
                  </div>
                ) : (
                  "Update Route"
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
