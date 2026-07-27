import { getSupabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getSupabaseServer();

    const { count, error } = await db
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error checking first user:', error);
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to check if this is the first user'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      isFirstUser: (count || 0) === 0
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error checking first user:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to check if this is the first user'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
