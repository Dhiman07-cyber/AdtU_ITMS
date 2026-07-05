/**
 * useRazorpay Hook
 * Custom React hook for handling Razorpay payments
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { mapRazorpayErrorToState, type PaymentFrontendStatus } from '@/lib/payment/payment-state';

// Types
export interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  theme?: {
    color?: string;
  };
  handler: (response: RazorpayResponse) => void;
  modal?: {
    ondismiss?: () => void;
    confirm_close?: boolean;
  };
  readonly?: {
    email?: boolean;
    contact?: boolean;
  };
  config?: {
    display?: {
      language?: string;
    };
  };
}

export interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface PaymentConfig {
  amount: number;
  userId?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  enrollmentId?: string;
  durationYears?: number;
  purpose?: string;
  notes?: Record<string, any>;
}

export interface PaymentResult {
  success: boolean;
  paymentId?: string;
  orderId?: string;
  signature?: string;
  error?: string;
  /** Internal raw Razorpay error code — do NOT display to students */
  errorCode?: string;
  /** Internal raw Razorpay error reason — do NOT display to students */
  errorReason?: string;
  details?: any;
  /** Canonical frontend state — use this to drive UI */
  frontendStatus?: PaymentFrontendStatus;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

/**
 * Custom hook for Razorpay payment integration
 */
export function useRazorpay() {
  const { currentUser } = useAuth();
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Razorpay script with mobile-specific handling and zombie script recovery
  useEffect(() => {
    let script: HTMLScriptElement | null = null;

    const loadScript = () => {
      // Check if already in document
      if (document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
        return;
      }

      script = document.createElement('script');
      script.setAttribute('src', 'https://checkout.razorpay.com/v1/checkout.js');
      script.async = true;

      script.onload = () => {
        setIsScriptLoaded(true);
      };

      script.onerror = () => {
        setError('Failed to load payment gateway');
      };

      document.body.appendChild(script);
    };

    if (window.Razorpay) {
      setIsScriptLoaded(true);
    } else {
      loadScript();
    }

    return () => {
      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  /**
   * Create a payment order
   */
  const createOrder = useCallback(async (config: PaymentConfig) => {
    try {
      const token = await currentUser?.getIdToken();
      const response = await fetch('/api/payment/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          amount: config.amount,
          userId: config.userId || 'anonymous',
          userName: config.userName || 'Guest User',
          enrollmentId: config.enrollmentId,
          durationYears: config.durationYears || config.notes?.duration,
          purpose: config.purpose || 'Bus Service Payment',
          notes: {
            ...config.notes,
            email: config.userEmail || '',
            phone: config.userPhone || '',
            enrollmentId: config.enrollmentId || '',
            durationYears: String(config.durationYears || config.notes?.duration || '1'),
            // Ensure all note values are strings to satisfy Zod schema
            description: config.purpose || 'Bus Service Payment'
          },
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create order');
      }

      return data;
    } catch (error: any) {
      throw error;
    }
  }, [currentUser]);

  /**
   * Verify payment after successful transaction
   */
  const verifyPayment = useCallback(async (
    response: RazorpayResponse,
    config: PaymentConfig
  ): Promise<PaymentResult> => {


    try {

      const token = await currentUser?.getIdToken();

      const requestBody = {
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
        userId: config.userId,
        userName: config.userName,
        enrollmentId: config.enrollmentId,
        durationYears: config.durationYears || config.notes?.duration,
        purpose: config.purpose,
        amount: config.amount,
      };



      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyPayment: calling verify-payment with body:`, requestBody);
      const verifyResponse = await fetch('/api/payment/razorpay/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyResponse HTTP status:`, verifyResponse.status);
      const data = await verifyResponse.json();
      console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] verifyResponse Body:`, data);

      if (data.success) {
        return {
          success: true,
          paymentId: response.razorpay_payment_id,
          orderId: response.razorpay_order_id,
          signature: response.razorpay_signature,
          details: data.payment,
        };
      } else {
        return {
          success: false,
          error: data.error || 'Payment verification failed',
          frontendStatus: 'verification_pending',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Payment verification failed',
        frontendStatus: 'verification_pending',
      };
    }
  }, [currentUser]);

  /**
   * Process payment
   */
  const processPayment = useCallback(async (
    config: PaymentConfig
  ): Promise<PaymentResult> => {
    // Reset error state
    setError(null);

    // Validate script loaded
    if (!isScriptLoaded) {
      const errorMsg = 'Payment gateway not loaded. Please refresh the page.';
      setError(errorMsg);
      toast.error(errorMsg);
      return { success: false, error: errorMsg, frontendStatus: 'failed' };
    }

    // Validate amount
    if (!config.amount || config.amount <= 0) {
      const errorMsg = 'Invalid amount';
      setError(errorMsg);
      toast.error(errorMsg);
      return { success: false, error: errorMsg, frontendStatus: 'failed' };
    }

    setIsProcessing(true);

    try {
      // Step 1: Create order
      toast.loading('Creating payment order...');

      const orderData = await createOrder(config);

      toast.dismiss();

      // Step 2: Open Razorpay checkout
      return new Promise<PaymentResult>((resolve) => {
        if (!window.Razorpay) {
          const errorMsg = 'Payment gateway not available. Please refresh the page.';
          setError(errorMsg);
          setIsProcessing(false);
          toast.dismiss();
          toast.error(errorMsg);
          resolve({ success: false, error: errorMsg, frontendStatus: 'failed' });
          return;
        }

        // ─── Checkout Session State Machine ───────────────────────────────
        //
        // ONE checkout session = potentially MANY payment.failed events.
        // payment.failed is INTERMEDIATE. The session outcome is determined
        // only when the checkout closes (handler = success, ondismiss = close).
        //
        // Priority (higher may never be overwritten by lower):
        //   success > verification_pending > processing > failed > cancelled
        //
        // checkoutSessionId guards against stale callbacks from old sessions.

        const checkoutSessionId = `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        // Latest buffered failure from intermediate payment.failed events.
        // Discarded entirely if success arrives.
        let pendingFailure: PaymentResult | null = null;

        // Terminal lock: once set to 'success', no further state change is allowed.
        // Prevents ondismiss or late payment.failed from overwriting a win.
        let terminalResult: PaymentResult | null = null;

        // Single-use gate — the Promise resolves exactly once.
        let resolved = false;

        const safeResolve = (sessionId: string, result: PaymentResult) => {
          // Ignore callbacks from stale sessions
          if (sessionId !== checkoutSessionId) return;
          // Already resolved — ignore
          if (resolved) return;
          resolved = true;
          setIsProcessing(false);
          resolve(result);
        };

        const options: RazorpayOptions = {
          key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '',
          amount: orderData.order.amount,
          currency: orderData.order.currency,
          name: 'ADTU Bus Service',
          description: config.purpose || 'Bus Service Payment',
          order_id: orderData.order.id,
          prefill: {
            name: config.userName,
            email: config.userEmail,
            contact: config.userPhone,
          },
          theme: { color: '#3B82F6' },
          readonly: {
            email: !!config.userEmail,
            contact: !!config.userPhone,
          },
          config: { display: { language: 'en' } },

          // ── SUCCESS handler ─────────────────────────────────────────────
          // Called by Razorpay after a payment is captured.
          // SUCCESS is ALWAYS the highest-priority terminal state.
          handler: async (response: RazorpayResponse) => {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.handler (payment.success) ENTER. response:`, response);
            // ⚠️  SYNCHRONOUS section — runs before any await.
            // Razorpay fires ondismiss immediately after invoking the handler
            // (because it closes the modal). Setting terminalResult here — before
            // the first await — ensures ondismiss sees a non-null terminalResult
            // and exits without resolving the Promise as failed.
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Clearing pendingFailure (was:`, pendingFailure, `)`);
            pendingFailure = null;
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Setting terminalResult to success sentinel`);
            terminalResult = { success: true, frontendStatus: undefined } as PaymentResult;

            toast.loading('Verifying payment...');

            const result = await verifyPayment(response, config);
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.handler: verifyPayment result:`, result);

            toast.dismiss();
            if (result.success) {
              toast.success('Payment completed successfully!');
            } else {
              // Verification pending — recovery will handle it
              toast.error(result.error || 'Payment verification failed');
            }

            // Overwrite sentinel with real result, then resolve.
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Overwriting terminalResult with result and safeResolving`);
            terminalResult = result;
            safeResolve(checkoutSessionId, result);
          },

          modal: {
            confirm_close: true,

            // ── ONDISMISS handler ────────────────────────────────────────
            // Razorpay fires ondismiss when the checkout modal is closed.
            // This fires AFTER handler on success path too, so we must guard.
            ondismiss: () => {
              console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.modal.ondismiss ENTER. terminalResult:`, terminalResult, `pendingFailure:`, pendingFailure);
              toast.dismiss();

              // Case A: Success already resolved — ondismiss is a no-op.
              if (terminalResult !== null) {
                console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.modal.ondismiss Case A: terminalResult is not null. Exiting.`);
                return;
              }

              // Case B / C: Checkout closed without a successful payment.
              // Use the buffered failure if one exists (user tried and failed),
              // otherwise treat as a plain cancellation (user just closed).
              const finalResult: PaymentResult = pendingFailure ?? {
                success: false,
                error: 'failed',
                errorCode: 'USER_CANCELLED',
                errorReason: 'payment_cancelled',
                frontendStatus: 'failed',
              };
              console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] options.modal.ondismiss Case B/C: resolving with:`, finalResult);
              safeResolve(checkoutSessionId, finalResult);
            },
          },
        };

        // ── Mobile back-button protection ───────────────────────────────
        const historyState = { isRazorpayOpen: true, sessionId: checkoutSessionId, orderId: orderData.order.id };
        let historyCleanedUp = false;

        const cleanupHistory = () => {
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] cleanupHistory() ENTER. historyCleanedUp:`, historyCleanedUp);
          if (historyCleanedUp) return;
          historyCleanedUp = true;
          window.removeEventListener('popstate', handlePopState);
          if (
            window.history.state?.isRazorpayOpen &&
            window.history.state?.sessionId === checkoutSessionId
          ) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] cleanupHistory() - calling window.history.back()`);
            window.history.back();
          } else {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] cleanupHistory() - condition not met, skipping back()`);
          }
        };

        const handlePopState = (_event: PopStateEvent) => {
          cleanupHistory();
        };
        // ────────────────────────────────────────────────────────────────

        // Wrap success handler to also clean up history
        const originalHandler = options.handler;
        options.handler = async (response: RazorpayResponse) => {
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped success handler wrapper ENTER.`);
          cleanupHistory();
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped success handler wrapper calling originalHandler...`);
          await originalHandler(response);
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped success handler wrapper EXIT.`);
        };

        // Wrap ondismiss to also clean up history
        const originalOnDismiss = options.modal?.ondismiss;
        if (options.modal) {
          options.modal.ondismiss = () => {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped ondismiss wrapper ENTER.`);
            cleanupHistory();
            if (originalOnDismiss) {
              console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped ondismiss wrapper calling originalOnDismiss...`);
              originalOnDismiss();
            }
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] Wrapped ondismiss wrapper EXIT.`);
          };
        }

        // Create Razorpay instance
        let razorpay: any;
        try {
          razorpay = new window.Razorpay(options);
        } catch (err: any) {
          const errorMsg = 'Failed to initialize payment gateway. Please try again.';
          setError(errorMsg);
          setIsProcessing(false);
          toast.dismiss();
          toast.error(errorMsg);
          resolve({ success: false, error: errorMsg, frontendStatus: 'failed' });
          return;
        }

        // ── payment.failed — INTERMEDIATE, NEVER resolves the session ────
        //
        // Razorpay fires this while the checkout is still open.
        // The user can retry inside the same modal.
        // We ONLY buffer the failure. We never call safeResolve here.
        // Final resolution happens in ondismiss (user closes) or handler (success).
        razorpay.on('payment.failed', (response: any) => {
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] payment.failed event callback ENTER. response:`, response);
          // Guard: if success already locked in, ignore all subsequent events
          if (terminalResult !== null) {
            console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] payment.failed: Success already locked in, ignoring event.`);
            return;
          }

          const errorObj = response?.error || response || {};
          const rawCode: string = errorObj.code || '';
          const rawReason: string = errorObj.reason || '';
          const rawDesc: string = errorObj.description || '';
          const rawSource: string = errorObj.source || '';

          if (process.env.NODE_ENV === 'development') {
            console.info(
              `[useRazorpay][${checkoutSessionId}] payment.failed buffered ` +
              `(checkout still open): code=${rawCode}, reason=${rawReason}, ` +
              `description=${rawDesc}, source=${rawSource}`
            );
          }

          const frontendStatus = mapRazorpayErrorToState(rawCode, rawReason);

          // Overwrite with the latest failure — earlier ones are irrelevant
          pendingFailure = {
            success: false,
            error: frontendStatus,
            errorCode: rawCode,
            errorReason: rawReason,
            frontendStatus,
          };
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] payment.failed: Set pendingFailure to:`, pendingFailure);

          // DO NOT call safeResolve — checkout is still open, user can retry.
        });
        // ────────────────────────────────────────────────────────────────

        // Open checkout
        try {
          window.history.pushState(historyState, '');
          window.addEventListener('popstate', handlePopState);
          console.log(`[PAYMENT_TRACE] [${new Date().toISOString()}] CHECKOUT_OPEN: calling razorpay.open()`);
          razorpay.open();
        } catch (err: any) {
          cleanupHistory();
          const errorMsg = err.message || 'Failed to open payment checkout. Please try again.';
          setError(errorMsg);
          setIsProcessing(false);
          toast.dismiss();
          toast.error(errorMsg);
          resolve({ success: false, error: errorMsg, frontendStatus: 'failed' });
        }
      });

    } catch (error: any) {

      const errorMsg = error.message || 'Failed to process payment';
      setError(errorMsg);
      setIsProcessing(false);
      toast.dismiss();
      toast.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
        frontendStatus: 'failed'
      };
    }
  }, [isScriptLoaded, createOrder, verifyPayment]);

  return {
    isScriptLoaded,
    isProcessing,
    error,
    processPayment,
    createOrder,
    verifyPayment,
  };
}
