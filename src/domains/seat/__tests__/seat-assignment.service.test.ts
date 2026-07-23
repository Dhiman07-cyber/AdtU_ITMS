import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/seat.repository', () => ({
  getBusCapacity: vi.fn().mockResolvedValue({ available: true, currentMembers: 10, shiftLoad: 5, capacity: 55 }),
  incrementCapacity: vi.fn().mockResolvedValue(undefined),
  decrementCapacity: vi.fn().mockResolvedValue(undefined),
  findAlternatives: vi.fn().mockResolvedValue({ alternatives: [] }),
  validateAssignment: vi.fn().mockResolvedValue({ canAssign: true, message: 'ok' }),
}));

import { getCapacity, assignSeat, releaseSeat, validateAssignment } from '../services/seat-assignment.service';

describe('SeatAssignmentService', () => {
  it('delegates capacity check to the repository unchanged', async () => {
    const capacity = await getCapacity('bus1', 'Morning');
    expect(capacity).toEqual({ available: true, currentMembers: 10, shiftLoad: 5, capacity: 55 });
  });

  it('delegates seat assign (increment) to the repository unchanged', async () => {
    await assignSeat('bus1', 'student1', 'Morning');
    const repo = await import('../repositories/seat.repository');
    expect(repo.incrementCapacity).toHaveBeenCalledWith('bus1', 'student1', 'Morning');
  });

  it('delegates seat release (decrement) to the repository unchanged', async () => {
    await releaseSeat('bus1', 'student1', 'Evening');
    const repo = await import('../repositories/seat.repository');
    expect(repo.decrementCapacity).toHaveBeenCalledWith('bus1', 'student1', 'Evening');
  });

  it('delegates assignment validation to the repository unchanged', async () => {
    const result = await validateAssignment({ routeId: 'r1', stop_name: 's1', shift: 'Morning' });
    expect(result).toEqual({ canAssign: true, message: 'ok' });
  });
});
