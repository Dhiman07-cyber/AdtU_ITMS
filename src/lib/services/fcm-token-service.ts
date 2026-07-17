/**
 * FCM Token Service
 * 
 * Manages FCM tokens using a subcollection model:
 *   students/{studentId}/tokens/{tokenHash}
 *   drivers/{driverId}/tokens/{tokenHash}
 * 
 * Supports multi-device per user, idempotent writes, 
 * token validation, and stale token cleanup.
 */

import { db as adminDb, FieldValue, messaging } from '@/lib/firebase-admin';
import * as crypto from 'crypto';
import { getStudentsByRouteIds, getStudentsByBusIds, getAllStudents } from '@/domains/identity';

// Minimum token length for basic validation
const MIN_TOKEN_LENGTH = 100;
const MAX_TOKEN_LENGTH = 4096;

/**
 * Hash a token string to use as a document ID (deterministic, deduplicating)
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 40);
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
  lastSeen: FirebaseFirestore.Timestamp | string;
  valid: boolean;
}

export interface TokenWithMeta {
  token: string;
  platform: string;
  studentId: string;
  tokenDocPath: string;
}

/**
 * Save (or refresh) an FCM token for a user.
 * Uses set/update for idempotent writes — never creates duplicates.
 */
export async function saveToken(
  userId: string,
  collectionName: string,
  token: string,
  platform: string = 'web'
): Promise<{ success: boolean; error?: string }> {
  if (!adminDb) {
    return { success: false, error: 'Firebase Admin not initialized' };
  }

  if (!isValidTokenFormat(token)) {
    return { success: false, error: `Invalid token format (length: ${token?.length || 0})` };
  }

  // Additional validation: Only allow saving to students collection
  if (collectionName !== 'students') {
    console.warn(`FCM tokens are only supported for students collection, not ${collectionName}`);
    return { success: false, error: 'FCM tokens are only supported for student accounts' };
  }

  const tokenHash = hashToken(token);
  const tokenDocRef = adminDb
    .collection(collectionName)
    .doc(userId)
    .collection('tokens')
    .doc(tokenHash);

  try {
    const existing = await tokenDocRef.get();

    if (!existing.exists) {
      await tokenDocRef.set({
        token,
        platform: platform as 'android' | 'ios' | 'web',
        lastSeen: FieldValue.serverTimestamp(),
        valid: true,
      });
    } else {
      await tokenDocRef.update({
        lastSeen: FieldValue.serverTimestamp(),
        valid: true,
      });
    }

    return { success: true };
  } catch (error: any) {
    console.error(`Error saving token for ${collectionName}/${userId}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Mark a specific token as invalid (e.g. after FCM returns not-registered).
 */
export async function invalidateToken(
  userId: string,
  collectionName: string,
  tokenHash: string
): Promise<void> {
  if (!adminDb) return;

  try {
    const tokenDocRef = adminDb
      .collection(collectionName)
      .doc(userId)
      .collection('tokens')
      .doc(tokenHash);

    await tokenDocRef.delete();
  } catch (error: any) {
    console.error(`Error invalidating token ${tokenHash?.substring(0,8)}... for ${userId?.substring(0,8)}...:`, error.message);
  }
}

/**
 * Delete a token doc by its full path or clear legacy field.
 */
export async function deleteTokenByPath(docPath: string): Promise<void> {
  if (!adminDb) return;
  try {
    // SECURITY: If the path is a student document (legacy), do NOT delete it.
    if (docPath.startsWith('students/') && !docPath.includes('/tokens/')) {
      console.log(`Skipping legacy student doc path: ${docPath}`);
      return;
    }

    await adminDb.doc(docPath).delete();
  } catch (error: any) {
    console.error(`Error deleting token doc at ${docPath}:`, error.message);
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
      console.warn(`⚠️ Failed to subscribe token to topic ${topic}:`, response.errors[0]?.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`❌ Error subscribing to topic ${topic}:`, err);
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
    console.error(`❌ Error unsubscribing from topic ${topic}:`, err);
    return false;
  }
}

/**
 * Get all valid tokens for students on a given route.
 * Queries students by routeId, then expands the tokens subcollection.
 * Returns deduplicated tokens.
 */
export async function getValidTokensForRoute(routeId: string): Promise<TokenWithMeta[]> {
  if (!adminDb) return [];

  // Query students by routeId from PostgreSQL
  const students = await getStudentsByRouteIds([routeId]);

  if (students.length === 0) {
    console.log(`📭 No students found for route ${routeId}`);
    return [];
  }

  const tokens: TokenWithMeta[] = [];

  for (const student of students) {
    const studentDocRef = adminDb.collection('students').doc(student.uid);
    const tokensSnap = await studentDocRef
      .collection('tokens')
      .where('valid', '==', true)
      .get();

    for (const tokenDoc of tokensSnap.docs) {
      const data = tokenDoc.data();
      if (data?.token && isValidTokenFormat(data.token)) {
        tokens.push({
          token: data.token,
          platform: data.platform || 'web',
          studentId: student.uid,
          tokenDocPath: tokenDoc.ref.path,
        });
      }
    }
  }

  // Deduplicate by token value (same physical device registered under multiple students)
  const seen = new Set<string>();
  const uniqueTokens: TokenWithMeta[] = [];
  for (const t of tokens) {
    if (!seen.has(t.token)) {
      seen.add(t.token);
      uniqueTokens.push(t);
    }
  }

  return uniqueTokens;
}

/**
 * Get all valid tokens for students assigned to a specific bus.
 * Tries assignedBusId, busId, bus_id field names from PostgreSQL.
 */
export async function getValidTokensForBus(busId: string): Promise<TokenWithMeta[]> {
  if (!adminDb) return [];

  // Query students by busId from PostgreSQL
  const students = await getStudentsByBusIds([busId]);

  if (students.length === 0) {
    console.log(`📭 No students found for bus ${busId}`);
    return [];
  }

  const tokens: TokenWithMeta[] = [];

  for (const student of students) {
    const studentDocRef = adminDb.collection('students').doc(student.uid);
    const tokensSnap = await studentDocRef
      .collection('tokens')
      .where('valid', '==', true)
      .get();

    for (const tokenDoc of tokensSnap.docs) {
      const data = tokenDoc.data();
      if (data?.token && isValidTokenFormat(data.token)) {
        tokens.push({
          token: data.token,
          platform: data.platform || 'web',
          studentId: student.uid,
          tokenDocPath: tokenDoc.ref.path,
        });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniqueTokens: TokenWithMeta[] = [];
  for (const t of tokens) {
    if (!seen.has(t.token)) {
      seen.add(t.token);
      uniqueTokens.push(t);
    }
  }

  return uniqueTokens;
}

/**
 * Cleanup stale tokens across all students.
 * Deletes token docs where lastSeen is older than maxAgeDays.
 */
export async function cleanupStaleTokens(maxAgeDays: number = 30): Promise<{
  scanned: number;
  deleted: number;
}> {
  if (!adminDb) return { scanned: 0, deleted: 0 };

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  // Get students list from PostgreSQL
  const students = await getAllStudents();
  let scanned = 0;
  let deleted = 0;

  for (const student of students) {
    const studentDocRef = adminDb.collection('students').doc(student.uid);
    const tokensSnap = await studentDocRef.collection('tokens').get();

    for (const tokenDoc of tokensSnap.docs) {
      scanned++;
      const data = tokenDoc.data();
      const lastSeen = data?.lastSeen;

      let lastSeenDate: Date | null = null;
      if (lastSeen && typeof lastSeen.toDate === 'function') {
        lastSeenDate = lastSeen.toDate();
      } else if (lastSeen && typeof lastSeen === 'string') {
        lastSeenDate = new Date(lastSeen);
      }

      if (lastSeenDate && lastSeenDate < cutoff) {
        await tokenDoc.ref.delete();
        deleted++;
      }
    }
  }

  return { scanned, deleted };
}
