import { adminDb, FieldValue } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Canonical Audit Logging Service (Phase 2.5)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ONE service. ONE collection. ONE write path. ONE source of truth.
 *
 * Every business-critical workflow routes through `createAuditLog()`.
 * No inline Firestore writes. No duplicate audit creation logic.
 *
 * Firestore TTL is enforced via `expiresAt` — documents auto-delete
 * after their severity-based retention period expires.
 */

// ─── Collection ──────────────────────────────────────────────────────────────
export const AUDIT_LOGS_COLLECTION = 'audit_logs';

// ─── Categories ──────────────────────────────────────────────────────────────
export type AuditCategory =
  | 'applications'
  | 'renewals'
  | 'reassignments'
  | 'additions'
  | 'refinements'
  | 'system';

// ─── Severity ────────────────────────────────────────────────────────────────
export type AuditSeverity = 'low' | 'medium' | 'high';

// ─── Actor Roles ─────────────────────────────────────────────────────────────
export type AuditActorRole = 'admin' | 'moderator' | 'system' | 'student' | 'driver';

// ─── Retention Months ────────────────────────────────────────────────────────
const RETENTION_MONTHS: Record<AuditSeverity, number> = {
  low: 3,
  medium: 6,
  high: 12,
};

/**
 * Calculate the Firestore TTL expiry date based on severity.
 * Returns a Date that Firestore TTL will use to auto-delete the document.
 */
export function calculateAuditExpiry(severity: AuditSeverity): Date {
  const months = RETENTION_MONTHS[severity];
  const now = new Date();
  now.setMonth(now.getMonth() + months);
  return now;
}

// ─── Input Interface ─────────────────────────────────────────────────────────
export interface CreateAuditLogInput {
  category: AuditCategory;
  action: string;
  summary: string;
  description?: string;
  severity: AuditSeverity;
  performedBy: string;
  performedByName?: string;
  performedByRole?: AuditActorRole;
  targetType: string;
  targetId: string;
  targetName?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

// ─── Document Interface ──────────────────────────────────────────────────────
export interface AuditLogDocument {
  auditId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  category: AuditCategory;
  action: string;
  summary: string;
  description: string;
  severity: AuditSeverity;
  performedBy: string;
  performedByName: string;
  performedByRole: AuditActorRole;
  performedAt: Timestamp;
  targetType: string;
  targetId: string;
  targetName: string;
  metadata: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
}

// ─── Core Service ────────────────────────────────────────────────────────────

/**
 * The ONE canonical function for creating audit logs.
 *
 * Every business workflow MUST call this function. No exceptions.
 * Writes to the `audit_logs` collection with automatic TTL.
 *
 * @returns The document ID of the created audit log.
 */
export async function createAuditLog(
  input: CreateAuditLogInput
): Promise<string> {
  const docRef = adminDb.collection(AUDIT_LOGS_COLLECTION).doc();
  const auditId = docRef.id;
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromDate(calculateAuditExpiry(input.severity));

  const document: Record<string, unknown> = {
    auditId,
    createdAt: now,
    expiresAt,
    category: input.category,
    action: input.action,
    summary: input.summary,
    description: input.description ?? '',
    severity: input.severity,
    performedBy: input.performedBy,
    performedByName: input.performedByName ?? '',
    performedByRole: input.performedByRole ?? 'admin',
    performedAt: now,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName ?? '',
    metadata: input.metadata ?? {},
    ipAddress: input.ipAddress ?? '',
    userAgent: input.userAgent ?? '',
  };

  await docRef.set(document);
  return auditId;
}

/**
 * Write an audit log inside an existing Firestore transaction.
 * Use this when the audit must commit atomically with the business mutation.
 */
export function createAuditLogInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: CreateAuditLogInput
): string {
  const docRef = adminDb.collection(AUDIT_LOGS_COLLECTION).doc();
  const auditId = docRef.id;
  const now = Timestamp.now();
  const expiresAt = Timestamp.fromDate(calculateAuditExpiry(input.severity));

  const document: Record<string, unknown> = {
    auditId,
    createdAt: now,
    expiresAt,
    category: input.category,
    action: input.action,
    summary: input.summary,
    description: input.description ?? '',
    severity: input.severity,
    performedBy: input.performedBy,
    performedByName: input.performedByName ?? '',
    performedByRole: input.performedByRole ?? 'admin',
    performedAt: now,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName ?? '',
    metadata: input.metadata ?? {},
    ipAddress: input.ipAddress ?? '',
    userAgent: input.userAgent ?? '',
  };

  transaction.set(docRef, document);
  return auditId;
}

/**
 * Resolve actor identity from admins/moderators collections.
 * Call BEFORE opening a transaction (it performs reads).
 */
export async function resolveAuditActor(
  actorId: string
): Promise<{ name: string; role: AuditActorRole }> {
  try {
    const [adminSnap, modSnap] = await adminDb.getAll(
      adminDb.collection('admins').doc(actorId),
      adminDb.collection('moderators').doc(actorId)
    );

    if (adminSnap.exists) {
      const d = adminSnap.data();
      return { name: d?.fullName || d?.name || 'Admin', role: 'admin' };
    }
    if (modSnap.exists) {
      const d = modSnap.data();
      return { name: d?.fullName || d?.name || 'Moderator', role: 'moderator' };
    }
  } catch {
    // Fallback — identity lookup failure is non-critical
  }
  return { name: 'Unknown', role: 'admin' };
}

/** Convenience constant for automated / cron actors. */
export const SYSTEM_ACTOR = {
  id: 'system',
  name: 'System (automated)',
  role: 'system' as AuditActorRole,
};
