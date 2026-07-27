import { describe,expect,it,vi } from 'vitest';

vi.mock('@/lib/services/admin-email.service', () => ({
  sendStudentAddedNotification: vi.fn().mockResolvedValue(undefined),
  sendApplicationRejectedNotification: vi.fn().mockResolvedValue(undefined),
  sendApplicationApprovedNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/admin-reconcile-bus-loads', () => ({
  adminReconcileBusLoads: vi.fn().mockResolvedValue({ totalBuses: 0, corrected: 0 }),
}));

vi.mock('@/lib/services/integrity-detector', () => ({
  runIntegrityScan: vi.fn().mockResolvedValue({ totalFindings: 0, findings: [] }),
}));

vi.mock('@/lib/services/session-activation.service', () => ({
  activateUpcomingSessionApplications: vi.fn().mockResolvedValue({ activated: 0 }),
  activateSingleApplication: vi.fn().mockResolvedValue({ activated: 0 }),
}));

import {
	activateUpcomingApplications,
	detectIntegrityIssues,
	reconcileBusLoads,
	sendStudentAddedEmail,
} from '../services/admin.service';

describe('AdminService', () => {
  it('delegates student added email to existing logic unchanged', async () => {
    await expect(sendStudentAddedEmail(null, {} as any)).resolves.toBeUndefined();
  });

  it('delegates bus load reconciliation to existing logic unchanged', async () => {
    const result = await reconcileBusLoads();
    expect(result).toEqual({ totalBuses: 0, corrected: 0 });
  });

  it('delegates integrity scan to existing logic unchanged', async () => {
    const result = await detectIntegrityIssues();
    expect(result).toEqual({ totalFindings: 0, findings: [] });
  });

  it('delegates session activation to existing logic unchanged', async () => {
    const result = await activateUpcomingApplications('admin');
    expect(result).toEqual({ activated: 0 });
  });
});
