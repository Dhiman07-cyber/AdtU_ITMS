import { NextResponse } from 'next/server';
import { verifyApiAuth } from '@/lib/security/api-auth';
import { incidentManager, ESCALATION_MATRIX } from '@/lib/observability/sre/incident-framework';

export async function GET(req: Request) {
  const auth = await verifyApiAuth(req, ['admin', 'moderator']);
  if (!auth.authenticated) return auth.response;

  return NextResponse.json({
    activeIncidents: incidentManager.getActiveIncidents(),
    history: incidentManager.getIncidentHistory(),
    escalationMatrix: ESCALATION_MATRIX
  }, { status: 200 });
}
