import { beforeEach,describe,expect,it,vi } from 'vitest';

vi.mock('../transport/websocket', () => ({
  WebSocketTransport: vi.fn().mockImplementation(() => ({
    name: 'websocket',
    connect: vi.fn().mockResolvedValue(undefined),
    broadcast: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  })),
}));

vi.mock('../transport-manager', () => ({
  initializeTransport: vi.fn().mockResolvedValue(undefined),
  getActiveTransport: vi.fn(() => mockTransport),
}));

let mockTransport: any;

import { emitEvent } from '../event-emitter';

describe('EventEmitter — ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransport = { broadcast: vi.fn().mockResolvedValue(undefined) };
  });

  it('emits events in call order (FIFO via event loop)', async () => {
    const order: string[] = [];
    mockTransport.broadcast = vi.fn().mockImplementation(async (ch: string, ev: string) => {
      order.push(ev);
    });

    await Promise.all([
      emitEvent('channel', 'A', {}),
      emitEvent('channel', 'B', {}),
      emitEvent('channel', 'C', {}),
    ]);

    expect(order).toEqual(['A', 'B', 'C']);
  });

  it('handles concurrent emits to different channels without interference', async () => {
    const calls: { channel: string; event: string }[] = [];
    mockTransport.broadcast = vi.fn().mockImplementation(async (ch: string, ev: string) => {
      calls.push({ channel: ch, event: ev });
    });

    await Promise.all([
      emitEvent('ch1', 'event1', {}),
      emitEvent('ch2', 'event2', {}),
    ]);

    expect(calls.length).toBe(2);
  });
});
