import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { errorBudgetTracker } from '@/lib/observability/sre/error-budget';

export async function GET(req: Request) {
  const auth = await verifyApiAuth(req, ['admin', 'moderator']);
  if (!auth.authenticated) return auth.response;

  const report = errorBudgetTracker.evaluateAllErrorBudgets();
  return NextResponse.json(report, { status: 200 });
}
