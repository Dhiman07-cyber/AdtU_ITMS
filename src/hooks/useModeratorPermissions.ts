"use client";

import { useAuth } from '@/contexts/auth-context';
import { getSigningOutState } from '@/lib/firestore-error-handler';
import {
	DEFAULT_MODERATOR_PERMISSIONS,
	ModeratorPermissions
} from '@/lib/types/moderator-permissions';
import { useEffect,useState } from 'react';

interface UseModeratorPermissionsReturn {
    permissions: ModeratorPermissions;
    loading: boolean;
    error: string | null;

    // Convenience helpers
    canStudentView: boolean;
    canStudentAdd: boolean;
    canStudentEdit: boolean;
    canStudentDelete: boolean;
    canStudentReassign: boolean;

    canDriverView: boolean;
    canDriverAdd: boolean;
    canDriverEdit: boolean;
    canDriverDelete: boolean;
    canDriverReassign: boolean;

    canBusView: boolean;
    canBusAdd: boolean;
    canBusEdit: boolean;
    canBusDelete: boolean;
    canBusReassign: boolean;

    canRouteView: boolean;
    canRouteAdd: boolean;
    canRouteEdit: boolean;
    canRouteDelete: boolean;

    canApplicationView: boolean;
    canApplicationApprove: boolean;
    canApplicationReject: boolean;
    canGenerateVerificationCode: boolean;
    canAppearInModeratorList: boolean;

    canApproveOfflinePayment: boolean;
    canRejectOfflinePayment: boolean;
}

// --- Cache Configuration ---
// Permissions are cached in localStorage per UID.
// TTL is 24 hours — permissions rarely change and admins update them manually.
// On page load, data loads from cache instantly; re-fetched if stale on next login.
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCacheKey(uid: string) {
    return `adtu_mod_perms_${uid}`;
}

function getCachedPermissions(uid: string): ModeratorPermissions | null {
    try {
        if (typeof window === 'undefined') return null;
        const raw = localStorage.getItem(getCacheKey(uid));
        if (!raw) return null;
        const { data, expires } = JSON.parse(raw);
        if (Date.now() > expires) {
            localStorage.removeItem(getCacheKey(uid));
            return null;
        }
        return data as ModeratorPermissions;
    } catch {
        return null;
    }
}

function setCachedPermissions(uid: string, perms: ModeratorPermissions) {
    try {
        if (typeof window === 'undefined') return;
        localStorage.setItem(getCacheKey(uid), JSON.stringify({
            data: perms,
            expires: Date.now() + CACHE_TTL,
        }));
    } catch {
        // Storage failure is non-fatal
    }
}

/**
 * Hook to fetch moderator permissions.
 *
 * REALTIME:
 * - Uses API polling (every 30s) for permission updates.
 * - Results cached in localStorage with 24h TTL to avoid flash on load.
 * - For admins: returns full permissions without any API call.
 *
 * Security: This is client-side enforcement only. API routes ALSO
 * check permissions server-side for actual security.
 */
export function useModeratorPermissions(): UseModeratorPermissionsReturn {
    const { currentUser, userData } = useAuth();
    const [permissions, setPermissions] = useState<ModeratorPermissions>(() => {
        if (userData?.role === 'admin') {
            const { FULL_MODERATOR_PERMISSIONS } = require('@/lib/types/moderator-permissions');
            return FULL_MODERATOR_PERMISSIONS;
        }
        if (currentUser?.uid) {
            const cached = getCachedPermissions(currentUser.uid);
            if (cached) return cached;
        }
        return DEFAULT_MODERATOR_PERMISSIONS;
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Admins have full permissions — no API call needed
        if (userData?.role === 'admin') {
            const { FULL_MODERATOR_PERMISSIONS } = require('@/lib/types/moderator-permissions');
            setPermissions(FULL_MODERATOR_PERMISSIONS);
            setLoading(false);
            return;
        }

        // Non-moderators use defaults
        if (!currentUser || userData?.role !== 'moderator') {
            setPermissions(DEFAULT_MODERATOR_PERMISSIONS);
            setLoading(false);
            return;
        }

        const uid = currentUser.uid;

        // 1. Load from cache immediately to avoid flash
        const cached = getCachedPermissions(uid);
        if (cached) {
            setPermissions(cached);
            setLoading(false);
        }

        // 2. Fetch permissions from PostgreSQL via API
        let isMounted = true;
        let pollInterval: NodeJS.Timeout | null = null;

        const fetchPermissions = async () => {
            try {
                const token = await currentUser.getIdToken();
                const response = await fetch(`/api/moderators/${uid}/permissions`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (!isMounted) return;

                if (response.ok) {
                    const result = await response.json();
                    const perms = result.permissions as ModeratorPermissions | undefined;
                    const merged = perms ? mergeWithDefaults(perms) : DEFAULT_MODERATOR_PERMISSIONS;
                    setPermissions(merged);
                    setCachedPermissions(uid, merged);
                } else {
                    setPermissions(DEFAULT_MODERATOR_PERMISSIONS);
                    setCachedPermissions(uid, DEFAULT_MODERATOR_PERMISSIONS);
                }
                setError(null);
                setLoading(false);
            } catch (err: any) {
                if (!isMounted) return;
                if (getSigningOutState()) return;
                console.error('[useModeratorPermissions] Fetch error:', err);
                setError('Failed to load permissions');
                setLoading(false);
            }
        };

        // Initial fetch
        fetchPermissions();

        // Poll every 30 seconds for permission changes
        pollInterval = setInterval(fetchPermissions, 30 * 1000);

        return () => {
            isMounted = false;
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [currentUser?.uid, userData?.role]);

    return {
        permissions,
        loading,
        error,

        // Student
        canStudentView: permissions.students.canView,
        canStudentAdd: permissions.students.canAdd,
        canStudentEdit: permissions.students.canEdit,
        canStudentDelete: permissions.students.canDelete,
        canStudentReassign: permissions.students.canReassign,

        // Driver
        canDriverView: permissions.drivers.canView,
        canDriverAdd: permissions.drivers.canAdd,
        canDriverEdit: permissions.drivers.canEdit,
        canDriverDelete: permissions.drivers.canDelete,
        canDriverReassign: permissions.drivers.canReassign,

        // Bus
        canBusView: permissions.buses.canView,
        canBusAdd: permissions.buses.canAdd,
        canBusEdit: permissions.buses.canEdit,
        canBusDelete: permissions.buses.canDelete,
        canBusReassign: permissions.buses.canReassign,

        // Route
        canRouteView: permissions.routes.canView,
        canRouteAdd: permissions.routes.canAdd,
        canRouteEdit: permissions.routes.canEdit,
        canRouteDelete: permissions.routes.canDelete,

        // Application
        canApplicationView: permissions.applications.canView,
        canApplicationApprove: permissions.applications.canApprove,
        canApplicationReject: permissions.applications.canReject,
        canGenerateVerificationCode: permissions.applications.canGenerateVerificationCode,
        canAppearInModeratorList: permissions.applications.canAppearInModeratorList,

        // Payment
        canApproveOfflinePayment: permissions.payments.canApproveOfflinePayment,
        canRejectOfflinePayment: permissions.payments.canRejectOfflinePayment,
    };
}

function mergeWithDefaults(partial: Partial<ModeratorPermissions>): ModeratorPermissions {
    return {
        students: { ...DEFAULT_MODERATOR_PERMISSIONS.students, ...(partial.students || {}) },
        drivers: { ...DEFAULT_MODERATOR_PERMISSIONS.drivers, ...(partial.drivers || {}) },
        buses: { ...DEFAULT_MODERATOR_PERMISSIONS.buses, ...(partial.buses || {}) },
        routes: { ...DEFAULT_MODERATOR_PERMISSIONS.routes, ...(partial.routes || {}) },
        applications: { ...DEFAULT_MODERATOR_PERMISSIONS.applications, ...(partial.applications || {}) },
        payments: { ...DEFAULT_MODERATOR_PERMISSIONS.payments, ...(partial.payments || {}) },
    };
}
