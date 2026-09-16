import type { IncomingMessage } from 'http';
import crypto from 'crypto';
import { verifyToken } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';

function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

let ephemeralDevToken: string | null = null;
function getEphemeralPrivilegedToken(): string {
  if (!ephemeralDevToken) {
    ephemeralDevToken = crypto.randomBytes(32).toString('hex');
  }
  return ephemeralDevToken;
}

export function assertPrivilegedTokenSafe(
  token: string | undefined = process.env.WS_PRIVILEGED_TOKEN,
  env: string = process.env.NODE_ENV || 'development'
): void {
  if (env === 'production') {
    if (!token || token.trim() === '' || token === '__server__') {
      throw new Error('WS_PRIVILEGED_TOKEN is missing or insecure in production.');
    }
  }
}

export function getPrivilegedAuthConfig(): { token: string; enabled: boolean } {
  const configured = process.env.WS_PRIVILEGED_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';
  const token = configured && configured.trim() !== '' && configured !== '__server__'
    ? configured
    : (isProd ? '' : getEphemeralPrivilegedToken());
  const enabled = Boolean(token && token.trim() !== '');
  return { token, enabled };
}

export interface AuthResult {
  authenticated: boolean;
  uid?: string;
  role?: string;
  error?: string;
}

interface CachedAuth {
  result: AuthResult;
  expiresAt: number;
}

const tokenAuthCache = new Map<string, CachedAuth>();
// 90-second TTL: bounds the stale-role window after a demotion/deletion.
// Auth runs once per connection (plus reconnects), so a short TTL costs
// essentially nothing in steady state.
const TOKEN_CACHE_TTL_MS = 90 * 1000;

/**
 * Invalidate cached socket auth by UID or completely.
 * Triggered by Redis role_invalidate events when admin modifies user permissions.
 */
export function invalidateTokenAuthCache(uid?: string): void {
  if (!uid) {
    tokenAuthCache.clear();
    return;
  }
  for (const [token, cached] of tokenAuthCache.entries()) {
    if (cached.result.uid === uid) {
      tokenAuthCache.delete(token);
    }
  }
}

export async function authenticateSocket(request: IncomingMessage): Promise<AuthResult> {
  const token = extractToken(request);
  if (!token) return { authenticated: false, error: 'Missing or invalid token' };

  const { token: privilegedToken, enabled: privilegedEnabled } = getPrivilegedAuthConfig();
  if (privilegedEnabled && safeCompare(token, privilegedToken)) {
    return { authenticated: true, uid: 'server', role: 'server' };
  }

  const cached = tokenAuthCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const decoded = await verifyToken(token);
    const uid = decoded.uid;

    // PostgreSQL is authoritative for role (same source as HTTP). The
    // Firebase custom claim is only a fallback for accounts not yet
    // provisioned in PG — never preferred, so a demoted user cannot ride
    // a stale claim past their PG role.
    const supabase = getSupabaseServer();

    const { data: userRow } = await supabase.from('users').select('role').eq('uid', uid).maybeSingle();
    let authResult: AuthResult;

    if (userRow?.role) {
      authResult = { authenticated: true, uid, role: userRow.role };
    } else if ((decoded as any).role) {
      authResult = { authenticated: true, uid, role: (decoded as any).role };
    } else {
      return { authenticated: false, error: 'Unknown user' };
    }

    if (tokenAuthCache.size >= 1000) {
      let checked = 0;
      const now = Date.now();
      for (const [k, v] of tokenAuthCache.entries()) {
        if (v.expiresAt <= now) tokenAuthCache.delete(k);
        if (++checked >= 50) break;
      }
      if (tokenAuthCache.size >= 1000) {
        const oldestKey = tokenAuthCache.keys().next().value;
        if (oldestKey) tokenAuthCache.delete(oldestKey);
      }
    }
    tokenAuthCache.set(token, { result: authResult, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });

    return authResult;
  } catch (err: any) {
    console.warn('⚠️ [WS Authenticator] Token verification failed:', err.message || err);
    return { authenticated: false, error: err.message || 'Authentication failed' };
  }
}

function extractToken(request: IncomingMessage): string | null {
  // Reject URL query-parameter tokens (?token=...) to eliminate exposure in proxy/server logs,
  // browser history, and Referer headers (AUTH-03 / SEC-04).
  // Clients must authenticate via HTTP Authorization header on handshake or First-Message (Path B).
  const authHeader = request.headers['authorization'] || request.headers['Authorization'];
  if (!authHeader) return null;

  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (header.startsWith('Bearer ')) return header.slice(7).trim();

  return header.trim();
}

