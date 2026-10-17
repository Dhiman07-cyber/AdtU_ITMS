/**
 * DEPRECATED — This endpoint reached end-of-life on 2026-09-01 and has been removed.
 *
 * Use the canonical trip-end endpoint instead:
 *   POST /api/driver/end-journey-v2
 *
 * This stub returns 410 Gone so any client with a cached URL fails loudly
 * and is forced to update to the canonical endpoint.
 *
 * Removed: October 2026 (Issue 4.2 — Sunset exceeded, no active callers)
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error: 'This endpoint reached end-of-life on 2026-09-01 and has been permanently removed.',
      alternative: 'POST /api/driver/end-journey-v2',
      code: 'ENDPOINT_REMOVED',
    },
    {
      status: 410,
      headers: {
        'Sunset': 'Mon, 01 Sep 2026 00:00:00 GMT',
        'Link': '</api/driver/end-journey-v2>; rel="successor-version"',
      },
    }
  );
}
