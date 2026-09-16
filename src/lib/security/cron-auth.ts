import crypto from 'crypto';

/**
 * SECURITY: Fail-closed timing-safe cron authorization check.
 * Verifies Authorization: Bearer <CRON_SECRET> header against process.env.CRON_SECRET.
 */
export function verifyCronAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // SECURITY: Fail-closed — if CRON_SECRET is not configured, deny all
  if (!cronSecret) {
    console.error('🚫 CRON_SECRET not configured — blocking cron request');
    return false;
  }

  const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
  if (providedToken.length !== cronSecret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(cronSecret));
}
