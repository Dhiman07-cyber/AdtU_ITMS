/**
 * Shared dashboard caching utilities for admin and moderator dashboards.
 * Uses localStorage with configurable TTL to provide instant dashboard display
 * while data is being fetched from the API.
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface DashboardCacheData<T> {
  realCounts: T;
  paymentTrends: { days: any[]; months: any[]; methodTrend?: any[] };
}

/**
 * Create a typed dashboard cache accessor for a given role.
 * Each role gets its own localStorage keys to avoid collisions.
 */
export function createDashboardCache<T>(role: 'admin' | 'moderator') {
  const key = `adtu_${role}_dashboard_cache`;
  const expiryKey = `adtu_${role}_dashboard_expiry`;

  function getCached(): DashboardCacheData<T> | null {
    try {
      if (typeof window === 'undefined') return null;
      const cached = localStorage.getItem(key);
      const expiry = localStorage.getItem(expiryKey);
      if (!cached || !expiry) return null;
      if (Date.now() > parseInt(expiry)) {
        localStorage.removeItem(key);
        localStorage.removeItem(expiryKey);
        return null;
      }
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }

  function setCached(data: DashboardCacheData<T>): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem(expiryKey, (Date.now() + CACHE_TTL).toString());
    } catch {
      // Storage failure is non-fatal
    }
  }

  function clearCached(): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.removeItem(key);
      localStorage.removeItem(expiryKey);
    } catch {
      // Storage failure is non-fatal
    }
  }

  return { getCached, setCached, clearCached };
}

