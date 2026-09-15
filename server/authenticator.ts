import type { IncomingMessage } from 'http';
import crypto from 'crypto';

function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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
  const token = configured || (isProd ? '' : '__server__');
  const enabled = isProd
    ? Boolean(configured && configured.trim() !== '' && configured !== '__server__')
    : Boolean(configured || true);
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
    const { verifyToken } = await import('@/lib/firebase-admin');
    const decoded = await verifyToken(token);
    const uid = decoded.uid;

    // PostgreSQL is authoritative for role (same source as HTTP). The
    // Firebase custom claim is only a fallback for accounts not yet
    // provisioned in PG — never preferred, so a demoted user cannot ride
    // a stale claim past their PG role.
    const { getSupabaseServer } = await import('@/lib/supabase-server');
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

    if (tokenAuthCache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of tokenAuthCache.entries()) {
        if (v.expiresAt <= now) tokenAuthCache.delete(k);
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
  // A malformed request.url (e.g. a stray "%zz" in the query string) makes
  // the URL constructor throw. This runs before any try/catch in
  // authenticateSocket, so an uncaught throw here would crash the process
  // via an unhandled rejection in the ws 'connection' handler.
  let url: URL;
  try {
    url = new URL(request.url || '/', 'http://localhost');
  } catch {
    return null;
  }
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

  const authHeader = request.headers['authorization'] || request.headers['Authorization'];
  if (!authHeader) return null;

  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (header.startsWith('Bearer ')) return header.slice(7);

  return header;
}
