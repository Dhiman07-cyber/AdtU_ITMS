"use client";

import { Button } from "@/components/ui/button";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { useToast } from "@/contexts/toast-context";
import { DropoffAssignment } from "@/data/notification_templates";
import { Route } from "@/lib/types";
import { Trash2 } from "lucide-react";
import { useEffect,useState } from "react";

interface DropoffMatrixProps {
  routes: Route[];
  buses: any[];
  assignments: DropoffAssignment[];
  onChange: (assignments: DropoffAssignment[]) => void;
}

export default function DropoffMatrix({ routes, buses, assignments, onChange }: DropoffMatrixProps) {
  const { addToast } = useToast();

  // Helper function to extract number from string
  const extractNumber = (str: string): string => {
    if (!str) return '0';
    const match = str.match(/\d+/);
    return match ? match[0] : '0';
  };

  const [rows, setRows] = useState<Array<{
    busId: string;
    busNumber: string;
    plateNumber?: string;
    routeId: string;
    routeName: string;
    stops: Array<{ name: string; stop_name?: string }>;
  }>>([]);

  // Initialize rows based on buses prop
  useEffect(() => {
    if (buses && buses.length > 0) {
      const initialRows = buses.map(bus => {
        const assignment = assignments?.find(a => a.busId === (bus.id || bus.busId));
        return {
          busId: bus.id || bus.busId,
          busNumber: `Bus-${extractNumber(bus.busId || bus.id)}`,
          plateNumber: bus.busNumber || '',
          routeId: assignment?.routeId || '',
          routeName: assignment?.routeName || '',
          stops: assignment?.stops || []
        };
      });
      setRows(initialRows);
    }
  }, [buses, assignments]);

  // Get all assigned route IDs for highlighting
  const routeIds = rows.filter(row => row.routeId).map(row => row.routeId);

  const handleRouteChange = (busIndex: number, routeId: string | undefined) => {
    const newRows = [...rows];

    if (routeId && routeId !== '__none__') {
      const route = routes.find(r => r.routeId === routeId);
      if (route) {
        newRows[busIndex] = {
          ...newRows[busIndex],
          routeId: route.routeId,
          routeName: route.routeName,
          stops: route.stops.map(stop => ({
            name: typeof stop === 'string' ? stop : stop.name,
            stop_name: typeof stop === 'string' ? undefined : stop.stop_name
          }))
        };
      }
    } else {
      // Clear selection
      newRows[busIndex] = {
        ...newRows[busIndex],
        routeId: '',
        routeName: '',
        stops: []
      };
    }

    setRows(newRows);
    updateAssignments(newRows);
  };

  const updateAssignments = (updatedRows: typeof rows) => {
    const validAssignments: DropoffAssignment[] = updatedRows
      .filter(row => row.routeId && row.stops.length > 0)
      .map(row => ({
        busId: row.busId,
        busNumber: row.busNumber,
        plateNumber: row.plateNumber,
        routeId: row.routeId,
        routeName: row.routeName,
        stops: row.stops
      }));

    onChange(validAssignments);
  };

  const handleClearRow = (busIndex: number) => {
    const newRows = [...rows];
    newRows[busIndex] = {
      ...newRows[busIndex],
      routeId: '',
      routeName: '',
      stops: []
    };
    setRows(newRows);
    updateAssignments(newRows);
  };

  const formatStops = (stops: Array<{ name: string }>) => {
    if (stops.length === 0) return '';
    // Show all stops
    return stops.map(s => s.name).join(', ');
  };

  // Sort routes numerically
  const sortedRoutes = [...routes].sort((a, b) => {
    const numA = parseInt(a.routeId.replace('route_', ''));
    const numB = parseInt(b.routeId.replace('route_', ''));
    return numA - numB;
  });

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* Matrix Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-1.5 sm:px-4 py-1.5 sm:py-2 text-left text-[9px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Bus
                </th>
                <th className="px-1.5 sm:px-4 py-1.5 sm:py-2 text-left text-[9px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Route
                </th>
                <th className="px-1.5 sm:px-4 py-1.5 sm:py-2 text-left text-[9px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Stops
                </th>
                <th className="px-1.5 sm:px-4 py-1.5 sm:py-2 text-center text-[9px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider w-10 sm:w-16">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((row, index) => (
                <tr key={row.busId} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-1.5 sm:px-4 py-1 sm:py-2 whitespace-nowrap">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1.5">
                      <span className="text-[11px] sm:text-sm font-bold text-slate-700 dark:text-slate-200">{row.busNumber}</span>
                      {row.plateNumber && (
                        <span className="text-[8px] sm:text-[10px] font-medium text-slate-400 dark:text-slate-500">({row.plateNumber})</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 whitespace-nowrap">
                    <Select
                      key={`${row.busId}-${row.routeId || 'empty'}`}
                      value={row.routeId || undefined}
                      onValueChange={(value) => handleRouteChange(index, value)}
                    >
                      <SelectTrigger className="w-full max-w-[100px] sm:max-w-[180px] h-6 sm:h-8 text-[10px] sm:text-xs bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 rounded-md">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent className="text-xs z-[100]">
                        <SelectItem value="__none__" className="text-xs">-- None --</SelectItem>
                        {sortedRoutes.map(route => {
                          const isAssigned = routeIds.includes(route.routeId) && route.routeId !== row.routeId;
                          return (
                            <SelectItem
                              key={route.routeId}
                              value={route.routeId}
                              className={`text-[10px] sm:text-xs ${isAssigned ? "text-slate-100 font-bold bg-blue-600/20" : ""}`}
                            >
                              {route.routeName} {isAssigned ? '• Assigned' : ''}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-1.5 sm:px-4 py-1 sm:py-2 text-[10px] sm:text-xs text-gray-500 dark:text-slate-400 max-w-[100px] sm:max-w-xs lg:max-w-md">
                    {row.routeId ? (
                      <span className="block truncate" title={row.stops.map(s => s.name).join(', ')}>
                        {formatStops(row.stops)}
                      </span>
                    ) : (
                      <span className="text-gray-400/50 italic text-[9px] sm:text-xs">Unassigned</span>
                    )}
                  </td>
                  <td className="px-1.5 sm:px-4 py-1 sm:py-2 text-center">
                    {row.routeId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClearRow(index)}
                        title="Clear"
                        className="h-5 w-5 sm:h-7 sm:w-7 p-0 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
                      >
                        <Trash2 className="h-3 w-3 sm:h-4 sm:w-4 text-slate-400 hover:text-red-400 transition-colors" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

