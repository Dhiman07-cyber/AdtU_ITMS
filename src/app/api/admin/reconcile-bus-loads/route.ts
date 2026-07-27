import { withSecurity } from '@/lib/security/api-security';
import { RateLimits } from '@/lib/security/rate-limiter';
import { EmptySchema } from '@/lib/security/validation-schemas';
import { adminReconcileBusLoads } from '@/lib/services/admin-reconcile-bus-loads';
import { NextResponse } from 'next/server';

/**
 * POST /api/admin/reconcile-bus-loads
 *
 * Canonical, server-safe (admin SDK) bus-load reconciliation. Recounts seat-owning
 * students per bus and rewrites all four counters consistently.
 *
 * Query params:
 *   ?dryRun=true        → report discrepancies, write nothing (default: live)
 *   ?busIds=bus_1,bus_2 → restrict to specific buses (default: all)
 *
 * Always corrects to the recounted value (no delta gate) and alerts admins on a
 * large delta. Safe to run repeatedly (idempotent).
 */
export const POST = withSecurity(
  async (request) => {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const busIdsParam = url.searchParams.get('busIds');
    const busIds = busIdsParam
      ? busIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const summary = await adminReconcileBusLoads({
      busIds,
      dryRun,
      alertOnLargeDelta: true,
    });

    return NextResponse.json({ success: true, summary });
  },
  {
    requiredRoles: ['admin'],
    schema: EmptySchema,
    rateLimit: RateLimits.CREATE,
    allowBodyToken: true,
  }
);
