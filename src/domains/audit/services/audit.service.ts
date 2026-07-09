/**
 * D12 AuditService — public service contract per PHASE2.2/2.4.
 *
 * Responsibilities: ONE canonical audit logging business contract.
 * Internally delegates to the appropriate system (Phase 2.5 TTL-based
 * or Phase 4 tiered durability). Externally there is ONE interface.
 *
 * ponytail: delegates entirely to existing production logic in
 * src/lib/services/audit.service.ts and src/lib/audit/audit-service.ts
 * (via auditRepository) — zero behavior change.
 */
import * as auditRepository from '../repositories/audit.repository';
import type { CreateAuditLogInput } from '../repositories/audit.repository';

/**
 * The ONE canonical function for creating audit logs.
 * Every business workflow MUST call this function. No exceptions.
 */
export async function createAuditLog(input: CreateAuditLogInput): Promise<string> {
  return auditRepository.createAuditLog(input);
}

export type { CreateAuditLogInput };
