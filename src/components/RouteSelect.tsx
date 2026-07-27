"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Route as RouteType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check,ChevronsUpDown,Info,Map,Route,Search,Sparkles } from "lucide-react";
import * as React from "react";

interface RouteSelectProps {
    routes: RouteType[];
    value: string;
    onChange: (value: string) => void;
    isLoading?: boolean;
    allowReserved?: boolean;
}

export default function RouteSelect({
    routes,
    value,
    onChange,
    isLoading = false,
    allowReserved = false,
}: RouteSelectProps) {
    const [open, setOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");

    const selectedRoute = routes.find((r) => r.routeId === value);
    const isReserved = value?.toLowerCase() === "reserved";

    const getStopName = (stop: any): string => {
        if (!stop) return 'N/A';
        if (typeof stop === 'string') return stop;
        return stop.name || "Unknown Stop";
    };

    const formatStops = (stops: any[]) => {
        if (!stops || stops.length === 0) return "No stops";
        const stopNames = stops.map(s => getStopName(s));
        if (stopNames.length <= 3) return stopNames.join(" → ");
        return `${stopNames[0]} → ${stopNames[1]} ... ${stopNames[stopNames.length - 1]}`;
    };

    const sortedRoutes = [...routes].sort((a, b) => {
        const aNum = parseInt(a.routeName.split('-')[1] || '0');
        const bNum = parseInt(b.routeName.split('-')[1] || '0');
        return aNum - bNum;
    });

    return (
        <div className="flex items-start gap-2 w-full">
            <div className="flex-1 relative">
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={open}
                            className={cn(
                                "w-full justify-between h-9 px-3 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-left font-normal transition-all duration-200 rounded-md shadow-sm cursor-pointer hover:cursor-pointer",
                                "focus-visible:border-blue-500 dark:focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500/20",
                                !value && "text-muted-foreground/60"
                            )}
                        >
                            <div className="flex items-center gap-2 truncate">
                                {isReserved ? (
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="h-4 w-4 text-green-500" />
                                        <span className="font-medium text-green-600 dark:text-green-400">Reserved (No Route)</span>
                                    </div>
                                ) : selectedRoute ? (
                                    <div className="flex items-center gap-2">
                                        <div className="text-blue-500 dark:text-blue-400">
                                            <Route className="h-4 w-4" />
                                        </div>
                                        <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{selectedRoute.routeName}</span>
                                        <span className="text-[10px] text-gray-500 truncate max-w-[150px] italic hidden sm:inline">
                                            {formatStops(selectedRoute.stops)}
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Search className="h-4 w-4 text-gray-400" />
                                        <span className="text-muted-foreground/60">Select Route</span>
                                    </div>
                                )}
                            </div>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50 text-gray-400" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl rounded-md overflow-hidden" align="start">
                        <Command className="bg-transparent" loop>
                            <CommandList className="max-h-[280px] scrollbar-thin p-1">
                                <CommandEmpty className="py-6 text-center text-sm text-gray-500">
                                    No routes found.
                                </CommandEmpty>

                                {isLoading ? (
                                    <CommandItem value="loading" disabled className="justify-center py-4 text-xs text-muted-foreground">
                                        Loading routes...
                                    </CommandItem>
                                ) : null}

                                {allowReserved && (
                                    <CommandGroup heading={<span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 px-2 mb-1 block">Special Assignments</span>}>
                                        <CommandItem
                                            value="reserved"
                                            onSelect={() => {
                                                onChange("reserved");
                                                setOpen(false);
                                            }}
                                            className="mx-1 rounded-md aria-selected:bg-green-500/10 aria-selected:text-green-600 dark:aria-selected:text-green-400 cursor-pointer hover:cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3 w-full py-1">
                                                <Sparkles className="h-4 w-4 text-green-500" />
                                                <div className="flex flex-col">
                                                    <span className="font-medium">Reserved</span>
                                                    <span className="text-[10px] opacity-60">No specific route assigned</span>
                                                </div>
                                                <Check
                                                    className={cn(
                                                        "ml-auto h-4 w-4",
                                                        isReserved ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                            </div>
                                        </CommandItem>
                                    </CommandGroup>
                                )}

                                <CommandGroup heading={<span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 px-2 mt-1.5 mb-1 block">Available Routes</span>}>
                                    {sortedRoutes.map((route) => (
                                        <CommandItem
                                            key={route.routeId}
                                            value={`${route.routeName} ${route.stops.map(s => getStopName(s)).join(" ")}`}
                                            onSelect={() => {
                                                onChange(route.routeId);
                                                setOpen(false);
                                            }}
                                            className="mx-0.5 rounded-md aria-selected:bg-blue-500/10 aria-selected:text-blue-600 dark:aria-selected:text-blue-400 cursor-pointer hover:cursor-pointer"
                                        >
                                            <div className="flex items-center gap-3 w-full py-1">
                                                <Route className="h-4 w-4 text-blue-500" />
                                                <div className="flex flex-col flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-sm">{route.routeName}</span>
                                                        <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-blue-500/5 text-blue-500 border-blue-500/20">
                                                            {route.stops.length} Stops
                                                        </Badge>
                                                    </div>
                                                    <span className="text-[10px] opacity-50 truncate block italic">
                                                        {formatStops(route.stops)}
                                                    </span>
                                                </div>
                                                <Check
                                                    className={cn(
                                                        "ml-2 h-4 w-4 shrink-0",
                                                        value === route.routeId ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                            </div>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            </div>

            {selectedRoute && (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon"
                            type="button"
                            className="h-9 w-9 shrink-0 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-md transition-colors cursor-pointer hover:cursor-pointer"
                        >
                            <Info className="h-5 w-5 text-blue-500" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl rounded-md overflow-hidden" align="end" side="top">
                        <div className="p-3 border-b border-gray-100 dark:border-white/5">
                            <h4 className="font-semibold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                                <Map className="h-4 w-4 text-blue-500" />
                                {selectedRoute.routeName} Stops
                            </h4>
                        </div>
                        <div className="p-1 max-h-60 overflow-y-auto overflow-x-hidden scrollbar-thin">
                            <ul className="space-y-0.5">
                                {selectedRoute.stops.map((stop, index) => (
                                    <li
                                        key={index}
                                        className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 flex items-start gap-2 rounded-sm"
                                    >
                                        <span className="font-bold text-blue-500/50 min-w-[14px]">{index + 1}.</span>
                                        <span className="line-clamp-2">{getStopName(stop)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="p-2 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/5">
                            <div className="flex items-center justify-between text-[10px] text-gray-500 uppercase tracking-tighter">
                                <span>Start: {getStopName(selectedRoute.stops[0])}</span>
                                <span>End: {getStopName(selectedRoute.stops[selectedRoute.stops.length - 1])}</span>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}
