/**
 * FCM Token Service
 *
 * Manages FCM tokens using PostgreSQL (fcm_tokens table).
 * Replaces the Firestore subcollection model:
 *   students/{studentId}/tokens/{tokenHash}  →  fcm_tokens
 *
 * Supports multi-device per user, idempotent writes,
 * token validation, and stale token cleanup.
 */

import {
	cleanupStaleFcmTokens,
	deleteFcmToken,
	getStudentsByBusIds,
	getStudentsByRouteIds,
	getValidFcmTokensForUsers,
	hashFcmToken,
	saveFcmToken
} from '@/domains/identity';
import { messaging } from '@/lib/firebase-admin';

// Minimum token length for basic validation
const MIN_TOKEN_LENGTH = 100;
const MAX_TOKEN_LENGTH = 4096;

/**
 * Hash a token string to use as a document ID (deterministic, deduplicating)
 */
export function hashToken(token: string): string {
  return hashFcmToken(token);
}

/**
 * Validate an FCM token format (basic sanity check)
 */
export function isValidTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return false;
  // FCM tokens are base64-like strings; reject obvious garbage
  if (/\s/.test(token)) return false;
  return true;
}

export interface TokenRecord {
  token: string;
  platform: 'android' | 'ios' | 'web';
  lastSeen: string;
  valid: boolean;
}

export interface TokenWithMeta {
  token: string;
  platform: string;
  studentId: string;
}

/**
 * Save (or refresh) an FCM token for a user.
 * Uses upsert for idempotent writes — never creates duplicates.
 */
export async function saveToken(
  userId: string,
  _collectionName: string, // kept for API compatibility, ignored
  token: string,
  platform: string = 'web'
): Promise<{ success: boolean; error?: string }> {
  if (!isValidTokenFormat(token)) {
    return { success: false, error: `Invalid token format (length: ${token?.length || 0})` };
  }

  return saveFcmToken(userId, token, platform);
}

/**
 * Mark a specific token as invalid (e.g. after FCM returns not-registered).
 */
export async function invalidateToken(
  userId: string,
  _collectionName: string, // kept for API compatibility, ignored
  tokenHash: string
): Promise<void> {
  await deleteFcmToken(userId, tokenHash);
}

/**
 * Delete a token doc by its full path or clear legacy field.
 * Kept for backward compatibility — parses path and calls deleteFcmToken.
 */
export async function deleteTokenByPath(docPath: string): Promise<void> {
  // Parse path format: fcm_tokens/{userId}/{tokenHash} or legacy students/{id}/tokens/{hash}
  const parts = docPath.split('/');
  if (parts.length >= 3) {
    const userId = parts[1];
    const tokenHash = parts[2];
    if (userId && tokenHash) {
      await deleteFcmToken(userId, tokenHash);
    }
  }
}

/**
 * Subscribe a token to an FCM topic (e.g. route_123)
 */
export async function subscribeToTopic(token: string, topic: string): Promise<boolean> {
  if (!messaging) return false;
  try {
    const response = await messaging.subscribeToTopic(token, topic);
    if (response.failureCount > 0) {
      console.warn(`Failed to subscribe token to topic ${topic}:`, response.errors[0]?.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`Error subscribing to topic ${topic}:`, err);
    return false;
  }
}

/**
 * Unsubscribe a token from an FCM topic
 */
export async function unsubscribeFromTopic(token: string, topic: string): Promise<boolean> {
  if (!messaging) return false;
  try {
    const response = await messaging.unsubscribeFromTopic(token, topic);
    return response.failureCount === 0;
  } catch (err) {
    console.error(`Error unsubscribing from topic ${topic}:`, err);
    return false;
  }
}

/**
 * Get all valid tokens for students on a given route.
 * Queries students by routeId, then fetches tokens from PostgreSQL.
 * Returns deduplicated tokens.
 */
export async function getValidTokensForRoute(routeId: string): Promise<TokenWithMeta[]> {
  const students = await getStudentsByRouteIds([routeId]);
  if (students.length === 0) {
    return [];
  }

  const userIds = students.map(s => s.uid);
  return getValidFcmTokensForUsers(userIds);
}

/**
 * Get all valid tokens for students assigned to a specific bus.
 */
export async function getValidTokensForBus(busId: string): Promise<TokenWithMeta[]> {
  const students = await getStudentsByBusIds([busId]);
  if (students.length === 0) {
    return [];
  }

  const userIds = students.map(s => s.uid);
  return getValidFcmTokensForUsers(userIds);
}

/**
 * Get all valid tokens for students assigned to a specific bus AND matching shift.
 */
export async function getValidTokensForBusAndShift(busId: string, shift?: string): Promise<TokenWithMeta[]> {
  const { isShiftCompatible } = await import('@/lib/utils');
  const busVariations = [busId];
  if (busId.startsWith('bus_')) {
    busVariations.push(busId.replace('bus_', ''));
  } else {
    busVariations.push(`bus_${busId}`);
  }

  const students = await getStudentsByBusIds(busVariations);
  if (students.length === 0) {
    return [];
  }

  const filteredStudents = shift
    ? students.filter(s => isShiftCompatible(s.shift, shift))
    : students;

  if (filteredStudents.length === 0) {
    return [];
  }

  const userIds = filteredStudents.map(s => s.uid);
  return getValidFcmTokensForUsers(userIds);
}

/**
 * Cleanup stale tokens across all users.
 */
export async function cleanupStaleTokens(maxAgeDays: number = 30): Promise<{
  scanned: number;
  deleted: number;
}> {
  return cleanupStaleFcmTokens(maxAgeDays);
}

/**
 * Delete all FCM tokens for a specific user.
 */
export async function deleteUserTokens(userId: string): Promise<void> {
  // Delete all tokens by getting them first
  const tokens = await getValidFcmTokensForUsers([userId]);
  for (const t of tokens) {
    const tokenHash = hashFcmToken(t.token);
    await deleteFcmToken(userId, tokenHash);
  }
}
