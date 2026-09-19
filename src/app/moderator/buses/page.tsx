"use client";

import { ExportButton } from '@/components/ExportButton';
import { TableRowLoader } from '@/components/LoadingSpinner';
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useToast } from '@/contexts/toast-context';
import { deleteBus } from "@/lib/dataService";
import { exportToExcel } from '@/lib/export-helpers';
import { supabase } from '@/lib/supabase-client';
import { cn } from "@/lib/utils";
import {
	Bus,
	Compass,
	Download,
	Edit,
	Eye,
	Filter,
	MoreHorizontal,
	Plus,
	Route as RouteIcon,
	Search,
	Trash2,
	Users
} from "lucide-react";
import { useRouter } from 'next/navigation';
import { useState } from "react";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';
import { useAuth } from '@/contexts/auth-context';
import { invalidateCollectionCache,useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { RefreshCw } from "lucide-react";
import { MobileActionFAB } from '@/components/layout/MobileActionFAB';

// Use local interfaces to avoid type conflicts
interface BusItem {
  id: string;
  busId: string;
  busNumber: string;
  model: string;
  capacity: number;
  driverUID: string;
  driverName: string;
  routeId: string;
  routeName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface DriverItem {
  id: string;
  name: string;
  fullName?: string;
  email: string;
  phone?: string;
  alternatePhone?: string;
  licenseNumber?: string;
  busId?: string;
  routeId?: string;
  employeeId?: string;
  joiningDate?: string;
  createdAt?: string;
  tripActive?: boolean;
  activeTripId?: string;
}

// Define our own extended route interface to match the actual API response
interface ExtendedRoute {
  id: string;
  routeId: string;
  routeName: string;
  route: string;
  stops: Array<{
    stop_name: string;
    name: string;
    lat: number;
    lng: number;
    sequence: number;
  }>;
  totalStops: number;
  assignedBuses: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function BusesPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { currentUser, userData, loading: authLoading } = useAuth();
  const { canBusView, canBusAdd, canBusEdit, canBusDelete, canBusReassign, loading: permsLoading } = useModeratorPermissions();

  // Server-side API reads from PostgreSQL — no Firestore client reads
  const { data: buses, loading: loadingBuses, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc', autoRefresh: false,
  });
  const { data: drivers, loading: loadingDrivers, refresh: refreshDrivers } = useApiCollection('drivers', {
    pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc', autoRefresh: false,
  });
  const { data: routes, loading: loadingRoutes } = useApiCollection('routes', {
    pageSize: 50, orderByField: 'routeName', orderDirection: 'asc', autoRefresh: false,
  });

  // Event-driven refresh: auto-refresh when mutations occur in other pages
  useEventDrivenRefresh({
    collectionName: 'buses',
    onRefresh: async () => {
      await Promise.all([refreshBuses(), refreshDrivers()]);
    }
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [colorFilter, setColorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isLoading = loadingBuses || loadingDrivers || loadingRoutes;

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refreshBuses(), refreshDrivers()]);
    addToast('Data refreshed', 'success');
    setIsRefreshing(false);
  };

  // Helper function to extract number from string
  const extractNumber = (str: string): string => {
    if (!str) return '0';
    const match = str.match(/\d+/);
    return match ? match[0] : '0';
  };

  // Direct derivation in render
  const filteredBuses = buses.filter(bus => {
    const matchesSearch =
      (bus.busNumber && bus.busNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (bus.routeName && bus.routeName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (bus.busId && bus.busId.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesColor = colorFilter === "all" || (bus.color && bus.color.toLowerCase() === colorFilter.toLowerCase());
    const matchesStatus = statusFilter === "all" || (bus.status && bus.status.toLowerCase() === statusFilter.toLowerCase());

    return matchesSearch && matchesColor && matchesStatus;
  }).sort((a, b) => {
    const numA = extractNumber(a.busId || a.id || '');
    const numB = extractNumber(b.busId || b.id || '');
    return parseInt(numA) - parseInt(numB);
  });

  // Export buses data from Supabase
  const handleExportBuses = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Fetch all buses directly from Supabase PostgreSQL table 'buses'
      const { data: rawBuses, error: busesError } = await supabase
        .from('buses')
        .select('id, bus_number, model, year, capacity, route_id, route_name, status, current_members, morning_load, evening_load')
        .order('bus_number', { ascending: true });

      if (busesError) throw busesError;

      // Fetch routes and drivers for name lookup
      const { data: rawRoutes } = await supabase.from('routes').select('id, route_name, route_number, stops');
      const { data: rawDrivers } = await supabase.from('driver_profiles').select('uid, full_name, name');

      const routeMap = new Map((rawRoutes || []).map((r: any) => [r.id, r]));
      const driverMap = new Map((rawDrivers || []).map((d: any) => [d.uid, d.full_name || d.name]));

      const busesData = (rawBuses || []).map((bus: any, index: number) => {
        const routeObj = routeMap.get(bus.route_id);
        const routeName = routeObj?.route_name || routeObj?.route_number || 'Not Assigned';

        let stops = 'N/A';
        if (routeObj && routeObj.stops) {
          if (Array.isArray(routeObj.stops)) {
            stops = routeObj.stops.map((s: any) => s.stop_name || s.name || s).join(', ');
          } else if (typeof routeObj.stops === 'string') {
            stops = routeObj.stops;
          }
        }

        const driverName = driverMap.get(bus.driver_id) || 'Not Assigned';
        const status = bus.status || 'active';

        return [
          (index + 1).toString(),
          bus.bus_number || 'N/A',
          routeName,
          stops,
          driverName,
          bus.color || 'White',
          bus.capacity ? bus.capacity.toString() : '0',
          status.charAt(0).toUpperCase() + status.slice(1)
        ];
      });

      // Add headers
      busesData.unshift([
        'Sl No', 'Bus Number', 'Route Assigned', 'Stops Summary', 'Driver Assigned', 'Color', 'Capacity', 'Status'
      ]);

      // Add section header
      busesData.unshift(['ALL BUSES REPORT (SUPABASE)'], ['']);

      await exportToExcel(busesData, `ADTU_Buses_Report_${dateStr}`, 'Buses');

      addToast(
        `Exported ${(rawBuses || []).length} buses to ADTU_Buses_Report_${dateStr}.xlsx`,
        'success'
      );
    } catch (error) {
      console.error('❌ Error exporting buses from Supabase:', error);
      addToast(
        'Failed to export buses data. Please try again.',
        'error'
      );
    }
  };

  const commonBtnClass = "group h-8 px-3.5 bg-secondary/80 hover:bg-secondary text-secondary-foreground border border-border/50 shadow-sm font-medium text-xs rounded-lg transition-colors active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

  // Function to get driver name for a specific bus
  const getDriverNameForBus = (bus: any) => {
    // Method 1: Check if bus has direct driver assignment via driverUID
    if (bus.driverUID) {
      const driver = drivers.find(d => d.id === bus.driverUID);
      if (driver) {
        return driver.fullName || driver.name || 'Unknown Driver';
      }
    }

    // Method 2: Match by busId
    let driver = drivers.find(d => d.busId === bus.busId);
    if (driver) {
      return driver.fullName || driver.name || 'Unknown Driver';
    }

    // Method 3: Match by routeId
    driver = drivers.find(d => d.routeId === bus.routeId);
    if (driver) {
      return driver.fullName || driver.name || 'Unknown Driver';
    }

    // Method 4: Fallback to old logic for backwards compatibility
    const route = routes.find(r => r.id === bus.routeId);
    const routeName = route ? (route.routeName || route.route || '') : '';
    const routeNumberMatch = routeName.match(/Route-(\d+)/);
    const routeNumber = routeNumberMatch ? routeNumberMatch[1] : null;

    if (routeNumber) {
      driver = drivers.find(d => d.routeId === routeNumber);
      if (driver) {
        return driver.fullName || driver.name || 'Unknown Driver';
      }
    }

    return 'No Driver Assigned';
  };


  // Function to get route name for a specific bus
  const getRouteNameForBus = (bus: any) => {
    // 1. Try finding in routes collection first (Canonical source)
    const routeIdToCheck = bus.routeId || bus.routeId;
    if (routes && routes.length > 0 && routeIdToCheck) {
      const foundRoute = routes.find(r =>
        r.id === routeIdToCheck ||
        r.routeId === routeIdToCheck
      );
      if (foundRoute) return foundRoute.routeName || foundRoute.route || `Route ${routeIdToCheck}`;
    }

    // 2. Fallback to embedded data (Legacy)
    if (bus.route && bus.route.routeName) {
      return bus.route.routeName;
    }

    return 'No Route Assigned';
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteItem({ id, name });
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;

    try {
      const success = await deleteBus(deleteItem.id);
      if (success) {
        // Refresh data immediately after deletion
        invalidateCollectionCache('buses');
        await Promise.all([refreshBuses(), refreshDrivers()]);
        addToast(`Bus ${deleteItem.name} deleted successfully`, 'success');
        console.log(`Successfully deleted bus: ${deleteItem.name} (${deleteItem.id})`);
      } else {
        console.error('Failed to delete bus');
        // Show error message to user
      }
    } catch (error) {
      console.error('Error deleting bus:', error);
      // Show error message to user
    } finally {
      setIsDialogOpen(false);
      setDeleteItem(null);
    }
  };

  if (authLoading && !currentUser) {
    return (
      <div className="itms-admin-container space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-64 bg-slate-100 dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800" />
      </div>
    );
  }

  if (!permsLoading && !canBusView) {
    return <PermissionDeniedCard title="Buses Section Restricted" actionName="Viewing Buses" showGoBack={false} />;
  }

  return (
    <div className="itms-admin-container space-y-6">
      {/* Page Header */}
      <div className="itms-page-header-container">
        <div className="flex items-center justify-between w-full gap-2">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-foreground truncate leading-tight pb-1">Bus Management</h1>

          {/* Desktop action toolbar */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {canBusAdd && (
              <Button
                className="w-full md:w-auto cursor-pointer bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8"
                onClick={() => router.push('/moderator/buses/add')}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add New Bus
              </Button>
            )}
            {canBusReassign && (
              <Button
                className="w-full md:w-auto cursor-pointer bg-amber-600/90 hover:bg-amber-600 text-white border border-amber-500/30 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md rounded-lg px-2.5 py-1.5 text-xs h-8"
                onClick={() => router.push('/moderator/route-allocation')}
                title="Manage route reassignments for buses"
              >
                <RouteIcon className="mr-1.5 h-3.5 w-3.5" />
                Bus Reassignment
              </Button>
            )}
            <ExportButton
              onClick={() => handleExportBuses()}
              label="Export"
              className={commonBtnClass}
            />
            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={commonBtnClass}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
              <span>Refresh</span>
            </Button>
          </div>

          {/* Mobile Refresh Button - exact same line as Bus Management at rightmost end */}
          <div className="flex md:hidden items-center shrink-0">
            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8 px-3 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 border border-gray-200 dark:border-zinc-700 shadow-sm rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all shrink-0"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin text-blue-600" : "group-hover:rotate-180")} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground mt-1 text-xs sm:text-sm truncate">
          Manage all buses in the service fleet
        </p>
      </div>

      <Card className="bg-gray-50 dark:bg-gray-900 border-border min-h-[480px] flex flex-col">
        <CardContent className="pt-3 flex-1 flex flex-col min-h-0 pb-4">
          <div className="mb-3">
            {/* Search Bar and Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Bar - Top (Full Width on Mobile) */}
              <div className="relative w-full md:flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Search buses..."
                  className="pl-9 h-9 text-xs w-full"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Filters - Side by side on Mobile in the same line */}
              <div className="grid grid-cols-2 gap-2 items-center w-full md:w-auto md:flex md:flex-row">
                <Select value={colorFilter} onValueChange={setColorFilter}>
                  <SelectTrigger className="h-9 md:h-8 text-xs w-full md:w-[140px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Color" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Colors</SelectItem>
                    <SelectItem value="White" className="text-xs">White</SelectItem>
                    <SelectItem value="Yellow" className="text-xs">Yellow</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 md:h-8 text-xs w-full md:w-[140px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
                    <SelectItem value="active" className="text-xs">Active</SelectItem>
                    <SelectItem value="inactive" className="text-xs">Inactive</SelectItem>
                    <SelectItem value="maintenance" className="text-xs">Maintenance</SelectItem>
                  </SelectContent>
                </Select>

                {(colorFilter !== "all" || statusFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setColorFilter("all");
                      setStatusFilter("all");
                    }}
                    className="h-8 px-3 text-xs bg-red-500 hover:bg-red-600 text-white col-span-2 md:col-span-1"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
            <div className="students-scroll-wrapper rounded-md border overflow-x-auto flex-1 flex flex-col min-h-0" role="region" aria-label="Bus list">
              <Table>
                <TableHeader>
                  <TableRow className="h-10">
                    <TableHead className="text-xs font-semibold">Bus Number</TableHead>
                    <TableHead className="text-xs font-semibold">Route</TableHead>
                    <TableHead className="text-xs font-semibold">Color</TableHead>
                    <TableHead className="text-xs font-semibold">Capacity</TableHead>
                    <TableHead className="text-xs font-semibold">Driver</TableHead>
                    <TableHead className="text-xs font-semibold">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && filteredBuses.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="p-6">
                        <TableRowLoader rows={5} />
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredBuses.map((bus) => (
                      <TableRow key={bus.id} style={{ contentVisibility: 'auto', containIntrinsicSize: '0 52px' }}>
                        <TableCell>
                          <div className="flex items-center">
                            <Bus className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span className="font-medium text-sm">{bus.busNumber}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            <span className="font-medium text-sm">{getRouteNameForBus(bus)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{bus.color}</TableCell>
                        <TableCell>
                          <div className="flex items-center text-sm">
                            <Users className="mr-1 h-4 w-4 text-muted-foreground" />
                            {bus.capacity}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{getDriverNameForBus(bus)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${(bus.status === 'active' || bus.status === 'idle' || bus.status === 'enroute') ? 'bg-green-500 text-white' :
                            (bus.status === 'inactive' || bus.status === 'expired') ? 'bg-red-500 text-white' :
                              (bus.status === 'maintenance') ? 'bg-yellow-500 text-white' :
                                'bg-gray-100 text-gray-800'
                            }`}>
                            {(() => {
                              const status = bus.status || 'active';
                              if (status.toLowerCase() === 'idle' || status.toLowerCase() === 'enroute') return 'Active';
                              return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
                            })()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-gray-800 dark:bg-gray-900 border-gray-700 dark:border-gray-600 shadow-xl rounded-lg w-44">
                              <DropdownMenuLabel className="text-white font-semibold px-2 py-1.5 text-sm">Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator className="bg-gray-600" />
                              <DropdownMenuItem
                                className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 text-sm !text-white cursor-pointer"
                                onClick={() => router.push(`/moderator/buses/view/${bus.id}`)}
                              >
                                <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                                View Details
                              </DropdownMenuItem>
                              {canBusEdit && (
                                <DropdownMenuItem
                                  className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 text-sm !text-white cursor-pointer"
                                  onClick={() => router.push(`/moderator/buses/edit/${bus.id}`)}
                                >
                                  <Edit className="mr-2 h-3.5 w-3.5 text-yellow-400" />
                                  Edit Bus
                                </DropdownMenuItem>
                              )}
                              {canBusDelete && (
                                <>
                                  <DropdownMenuSeparator className="bg-gray-600" />
                                  <DropdownMenuItem
                                    className="text-white hover:!bg-red-600 focus:!bg-red-600 px-2 py-1.5 text-sm !text-white cursor-pointer transition-colors"
                                    onClick={() => handleDelete(bus.id, bus.busNumber)}
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    Delete Bus
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {!isLoading && filteredBuses.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground min-h-[220px]">
                  No buses found
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              {deleteItem && `This action cannot be undone. This will permanently delete the bus "${deleteItem.name}" from the system.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className="bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700 font-medium"
              onClick={confirmDelete}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mobile Floating Action Button */}
      <MobileActionFAB
        actions={[
          ...(canBusAdd ? [{
            label: "Add New Bus",
            icon: Plus,
            onClick: () => router.push('/moderator/buses/add'),
          }] : []),
          ...(canBusReassign ? [{
            label: "Bus Reassignment",
            icon: RouteIcon,
            onClick: () => router.push('/moderator/route-allocation'),
          }] : []),
          {
            label: "Fleet Map",
            icon: Compass,
            onClick: () => router.push('/moderator/fleet-map'),
          },
          {
            label: "Export Buses",
            icon: Download,
            onClick: () => handleExportBuses(),
          },
        ]}
      />
    </div>
  );
}
