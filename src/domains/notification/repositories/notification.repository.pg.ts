/**
 * D10 Notification — PostgreSQL Repository
 *
 * PERSISTENCE ONLY — no business logic lives here.
 * Reads and writes the `notifications` table in Supabase PostgreSQL.
 *
 * RULE: pgUpdateNotification() is a pure persistence function.
 *   - It NEVER merges arrays (caller provides the complete array).
 *   - It NEVER appends to arrays.
 *   - It NEVER deduplicates.
 *   - It NEVER computes derived values.
 *   - If the caller passes readByUserIds: [A, B], that is exactly what is written.
 *   - Business logic (idempotency, edit history, permission checks) lives in
 *     the service layer, not here.
 *
 * D10.3 ACTIVE: All notification writes go through this repository (PostgreSQL).
 * Notification reads remain on Firestore until D10.4 read-path cutover.
 * Do NOT add new adminDb.collection('notifications') write calls.
 *
 * SCHEMA MAPPING
 * ──────────────────────────────────────────────────────────────────────────
 * PostgreSQL column              → NotificationDocument field
 * id                             → id (UUID)
 * title                          → title
 * content                        → content
 * type                           → type
 * sender                         → sender (JSONB)
 * sender_user_id                 → (generated, for indexing only)
 * target                         → target (JSONB)
 * recipient_ids                  → recipientIds
 * auto_injected_recipient_ids    → autoInjectedRecipientIds
 * read_by_user_ids               → readByUserIds
 * hidden_for_user_ids            → hiddenForUserIds
 * is_edited                      → isEdited
 * is_deleted_globally            → isDeletedGlobally
 * deleted_by_user_id             → deletedByUserId
 * deleted_at                     → deletedAt
 * created_at                     → createdAt
 * updated_at                     → updatedAt
 * expires_at                     → expiryAt (maps to existing field name)
 * edit_history                   → editHistory
 * metadata                       → metadata
 *
 * QUERY PATTERNS (validated in D10.1A):
 * 1. findByUser: WHERE recipient_ids @> '{uid}' OR sender_user_id = uid
 *    ORDER BY created_at DESC LIMIT N
 * 2. findById: WHERE id = $1
 * 3. findExpired: WHERE expires_at IS NOT NULL AND expires_at <= NOW()
 * 4. deleteByUser: WHERE recipient_ids @> '{userId}' OR sender_user_id = userId
 * ──────────────────────────────────────────────────────────────────────────
 */
import { getSupabaseServer } from '@/lib/supabase-server';
import type {
  NotificationSender,
  NotificationTarget,
} from '@/lib/notifications/types';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Canonical notification record from PostgreSQL */
interface PgNotification {
  id: string;
  title: string;
  content: string;
  type: string;
  sender: NotificationSender;
  sender_user_id: string;
  target: NotificationTarget;
  recipient_ids: string[];
  auto_injected_recipient_ids: string[];
  read_by_user_ids: string[];
  hidden_for_user_ids: string[];
  is_edited: boolean;
  is_deleted_globally: boolean;
  deleted_by_user_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
  edit_history: Array<{
    editedAt: string;
    previousContent: string;
    editedBy: string;
  }>;
  metadata: Record<string, any>;
}

/** Notification type compatible with existing codebase */
export interface NotificationRecord {
  id: string;
  title: string;
  content: string;
  type: string;
  sender: NotificationSender;
  target: NotificationTarget;
  recipientIds: string[];
  autoInjectedRecipientIds: string[];
  readByUserIds: string[];
  hiddenForUserIds: string[];
  isEdited: boolean;
  isDeletedGlobally: boolean;
  deletedByUserId?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt?: string;
  expiryAt?: string;
  editHistory?: Array<{
    editedAt: string;
    previousContent: string;
    editedBy: string;
  }>;
  metadata?: Record<string, any>;
}

/** Input type for creating a notification */
export interface CreateNotificationInput {
  title: string;
  content: string;
  type?: string;
  sender: NotificationSender;
  target: NotificationTarget;
  recipientIds: string[];
  autoInjectedRecipientIds?: string[];
  readByUserIds?: string[];
  hiddenForUserIds?: string[];
  expiresAt?: string;
  metadata?: Record<string, any>;
}

/**
 * Input type for updating a notification.
 *
 * RULE: The repository writes exactly what the caller provides.
 * No merging, appending, deduplicating, or computing derived values.
 * Business logic (idempotency, edit history construction, permission checks)
 * is the service layer's responsibility.
 */
export interface UpdateNotificationInput {
  title?: string;
  content?: string;
  type?: string;
  sender?: NotificationSender;
  target?: NotificationTarget;
  recipientIds?: string[];
  autoInjectedRecipientIds?: string[];
  readByUserIds?: string[];
  hiddenForUserIds?: string[];
  isEdited?: boolean;
  isDeletedGlobally?: boolean;
  deletedByUserId?: string;
  deletedAt?: string;
  expiresAt?: string | null;
  editHistory?: NotificationRecord['editHistory'];
  metadata?: Record<string, any>;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/**
 * Maps a PostgreSQL row to the NotificationRecord type.
 * Preserves all fields; no data loss during migration.
 */
function pgRowToNotification(row: PgNotification): NotificationRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    type: row.type,
    sender: row.sender,
    target: row.target,
    recipientIds: row.recipient_ids || [],
    autoInjectedRecipientIds: row.auto_injected_recipient_ids || [],
    readByUserIds: row.read_by_user_ids || [],
    hiddenForUserIds: row.hidden_for_user_ids || [],
    isEdited: row.is_edited,
    isDeletedGlobally: row.is_deleted_globally,
    deletedByUserId: row.deleted_by_user_id || undefined,
    deletedAt: row.deleted_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    expiryAt: row.expires_at || undefined,
    editHistory: row.edit_history || [],
    metadata: row.metadata || {},
  };
}

/**
 * Maps a CreateNotificationInput to a PostgreSQL row for insertion.
 * Handles field name mapping (camelCase → snake_case).
 */
function notificationToPgRow(input: CreateNotificationInput): Record<string, any> {
  return {
    title: input.title,
    content: input.content,
    type: input.type || 'notice',
    sender: input.sender,
    target: input.target,
    recipient_ids: input.recipientIds,
    auto_injected_recipient_ids: input.autoInjectedRecipientIds || [],
    read_by_user_ids: input.readByUserIds || [],
    hidden_for_user_ids: input.hiddenForUserIds || [],
    expires_at: input.expiresAt || null,
    metadata: input.metadata || {},
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Find notifications for a user (recipient or sender).
 * Matches the Firestore query pattern:
 *   WHERE recipient_ids @> '{uid}' OR sender_user_id = uid
 *   ORDER BY created_at DESC LIMIT N
 */
export async function pgFindNotificationsByUser(
  uid: string,
  limit: number = 50
): Promise<NotificationRecord[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('notifications')
    .select('*')
    .or(`recipient_ids.cs.{${uid}},sender_user_id.eq.${uid}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`NotificationRepository (PG) findByUser failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToNotification(row as PgNotification));
}

/**
 * Find a notification by ID. Returns null if not found.
 */
export async function pgFindNotificationById(
  id: string
): Promise<NotificationRecord | null> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`NotificationRepository (PG) findById failed: ${error.message}`);
  }

  if (!data) return null;

  return pgRowToNotification(data as PgNotification);
}

/**
 * Find expired notifications (where expires_at <= NOW()).
 * Used by cleanup cron (every 3 days).
 */
export async function pgFindExpiredNotifications(): Promise<NotificationRecord[]> {
  const db = getSupabaseServer();

  const { data, error } = await db
    .from('notifications')
    .select('*')
    .not('expires_at', 'is', null)
    .lte('expires_at', new Date().toISOString());

  if (error) {
    throw new Error(`NotificationRepository (PG) findExpired failed: ${error.message}`);
  }

  return (data || []).map(row => pgRowToNotification(row as PgNotification));
}

/**
 * Insert a new notification. Returns the generated ID.
 */
export async function pgInsertNotification(
  input: CreateNotificationInput
): Promise<string> {
  const db = getSupabaseServer();
  const row = notificationToPgRow(input);

  const { data, error } = await db
    .from('notifications')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    throw new Error(`NotificationRepository (PG) insert failed: ${error.message}`);
  }

  return data.id;
}

/**
 * Update notification fields (partial update).
 *
 * PURE PERSISTENCE: writes exactly what the caller provides.
 * No merging, appending, deduplicating, or computing derived values.
 * updated_at is auto-set by a PostgreSQL trigger (trg_notifications_updated_at);
 * application code never sets it.
 */
export async function pgUpdateNotification(
  id: string,
  input: UpdateNotificationInput
): Promise<void> {
  const db = getSupabaseServer();

  const payload: Record<string, any> = {};

  if (input.title !== undefined) payload.title = input.title;
  if (input.content !== undefined) payload.content = input.content;
  if (input.type !== undefined) payload.type = input.type;
  if (input.sender !== undefined) payload.sender = input.sender;
  if (input.target !== undefined) payload.target = input.target;
  if (input.recipientIds !== undefined) payload.recipient_ids = input.recipientIds;
  if (input.autoInjectedRecipientIds !== undefined) payload.auto_injected_recipient_ids = input.autoInjectedRecipientIds;
  if (input.readByUserIds !== undefined) payload.read_by_user_ids = input.readByUserIds;
  if (input.hiddenForUserIds !== undefined) payload.hidden_for_user_ids = input.hiddenForUserIds;
  if (input.isEdited !== undefined) payload.is_edited = input.isEdited;
  if (input.isDeletedGlobally !== undefined) payload.is_deleted_globally = input.isDeletedGlobally;
  if (input.deletedByUserId !== undefined) payload.deleted_by_user_id = input.deletedByUserId;
  if (input.deletedAt !== undefined) payload.deleted_at = input.deletedAt;
  if (input.expiresAt !== undefined) payload.expires_at = input.expiresAt;
  if (input.editHistory !== undefined) payload.edit_history = input.editHistory;
  if (input.metadata !== undefined) payload.metadata = input.metadata;

  if (Object.keys(payload).length === 0) return;

  const { error } = await db
    .from('notifications')
    .update(payload)
    .eq('id', id);

  if (error) {
    throw new Error(`NotificationRepository (PG) update failed: ${error.message}`);
  }
}

/**
 * Delete a notification by ID.
 */
export async function pgDeleteNotification(id: string): Promise<void> {
  const db = getSupabaseServer();

  const { error } = await db
    .from('notifications')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`NotificationRepository (PG) delete failed: ${error.message}`);
  }
}

/**
 * Bulk delete notifications by IDs.
 * Used by cleanup (expired notifications, user deletion).
 */
export async function pgBulkDeleteNotifications(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const db = getSupabaseServer();

  const { error, count } = await db
    .from('notifications')
    .delete()
    .in('id', ids);

  if (error) {
    throw new Error(`NotificationRepository (PG) bulkDelete failed: ${error.message}`);
  }

  return count || 0;
}

/**
 * Delete all notifications where user is recipient or sender.
 * Used by user deletion cleanup.
 *
 * Single atomic DELETE with OR condition — more efficient and atomic
 * than the previous two-statement approach.
 */
export async function pgDeleteNotificationsByUser(userId: string): Promise<number> {
  const db = getSupabaseServer();

  const { count } = await db
    .from('notifications')
    .delete()
    .or(`recipient_ids.cs.{${userId}},sender_user_id.eq.${userId}`);

  return count || 0;
}
