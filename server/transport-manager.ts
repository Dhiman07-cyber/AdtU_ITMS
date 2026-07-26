import { wsServer } from './websocket-server';

class TransportManager {
  async broadcast(channel: string, event: string, payload: Record<string, unknown>): Promise<void> {
    wsServer.broadcastToChannel(channel, event, payload);
  }

  async broadcastToChannels(channels: string[], event: string, payload: Record<string, unknown>): Promise<void> {
    wsServer.broadcastToChannels(channels, event, payload);
  }

  async shutdown(): Promise<void> {
  }
}

export const transportManager = new TransportManager();
