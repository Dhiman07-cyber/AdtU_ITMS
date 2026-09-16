import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInsert, mockSelect, mockDelete } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'reassignment_logs') {
        return {
          insert: mockInsert,
          select: mockSelect,
          delete: mockDelete,
        };
      }
      return {
        insert: vi.fn(),
        select: vi.fn(),
        delete: vi.fn(),
      };
    }),
  })),
}));

import { reassignmentLogsService } from '../reassignment-logs-supabase';

describe('Reassignment Logs — Immutability and Snapshot Preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: { id: 'log-1' }, error: null })),
      })),
    });
  });



  it('preserves all historical logs on insert without deleting prior entries', async () => {
    const logData = {
      operationId: 'op-12345',
      type: 'route_reassignment' as const,
      actorId: 'admin-1',
      actorLabel: 'Admin User',
      status: 'committed' as const,
      changes: [{ docPath: 'routes/r1', collection: 'routes', docId: 'r1', before: null, after: { stop: 'Stop A' } }],
      meta: { initiatedBy: 'admin-1', source: 'admin-ui' },
      summary: 'Route stop reassigned',
    };

    const id = await reassignmentLogsService.insertLog(logData);

    expect(id).toBeDefined();
    // Invariant: mockDelete MUST NEVER be called during log insertion
    expect(mockDelete).not.toHaveBeenCalled();
    // Invariant: mockInsert MUST be called with complete changes snapshot
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const rawArg = mockInsert.mock.calls[0][0];
    const insertedRow = Array.isArray(rawArg) ? rawArg[0] : rawArg;
    expect(insertedRow.operation_id).toBe('op-12345');
    expect(insertedRow.changes).toEqual([{ docPath: 'routes/r1', collection: 'routes', docId: 'r1', before: null, after: { stop: 'Stop A' } }]);
    expect(insertedRow.summary).toBe('Route stop reassigned');

  });

  it('records rollback operations linked to parent snapshot without destroying original', async () => {
    const rollbackLogData = {
      operationId: 'op-rollback-67890',
      type: 'rollback' as const,
      actorId: 'admin-1',
      actorLabel: 'Admin User',
      status: 'rolled_back' as const,
      changes: [{ docPath: 'routes/r1', collection: 'routes', docId: 'r1', before: { stop: 'Stop A' }, after: null }],
      meta: { initiatedBy: 'admin-1', rollbackOf: 'op-12345' },
      summary: 'Rollback of operation op-12345',
      rollbackOf: 'op-12345',
    };

    const id = await reassignmentLogsService.insertLog(rollbackLogData);


    expect(id).toBeDefined();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const rawArg = mockInsert.mock.calls[0][0];
    const insertedRow = Array.isArray(rawArg) ? rawArg[0] : rawArg;
    expect(insertedRow.rollback_of).toBe('op-12345');
    expect(insertedRow.status).toBe('rolled_back');

  });
});
