import { describe,expect,it,vi } from 'vitest';

vi.mock('../repositories/student.repository', () => ({
  findByUid: vi.fn().mockResolvedValue({ id: 's1', uid: 's1', status: 'active' }),
  findById: vi.fn().mockResolvedValue({ id: 's1', status: 'active' }),
  findAll: vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
  findByBusId: vi.fn().mockResolvedValue([{ id: 's1', busId: 'b1' }]),
  update: vi.fn().mockResolvedValue(true),
  remove: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/domains/payment', () => ({
  getByStudent: vi.fn().mockResolvedValue([{ id: 'p1' }]),
}));

import { getAll,getByBusId,getByUid,update } from '../services/student.service';

describe('StudentService', () => {
  it('delegates uid lookup to the repository unchanged', async () => {
    const student = await getByUid('s1');
    expect(student).toEqual({ id: 's1', uid: 's1', status: 'active' });
  });

  it('delegates list lookup to the repository unchanged', async () => {
    const students = await getAll();
    expect(students).toHaveLength(2);
  });

  it('delegates bus-scoped lookup to the repository unchanged', async () => {
    const students = await getByBusId('b1');
    expect(students).toEqual([{ id: 's1', busId: 'b1' }]);
  });

  it('delegates update to the repository unchanged', async () => {
    await expect(update('s1', { status: 'active' })).resolves.toBeUndefined();
  });
});
