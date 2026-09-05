/**
 * Next.js 16 Client Instrumentation
 *
 * Runs once when Next.js boots in the browser (not on the server).
 * Captures unhandled errors and promise rejections for client-side
 * telemetry. Complements instrumentation.ts (server-side).
 *
 * Kept intentionally minimal — no external SDK dependency.
 * Vercel Analytics/Speed Insights handle production performance metrics
 * when VERCEL=1; this provides a baseline for non-Vercel deployments.
 */

export function register() {
  if (typeof window === 'undefined') return;

  // Unhandled Promise Rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? 'Unknown rejection');
    const stack = reason instanceof Error ? reason.stack : undefined;

    console.error('[Client] Unhandled promise rejection:', {
      message,
      stack,
      url: window.location.href,
      timestamp: new Date().toISOString(),
    });
  });

  // Uncaught Runtime Errors
  window.addEventListener('error', (event) => {
    // Ignore errors already handled by React error boundaries
    // (those surface through error.tsx / global-error.tsx).
    if (!event.error) return;

    console.error('[Client] Uncaught runtime error:', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack,
      url: window.location.href,
      timestamp: new Date().toISOString(),
    });
  });
}
