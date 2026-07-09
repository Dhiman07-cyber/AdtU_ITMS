/**
 * D8 Seat Repository (capacity + reassignment persistence)
 *
 * Persistence only — no business logic. Wraps the existing Firestore-backed
 * capacity counters.
 *
 * ponytail: src/lib/busCapacityService.ts (13 live callers) already
 * implements this correctly — wrapped by reference, not reimplemented.
 * No seat_assignments table exists yet (capacity truth still lives on the
 * Firestore `Bus` document per PHASE2.2 §3.1's scheduled elimination) —
 * this repository wraps what actually exists today, nothing more. Upgrade
 * path: replace these delegate calls with Postgres `seat_assignments`/
 * `bus_capacity_counters` queries once that table exists.
 */
import {
  checkBusCapacity,
  incrementBusCapacity,
  decrementBusCapacity,
  findAlternativeBuses,
  validateAndSuggestBus,
} from '@/lib/busCapacityService';

export async function getBusCapacity(busId: string, shift?: string) {
  return checkBusCapacity(busId, shift);
}

export async function incrementCapacity(busId: string, studentUid: string, shift?: string): Promise<void> {
  return incrementBusCapacity(busId, studentUid, shift);
}

export async function decrementCapacity(busId: string, studentUid: string, shift?: string): Promise<void> {
  return decrementBusCapacity(busId, studentUid, shift);
}

export async function findAlternatives(stopId: string, routeId: string, shift: string) {
  return findAlternativeBuses(stopId, routeId, shift);
}

export async function validateAssignment(params: { routeId: string; stopId: string; shift: string }) {
  return validateAndSuggestBus(params);
}
