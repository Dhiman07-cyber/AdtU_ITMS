// D12 Audit — public surface.
//
// Single audit capability via PostgreSQL. createAuditEvent is the canonical API.

export {
	SYSTEM_ACTOR,createAuditEvent,
	queryAuditEvents
} from './services/audit.service.pg';

export { resolveAuditActor } from './utils';

export type {
	AuditActorRole,AuditEventFilters,AuditEventInsert,AuditEventPagination,
	AuditEventQueryResult,AuditEventRow,AuditResult
} from './services/audit.service.pg';
