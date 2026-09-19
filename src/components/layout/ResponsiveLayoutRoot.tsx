"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  installResponsiveEngine,
  type LayoutMode,
  type HeightMode
} from '@/lib/layout/responsive-layout-engine';

interface ResponsiveLayoutContextValue {
  layoutMode: LayoutMode;
  heightMode: HeightMode;
}

const ResponsiveLayoutContext = createContext<ResponsiveLayoutContextValue>({
  layoutMode: 'wide',
  heightMode: 'medium',
});

/**
 * Hook to access discrete semantic layout modes (e.g. 'compact' | 'standard' | 'wide' | 'ultrawide')
 * and height modes ('short' | 'medium' | 'tall').
 * IMPORTANT: This does NOT trigger on continuous pixel resize. It only updates when crossing
 * major structural boundaries, preserving the invariant of zero continuous React rerenders.
 */
export const useResponsiveLayoutMode = () => useContext(ResponsiveLayoutContext);

export interface ResponsiveLayoutRootProps {
  children: React.ReactNode;
}

/**
 * ResponsiveLayoutRoot:
 * Lightweight (<1.5KB) Client Island that initializes the Responsive Layout Engine.
 * 
 * Invariants:
 * 1. SSR / Hydration Safe: Renders children immediately without layout flash or hydration mismatch.
 * 2. Continuous resizing is handled purely by CSS custom properties (--itms-vw, --itms-vh, etc.)
 *    and container queries, causing NO tree-wide React rerenders.
 * 3. Deterministic cleanup on unmount, leaving zero leaking observers or listeners.
 */
export default function ResponsiveLayoutRoot({ children }: ResponsiveLayoutRootProps) {
  const [semanticState, setSemanticState] = useState<ResponsiveLayoutContextValue>({
    layoutMode: 'wide',
    heightMode: 'medium',
  });

  useEffect(() => {
    // Install the rAF-throttled measurement engine
    const cleanup = installResponsiveEngine({
      onLayoutModeChange: (newLayoutMode) => {
        React.startTransition(() => {
          setSemanticState((prev) =>
            prev.layoutMode === newLayoutMode ? prev : { ...prev, layoutMode: newLayoutMode }
          );
        });
      },
      onHeightModeChange: (newHeightMode) => {
        React.startTransition(() => {
          setSemanticState((prev) =>
            prev.heightMode === newHeightMode ? prev : { ...prev, heightMode: newHeightMode }
          );
        });
      },
    });

    return () => {
      cleanup();
    };
  }, []);

  return (
    <ResponsiveLayoutContext.Provider value={semanticState}>
      {children}
    </ResponsiveLayoutContext.Provider>
  );
}
