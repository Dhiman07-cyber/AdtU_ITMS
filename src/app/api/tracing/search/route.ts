import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { traceStore } from '@/lib/observability/tracing/tracer';

export async function GET(req: Request) {
  const auth = await verifyApiAuth(req, ['admin', 'moderator']);
  if (!auth.authenticated) return auth.response;

  const { searchParams } = new URL(req.url);
  const traceId = searchParams.get('traceId') || undefined;
  const hasErrorParam = searchParams.get('hasError');
  const hasError = hasErrorParam !== null ? hasErrorParam === 'true' : undefined;

  const results = traceStore.searchTraces({
    traceId,
    hasError,
    limit: 50
  });

  return NextResponse.json({ traces: results, count: results.length }, { status: 200 });
}
