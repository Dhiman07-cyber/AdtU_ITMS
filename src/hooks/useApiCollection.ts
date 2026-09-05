/**
 * API-Backed Paginated Collection Hook
 *
 * DROP-IN REPLACEMENT for usePaginatedCollection.
 * Instead of reading Firestore client-side, this hook fetches from
 * server-side API routes (→ Domain → PostgreSQL).
 *
 * Same interface, same return shape, same cache invalidation support.
 * Client pages need zero behavioral changes — just swap the import.
 *
 * @module hooks/useApiCollection
 * @version 1.0.0
 */

import {
	POLLING_INTERVAL_MS
} from '@/config/runtime';
import { useAuth } from '@/contexts/auth-context';
import { useVisibilityAwareListener } from '@/utils/useVisibilityAwareListener';
import { useEffect,useRef,useState } from 'react';
import {
	dataCache,
	type CacheEntry
} from './usePaginatedCollection';

// ============================================================================
// API ROUTE MAP
// Maps collection names to their API endpoints and data extractors.
// ============================================================================

type ResponseNormalizer = (raw: any) => any[];

const API_ROUTE_MAP: Record<string, { path: string; normalize: ResponseNormalizer }> = {
    buses: {
        path: '/api/buses',
        normalize: (raw) => raw.buses ?? raw ?? [],
    },
    drivers: {
        path: '/api/drivers',
        normalize: (raw) => Array.isArray(raw) ? raw : raw.drivers ?? [],
    },
    students: {
        path: '/api/students',
        normalize: (raw) => Array.isArray(raw) ? raw : raw.students ?? [],
    },
    routes: {
        path: '/api/routes',
        normalize: (raw) => Array.isArray(raw) ? raw : raw.routes ?? [],
    },
    applications: {
        path: '/api/applications/all?limit=200',
        normalize: (raw) => raw.applications ?? raw ?? [],
    },
    moderators: {
        path: '/api/moderators',
        normalize: (raw) => Array.isArray(raw) ? raw : raw.moderators ?? [],
    },
};

// ============================================================================
// TYPES — Identical to usePaginatedCollection
// ============================================================================

export interface UseApiCollectionOptions {
    pageSize?: number;
    autoRefresh?: boolean;
    autoRefreshInterval?: number;
    orderByField?: string;
    orderDirection?: 'asc' | 'desc';
    fetchOnMount?: boolean;
    enabled?: boolean;
    cacheTTL?: number;
}

export interface UseApiCollectionResult<T> {
    data: T[];
    loading: boolean;
    error: Error | null;
    fetchNextPage: () => Promise<void>;
    refresh: () => Promise<void>;
    hasMore: boolean;
    totalFetched: number;
    isAutoRefreshing: boolean;
    setAutoRefresh: (enabled: boolean) => void;
}

// ============================================================================
// CACHE TTL (same defaults as usePaginatedCollection)
// ============================================================================

function getDefaultTTL(collectionName: string): number {
    switch (collectionName) {
        case 'payments':
        case 'applications':
        case 'waiting_flags':
            return 2 * 60 * 1000;
        case 'students':
        case 'drivers':
        case 'moderators':
            return 5 * 60 * 1000;
        case 'routes':
        case 'buses':
        case 'stops':
        case 'config':
            return 15 * 60 * 1000;
        case 'trip_sessions':
        case 'active_trips':
            return 0;
        default:
            return 5 * 60 * 1000;
    }
}

function getCacheKey(collectionName: string, orderByField: string, orderDirection: string): string {
    return `${collectionName}:${orderByField}:${orderDirection}`;
}

function getCachedData<T>(key: string, ttl: number): T[] | null {
    if (ttl <= 0) return null;
    const entry = dataCache.get(key);
    if (entry && Date.now() - entry.timestamp < ttl) {
        return entry.data as T[];
    }
    if (entry) dataCache.delete(key);
    return null;
}

function setCachedData<T>(key: string, data: T[]): void {
    if (dataCache.size >= 100) {
        const oldestKey = dataCache.keys().next().value;
        if (oldestKey) dataCache.delete(oldestKey);
    }
    dataCache.set(key, { data, timestamp: Date.now() } as CacheEntry<any>);
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export function useApiCollection<T = Record<string, any>>(
    collectionName: string,
    options: UseApiCollectionOptions = {}
): UseApiCollectionResult<T> {
    const {
        autoRefresh: initialAutoRefresh = false,
        autoRefreshInterval = POLLING_INTERVAL_MS,
        orderByField = 'updatedAt',
        orderDirection = 'desc',
        fetchOnMount = true,
        enabled = true,
        cacheTTL,
    } = options;

    const ttl = cacheTTL !== undefined ? cacheTTL : getDefaultTTL(collectionName);

    const { currentUser } = useAuth();
    const { isVisible, isOnline } = useVisibilityAwareListener();

    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(initialAutoRefresh);

    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const maxRetries = 3;
    const isMountedRef = useRef(true);
    const lastFetchRef = useRef<number>(0);
    const fetchPageRef = useRef<() => Promise<void>>(undefined);

    const routeConfig = API_ROUTE_MAP[collectionName];
    if (!routeConfig) {
        console.warn(`[useApiCollection] No API route configured for collection: ${collectionName}`);
    }

    const fetchPage = async (bypassCache: boolean = false) => {
        if (!currentUser || !enabled || !routeConfig) {
            setLoading(false);
            return;
        }

        const now = Date.now();
        if (now - lastFetchRef.current < 1000 && !bypassCache) return;
        lastFetchRef.current = now;

        const cacheKey = getCacheKey(collectionName, orderByField, orderDirection);
        if (!bypassCache && ttl > 0) {
            const cached = getCachedData<T>(cacheKey, ttl);
            if (cached) {
                setData(cached);
                setLoading(false);
                return;
            }
        }

        setLoading(true);
        setError(null);

        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(routeConfig.path, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!isMountedRef.current) return;

            if (!res.ok) {
                throw new Error(`API ${res.status}: ${res.statusText}`);
            }

            const raw = await res.json();
            const allData: T[] = routeConfig.normalize(raw) as T[];

            // Sort by orderByField client-side (API routes don't support sort params yet)
            const sorted = [...allData].sort((a: any, b: any) => {
                const aVal = a?.[orderByField] ?? '';
                const bVal = b?.[orderByField] ?? '';
                if (orderDirection === 'asc') return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            });

            setData(sorted);
            if (ttl > 0) setCachedData(cacheKey, sorted);

            retryCountRef.current = 0;
            setError(null);
        } catch (err) {
            if (!isMountedRef.current) return;
            setError(err as Error);

            if (retryCountRef.current < maxRetries) {
                retryCountRef.current++;
                const backoffMs = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
                retryTimerRef.current = setTimeout(() => {
                    retryTimerRef.current = null;
                    if (isMountedRef.current && fetchPageRef.current) {
                        fetchPageRef.current();
                    }
                }, backoffMs);
            }
        } finally {
            if (isMountedRef.current) setLoading(false);
        }
    };

    fetchPageRef.current = fetchPage;

    const fetchNextPage = async () => {
        // API routes return full datasets — no cursor pagination needed
        // This is a no-op for compatibility with usePaginatedCollection interface
    };

    const refresh = async () => {
        await fetchPage(true);
    };

    // Initial fetch
    useEffect(() => {
        isMountedRef.current = true;
        if (fetchOnMount && enabled && currentUser) {
            fetchPage();
        }
        return () => {
            isMountedRef.current = false;
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
    }, [fetchOnMount, enabled, currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-refresh
    useEffect(() => {
        if (!autoRefresh || !enabled || !isVisible || !isOnline) return;
        const intervalId = setInterval(() => {
            if (isVisible && isOnline && isMountedRef.current) refresh();
        }, autoRefreshInterval);
        return () => clearInterval(intervalId);
    }, [autoRefresh, enabled, isVisible, isOnline, autoRefreshInterval, refresh]);

    return {
        data,
        loading,
        error,
        fetchNextPage,
        refresh,
        hasMore: false,
        totalFetched: data.length,
        isAutoRefreshing: autoRefresh && isVisible && isOnline,
        setAutoRefresh,
    };
}

export { invalidateCollectionCache } from './usePaginatedCollection';
export default useApiCollection;
