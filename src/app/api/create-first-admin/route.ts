import { createUser, getUserById } from '@/domains/identity';
import { getSupabaseServer } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
    // Rate limit: max 5 requests per 10 minutes per IP (AUTH-04)
    const realIp = request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip');
    const xff = request.headers.get('x-forwarded-for');
    const xffParts = xff ? xff.split(',').map(s => s.trim()).filter(Boolean) : [];
    const ip = realIp?.trim() || (xffParts.length > 0 ? xffParts[xffParts.length - 1] : 'unknown');
    const rateLimit = checkRateLimit(`create-first-admin:${ip}`, 5, 10 * 60 * 1000);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Too many requests. Please try again later.'
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)) },
      });
    }

    const bootstrapSecret = process.env.FIRST_ADMIN_BOOTSTRAP_SECRET;
    if (!bootstrapSecret) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Bootstrap is disabled'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const headerSecret = request.headers.get('x-bootstrap-secret') || '';
    // Constant-time comparison using fixed-length SHA-256 digests to eliminate secret-length oracle (AUTH-15)
    const hmacKey = 'bootstrap-secret-hasher';
    const expectedHash = crypto.createHmac('sha256', hmacKey).update(bootstrapSecret).digest();
    const actualHash = crypto.createHmac('sha256', hmacKey).update(headerSecret).digest();
    if (!crypto.timingSafeEqual(expectedHash, actualHash)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Unauthorized bootstrap request'
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { uid, email, name } = await request.json();

    // Validate input
    if (!uid || !email || !name) {
      return new Response(JSON.stringify({
        success: false,
        error: 'UID, email, and name are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Enforce the actual "first admin" invariant: the users table must be
    // empty. Checking only the supplied uid would let a leaked bootstrap
    // secret mint unlimited admin rows.
    try {
      const supabase = getSupabaseServer();
      const { count, error: countError } = await supabase
        .from('users')
        .select('uid', { count: 'exact', head: true });
      if (countError) {
        console.error('Error checking users count during bootstrap:', countError);
        return new Response(JSON.stringify({
          success: false,
          error: 'Database error checking existing users; bootstrap failed closed.'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if ((count || 0) > 0) {
        return new Response(JSON.stringify({
          success: false,
          error: 'First admin already exists'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const existingUser = await getUserById(uid);
      if (existingUser) {
        return new Response(JSON.stringify({
          success: false,
          error: 'First admin already exists'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (error: any) {
      console.error('Exception checking existing users during bootstrap:', error);
      return new Response(JSON.stringify({
        success: false,
        error: 'Database error checking existing users; bootstrap failed closed.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create user in PostgreSQL
    await createUser({
      uid,
      email,
      name,
      role: 'admin',
      createdAt: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'First admin created successfully'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error creating first admin user:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to create first admin user'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
