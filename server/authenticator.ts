import type { IncomingMessage } from 'http';

const PRIVILEGED_TOKEN = process.env.WS_PRIVILEGED_TOKEN || '__server__';

export interface AuthResult {
  authenticated: boolean;
  uid?: string;
  role?: string;
  error?: string;
}

export async function authenticateSocket(request: IncomingMessage): Promise<AuthResult> {
  const token = extractToken(request);
  if (!token) return { authenticated: false, error: 'Missing or invalid token' };

  if (token === PRIVILEGED_TOKEN) {
    return { authenticated: true, uid: 'server', role: 'server' };
  }

  try {
    const { verifyToken } = await import('@/lib/firebase-admin');
    const decoded = await verifyToken(token);
    const uid = decoded.uid;

    const roleFromToken = (decoded as any).role;
    if (roleFromToken) {
      return { authenticated: true, uid, role: roleFromToken };
    }

    const { getSupabaseServer } = await import('@/lib/supabase-server');
    const supabase = getSupabaseServer();

    const [studentRes, driverRes, modRes, adminRes] = await Promise.all([
      supabase.from('student_profiles').select('uid').eq('uid', uid).maybeSingle(),
      supabase.from('driver_profiles').select('uid').eq('uid', uid).maybeSingle(),
      supabase.from('moderator_profiles').select('uid').eq('uid', uid).maybeSingle(),
      supabase.from('admin_profiles').select('uid').eq('uid', uid).maybeSingle(),
    ]);

    const role = studentRes.data ? 'student'
      : driverRes.data ? 'driver'
      : modRes.data ? 'moderator'
      : adminRes.data ? 'admin'
      : 'student';

    return { authenticated: true, uid, role };
  } catch (err: any) {
    return { authenticated: false, error: err.message || 'Authentication failed' };
  }
}

function extractToken(request: IncomingMessage): string | null {
  const url = new URL(request.url || '/', 'http://localhost');
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

  const authHeader = request.headers['authorization'] || request.headers['Authorization'];
  if (!authHeader) return null;

  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (header.startsWith('Bearer ')) return header.slice(7);

  return header;
}
