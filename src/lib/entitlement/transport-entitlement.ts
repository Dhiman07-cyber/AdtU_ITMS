/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3 — CANONICAL TRANSPORT ENTITLEMENT (single source of truth)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module answers exactly ONE question for the whole system:
 *
 *     "Does this user currently OWN transport access right now?"
 *
 * Every transport-related decision — dashboard widgets, navigation, protected
 * routes, realtime subscriptions, provider init, QR generation, QR verification,
 * tracking, trip/route access, and the server APIs behind them — MUST derive its
 * answer from `getTransportEntitlement` / `hasTransportEntitlement` here. No screen
 * or API may invent its own rule (no `status`-alone, no `validUntil`-alone checks).
 *
 * BUSINESS RULE (locked):
 *   entitled = (status === 'active') AND (now < soft-block boundary)
 *
 *   - The soft-block boundary is the SAME lifecycle boundary that releases the
 *     student's seat capacity in Phase 1 (`student.softBlock`, an ISO timestamp).
 *     Entitlement therefore tracks seat ownership exactly: once the seat is
 *     released at soft block, transport entitlement is gone.
 *   - `seatReleasedAt` is a Phase-1 CAPACITY marker, NOT a business-state
 *     determinant. It is intentionally NOT consulted here: a stale marker must
 *     never deny an otherwise-legitimately-active student. Capacity correctness
 *     for stale markers is handled by Phase-1 reconciliation, not by denying
 *     access.
 *
 * ISOMORPHIC + CONFIG-FREE:
 *   Pure function over the student document's own fields. No Firestore, no
 *   deadline-config, no network. Identical result on client and server. Admin
 *   date-simulation remains a cron/back-office concern and does not affect a live
 *   student's entitlement (always evaluated against the real clock).
 *
 * LEGACY-DATA SAFETY (see fallback below): an active student is denied ONLY when a
 * positive date signal proves they are past their boundary. Missing `softBlock`
 * alone never denies access.
 */

export type EntitlementReason =
  | 'entitled'                    // active and within the soft-block boundary
  | 'entitled_legacy_incomplete'  // active but no date fields at all → granted, flag for backfill
  | 'no_account'                  // no student record
  | 'inactive_status'             // status !== 'active' (soft_blocked / hard_blocked / pending_deletion / suspended / inactive)
  | 'past_soft_block'             // status active but past the stored soft-block boundary
  | 'expired'                     // legacy record with no softBlock, past validUntil
  | 'verified_upcoming'           // Future-session application verified/approved by admin, awaiting session start
  | 'pending_seat_allocation'     // Application verified & paid, in seat queue
  | 'application_submitted';      // Application submitted, under admin review

export interface EntitlementResult {
  entitled: boolean;
  reason: EntitlementReason;
}

/** Minimal structural shape this module needs. Accepts `User` and `Student`. */
export interface EntitlementStudentLike {
  status?: string | null;
  /** Phase-1 stored soft-block boundary (ISO string | Firestore Timestamp | Date). */
  softBlock?: unknown;
  /** Service validity end (ISO string | Firestore Timestamp | Date). */
  validUntil?: unknown;
  [key: string]: unknown;
}

/**
 * Coerce the many shapes a date field can take (Firestore Timestamp with
 * `toDate()`, `{ seconds }`, ISO string, Date, ms number) into a `Date`.
 * Returns null for absent/invalid values.
 */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  // Firestore Timestamp instance
  if (typeof value === 'object' && value !== null) {
    const anyVal = value as { toDate?: () => Date; seconds?: number };
    if (typeof anyVal.toDate === 'function') {
      const d = anyVal.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof anyVal.seconds === 'number') {
      const d = new Date(anyVal.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * THE canonical entitlement determination. See module header for the rule.
 *
 * @param student the student document (or `User` with student fields), or null
 * @param now     injectable clock (defaults to real time)
 */
export function getTransportEntitlement(
  student: EntitlementStudentLike | null | undefined,
  now: Date = new Date()
): EntitlementResult {
  if (!student) return { entitled: false, reason: 'no_account' };

  const st = student.status || (student as any).state || (student as any).applicationState;

  if (st === 'verified_upcoming') {
    return { entitled: false, reason: 'verified_upcoming' };
  }
  if (st === 'pending_seat_allocation') {
    return { entitled: false, reason: 'pending_seat_allocation' };
  }
  if (st === 'submitted') {
    return { entitled: false, reason: 'application_submitted' };
  }

  // (1) Lifecycle state. Only an 'active' student can hold transport entitlement.
  // soft_blocked / hard_blocked / pending_deletion / suspended / inactive → denied.
  if (student.status !== 'active') {
    return { entitled: false, reason: 'inactive_status' };
  }

  // (2) Production path — authoritative Phase-1 soft-block boundary.
  const softBlock = toDate(student.softBlock);
  if (softBlock) {
    return softBlock > now
      ? { entitled: true, reason: 'entitled' }
      : { entitled: false, reason: 'past_soft_block' };
  }

  // (3) Legacy fallback — softBlock not populated (pre-Phase-1 records). Approximate
  // the boundary to validUntil. softBlock is always >= validUntil (it falls after
  // session end), so using validUntil here is strict/safe and never over-grants.
  const validUntil = toDate(student.validUntil);
  if (validUntil) {
    return validUntil > now
      ? { entitled: true, reason: 'entitled' }
      : { entitled: false, reason: 'expired' };
  }

  // (4) Active student with NO date fields at all = incomplete legacy data. Per the
  // locked rule, missing data MUST NOT strip access from an active student. Grant,
  // and surface a distinct reason so the cron/back-office can backfill softBlock.
  return { entitled: true, reason: 'entitled_legacy_incomplete' };
}

/** Boolean convenience wrapper around {@link getTransportEntitlement}. */
export function hasTransportEntitlement(
  student: EntitlementStudentLike | null | undefined,
  now: Date = new Date()
): boolean {
  return getTransportEntitlement(student, now).entitled;
}

/** Human-facing copy for each non-entitled reason. Reused by the lifecycle UI. */
export const ENTITLEMENT_MESSAGES: Record<EntitlementReason, { title: string; detail: string }> = {
  entitled: {
    title: 'Transport active',
    detail: 'Your bus transport access is active.',
  },
  entitled_legacy_incomplete: {
    title: 'Transport active',
    detail: 'Your bus transport access is active.',
  },
  no_account: {
    title: 'No transport account',
    detail: 'We could not find an active transport profile for your account.',
  },
  inactive_status: {
    title: 'Transport access paused',
    detail:
      'Your bus service is not active. Renew your service to restore transport access. Your account, profile, and payment history are unchanged.',
  },
  past_soft_block: {
    title: 'Renewal required',
    detail:
      'Your bus service period has ended and your seat has been released. Renew and get approved to restore transport access.',
  },
  expired: {
    title: 'Service expired',
    detail:
      'Your bus service validity has expired. Renew your service to restore transport access.',
  },
  verified_upcoming: {
    title: 'Application Verified (Awaiting Session Start)',
    detail:
      'Your application for the upcoming academic session has been verified and approved by administrators! Your bus pass and live tracking will automatically activate when the new academic session begins.',
  },
  pending_seat_allocation: {
    title: 'In Seat Allocation Queue',
    detail:
      'Your application and payment are verified! You are currently in the seat allocation queue. Your pass will activate as soon as a seat opens up.',
  },
  application_submitted: {
    title: 'Application Under Review',
    detail:
      'Your application has been submitted and is currently being reviewed by administrators. This usually takes 1-2 business days.',
  },
};
