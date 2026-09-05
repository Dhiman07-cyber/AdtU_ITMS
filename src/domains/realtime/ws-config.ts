/**
 * WebSocket Endpoint Configuration & Resolution Utilities
 *
 * Provides distinct, secure URL resolution for:
 *   1. Client (Browser): getClientWsUrl()
 *   2. Server-side internal transport (Next.js -> WS Server): getServerWsUrl()
 *
 * Security:
 *   - NEVER appends secrets or tokens to URLs.
 *   - Normalizes ws:// vs wss:// to prevent mixed-content blocks on HTTPS pages.
 *   - Dynamically resolves LAN IPs for multi-device local testing.
 *   - Prevents duplicate path prefixes (/ws/ws).
 */

/**
 * Resolves the public WebSocket endpoint URL for browser / client components.
 */
export function getClientWsUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;

  if (envUrl && envUrl.trim()) {
    let url = envUrl.trim();

    // If testing on a mobile device or separate machine on the same LAN
    // (e.g. http://192.168.1.X:3000), but NEXT_PUBLIC_WS_URL was set to localhost,
    // dynamically rewrite localhost/127.0.0.1 to the active LAN hostname.
    if (
      typeof window !== 'undefined' &&
      window.location.hostname &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      try {
        const dummyProto = url.startsWith('wss:') ? 'https:' : 'http:';
        const parsed = new URL(url.replace(/^wss?:/, dummyProto));
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          const isHttps = window.location.protocol === 'https:';
          const proto = isHttps ? 'wss:' : 'ws:';
          const port = parsed.port || '3001';
          return `${proto}//${window.location.hostname}:${port}/ws`;
        }
      } catch {
        // Fall through to normal resolution if URL parsing fails
      }
    }

    // Auto-upgrade ws:// to wss:// when running inside an HTTPS page (unless loopback)
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      if (url.startsWith('ws://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
        url = 'wss://' + url.slice(5);
      }
    }

    // Handle accidental http:// or https:// input
    if (url.startsWith('https://')) {
      url = 'wss://' + url.slice(8);
    } else if (url.startsWith('http://')) {
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      url = (isHttps ? 'wss://' : 'ws://') + url.slice(7);
    }

    // Strip existing query string — tokens must never travel in URL query params
    const qIdx = url.indexOf('?');
    if (qIdx !== -1) {
      url = url.substring(0, qIdx);
    }

    // Normalize trailing slashes and ensure /ws suffix without creating /ws/ws
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/ws')) {
      url = `${url}/ws`;
    }

    return url;
  }

  // Local development fallback
  if (typeof window !== 'undefined') {
    const isHttps = window.location.protocol === 'https:';
    const proto = isHttps ? 'wss:' : 'ws:';
    const host = window.location.hostname || 'localhost';
    return `${proto}//${host}:3001/ws`;
  }

  return 'ws://localhost:3001/ws';
}

/**
 * Resolves the internal server-to-server WebSocket endpoint URL.
 * Used by Next.js route handlers (e.g. /api/location/update) to broadcast
 * events to the dedicated WebSocket runtime.
 *
 * Checks:
 *   1. WS_SERVER_URL (Explicit remote or internal URL, e.g. wss://ws.example.com/ws)
 *   2. WS_URL (Alternate alias)
 *   3. Fallback: ws://${WS_HOST:-127.0.0.1}:${WS_PORT:-3001}/ws
 */
export function getServerWsUrl(): string {
  const envUrl = process.env.WS_SERVER_URL || process.env.WS_URL;

  if (envUrl && envUrl.trim()) {
    let url = envUrl.trim();

    if (url.startsWith('https://')) {
      url = 'wss://' + url.slice(8);
    } else if (url.startsWith('http://')) {
      url = 'ws://' + url.slice(7);
    }

    // Strip any query string — tokens must never travel in URLs
    const qIdx = url.indexOf('?');
    if (qIdx !== -1) {
      url = url.substring(0, qIdx);
    }

    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/ws')) {
      url = `${url}/ws`;
    }

    return url;
  }

  const host = process.env.WS_HOST || '127.0.0.1';
  const port = process.env.WS_PORT || '3001';
  return `ws://${host}:${port}/ws`;
}
