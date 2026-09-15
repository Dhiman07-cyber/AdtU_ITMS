import { beforeEach,describe,expect,it,vi } from 'vitest';

const EventEmitter = require('events');

vi.mock('ws', () => {
  class MockWebSocket extends EventEmitter {
    readyState = 1;
    send = vi.fn();
    close = vi.fn();
    removeAllListeners = vi.fn();
    constructor(url: string) {
      super();
      setTimeout(() => this.emit('open'), 0);
    }
  }
  return { default: MockWebSocket };
});

import { WebSocketTransport } from '../transport/websocket';

describe('WebSocketTransport — concurrency safety', () => {
  let transport: WebSocketTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new WebSocketTransport();
  });

  it('queues messages when disconnected', async () => {
    await transport.broadcast('ch1', 'ev1', { a: 1 });
    await transport.broadcast('ch1', 'ev2', { b: 2 });
    expect((transport as any).sendQueue.length).toBe(2);
  });

  it('drops oldest when queue exceeds MAX_QUEUE', async () => {
    const q = (transport as any).sendQueue;
    for (let i = 0; i < 501; i++) {
      await transport.broadcast('ch', 'ev', { i });
    }
    expect(q.length).toBe(500);
    const first = JSON.parse(q[0]);
    expect(first.payload.i).toBe(1);
    const last = JSON.parse(q[499]);
    expect(last.payload.i).toBe(500);
  });

  it('overflow policy: drops oldest (FIFO), keeps newest', async () => {
    const q = (transport as any).sendQueue;
    for (let i = 0; i < 505; i++) {
      await transport.broadcast('ch', 'ev', { seq: i });
    }
    expect(q.length).toBe(500);
    expect(JSON.parse(q[0]).payload.seq).toBe(5);
    expect(JSON.parse(q[499]).payload.seq).toBe(504);
  });

  it('disconnect clears the queue', async () => {
    await transport.broadcast('ch1', 'ev1', {});
    await transport.disconnect();
    expect((transport as any).sendQueue.length).toBe(0);
  });

  it('drains queue on connect', async () => {
    await transport.broadcast('ch1', 'ev1', { a: 1 });
    await transport.broadcast('ch1', 'ev2', { b: 2 });
    expect((transport as any).sendQueue.length).toBe(2);

    await transport.connect();

    const ws = (transport as any).ws;
    expect(ws.send).toHaveBeenCalled();
    expect((transport as any).sendQueue.length).toBe(0);
  });

  it('reconnect-during-broadcast buffers messages', async () => {
    await transport.connect();
    const ws1 = (transport as any).ws;
    ws1.emit('close');

    await transport.broadcast('ch2', 'ev2', {});
    expect((transport as any).sendQueue.length).toBe(1);

    await transport.connect();
    const ws2 = (transport as any).ws;
    expect(ws2.send).toHaveBeenCalled();
    expect((transport as any).sendQueue.length).toBe(0);
  });

  it('coalesces GPS frames per channel instead of growing the FIFO', async () => {
    for (let i = 0; i < 100; i++) {
      await transport.broadcast('bus_location_b1', 'bus_location_update', { seq: i });
    }
    expect((transport as any).sendQueue.length).toBe(0);
    expect((transport as any).gpsLatest.size).toBe(1);
    expect(JSON.parse((transport as any).gpsLatest.get('bus_location_b1')).payload.seq).toBe(99);
  });

  it('GPS volume cannot evict lifecycle events', async () => {
    await transport.broadcast('trip-status-b1', 'trip_ended', { tripId: 't1' });
    for (let i = 0; i < 600; i++) {
      await transport.broadcast('bus_location_b1', 'bus_location_update', { seq: i });
    }
    expect((transport as any).sendQueue.length).toBe(1);
    expect(JSON.parse((transport as any).sendQueue[0]).event).toBe('trip_ended');
  });

  it('non-GPS events sharing a channel are never merged', async () => {
    await transport.broadcast('waiting_flags_b1', 'waiting_flag_raised', { flagId: 'f1' });
    await transport.broadcast('waiting_flags_b1', 'waiting_flag_raised', { flagId: 'f2' });
    expect((transport as any).sendQueue.length).toBe(2);
  });

  it('disconnect clears GPS lane too', async () => {
    await transport.broadcast('bus_location_b1', 'bus_location_update', { seq: 1 });
    await transport.disconnect();
    expect((transport as any).gpsLatest.size).toBe(0);
  });
});
