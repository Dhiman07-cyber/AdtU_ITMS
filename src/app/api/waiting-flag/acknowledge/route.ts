/**
 * DEPRECATED — This endpoint has been permanently removed.
 *
 * Use the canonical driver acknowledge endpoint instead:
 *   POST /api/driver/ack-flag
 *
 * This stub returns 410 Gone for any request to ensure any cached client
 * or integration test fails loudly rather than silently using stale logic.
 *
 * Removed: October 2026 (Issue 4.1 — endpoint deduplication cleanup)
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint has been permanently removed.',
      alternative: 'POST /api/driver/ack-flag',
      code: 'ENDPOINT_REMOVED',
    },
    {
      status: 410,
      headers: {
        'Sunset': 'Sat, 01 Oct 2026 00:00:00 GMT',
        'Link': '</api/driver/ack-flag>; rel="successor-version"',
      },
    }
  );
}
