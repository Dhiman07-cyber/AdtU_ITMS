/**
 * Canonical Role Cache for ADTU Bus Services
 *
 * Single source of truth for caching user role lookups.
 * Used by both verifyApiAuth and withSecurity to avoid duplicate caches.
 *
 * Migration status: SLICE 1 (users) — PostgreSQL.
 * Role resolution reads from PostgreSQL users table only.
 * No Firestore fallback. No dual-read. One runtime owner.
 */

import { getUserById } from '@/domains/identity';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ROLE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const ROLE_CACHE_MAX = 2000;

// ============================================================================
// TYPES
// ============================================================================

interface RoleCacheEntry {
    role: string;
    name: string;
    employeeId: string;
    expiresAt: number;
}

// ============================================================================
// CACHE INSTANCE
// ============================================================================

const _roleCache = new Map<string, RoleCacheEntry>();

/** Periodic cleanup every 10 min */
if (typeof setInterval !== 'undefined' && !(globalThis as any).__roleCacheCleanupStarted) {
    (globalThis as any).__roleCacheCleanupStarted = true;
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of _roleCache) {
            if (now > entry.expiresAt) _roleCache.delete(key);
        }
    }, 10 * 60 * 1000);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get cached role data for a user.
 * Returns null if not cached or expired.
 */
export function getCachedRole(uid: string): { role: string; name: string; employeeId: string } | null {
    const cached = _roleCache.get(uid);
    if (cached && Date.now() < cached.expiresAt) {
        return { role: cached.role, name: cached.name, employeeId: cached.employeeId };
    }
    return null;
}

/**
 * Resolve user role from PostgreSQL (with cache).
 * Single source of truth: PostgreSQL users table.
 * No Firestore fallback. No dual-read.
 */
export async function resolveUserRole(uid: string): Promise<{ role: string; name: string; employeeId: string }> {
    // Check cache first
    const cached = getCachedRole(uid);
    if (cached) {
        return cached;
    }

    // Read from PostgreSQL users table
    try {
        const pgUser = await getUserById(uid);

        if (pgUser) {
            const result = {
                role: pgUser.role || 'student',
                name: pgUser.name || '',
                employeeId: '',  // users table has no employeeId; role-specific profiles own this
            };
            setCachedRole(uid, result);
            return result;
        }
    } catch (err: any) {
        console.error(`[role-cache] PostgreSQL read failed for uid ${uid}:`, err.message);
    }

    // User not found in PostgreSQL — return empty (will result in 403 for protected routes)
    return { role: '', name: '', employeeId: '' };
}

/**
 * Set cached role data for a user.
 * Handles LRU eviction when cache reaches max size.
 */
export function setCachedRole(uid: string, entry: { role: string; name: string; employeeId: string }): void {
    // Evict oldest if at capacity
    if (_roleCache.size >= ROLE_CACHE_MAX) {
        const firstKey = _roleCache.keys().next().value;
        if (firstKey) _roleCache.delete(firstKey);
    }
    _roleCache.set(uid, { ...entry, expiresAt: Date.now() + ROLE_CACHE_TTL });
}

/**
 * Invalidate cached role for a user (e.g., after role change).
 */
export function invalidateCachedRole(uid: string): void {
    _roleCache.delete(uid);
}

/**
 * Clear entire role cache (for testing/admin).
 */
export function clearRoleCache(): void {
    _roleCache.clear();
}
