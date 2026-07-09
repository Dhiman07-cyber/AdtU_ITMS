// D3 Student — public surface. Only this file may be imported by other domains.
export {
  getByUid,
  getById,
  getAll,
  getByBusId,
  getByEnrollmentId,
  applyPaymentValidity,
  update,
  remove,
  unassignRoute,
  getPaymentHistory,
  getProfile,
  getTransportEntitlement,
  hasTransportEntitlement,
} from './services/student.service';
export type { Student } from './services/student.service';
