import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/trip.repository', () => ({
  startTrip: vi.fn().mockResolvedValue({ success: true, tripId: 't1' }),
  endTrip: vi.fn().mockResolvedValue({ success: true }),
  getActiveTrip: vi.fn().mockResolvedValue({ trip_id: 't1', bus_id: 'b1', status: 'active' }),
}));

import { startTrip, endTrip, getActiveTrip } from '../services/trip.service';

describe('TripService', () => {
  it('delegates startTrip to the repository unchanged', async () => {
    const result = await startTrip('d1', 'b1', 'r1', 'morning', 't1');
    expect(result).toEqual({ success: true, tripId: 't1' });
  });

  it('delegates endTrip to the repository unchanged', async () => {
    const result = await endTrip('t1', 'd1', 'b1');
    expect(result).toEqual({ success: true });
  });

  it('delegates getActiveTrip to the repository unchanged', async () => {
    const result = await getActiveTrip('b1');
    expect(result).toEqual({ trip_id: 't1', bus_id: 'b1', status: 'active' });
  });
});
