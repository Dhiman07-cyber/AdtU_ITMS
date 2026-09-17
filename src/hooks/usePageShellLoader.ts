"use client";

import { useEffect, useState } from 'react';

/**
 * usePageShellLoader
 * 
 * Enforces the LOADER → PAGE SHELL → SKELETON → REAL DATA architecture.
 * Binds any initial full-page loader to a maximum threshold (default 4000ms).
 * If data loading takes longer than maxDurationMs, showLoader flips to false,
 * exposing the genuine page shell with component skeletons.
 */
export function usePageShellLoader(isLoading: boolean, maxDurationMs: number = 4000) {
  const [showLoader, setShowLoader] = useState(isLoading);

  useEffect(() => {
    if (!isLoading) {
      setShowLoader(false);
      return;
    }

    setShowLoader(true);
    const timer = setTimeout(() => {
      // Maximum duration reached: expose shell with skeletons
      setShowLoader(false);
    }, maxDurationMs);

    return () => clearTimeout(timer);
  }, [isLoading, maxDurationMs]);

  const active = isLoading && showLoader;
  const isSkeleton = isLoading && !showLoader;

  return {
    showLoader: active,
    isSkeletonPhase: isSkeleton,
    [Symbol.iterator]: function* () {
      yield active;
      yield isSkeleton;
    },
  };
}
