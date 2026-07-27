import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { resolveUserRole } from '@/lib/security/role-cache';
import { queryAuditEvents, type AuditEventRow } from '@/domains/audit';

const PAGE_SIZE = 20;

export interface AuditLogResponse {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  summary: string;
  severity: string;
  performedBy: string;
  performedByName: string;
  performedByRole: string;
  performedAt: string;
  targetType: string;
  targetId: string;
  targetName: string;
  metadata: Record<string, unknown>;
}

function rowToResponse(row: AuditEventRow): AuditLogResponse {
  return {
    id: row.id,
    createdAt: row.created_at,
    category: row.category,
    action: row.action,
    summary: row.summary || '',
    severity: row.severity,
    performedBy: row.actor_id,
    performedByName: row.actor_name || '',
    performedByRole: row.actor_role,
    performedAt: row.created_at,
    targetType: row.target_type || '',
    targetId: row.target_id || '',
    targetName: row.target_name || '',
    metadata: row.metadata ?? {},
  };
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;

    const userRole = await resolveUserRole(uid);
    if (userRole.role !== 'admin') {
      return NextResponse.json({ message: 'Access denied. Admin only.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || '';
    const severity = searchParams.get('severity') || '';
    const performedByRole = searchParams.get('performedByRole') || '';
    const search = searchParams.get('search') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || String(PAGE_SIZE), 10), 50);

    const result = await queryAuditEvents(
      {
        category: category || undefined,
        severity: severity || undefined,
        actor_role: performedByRole || undefined,
        from_date: startDate || undefined,
        to_date: endDate ? endDate + 'T23:59:59.999Z' : undefined,
      },
      { page, per_page: limit }
    );

    let results = result.data.map(rowToResponse);

    if (search) {
      const lowerSearch = search.toLowerCase();
      results = results.filter(
        (r) =>
          r.action.toLowerCase().includes(lowerSearch) ||
          r.summary.toLowerCase().includes(lowerSearch) ||
          r.targetName.toLowerCase().includes(lowerSearch) ||
          r.performedByName.toLowerCase().includes(lowerSearch)
      );
    }

    const offset = (page - 1) * limit;
    const hasMore = offset + limit < result.total;

    return NextResponse.json({
      logs: results,
      page,
      hasMore,
      pageSize: limit,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json(
      { message: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}
