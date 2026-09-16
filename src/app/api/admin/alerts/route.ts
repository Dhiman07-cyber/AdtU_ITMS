/**
 * Alertmanager Webhook Receiver  -- /api/admin/alerts
 *
 * Receives firing/resolved alert notifications from Alertmanager and
 * forwards them as in-app notifications to all admin users.
 *
 * SECURITY:
 *   - Restricted to internal network via Nginx (RFC-1918 ranges only -- deny external).
 *   - Optional shared secret header (AM_WEBHOOK_SECRET) prevents spoofing even on
 *     a misconfigured Nginx.  Absent in dev: warning only, not fatal.
 */

import { getUsersByRole } from "@/domains/identity";
import { pgInsertNotification } from "@/domains/notification/repositories/notification.repository.pg";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

interface AlertmanagerAlert {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt?: string;
  generatorURL?: string;
  fingerprint?: string;
}

interface AlertmanagerPayload {
  version: string;
  groupKey: string;
  truncatedAlerts?: number;
  status: "firing" | "resolved";
  receiver: string;
  groupLabels: Record<string, string>;
  commonLabels: Record<string, string>;
  commonAnnotations: Record<string, string>;
  externalURL?: string;
  alerts: AlertmanagerAlert[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Shared-secret validation -- strictly fails closed in production (AUTH-05).
  const configuredSecret = process.env.AM_WEBHOOK_SECRET;
  if (!configuredSecret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[alerts-webhook] REJECTED: AM_WEBHOOK_SECRET is not configured in production. Failing closed.");
      return NextResponse.json({ error: "Webhook authentication unconfigured" }, { status: 500 });
    }
  } else {
    const incoming = request.headers.get("X-Alertmanager-Token") || "";
    const hmacKey = "alertmanager-webhook-key";
    const expectedHash = crypto.createHmac("sha256", hmacKey).update(configuredSecret).digest();
    const actualHash = crypto.createHmac("sha256", hmacKey).update(incoming).digest();
    if (!crypto.timingSafeEqual(expectedHash, actualHash)) {
      console.warn("[alerts-webhook] Rejected: missing or invalid X-Alertmanager-Token");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: AlertmanagerPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const { alerts, status, commonAnnotations, commonLabels } = payload;
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  try {
    const admins = await getUsersByRole("admin");
    const adminIds = admins.map((a: any) => a.uid || a.id).filter(Boolean);

    if (adminIds.length === 0) {
      console.warn("[alerts-webhook] No admin users found -- alert notifications dropped.");
      return NextResponse.json({ ok: true, processed: 0 });
    }

    let sent = 0;
    for (const alert of alerts) {
      const isFiring = alert.status === "firing";
      const severity = alert.labels.severity || commonLabels.severity || "warning";
      const alertName = alert.labels.alertname || commonLabels.alertname || "Unknown Alert";
      const summary = alert.annotations.summary || commonAnnotations.summary || alertName;
      const description = alert.annotations.description || commonAnnotations.description || "";

      const notifType: "info" | "warning" | "error" =
        severity === "critical" ? "error" : severity === "warning" ? "warning" : "info";

      const title = isFiring ? `ALERT: ${summary}` : `RESOLVED: ${summary}`;

      const lines = [
        isFiring ? `Severity: ${severity.toUpperCase()}` : "Status: Resolved",
        description ? `Details: ${description}` : "",
        `Alert: ${alertName}`,
        alert.startsAt
          ? `Started: ${new Date(alert.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
          : "",
        !isFiring && alert.endsAt
          ? `Ended: ${new Date(alert.endsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`
          : "",
      ].filter(Boolean);

      await pgInsertNotification({
        title,
        content: lines.join("\n"),
        type: notifType,
        sender: { userId: "system", userName: "Alertmanager", userRole: "admin" },
        target: { type: "specific_users", specificUserIds: adminIds },
        recipientIds: adminIds,
        readByUserIds: [],
        metadata: {
          source: "alertmanager",
          alertName,
          severity,
          status: alert.status,
          labels: alert.labels,
          startsAt: alert.startsAt,
          endsAt: alert.endsAt,
          fingerprint: alert.fingerprint,
        },
      });
      sent++;
    }

    console.log(
      `[alerts-webhook] Forwarded ${sent}/${alerts.length} alert(s) (${status}) to ${adminIds.length} admin(s).`
    );
    return NextResponse.json({ ok: true, processed: sent });
  } catch (err: any) {
    console.error("[alerts-webhook] Failed to forward alerts:", err?.message || err);
    // Return 200 so Alertmanager does NOT go into an error backoff loop.
    return NextResponse.json({ ok: false, error: "Internal error -- alert forwarding failed" });
  }
}
