// D12 Audit — public surface. Only this file may be imported by other domains.
//
// ONE business capability: create an audit log entry.
// All infrastructure (transactional writers, recovery, actor resolution)
// remains internal — not exposed through the domain boundary.
export { createAuditLog } from './services/audit.service';
export type { CreateAuditLogInput } from './services/audit.service';
