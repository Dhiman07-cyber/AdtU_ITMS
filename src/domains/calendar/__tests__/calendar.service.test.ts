import { describe,expect,it,vi } from 'vitest';

vi.mock('../repositories/calendar.repository', () => ({
  findActiveConfig: vi.fn().mockResolvedValue({
    academicSessionStart: { month: 6, day: 1 }, // July 1
  }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
}));

import { computeSession } from '../services/calendar.service';

describe('CalendarService.computeSession', () => {
  it('derives lifecycle dates from the active config for a given session year', async () => {
    const lifecycle = await computeSession(2026);
    // Expiry = 1 day before next July 1 → June 30, 2026
    expect(lifecycle.expiry.getUTCFullYear()).toBe(2026);
    expect(lifecycle.expiry.getUTCMonth()).toBe(5); // June
    expect(lifecycle.expiry.getUTCDate()).toBe(30);
    // Hard delete = effectiveYear + 2, same month/day
    expect(lifecycle.hardDelete.getUTCFullYear()).toBe(2028);
  });
});
