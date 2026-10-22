import { checkApplication } from '@/domains/application';
import { adminAuth } from '@/lib/firebase-admin';
import { getSupabaseServer } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json({ hasApplication: false, authenticated: false });
    }

    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    // FIX 29: Check active student_profiles first to ignore stale fresh application rows
    const supabase = getSupabaseServer();
    const { data: student } = await supabase
      .from('student_profiles')
      .select('uid, status, bus_id')
      .eq('uid', uid)
      .maybeSingle();

    if (student && student.status === 'active') {
      return NextResponse.json({
        hasApplication: false,
        isActiveStudent: true,
        studentStatus: 'active',
        authenticated: true,
      });
    }

    const result = await checkApplication(uid);
    return NextResponse.json({ ...result, authenticated: true });
  } catch {
    return NextResponse.json({ hasApplication: false, authenticated: false });
  }
}
