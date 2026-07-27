/**
 * Safe Paginated Collection Hook
 * 
 * REPLACES: useRealtimeCollection (which uses unbounded onSnapshot)
 * 
 * This hook uses getDocs() with explicit pagination to prevent
 * Firestore quota exhaustion. It NEVER uses onSnapshot on collections.
 * 
 * Features:
 * - Explicit pagination with configurable page size (max 50)
 * - Optional auto-refresh with exponential backoff on failures
 * - Visibility-aware to prevent polling when tab is hidden
 * - TypeScript generics for type safety
 * - In-memory cache to prevent HMR/remount duplicate fetches
 * 
 * @module hooks/usePaginatedCollection
 * @version 1.1.0
 * @since 2026-01-02
 */

import {
	DEFAULT_PAGE_SIZE,
	MAX_QUERY_LIMIT,
	POLLING_INTERVAL_MS
} from '@/config/runtime';
import { useAuth } from '@/contexts/auth-context';
import { db } from '@/lib/firebase';
import { useVisibilityAwareListener } from '@/utils/useVisibilityAwareListener';
import {
	DocumentData,
	QueryConstraint,
	QueryDocumentSnapshot,
	collection,
	getDocs,
	getDocsFromServer,
	limit,
	orderBy,
	query,
	startAfter
} from 'firebase/firestore';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';

// ============================================================================
// GLOBAL CACHE - Prevents duplicate fetches during HMR and rapid remounts
// ============================================================================
export interface CacheEntry<T> {
    data: T[];
    timestamp: number;
}

export const dataCache = new Map<string, CacheEntry<any>>();
const MAX_CACHE_ENTRIES = 100;

function getDefaultTTL(collectionName: string): number {
    switch (collectionName) {
        case 'payments':
        case 'applications':
        case 'waiting_flags':
            return 2 * 60 * 1000; // 2 minutes
        case 'students':
        case 'drivers':
        case 'moderators':
            return 5 * 60 * 1000; // 5 minutes
        case 'routes':
        case 'buses':
        case 'stops':
        case 'config':
            return 15 * 60 * 1000; // 15 minutes
        case 'bus_locations':
        case 'trip_sessions':
        case 'active_trips':
            return 0; // 0 minutes (no cache)
        default:
            return 5 * 60 * 1000; // default to 5 minutes
    }
}

function getCacheKey(collectionName: string, orderByField: string, orderDirection: string): string {
    return `${collectionName}:${orderByField}:${orderDirection}`;
}

function getCachedData<T>(key: string, ttl: number): T[] | null {
    if (ttl <= 0) return null;
    const entry = dataCache.get(key);
    if (entry && Date.now() - entry.timestamp < ttl) {
        return entry.data;
    }
    if (entry) {
        dataCache.delete(key);
    }
    return null;
}

function setCachedData<T>(key: string, data: T[]): void {
    // Evict oldest entries when cache is full
    if (dataCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = dataCache.keys().next().value;
        if (oldestKey) dataCache.delete(oldestKey);
    }
    dataCache.set(key, { data, timestamp: Date.now() });
}

// Clear cache for a specific collection (call after mutations)
export function invalidateCollectionCache(collectionName: string): void {
    const keysToDelete: string[] = [];
    dataCache.forEach((_, key) => {
        if (key.startsWith(`${collectionName}:`)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => {
        dataCache.delete(key);
    });
}




// ============================================================================
// TYPES
// ============================================================================

export interface UsePaginatedCollectionOptions {
    /** Number of documents per page (default: 50, max: 50) */
    pageSize?: number;
    /** Enable auto-refresh polling (default: false) */
    autoRefresh?: boolean;
    /** Auto-refresh interval in milliseconds (default: 120000 = 2 min) */
    autoRefreshInterval?: number;
    /** Initial sort field for cursor-based pagination */
    orderByField?: string;
    /** Sort direction */
    orderDirection?: 'asc' | 'desc';
    /** Whether to fetch on mount (default: true) */
    fetchOnMount?: boolean;
    /** Only fetch when this is true */
    enabled?: boolean;
    /** Custom Cache TTL in milliseconds */
    cacheTTL?: number;
}

export interface UsePaginatedCollectionResult<T> {
    /** Flattened array of all fetched documents */
    data: T[];
    /** Whether currently fetching */
    loading: boolean;
    /** Error from last fetch attempt */
    error: Error | null;
    /** Fetch the next page of results */
    fetchNextPage: () => Promise<void>;
    /** Refresh from the beginning (clears all pages) */
    refresh: () => Promise<void>;
    /** Whether there are more pages to fetch */
    hasMore: boolean;
    /** Total documents fetched so far */
    totalFetched: number;
    /** Whether auto-refresh is currently active */
    isAutoRefreshing: boolean;
    /** Toggle auto-refresh on/off */
    setAutoRefresh: (enabled: boolean) => void;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Safe paginated collection hook that uses getDocs() instead of onSnapshot.
 * 
 * @example
 * ```tsx
 * // Basic usage
 * const { data: students, loading, fetchNextPage, refresh } = usePaginatedCollection<Student>(
 *   'students',
 *   { pageSize: 50, orderByField: 'updatedAt', orderDirection: 'desc' }
 * );
 * ```
 */
export function usePaginatedCollection<T = DocumentData>(
    collectionName: string,
    options: UsePaginatedCollectionOptions = {}
): UsePaginatedCollectionResult<T> {
    const {
        pageSize = DEFAULT_PAGE_SIZE,
        autoRefresh: initialAutoRefresh = false,
        autoRefreshInterval = POLLING_INTERVAL_MS,
        orderByField = 'updatedAt',
        orderDirection = 'desc',
        fetchOnMount = true,
        enabled = true,
        cacheTTL,
    } = options;

    // Enforce max page size
    const effectivePageSize = Math.min(pageSize, MAX_QUERY_LIMIT);
    const ttl = cacheTTL !== undefined ? cacheTTL : getDefaultTTL(collectionName);

    const { currentUser } = useAuth();
    const { isVisible, isOnline } = useVisibilityAwareListener();

    // State
    const [pages, setPages] = useState<T[][]>([]);
    const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(initialAutoRefresh);

    // Refs for stable callbacks
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const maxRetries = 3;
    const isMountedRef = useRef(true);
    const lastFetchRef = useRef<number>(0);
    const fetchPageRef = useRef<(isNextPage?: boolean, bypassCache?: boolean) => Promise<void>>(undefined);

    // Memoized query factory
    const createQuery = useCallback(() => {
        const collRef = collection(db, collectionName);
        // SPARK PLAN SAFETY: Removed secondary documentId() sort to avoid requiring composite indexes
        // Pagination still works correctly via cursor using startAfter()
        return query(collRef, orderBy(orderByField, orderDirection));
    }, [collectionName, orderByField, orderDirection]);

    // Fetch a page of documents
    const fetchPage = useCallback(async (isNextPage: boolean = false, bypassCache: boolean = false) => {
        if (!currentUser || !enabled) {
            setLoading(false);
            return;
        }

        // Prevent duplicate fetches within 1 second
        const now = Date.now();
        if (now - lastFetchRef.current < 1000 && !isNextPage && !bypassCache) {
            return;
        }
        lastFetchRef.current = now;

        // Check cache for initial page load (not pagination)
        const cacheKey = getCacheKey(collectionName, orderByField, orderDirection);
        if (!isNextPage && !bypassCache && ttl > 0) {
            const cached = getCachedData<T>(cacheKey, ttl);
            if (cached) {
                setPages([cached]);
                setLoading(false);
                setHasMore(cached.length >= effectivePageSize);
                return;
            }
        }

        setLoading(true);
        setError(null);

        try {
            let q = createQuery();

            // Apply pagination
            const constraints: QueryConstraint[] = [limit(effectivePageSize)];

            if (isNextPage && cursor) {
                constraints.push(startAfter(cursor));
            }

            q = query(q, ...constraints);

            // SPARK PLAN FIX: Force server fetch when refreshing to ensure latest data
            // parsing bypassCache = true means we want fresh data from server
            const fetcher = bypassCache ? getDocsFromServer : getDocs;

            const snapshot = await fetcher(q);

            if (!isMountedRef.current) return;

            const docs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as T[];

            // Update cursor for next page
            const lastDoc = snapshot.docs[snapshot.docs.length - 1] || null;
            setCursor(lastDoc);

            // Check if there are more results
            setHasMore(snapshot.docs.length === effectivePageSize);

            // Update pages and cache (only for initial page, not pagination)
            setPages(prev => isNextPage ? [...prev, docs] : [docs]);
            if (!isNextPage && ttl > 0) {
                setCachedData(cacheKey, docs);
            }

            // Reset retry count on success
            retryCountRef.current = 0;
            setError(null);

        } catch (err) {
            console.error(`[usePaginatedCollection] Error fetching ${collectionName}:`, err);

            if (!isMountedRef.current) return;

            setError(err as Error);

            // Exponential backoff retry for transient errors
            if (retryCountRef.current < maxRetries) {
                retryCountRef.current++;
                const backoffMs = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
                console.log(`[usePaginatedCollection] Retrying in ${backoffMs}ms (attempt ${retryCountRef.current}/${maxRetries})`);

                retryTimerRef.current = setTimeout(() => {
                    retryTimerRef.current = null;
                    if (isMountedRef.current && fetchPageRef.current) {
                        fetchPageRef.current(isNextPage);
                    }
                }, backoffMs);
            }
        } finally {
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    }, [currentUser, enabled, createQuery, effectivePageSize, cursor, collectionName]);

    // Keep ref current so retry timer always calls the latest fetchPage
    fetchPageRef.current = fetchPage;

    // Public methods
    const fetchNextPage = useCallback(async () => {
        if (!hasMore || loading) return;
        await fetchPage(true);
    }, [hasMore, loading, fetchPage]);

    const refresh = useCallback(async () => {
        setCursor(null);
        setHasMore(true);
        // SPARK PLAN FIX: Don't clear pages immediately to prevent UI flash
        // setPages([]); 
        await fetchPage(false, true); // bypassCache = true for manual refresh
    }, [fetchPage]);

    // Initial fetch
    useEffect(() => {
        isMountedRef.current = true;

        if (fetchOnMount && enabled && currentUser) {
            fetchPage(false);
        }

        return () => {
            isMountedRef.current = false;
            if (retryTimerRef.current) {
                clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
    }, [fetchOnMount, enabled, currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-refresh with visibility awareness
    useEffect(() => {
        if (!autoRefresh || !enabled || !isVisible || !isOnline) {
            return;
        }

        const intervalId = setInterval(() => {
            if (isVisible && isOnline && isMountedRef.current) {
                refresh();
            }
        }, autoRefreshInterval);

        return () => clearInterval(intervalId);
    }, [autoRefresh, enabled, isVisible, isOnline, autoRefreshInterval, refresh]);

    // Memoized flattened data
    const data = useMemo(() => pages.flat(), [pages]);

    return {
        data,
        loading,
        error,
        fetchNextPage,
        refresh,
        hasMore,
        totalFetched: data.length,
        isAutoRefreshing: autoRefresh && isVisible && isOnline,
        setAutoRefresh,
    };
}

export default usePaginatedCollection;
