"use client";

import { useState, useEffect } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Bus,
  Hash,
  Users,
  MapPin,
  Calendar,
  Edit,
  Trash2,
  User,
  Phone,
  Mail,
  CreditCard,
  CalendarDays,
  Activity,
  Palette
} from "lucide-react";
import Link from "next/link";
import { useToast } from '@/contexts/toast-context';
import { PremiumPageLoader } from "@/components/LoadingSpinner";
import RouteJourney from "@/components/RouteJourney";
import { formatDateFlexible } from '@/lib/utils/date-utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getBusById, getRouteById, getDriverById, deleteBus, getAllDrivers } from "@/lib/dataService";

// Define the interfaces
interface Stop {
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
}

interface Route {
  id: string;
  routeId: string;
  routeName: string;
  stops: Stop[];
  totalStops: number;
  assignedBuses: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Driver {
  uid: string;
  name?: string;
  fullName: string;
  email: string;
  phone?: string;
  altPhone?: string;
  licenseNumber?: string;
  driverId?: string;
  joiningDate?: string;
  assignedBusId?: string;
  assignedRouteId?: string;
  createdAt?: string;
}

interface BusData {
  id: string;
  busId: string;
  busNumber: string;
  model?: string;
  color?: string;
  capacity: string | number;
  totalCapacity?: number;
  driverUID: string;
  assignedDriverId?: string;
  activeDriverId?: string;
  routeId: string;
  routeName?: string;
  status: string;
  shift?: string;
  createdAt: any;
  updatedAt: any;
}

import { useModeratorPermissions } from '@/hooks/useModeratorPermissions';
import { PermissionDeniedCard } from '@/components/PermissionDeniedCard';

export default function ViewBusPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { addToast } = useToast();
  const { canBusView, canBusEdit, canBusDelete, loading: permsLoading } = useModeratorPermissions();
  const { id } = use(params);
  const [bus, setBus] = useState<BusData | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const busId = id;

        const foundBus = await getBusById(busId);
        if (foundBus) {
          setBus(foundBus as BusData);

          // Fetch driver by assignedDriverId or activeDriverId
          const driverId = foundBus.assignedDriverId || foundBus.activeDriverId || foundBus.driverUID;
          if (driverId) {
            try {
              const allDrivers = await getAllDrivers();
              const foundDriver = allDrivers.find((d: any) => d.uid === driverId || d.id === driverId);
              if (foundDriver) {
                setDriver(foundDriver as Driver);
              }
            } catch (driverError) {
              console.error('Error fetching driver:', driverError);
            }
          }

          // Fetch route information
          if (foundBus.routeId) {
            try {
              const foundRoute = await getRouteById(foundBus.routeId);
              if (foundRoute) {
                const convertedRoute: Route = {
                  id: foundRoute.routeId || foundRoute.id || '',
                  routeId: foundRoute.routeId,
                  routeName: foundRoute.routeName,
                  stops: foundRoute.stops as unknown as Stop[],
                  totalStops: foundRoute.stops?.length || 0,
                  assignedBuses: foundRoute.assignedBuses || [],
                  status: foundRoute.status || 'active',
                  createdAt: foundRoute.createdAt ? foundRoute.createdAt.toString() : '',
                  updatedAt: foundRoute.updatedAt ? foundRoute.updatedAt.toString() : ''
                };
                setRoute(convertedRoute);

                if (!foundBus.routeName && foundRoute.routeName) {
                  setBus(prevBus => prevBus ? { ...prevBus, routeName: foundRoute.routeName } : prevBus);
                }
              }
            } catch (routeError) {
              console.error('Error fetching route:', routeError);
            }
          }
        }
      } catch (error: any) {
        console.error('Error fetching bus:', error);
        addToast('Error fetching bus data', 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, addToast]);

  const handleEdit = () => {
    router.push(`/moderator/buses/edit/${id}`);
  };

  const handleDelete = () => {
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    try {
      const busId = id;
      const success = await deleteBus(busId);

      if (success) {
        addToast('Bus deleted successfully!', 'success');
        setIsDialogOpen(false);
        router.push("/moderator/buses");
      } else {
        addToast('Failed to delete bus', 'error');
      }
    } catch (error) {
      console.error('Error deleting bus:', error);
      addToast('Failed to delete bus', 'error');
    }
  };

  if (loading) {
    return <PremiumPageLoader message="Loading bus details..." subMessage="Fetching diagnostics..." />;
  }

  // Helper to format ID (bus_1 -> Bus-1)
  const formatId = (id: string) => {
    if (!id) return 'N/A';
    const parts = id.split('_');
    if (parts.length === 2) {
      return `${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)}-${parts[1]}`;
    }
    return id;
  };

  if (!bus) {
    return (
      <div className="mt-15 min-h-screen flex items-center justify-center bg-[#010717]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Bus not found</h1>
          <Link href="/moderator/buses" className="text-purple-400 hover:text-purple-300 mt-4 inline-block">
            ← Back to Buses
          </Link>
        </div>
      </div>
    );
  }

  // Helper function to get capacity (max seats)
  const getCapacity = () => {
    const busCapacity = (bus as any).capacity;
    // After migration, capacity is a number (max seats)
    if (typeof busCapacity === 'number') {
      return busCapacity.toString();
    }
    // Legacy string format "X/Y" - extract Y
    if (typeof busCapacity === 'string' && busCapacity.includes('/')) {
      const match = busCapacity.match(/\d+\/(\d+)/);
      return match ? match[1] : '55';
    }
    return '55';
  };

  // Helper function to format Firestore timestamp
  const formatTimestamp = (timestamp: any): string => formatDateFlexible(timestamp, 'N/A');

  if (!permsLoading && !canBusView) {
    return <PermissionDeniedCard title="Bus Details Restricted" actionName="Viewing Bus Details" />;
  }

  return (
    <div className="mt-7 min-h-screen bg-transparent py-8 w-full overflow-x-hidden">
      {/* Header */}
      <div className="max-w-5xl mx-auto w-full max-w-[92vw] sm:max-w-5xl">
        <div className="flex items-center justify-between mb-8 gap-2">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white mb-1">Bus Details</h1>
            <p className="text-gray-400 text-xs hidden md:block">Detailed information about {bus.busNumber}</p>
          </div>
          <div className="flex items-center space-x-2">
            <Link
              href="/moderator/buses"
              className="inline-flex items-center px-3 py-1.5 text-sm bg-white hover:bg-gray-100 text-black font-medium rounded-lg transition-all duration-200 hover:shadow-lg"
            >
              &lt;- Back
            </Link>
            {canBusEdit && (
              <Button
                onClick={handleEdit}
                className="hidden md:inline-flex bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-all duration-200 hover:shadow-lg px-3 py-1.5 h-auto"
              >
                <Edit className="mr-1.5 h-3.5 w-3.5" />
                Edit Bus
              </Button>
            )}
            {canBusDelete && (
              <Button
                onClick={handleDelete}
                className="hidden md:inline-flex bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-all duration-200 hover:shadow-lg px-3 py-1.5 h-auto"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete Bus
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto w-full max-w-[92vw] sm:max-w-5xl">
        <div className="bg-gray-900/50 rounded-2xl shadow-xl border border-gray-700/50 p-6">
          {/* Premium Bus Information Dashboard */}
          <div className="mb-8">
            {/* Hero Section */}
            <div className="relative bg-gray-800/60 rounded-xl p-4 border border-gray-700/30 mb-6">

              <div className="relative z-10">
                <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 min-w-0">
                  {/* Bus Identity */}
                  <div className="flex items-center space-x-4 w-full sm:w-auto">
                    <div className="relative flex-shrink-0">
                      <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg border-2 border-blue-400/30">
                        <Bus className="h-8 w-8 text-white" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md">
                        <span className="text-xs font-bold text-white">{bus.status === 'Active' ? '✓' : '⚠'}</span>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <h2 className="text-lg md:text-xl font-bold text-white mb-1 truncate">{bus.busNumber}</h2>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${(bus.status.toLowerCase() === 'active' || bus.status.toLowerCase() === 'idle' || bus.status.toLowerCase() === 'enroute')
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                          : 'bg-red-500/20 text-red-300 border border-red-500/50'
                          }`}>
                          <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${(bus.status.toLowerCase() === 'active' || bus.status.toLowerCase() === 'idle' || bus.status.toLowerCase() === 'enroute') ? 'bg-emerald-400' : 'bg-red-400'
                            }`} />
                          {(() => {
                            const status = bus.status || 'Active';
                            if (status.toLowerCase() === 'idle' || status.toLowerCase() === 'enroute') return 'Active';
                            return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Route Information */}
                  <div className="text-center w-full sm:w-auto mt-2 sm:mt-0">
                    <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-xl rounded-xl p-4 border border-gray-700/50">
                      <h3 className="text-sm font-bold text-white mb-1">Assigned Route</h3>
                      <p className="text-sm md:text-lg font-bold text-blue-300 mb-1">
                        {bus.routeName || (route ? route.routeName : 'Not Assigned')}
                      </p>
                      {route && (
                        <div className="flex items-center justify-center space-x-3 mt-2">
                          <div className="text-center">
                            <p className="text-[10px] md:text-xs text-gray-400">Stops</p>
                            <p className="text-xs md:text-sm font-bold text-white">{route.stops?.length || 0}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Statistics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {/* Capacity Card */}
              <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Capacity</p>
                    <p className="text-lg font-bold text-white">{getCapacity()}</p>
                    <p className="text-xs text-blue-300">passengers</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                    <Users className="h-4 w-4 text-blue-400" />
                  </div>
                </div>
              </div>

              {/* Current Members Card */}
              <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Onboard</p>
                    <p className="text-lg font-bold text-white">{(bus as any).currentMembers || 0}</p>
                    <p className="text-xs text-emerald-300">members</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                    <User className="h-4 w-4 text-emerald-400" />
                  </div>
                </div>
              </div>

              {/* Shift Card */}
              <div className="bg-orange-500/10 rounded-xl p-4 border border-orange-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Shift</p>
                    <p className="text-lg font-bold text-white">{bus.shift || 'N/A'}</p>
                    <p className="text-xs text-orange-300">schedule</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
                    <Activity className="h-4 w-4 text-orange-400" />
                  </div>
                </div>
              </div>

              {/* Driver Assignment Card */}
              <div className="bg-purple-500/10 rounded-xl p-4 border border-purple-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Driver</p>
                    <p className="text-lg font-bold text-white">
                      {bus.assignedDriverId ? 'Assigned' : 'Available'}
                    </p>
                    <p className="text-xs text-purple-300">status</p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
                    <User className="h-4 w-4 text-purple-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bus Details */}
              <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/30">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center">
                  <Bus className="h-4 w-4 mr-2 text-blue-400" />
                  Bus Specifications
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-1 border-b border-gray-700/30">
                    <span className="text-xs text-gray-400">Bus ID</span>
                    <span className="text-sm text-white font-medium">{formatId(bus.busId)}</span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-gray-700/30">
                    <span className="text-xs text-gray-400">Driver</span>
                    <span className="text-sm text-white font-medium">{driver ? (driver.fullName || driver.name || 'N/A') : 'No Driver Assigned'}</span>
                  </div>
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs text-gray-400">Created</span>
                    <span className="text-sm text-white font-medium">{formatTimestamp(bus.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* Route Details */}
              <div className="bg-gray-800/60 rounded-xl p-4 border border-gray-700/30">
                <h3 className="text-sm font-bold text-white mb-3 flex items-center">
                  <MapPin className="h-4 w-4 mr-2 text-green-400" />
                  Route Information
                </h3>
                {route ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-1 border-b border-gray-700/30">
                      <span className="text-xs text-gray-400">Route ID</span>
                      <span className="text-sm text-white font-medium">{formatId(route.routeId)}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-gray-700/30">
                      <span className="text-xs text-gray-400">Total Stops</span>
                      <span className="text-sm text-white font-medium">{route.stops?.length || 0}</span>
                    </div>

                  </div>
                ) : (
                  <div className="text-center py-4">
                    <MapPin className="h-8 w-8 mx-auto text-gray-600 mb-2" />
                    <p className="text-xs text-gray-400">No route assigned to this bus</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Driver Information */}
          {driver ? (
            <div className="mt-6 pt-6 border-t border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Driver Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center mr-3">
                    <User className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">Name</p>
                    <p className="text-sm font-semibold text-white">{driver.fullName || driver.name || 'N/A'}</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center mr-3">
                    <Mail className="h-4 w-4 text-teal-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">Email</p>
                    <p className="text-sm font-semibold text-white break-all">{driver.email}</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center mr-3">
                    <Phone className="h-4 w-4 text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">Phone</p>
                    <p className="text-sm font-semibold text-white">{driver.phone || 'N/A'}</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-lime-500/10 flex items-center justify-center mr-3">
                    <CreditCard className="h-4 w-4 text-lime-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">Driver ID</p>
                    <p className="text-sm font-semibold text-white">{driver.driverId || 'N/A'}</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center mr-3">
                    <CalendarDays className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">Joining Date</p>
                    <p className="text-sm font-semibold text-white">
                      {driver.joiningDate ? new Date(driver.joiningDate).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center mr-3">
                    <Hash className="h-4 w-4 text-rose-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-1">License Number</p>
                    <p className="text-sm font-semibold text-white">{driver.licenseNumber || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 pt-6 border-t border-gray-700">
              <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
                <div className="flex items-center">
                  <User className="h-5 w-5 text-orange-400 mr-3" />
                  <div>
                    <h3 className="text-base font-semibold text-white">No Driver Assigned</h3>
                    <p className="text-sm text-gray-400 mt-1">This bus currently has no driver assigned to it.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Route Journey Section */}
          <div className="mt-8 pt-8 border-t border-gray-700">
            <RouteJourney
              stops={route?.stops || []}
              routeName={route?.routeName}
            />
          </div>
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-gray-900 border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-white">Are you sure?</DialogTitle>
            <DialogDescription className="text-gray-400">
              This action cannot be undone. This will permanently delete the bus &quot;{bus.busNumber}&quot; from the system.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              className="bg-gray-800 hover:bg-gray-700 text-white border border-gray-600"
              onClick={() => setIsDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
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
