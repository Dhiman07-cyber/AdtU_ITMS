/**
 * D12 Audit Repository
 *
 * Persistence only — no business logic. Wraps both canonical audit systems:
 *
 *   Phase 2.5 (audit_logs): TTL-based business audit with severity retention.
 *   Phase 4 (activity_logs): Tiered durability with operational event recovery.
 *
 * ponytail: both src/lib/services/audit.service.ts and
 * src/lib/audit/audit-service.ts are the canonical implementations —
 * wrapped by reference, not reimplemented. The two systems coexist
 * deliberately with different collection names, document shapes, and
 * durability guarantees.
 *
 * Internal only — none of these exports appear in the domain's public API.
 */
import {
  createAuditLog as createAuditLogPhase25,
  createAuditLogInTransaction as createAuditLogInTransactionPhase25,
  resolveAuditActor,
} from '@/lib/services/audit.service';
import {
  writeAuditInTransaction as writeAuditInTransactionPhase4,
  recordOperationalEvent,
  replayAuditFailures,
  resolveActor,
} from '@/lib/audit/audit-service';
import type { CreateAuditLogInput } from '@/lib/services/audit.service';
import type { AuditEntry, AuditActor } from '@/lib/audit/audit-service';

export async function createAuditLog(input: CreateAuditLogInput): Promise<string> {
  return createAuditLogPhase25(input);
}

export function createAuditLogInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: CreateAuditLogInput,
): string {
  return createAuditLogInTransactionPhase25(transaction, input);
}

export async function resolveLegacyActor(actorId: string) {
  return resolveAuditActor(actorId);
}

export function writeAuditInTransaction(
  transaction: FirebaseFirestore.Transaction,
  entry: AuditEntry,
): void {
  return writeAuditInTransactionPhase4(transaction, entry);
}

export async function recordEvent(entry: AuditEntry): Promise<void> {
  return recordOperationalEvent(entry);
}

export async function replayFailures(limit?: number) {
  return replayAuditFailures(limit);
}

export async function resolvePhase4Actor(actorId: string): Promise<AuditActor> {
  return resolveActor(actorId);
}

export type { CreateAuditLogInput, AuditEntry, AuditActor };
