/**
 * Student Assignment Metadata Cache (L1 Memory + L2 Redis)
 *
 * Caches student assignment & entitlement attributes:
 * { uid, fullName, busId, routeId, shift, stopName, status, softBlock, validUntil, hardBlock }
 *
 * Eliminates repetitive database queries to `student_profiles` across:
 * 1. WebSocket `presence` handshakes in `server/socket-router.ts`
 * 2. `/api/student/trip-status` entitlement and bus matching
 * 3. `/api/student/waiting-flag` corridor & entitlement checks
 *
 * Guarantees:
 * - Singleflight deduplication on cache misses (prevents concurrent query storms for same user).
 * - Bounded L1 in-memory LRU cache (2,500 entries, 5-minute TTL).
 * - L2 Redis key `student:assign:<uid>` with 300s TTL.
 * - Deterministic invalidation on student updates, reassignments, and approvals.
 */

import { getSupabaseServer } from '@/lib/supabase-server';
import { executeGpsRedisCommand } from '@/domains/gps/services/gps-redis-guard';
import { publishRoleInvalidation } from '@/lib/security/role-cache-redis';

export interface CachedStudentAssignment {
  uid: string;
  fullName: string;
  busId: string | null;
  routeId: string | null;
  shift: string | null;
  stopName: string | null;
  status: string;
  softBlock: string | null;
  validUntil: string | null;
  hardBlock: string | null;
  cachedAtMs: number;
}

const L1_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_L1_ENTRIES = 2500;
const REDIS_KEY_PREFIX = 'student:assign:';
const REDIS_TTL_SECONDS = 300; // 5 minutes

const assignmentL1Cache = new Map<string, { data: CachedStudentAssignment; expiresAtMs: number }>();
const inFlightFetches = new Map<string, Promise<CachedStudentAssignment | null>>();

function cleanUid(rawUid: string): string {
  if (!rawUid) return '';
  return decodeURIComponent(rawUid).trim();
}

/**
 * Fetch cached student assignment profile, checking L1 Memory -> L2 Redis -> PostgreSQL.
 */
export async function getCachedStudentAssignment(rawUid: string): Promise<CachedStudentAssignment | null> {
  const uid = cleanUid(rawUid);
  if (!uid) return null;

  const now = Date.now();

  // 1. Check L1 Memory Cache
  const l1Entry = assignmentL1Cache.get(uid);
  if (l1Entry && now < l1Entry.expiresAtMs) {
    return l1Entry.data;
  }

  // 2. Singleflight: Deduplicate concurrent fetches for the same student
  const inFlight = inFlightFetches.get(uid);
  if (inFlight) {
    return inFlight;
  }

  const fetchPromise = (async (): Promise<CachedStudentAssignment | null> => {
    try {
      // 3. Check L2 Redis Cache
      try {
        const rawRedis = await executeGpsRedisCommand(['GET', `${REDIS_KEY_PREFIX}${uid}`]);
        if (rawRedis) {
          const parsed = JSON.parse(rawRedis) as CachedStudentAssignment;
          if (parsed && parsed.uid) {
            assignmentL1Cache.set(uid, {
              data: parsed,
              expiresAtMs: Date.now() + L1_TTL_MS,
            });
            return parsed;
          }
        }
      } catch {
        // Fall through to database read on Redis failure
      }

      // 4. Authoritative Read from PostgreSQL student_profiles
      const supabase = getSupabaseServer();
      const { data, error } = await supabase
        .from('student_profiles')
        .select('uid, full_name, bus_id, route_id, shift, stop_name, status, soft_block, valid_until, hard_block')
        .or(`uid.eq.${uid},enrollment_id.eq.${uid}`)
        .maybeSingle();

      if (error) {
        console.error('[student-assignment-cache] PostgreSQL read error:', error.message);
        return null;
      }

      if (!data) {
        return null;
      }

      const assignment: CachedStudentAssignment = {
        uid: data.uid || uid,
        fullName: data.full_name || 'Student',
        busId: data.bus_id || null,
        routeId: data.route_id || null,
        shift: data.shift || null,
        stopName: data.stop_name || null,
        status: data.status || 'active',
        softBlock: data.soft_block || null,
        validUntil: data.valid_until || null,
        hardBlock: data.hard_block || null,
        cachedAtMs: Date.now(),
      };

      // Populate L1 Memory Cache
      assignmentL1Cache.set(uid, {
        data: assignment,
        expiresAtMs: Date.now() + L1_TTL_MS,
      });

      // Bound L1 size
      if (assignmentL1Cache.size > MAX_L1_ENTRIES) {
        const oldestKey = assignmentL1Cache.keys().next().value;
        if (oldestKey) assignmentL1Cache.delete(oldestKey);
      }

      // Populate L2 Redis Cache (fire-and-forget)
      executeGpsRedisCommand([
        'SET',
        `${REDIS_KEY_PREFIX}${uid}`,
        JSON.stringify(assignment),
        'EX',
        String(REDIS_TTL_SECONDS),
      ]).catch(() => {});

      return assignment;
    } finally {
      inFlightFetches.delete(uid);
    }
  })();

  inFlightFetches.set(uid, fetchPromise);
  return fetchPromise;
}

/**
 * Invalidate cached student assignment metadata across L1 memory and Redis.
 * Must be called whenever an admin/moderator reassigns, approves, or soft-blocks a student.
 */
export async function invalidateStudentAssignment(rawUid: string): Promise<void> {
  const uid = cleanUid(rawUid);
  if (!uid) return;

  assignmentL1Cache.delete(uid);
  inFlightFetches.delete(uid);

  try {
    await executeGpsRedisCommand(['DEL', `${REDIS_KEY_PREFIX}${uid}`]);
    await executeGpsRedisCommand(['PUBLISH', 'student_assign_invalidate', uid]);
  } catch {
    // Best-effort Redis invalidation
  }

  try {
    publishRoleInvalidation(uid);
  } catch {
    // Best-effort role cache publish
  }
}

/**
 * Clear all local L1 assignment cache entries (testing / maintenance).
 */
export function clearStudentAssignmentMemoryCache(): void {
  assignmentL1Cache.clear();
  inFlightFetches.clear();
  try {
    executeGpsRedisCommand(['PUBLISH', 'student_assign_invalidate', '*']).catch(() => {});
  } catch {
    // ignore
  }
}
