/**
 * Returns a cross-environment crypto object (browser + Node).
 * Handles legacy IE11 msCrypto fallback and SSR where window is undefined.
 */
export function getCrypto(): Crypto | null {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
  if (typeof window !== 'undefined') {
    return (window as any).crypto || (window as any).msCrypto || null;
  }
  return null;
}

export function createRandomId(): string {
  const cryptoApi = getCrypto();

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  if (!cryptoApi?.getRandomValues) {
    throw new Error('Secure random generation is not available');
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * Generate a prefixed random ID using secure crypto.
 * Replaces duplicated crypto + hex conversion blocks across the codebase.
 *
 * @example generatePrefixedId('staged_') // "staged_1719686400000_a3f8b2c1"
 */
export function generatePrefixedId(prefix: string, byteLength: 4 | 8 = 4): string {
  const cryptoApi = getCrypto();
  const ts = Date.now();

  if (cryptoApi?.randomUUID) {
    return `${prefix}${ts}_${cryptoApi.randomUUID().substring(0, 8)}`;
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(byteLength);
    cryptoApi.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${prefix}${ts}_${hex}`;
  }

  throw new Error('Secure random generation is not available');
}
