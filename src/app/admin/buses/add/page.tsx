"use client";

import { useState, useEffect } from "react";
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { Info, RotateCcw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAllRoutes, getAllDrivers, getAllBuses } from "@/lib/dataService";
import { useToast } from "@/contexts/toast-context";
import { Route, Driver } from "@/lib/types";
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';
import { OptimizedInput, OptimizedSelect } from '@/components/forms';

type BusFormData = {
  busId: string;
  busNumber: string;
  color: string;
  capacity: string;
  driverUID: string;
  routeId: string;
  shift: string;
  status: string;
  morningLoad: string;
  eveningLoad: string;
};

export default function AddBusPage() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const router = useRouter();
  const { addToast } = useToast();

  const [busData, setBusData] = useState<BusFormData>({
    busId: "",
    busNumber: "",
    color: "",
    capacity: "",
    driverUID: "",
    routeId: "",
    shift: "", // No default shift
    status: "active",
    morningLoad: "",
    eveningLoad: ""
  });

  // Debounced storage to prevent input lag
  const storage = useDebouncedStorage<BusFormData>('busFormData', {
    debounceMs: 500,
  });

  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [routes, setRoutes] = useState<Route[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);
  const [defaultBusIdValue, setDefaultBusIdValue] = useState<string>("");
  const [buses, setBuses] = useState<any[]>([]);

  useEffect(() => {
    if (!authLoading && (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role))) {
      router.push('/login');
      return;
    }

    const fetchData = async () => {
      try {
        const [routesData, driversData, busesData] = await Promise.all([
          getAllRoutes(),
          getAllDrivers(),
          getAllBuses()
        ]);

        setRoutes(routesData);
        setDrivers(driversData);

        // Auto-generate Bus ID Number
        const nextNum = busesData.length + 1;
        const nextIdDisplay = nextNum.toString();

        setBusData(prev => ({ ...prev, busId: nextIdDisplay, status: "active" }));
        setDefaultBusIdValue(nextIdDisplay);
        setBuses(busesData);

        const savedData = localStorage.getItem('busFormData');
        if (savedData) {
          try {
            const parsedData = JSON.parse(savedData);
            let loadedBusId = parsedData.busId || nextIdDisplay;
            if (loadedBusId.startsWith('bus_')) loadedBusId = loadedBusId.replace('bus_', '');
            setBusData(prev => ({ ...prev, ...parsedData, busId: loadedBusId }));
          } catch (e) {
            console.error(e);
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        addToast('Failed to load data', 'error');
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [addToast, authLoading, currentUser, userData, router]);

  useEffect(() => {
    if (!dataLoading) {
      storage.save(busData);
    }
  }, [busData, dataLoading]); // Removed storage from deps - it's stable

  // Handle Load Reset based on Shift
  useEffect(() => {
    if (busData.shift === "Morning") {
      setBusData(prev => ({ ...prev, eveningLoad: "" }));
    } else if (busData.shift === "Evening") {
      setBusData(prev => ({ ...prev, morningLoad: "" }));
    }
  }, [busData.shift]);

  const handleInputChange = (field: keyof BusFormData, value: string) => {
    // Prevent negative numbers for capacity and loads
    if (['capacity', 'morningLoad', 'eveningLoad'].includes(field)) {
      if (value && parseInt(value) < 0) return;
    }
    setBusData(prev => ({ ...prev, [field]: value }));

    // Clear error
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleRestoreBusId = () => {
    setBusData(prev => ({ ...prev, busId: defaultBusIdValue }));
  };

  const formatRouteDisplay = (route: Route) => {
    if (!route.stops || route.stops.length === 0) return `${route.routeName} (No stops)`;
    const stopNames = route.stops.map(stop => typeof stop === 'string' ? stop : stop.name || stop.toString());
    if (stopNames.length <= 4) return `${route.routeName} → ${stopNames.join(', ')}`;

    const first = stopNames[0];
    const fourth = stopNames[3];
    const secondLast = stopNames[stopNames.length - 2];
    const last = stopNames[stopNames.length - 1];
    return `${route.routeName} → ${first}, ${fourth}, ${secondLast}, ${last}`;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!busData.busId.trim()) newErrors.busId = "Required";
    if (!busData.busNumber.trim()) newErrors.busNumber = "Required";
    if (!busData.color.trim()) newErrors.color = "Required";
    if (!busData.capacity || parseInt(busData.capacity) <= 0) newErrors.capacity = "Invalid";
    if (!busData.driverUID) newErrors.driverUID = "Required";
    if (!busData.routeId) newErrors.routeId = "Required";
    if (!busData.shift) newErrors.shift = "Required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      const idToken = await currentUser?.getIdToken();

      // Ensure busId has prefix if needed (though user said "just the value only 13", I'll send it as typed?)
      // Wait, "where 13 is the number".
      // Let's assume the user wants cleaner IDs in UI, but if I send "13" to backend, it will be "13".
      // If I want to maintain compatibility with existing "bus_X" IDs, I should probably prepend "bus_" if it's purely numeric.
      // But maybe the user *wants* to move to "13"?
      // I will err on the side of "what they see is what they get" UNLESS it's purely a number matching the auto-gen sequence, 
      // where prepending `bus_` is the project convention previously established. 
      // But the user literally said "Bus ID value is currently 'bus_13', it should be just the value only 13". 
      // I will prepend 'bus_' if it is numeric to be safe with existing data, UNLESS I see explicit instruction to change ID format in DB.
      // Re-reading: "Bus ID value is currently bus_13, it should be just the value only 13". 
      // This refers to the *Value* in the input field.
      // I'll stick to: Display numeric, Submit `bus_<numeric>`.

      let finalBusId = busData.busId;
      if (/^\d+$/.test(finalBusId)) {
        finalBusId = `bus_${finalBusId}`;
      }

      const response = await fetch('/api/buses/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify({
          busId: finalBusId,
          busNumber: busData.busNumber,
          color: busData.color,
          capacity: parseInt(busData.capacity),
          driverUID: busData.driverUID,
          routeId: busData.routeId,
          shift: busData.shift,
          load: {
            morningCount: parseInt(busData.morningLoad) || 0,
            eveningCount: parseInt(busData.eveningLoad) || 0
          },
          status: busData.status || "active"
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Failed');

      storage.clear();

      // Signal the buses list page to refresh when it's rendered
      signalCollectionRefresh('buses');

      addToast(result.message || "Bus created!", 'success');
      setTimeout(() => router.push("/admin/buses"), 1500);
    } catch (error) {
      console.error(error);
      addToast(error instanceof Error ? error.message : "Failed", 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setBusData({
      busId: defaultBusIdValue,
      busNumber: "",
      color: "",
      capacity: "",
      driverUID: "",
      routeId: "",
      shift: "",
      status: "active",
      morningLoad: "",
      eveningLoad: ""
    });
    setErrors({});
    storage.clear();
    addToast('Restored', 'info');
  };

  if (authLoading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#010717]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role)) return null;

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Add Bus</h1>
            <p className="text-gray-400 text-xs">Register a new bus in the fleet</p>
          </div>
          <Link
            href="/admin/buses"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg"
          >
            Back
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Darker Background */}
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-2xl border border-white/10 p-4 sm:p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">

              <div>
                <Label htmlFor="busId" className="mb-1 block text-sm font-semibold text-gray-200">Bus ID *</Label>
                <div className="relative">
                  <OptimizedInput
                    id="busId"
                    value={busData.busId}
                    onChange={(value) => setBusData(prev => ({ ...prev, busId: value }))}
                    className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 pr-10"
                    placeholder="e.g. 13"
                  />
                  {/* Restore Icon */}
                  {busData.busId !== defaultBusIdValue && (
                    <button
                      type="button"
                      onClick={handleRestoreBusId}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors p-1"
                      title="Restore Default ID"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {errors.busId && <p className="text-red-500 text-xs mt-1">{errors.busId}</p>}
              </div>

              <div>
                <OptimizedInput
                  id="busNumber"
                  label="Bus Number"
                  value={busData.busNumber}
                  onChange={(value) => setBusData(prev => ({ ...prev, busNumber: value }))}
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6"
                  placeholder="e.g. AS-01-QC-1234"
                  required
                />
                {errors.busNumber && <p className="text-red-500 text-xs mt-1">{errors.busNumber}</p>}
              </div>

              <div>
                <OptimizedSelect
                  id="color"
                  label="Color"
                  value={busData.color}
                  onChange={(value) => setBusData(prev => ({ ...prev, color: value }))}
                  placeholder="Select Color"
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer"
                  required
                >
                  <SelectItem value="White">White</SelectItem>
                  <SelectItem value="Yellow">Yellow</SelectItem>
                </OptimizedSelect>
                {errors.color && <p className="text-red-500 text-xs mt-1">{errors.color}</p>}
              </div>

              <div>
                <OptimizedSelect
                  id="driverUID"
                  label="Driver"
                  value={busData.driverUID}
                  onChange={(value) => setBusData(prev => ({ ...prev, driverUID: value }))}
                  placeholder="Select a driver"
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer"
                  required
                >
                  <div className="px-2 py-1.5 text-xs font-bold text-yellow-500 uppercase tracking-wider bg-gray-800/50">
                    Reserved (Category-1)
                  </div>
                  {drivers
                    .filter(d => !d.assignedBusId && !d.busId && !d.busAssigned)
                    .map(driver => (
                      <SelectItem key={driver.uid} value={driver.uid || driver.id}>
                        {driver.fullName || driver.name || 'Unknown'}
                      </SelectItem>
                    ))}

                  <div className="px-2 py-1.5 text-xs font-bold text-yellow-500 uppercase tracking-wider bg-gray-800/50 mt-2">
                    Assigned (Category-2)
                  </div>
                  {drivers
                    .filter(d => d.assignedBusId || d.busId || d.busAssigned)
                    .map(driver => {
                      const busId = driver.assignedBusId || driver.busId || driver.busAssigned;
                      const bus = buses.find(b => b.busId === busId || b.id === busId);
                      return (
                        <SelectItem key={driver.uid} value={driver.uid || driver.id} disabled>
                          {driver.fullName || driver.name || 'Unknown'} ({bus?.busNumber || busId})
                        </SelectItem>
                      );
                    })}
                </OptimizedSelect>
                {errors.driverUID && <p className="text-red-500 text-xs mt-1">{errors.driverUID}</p>}
              </div>

              <div>
                <OptimizedInput
                  id="capacity"
                  label="Total Capacity"
                  type="number"
                  value={busData.capacity}
                  onChange={(value) => setBusData(prev => ({ ...prev, capacity: value }))}
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="e.g. 55"
                  required
                />
                {errors.capacity && <p className="text-red-500 text-xs mt-1">{errors.capacity}</p>}
              </div>

              <div className="relative">
                <Label htmlFor="routeId" className="mb-1 block text-sm font-semibold text-gray-200">Route *</Label>
                <div className="relative flex items-center">
                  <Select value={busData.routeId} onValueChange={(val) => handleInputChange('routeId', val)}>
                    <SelectTrigger className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 pr-4 cursor-pointer relative">
                      <SelectValue placeholder="Select a route" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {routes
                        .sort((a, b) => {
                          const numA = parseInt((a.routeName || '').match(/\d+/)?.[0] || '0');
                          const numB = parseInt((b.routeName || '').match(/\d+/)?.[0] || '0');
                          return numA - numB;
                        })
                        .map(route => (
                          <SelectItem key={route.routeId} value={route.routeId}>
                            {formatRouteDisplay(route)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {busData.routeId && (
                    <div className="absolute right-10 top-1/2 -translate-y-1/2 flex items-center z-10">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="text-gray-400 hover:text-white transition-colors">
                            <Info className="h-5 w-5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 bg-gray-900 border-gray-700 text-white p-4 shadow-2xl">
                          <h4 className="font-bold text-lg mb-3 border-b border-gray-800 pb-2">Route Stops:</h4>
                          <div className="max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {routes.find(r => r.routeId === busData.routeId)?.stops?.map((s: any, i: number) => (
                              <div key={i} className="py-2 border-b border-gray-800/50 last:border-0 flex items-start gap-3">
                                <span className="text-purple-400 font-mono text-sm mt-0.5">{i + 1}.</span>
                                <span className="text-gray-200 text-sm leading-relaxed">{s.name || s}</span>
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
                {errors.routeId && <p className="text-red-500 text-xs mt-1">{errors.routeId}</p>}
              </div>


              <div>
                <OptimizedSelect
                  id="status"
                  label="Status"
                  value={busData.status}
                  onChange={(value) => setBusData(prev => ({ ...prev, status: value }))}
                  placeholder="active"
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer"
                  required
                >
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </OptimizedSelect>
              </div>

              <div>
                <OptimizedSelect
                  id="shift"
                  label="Shift"
                  value={busData.shift}
                  onChange={(value) => setBusData(prev => ({ ...prev, shift: value }))}
                  placeholder="Select the shift"
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer"
                  required
                >
                  <SelectItem value="Morning">Morning</SelectItem>
                  <SelectItem value="Evening">Evening</SelectItem>
                  <SelectItem value="Both">Both</SelectItem>
                </OptimizedSelect>
                {errors.shift && <p className="text-red-500 text-xs mt-1">{errors.shift}</p>}
              </div>

              {/* Force full width for Load row if needed, or just standard grid */}
              {/* Last row with just load */}
              <div className="col-span-1 md:col-span-2">
                {/* Or just put it in flow */}
              </div>
            </div>

            {/* Separate Load Row */}
            <div className="flex gap-4">
              <div className="flex-1">
                <OptimizedInput
                  id="morningLoad"
                  label="Morning Load"
                  type="number"
                  value={busData.morningLoad}
                  onChange={(value) => setBusData(prev => ({ ...prev, morningLoad: value }))}
                  placeholder="0"
                  disabled={!busData.shift || busData.shift === "Evening"}
                  className={`bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${(!busData.shift || busData.shift === "Evening") ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <div className="flex-1">
                <OptimizedInput
                  id="eveningLoad"
                  label="Evening Load"
                  type="number"
                  value={busData.eveningLoad}
                  onChange={(value) => setBusData(prev => ({ ...prev, eveningLoad: value }))}
                  placeholder="0"
                  disabled={!busData.shift || busData.shift === "Morning"}
                  className={`bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${(!busData.shift || busData.shift === "Morning") ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>


            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-800 w-full">
              <Button type="button" onClick={handleReset} className="bg-blue-600 hover:bg-blue-700 text-white w-full">Reset</Button>
              <Link href="/admin/buses" className="w-full block">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white w-full">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700 text-white w-full">
                {loading ? "Adding..." : "Add Bus"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
