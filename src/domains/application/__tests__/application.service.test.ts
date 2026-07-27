import { describe, it, expect, vi } from 'vitest';

vi.mock('../repositories/application.repository', () => ({
  findAll: vi.fn().mockResolvedValue([{ applicationId: 'a1' }]),
  findByApplicationId: vi.fn().mockResolvedValue({ applicationId: 'a1', state: 'submitted' }),
  findByApplicantUid: vi.fn().mockResolvedValue(null),
  findAllByState: vi.fn().mockResolvedValue([]),
  findAllByStateAndType: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  upsert: vi.fn().mockResolvedValue(undefined),
  count: vi.fn().mockResolvedValue(0),
}));

import { getById, approve, reject } from '../services/application.service';

describe('ApplicationService', () => {
  it('delegates lookup to the repository unchanged', async () => {
    const app = await getById('a1');
    expect(app).toEqual({ applicationId: 'a1', state: 'submitted' });
  });
});
