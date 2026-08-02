import type { IncomingMessage } from 'http';

const configuredToken = process.env.WS_PRIVILEGED_TOKEN;
const PRIVILEGED_TOKEN = configuredToken || '__server__';
// Fail closed in production: without an explicitly configured WS_PRIVILEGED_TOKEN
// the well-known '__server__' default must NOT authenticate anyone as the server
// bridge. In dev the default keeps local setups working.
const privilegedAuthEnabled = !!configuredToken || process.env.NODE_ENV !== 'production';

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
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5-minute TTL

export async function authenticateSocket(request: IncomingMessage): Promise<AuthResult> {
  const token = extractToken(request);
  if (!token) return { authenticated: false, error: 'Missing or invalid token' };

  if (privilegedAuthEnabled && token === PRIVILEGED_TOKEN) {
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

    const roleFromToken = (decoded as any).role;
    let authResult: AuthResult;

    if (roleFromToken) {
      authResult = { authenticated: true, uid, role: roleFromToken };
    } else {
      const { getSupabaseServer } = await import('@/lib/supabase-server');
      const supabase = getSupabaseServer();

      const { data: userRow } = await supabase.from('users').select('role').eq('uid', uid).maybeSingle();
      const role = userRow?.role || 'student';

      authResult = { authenticated: true, uid, role };
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
