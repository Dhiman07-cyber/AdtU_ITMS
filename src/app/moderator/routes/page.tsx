"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportToExcel } from '@/lib/export-helpers';
import { ExportButton } from '@/components/ExportButton';
import { useToast } from '@/contexts/toast-context';
import { normalizeRouteStatus } from '@/lib/formatters';
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
  MapPin,
  Clock,
  User,
  Filter,
  Activity,
  Bus as BusIcon
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteRoute } from "@/lib/dataService";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useApiCollection, invalidateCollectionCache } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';

// Use local interfaces to avoid type conflicts
interface RouteItem {
  id: string;
  routeId: string;
  routeName: string;
  stops: any[];
  totalStops: number;
  assignedBuses: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

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
}

export default function RoutesPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { canRouteView, canRouteAdd, canRouteEdit, canRouteDelete, loading: permsLoading } = useModeratorPermissions();

  // Server-side API reads from PostgreSQL — no Firestore client reads
  const { data: routesData, loading: loadingRoutes, refresh: refreshRoutesData } = useApiCollection('routes', {
    pageSize: 50, orderByField: 'routeName', orderDirection: 'asc', autoRefresh: false,
  });
  // Fetch buses to determine assignments
  const { data: buses, loading: loadingBuses, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc', autoRefresh: false,
  });
  const { data: drivers, loading: loadingDrivers, refresh: refreshDrivers } = useApiCollection('drivers', {
    pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc', autoRefresh: false,
  });

  // Event-driven refresh: auto-refresh when mutations occur in other pages
  useEventDrivenRefresh({
    collectionName: 'routes',
    onRefresh: async () => {
      await Promise.all([refreshRoutesData(), refreshBuses(), refreshDrivers()]);
    }
  });

  // Process and combine data — memoized so the per-route bus matching (an
  // O(routes×buses) scan) only runs when routes or buses actually change.
  const routes = useMemo(() => routesData.map((route: any) => {
    // Find buses assigned to this route
    const assignedBusesList = buses.filter((bus: any) =>
      bus.routeId === route.id ||
      bus.routeId === route.routeId ||
      bus.routeRef === `routes/${route.id}` ||
      bus.routeRef === `routes/${route.routeId}`
    );

    return {
      id: route.id,
      routeId: route.routeId || route.id,
      routeName: route.routeName || `Route-${route.routeId?.replace('route_', '')}`,
      totalStops: route.totalStops || (Array.isArray(route.stops) ? route.stops.length : 0),
      status: route.status || 'Active',
      stops: route.stops || [],
      assignedBuses: assignedBusesList
    };
  }), [routesData, buses]);

  const [searchTerm, setSearchTerm] = useState("");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);

  const isLoading = loadingRoutes || loadingBuses || loadingDrivers;

  // Helper function to extract number from route name
  const extractRouteNumber = (str: string): number => {
    if (!str) return 999;
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1]) : 999;
  };

  const filteredRoutes = useMemo(() => routes.filter((route: any) => {
    const matchesSearch =
      (route.routeName && route.routeName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (route.assignedBuses && route.assignedBuses.some((bus: any) =>
        (bus.busNumber && bus.busNumber.toLowerCase().includes(searchTerm.toLowerCase()))
      ));

    const matchesShift = shiftFilter === "all" || (route.status && route.status.toLowerCase() === shiftFilter.toLowerCase());

    return matchesSearch && matchesShift;
  }).sort((a: any, b: any) => {
    const numA = extractRouteNumber(a.routeName || '');
    const numB = extractRouteNumber(b.routeName || '');
    return numA - numB;
  }), [routes, searchTerm, shiftFilter]);

  // Export routes data
  const handleExportRoutes = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Sort routes by number in ascending order (Route-1, Route-2, ..., Route-11)
      const sortedRoutes = [...routes].sort((a, b) => {
        const getRouteNum = (route: any) => {
          const name = route.routeName || route.route || '';
          const match = name.match(/Route-?(\d+)/i);
          return match ? parseInt(match[1]) : 999;
        };
        return getRouteNum(a) - getRouteNum(b);
      });

      // Generate routes data in the same format as the comprehensive report
      const routesData = sortedRoutes.map((route, index) => {
        const stops = route.stops
          ? Array.isArray(route.stops)
            ? route.stops.map((s: any) => s.stopName || s.name || s).join(', ')
            : route.stops
          : 'N/A';



        return [
          (index + 1).toString(),
          route.routeName || 'N/A',
          stops,
          route.totalStops || (Array.isArray(route.stops) ? route.stops.length : 0),
          route.status || 'Active'
        ];
      });

      // Add headers
      routesData.unshift([
        'Sl No', 'Route Number', 'Stops', 'Total Stops', 'Status'
      ]);

      // Add section header
      routesData.unshift(['ALL ROUTES'], ['']);

      // Export to Excel
      await exportToExcel(routesData, `ADTU_Routes_Report_${dateStr}`, 'Routes');

      addToast(
        `Routes data exported to ADTU_Routes_Report_${dateStr}.xlsx`,
        'success'
      );
    } catch (error) {
      console.error('❌ Error exporting routes:', error);
      addToast(
        'Failed to export routes data. Please try again.',
        'error'
      );
    }
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteItem({ id, name });
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;

    try {
      const success = await deleteRoute(deleteItem.id);
      if (success) {
        // Refresh data immediately after deletion
        invalidateCollectionCache('routes');
        await Promise.all([refreshBuses(), refreshDrivers()]);
        console.log(`Successfully deleted route: ${deleteItem.name} (${deleteItem.id})`);
        addToast('Route deleted successfully', 'success');
      } else {
        console.error('Failed to delete route');
        // Show error message to user
      }
    } catch (error) {
      console.error('Error deleting route:', error);
      // Show error message to user
    } finally {
      setIsDialogOpen(false);
      setDeleteItem(null);
    }
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  if (!permsLoading && !canRouteView) {
    return <PermissionDeniedCard title="Routes Section Restricted" actionName="Viewing Routes" showGoBack={false} />;
  }

  return (
    <div className="mt-12 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold dark:text-white">Route Management</h1>
          <p className="text-muted-foreground">
            Manage all bus routes and stops
          </p>
        </div>
        <div className="flex gap-2">
          {canRouteAdd && (
            <Button
              className="w-full md:w-auto cursor-pointer bg-blue-600 hover:bg-blue-700 text-white border border-blue-700 transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8"
              onClick={() => router.push('/moderator/routes/add')}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add New Route
            </Button>
          )}
          <ExportButton
            onClick={() => handleExportRoutes()}
            label="Export Routes"
            className="bg-white hover:bg-gray-100 !text-black border border-gray-300 transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8"
          />
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
                  placeholder="Search routes..."
                  className="pl-9 h-9 text-xs w-full"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Filters - Below Search on Mobile */}
              <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                <Filter className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />

                <Select value={shiftFilter} onValueChange={setShiftFilter}>
                  <SelectTrigger className="h-8 text-xs min-w-[120px] flex-1 md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Shifts</SelectItem>
                    <SelectItem value="active" className="text-xs">Active</SelectItem>
                    <SelectItem value="inactive" className="text-xs">Inactive</SelectItem>
                    <SelectItem value="maintenance" className="text-xs">Maintenance</SelectItem>
                  </SelectContent>
                </Select>

                {shiftFilter !== "all" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShiftFilter("all")}
                    className="h-8 px-3 text-xs bg-red-500 hover:bg-red-600 text-white flex-shrink-0"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="students-section">
            <div className="students-scroll-wrapper rounded-md border" role="region" aria-label="Routes list">
              <Table>
                <TableHeader>
                  <TableRow className="h-10">
                    <TableHead className="text-xs font-semibold">Route Number</TableHead>
                    <TableHead className="text-xs font-semibold">Route</TableHead>
                    <TableHead className="text-xs font-semibold">Stops Count</TableHead>
                    <TableHead className="text-xs font-semibold">Buses Assigned</TableHead>
                    <TableHead className="text-xs font-semibold">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoutes.map((route: any) => (
                    <TableRow key={route.id}>
                      <TableCell>
                        <div className="flex items-center">
                          <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{route.routeName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {route.stops && route.stops.length > 0
                          ? `${route.stops[0]?.name || ''} - ADTU Campus`
                          : 'No stops defined'}
                      </TableCell>
                      <TableCell className="text-sm">{route.totalStops}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {route.assignedBuses && route.assignedBuses.length > 0 ? (
                            route.assignedBuses.map((bus: any) => (
                              <div key={bus.id} className="flex items-center text-xs text-blue-400">
                                <BusIcon className="mr-1.5 h-3 w-3" />
                                <span>{bus.busNumber}</span>
                              </div>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-xs italic">No buses assigned</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const statusInfo = normalizeRouteStatus(route.status);
                          const badgeVariant = statusInfo.variant === 'default' ? 'default' : statusInfo.variant as "default" | "destructive" | "outline" | "secondary";
                          return (
                            <Badge
                              variant={badgeVariant}
                              className={statusInfo.variant === 'default' ? 'bg-green-600 text-white' : ''}
                              title={statusInfo.tooltip}
                            >
                              {statusInfo.label}
                            </Badge>
                          );
                        })()}
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
                              onClick={() => router.push(`/moderator/routes/view/${route.id}`)}
                            >
                              <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                              View Details
                            </DropdownMenuItem>
                            {canRouteEdit && (
                              <DropdownMenuItem
                                className="text-white hover:bg-gray-700 dark:hover:bg-gray-800 focus:bg-gray-700 dark:focus:bg-gray-800 px-2 py-1.5 text-sm !text-white cursor-pointer"
                                onClick={() => router.push(`/moderator/routes/edit/${route.id}`)}
                              >
                                <Edit className="mr-2 h-3.5 w-3.5 text-yellow-400" />
                                Edit Route
                              </DropdownMenuItem>
                            )}
                            {canRouteDelete && (
                              <>
                                <DropdownMenuSeparator className="bg-gray-600" />
                                <DropdownMenuItem
                                  className="text-white hover:!bg-red-600 focus:!bg-red-600 px-2 py-1.5 text-sm !text-white cursor-pointer transition-colors"
                                  onClick={() => handleDelete(route.id, route.routeName)}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Delete Route
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
              {deleteItem && `This action cannot be undone. This will permanently delete the route "${deleteItem.name}" from the system.`}
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
