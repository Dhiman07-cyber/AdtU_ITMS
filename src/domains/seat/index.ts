// D8 Seat Assignment — public surface. Only this file may be imported by other domains.
//
// Implementation details (ReassignmentService, AllocationRanker,
// reassignmentLogs, alertBusFull) are internal to the seat domain.
// External consumers import these directly from their canonical
// locations in @/lib/services/.
export {
  getCapacity,
  assignSeat,
  releaseSeat,
  findAlternativeBuses,
  validateAssignment,
} from './services/seat-assignment.service';
