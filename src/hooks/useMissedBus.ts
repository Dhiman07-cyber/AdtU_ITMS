/**
 * useMissedBus Hook
 * 
 * React hook for managing missed-bus pickup requests from the student side.
 * Provides methods to raise, check status, and cancel requests.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase-client';
import { generatePrefixedId } from '@/lib/security/random-id';

// UI Messages (must match server-side messages - per spec)
export const MISSED_BUS_MESSAGES = {
    MAINTENANCE_TOAST: "This feature is currently under maintenance. Sorry for the inconvenience caused",
    ASSIGNED_NEARBY: "Your assigned bus appears nearby — please wait a few minutes so the driver can pick you up.",
    ASSIGNED_BUS_ON_WAY: "Your assigned bus is still on the way. Alternate buses are not available yet.",
    SEARCHING: "Searching other buses to help you. We'll notify you shortly.",
    REQUEST_PENDING: "Pickup request sent to nearby buses. We'll notify you when a driver accepts.",
    NO_CANDIDATES_MODAL: "Currently no bus is available to pick you up. Please wait for the next bus or try again later.",
    REQUEST_ACCEPTED: (busId: string, stop_name: string) =>
        `Good news — Bus ${busId} will pick you up. Please head to ${stop_name}.`,
    REQUEST_EXPIRED: "Your pickup request expired. Please try again if needed.",
    RATE_LIMITED: "You have reached the missed-bus request limit. Try again later.",
    ALREADY_HAS_PENDING: "You already have a pending or approved missed-bus request."
};

interface MissedBusRequest {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
    routeId: string;
    stop_name: string;
    candidateTripId?: string;
    createdAt: string;
    expiresAt: string;
    message?: string;
}

interface RaiseRequestParams {
    opId: string;
    routeId: string;
    stop_name: string;
    assignedTripId?: string;
    assignedBusId?: string;  // Student's assigned bus ID
}

interface UseMissedBusReturn {
    // State
    loading: boolean;
    error: string | null;
    activeRequest: MissedBusRequest | null;

    // Actions
    raiseRequest: (params: RaiseRequestParams) => Promise<{
        success: boolean;
        stage?: string;
        requestId?: string;
        message: string;
    }>;
    cancelRequest: (requestId: string) => Promise<boolean>;
    refreshStatus: () => Promise<void>;
    clearError: () => void;
}

export function useMissedBus(
    getIdToken: () => Promise<string | null>,
    studentId: string | null
): UseMissedBusReturn {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeRequest, setActiveRequest] = useState<MissedBusRequest | null>(null);

    // Clear error
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    // Refresh status from server
    const refreshStatus = useCallback(async () => {
        if (!studentId) return;

        try {
            const token = await getIdToken();
            if (!token) {
                setError('Not authenticated');
                return;
            }

            const response = await fetch('/api/missed-bus/status', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (data.success && data.hasActiveRequest) {
                setActiveRequest(data.request);
            } else {
                setActiveRequest(null);
            }

        } catch (err: any) {
            console.error('Error refreshing missed-bus status:', err);
            // Don't set error for status check failures - silent fail
        }
    }, [getIdToken, studentId]);

    // Raise a missed-bus request
    const raiseRequest = useCallback(async (params: RaiseRequestParams) => {
        setLoading(true);
        setError(null);

        try {
            const token = await getIdToken();
            if (!token) {
                setLoading(false);
                return {
                    success: false,
                    stage: 'error',
                    message: 'Not authenticated'
                };
            }

            const response = await fetch('/api/missed-bus/raise', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    idToken: token,
                    opId: params.opId,
                    routeId: params.routeId,
                    stop_name: params.stop_name,
                    assignedTripId: params.assignedTripId,
                    assignedBusId: params.assignedBusId
                })
            });

            const data = await response.json();

            if (data.success) {
                // Request created - refresh status
                await refreshStatus();
            } else {
                // Set appropriate error based on stage
                if (data.stage === 'maintenance') {
                    setError(MISSED_BUS_MESSAGES.MAINTENANCE_TOAST);
                } else if (data.stage === 'rate_limited') {
                    setError(MISSED_BUS_MESSAGES.RATE_LIMITED);
                }
            }

            setLoading(false);
            return {
                success: data.success,
                stage: data.stage,
                requestId: data.requestId,
                message: data.message || data.modal || data.toast || data.error
            };

        } catch (err: any) {
            console.error('Error raising missed-bus request:', err);
            setError(MISSED_BUS_MESSAGES.MAINTENANCE_TOAST);
            setLoading(false);
            return {
                success: false,
                stage: 'error',
                message: MISSED_BUS_MESSAGES.MAINTENANCE_TOAST
            };
        }
    }, [getIdToken, refreshStatus]);

    // Cancel a request
    const cancelRequest = useCallback(async (requestId: string) => {
        setLoading(true);

        try {
            const token = await getIdToken();
            if (!token) {
                setLoading(false);
                return false;
            }

            const response = await fetch('/api/missed-bus/cancel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    idToken: token,
                    requestId
                })
            });

            const data = await response.json();

            if (data.success) {
                setActiveRequest(null);
            }

            setLoading(false);
            return data.success;

        } catch (err: any) {
            console.error('Error cancelling missed-bus request:', err);
            setLoading(false);
            return false;
        }
    }, [getIdToken]);

    // Subscribe to realtime updates for active request
    useEffect(() => {
        if (!activeRequest || activeRequest.status !== 'pending') return;

        const channel = supabase
            .channel(`missed_bus_${activeRequest.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'missed_bus_requests',
                    filter: `id=eq.${activeRequest.id}`
                },
                (payload) => {
                    const updated = payload.new as any;
                    if (updated) {
                        setActiveRequest(prev => prev ? {
                            ...prev,
                            status: updated.status,
                            candidateTripId: updated.candidate_trip_id
                        } : null);
                    }
                }
            )
            .subscribe((status: string, err: any) => {
                if (status === 'CHANNEL_ERROR') {
                    console.error('Missed bus channel error:', err);
                } else if (status === 'TIMED_OUT') {
                    console.error('Missed bus channel timed out');
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeRequest?.id, activeRequest?.status]);

    // Initial status fetch
    useEffect(() => {
        const isMounted = { current: true };

        const fetchInitial = async () => {
            if (studentId && isMounted.current) {
                await refreshStatus();
            }
        };

        fetchInitial();

        return () => {
            isMounted.current = false;
        };
    }, [studentId, refreshStatus]);

    return {
        loading,
        error,
        activeRequest,
        raiseRequest,
        cancelRequest,
        refreshStatus,
        clearError
    };
}

export function generateOpId(): string {
    return generatePrefixedId('mbr_', 4);
}
