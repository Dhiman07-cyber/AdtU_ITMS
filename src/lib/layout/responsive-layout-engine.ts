/**
 * ADTU ITMS — Dynamic Responsive Layout Engine
 * 
 * Lightweight, continuous, space-aware layout engine adhering to master prompt constraints:
 * - NO whole-app React rerenders on resize (diff-only CSS custom property writes).
 * - Continuous scaling delegated to CSS variables, container queries, and clamp().
 * - Structural semantic modes for components that genuinely require discrete layout branching.
 * - rAF-throttled ResizeObserver with bulletproof SSR guard and deterministic cleanup.
 */

export type LayoutMode = 'compact' | 'standard' | 'wide' | 'ultrawide';
export type HeightMode = 'short' | 'medium' | 'tall';
export type Orientation = 'portrait' | 'landscape';

export interface LayoutDimensions {
  width: number;
  height: number;
}

export interface LayoutMetrics extends LayoutDimensions {
  aspectRatio: number;
  orientation: Orientation;
  layoutMode: LayoutMode;
  heightMode: HeightMode;
}

export interface ResponsiveEngineOptions {
  targetElement?: HTMLElement;
  onLayoutModeChange?: (mode: LayoutMode) => void;
  onHeightModeChange?: (mode: HeightMode) => void;
}

/**
 * Pure calculation function: maps width & height to semantic layout metrics.
 * Safe against division-by-zero, non-finite, and negative dimensions.
 */
export function calculateLayoutMetrics(dims: LayoutDimensions): LayoutMetrics {
  const width = Math.max(0, Number.isFinite(dims.width) ? dims.width : 0);
  const height = Math.max(0, Number.isFinite(dims.height) ? dims.height : 0);

  const aspectRatio = height > 0 ? Number((width / height).toFixed(4)) : 1;
  const orientation: Orientation = width >= height ? 'landscape' : 'portrait';

  // Semantic layout modes (structural breakpoints)
  let layoutMode: LayoutMode = 'compact';
  if (width >= 1536) {
    layoutMode = 'ultrawide';
  } else if (width >= 1024) {
    layoutMode = 'wide';
  } else if (width >= 640) {
    layoutMode = 'standard';
  } else {
    layoutMode = 'compact';
  }

  // Semantic height modes (height-aware layout support)
  let heightMode: HeightMode = 'medium';
  if (height < 680) {
    heightMode = 'short';
  } else if (height >= 800) {
    heightMode = 'tall';
  } else {
    heightMode = 'medium';
  }

  return {
    width,
    height,
    aspectRatio,
    orientation,
    layoutMode,
    heightMode,
  };
}

/**
 * WeakMap cache to track applied CSS custom properties per target element,
 * guaranteeing DIFF-ONLY DOM mutations to prevent unnecessary browser style recalculations.
 */
const appliedStylesCache = new WeakMap<HTMLElement, Record<string, string>>();

/**
 * Directly writes calculated metrics to CSS custom properties on targetElement (default: document.documentElement).
 * Compares against previous values and mutates only changed properties.
 */
export function applyLayoutMetricsToDOM(
  metrics: LayoutMetrics,
  targetElement?: HTMLElement
): void {
  const target = targetElement || (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!target || !target.style) return;

  let cached = appliedStylesCache.get(target);
  if (!cached) {
    cached = {};
    appliedStylesCache.set(target, cached);
  }

  const newProperties: Record<string, string> = {
    '--itms-vw': `${Math.round(metrics.width)}px`,
    '--itms-vh': `${Math.round(metrics.height)}px`,
    '--itms-aspect-ratio': `${metrics.aspectRatio}`,
    '--itms-layout-mode': metrics.layoutMode,
    '--itms-height-mode': metrics.heightMode,
    '--itms-orientation': metrics.orientation,
  };

  for (const [key, val] of Object.entries(newProperties)) {
    if (cached[key] !== val) {
      target.style.setProperty(key, val);
      cached[key] = val;
    }
  }
}

/**
 * Installs the lightweight viewport/container measurement observer.
 * Uses ResizeObserver with rAF throttling, zero continuous React state distribution,
 * and deterministic teardown.
 */
export function installResponsiveEngine(options: ResponsiveEngineOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const target = options.targetElement || document.documentElement;
  let rafId: number | null = null;
  let previousLayoutMode: LayoutMode | null = null;
  let previousHeightMode: HeightMode | null = null;

  const update = (dims: LayoutDimensions) => {
    const metrics = calculateLayoutMetrics(dims);
    applyLayoutMetricsToDOM(metrics, target);

    if (options.onLayoutModeChange && metrics.layoutMode !== previousLayoutMode) {
      previousLayoutMode = metrics.layoutMode;
      options.onLayoutModeChange(metrics.layoutMode);
    }

    if (options.onHeightModeChange && metrics.heightMode !== previousHeightMode) {
      previousHeightMode = metrics.heightMode;
      options.onHeightModeChange(metrics.heightMode);
    }
  };

  const getCleanDims = (explicitDims?: LayoutDimensions): LayoutDimensions => {
    if (explicitDims && explicitDims.width > 0 && explicitDims.height > 0) {
      return explicitDims;
    }
    if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }
    return {
      width: target.clientWidth || 1024,
      height: target.clientHeight || 768,
    };
  };

  // Initial measurement immediately on mount
  const initialDims: LayoutDimensions = getCleanDims();
  update(initialDims);

  let lastWidth = initialDims.width;
  let lastHeight = initialDims.height;

  const scheduleUpdate = (explicitDims?: LayoutDimensions) => {
    const currentDims = getCleanDims(explicitDims);
    // Ignore trivial jitter (< 2px) to eliminate redundant rAF loops and layout thrashing
    if (Math.abs(currentDims.width - lastWidth) < 2 && Math.abs(currentDims.height - lastHeight) < 2) {
      return;
    }
    lastWidth = currentDims.width;
    lastHeight = currentDims.height;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      update(currentDims);
    });
  };

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect && entry.contentRect.width > 0) {
        scheduleUpdate({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      } else {
        scheduleUpdate();
      }
    });
    ro.observe(target);
  }

  const handleWindowResize = () => {
    scheduleUpdate();
  };

  // Also bind window resize & orientationchange as standard fallbacks
  window.addEventListener('resize', handleWindowResize, { passive: true });
  window.addEventListener('orientationchange', handleWindowResize, { passive: true });

  // Return clean teardown function
  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    window.removeEventListener('resize', handleWindowResize);
    window.removeEventListener('orientationchange', handleWindowResize);
  };
}
