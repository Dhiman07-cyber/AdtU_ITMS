"use client";

import { useAuth } from '@/contexts/auth-context';
import {
	EntitlementReason,
	getTransportEntitlement,
} from '@/lib/entitlement/transport-entitlement';

export interface UseTransportEntitlement {
  /** True only while auth/user data is still loading (decision not yet known). */
  loading: boolean;
  /** Canonical answer: does this user currently own transport access? */
  entitled: boolean;
  /** Why access is (un)available — drives lifecycle messaging. */
  reason: EntitlementReason;
}

/**
 * Phase 3 — the ONLY client-side transport entitlement hook.
 *
 * Reads the authenticated student document from `auth-context` and defers the
 * decision to the canonical {@link getTransportEntitlement}. Every client
 * transport gate (guards, navigation, dashboard widgets, QR display) must consume
 * this hook rather than re-deriving entitlement from `status` / `validUntil`.
 *
 * Non-students are reported as not entitled (transport is a student-only concept);
 * role-based routing is handled separately by `StudentAuthWrapper`.
 */
export function useTransportEntitlement(): UseTransportEntitlement {
  const { userData, loading } = useAuth();

  if (loading) {
    return { loading: true, entitled: false, reason: 'no_account' as EntitlementReason };
  }
  if (!userData || userData.role !== 'student') {
    return { loading: false, entitled: false, reason: 'no_account' as EntitlementReason };
  }
  const { entitled, reason } = getTransportEntitlement(userData);
  return { loading: false, entitled, reason };
}
