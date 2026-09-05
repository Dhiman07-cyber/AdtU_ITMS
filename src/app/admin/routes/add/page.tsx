"use client";

import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { useAuth } from '@/contexts/auth-context';
import { useToast } from "@/contexts/toast-context";
import AllStopsData from "@/data/All_stops.json";
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';
import { getAllRoutes } from "@/lib/dataService";
import { GripVertical,MapPin,Plus,RotateCcw,X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useRef,useState } from "react";

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

export default function AddRoutePage() {
  const { currentUser, userData, loading: authLoading } = useAuth();
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
  const [dataLoading, setDataLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const suggestionRef = useRef<HTMLDivElement>(null);
  const [defaultRouteId, setDefaultRouteId] = useState("");

  // Drag State
  const [draggedStopIndex, setDraggedStopIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role))) {
      router.push('/login');
      return;
    }

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
      } finally {
        setDataLoading(false);
      }
    };
    fetchData();
  }, [authLoading, currentUser, userData, router]);

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
    // Optimization: Don't reorder constantly, maybe just on Drop? 
    // Or live reorder? Live reorder is smoother "premium" feel.
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

  const handleRestoreRouteId = () => {
    setRouteData(prev => ({ ...prev, routeId: defaultRouteId, routeName: `Route-${defaultRouteId}` }));
  };


  const handleInputChange = (field: keyof RouteFormData, value: string) => {
    setRouteData(prev => {
      const newData = { ...prev, [field]: value };

      // Auto-fill Route Name if Route ID changes
      if (field === 'routeId') {
        const numericPart = value.replace(/[^0-9]/g, '');
        if (numericPart) {
          newData.routeName = `Route-${numericPart}`;
        } else if (!value) {
          newData.routeName = "";
        }
      }

      return newData;
    });

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
    if (!routeData.routeId.trim()) newErrors.routeId = "Required";
    if (!routeData.routeName.trim()) newErrors.routeName = "Required";

    if (stops.length < 2) newErrors.stops = "At least 2 stops required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast('Please fix errors', 'error');
      return;
    }
    setLoading(true);

    try {
      const idToken = await currentUser?.getIdToken();
      // Handle Route ID: prepend 'route_' if strict number
      let finalRouteId = routeData.routeId;
      if (/^\d+$/.test(finalRouteId)) {
        finalRouteId = `route_${finalRouteId}`;
      }

      const response = await fetch('/api/routes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          routeId: finalRouteId,
          routeName: routeData.routeName,
          status: routeData.status,
          stops: stops
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed');

      addToast('Route created successfully', 'success');

      // Signal the routes list page to refresh when it's rendered
      signalCollectionRefresh('routes');

      setTimeout(() => router.push("/admin/routes"), 1500);
    } catch (error: any) {
      console.error(error);
      addToast(error.message || "Failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || dataLoading) {
    return <PremiumPageLoader message="Loading Route Registration..." subMessage="Setting up form..." />;
  }

  if (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role)) return null;

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Add Route</h1>
            <p className="text-muted-foreground mt-1">Create a new bus route with stops</p>
          </div>
          <Link
            href="/admin/routes"
            className="inline-flex items-center px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-md"
          >
            <span className="mr-1.5 text-sm">←</span>
            Back
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-2xl border border-white/10 p-4 sm:p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-8">

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="relative">
                <Label className="mb-1 block text-sm font-semibold text-gray-200">Route ID *</Label>
                <div className="relative">
                  <Input
                    value={routeData.routeId}
                    onChange={(e) => handleInputChange('routeId', e.target.value)}
                    className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 pr-10"
                    placeholder="e.g. 15"
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
                {errors.routeId && <p className="text-red-400 text-xs mt-1">{errors.routeId}</p>}
              </div>

              <div>
                <Label className="mb-1 block text-sm font-semibold text-gray-200">Route Name *</Label>
                <Input
                  value={routeData.routeName}
                  onChange={(e) => handleInputChange('routeName', e.target.value)}
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6"
                  placeholder="e.g. Route-1"
                />
                {errors.routeName && <p className="text-red-400 text-xs mt-1">{errors.routeName}</p>}
              </div>

              <div>
                <Label className="mb-1 block text-sm font-semibold text-gray-200">Status *</Label>
                <Select value={routeData.status} onValueChange={(val) => handleInputChange('status', val)}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Empty 3rd column */}
              <div></div>
            </div>

            {/* Stops */}
            <div className="space-y-4 pt-4 border-t border-gray-800">
              <Label className="text-lg font-semibold text-gray-200 flex items-center">
                <MapPin className="inline h-5 w-5 mr-2" />
                Route Stops ({stops.length})
              </Label>

              <div className="relative" ref={suggestionRef}>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      placeholder="Type stop name..."
                      value={currentStopInput}
                      onChange={(e) => setCurrentStopInput(e.target.value)}
                      onKeyPress={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStop(currentStopInput); } }}
                      className="bg-gray-800 border-gray-700 text-white py-6"
                    />
                    {showSuggestions && filteredSuggestions.length > 0 && (
                      <div className="absolute z-50 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {filteredSuggestions.map((stop, i) => (
                          <div key={i} className="px-4 py-2 hover:bg-gray-800 cursor-pointer text-gray-200" onClick={() => addStop(stop)}>
                            {stop}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button type="button" onClick={() => addStop(currentStopInput)} className="bg-blue-600 hover:bg-blue-700 text-white py-6">
                    <Plus className="h-4 w-4 mr-2" />
                  </Button>
                </div>
                {errors.stops && <p className="text-red-400 text-sm mt-1">{errors.stops}</p>}
              </div>

              {/* List with Drag and Drop */}
              {stops.length > 0 ? (
                <div className="bg-gray-900/50 rounded-lg p-2 space-y-2 max-h-96 overflow-y-auto border border-gray-800">
                  {stops.map((stop, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={() => handleDragStart(i)}
                      onDragOver={(e) => handleDragOver(e, i)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-3 bg-gray-800/80 p-3 rounded-lg border border-gray-700/50 cursor-grab active:cursor-grabbing transition-all hover:bg-gray-800 ${draggedStopIndex === i ? 'opacity-50' : 'opacity-100'}`}
                    >
                      <GripVertical className="h-5 w-5 text-gray-500 cursor-grab" />
                      <div className="bg-blue-600/20 text-blue-400 font-mono w-8 h-8 flex items-center justify-center rounded-lg text-sm">{stop.sequence}</div>
                      <div className="flex-1 text-gray-200 font-medium">{stop.name} <span className="text-xs text-gray-500 ml-2 font-normal">({stop.stop_name})</span></div>
                      <button type="button" onClick={() => removeStop(i)} className="text-gray-400 hover:text-red-400 p-2 hover:bg-red-500/10 rounded-full transition"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 bg-gray-800/30 rounded border border-dashed border-gray-700 text-gray-500">
                  No stops added.
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-3 pt-6 border-t border-gray-800 w-full">
              <Button type="button" onClick={() => { setRouteData(prev => ({ ...prev, routeName: "", status: "active" })); setStops([]); }} className="bg-blue-600 hover:bg-blue-700 text-white w-full">Reset</Button>
              <Link href="/admin/routes" className="w-full block">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white w-full">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700 text-white w-full">
                {loading ? "Creating..." : "Create Route"}
              </Button>
            </div>

          </form>
        </div>
      </div>
    </div>
  );
}
