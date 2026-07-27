"use client";

import { PremiumPageLoader } from '@/components/LoadingSpinner';
import StudentAccessBlockScreen from '@/components/StudentAccessBlockScreen';
import { useAuth } from '@/contexts/auth-context';
import { useTransportEntitlement } from '@/hooks/useTransportEntitlement';
import { ReactNode,useEffect,useState } from 'react';

interface TransportEntitlementGuardProps {
  children: ReactNode;
}

/**
 * Phase 3 — the single client gate for transport-only pages (track-bus, bus, etc.).
 *
 * It evaluates the CANONICAL entitlement (via {@link useTransportEntitlement})
 * BEFORE its children mount. Because the subscribing page is passed as `children`
 * and is only rendered when `entitled` is true, none of that page's realtime
 * hooks/effects (Supabase channels, Firestore listeners, geolocation watchers)
 * ever run for an ineligible student. Entitlement is determined first; transport
 * systems load second.
 *
 * When not entitled it renders the shared lifecycle screen with a renewal CTA.
 */
export default function TransportEntitlementGuard({ children }: TransportEntitlementGuardProps) {
  const { userData, signOut } = useAuth();
  const { loading, entitled, reason } = useTransportEntitlement();
  const [deadlineConfig, setDeadlineConfig] = useState<any>(null);

  // Fetch deadline config ONLY when we must render the block screen (off-path).
  useEffect(() => {
    if (loading || entitled) return;
    let cancelled = false;
    fetch('/api/settings/deadline-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setDeadlineConfig(d?.config ?? d ?? null);
      })
      .catch(() => {
        /* block screen tolerates a null config */
      });
    return () => {
      cancelled = true;
    };
  }, [loading, entitled]);

  if (loading) return <PremiumPageLoader />;
  if (entitled) return <>{children}</>;

  return (
    <StudentAccessBlockScreen
      validUntil={(userData as any)?.validUntil ?? null}
      studentName={(userData as any)?.fullName || (userData as any)?.name || 'Student'}
      reason={reason}
      onLogout={signOut}
      deadlineConfig={deadlineConfig}
    />
  );
}
