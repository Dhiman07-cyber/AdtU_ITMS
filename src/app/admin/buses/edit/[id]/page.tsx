"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from '@/contexts/auth-context';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { Info, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAllRoutes, getBusById, getAllDrivers, getAllBuses } from "@/lib/dataService";
import { useToast } from "@/contexts/toast-context";
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import { Route, Driver } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { signalCollectionRefresh } from '@/hooks/useEventDrivenRefresh';

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
  activeTripId?: string;
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

export default function EditBusPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busData, setBusData] = useState<Bus | null>(null);
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

  // Confirmation Dialog
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [changeSummary, setChangeSummary] = useState<string[]>([]);

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
        setBusData(bus);

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
        router.push('/admin/buses');
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
    return `${route.routeName || route.route} → ${stopNames[0]}...`;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.busNumber.trim()) newErrors.busNumber = "Required";
    if (!formData.color.trim()) newErrors.color = "Required";

    // Capacity Check
    const cap = parseInt(formData.capacity);
    const mLoad = parseInt(formData.morningLoad) || 0;
    const eLoad = parseInt(formData.eveningLoad) || 0;
    const currentMembers = mLoad + eLoad;

    if (isNaN(cap) || cap <= 0) {
      newErrors.capacity = "Must be positive";
    } else if (cap < currentMembers) {
      newErrors.capacity = `Cannot be less than assigned students (${currentMembers})`;
    }

    if (!formData.driverUID) newErrors.driverUID = "Required";
    if (!formData.routeId) newErrors.routeId = "Required";
    if (!formData.shift) newErrors.shift = "Required";

    // Shift Logic Check
    if (formData.shift === 'Morning' && eLoad > 0) {
      newErrors.shift = `Evening has ${eLoad} students assigned`;
    }
    if (formData.shift === 'Evening' && mLoad > 0) {
      newErrors.shift = `Morning has ${mLoad} students assigned`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const activeTripWarning = busData?.activeTripId ? "Cannot change during active trip" : null;

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast('Please fix the errors in the form', 'error');
      return;
    }

    // Build Summary
    const changes: string[] = [];
    if (busData?.busNumber !== formData.busNumber) changes.push(`Bus ID: ${busData?.busNumber} -> ${formData.busNumber}`);
    if (busData?.capacity !== parseInt(formData.capacity)) changes.push(`Capacity: ${busData?.capacity} -> ${formData.capacity}`);
    if (busData?.color !== formData.color) changes.push(`Color: ${busData?.color} -> ${formData.color}`);
    if (busData?.shift !== formData.shift) changes.push(`Shift: ${busData?.shift} -> ${formData.shift}`);

    const oldDriver = busData?.assignedDriverId || busData?.driverUID;
    if (oldDriver !== formData.driverUID) {
      const dName = drivers.find(d => (d.uid || d.id) === formData.driverUID)?.fullName || "New Driver";
      changes.push(`Driver: Reassigning to ${dName}`);
    }

    if (busData?.routeId !== formData.routeId) {
      const rName = routes.find(r => (r.routeId || r.id) === formData.routeId)?.routeName || "New Route";
      changes.push(`Route: Changing to ${rName}`);
    }

    const mDiff = (parseInt(formData.morningLoad) || 0) - (busData?.load?.morningCount || 0);
    const eDiff = (parseInt(formData.eveningLoad) || 0) - (busData?.load?.eveningCount || 0);
    if (mDiff !== 0) changes.push(`Morning Load: ${mDiff > 0 ? '+' : ''}${mDiff}`);
    if (eDiff !== 0) changes.push(`Evening Load: ${eDiff > 0 ? '+' : ''}${eDiff}`);

    if (changes.length === 0) {
      addToast('No changes detected', 'info');
      return;
    }

    setChangeSummary(changes);
    setIsConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setIsConfirmOpen(false);
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

      addToast('Bus updated successfully', 'success');

      // Signal the buses list page to refresh when it's rendered
      signalCollectionRefresh('buses');

      router.push('/admin/buses');

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

  return (
    <div className="mt-10 py-4 bg-[#010717] min-h-screen">
      <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Edit Bus</h1>
            <p className="text-gray-400 text-xs">Update bus registration, capacity and route assignment</p>
          </div>
          <Link
            href="/admin/buses"
            className="inline-flex items-center px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-sm border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 hover:shadow-lg"
          >
            Back
          </Link>
        </div>

        {activeTripWarning && (
          <Alert className="mb-6 border-amber-500/50 bg-amber-500/10 text-amber-500">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Active Trip in Progress</AlertTitle>
            <AlertDescription>
              Some fields (Driver, Route) are locked until the current trip ends.
            </AlertDescription>
          </Alert>
        )}

        <div className="bg-gradient-to-br from-[#0E0F12] to-[#1A1B23] rounded-2xl shadow-2xl border border-white/10 p-4 sm:p-10 hover:border-white/20 transition-all duration-300">
          <form onSubmit={handlePreSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {/* Bus ID - Read Only */}
              <div>
                <Label htmlFor="busId" className="block text-xs font-medium text-gray-300 mb-1">Bus ID (Read-only)</Label>
                <Input id="busId" value={formData.busId} disabled className="bg-gray-800/50 border-gray-700 text-gray-400 cursor-not-allowed" />
              </div>

              {/* Bus Number */}
              <div>
                <Label htmlFor="busNumber" className="block text-xs font-medium text-gray-300 mb-1">Bus Number <span className="text-red-500">*</span></Label>
                <Input
                  id="busNumber"
                  value={formData.busNumber}
                  onChange={(e) => handleInputChange('busNumber', e.target.value)}
                  className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
                {errors.busNumber && <p className="text-red-500 text-[10px] mt-0.5">{errors.busNumber}</p>}
              </div>

              {/* Color */}
              <div>
                <Label htmlFor="color" className="block text-xs font-medium text-gray-300 mb-1">Color <span className="text-red-500">*</span></Label>
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

              {/* Driver - Disabled if active trip */}
              <div>
                <Label htmlFor="driver" className="block text-xs font-medium text-gray-300 mb-1">
                  Driver <span className="text-red-500">*</span>
                  {activeTripWarning && <span className="ml-2 text-[10px] text-amber-500">Locked (Active Trip)</span>}
                </Label>
                <Select
                  value={formData.driverUID}
                  onValueChange={(val) => handleInputChange('driverUID', val)}
                  disabled={!!busData?.activeTripId}
                >
                  <SelectTrigger className={`border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${busData?.activeTripId ? 'opacity-50 cursor-not-allowed' : ''}`}>
                    <SelectValue placeholder="Select Driver" />
                  </SelectTrigger>
                  <SelectContent position="popper" side="bottom" align="start" className="max-h-80 bg-gray-900 border-gray-700">
                    <div className="px-2 py-1.5 text-xs font-bold text-yellow-500 uppercase tracking-wider bg-gray-800/50">
                      Reserved
                    </div>
                    {drivers.filter(d => !d.busId || d.busId === formData.busId || d.busId === id || d.uid === formData.driverUID).map(driver => (
                      <SelectItem key={driver.uid} value={driver.uid || ''}>{driver.fullName || driver.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.driverUID && <p className="text-red-500 text-[10px] mt-0.5">{errors.driverUID}</p>}
              </div>

              {/* Capacity */}
              <div>
                <Label htmlFor="capacity" className="block text-xs font-medium text-gray-300 mb-1">Total Capacity <span className="text-red-500">*</span></Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Input
                        id="capacity"
                        type="number"
                        value={formData.capacity}
                        onChange={(e) => handleInputChange('capacity', e.target.value)}
                        className="border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </TooltipTrigger>
                    <TooltipContent className="bg-gray-800 border-gray-700 text-white">
                      <p>Currently assigned: {(parseInt(formData.morningLoad) || 0) + (parseInt(formData.eveningLoad) || 0)} students</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {errors.capacity && <p className="text-red-500 text-[10px] mt-0.5">{errors.capacity}</p>}
              </div>

              {/* Route */}
              <div className="relative">
                <Label htmlFor="route" className="block text-xs font-medium text-gray-300 mb-1">
                  Route <span className="text-red-500">*</span>
                  {activeTripWarning && <span className="ml-2 text-[10px] text-amber-500">Locked (Active Trip)</span>}
                </Label>
                <div className="relative flex items-center">
                  <Select
                    value={formData.routeId}
                    onValueChange={(val) => handleInputChange('routeId', val)}
                    disabled={!!busData?.activeTripId}
                  >
                    <SelectTrigger className={`flex-1 border-2 border-gray-300 dark:border-white/10 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white pr-14 ${busData?.activeTripId ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      <SelectValue placeholder="Select Route" />
                    </SelectTrigger>
                    <SelectContent position="popper" side="bottom" align="start" className="max-h-60">
                      {routes.map(r => (
                        <SelectItem key={r.routeId || r.id} value={(r.routeId || r.id) || ''}>{formatRouteDisplay(r)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formData.routeId && (
                    <div className="absolute right-10 top-1/2 -translate-y-1/2 flex items-center">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button" className="text-gray-400 hover:text-white transition-colors"><Info className="h-4 w-4" /></button>
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

              {/* Status */}
              <div>
                <Label htmlFor="status" className="block text-xs font-medium text-gray-300 mb-1">Status <span className="text-red-500">*</span></Label>
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

              {/* Shift */}
              <div>
                <Label htmlFor="shift" className="block text-xs font-medium text-gray-300 mb-1">Shift <span className="text-red-500">*</span></Label>
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
            <div className="flex space-x-4 pt-4 border-t border-white/5 mt-4">
              <div className="flex-1">
                <Label className="block text-xs font-medium text-gray-300 mb-1">Morning Students</Label>
                <Input type="number" value={formData.morningLoad} onChange={(e) => handleInputChange('morningLoad', e.target.value)} disabled={!formData.shift || formData.shift === "Evening"} className={`bg-gray-800/50 border-gray-700 text-white ${(!formData.shift || formData.shift === "Evening") ? 'opacity-50 cursor-not-allowed' : ''}`} />
              </div>
              <div className="flex-1">
                <Label className="block text-xs font-medium text-gray-300 mb-1">Evening Students</Label>
                <Input type="number" value={formData.eveningLoad} onChange={(e) => handleInputChange('eveningLoad', e.target.value)} disabled={!formData.shift || formData.shift === "Morning"} className={`bg-gray-800/50 border-gray-700 text-white ${(!formData.shift || formData.shift === "Morning") ? 'opacity-50 cursor-not-allowed' : ''}`} />
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-6 border-t border-white/10">
              <Button type="button" onClick={handleReset} className="bg-blue-600 hover:bg-blue-700 text-white min-w-[80px]">Reset</Button>
              <Link href="/admin/buses"><Button type="button" className="bg-red-600 hover:bg-red-700 text-white min-w-[80px]">Cancel</Button></Link>
              <Button type="submit" disabled={submitting} className="bg-green-600 hover:bg-green-700 text-white min-w-[120px]">
                {submitting ? "Checking..." : "Update Bus"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Confirm Bus Updates</DialogTitle>
            <DialogDescription className="text-gray-400">
              The following changes will be applied to the bus and related systems:
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-2">
            {changeSummary.map((change, i) => (
              <div key={i} className="flex items-center text-sm p-2 bg-gray-800 rounded border border-gray-700">
                <span className="h-2 w-2 rounded-full bg-blue-500 mr-3"></span>
                {change}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfirmOpen(false)} className="border-gray-600 text-gray-300 hover:bg-gray-800">Cancel</Button>
            <Button onClick={handleConfirmSubmit} className="bg-green-600 hover:bg-green-700 text-white">
              {submitting ? "Saving..." : "Confirm & Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}