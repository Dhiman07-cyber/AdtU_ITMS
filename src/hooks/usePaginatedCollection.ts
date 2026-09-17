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
import { useVisibilityAwareListener } from '@/utils/useVisibilityAwareListener';
import { useEffect,useRef,useState } from 'react';

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




import { useApiCollection,type UseApiCollectionOptions,type UseApiCollectionResult } from './useApiCollection';

export type UsePaginatedCollectionOptions = UseApiCollectionOptions;
export type UsePaginatedCollectionResult<T> = UseApiCollectionResult<T>;

/**
 * Re-export useApiCollection as usePaginatedCollection for backwards compatibility.
 * All client collection reads now flow through Supabase PostgreSQL API endpoints.
 */
export function usePaginatedCollection<T = any>(
    collectionName: string,
    options: UsePaginatedCollectionOptions = {}
): UsePaginatedCollectionResult<T> {
    return useApiCollection<T>(collectionName, options);
}

export default usePaginatedCollection;

