"use client";

import type { ComponentProps } from "react";
import dynamic from "next/dynamic";
import MapErrorBoundary from "./MapErrorBoundary";
export type RouteStopLite = {
    lat: number;
    lng: number;
    name?: string;
    order?: number;
};

const GuwahatiBusMap = dynamic(() => import("@/components/maps/GuwahatiBusMap"), {
    ssr: false,
    loading: () => <div className="h-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 rounded-3xl animate-pulse" />,
});

export type LiveTrackingBusMapProps = {
    busId: string;
    busNumber?: string;
    journeyActive?: boolean;
    isFullScreen?: boolean;
    onToggleFullScreen?: () => void;
    showStatsOnMobile?: boolean;
    primaryActionLabel?: string;
    onPrimaryAction?: () => void;
    primaryActionColor?: 'red' | 'blue' | 'green' | 'orange' | 'yellow';
    primaryActionDisabled?: boolean;
    studentLocation?: { lat: number; lng: number; accuracy?: number } | null;
    onShowQrCode?: () => void;
    currentLocation?: any;
    loading?: boolean;
    /** Shown on Google Maps only (route polyline + stop pins). */
    route_stops?: RouteStopLite[];
};

/**
 * Admin-controlled map engine for student live tracking.
 * - Default: Guwahati Map (MapLibre + PMTiles)
 */
export default function LiveTrackingBusMap(props: LiveTrackingBusMapProps) {
    const { route_stops, ...rest } = props;

    return (
        <MapErrorBoundary>
            <GuwahatiBusMap
                key={`h-${props.busId}`}
                {...rest}
            />
        </MapErrorBoundary>
    );
}
