export interface QRContract {
  version: number;
  busId: string;
}

const SUPPORTED_VERSIONS = [1];
const MAX_BUS_ID_LENGTH = 100;

export function parseQRPayload(raw: string): QRContract {
  if (!raw) throw new Error('Empty QR payload');

  const trimmed = raw.trim();

  if (trimmed.startsWith('bus:')) {
    return { version: 1, busId: trimmed.slice(4) };
  }

  const parsed = tryParseJSON(trimmed);
  if (parsed && typeof parsed.busId === 'string') {
    const version = typeof parsed.version === 'number' ? parsed.version : 1;
    return { version, busId: parsed.busId };
  }

  return { version: 1, busId: trimmed };
}

export function encodeQRContract(contract: QRContract): string {
  return JSON.stringify({ version: contract.version, busId: contract.busId });
}

export function validateQRContract(contract: QRContract): { valid: boolean; error?: string } {
  if (!SUPPORTED_VERSIONS.includes(contract.version)) {
    return { valid: false, error: `Unsupported QR version: ${contract.version}` };
  }
  if (!contract.busId || contract.busId.length === 0) {
    return { valid: false, error: 'Missing busId in QR payload' };
  }
  if (contract.busId.length > MAX_BUS_ID_LENGTH) {
    return { valid: false, error: 'busId exceeds maximum length' };
  }
  return { valid: true };
}

function tryParseJSON(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
