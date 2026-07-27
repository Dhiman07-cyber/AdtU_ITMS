"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { useAuth } from '@/contexts/auth-context';
import { useToast } from "@/contexts/toast-context";
import { useDebouncedStorage } from '@/hooks/useDebouncedStorage';
import { signalCollectionRefresh } from "@/hooks/useEventDrivenRefresh";
import { getAllBuses,getAllDrivers,getAllRoutes } from "@/lib/dataService";
import { Driver,Route } from "@/lib/types";
import { Info,RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";

// ... (Types are same)
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

import { PermissionDeniedCard } from "@/components/PermissionDeniedCard";
import { useModeratorPermissions } from "@/hooks/useModeratorPermissions";

export default function AddBusPage() {
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { canBusAdd, loading: permsLoading } = useModeratorPermissions();
  const router = useRouter();
  const { addToast } = useToast();

  const [busData, setBusData] = useState<BusFormData>({
    busId: "",
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
  
  // Debounced storage to prevent input lag
  const storage = useDebouncedStorage<BusFormData>('modBusFormData', {
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

        const nextNum = busesData.length + 1;
        const nextIdDisplay = nextNum.toString();

        setBusData(prev => ({ ...prev, busId: nextIdDisplay, status: "active" }));
        setDefaultBusIdValue(nextIdDisplay);
        setBuses(busesData);

        const savedData = localStorage.getItem('modBusFormData'); // Separate storage key
        if (savedData) {
          try {
            const parsedData = JSON.parse(savedData);
            let loadedBusId = parsedData.busId || nextIdDisplay;
            if (loadedBusId.startsWith('bus_')) loadedBusId = loadedBusId.replace('bus_', '');
            setBusData(prev => ({ ...prev, ...parsedData, busId: loadedBusId }));
          } catch (e) { console.error(e); }
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
  }, [busData, dataLoading, storage]);

  useEffect(() => {
    if (busData.shift === "Morning") {
      setBusData(prev => ({ ...prev, eveningLoad: "" }));
    } else if (busData.shift === "Evening") {
      setBusData(prev => ({ ...prev, morningLoad: "" }));
    }
  }, [busData.shift]);

  const handleInputChange = (field: keyof BusFormData, value: string) => {
    // Prevent negative numbers
    if (['capacity', 'morningLoad', 'eveningLoad'].includes(field)) {
      if (value && parseInt(value) < 0) return;
    }
    setBusData(prev => ({ ...prev, [field]: value }));
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
      addToast(result.message || "Bus created!", 'success');
      signalCollectionRefresh('buses');
      setTimeout(() => router.push("/moderator/buses"), 1500); // Updated redirect
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

  if (!permsLoading && !canBusAdd) {
    return <PermissionDeniedCard title="Adding Bus Restricted" actionName="Adding Buses" />;
  }

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Add Bus</h1>
            <p className="text-gray-400 text-xs">Register a new bus in the fleet</p>
          </div>
          <Link
            href="/moderator/buses"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg backdrop-blur-sm"
          >
            Back
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] backdrop-blur-sm rounded-2xl shadow-2xl border border-white/10 p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">

              <div>
                <Label htmlFor="busId" className="mb-2 block text-sm font-semibold text-gray-200">Bus ID *</Label>
                <div className="relative">
                  <Input
                    id="busId"
                    value={busData.busId}
                    onChange={(e) => handleInputChange('busId', e.target.value)}
                    className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 pr-10"
                    placeholder="e.g. 13"
                  />
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
                <Label htmlFor="busNumber" className="mb-2 block text-sm font-semibold text-gray-200">Bus Number *</Label>
                <Input
                  id="busNumber"
                  value={busData.busNumber}
                  onChange={(e) => handleInputChange('busNumber', e.target.value)}
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6"
                  placeholder="e.g. AS-01-QC-1234"
                />
                {errors.busNumber && <p className="text-red-500 text-xs mt-1">{errors.busNumber}</p>}
              </div>

              <div>
                <Label htmlFor="color" className="mb-2 block text-sm font-semibold text-gray-200">Color *</Label>
                <Select value={busData.color} onValueChange={(val) => handleInputChange('color', val)}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer">
                    <SelectValue placeholder="Select Color" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="White">White</SelectItem>
                    <SelectItem value="Yellow">Yellow</SelectItem>
                  </SelectContent>
                </Select>
                {errors.color && <p className="text-red-500 text-xs mt-1">{errors.color}</p>}
              </div>

              <div>
                <Label htmlFor="driverUID" className="mb-2 block text-sm font-semibold text-gray-200">Driver *</Label>
                <Select value={busData.driverUID} onValueChange={(val) => handleInputChange('driverUID', val)}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer">
                    <SelectValue placeholder="Select a driver" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80 bg-gray-900 border-gray-700">
                    <div className="px-2 py-1.5 text-xs font-bold text-yellow-500 uppercase tracking-wider bg-gray-800/50">
                      Reserved (Category-1)
                    </div>
                    {drivers
                      .filter(d => !d.busId && !d.busId && !d.busAssigned)
                      .map(driver => (
                        <SelectItem key={driver.uid} value={driver.uid || driver.id}>
                          {driver.fullName || driver.name || 'Unknown'}
                        </SelectItem>
                      ))}

                    <div className="px-2 py-1.5 text-xs font-bold text-yellow-500 uppercase tracking-wider bg-gray-800/50 mt-2">
                      Assigned (Category-2)
                    </div>
                    {drivers
                      .filter(d => d.busId || d.busId || d.busAssigned)
                      .map(driver => {
                        const busId = driver.busId || driver.busId || driver.busAssigned;
                        const bus = buses.find(b => b.busId === busId || b.id === busId);
                        return (
                          <SelectItem key={driver.uid} value={driver.uid || driver.id} disabled>
                            {driver.fullName || driver.name || 'Unknown'} ({bus?.busNumber || busId})
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
                {errors.driverUID && <p className="text-red-500 text-xs mt-1">{errors.driverUID}</p>}
              </div>

              <div>
                <Label htmlFor="capacity" className="mb-2 block text-sm font-semibold text-gray-200">Total Capacity *</Label>
                <Input
                  id="capacity"
                  type="number"
                  min="0"
                  onKeyDown={(e) => {
                    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') {
                      e.preventDefault();
                    }
                  }}
                  value={busData.capacity}
                  onChange={(e) => handleInputChange('capacity', e.target.value)}
                  className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="e.g. 55"
                />
                {errors.capacity && <p className="text-red-500 text-xs mt-1">{errors.capacity}</p>}
              </div>

              <div className="relative">
                <Label htmlFor="routeId" className="mb-2 block text-sm font-semibold text-gray-200">Route *</Label>
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
                <Label htmlFor="status" className="mb-2 block text-sm font-semibold text-gray-200">Status *</Label>
                <Select value={busData.status} onValueChange={(val) => handleInputChange('status', val)}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer">
                    <SelectValue placeholder="active" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="shift" className="mb-2 block text-sm font-semibold text-gray-200">Shift *</Label>
                <Select value={busData.shift} onValueChange={(val) => handleInputChange('shift', val)}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 cursor-pointer">
                    <SelectValue placeholder="Select the shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Morning">Morning</SelectItem>
                    <SelectItem value="Evening">Evening</SelectItem>
                    <SelectItem value="Both">Both</SelectItem>
                  </SelectContent>
                </Select>
                {errors.shift && <p className="text-red-500 text-xs mt-1">{errors.shift}</p>}
              </div>

              <div className="col-span-1 md:col-span-2"></div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="morningLoad" className="mb-2 block text-sm font-semibold text-gray-200 text-nowrap">Morning Load</Label>
                <Input
                  id="morningLoad"
                  type="number"
                  min="0"
                  onKeyDown={(e) => {
                    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') {
                      e.preventDefault();
                    }
                  }}
                  value={busData.morningLoad}
                  placeholder="0"
                  onChange={(e) => handleInputChange('morningLoad', e.target.value)}
                  disabled={!busData.shift || busData.shift === "Evening"}
                  className={`bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${(!busData.shift || busData.shift === "Evening") ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="eveningLoad" className="mb-2 block text-sm font-semibold text-gray-200 text-nowrap">Evening Load</Label>
                <Input
                  id="eveningLoad"
                  type="number"
                  min="0"
                  onKeyDown={(e) => {
                    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') {
                      e.preventDefault();
                    }
                  }}
                  value={busData.eveningLoad}
                  placeholder="0"
                  onChange={(e) => handleInputChange('eveningLoad', e.target.value)}
                  disabled={!busData.shift || busData.shift === "Morning"}
                  className={`bg-gray-800 border-gray-700 focus:border-purple-500 text-white py-6 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${(!busData.shift || busData.shift === "Morning") ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-800">
              <Button type="button" onClick={handleReset} className="bg-blue-600 hover:bg-blue-700 text-white min-w-[100px]">Reset</Button>
              <Link href="/moderator/buses">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white min-w-[100px]">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700 text-white min-w-[120px]">
                {loading ? "Adding..." : "Add Bus"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
