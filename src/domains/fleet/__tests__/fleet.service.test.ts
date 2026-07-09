/**
 * D6 Fleet Service Tests
 *
 * FleetService delegates entirely to fleet.repository (→ fleet.repository.pg → PostgreSQL).
 * Tests mock fleet.repository so no database connection is required.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/fleet.repository', () => ({
  findAllBuses: vi.fn().mockResolvedValue([{ id: 'b1', busId: 'b1', busNumber: 'BUS-01', capacity: 40, status: 'active' }]),
  findBusById: vi.fn().mockResolvedValue({ id: 'b1', busId: 'b1', busNumber: 'BUS-01', capacity: 40, status: 'active' }),
  findBusesByRouteId: vi.fn().mockResolvedValue([{ id: 'b1', busId: 'b1', routeId: 'r1', busNumber: 'BUS-01', capacity: 40, status: 'active' }]),
  updateBusRecord: vi.fn().mockResolvedValue(true),
  removeBus: vi.fn().mockResolvedValue(true),
  findAllDrivers: vi.fn().mockResolvedValue([{ id: 'd1', uid: 'd1', name: 'Driver One', email: 'driver@test.com' }]),
  findDriverById: vi.fn().mockResolvedValue({ id: 'd1', uid: 'd1', name: 'Driver One', email: 'driver@test.com' }),
  updateDriverRecord: vi.fn().mockResolvedValue(true),
  removeDriver: vi.fn().mockResolvedValue(true),
}));

import {
  getAllBuses,
  getBusesByRouteId,
  getAllDrivers,
  getBusById,
  getDriverById,
  updateBus,
  removeBus,
  updateDriver,
  removeDriver,
} from '../services/fleet.service';

describe('FleetService — PostgreSQL delegation', () => {
  it('delegates getAllBuses to repository unchanged', async () => {
    const buses = await getAllBuses();
    expect(buses).toEqual([{ id: 'b1', busId: 'b1', busNumber: 'BUS-01', capacity: 40, status: 'active' }]);
  });

  it('delegates getBusById to repository unchanged', async () => {
    const bus = await getBusById('b1');
    expect(bus).toMatchObject({ id: 'b1', busId: 'b1' });
  });

  it('delegates getBusesByRouteId to repository unchanged', async () => {
    const buses = await getBusesByRouteId('r1');
    expect(buses).toEqual([{ id: 'b1', busId: 'b1', routeId: 'r1', busNumber: 'BUS-01', capacity: 40, status: 'active' }]);
  });

  it('delegates updateBus to repository unchanged', async () => {
    const result = await updateBus('b1', { status: 'maintenance' });
    expect(result).toBe(true);
  });

  it('delegates removeBus to repository unchanged', async () => {
    const result = await removeBus('b1');
    expect(result).toBe(true);
  });

  it('delegates getAllDrivers to repository unchanged', async () => {
    const drivers = await getAllDrivers();
    expect(drivers).toEqual([{ id: 'd1', uid: 'd1', name: 'Driver One', email: 'driver@test.com' }]);
  });

  it('delegates getDriverById to repository unchanged', async () => {
    const driver = await getDriverById('d1');
    expect(driver).toMatchObject({ id: 'd1', uid: 'd1' });
  });

  it('delegates updateDriver to repository unchanged', async () => {
    const result = await updateDriver('d1', { status: 'inactive' });
    expect(result).toBe(true);
  });

  it('delegates removeDriver to repository unchanged', async () => {
    const result = await removeDriver('d1');
    expect(result).toBe(true);
  });
});
