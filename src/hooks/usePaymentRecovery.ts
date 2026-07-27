"use client";

/**
 * usePaymentRecovery
 *
 * Drives the automatic recovery polling loop.
 * Rules:
 *  - Retry every ~9 seconds
 *  - Maximum 5 attempts (~45 s total)
 *  - Stop after limit and surface the timeout message
 *  - Caller can trigger a manual attempt at any time via `triggerManualCheck`
 */

import {
	mapRecoverStatusToState,
	PaymentFrontendStatus,
	RECOVERY_MAX_ATTEMPTS,
	RECOVERY_POLL_INTERVAL_MS,
} from '@/lib/payment/payment-state';
import { useCallback,useEffect,useRef,useState } from 'react';

export interface RecoveryState {
  status: PaymentFrontendStatus | null; // null = not yet run
  isPolling: boolean;
  attemptsDone: number;
  timedOut: boolean;
  rawApiStatus: string | null; // preserved for internal logging
}

export interface UsePaymentRecoveryOptions {
  /** JWT token (already fetched by caller) */
  getToken: () => Promise<string | null>;
  /** Fired whenever recovery resolves to success/already_processed */
  onSuccess?: () => void;
  /** Whether to start polling immediately on mount */
  autoStart?: boolean;
  /** Query params forwarded to /api/payment/recover */
  orderId?: string;
  paymentId?: string;
}

export function usePaymentRecovery(opts: UsePaymentRecoveryOptions) {
  const { getToken, onSuccess, autoStart = true, orderId, paymentId } = opts;

  const [state, setState] = useState<RecoveryState>({
    status: null,
    isPolling: false,
    attemptsDone: 0,
    timedOut: false,
    rawApiStatus: null,
  });

  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runOnce = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;

    const token = await getToken();
    if (!token) {
      console.warn('[usePaymentRecovery] No auth token, aborting poll.');
      return;
    }

    // Build query
    const params = new URLSearchParams();
    if (orderId) params.set('orderId', orderId);
    if (paymentId) params.set('paymentId', paymentId);
    const qs = params.toString() ? `?${params.toString()}` : '';

    let data: any;
    try {
      const res = await fetch(`/api/payment/recover${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      data = await res.json();
    } catch (err) {
      console.error('[usePaymentRecovery] network error:', err);
      data = { success: false, status: 'verification_pending' };
    }

    const rawStatus: string = data?.status || 'verification_pending';
    const frontendStatus = mapRecoverStatusToState(rawStatus);

    console.log(`[usePaymentRecovery] attempt ${attemptsRef.current + 1} raw=${rawStatus} mapped=${frontendStatus}`);

    if (!mountedRef.current) return;

    // Terminal states — stop polling
    if (frontendStatus === 'success') {
      setState(prev => ({
        ...prev,
        status: 'success',
        isPolling: false,
        attemptsDone: attemptsRef.current + 1,
        rawApiStatus: rawStatus,
      }));
      onSuccess?.();
      return;
    }

    if (frontendStatus === 'failed') {
      setState(prev => ({
        ...prev,
        status: 'failed',
        isPolling: false,
        attemptsDone: attemptsRef.current + 1,
        rawApiStatus: rawStatus,
      }));
      return;
    }

    // Still in-flight (processing / verification_pending / banking_issue)
    attemptsRef.current += 1;

    if (attemptsRef.current >= RECOVERY_MAX_ATTEMPTS) {
      // Polling limit hit
      setState(prev => ({
        ...prev,
        status: frontendStatus,
        isPolling: false,
        attemptsDone: attemptsRef.current,
        timedOut: true,
        rawApiStatus: rawStatus,
      }));
      return;
    }

    // Schedule next
    setState(prev => ({
      ...prev,
      status: frontendStatus,
      isPolling: true,
      attemptsDone: attemptsRef.current,
      rawApiStatus: rawStatus,
    }));

    timerRef.current = setTimeout(() => {
      if (mountedRef.current) runOnce();
    }, RECOVERY_POLL_INTERVAL_MS);
  }, [getToken, onSuccess, orderId, paymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    attemptsRef.current = 0;
    setState({
      status: null,
      isPolling: true,
      attemptsDone: 0,
      timedOut: false,
      rawApiStatus: null,
    });
    runOnce();
  }, [runOnce]);

  /** Trigger a single manual check without resetting the attempt counter */
  const triggerManualCheck = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(prev => ({ ...prev, isPolling: true }));
    runOnce();
  }, [runOnce]);

  // Auto-start when autoStart transitions to true
  useEffect(() => {
    if (autoStart) start();
  }, [autoStart, start]);

  return { state, start, triggerManualCheck };
}
