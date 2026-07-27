// D12 Audit — public surface.
//
// Single audit capability via PostgreSQL. createAuditEvent is the canonical API.

export {
  createAuditEvent,
  queryAuditEvents,
  SYSTEM_ACTOR,
} from './services/audit.service.pg';

export { resolveAuditActor } from './utils';

export type {
  AuditActorRole,
  AuditEventInsert,
  AuditEventRow,
  AuditEventFilters,
  AuditEventPagination,
  AuditEventQueryResult,
  AuditResult,
} from './services/audit.service.pg';
