export function encode(data: Record<string, unknown>): string {
  return JSON.stringify({
    ...data,
    timestamp: data.timestamp || new Date().toISOString(),
  });
}

export function encodeMessage(channel: string, event: string, payload: Record<string, unknown>): string {
  return encode({
    type: 'message',
    channel,
    event,
    payload,
  });
}

export function encodeAuthOk(uid: string, role: string): string {
  return encode({ type: 'auth_ok', data: { uid, role } });
}

export function encodeAuthRequired(message: string): string {
  return encode({ type: 'auth_required', message });
}

export function encodeSubscribed(channel: string): string {
  return encode({ type: 'subscribed', channel });
}

export function encodeUnsubscribed(channel: string): string {
  return encode({ type: 'unsubscribed', channel });
}

export function encodePresenceOk(): string {
  return encode({ type: 'presence_ok' });
}

export function encodeError(message: string): string {
  return encode({ type: 'error', message });
}
