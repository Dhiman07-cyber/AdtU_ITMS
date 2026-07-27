/**
 * D11 Admin Service
 *
 * Orchestration only — no business logic ownership. Wraps existing
 * admin-specific services for email notifications, bus load reconciliation,
 * integrity detection, and session activation orchestration.
 *
 * ponytail: each underlying service is the canonical implementation —
 * wrapped by reference, not reimplemented. Assignment and reassignment
 * orchestration delegates to their respective domain modules.
 */
import {
	sendApplicationApprovedNotification,
	sendApplicationRejectedNotification,
	sendStudentAddedNotification,
} from '@/lib/services/admin-email.service';
import type {
	ReconcileOptions,
	ReconcileSummary,
} from '@/lib/services/admin-reconcile-bus-loads';
import { adminReconcileBusLoads } from '@/lib/services/admin-reconcile-bus-loads';
import type {
	IntegrityFinding,
	IntegrityReport,
} from '@/lib/services/integrity-detector';
import { runIntegrityScan } from '@/lib/services/integrity-detector';
import type { SessionActivationSummary } from '@/lib/services/session-activation.service';
import {
	activateSingleApplication,
	activateUpcomingSessionApplications,
} from '@/lib/services/session-activation.service';

export async function sendStudentAddedEmail(
  adminsOrNull: Parameters<typeof sendStudentAddedNotification>[0],
  studentData: Parameters<typeof sendStudentAddedNotification>[1],
  attachment?: Parameters<typeof sendStudentAddedNotification>[2],
) {
  return sendStudentAddedNotification(adminsOrNull, studentData, attachment);
}

export async function sendApplicationRejectedEmail(data: Parameters<typeof sendApplicationRejectedNotification>[0]) {
  return sendApplicationRejectedNotification(data);
}

export async function sendApplicationApprovedEmail(data: Parameters<typeof sendApplicationApprovedNotification>[0]) {
  return sendApplicationApprovedNotification(data);
}

export async function reconcileBusLoads(options?: ReconcileOptions): Promise<ReconcileSummary> {
  return adminReconcileBusLoads(options);
}

export async function detectIntegrityIssues(): Promise<IntegrityReport> {
  return runIntegrityScan();
}

export async function activateUpcomingApplications(trigger: 'cron' | 'admin'): Promise<SessionActivationSummary> {
  return activateUpcomingSessionApplications({ trigger });
}

export async function activateApplication(applicationId: string, trigger: 'admin' = 'admin'): Promise<SessionActivationSummary> {
  return activateSingleApplication(applicationId, trigger);
}

export type { IntegrityFinding,IntegrityReport,ReconcileOptions,ReconcileSummary,SessionActivationSummary };
