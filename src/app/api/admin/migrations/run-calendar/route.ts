/**
 * POST /api/admin/migrations/run-calendar
 *
 * Façade endpoint for calendar configuration.
 * Calendar settings reside canonically in Firestore (settings/deadline).
 * Admin-only.
 */
import { adminAuth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { NextRequest, NextResponse } from 'next/server';

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userRole = await resolveUserRole(decoded.uid);
    if (userRole.role !== 'admin') return null;
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const uid = await requireAdmin(req);
  if (!uid) {
    return NextResponse.json({ message: 'Unauthorized — admin only' }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    message: 'Calendar configuration is managed canonically in Firestore (settings/deadline).'
  });
}
