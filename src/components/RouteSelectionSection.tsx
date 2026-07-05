"use client";

import { useState, useEffect, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/contexts/toast-context';
import { Route } from '@/lib/types';
import { Loader2, AlertCircle, CheckCircle, Info } from 'lucide-react';
import {
  checkBusCapacity,
  checkCapacityForApplication,
  CapacityCheckResult,
  BusCapacityInfo
} from '@/lib/bus-capacity-checker';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface RouteSelectionSectionProps {
  routes: Route[];
  buses: any[]; // Using any because Bus type might vary slightly across generic usage
  selectedRouteId: string;
  selectedBusId: string;
  selectedStopId: string;
  selectedShift?: string; // Added: shift selection for capacity check
  busAssigned?: string; // Optional restoration of display text
  onReferenceChange: (field: string, value: any) => void; // Generic handler for parent state updates
  onCapacityCheckResult?: (result: CapacityCheckResult | null) => void;
  isReadOnly?: boolean;
  shiftContent?: React.ReactNode;
  children?: React.ReactNode;
  extraLabelMargin?: boolean;
  hideCapacityAlerts?: boolean;
}

export default function RouteSelectionSection({
  routes,
  buses,
  selectedRouteId,
  selectedBusId,
  selectedStopId,
  selectedShift,
  busAssigned,
  onReferenceChange,
  onCapacityCheckResult,
  isReadOnly = false,
  shiftContent,
  children,
  extraLabelMargin = false,
  hideCapacityAlerts = false
}: RouteSelectionSectionProps) {
  const { showToast } = useToast();

  // Local state for UI
  const [associatedBuses, setAssociatedBuses] = useState<any[]>([]);
  const [stops, setStops] = useState<any[]>([]);
  const [checkingCapacity, setCheckingCapacity] = useState(false);
  const [simpleCapacityInfo, setSimpleCapacityInfo] = useState<BusCapacityInfo | null>(null);
  const [detailedCapacityResult, setDetailedCapacityResult] = useState<CapacityCheckResult | null>(null);
  const [busAssignedDisplay, setBusAssignedDisplay] = useState(busAssigned || '');
  const [showStops, setShowStops] = useState(false);

  useEffect(() => {
    // Sync bus assigned display when selectedBusId changes (e.g. loaded from draft) or loaded buses change
    if (selectedBusId && associatedBuses.length > 0) {
      const bus = associatedBuses.find(b => (b.id || b.busId) === selectedBusId);
      if (bus) {
        setBusAssignedDisplay(formatBusDisplay(bus));
        // Also run simple check if not already running
        if (!simpleCapacityInfo && !checkingCapacity) {
          checkSimpleCapacity(selectedBusId);
        }
      }
    }
  }, [selectedBusId, associatedBuses]);

  // Update stops and buses when route changes
  useEffect(() => {
    if (!selectedRouteId) {
      setAssociatedBuses([]);
      setStops([]);
      setBusAssignedDisplay('');
      return;
    }

    const selectedRoute = routes.find(r => r.routeId === selectedRouteId);
    if (selectedRoute) {
      // Set stops
      const stopsArray = Array.isArray(selectedRoute.stops) ? selectedRoute.stops : [];
      setStops(stopsArray);

      // Find all buses associated with this route
      let associated = buses.filter(bus =>
        bus.routeId === selectedRouteId ||
        (selectedRoute as any).busId === bus.id
      );

      // Filter buses based on shift if shift is selected
      // Bus shift field can be "Morning" or "Both"
      // If student selects "Morning" shift -> show buses with shift "Morning" or "Both"
      // If student selects "Evening" shift -> show buses with shift "Both" only (evening buses must support both shifts)
      if (selectedShift) {
        associated = associated.filter(bus => {
          const busShift = bus.shift || 'Both'; // Default to 'Both' if not specified
          if (selectedShift === 'Morning') {
            return busShift === 'Morning' || busShift === 'Both';
          } else if (selectedShift === 'Evening') {
            return busShift === 'Both'; // Only buses that run both shifts can serve evening
          }
          return true;
        });
      }

      setAssociatedBuses(associated);
    }
  }, [selectedRouteId, routes, buses, selectedShift]);

  // Helper to format bus display
  const formatBusDisplay = (bus: any) => {
    const busIdVal = bus.id || bus.busId || '';

    // Determine the bus number/index (X)
    let index = bus.busNo || bus.displayIndex || bus.sequenceNumber;

    // If no explicit index, try to extract from ID (e.g. "bus_2" -> "2")
    if (!index && busIdVal.includes('_')) {
      const parts = busIdVal.split('_');
      // Check if the part after score is numeric (or short string)
      if (parts[1] && parts[1].length < 5) {
        index = parts[1];
      }
    }

    // Fallback: if busNumber is short (likely an index), use it. 
    // Otherwise if it looks like a plate, use '?' or rely on extraction.
    if (!index) {
      if (bus.busNumber && bus.busNumber.length < 5) {
        index = bus.busNumber;
      } else {
        // Extract from "Bus-1" style names if name exists
        const nameMatch = bus.name?.match(/Bus[- ]?(\d+)/i);
        if (nameMatch) {
          index = nameMatch[1];
        } else {
          index = '?';
        }
      }
    }

    // Determine the license plate
    // Some data might have plate in busNumber if licensePlate is missing
    const licensePlate = bus.licensePlate || bus.plateNumber ||
      (bus.busNumber && bus.busNumber.length > 5 ? bus.busNumber : 'N/A');

    return `Bus-${index} (${licensePlate})`;
  };

  // Handle Route Selection
  const handleRouteSelect = (routeId: string) => {
    console.log('🛣️ Route changed to:', routeId);
    onReferenceChange('routeId', routeId);

    // Clear stop and bus selection
    onReferenceChange('stopId', '');
    onReferenceChange('busId', '');
    onReferenceChange('busAssigned', '');
    setShowStops(false);

    setDetailedCapacityResult(null);
    if (onCapacityCheckResult) onCapacityCheckResult(null);
    setSimpleCapacityInfo(null);
    setBusAssignedDisplay('');

    // Filter buses for logic - also consider shift
    let associated = buses.filter(bus =>
      bus.routeId === routeId ||
      (routes.find(r => r.routeId === routeId) as any)?.busId === bus.id
    );

    // Filter by shift if selected
    if (selectedShift) {
      associated = associated.filter(bus => {
        const busShift = bus.shift || 'Both';
        if (selectedShift === 'Morning') {
          return busShift === 'Morning' || busShift === 'Both';
        } else if (selectedShift === 'Evening') {
          return busShift === 'Both';
        }
        return true;
      });
    }

    if (associated.length === 1) {
      // Case 1: Single Bus - Auto-select and check capacity
      const bus = associated[0];
      const displayString = formatBusDisplay(bus);

      setBusAssignedDisplay(displayString);
      onReferenceChange('busId', bus.id || bus.busId);
      onReferenceChange('busAssigned', displayString);

      // Immediate simple capacity check with shift consideration
      checkSimpleCapacity(bus.id || bus.busId);
    } else {
      // Case 2: Multiple or No Buses - Reset display to let user choose or show empty
      setBusAssignedDisplay('');
    }
  };

  // Handle Bus Selection (for Dropdown case matches Case 2)
  const handleBusSelect = (busId: string) => {
    onReferenceChange('busId', busId);

    const bus = associatedBuses.find(b => (b.id || b.busId) === busId);
    if (bus) {
      const displayString = formatBusDisplay(bus);

      onReferenceChange('busAssigned', displayString);
      setBusAssignedDisplay(displayString);

      // Run simple capacity check after selection
      checkSimpleCapacity(busId);

      // NOTE: Do NOT run detailed capacity check on bus selection
      // Per requirements: capacity check only runs on ROUTE selection
    }
  };

  // Handle Stop Selection
  // NOTE: Per requirements, NO capacity check runs on stop selection
  // Only the route selection triggers the capacity check
  const handleStopSelect = (stopId: string) => {
    // We store the stopId (value) which might be an ID or name depending on data
    onReferenceChange('stopId', stopId);

    // Do NOT run any capacity check here - as per requirements:
    // - Shift selection: Nothing happens
    // - Route selection: Check runs
    // - Stop selection: Nothing happens (no loading spinner, no check)
  };

  // Helper: Simple Bus Capacity Check
  const checkSimpleCapacity = async (busId: string) => {
    if (!busId) return;

    setCheckingCapacity(true);
    // Clear detailed result to avoid confusion if we are re-selecting bus
    // But keep it if we are just switching buses

    try {
      const info = await checkBusCapacity(busId, selectedShift);
      setSimpleCapacityInfo(info);

      if (info) {
        if (info.isFull) {
          // Toast warning removed per requirement, UI will handle indication via Alert circle below input
          console.log(`⚠️ Selected bus ${info.busNumber} is currently FULL for ${selectedShift || 'selected'} shift`);
        }
      }
    } catch (error) {
      console.error('Error checking bus capacity:', error);
    } finally {
      setCheckingCapacity(false);
    }
  };

  // Helper: Detailed Application Capacity Check
  const checkDetailedCapacity = async (routeId: string, stopId: string, stopName: string, busId?: string) => {
    if (!routeId || !stopId) return;

    setCheckingCapacity(true);
    setDetailedCapacityResult(null);
    setSimpleCapacityInfo(null); // Clear simple info to prioritize detailed result

    try {
      const result = await checkCapacityForApplication(routeId, stopId, stopName, busId, selectedShift);
      setDetailedCapacityResult(result);
      if (onCapacityCheckResult) onCapacityCheckResult(result);

      // Handle the three cases with appropriate UI logic (Toasts muted per requirement)
      if (!hideCapacityAlerts && (result.isFull || result.needsCapacityReview)) {
        if (result.hasAlternatives && result.alternativeBuses.length > 0) {
          // Case 2A: Bus is full but alternatives exist
          // Auto-select alternative if only one exists
          if (result.alternativeBuses.length === 1) {
            const altBus = result.alternativeBuses[0];
            onReferenceChange('busId', altBus.busId);
            const displayString = `Bus-${altBus.busId.split('_')[1] || '?'} (${altBus.busNumber})`;
            onReferenceChange('busAssigned', displayString);
            setBusAssignedDisplay(displayString);
          }
        }
        // Case 1 & 2B: Bus is full, no alternatives - handled by rendered Alert component
      }
      // Case 3: Bus has available capacity - silent success
    } catch (error) {
      console.error('Error checking detailed capacity:', error);
    } finally {
      setCheckingCapacity(false);
    }
  };

  const formatRouteDisplay = (route: Route) => {
    if (!route.stops || route.stops.length === 0) {
      return (
        <span className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="text-blue-500 font-semibold">{route.routeName}</span>
          <span className="text-gray-500 dark:text-gray-400">→ (No stops)</span>
        </span>
      );
    }

    const stopNames = route.stops.map((stop: any) => stop.name || stop.stopName || stop);
    let displayStops = '';

    if (stopNames.length <= 4) {
      displayStops = stopNames.join(', ');
    } else {
      const firstThree = stopNames.slice(0, 3).join(', ');
      const lastStop = stopNames[stopNames.length - 1];
      displayStops = `${firstThree}.. ${lastStop}`;
    }

    return (
      <div className="flex items-center gap-1 overflow-hidden min-w-0">
        <span className="text-blue-500 font-semibold shrink-0">{route.routeName}</span>
        <span className="text-gray-500 dark:text-gray-400 truncate">→ {displayStops}</span>
      </div>
    );
  };

  // Trigger detailed capacity check when route and stop are both selected
  useEffect(() => {
    if (selectedRouteId && selectedStopId) {
      const stopObj = stops.find(s => (s.stopId || s.id || s.name) === selectedStopId);
      const stopName = stopObj ? (stopObj.name || stopObj.stopName || selectedStopId) : selectedStopId;
      checkDetailedCapacity(selectedRouteId, selectedStopId, stopName, selectedBusId);
    }
  }, [selectedRouteId, selectedStopId, selectedBusId, selectedShift, stops]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
        {/* Slot 0: Shift Content (if provided) */}
        {shiftContent && (
          <div className="space-y-1">
            {shiftContent}
          </div>
        )}

        {/* Slot 1: Route Selection */}
        <div className="space-y-1">
          <Label htmlFor="routeId" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Route <span className="text-red-500">*</span>
          </Label>

          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <Select
                key={selectedRouteId}
                value={selectedRouteId}
                onValueChange={handleRouteSelect}
                disabled={isReadOnly || !selectedShift}
              >
                <SelectTrigger className="h-10 bg-blue-600/5 border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs text-slate-200">
                  <SelectValue placeholder={!selectedShift ? "Select Shift First" : "Select Route"} />
                </SelectTrigger>
                <SelectContent className="max-h-[300px] w-[var(--radix-select-trigger-width)] min-w-[280px] md:min-w-[350px] bg-slate-900 border-slate-800">
                  {routes.map((route) => (
                    <SelectItem key={route.routeId} value={route.routeId} className="text-xs">
                      {formatRouteDisplay(route)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedRouteId && (
              <Dialog>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="h-10 w-10 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-md cursor-pointer text-indigo-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors shrink-0 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-xs md:max-w-sm bg-[#12131A] text-white border-white/10 shadow-2xl rounded-2xl p-6">
                  <DialogHeader className="border-b border-slate-800 pb-3 mb-4">
                    <DialogTitle className="text-sm font-bold uppercase tracking-wider text-indigo-400">
                      Stops in this route
                    </DialogTitle>
                  </DialogHeader>
                  <div className="max-h-60 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                    {stops.length > 0 ? (
                      <ul className="space-y-3">
                        {stops.map((stop: any, idx) => (
                          <li key={idx} className="text-xs text-slate-300 flex items-start gap-3">
                            <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                            <span className="leading-tight font-medium">{stop.name || stop.stopName || stop}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500 italic">No stops data available.</p>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Slot 3: Pickup Point / Stop Selection */}
        <div className="space-y-1 transition-all duration-300 ease-in-out">
          <Label htmlFor="stopId" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Pickup Point / Stop <span className="text-red-500">*</span>
          </Label>

          {selectedRouteId ? (
            <Select
              key={selectedStopId}
              value={selectedStopId}
              onValueChange={handleStopSelect}
              disabled={isReadOnly || stops.length === 0}
            >
              <SelectTrigger className="h-10 bg-blue-600/5 border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs text-slate-200">
                <SelectValue placeholder="Select Stop" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px] bg-slate-900 border-slate-800">
                {stops.slice(0, -1).map((stop: any, index: number) => {
                  const val = stop.stopId || stop.id || stop.name;
                  const display = stop.name || stop.stopName || val;
                  return (
                    <SelectItem key={`${val}-${index}`} value={val} className="text-xs">
                      {display}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            <Select disabled>
              <SelectTrigger className="h-10 bg-slate-900/30 border-slate-800 text-slate-600 text-xs text-left italic">
                <SelectValue placeholder="Select a route first" />
              </SelectTrigger>
            </Select>
          )}
        </div>

        {/* Slot 2: Bus Selection */}
        <div className="space-y-1 transition-all duration-300 ease-in-out">
          <Label htmlFor="busId" className="block text-[11px] font-bold tracking-wider text-slate-500 uppercase mb-2">
            Bus Assignment
          </Label>

          {selectedRouteId ? (
            associatedBuses.length > 1 ? (
              // Case 2: Bus Dropdown
              <Select
                key={selectedBusId}
                value={selectedBusId}
                onValueChange={handleBusSelect}
                disabled={isReadOnly}
              >
                <SelectTrigger className="h-10 bg-blue-600/5 border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-xs text-slate-200">
                  <SelectValue placeholder="Select Bus" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                  {associatedBuses.map((bus) => {
                    return (
                      <SelectItem key={bus.id || bus.busId} value={bus.id || bus.busId} className="text-xs">
                        {formatBusDisplay(bus)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : (
              // Case 1: Read-only Input
              <div className="relative group">
                <Input
                  value={busAssignedDisplay || (associatedBuses.length === 0 ? "No bus available" : "Loading...")}
                  readOnly
                  className="h-10 bg-slate-900/50 border-slate-800 text-slate-400 cursor-not-allowed text-xs focus-visible:ring-0"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                   {checkingCapacity ? <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /> : <div className="w-2 h-2 rounded-full bg-indigo-500/20" />}
                </div>
              </div>
            )
          ) : (
            // Case 3: No Route Selected - Show disabled placeholder
            <Input
              value="Select a route first"
              readOnly
              disabled
              className="h-10 bg-slate-900/30 border-slate-800 text-slate-600 cursor-not-allowed text-xs italic"
            />
          )}
        </div>
      </div>

      {/* Detailed Capacity Feedback Alert - Full width below the grid */}
      {
        !hideCapacityAlerts && detailedCapacityResult && !checkingCapacity && (
          // Only show if there's an issue
          detailedCapacityResult.isFull ? (
            detailedCapacityResult.hasAlternatives && detailedCapacityResult.alternativeBuses.length > 0 ? (
              // Case 2A: Bus full but alternatives exist - show alternative buses
              <Alert variant="destructive" className="mt-3 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                <div className="flex items-start">
                  <AlertCircle className="h-4 w-4 mr-2 mt-0.5" />
                  <div className="flex-1">
                    <AlertDescription className="font-medium text-xs">
                      The selected bus is on maximum load for the selected shift.
                    </AlertDescription>

                    <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-blue-800 dark:text-blue-300">
                      <p className="font-semibold text-xs mb-1.5">
                        {detailedCapacityResult.alternativeBuses.length === 1
                          ? "This bus also serves the selected stop:"
                          : "These buses also serve the selected stop. Please pick any of them:"}
                      </p>
                      <ul className="space-y-1 text-xs">
                        {detailedCapacityResult.alternativeBuses.map((bus, idx) => (
                          <li key={idx} className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                            <span className="font-medium">{bus.busNumber}</span>
                            <span className="text-blue-600 dark:text-blue-400">
                              ({bus.availableSeats} seats available)
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </Alert>
            ) : (
              // Case 1 & 2B: Bus full and no alternatives - show admin review message
              <Alert variant="destructive" className="mt-3 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                <div className="flex items-start">
                  <AlertCircle className="h-4 w-4 mr-2 mt-0.5" />
                  <div className="flex-1">
                    <AlertDescription className="text-xs">
                      Your application will be reviewed by the administrative team after submission, for final bus assignment.
                    </AlertDescription>
                  </div>
                </div>
              </Alert>
            )
          ) : null
        )
      }
    </div >
  );
}
