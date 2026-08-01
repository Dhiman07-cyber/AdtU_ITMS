/**
 * FCM Token — PostgreSQL Repository
 *
 * Canonical persistence layer for FCM device tokens.
 * Reads and writes the `fcm_tokens` table in Supabase PostgreSQL.
 *
 * Replaces the Firestore subcollection model:
 *   students/{id}/tokens/{hash}  →  fcm_tokens (user_id, token_hash)
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import * as crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FcmTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  token: string;
  platform: 'android' | 'ios' | 'web';
  last_seen: string;
  valid: boolean;
  created_at: string;
}

export interface FcmTokenWithMeta {
  token: string;
  platform: string;
  studentId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 40);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Upsert a token for a user. Idempotent — no duplicates on (user_id, token_hash).
 */
export async function upsertToken(
  userId: string,
  token: string,
  platform: string = 'web'
): Promise<{ success: boolean; error?: string }> {
  const db = getSupabaseServer();
  const tokenHash = hashToken(token);

  const { error } = await db
    .from('fcm_tokens')
    .upsert(
      {
        user_id: userId,
        token_hash: tokenHash,
        token,
        platform,
        last_seen: new Date().toISOString(),
        valid: true,
      },
      { onConflict: 'user_id,token_hash' }
    );

  if (error) {
    console.error('FCM token upsert failed:', error.message);
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Delete a specific token (by hash) for a user.
 */
export async function deleteToken(userId: string, tokenHash: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('fcm_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('token_hash', tokenHash);

  if (error) {
    console.error('FCM token delete failed:', error.message);
  }
}

/**
 * Get all valid tokens for a set of user IDs.
 * Returns deduplicated tokens.
 */
export async function getValidTokensForUsers(userIds: string[]): Promise<FcmTokenWithMeta[]> {
  if (!userIds || userIds.length === 0) return [];

  const db = getSupabaseServer();
  const chunkSize = 200;
  const allRows: Array<{ token: string; platform: string; user_id: string }> = [];

  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const { data, error } = await db
      .from('fcm_tokens')
      .select('token, platform, user_id')
      .in('user_id', chunk)
      .eq('valid', true);

    if (error) {
      console.error('FCM token read failed for chunk:', error.message);
      continue;
    }

    if (data) {
      allRows.push(...data);
    }
  }

  // Deduplicate by token value
  const seen = new Set<string>();
  const unique: FcmTokenWithMeta[] = [];
  for (const row of allRows) {
    if (!seen.has(row.token)) {
      seen.add(row.token);
      unique.push({
        token: row.token,
        platform: row.platform || 'web',
        studentId: row.user_id,
      });
    }
  }
  return unique;
}

/**
 * Cleanup stale tokens. Deletes rows where last_seen < cutoff.
 * ponytail: Supabase .delete() doesn't return row count, so we count
 * remaining rows after delete to estimate deletions.
 */
export async function cleanupStaleTokens(maxAgeDays: number = 30): Promise<{
  scanned: number;
  deleted: number;
}> {
  const db = getSupabaseServer();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const cutoffIso = cutoff.toISOString();

  // Count before
  const { count: scanned } = await db
    .from('fcm_tokens')
    .select('*', { count: 'exact', head: true })
    .lt('last_seen', cutoffIso);

  // Delete
  const { error } = await db
    .from('fcm_tokens')
    .delete()
    .lt('last_seen', cutoffIso);

  if (error) {
    console.error('FCM token cleanup failed:', error.message);
    return { scanned: 0, deleted: 0 };
  }

  // Count remaining to estimate actual deletions
  const { count: remaining } = await db
    .from('fcm_tokens')
    .select('*', { count: 'exact', head: true })
    .lt('last_seen', cutoffIso);

  const before = scanned ?? 0;
  const after = remaining ?? 0;
  return { scanned: before, deleted: Math.max(0, before - after) };
}
