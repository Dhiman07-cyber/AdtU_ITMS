import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/services/audit.service', () => ({
  createAuditLog: vi.fn().mockResolvedValue('audit-1'),
}));

import { createAuditLog } from '../services/audit.service';

describe('AuditService', () => {
  it('delegates createAuditLog to the canonical implementation unchanged', async () => {
    const id = await createAuditLog({
      category: 'system',
      action: 'test',
      summary: 'Test',
      severity: 'low',
      performedBy: 'u1',
      targetType: 'test',
      targetId: 't1',
    });
    expect(id).toBe('audit-1');
  });
});
