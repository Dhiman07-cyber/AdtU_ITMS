"use client";

import { GeolocationError,GeolocationPosition,geolocationService } from '@/lib/geolocation-service';
import { useEffect,useState } from 'react';

interface UseGeolocationOptions {
    watch?: boolean;
    enabled?: boolean;
}

export const useGeolocation = (options: UseGeolocationOptions = {}) => {
    const { watch = false, enabled = true } = options;
    const [position, setPosition] = useState<GeolocationPosition | null>(null);
    const [error, setError] = useState<GeolocationError | null>(null);
    const [loading, setLoading] = useState(enabled);
    const [permissionDenied, setPermissionDenied] = useState(false);

    const fetchPosition = () => {
        if (!geolocationService.isAvailable()) {
            setError({
                code: 0,
                message: 'Geolocation not supported',
                userFriendlyMessage: 'Your browser does not support location services.'
            });
            setLoading(false);
            return () => { };
        }

        setLoading(true);
        setError(null);

        const handleSuccess = (pos: GeolocationPosition) => {
            setPosition(pos);
            setLoading(false);
            setPermissionDenied(false);
        };

        const handleError = (err: GeolocationError) => {
            setError(err);
            setLoading(false);
            if (err.code === 1) { // PERMISSION_DENIED
                setPermissionDenied(true);
            }
        };

        if (watch) {
            return geolocationService.watchPosition(handleSuccess, handleError);
        } else {
            geolocationService.getCurrentPosition(handleSuccess, handleError);
            return () => { };
        }
    };

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }

        const cleanup = fetchPosition();
        return () => {
            if (typeof cleanup === 'function') {
                cleanup();
            }
        };
    }, [enabled, watch]);

    const retryTracking = () => {
        fetchPosition();
    };

    return {
        position,
        error,
        loading,
        permissionDenied,
        retryTracking,
        refreshPosition: fetchPosition
    };
};
