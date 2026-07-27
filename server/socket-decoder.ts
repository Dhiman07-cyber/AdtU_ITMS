export interface DecodedMessage {
  type: string;
  channel?: string;
  event?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export function decode(raw: string): DecodedMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.type || typeof parsed.type !== 'string') return null;
    return parsed as DecodedMessage;
  } catch {
    return null;
  }
}
