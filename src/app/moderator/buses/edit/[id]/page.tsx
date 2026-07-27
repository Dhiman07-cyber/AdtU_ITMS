"use client";

import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { useAuth } from '@/contexts/auth-context';
import { useToast } from "@/contexts/toast-context";
import { signalCollectionRefresh } from "@/hooks/useEventDrivenRefresh";
import { getAllBuses,getAllDrivers,getAllRoutes,getBusById } from "@/lib/dataService";
import { Driver,Route } from "@/lib/types";
import { Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use,useEffect,useState } from "react";

interface Bus {
  id: string;
  busId: string;
  busNumber: string;
  color: string;
  capacity: number;
  assignedDriverId?: string;
  driverUID?: string;
  activeDriverId?: string;
  routeId: string;
  shift: string;
  status: string;
  load?: {
    morningCount: number;
    eveningCount: number;
  };
}

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

export default function EditBusPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { canBusEdit, loading: permsLoading } = useModeratorPermissions();
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<BusFormData>({
    busId: "",
    busNumber: "",
    color: "",
    capacity: "55",
    driverUID: "",
    routeId: "",
    shift: "",
    status: "active",
    morningLoad: "0",
    eveningLoad: "0"
  });

  const [routes, setRoutes] = useState<Route[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hoveredRoute, setHoveredRoute] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role))) {
      router.push('/login');
    }
  }, [authLoading, currentUser, userData, router]);

  const fetchBusData = async () => {
    try {
      setLoading(true);
      const [routesData, driversData, busResponse, busesData] = await Promise.all([
        getAllRoutes(),
        getAllDrivers(),
        getBusById(id),
        getAllBuses()
      ]);

      setRoutes(routesData);
      setDrivers(driversData);
      setBuses(busesData);

      if (busResponse) {
        const bus = busResponse as unknown as Bus;
        const mLoad = bus.load?.morningCount || 0;
        const eLoad = bus.load?.eveningCount || 0;

        let displayId = bus.busId || bus.id;
        if (displayId.startsWith('bus_')) displayId = displayId.replace('bus_', '');

        setFormData({
          busId: displayId,
          busNumber: bus.busNumber,
          color: bus.color || "White",
          capacity: bus.capacity.toString(),
          driverUID: bus.assignedDriverId || bus.driverUID || bus.activeDriverId || "",
          routeId: bus.routeId,
          shift: bus.shift || "",
          status: bus.status || "active",
          morningLoad: mLoad.toString(),
          eveningLoad: eLoad.toString()
        });
      } else {
        addToast('Bus not found', 'error');
        router.push('/moderator/buses');
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      addToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchBusData();
    }
  }, [id, currentUser]);

  useEffect(() => {
    if (formData.shift === "Morning") {
      setFormData(prev => ({ ...prev, eveningLoad: "0" }));
    } else if (formData.shift === "Evening") {
      setFormData(prev => ({ ...prev, morningLoad: "0" }));
    }
  }, [formData.shift]);

  const handleInputChange = (field: keyof BusFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const updatedErrors = { ...prev };
        delete updatedErrors[field];
        return updatedErrors;
      });
    }
  };

  const formatRouteDisplay = (route: Route) => {
    if (!route.stops || route.stops.length === 0) return `${route.routeName || route.route} (No stops)`;
    const stopNames = route.stops.map(stop => typeof stop === 'string' ? stop : stop.name || stop.toString());
    if (stopNames.length <= 4) return `${route.routeName || route.route} → ${stopNames.join(', ')}`;
    const first = stopNames[0];
    const fourth = stopNames[3];
    const secondLast = stopNames[stopNames.length - 2];
    const last = stopNames[stopNames.length - 1];
    return `${route.routeName || route.route} → ${first}, ${fourth}, ${secondLast}, ${last}`;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.busNumber.trim()) newErrors.busNumber = "Required";
    if (!formData.color.trim()) newErrors.color = "Required";
    if (!formData.capacity || parseInt(formData.capacity) <= 0) newErrors.capacity = "Must be positive";
    if (!formData.driverUID) newErrors.driverUID = "Required";
    if (!formData.routeId) newErrors.routeId = "Required";
    if (!formData.shift) newErrors.shift = "Required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast('Please fix the errors in the form', 'error');
      return;
    }
    setSubmitting(true);

    try {
      const idToken = await currentUser?.getIdToken();
      const response = await fetch('/api/buses/update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idToken
        },
        body: JSON.stringify({
          busId: id,
          busNumber: formData.busNumber,
          color: formData.color,
          capacity: parseInt(formData.capacity),
          driverUID: formData.driverUID,
          routeId: formData.routeId,
          shift: formData.shift,
          status: formData.status,
          load: {
            morningCount: parseInt(formData.morningLoad),
            eveningCount: parseInt(formData.eveningLoad)
          }
        })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update bus');
      signalCollectionRefresh('buses');

      addToast('Bus updated successfully', 'success');
      router.push('/moderator/buses');

    } catch (error: any) {
      console.error("Update Error:", error);
      addToast(error.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    if (currentUser) {
      fetchBusData();
    }
    addToast('Form reset successfully', 'info');
  };

  if (loading || authLoading) {
    return <PremiumPageLoader message="Loading bus details..." subMessage="Preparing editing tools..." />;
  }

  if (!currentUser || !userData || !['admin', 'moderator'].includes(userData.role)) return null;

  if (!permsLoading && !canBusEdit) {
    return <PermissionDeniedCard title="Editing Bus Restricted" actionName="Editing Buses" />;
  }

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Edit Bus</h1>
            <p className="text-gray-400 text-xs">Update bus registration, capacity and route assignment</p>
          </div>
          <Link
            href="/moderator/buses"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg backdrop-blur-sm"
          >
            Back
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 overflow-hidden">
        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] backdrop-blur-sm rounded-2xl shadow-2xl border border-white/10 p-4 sm:p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <Label htmlFor="busId" className="block text-xs font-medium text-gray-300 mb-1">
                  Bus ID (Read-only)
                </Label>
                <Input
                  id="busId"
                  value={formData.busId}
                  disabled
                  className="bg-gray-800/50 border-gray-700 text-gray-400 cursor-not-allowed"
                />
              </div>

              <div>
                <Label htmlFor="busNumber" className="block text-xs font-medium text-gray-300 mb-1">
                  Bus Number <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="busNumber"
                  value={formData.busNumber}
                  onChange={(e) => handleInputChange('busNumber', e.target.value)}
                  placeholder="e.g. AS-01-AB-1234"
                  className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                {errors.busNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.busNumber}</p>}
              </div>

              <div>
                <Label htmlFor="color" className="block text-xs font-medium text-gray-300 mb-1">
                  Color <span className="text-red-500">*</span>
                </Label>
                <Select value={formData.color} onValueChange={(val) => handleInputChange('color', val)}>
                  <SelectTrigger className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <SelectValue placeholder="Select Color" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start">
                    <SelectItem value="White">White</SelectItem>
                    <SelectItem value="Yellow">Yellow</SelectItem>
                  </SelectContent>
                </Select>
                {errors.color && <p className="text-red-500 text-[10px] mt-0.5">{errors.color}</p>}
              </div>

              <div>
                <Label htmlFor="driver" className="block text-xs font-medium text-gray-300 mb-1">
                  Driver <span className="text-red-500">*</span>
                </Label>
                <Select value={formData.driverUID} onValueChange={(val) => handleInputChange('driverUID', val)}>
                  <SelectTrigger className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <SelectValue placeholder="Select Driver" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start" className="max-h-80 bg-gray-900 border-gray-700">
                    <div className="px-2 py-1.5 text-xs font-bold text-yellow-500 uppercase tracking-wider bg-gray-800/50">
                      Reserved (Category-1)
                    </div>
                    {drivers
                      .filter(d => {
                        const bId = d.busId || d.busId || d.busAssigned;
                        return !bId || bId === id || bId === formData.busId || bId === `bus_${formData.busId}`;
                      })
                      .map(driver => (
                        <SelectItem key={driver.uid} value={driver.uid || (driver as any).id || ''}>
                          {driver.fullName || driver.name || 'Unknown'}
                        </SelectItem>
                      ))}

                    <div className="px-2 py-1.5 text-xs font-bold text-yellow-500 uppercase tracking-wider bg-gray-800/50 mt-2">
                      Assigned (Category-2)
                    </div>
                    {drivers
                      .filter(d => {
                        const bId = d.busId || d.busId || d.busAssigned;
                        return bId && bId !== id && bId !== formData.busId && bId !== `bus_${formData.busId}`;
                      })
                      .map(driver => {
                        const bId = driver.busId || driver.busId || driver.busAssigned;
                        const bus = buses.find(b => b.busId === bId || b.id === bId);
                        return (
                          <SelectItem key={driver.uid} value={driver.uid || (driver as any).id || ''} disabled>
                            {driver.fullName || driver.name || 'Unknown'} ({bus?.busNumber || bId})
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
                {errors.driverUID && <p className="text-red-500 text-[10px] mt-0.5">{errors.driverUID}</p>}
              </div>

              <div>
                <Label htmlFor="capacity" className="block text-xs font-medium text-gray-300 mb-1">
                  Total Capacity <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="capacity"
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => handleInputChange('capacity', e.target.value)}
                  className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                {errors.capacity && <p className="text-red-500 text-[10px] mt-0.5">{errors.capacity}</p>}
              </div>

              <div className="relative">
                <Label htmlFor="route" className="block text-xs font-medium text-gray-300 mb-1">
                  Route <span className="text-red-500">*</span>
                </Label>
                <div className="relative flex items-center">
                  <Select value={formData.routeId} onValueChange={(val) => handleInputChange('routeId', val)}>
                    <SelectTrigger className="flex-1 border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white pr-14">
                      <SelectValue placeholder="Select Route" />
                    </SelectTrigger>
                    <SelectContent position="popper" side="bottom" align="start" className="max-h-60">
                      {routes
                        .sort((a, b) => {
                          const numA = parseInt((a.routeName || '').match(/\d+/)?.[0] || '0');
                          const numB = parseInt((b.routeName || '').match(/\d+/)?.[0] || '0');
                          return numA - numB;
                        })
                        .map(r => (
                          <SelectItem key={r.routeId || r.id} value={(r.routeId || r.id || '') as string}>{formatRouteDisplay(r)}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {formData.routeId && (
                    <div className="absolute right-10 top-1/2 -translate-y-1/2 flex items-center">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="text-gray-400 hover:text-white transition-colors">
                            <Info className="h-4 w-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 bg-gray-900 border-gray-700 text-white p-4 shadow-2xl">
                          <h4 className="font-bold text-lg mb-3 border-b border-gray-800 pb-2">Route Stops:</h4>
                          <div className="max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {routes.find(r => (r.routeId || r.id) === formData.routeId)?.stops?.map((s: any, i: number) => (
                              <div key={i} className="py-2 border-b border-gray-800/50 last:border-0 flex items-start gap-3">
                                <span className="text-purple-400 font-mono text-xs mt-0.5">{i + 1}.</span>
                                <span className="text-gray-200 text-xs leading-relaxed">{s.name || s}</span>
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
                {errors.routeId && <p className="text-red-500 text-[10px] mt-0.5">{errors.routeId}</p>}
              </div>

              <div>
                <Label htmlFor="status" className="block text-xs font-medium text-gray-300 mb-1">
                  Status <span className="text-red-500">*</span>
                </Label>
                <Select value={formData.status} onValueChange={(val) => handleInputChange('status', val)}>
                  <SelectTrigger className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <SelectValue placeholder="Select Status" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="shift" className="block text-xs font-medium text-gray-300 mb-1">
                  Shift <span className="text-red-500">*</span>
                </Label>
                <Select value={formData.shift} onValueChange={(val) => handleInputChange('shift', val)}>
                  <SelectTrigger className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                    <SelectValue placeholder="Select Shift" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start">
                    <SelectItem value="Morning">Morning</SelectItem>
                    <SelectItem value="Evening">Evening</SelectItem>
                    <SelectItem value="Both">Both Shifts</SelectItem>
                  </SelectContent>
                </Select>
                {errors.shift && <p className="text-red-500 text-[10px] mt-0.5">{errors.shift}</p>}
              </div>
            </div>

            {/* Load Row */}
            <div className="flex space-x-4 pt-4">
              <div className="flex-1">
                <Label className="block text-xs font-medium text-gray-300 mb-1">Morning Load</Label>
                <Input
                  type="number"
                  value={formData.morningLoad}
                  onChange={(e) => handleInputChange('morningLoad', e.target.value)}
                  disabled={!formData.shift || formData.shift === "Evening"}
                  className={`bg-gray-800/50 border-gray-700 text-white ${(!formData.shift || formData.shift === "Evening") ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              <div className="flex-1">
                <Label className="block text-xs font-medium text-gray-300 mb-1">Evening Load</Label>
                <Input
                  type="number"
                  value={formData.eveningLoad}
                  onChange={(e) => handleInputChange('eveningLoad', e.target.value)}
                  disabled={!formData.shift || formData.shift === "Morning"}
                  className={`bg-gray-800/50 border-gray-700 text-white ${(!formData.shift || formData.shift === "Morning") ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-6 border-t border-white/10">
              <Button
                type="button"
                onClick={handleReset}
                className="bg-blue-600 hover:bg-blue-700 text-white min-w-[80px]"
              >
                Reset
              </Button>
              <Link href="/moderator/buses">
                <Button type="button" className="bg-red-600 hover:bg-red-700 text-white min-w-[80px]">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-green-600 hover:bg-green-700 text-white min-w-[120px]"
              >
                {submitting ? (
                  <div className="flex items-center space-x-2">
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Updating...</span>
                  </div>
                ) : (
                  "Update Bus"
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}