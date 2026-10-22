'use client';

import { useAuth } from '@/contexts/auth-context';
import { authApiFetch } from '@/lib/secure-api-client';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface UseLocalAndServerSearchOptions<T> {
  debounceMs?: number;
  minLength?: number;
  extractItems?: (json: any) => T[];
  getId?: (item: T) => string;
}

export interface UseLocalAndServerSearchConfig<T> {
  items: T[];
  searchTerm: string;
  localMatcher: (item: T, term: string) => boolean;
  apiSearchUrl?: string;
  apiEndpoint?: string;
  debounceMs?: number;
  minLength?: number;
  extractItems?: (json: any) => T[];
  responseExtractor?: (json: any) => T[];
  getId?: (item: T) => string;
}

export interface UseLocalAndServerSearchResult<T> {
  results: T[];
  items: T[];
  isSearchingServer: boolean;
  isSearching: boolean;
  isServerFallback: boolean;
  serverResults: T[];
  totalResultsCount: number;
}

/**
 * Tier 1 (Local-First): Instant in-memory filter (0ms, 0 network requests)
 * Tier 2 (Server-Fallback): Debounced (350ms) server query when local returns 0 items
 *
 * Supports both object configuration:
 *   useLocalAndServerSearch({ items, searchTerm, localMatcher, apiEndpoint, ... })
 * and positional argument invocation:
 *   useLocalAndServerSearch(items, searchTerm, localMatcher, apiSearchUrl, options)
 */
export function useLocalAndServerSearch<T>(
  config: UseLocalAndServerSearchConfig<T>
): UseLocalAndServerSearchResult<T>;
export function useLocalAndServerSearch<T>(
  items: T[],
  searchTerm: string,
  localMatcher: (item: T, term: string) => boolean,
  apiSearchUrl: string,
  options?: UseLocalAndServerSearchOptions<T>
): UseLocalAndServerSearchResult<T>;
export function useLocalAndServerSearch<T>(
  arg1: T[] | UseLocalAndServerSearchConfig<T>,
  arg2?: string,
  arg3?: (item: T, term: string) => boolean,
  arg4?: string,
  arg5?: UseLocalAndServerSearchOptions<T>
): UseLocalAndServerSearchResult<T> {
  const isObjectConfig = !Array.isArray(arg1) && typeof arg1 === 'object' && arg1 !== null && 'items' in arg1;

  const rawItems = isObjectConfig ? (arg1 as UseLocalAndServerSearchConfig<T>).items : (arg1 as T[]);
  const items = Array.isArray(rawItems) ? rawItems : [];
  const searchTerm = isObjectConfig ? ((arg1 as UseLocalAndServerSearchConfig<T>).searchTerm || '') : (arg2 || '');
  const localMatcher = isObjectConfig
    ? (arg1 as UseLocalAndServerSearchConfig<T>).localMatcher
    : (arg3 || (() => true));
  const apiSearchUrl = isObjectConfig
    ? ((arg1 as UseLocalAndServerSearchConfig<T>).apiEndpoint || (arg1 as UseLocalAndServerSearchConfig<T>).apiSearchUrl || '')
    : (arg4 || '');

  const debounceMs = isObjectConfig
    ? ((arg1 as UseLocalAndServerSearchConfig<T>).debounceMs ?? 350)
    : (arg5?.debounceMs ?? 350);

  const minLength = isObjectConfig
    ? ((arg1 as UseLocalAndServerSearchConfig<T>).minLength ?? 2)
    : (arg5?.minLength ?? 2);

  const extractItems = isObjectConfig
    ? ((arg1 as UseLocalAndServerSearchConfig<T>).responseExtractor ||
       (arg1 as UseLocalAndServerSearchConfig<T>).extractItems ||
       ((json: any) => json.data || json.students || json.drivers || json.buses || json.routes || json.moderators || json.applications || json.items || []))
    : (arg5?.extractItems ?? ((json: any) => json.data || json.students || json.drivers || json.buses || json.routes || json.moderators || json.applications || json.items || []));

  const getId = isObjectConfig
    ? ((arg1 as UseLocalAndServerSearchConfig<T>).getId ?? ((item: any) => item?.uid || item?.id || item?.application_id || item?.applicationId || ''))
    : (arg5?.getId ?? ((item: any) => item?.uid || item?.id || item?.application_id || item?.applicationId || ''));

  const { currentUser } = useAuth();

  const [serverResults, setServerResults] = useState<T[]>([]);
  const [isSearchingServer, setIsSearchingServer] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const trimmedTerm = searchTerm.trim();
  const normalizedTerm = trimmedTerm.toLowerCase();

  // Tier 1: Local-First In-Memory Filter (0ms)
  const localResults = useMemo(() => {
    if (!trimmedTerm) return items;
    return items.filter(item => localMatcher(item, normalizedTerm));
  }, [items, trimmedTerm, normalizedTerm, localMatcher]);

  // Tier 2: Debounced Server-Fallback Query on Local Miss
  useEffect(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (!trimmedTerm || trimmedTerm.length < minLength || !apiSearchUrl) {
      setServerResults([]);
      setIsSearchingServer(false);
      return;
    }

    // If local filter already has results, no need to query the server
    if (localResults.length > 0) {
      setServerResults([]);
      setIsSearchingServer(false);
      return;
    }

    setIsSearchingServer(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      try {
        if (!currentUser) {
          setIsSearchingServer(false);
          return;
        }

        const separator = apiSearchUrl.includes('?') ? '&' : '?';
        const url = `${apiSearchUrl}${separator}search=${encodeURIComponent(trimmedTerm)}&limit=50`;

        const res = await authApiFetch(currentUser, url, {
          signal: controller.signal,
        });

        if (!res.ok) {
          setIsSearchingServer(false);
          return;
        }

        const json = await res.json();
        const extracted: T[] = extractItems(json);

        // Deduplicate against loaded items and within server results
        const existingIds = new Set(items.map(i => getId(i)).filter(Boolean));
        const uniqueServer = extracted.filter(item => {
          const id = getId(item);
          return id ? !existingIds.has(id) : true;
        });

        if (!controller.signal.aborted) {
          setServerResults(uniqueServer);
          setIsSearchingServer(false);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('[useLocalAndServerSearch] Server search failed:', err);
          setIsSearchingServer(false);
        }
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedTerm, localResults.length, apiSearchUrl, currentUser, debounceMs, minLength, extractItems, getId, items]);

  const isServerFallback = trimmedTerm.length >= minLength && localResults.length === 0 && serverResults.length > 0;
  const results = !trimmedTerm ? items : (localResults.length > 0 ? localResults : serverResults);

  return {
    results,
    items: results,
    isSearchingServer,
    isSearching: isSearchingServer,
    isServerFallback,
    serverResults,
    totalResultsCount: results.length,
  };
}
