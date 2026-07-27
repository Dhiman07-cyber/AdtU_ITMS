const MAX_PAYLOAD_SIZE = parseInt(process.env.MAX_PAYLOAD_SIZE || '65536', 10);
const MAX_CHANNEL_LENGTH = 128;
const MAX_EVENT_LENGTH = 64;

const seenNonces = new Map<string, number>();
const NONCE_EXPIRY = 30000;

const nonceCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, t] of seenNonces) { if (now - t > NONCE_EXPIRY) seenNonces.delete(k); }
}, 60000);

export function stopMessageValidator(): void {
  clearInterval(nonceCleanupTimer);
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validatePayload(raw: string): ValidationResult {
  if (raw.length > MAX_PAYLOAD_SIZE) {
    return { valid: false, error: `Payload exceeds ${MAX_PAYLOAD_SIZE} bytes` };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, error: 'Invalid JSON' };
  }

  if (!parsed.type || typeof parsed.type !== 'string') {
    return { valid: false, error: 'Message must have a "type" field' };
  }

  if (parsed.channel && typeof parsed.channel === 'string' && parsed.channel.length > MAX_CHANNEL_LENGTH) {
    return { valid: false, error: `Channel exceeds ${MAX_CHANNEL_LENGTH} chars` };
  }

  if (parsed.event && typeof parsed.event === 'string' && parsed.event.length > MAX_EVENT_LENGTH) {
    return { valid: false, error: `Event exceeds ${MAX_EVENT_LENGTH} chars` };
  }

  return { valid: true };
}

export function checkReplay(nonce: string): boolean {
  const key = `nonce:${nonce}`;
  if (seenNonces.has(key)) return false;
  seenNonces.set(key, Date.now());
  return true;
}
