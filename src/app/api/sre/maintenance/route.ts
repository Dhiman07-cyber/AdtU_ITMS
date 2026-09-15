import { NextResponse } from 'next/server';
import { maintenanceManager } from '@/lib/observability/sre/maintenance-mode';
import { verifyApiAuth } from '@/lib/security/api-auth';

export async function GET() {
  return NextResponse.json(maintenanceManager.getStatus(), { status: 200 });
}

export async function POST(req: Request) {
  // State-changing: admin-only. (GET status stays public for dashboards.)
  // Note: maintenance state is per-instance memory (see maintenance-mode.ts),
  // so this toggles the receiving replica only — it cannot globally block
  // writes. Treat it as a local signal, not a global kill-switch.
  const auth = await verifyApiAuth(req, ['admin']);
  if (!auth.authenticated) return auth.response;

  try {
    const body = await req.json();
    if (body.action === 'enable') {
      const status = maintenanceManager.enableMaintenance({
        reason: body.reason || 'Scheduled Maintenance',
        activatedBy: auth.uid || 'System Admin',
        durationMinutes: body.durationMinutes,
        readOnly: body.readOnly
      });
      return NextResponse.json(status, { status: 200 });
    } else if (body.action === 'disable') {
      const status = maintenanceManager.disableMaintenance();
      return NextResponse.json(status, { status: 200 });
    } else {
      return NextResponse.json({ error: 'Invalid action parameter' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
