"use client";

import { ExportButton } from '@/components/ExportButton';
import { PremiumPageLoader } from '@/components/LoadingSpinner';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
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
import { deleteRoute } from "@/lib/dataService";
import { exportToExcel } from '@/lib/export-helpers';
import { normalizeRouteStatus } from '@/lib/formatters';
import { supabase } from '@/lib/supabase-client';
import { cn } from '@/lib/utils';
import {
	Bus as BusIcon,
	Edit,
	Eye,
	Filter,
	MapPin,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Search,
	Trash2
} from "lucide-react";
import { useRouter } from 'next/navigation';
import { useMemo,useState } from "react";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { useTheme } from '@/components/theme-provider';
import { invalidateCollectionCache,useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';

// Use local interfaces to avoid type conflicts
interface RouteItem {
  id: string;
  routeId: string;
  routeName: string;
  stops: any[];
  totalStops: number;
  assignedBuses: any[];

  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function RoutesPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { theme } = useTheme();

  // Server-side API reads from PostgreSQL — no Firestore client reads
  const { data: routesData, loading: loadingRoutes, refresh: refreshRoutesData } = useApiCollection('routes', {
    pageSize: 50, orderByField: 'routeName', orderDirection: 'asc', autoRefresh: false,
  });
  // Fetch buses to determine assignments
  const { data: buses, loading: loadingBuses, refresh: refreshBuses } = useApiCollection('buses', {
    pageSize: 50, orderByField: 'busNumber', orderDirection: 'asc', autoRefresh: false,
  });

  // Event-driven refresh: auto-refresh when mutations occur in other pages
  useEventDrivenRefresh({
    collectionName: 'routes',
    onRefresh: async () => {
      await Promise.all([refreshRoutesData(), refreshBuses()]);
    }
  });

  // Index buses by their route key ONCE per data change. The previous code ran
  // buses.filter() inside routes.map() — O(routes × buses) on every render/keystroke.
  // Grouping into a Map turns the per-route lookup into a single Map.get().
  const busesByRouteKey = useMemo(() => {
    const map = new Map<string, any[]>();
    const add = (key: string | undefined, bus: any) => {
      if (!key) return;
      const list = map.get(key);
      if (list) list.push(bus);
      else map.set(key, [bus]);
    };
    for (const bus of buses as any[]) {
      add(bus.routeId, bus);
      // routeRef is stored as `routes/<id>` — strip the prefix so it lines up with
      // a route's id/routeId key.
      if (typeof bus.routeRef === 'string' && bus.routeRef.startsWith('routes/')) {
        add(bus.routeRef.slice('routes/'.length), bus);
      }
    }
    return map;
  }, [buses]);

  // Process and combine data — memoized so it only rebuilds when routes/buses change.
  const routes = useMemo(() => routesData.map((route: any) => {
    // Gather buses matching either the route's routeId or its document id, deduped.
    const seen = new Set<string>();
    const assignedBusesList: any[] = [];
    for (const key of [route.routeId, route.id]) {
      const list = key && busesByRouteKey.get(key);
      if (!list) continue;
      for (const bus of list) {
        if (seen.has(bus.id)) continue;
        seen.add(bus.id);
        assignedBusesList.push(bus);
      }
    }

    return {
      id: route.id,
      routeId: route.routeId || route.id,
      routeName: route.routeName || `Route-${route.routeId?.replace('route_', '')}`,
      totalStops: route.totalStops || (Array.isArray(route.stops) ? route.stops.length : 0),
      status: route.status || 'Active',
      stops: route.stops || [],
      assignedBuses: assignedBusesList
    };
  }), [routesData, busesByRouteKey]);

  const [searchTerm, setSearchTerm] = useState("");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<{ id: string; name: string } | null>(null);

  const isLoading = loadingRoutes || loadingBuses;
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache('routes');
      await Promise.all([refreshRoutesData(), refreshBuses()]);
      addToast('Data refreshed', 'success');
    } catch (error) {
      console.error('Error refreshing routes:', error);
      addToast('Failed to refresh data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Helper function to extract number from route name or ID for sorting
  const extractRouteNumber = (str: string): number => {
    if (!str) return 999;
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1]) : 999;
  };

  const filteredRoutes = useMemo(() => {
    const q = searchTerm.toLowerCase();
    const shift = shiftFilter.toLowerCase();
    return routes.filter((route: any) => {
      const matchesSearch =
        (route.routeName && route.routeName.toLowerCase().includes(q)) ||
        (route.assignedBuses && route.assignedBuses.some((bus: any) =>
          (bus.busNumber && bus.busNumber.toLowerCase().includes(q))
        ));

      const matchesShift = shiftFilter === "all" || (route.status && route.status.toLowerCase() === shift);

      return matchesSearch && matchesShift;
    }).sort((a: any, b: any) => {
      const numA = extractRouteNumber(a.routeName || a.routeId || '');
      const numB = extractRouteNumber(b.routeName || b.routeId || '');
      return numA - numB;
    });
  }, [routes, searchTerm, shiftFilter]);

  // Export routes data from Supabase
  const handleExportRoutes = async () => {
    try {
      const currentDate = new Date();
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '-');

      // Fetch all routes directly from Supabase PostgreSQL table 'routes'
      const { data: rawRoutes, error: routesError } = await supabase
        .from('routes')
        .select('*')
        .order('route_name', { ascending: true });

      if (routesError) throw routesError;

      // Fetch buses to resolve assigned buses per route
      const { data: rawBuses } = await supabase
        .from('buses')
        .select('id, bus_number, route_id');

      const busRouteMap = new Map<string, string[]>();
      (rawBuses || []).forEach((b: any) => {
        if (b.route_id) {
          const existing = busRouteMap.get(b.route_id) || [];
          existing.push(b.bus_number);
          busRouteMap.set(b.route_id, existing);
        }
      });

      const exportData = (rawRoutes || []).map((route: any, index: number) => {
        const stopsList = Array.isArray(route.stops) ? route.stops : [];
        const stopsSummary = stopsList.length > 0
          ? stopsList.map((s: any) => s.stop_name || s.name || s).join(', ')
          : (route.start_location ? `${route.start_location} - ADTU Campus` : 'No stops defined');

        const assignedBusesList = busRouteMap.get(route.id) || [];
        const busesStr = assignedBusesList.length > 0 ? assignedBusesList.join(', ') : 'None';
        const status = route.status || 'Active';

        return [
          (index + 1).toString(),
          route.route_name || route.route_number || 'N/A',
          stopsSummary,
          route.total_stops || stopsList.length || 0,
          busesStr,
          status.charAt(0).toUpperCase() + status.slice(1)
        ];
      });

      // Add headers
      exportData.unshift([
        'Sl No', 'Route Name', 'Stops Summary', 'Total Stops', 'Buses Assigned', 'Status'
      ]);

      // Add section header
      exportData.unshift(['ALL ROUTES REPORT (SUPABASE)'], ['']);

      await exportToExcel(exportData, `ADTU_Routes_Report_${dateStr}`, 'Routes');

      addToast(
        `Exported ${(rawRoutes || []).length} routes to ADTU_Routes_Report_${dateStr}.xlsx`,
        'success'
      );
    } catch (error) {
      console.error('❌ Error exporting routes from Supabase:', error);
      addToast(
        'Failed to export routes data. Please try again.',
        'error'
      );
    }
  };

  const commonBtnClass = "group h-8 px-4 bg-white hover:bg-gray-50 text-gray-700 hover:text-purple-600 border border-gray-200 hover:border-purple-200 shadow-sm hover:shadow-lg hover:shadow-purple-500/10 font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all duration-300 active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

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
        await Promise.all([refreshRoutesData(), refreshBuses()]);
        console.log(`Successfully deleted route: ${deleteItem.name} (${deleteItem.id})`);
        addToast('Route deleted successfully', 'success');
      } else {
        console.error('Failed to delete route');
        addToast('Failed to delete route', 'error');
      }
    } catch (error) {
      console.error('Error deleting route:', error);
      addToast('Error occurred while deleting', 'error');
    } finally {
      setIsDialogOpen(false);
      setDeleteItem(null);
    }
  };

  if (isLoading && routesData.length === 0) {
    return <PremiumPageLoader message="Curating Transit Routes..." subMessage="Fetching route definitions and stops..." />;
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
          <Button
            className={cn(
              "w-full md:w-auto cursor-pointer border transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-md px-2.5 py-1.5 text-xs h-8",
              theme === 'dark' ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-700" : "bg-[#1E3A8A] hover:bg-[#1E40AF] text-white border-[#1E3A8A]"
            )}
            onClick={() => router.push('/admin/routes/add')}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add New Route
          </Button>
          <ExportButton
            onClick={() => handleExportRoutes()}
            label="EXPORT"
            className={commonBtnClass}
          />
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={commonBtnClass}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin" : "group-hover:rotate-180")} />
            REFRESH
          </Button>
        </div>
      </div>

      <Card className={cn("border-border min-h-[480px] flex flex-col", theme === 'dark' ? "bg-gray-900" : "bg-admin-bg")}>
        <CardContent className="pt-3 flex-1 flex flex-col min-h-0 pb-4">
          <div className="mb-3">
            {/* Search Bar and Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Bar - Top (Full Width on Mobile) */}
              <div className="relative w-full md:flex-1">
                <Search className={cn("absolute left-2.5 top-2.5 h-3.5 w-3.5", theme === 'dark' ? "text-gray-400" : "text-[#9CA3AF]")} />
                <Input
                  placeholder="Search routes..."
                  className="pl-9 h-9 text-xs w-full"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              {/* Filters - Below Search on Mobile */}
              <div className="flex gap-2 items-center w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
                <Filter className={cn("h-3.5 w-3.5 flex-shrink-0", theme === 'dark' ? "text-gray-500" : "text-[#6B7280]")} />

                <Select value={shiftFilter} onValueChange={setShiftFilter}>
                  <SelectTrigger className={cn(
                    "h-8 text-xs min-w-[120px] flex-1 md:w-[180px] md:bg-transparent border",
                    theme === 'dark' ? "bg-gray-800 border-gray-700" : "bg-white border-[#E5E7EB]"
                  )}>
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
                    className={cn(
                      "h-8 px-3 text-xs",
                      theme === 'dark' ? "bg-red-500 hover:bg-red-600" : "bg-[#EF4444] hover:bg-[#DC2626]"
                    )}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
            <div className="students-scroll-wrapper rounded-md border overflow-x-auto flex-1 flex flex-col min-h-0" role="region" aria-label="Routes list">
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
                {filteredRoutes.length > 0 && (
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
                              <Button variant="ghost" className={cn(
                                "h-8 w-8 p-0 cursor-pointer",
                                theme === 'dark' ? "hover:bg-gray-700" : "hover:bg-gray-100"
                              )}>
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className={cn(
                              "shadow-xl rounded-lg w-44",
                              theme === 'dark' ? "bg-gray-900 border-gray-600" : "bg-white border-[#E5E7EB]"
                            )}>
                              <DropdownMenuLabel className={cn("font-semibold px-2 py-1.5 text-sm", theme === 'dark' ? "text-white" : "text-[#111827]")}>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
                              <DropdownMenuItem
                                className={cn(
                                  "px-2 py-1.5 text-sm cursor-pointer",
                                  theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
                                )}
                                onClick={() => router.push(`/admin/routes/view/${route.id}`)}
                              >
                                <Eye className="mr-2 h-3.5 w-3.5 text-blue-400" />
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className={cn(
                                  "px-2 py-1.5 text-sm cursor-pointer",
                                  theme === 'dark' ? "text-white hover:bg-gray-800 focus:bg-gray-800" : "text-[#111827] hover:bg-gray-100 focus:bg-gray-100"
                                )}
                                onClick={() => router.push(`/admin/routes/edit/${route.id}`)}
                              >
                                <Edit className="mr-2 h-3.5 w-3.5 text-yellow-400" />
                                Edit Route
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className={cn(theme === 'dark' ? "bg-gray-600" : "bg-[#E5E7EB]")} />
                              <DropdownMenuItem
                                className={cn(
                                  "px-2 py-1.5 text-sm cursor-pointer transition-colors",
                                  theme === 'dark' ? "text-white hover:!bg-red-600 focus:!bg-red-600" : "text-[#111827] hover:!bg-red-600 focus:!bg-red-600"
                                )}
                                onClick={() => handleDelete(route.id, route.routeName)}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Delete Route
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                )}
              </Table>
              {filteredRoutes.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground min-h-[220px]">
                  No routes found.
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
              {deleteItem && `This action cannot be undone. This will permanently delete the route "${deleteItem.name}" from the system.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className={cn(
                "border",
                theme === 'dark' ? "bg-gray-800 border-gray-600 text-foreground hover:bg-gray-700" : "bg-white border-[#E5E7EB] text-[#111827] hover:bg-gray-50"
              )}
            >
              Cancel
            </Button>
            <Button
              className={cn(
                "border font-medium",
                theme === 'dark' ? "bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700" : "bg-[#EF4444] hover:bg-[#DC2626] text-white border-[#EF4444] hover:border-[#DC2626]"
              )}
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
