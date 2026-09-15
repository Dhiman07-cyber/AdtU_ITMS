import { createUser,getUserById } from '@/domains/identity';
import { getSupabaseServer } from '@/lib/supabase-server';
import crypto from 'crypto';

export async function POST(request: Request) {
  try {
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

    const headerSecret = request.headers.get('x-bootstrap-secret');
    if (!headerSecret || headerSecret.length !== bootstrapSecret.length ||
        !crypto.timingSafeEqual(Buffer.from(headerSecret), Buffer.from(bootstrapSecret))) {
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
      if (countError) throw countError;
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
    } catch (error) {
      // If table doesn't exist yet, that's fine — no users exist
      console.log('Error checking existing users (table may not exist yet):', error);
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
