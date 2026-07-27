/**
 * POST /api/admin/migrations/run-calendar
 *
 * Façade endpoint for calendar configuration.
 * Calendar settings reside canonically in Firestore (settings/deadline).
 */
import { NextRequest,NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Calendar configuration is managed canonically in Firestore (settings/deadline).'
  });
}
