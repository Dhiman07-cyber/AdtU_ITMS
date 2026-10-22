"use client";

import { ExportButton } from '@/components/ExportButton';
import { TableRowLoader } from '@/components/LoadingSpinner';
import { Badge } from "@/components/ui/badge";
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
import { deleteRoute } from "@/lib/dataService";
import { exportToExcel } from '@/lib/export-helpers';
import { normalizeRouteStatus } from '@/lib/formatters';
import { cn } from "@/lib/utils";
import {
	Bus as BusIcon,
	ChevronLeft,
	ChevronRight,
	Download,
	Edit,
	Eye,
	Filter,
	Loader2,
	MapPin,
	MoreHorizontal,
	Plus,
	RefreshCw,
	Route as RouteIcon,
	Search,
	Trash2,
	X
} from "lucide-react";
import { MobileActionFAB } from '@/components/layout/MobileActionFAB';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from "react";
// Migrated: Server-side API → PostgreSQL (no Firestore client reads)
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';
import { useAuth } from '@/contexts/auth-context';
import { invalidateCollectionCache, useApiCollection } from '@/hooks/useApiCollection';
import { useEventDrivenRefresh } from '@/hooks/useEventDrivenRefresh';
import { useLocalAndServerSearch } from '@/hooks/useLocalAndServerSearch';
import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';

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
  busId?: string;
  routeId?: string;
  employeeId?: string;
  joiningDate?: string;
  createdAt?: string;
}

export default function RoutesPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { currentUser } = useAuth();
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

  // Index buses by their route key ONCE per data change
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
      if (typeof bus.routeRef === 'string' && bus.routeRef.startsWith('routes/')) {
        add(bus.routeRef.slice('routes/'.length), bus);
      }
    }
    return map;
  }, [buses]);

  // Process and combine data — memoized so it only rebuilds when routes/buses change.
  const routes = useMemo(() => routesData.map((route: any) => {
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

  const isLoading = loadingRoutes || loadingBuses || loadingDrivers;
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      invalidateCollectionCache('routes');
      await Promise.all([refreshRoutesData(), refreshBuses(), refreshDrivers()]);
      addToast('Data refreshed', 'success');
    } catch (error) {
      console.error('Error refreshing routes:', error);
      addToast('Failed to refresh data', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Helper function to extract number from route name
  const extractRouteNumber = (str: string): number => {
    if (!str) return 999;
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1]) : 999;
  };

  // Local matcher for Tier 1 search (0ms, 0 network calls)
  const routeLocalMatcher = useMemo(() => {
    return (route: any, q: string) => {
      const name = (route.routeName || route.route_name || '').toLowerCase();
      const id = (route.id || route.routeId || '').toLowerCase();
      const busMatch = route.assignedBuses && route.assignedBuses.some((bus: any) =>
        (bus.busNumber && bus.busNumber.toLowerCase().includes(q))
      );
      const stopMatch = route.stops && route.stops.some((stop: any) =>
        (stop.name || stop.stop_name || '').toLowerCase().includes(q)
      );

      return name.includes(q) || id.includes(q) || Boolean(busMatch) || Boolean(stopMatch);
    };
  }, []);

  const {
    results: searchedRoutes,
    isSearchingServer,
    isServerFallback,
  } = useLocalAndServerSearch(
    routes,
    searchTerm,
    routeLocalMatcher,
    "/api/routes",
    {
      extractItems: (json: any) => (Array.isArray(json) ? json : json.routes || json.data || []),
    }
  );

  const filteredRoutes = useMemo(() => {
    const shift = shiftFilter.toLowerCase();
    return searchedRoutes.filter((route: any) => {
      const matchesShift = shiftFilter === "all" || (route.status && route.status.toLowerCase() === shift);
      return matchesShift;
    }).sort((a: any, b: any) => {
      const numA = extractRouteNumber(a.routeName || '');
      const numB = extractRouteNumber(b.routeName || '');
      return numA - numB;
    });
  }, [searchedRoutes, shiftFilter]);

  const PAGE_SIZE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  const [isPaginating, setIsPaginating] = useState(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, shiftFilter]);

  const totalPages = Math.max(currentPage, Math.max(1, Math.ceil(filteredRoutes.length / PAGE_SIZE)));
  const validatedPage = Math.max(1, Math.min(currentPage, totalPages));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedRoutes = useMemo(() => {
    const startIndex = (validatedPage - 1) * PAGE_SIZE;
    const slice = filteredRoutes.slice(startIndex, startIndex + PAGE_SIZE);
    if (slice.length === 0 && filteredRoutes.length > 0) {
      const fallbackStart = Math.max(0, filteredRoutes.length - PAGE_SIZE);
      return filteredRoutes.slice(fallbackStart);
    }
    return slice;
  }, [filteredRoutes, validatedPage, PAGE_SIZE]);

  const handleNextPage = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (isPaginating || validatedPage >= totalPages) return;
    setIsPaginating(true);
    setTimeout(() => {
      setCurrentPage((prev) => Math.min(totalPages, prev + 1));
      setIsPaginating(false);
    }, 200);
  };

  const handlePrevPage = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (isPaginating || validatedPage <= 1) return;
    setIsPaginating(true);
    setTimeout(() => {
      setCurrentPage((prev) => Math.max(1, prev - 1));
      setIsPaginating(false);
    }, 200);
  };

  // Export routes data via authenticated API
  const handleExportRoutes = async () => {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const token = await currentUser?.getIdToken();
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

      const [routesRes, busesRes] = await Promise.all([
        fetch('/api/routes', { headers: authHeaders }),
        fetch('/api/buses', { headers: authHeaders }),
      ]);

      const rawRoutes = routesRes.ok ? await routesRes.json() : [];
      const rawBuses = busesRes.ok ? (await busesRes.json()).buses || [] : [];

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

  const commonBtnClass = "group h-8 px-3.5 bg-secondary/80 hover:bg-secondary text-secondary-foreground border border-border/50 shadow-sm font-medium text-xs rounded-lg transition-colors active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer";

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

  if (permsLoading) {
    return (
      <div className="itms-admin-container space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 dark:bg-zinc-800 rounded-md" />
        <div className="h-64 bg-slate-100 dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800" />
      </div>
    );
  }

  if (!canRouteView) {
    return <PermissionDeniedCard title="Routes Section Restricted" actionName="Viewing Routes" showGoBack={false} />;
  }

  return (
    <div className="itms-admin-container space-y-6">
      {/* Page Header */}
      <div className="itms-page-header-container">
        <div className="flex flex-row items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-600/10 border border-emerald-500/20 text-emerald-500">
                <RouteIcon className="w-6 h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-foreground tracking-tight leading-tight">
                Route Management Hub
              </h1>
            </div>
            <p className="text-xs text-muted-foreground">
              Manage transit paths, geofenced stop sequences, assigned fleet vehicles, and corridor coverage.
            </p>
          </div>

          {/* Desktop action toolbar */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {canRouteAdd && (
              <Button
                className="cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-lg rounded-lg px-3 py-1.5 text-xs h-9 gap-1.5"
                onClick={() => router.push('/moderator/routes/add')}
              >
                <Plus className="h-4 w-4" />
                <span>Add New Route</span>
              </Button>
            )}
            <ExportButton
              onClick={() => handleExportRoutes()}
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

          {/* Mobile Refresh Button */}
          <div className="flex md:hidden items-center shrink-0">
            <Button
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-8 px-3 bg-white dark:bg-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-700 dark:text-zinc-200 hover:text-emerald-600 dark:hover:text-emerald-400 border border-gray-200 dark:border-zinc-700 shadow-sm rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all shrink-0"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 transition-transform duration-500", isRefreshing ? "animate-spin text-emerald-600" : "group-hover:rotate-180")} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>
      </div>

      <Card className="bg-gray-50 dark:bg-gray-900 border-border min-h-[480px] flex flex-col">
        <CardContent className="pt-3 flex-1 flex flex-col min-h-0 pb-4">
          <div className="mb-3">
            {/* Search Bar and Filters */}
            <div className="flex flex-col md:flex-row gap-3">
              {/* Search Bar - Top (Full Width on Mobile) */}
              <div className="relative w-full md:flex-1">
                {isSearchingServer ? (
                  <Loader2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-blue-500 animate-spin" />
                ) : (
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                )}
                <Input
                  placeholder="Search routes..."
                  className="pl-9 pr-24 h-9 text-xs w-full"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="absolute right-2.5 top-2 flex items-center gap-1.5">
                  {isServerFallback && (
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-900">
                      Server Match
                    </span>
                  )}
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filters - Side by side on Mobile in the same line */}
              <div className="flex items-center gap-2 w-full md:w-auto">
                <Select value={shiftFilter} onValueChange={setShiftFilter}>
                  <SelectTrigger className="h-9 md:h-8 text-xs w-full md:w-[180px] bg-white dark:bg-gray-800 md:bg-transparent border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
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
                    className="h-8 px-3 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 dark:bg-red-500/20 dark:text-red-400 flex-shrink-0"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="students-section md:mt-5 flex-1 flex flex-col min-h-0">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs relative flex flex-col min-h-0">
              {/* Data Fetch / Pagination Top Progress Bar */}
              {isPaginating && (
                <div className="absolute top-0 left-0 right-0 z-20 h-1 bg-blue-500/10 dark:bg-blue-400/10 overflow-hidden">
                  <div className="animate-progress w-full h-full bg-blue-500 dark:bg-blue-400 origin-left-right" />
                </div>
              )}

              <div
                className={cn(
                  "overflow-x-auto min-h-[520px] flex-1 flex flex-col transition-opacity duration-200",
                  isPaginating && "opacity-60 pointer-events-none"
                )}
                role="region"
                aria-label="Routes list"
              >
                <Table className="w-full table-fixed min-w-[780px]">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[28%]" />
                    <col className="w-[12%]" />
                    <col className="w-[18%]" />
                    <col className="w-[14%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <TableHeader className="bg-slate-50 dark:bg-zinc-800/50">
                    <TableRow className="h-9 border-b border-zinc-200 dark:border-zinc-800">
                      <TableHead className="w-[18%] text-[11px] font-bold py-2">Route Name</TableHead>
                      <TableHead className="w-[28%] text-[11px] font-bold py-2">Route Path</TableHead>
                      <TableHead className="w-[12%] text-[11px] font-bold py-2">Total Stops</TableHead>
                      <TableHead className="w-[18%] text-[11px] font-bold py-2">Assigned Buses</TableHead>
                      <TableHead className="w-[14%] text-[11px] font-bold py-2">Status</TableHead>
                      <TableHead className="w-[10%] text-[11px] font-bold py-2 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && filteredRoutes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="p-6">
                          <TableRowLoader rows={6} />
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRoutes.map((route: any) => (
                        <TableRow key={route.id} className="hover:bg-slate-50/60 dark:hover:bg-zinc-800/40 transition-colors border-b border-zinc-100 dark:border-zinc-800/60" style={{ contentVisibility: 'auto', containIntrinsicSize: '0 52px' }}>
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                                <RouteIcon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <span className="font-bold text-xs sm:text-sm text-foreground truncate block">{route.routeName}</span>
                                <span className="text-[10px] text-muted-foreground font-mono">{route.routeNumber || `RT-${route.id?.slice(0, 4)}`}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-xs text-muted-foreground overflow-hidden truncate">
                            {route.stops && route.stops.length > 0
                              ? `${route.stops[0]?.name || ''} ➔ ADTU Campus`
                              : 'No stops defined'}
                          </TableCell>
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span>{route.totalStops || 0} stops</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 overflow-hidden">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {route.assignedBuses && route.assignedBuses.length > 0 ? (
                                route.assignedBuses.map((bus: any) => (
                                  <span key={bus.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[10px] font-medium shrink-0">
                                    <BusIcon className="h-2.5 w-2.5" />
                                    {bus.busNumber}
                                  </span>
                                ))
                              ) : (
                                <span className="text-muted-foreground text-xs italic">No buses assigned</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 overflow-hidden">
                            {(() => {
                              const statusInfo = normalizeRouteStatus(route.status);
                              return (
                                <span className={cn(
                                  "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0",
                                  statusInfo.label.toLowerCase() === 'active'
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                    : statusInfo.label.toLowerCase() === 'inactive'
                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                )}>
                                  {statusInfo.label}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-right overflow-hidden">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-800">
                                  <span className="sr-only">Open menu</span>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl rounded-lg w-44">
                                <DropdownMenuLabel className="font-semibold px-2 py-1.5 text-xs text-foreground">Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-zinc-200 dark:bg-zinc-800" />
                                <DropdownMenuItem
                                  className="px-2 py-1.5 text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-800 focus:bg-slate-100 dark:focus:bg-zinc-800"
                                  onClick={() => router.push(`/moderator/routes/view/${route.id}`)}
                                >
                                  <Eye className="mr-2 h-3.5 w-3.5 text-blue-500" />
                                  View Details
                                </DropdownMenuItem>
                                {canRouteEdit && (
                                  <DropdownMenuItem
                                    className="px-2 py-1.5 text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-800 focus:bg-slate-100 dark:focus:bg-zinc-800"
                                    onClick={() => router.push(`/moderator/routes/edit/${route.id}`)}
                                  >
                                    <Edit className="mr-2 h-3.5 w-3.5 text-amber-500" />
                                    Edit Route
                                  </DropdownMenuItem>
                                )}
                                {canRouteDelete && (
                                  <>
                                    <DropdownMenuSeparator className="bg-zinc-200 dark:bg-zinc-800" />
                                    <DropdownMenuItem
                                      className="px-2 py-1.5 text-xs cursor-pointer text-red-600 dark:text-red-400 hover:!bg-red-500/10 focus:!bg-red-500/10"
                                      onClick={() => handleDelete(route.id, route.routeName)}
                                    >
                                      <Trash2 className="mr-2 h-3.5 w-3.5 text-red-500" />
                                      Delete Route
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
                {!isLoading && filteredRoutes.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground min-h-[220px]">
                    No routes found.
                  </div>
                )}
              </div>

              {/* Pagination Footer */}
              {filteredRoutes.length > 0 && (
                <div className="pt-3 pb-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-zinc-200/60 dark:border-zinc-800/60 px-4 bg-white dark:bg-zinc-900/50">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                    Showing{" "}
                    <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                      {(validatedPage - 1) * PAGE_SIZE + 1}–{Math.min(validatedPage * PAGE_SIZE, filteredRoutes.length)}
                    </strong>{" "}
                    of{" "}
                    <strong className="text-zinc-700 dark:text-zinc-200 font-semibold">
                      {filteredRoutes.length}
                    </strong>{" "}
                    routes
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePrevPage}
                      disabled={validatedPage <= 1 || isPaginating}
                      className="text-xs border bg-white dark:bg-zinc-800 text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-700/80 rounded-lg px-3 h-8 cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      <span>Previous</span>
                    </Button>

                    <div className="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800/80 text-[11px] font-medium font-mono text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50">
                      Page {validatedPage} of {totalPages}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleNextPage}
                      disabled={validatedPage >= totalPages || isPaginating}
                      className="text-xs border bg-white dark:bg-zinc-800 text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-700/80 rounded-lg px-3 h-8 cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span>Next</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
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

      {/* Mobile Floating Action Button (FAB) for Quick Moderator Route Actions */}
      <MobileActionFAB
        ariaLabel="Route management actions"
        actions={[
          ...(canRouteAdd ? [{
            label: "Add New Route",
            icon: Plus,
            href: "/moderator/routes/add",
            color: "bg-emerald-600 text-white",
          }] : []),
          {
            label: "Export Routes",
            icon: Download,
            onClick: handleExportRoutes,
            color: "bg-slate-700 text-white",
          },
        ]}
      />
    </div>
  );
}
