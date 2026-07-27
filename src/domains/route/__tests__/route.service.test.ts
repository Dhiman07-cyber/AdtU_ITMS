import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/route.repository', () => ({
  findAll: vi.fn().mockResolvedValue([{ id: 'r1', routeId: 'r1', routeName: 'North' }]),
  findById: vi.fn().mockResolvedValue({ id: 'r1', routeName: 'North' }),
  update: vi.fn().mockResolvedValue(true),
  remove: vi.fn().mockResolvedValue(true),
  create: vi.fn().mockResolvedValue('r2'),
  findAllNames: vi.fn().mockResolvedValue(['North', 'South']),
}));

import { getAll, getById, create } from '../services/route.service';

describe('RouteService', () => {
  it('delegates route lookup to the repository unchanged', async () => {
    const routes = await getAll();
    expect(routes).toEqual([{ id: 'r1', routeId: 'r1', routeName: 'North' }]);
  });

  it('delegates single route lookup to the repository unchanged', async () => {
    const route = await getById('r1');
    expect(route).toEqual({ id: 'r1', routeName: 'North' });
  });

  it('delegates route creation to the repository unchanged', async () => {
    const id = await create({ routeId: 'r2', routeName: 'East', status: 'active', stops: [] } as any);
    expect(id).toBe('r2');
  });
});
