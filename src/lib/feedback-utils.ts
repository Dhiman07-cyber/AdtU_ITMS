
import { db } from '@/lib/firebase-admin';
import { randomUUID } from 'crypto';

export interface FeedbackEntry {
  id: string;
  user_id: string; // Now stores enrollmentId (student) or driverId (driver)
  name: string;
  email: string;
  role: 'student' | 'driver';
  message: string;
  created_at: string;
  read: boolean;
  read_at?: string;
  read_by?: string;
  auto_delete_at: string;
  profile_url?: string;
  bus_id?: string;
  bus_plate?: string;
  forwarded?: boolean;
}

const COLLECTION = 'feedback';
const AUTO_DELETE_DAYS = 10;

/**
 * Get all feedback entries from Firestore
 * Note: For production with many entries, pagination should be done at Firestore level.
 * Currently getting all to match previous logic's capability of in-memory search/filter.
 */
export async function readFeedback(): Promise<FeedbackEntry[]> {
  try {
    const snapshot = await db.collection(COLLECTION)
      .orderBy('created_at', 'desc')
      .get();

    return snapshot.docs.map((doc: { data: () => FeedbackEntry; }) => doc.data() as FeedbackEntry);
  } catch (error) {
    console.error('Error reading feedback from Firestore:', error);
    return [];
  }
}

/**
 * Get paginated feedback entries from Firestore
 * Supports server-side pagination for better performance
 */
export async function readFeedbackPaginated(
  page: number = 1,
  limit: number = 25
): Promise<{ entries: FeedbackEntry[]; total: number }> {
  try {
    const totalSnapshot = await db.collection(COLLECTION).count().get();
    const total = totalSnapshot.data().count;

    const snapshot = await db.collection(COLLECTION)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .get();

    const entries = snapshot.docs.map((doc: { data: () => FeedbackEntry; }) => doc.data() as FeedbackEntry);

    return { entries, total };
  } catch (error) {
    console.error('Error reading paginated feedback from Firestore:', error);
    return { entries: [], total: 0 };
  }
}

/**
 * Add a single feedback entry to Firestore
 */
export async function addFeedback(entry: FeedbackEntry): Promise<void> {
  try {
    await db.collection(COLLECTION).doc(entry.id).set(entry);
  } catch (error) {
    console.error('Error adding feedback to Firestore:', error);
    throw error;
  }
}

/**
 * Mark feedback as read/unread or delete
 * This replaces the monolithic writeFeedback
 */
export async function updateFeedback(id: string, updates: Partial<FeedbackEntry>): Promise<void> {
  try {
    await db.collection(COLLECTION).doc(id).update(updates);
  } catch (error) {
    console.error('Error updating feedback:', error);
    throw error;
  }
}

export async function deleteFeedback(id: string): Promise<void> {
  try {
    await db.collection(COLLECTION).doc(id).delete();
  } catch (error) {
    console.error('Error deleting feedback:', error);
    throw error;
  }
}


/**
 * Clean up feedback entries older than AUTO_DELETE_DAYS
 * This can be called by a scheduled function or lazily during GET
 */
export async function cleanupOldFeedback(entries: FeedbackEntry[]): Promise<FeedbackEntry[]> {
  // With Firestore, we would ideally run a query to delete old docs.
  // For now, let's keep the signature but maybe perform a delete operation in background if we want to mimic the old behavior
  // OR just return the entries filtered (but that doesn't delete from DB).
  // The previous implementation wrote back to the file.
  // Let's implement a "delete expired" query here.

  // We won't filter the *passed* entries array because that might be paginated or whatever. 
  // We will perform a DB cleanup.

  // Actually, to respect the current flow, let's just do a fire-and-forget cleanup check
  // finding docs where auto_delete_at < now

  const now = new Date().toISOString();
  try {
    // Paginate to avoid Firestore batch limit (max 500 ops per batch)
    const BATCH_SIZE = 400;
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
      const expiredSnapshot = await db.collection(COLLECTION)
        .where('auto_delete_at', '<', now)
        .limit(BATCH_SIZE)
        .get();

      if (expiredSnapshot.empty) {
        hasMore = false;
        break;
      }

      const batch = db.batch();
      expiredSnapshot.docs.forEach((doc: { ref: any; }) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      totalDeleted += expiredSnapshot.size;

      // If we got fewer than BATCH_SIZE, we're done
      if (expiredSnapshot.size < BATCH_SIZE) {
        hasMore = false;
      }
    }

    if (totalDeleted > 0) {
      console.log(`Deleted ${totalDeleted} expired feedback entries.`);
    }

    // Return entries that are NOT expired (in case the input `entries` contained them)
    return entries.filter(e => e.auto_delete_at > now);
  } catch (e) {
    console.error('Error cleaning up expired feedback:', e);
    return entries;
  }
}

/**
 * Generate auto-delete timestamp (10 days from now)
 */
export function generateAutoDeleteTimestamp(): string {
  const autoDeleteDate = new Date();
  autoDeleteDate.setDate(autoDeleteDate.getDate() + AUTO_DELETE_DAYS);
  return autoDeleteDate.toISOString();
}

/**
 * Generate unique feedback ID
 */
export function generateFeedbackId(): string {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const randomPart = randomUUID().split('-')[0];
  return `fb_${dateStr}_${randomPart}`;
}

/**
 * Validate feedback message
 */
export function validateMessage(message: string): { valid: boolean; error?: string } {
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'Message is required' };
  }

  const trimmed = message.trim();

  if (trimmed.length < 10) {
    return { valid: false, error: 'Please enter at least 10 characters.' };
  }

  if (trimmed.length > 2000) {
    return { valid: false, error: 'Message must not exceed 2000 characters' };
  }

  return { valid: true };
}

/**
 * Sanitize message text (basic XSS prevention)
 */
export function sanitizeMessage(message: string): string {
  return message
    .trim()
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Check for duplicate feedback (same message in last 24 hours) via Firestore Query
 */
export async function checkDuplicate(
  userId: string,
  message: string
): Promise<boolean> {
  const oneDayAgo = new Date();
  oneDayAgo.setHours(oneDayAgo.getHours() - 24);
  const oneDayAgoIso = oneDayAgo.toISOString();

  try {
    // Query recent feedback by this user
    // Requires composite index on user_id + created_at? 
    // If not, we can query by user_id and filter in memory since a single user won't have tons of feedback in 24h.
    const snapshot = await db.collection(COLLECTION)
      .where('user_id', '==', userId)
      .where('created_at', '>=', oneDayAgoIso)
      .get();

    if (snapshot.empty) return false;

    // Check message content
    return snapshot.docs.some((doc: { data: () => { (): any; new(): any; message: string; }; }) => doc.data().message === message);
  } catch (error) {
    console.error('Error checking duplicate:', error);
    return false; // Fail open if DB error
  }
}

// Rate limiting store (in-memory) 
// Note: In-memory is reset on server restart/function cold start. Redis is better but out of scope.
const rateLimitStore = new Map<string, number>();

export function checkRateLimit(userId: string): { allowed: boolean; minutesLeft?: number } {
  const lastSubmit = rateLimitStore.get(userId);

  if (!lastSubmit) {
    return { allowed: true };
  }

  // 5 minutes cooldown
  const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

  if (lastSubmit > fiveMinutesAgo) {
    const minutesLeft = Math.ceil((lastSubmit - fiveMinutesAgo) / 60000);
    return { allowed: false, minutesLeft };
  }

  return { allowed: true };
}

export function updateRateLimit(userId: string): void {
  rateLimitStore.set(userId, Date.now());
}




