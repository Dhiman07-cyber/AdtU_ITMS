"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportToExcel } from '@/lib/export-helpers';
import { ExportButton } from '@/components/ExportButton';
import { useToast } from '@/contexts/toast-context';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  Bus,
  Users,
  MapPin,
  Filter,
  Route as RouteIcon
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteBus } from "@/lib/dataService";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useApiCollection, invalidateCollectionCache } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useAuth } from '@/contexts/auth-context';
import { RefreshCw } from "lucide-react";
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';

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
  assignedBusId?: string;
  assignedRouteId?: string;
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
    stopId: string;
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
  const { data: students, loading: loadingStudents } = useApiCollection('students', {
    pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc', autoRefresh: false,
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

  const isLoading = loadingBuses || loadingDrivers || loadingRoutes || loadingStudents;

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

  // Real-time listeners handle data fetching automatically

  // Memoized so the bus list isn't re-filtered/re-sorted on every unrelated
  // re-render — only when the data or active filters actually change.
  const filteredBuses = useMemo(() => buses.filter(bus => {
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
  }), [buses, searchTerm, colorFilter, statusFilter]);

  // Export buses data
  const handleExportBuses = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Generate buses data in the same format as the comprehensive report - sort buses by number
      const sortedBuses = [...buses].sort((a, b) => {
        const numA = extractNumber(a.busId || a.id || '');
        const numB = extractNumber(b.busId || b.id || '');
        return parseInt(numA) - parseInt(numB);
      });

      const busesData = sortedBuses.map((bus, index) => {
        // Buses have complete route object nested in them (bus.route)
        // First try bus.route, then lookup from routes collection
        let routeInfo = bus.route;
        if (!routeInfo) {
          routeInfo = routes.find(r =>
            r.id === (bus.routeId || bus.assignedRouteId) ||
            r.routeId === (bus.routeId || bus.assignedRouteId)
          );
        }

        // Get route name
        const routeName = routeInfo?.routeName || routeInfo?.route || 'Not Assigned';

        // Get stops from route (bus.route.stops or route collection)
        let stops = 'N/A';
        if (routeInfo && routeInfo.stops) {
          if (Array.isArray(routeInfo.stops)) {
            stops = routeInfo.stops.map((s: any) => s.stopName || s.name || s).join(', ');
          } else if (typeof routeInfo.stops === 'string') {
            stops = routeInfo.stops;
          }
        }

        // Find assigned driver - use CORRECT Firestore fields
        // Firestore stores: activeDriverId (current) and assignedDriverId (permanent)
        const driverIdToFind = bus.activeDriverId || bus.assignedDriverId;
        const assignedDriver = driverIdToFind ? drivers.find(d => d.id === driverIdToFind) : null;

        const totalStudents = students?.filter(s =>
          s.busId === bus.id ||
          s.busId === bus.busId ||
          s.assignedBusId === bus.id ||
          s.assignedBusId === bus.busId ||
          s.currentBusId === bus.id ||
          s.currentBusId === bus.busId
        ).length || 0;

        return [
          (index + 1).toString(),
          `Bus-${extractNumber(bus.busId || bus.id)}`,
          routeName,
          stops,
          assignedDriver ? (assignedDriver.fullName || assignedDriver.name || 'Unknown Driver') : 'Not Assigned',
          bus.shift ? bus.shift.charAt(0).toUpperCase() + bus.shift.slice(1) : 'N/A',
          totalStudents.toString()
        ];
      });

      // Add headers
      busesData.unshift([
        'Sl No', 'Bus Number', 'Route Number', 'All Stops', 'Driver Assigned', 'Shift', 'Total Students'
      ]);

      // Add section header
      busesData.unshift(['ALL BUSES'], ['']);

      // Export to Excel
      await exportToExcel(busesData, `ADTU_Buses_Report_${dateStr}`, 'Buses');

      addToast(
        `Buses data exported to ADTU_Buses_Report_${dateStr}.xlsx`,
        'success'
      );
    } catch (error) {
      console.error('❌ Error exporting buses:', error);
      addToast(
        'Failed to export buses data. Please try again.',
        'error'
      );
    }
  };

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
      driver = drivers.find(d => d.assignedRouteId === routeNumber);
      if (driver) {
        return driver.fullName || driver.name || 'Unknown Driver';
      }
    }

    return 'No Driver Assigned';
  };


  // Function to get route name for a specific bus
  const getRouteNameForBus = (bus: any) => {
    // 1. Try finding in routes collection first (Canonical source)
    const routeIdToCheck = bus.routeId || bus.assignedRouteId;
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

  if (isLoading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  if (!permsLoading && !canBusView) {
    return <PermissionDeniedCard title="Buses Section Restricted" actionName="Viewing Buses" showGoBack={false} />;
  }

  return (
    <div className="mt-12 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold dark:text-white">Bus Management</h1>
          <p className="text-muted-foreground">
            Manage all buses in the service fleet
          </p>
        </div>
        <div className="flex gap-2">
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
              className="w-full md:w-auto cursor-pointer bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white border-0 transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25 rounded-md px-2.5 py-1.5 text-xs h-8"
              onClick={() => router.push('/moderator/route-allocation')}
              title="Manage route reassignments for buses"
            >
              <RouteIcon className="mr-1.5 h-3.5 w-3.5" />
              Bus Reassignment
            </Button>
          )}
          <ExportButton
            onClick={() => handleExportBuses()}
            label="Export Buses"
            className="bg-white hover:bg-gray-100 !text-black border border-gray-300 transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8"
          />
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="group h-8 px-4 bg-white hover:bg-gray-50 text-gray-600 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95"
          >
            <RefreshCw className={`mr-2 h-3.5 w-3.5 transition-transform duration-500 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180'}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="bg-gray-50 dark:bg-gray-900 border-border">
        <CardContent className="pt-3">
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

              {/* Filters - Side by side on Mobile */}
              <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                <Filter className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />

                <Select value={colorFilter} onValueChange={setColorFilter}>
                  <SelectTrigger className="h-8 text-xs min-w-[120px] flex-1 md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Color" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Colors</SelectItem>
                    <SelectItem value="White" className="text-xs">White</SelectItem>
                    <SelectItem value="Yellow" className="text-xs">Yellow</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-xs min-w-[120px] flex-1 md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
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
                    className="h-8 px-3 text-xs bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="students-section">
            <div className="students-scroll-wrapper rounded-md border" role="region" aria-label="Bus list">
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
                  {filteredBuses.map((bus) => (
                    <TableRow key={bus.id}>
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
                              className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 text-sm cursor-pointer"
                              onClick={() => router.push(`/moderator/buses/view/${bus.id}`)}
                            >
                              <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                              View Details
                            </DropdownMenuItem>
                            {canBusEdit && (
                              <DropdownMenuItem
                                className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 text-sm cursor-pointer"
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
                                  className="text-white hover:!bg-red-600 focus:!bg-red-600 px-2 py-1.5 text-sm cursor-pointer transition-colors"
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
                  ))}
                </TableBody>
              </Table>
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
    </div>
  );
}
