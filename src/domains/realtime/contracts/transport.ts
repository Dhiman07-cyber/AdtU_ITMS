export interface RealtimeTransport {
  broadcast(channel: string, event: string, payload: Record<string, unknown>): Promise<void>;
  subscribe(channel: string, event: string, handler: (payload: any) => void): Promise<void>;
  unsubscribe(channel: string, event?: string): Promise<void>;
  disconnect(): Promise<void>;
  readonly name: string;
}
