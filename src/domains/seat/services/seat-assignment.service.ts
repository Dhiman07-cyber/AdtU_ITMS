/**
 * SeatAssignmentService
 *
 * Responsibilities: seat capacity, shift-scoped availability, reassignment
 * + rollback, allocation ranking. Master data resides in fleet/route services.
 *
 * Implementation details (ReassignmentService, AllocationRanker,
 * reassignmentLogs, alertBusFull) are internal to the seat domain.
 * External consumers import these directly from their canonical
 * locations in @/lib/services/.
 */
import * as seatRepository from '../repositories/seat.repository';

export async function getCapacity(busId: string, shift?: string) {
  return seatRepository.getBusCapacity(busId, shift);
}

export async function assignSeat(busId: string, studentUid: string, shift?: string): Promise<void> {
  return seatRepository.incrementCapacity(busId, studentUid, shift);
}

export async function releaseSeat(busId: string, studentUid: string, shift?: string): Promise<void> {
  return seatRepository.decrementCapacity(busId, studentUid, shift);
}

export async function findAlternativeBuses(stop_name: string, routeId: string, shift: string) {
  return seatRepository.findAlternatives(stop_name, routeId, shift);
}

export async function validateAssignment(params: { routeId: string; stop_name: string; shift: string }) {
  return seatRepository.validateAssignment(params);
}
