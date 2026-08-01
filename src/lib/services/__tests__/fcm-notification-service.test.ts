import { beforeEach,describe,expect,it,vi } from 'vitest';

const {
  mockRunTransaction,
  mockCollectionFn,
  mockSendTopic,
} = vi.hoisted(() => ({
  mockRunTransaction: vi.fn(),
  mockCollectionFn: vi.fn(),
  mockSendTopic: vi.fn(),
}));

function queryChain(docs: Array<{ id: string }> = []) {
  const chain = {
    where: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    get: vi.fn().mockResolvedValue({ docs, empty: docs.length === 0, size: docs.length }),
  };
  return chain;
}

function collectionChain(docData: Record<string, unknown> | null = null) {
  return {
    doc: vi.fn(() => ({
      get: vi.fn().mockResolvedValue({
        exists: docData !== null,
        data: () => docData,
      }),
      update: vi.fn().mockResolvedValue(undefined),
    })),
    where: vi.fn(() => queryChain()),
  };
}

vi.mock('@/lib/firebase-admin', () => ({
  db: {
    collection: (...args: unknown[]) => mockCollectionFn(...args),
    runTransaction: (fn: unknown) => mockRunTransaction(fn),
    batch: () => ({
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    }),
  },
  messaging: {
    send: (...args: unknown[]) => mockSendTopic(...args),
  },
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  },
}));

let mockSupabaseClient: Record<string, any>;

vi.mock('@/lib/supabase-server', () => ({
  getSupabaseServer: () => mockSupabaseClient,
}));

import { notifyRoute,verifyDriverRouteBinding } from '../fcm-notification-service';

describe('FCM Notification Service', () => {
  beforeEach(() => {
    mockRunTransaction.mockReset();
    mockCollectionFn.mockReset();
    mockSendTopic.mockReset();

    mockSupabaseClient = {
      rpc: vi.fn().mockResolvedValue({ data: { acquired: true }, error: null }),
      from: vi.fn(() => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        return chain;
      }),
    };

    mockRunTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ activeTripLock: { tripId: 't1' } }),
      }),
      update: vi.fn(),
    }));
    mockCollectionFn.mockImplementation(() => collectionChain());
    mockSendTopic.mockResolvedValue('msg-id');
  });

  describe('notifyRoute', () => {
    it('sends trip notifications to the route topic', async () => {
      const result = await notifyRoute({ routeId: 'r1', tripId: 't1', routeName: 'Morning', busId: 'b1' });

      expect(result.success).toBe(true);
      expect(result.successCount).toBe(1);
      expect(result.totalTokens).toBe(0);
      expect(result.batchCount).toBe(1);
      expect(mockSendTopic).toHaveBeenCalledTimes(1);

      const message = mockSendTopic.mock.calls[0][0];
      expect(message.topic).toBe('route_r1');
      expect(message.notification.title).toContain('Bus Journey Started');
      expect(message.notification.body).toContain('Morning');
      expect(message.data.type).toBe('TRIP_STARTED');
      expect(message.data.tripId).toBe('t1');
    });

    it('prevents duplicate sends through the bus lock flag', async () => {
      mockSupabaseClient.rpc.mockResolvedValueOnce({ data: { acquired: false }, error: null });

      const result = await notifyRoute({ routeId: 'r1', tripId: 't2', routeName: 'Morning', busId: 'b1' });

      expect(result.error).toContain('ALREADY_SENT');
      expect(result.successCount).toBe(0);
      expect(mockSendTopic).not.toHaveBeenCalled();
    });

    it('supports trip-ended topic payloads', async () => {
      mockRunTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<void>) => fn({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ activeTripLock: { tripId: 't3' } }),
        }),
        update: vi.fn(),
      }));

      const result = await notifyRoute({
        routeId: 'r1',
        tripId: 't3',
        routeName: 'Morning',
        busId: 'b1',
        eventType: 'TRIP_ENDED',
      });

      expect(result.success).toBe(true);
      const message = mockSendTopic.mock.calls[0][0];
      expect(message.notification.title).toContain('Trip Ended');
      expect(message.data.type).toBe('TRIP_ENDED');
    });

    it('skips idempotency check when requested', async () => {
      const result = await notifyRoute({
        routeId: 'r1',
        tripId: 't4',
        routeName: 'Morning',
        busId: 'b1',
        skipIdempotencyCheck: true,
      });

      expect(result.successCount).toBe(1);
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });
  });

  describe('verifyDriverRouteBinding', () => {
    it('authorizes a driver assigned to the bus via active_trips', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: { bus_id: 'b1', driver_id: 'd1' },
        error: null,
      });
      mockSupabaseClient.from.mockImplementation((table: string) => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: mockMaybeSingle,
        };
        return chain;
      });

      expect((await verifyDriverRouteBinding('d1', 'r1', 'b1')).authorized).toBe(true);
    });

    it('authorizes a driver referenced by the buses table', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        const chain: Record<string, any> = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          or: vi.fn(() => chain),
          in: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(),
        };
        if (table === 'active_trips') {
          chain.maybeSingle.mockResolvedValue({ data: null, error: null });
        } else if (table === 'buses') {
          chain.maybeSingle.mockResolvedValue({ data: { driver_uid: 'd1' }, error: null });
        } else {
          chain.maybeSingle.mockResolvedValue({ data: null, error: null });
        }
        return chain;
      });

      expect((await verifyDriverRouteBinding('d1', 'r1', 'b1')).authorized).toBe(true);
    });

    it('rejects an unassigned driver', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        const chain: Record<string, any> = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          or: vi.fn(() => chain),
          in: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(),
        };
        if (table === 'buses') {
          chain.maybeSingle.mockResolvedValue({ data: { driver_uid: 'x' }, error: null });
        }
        return chain;
      });

      expect((await verifyDriverRouteBinding('d1', 'r1', 'b1')).authorized).toBe(false);
    });

    it('rejects when the driver is missing', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        const chain: Record<string, any> = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(),
        };
        chain.maybeSingle.mockResolvedValue({ data: null, error: null });
        return chain;
      });

      const result = await verifyDriverRouteBinding('missing', 'r1', 'b1');
      expect(result.authorized).toBe(false);
    });
  });
});
