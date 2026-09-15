import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { diagnosticsEngine } from '@/lib/observability/tracing/root-cause';

export async function GET(req: Request) {
  const auth = await verifyApiAuth(req, ['admin', 'moderator']);
  if (!auth.authenticated) return auth.response;

  const serviceMap = diagnosticsEngine.generateServiceMap();
  return NextResponse.json(serviceMap, { status: 200 });
}
